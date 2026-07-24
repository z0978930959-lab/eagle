import { NextResponse } from 'next/server';
import { joinRoom, viewFor } from '../../../../lib/gameLogic';
import { joinBingoRoom, bingoViewFor } from '../../../../lib/bingoLogic';
import { joinSplendorRoom, splendorViewFor } from '../../../../lib/splendorLogic';
import { getRoom, storeReady, withRoomLock, assertCode, rateLimit } from '../../../../lib/store';
import { safeErrorCode, errorResponseInfo } from '../../../../lib/apiError';
import { clientIp } from '../../../../lib/clientIp';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE', message: '尚未設定資料庫' }, { status: 500 });
  }

  // 加入房間也要 rate limit，避免用 4 位數房號池被枚舉搶進他人房間
  const ip = clientIp(req);
  const minuteRl = await rateLimit('join-min', ip, 20, 60);
  const hourRl = await rateLimit('join-hr', ip, 200, 3600);
  if (!minuteRl.ok || !hourRl.ok) {
    return NextResponse.json({ error: 'RATE_LIMITED', message: '加入房間過於頻繁，請稍候再試' }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }
  const { code, teamId, mode } = body || {};
  const isBingo = mode === 'bingo';
  const isSplendor = mode === 'splendor';
  if (!isBingo && !isSplendor && typeof teamId !== 'string') {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }
  try {
    assertCode(code);
  } catch {
    return NextResponse.json({ error: 'BAD_CODE', message: '房號格式錯誤' }, { status: 400 });
  }

  try {
    return await withRoomLock(code, async ({ guardedSetRoom }) => {
      const room = await getRoom(code);
      if (!room) return NextResponse.json({ error: 'NOT_FOUND', message: '找不到這個房號' }, { status: 404 });
      if (room.status !== 'waiting') return NextResponse.json({ error: 'ROOM_FULL', message: '房間已滿或比賽已開始' }, { status: 409 });
      // 三種遊戲共用房號池：模式對不上就擋（避免用錯的介面誤入他人房間）
      const roomMode = room.type === 'bingo' ? 'bingo' : room.type === 'splendor' ? 'splendor' : 'baseball';
      const wantMode = isSplendor ? 'splendor' : isBingo ? 'bingo' : 'baseball';
      if (roomMode !== wantMode) {
        const label = { bingo: '賓果', splendor: '璀璨寶石', baseball: '棒球' }[roomMode];
        return NextResponse.json({ error: 'WRONG_MODE', message: `這是${label}房，請從${label}模式加入` }, { status: 409 });
      }
      if (isSplendor) {
        let seat, token;
        try {
          ({ seat, token } = joinSplendorRoom(room));
        } catch (e) {
          const info = errorResponseInfo(e);
          return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
        }
        await guardedSetRoom(code, room);
        return NextResponse.json({ code, token, view: splendorViewFor(room, seat) });
      }
      if (isBingo) {
        try {
          joinBingoRoom(room);
        } catch (e) {
          return NextResponse.json({ error: safeErrorCode(e) }, { status: 409 });
        }
        await guardedSetRoom(code, room);
        return NextResponse.json({ code, token: room.tokens.home, view: bingoViewFor(room, 'home') });
      }
      if (teamId === room.awayTeamId) {
        return NextResponse.json({ error: 'TEAM_TAKEN', message: '對方已選這支球隊，請換一隊' }, { status: 409 });
      }

      try {
        joinRoom(room, teamId);
      } catch (e) {
        const errCode = safeErrorCode(e);
        return NextResponse.json({ error: errCode }, { status: errCode === 'BAD_TEAM' ? 400 : 409 });
      }
      await guardedSetRoom(code, room);
      return NextResponse.json({ code, token: room.tokens.home, view: viewFor(room, 'home') });
    });
  } catch (e) {
    const info = errorResponseInfo(e);
    return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
  }
}
