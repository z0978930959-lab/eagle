import { NextResponse } from 'next/server';
import { joinRoom, viewFor } from '../../../../lib/gameLogic';
import { joinBingoRoom, bingoViewFor } from '../../../../lib/bingoLogic';
import { gameByMode, gameByRoom } from '../../../../lib/gameRegistry';
import { getRoom, storeReady, withRoomLock, assertCode, rateLimit } from '../../../../lib/store';
import { safeErrorCode, errorResponseInfo } from '../../../../lib/apiError';
import { clientIp } from '../../../../lib/clientIp';

export const dynamic = 'force-dynamic';

const MODE_LABEL = { bingo: '賓果', baseball: '棒球', splendor: '璀璨寶石', mission: '密語連線', poker: '17 撲克', ecard: 'E 卡', drawguess: '你畫我猜', gomoku: '五子棋' };

export async function POST(req) {
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE', message: '尚未設定資料庫' }, { status: 500 });
  }

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
  const game = gameByMode(mode);
  const isBaseball = !isBingo && !game;

  if (isBaseball && typeof teamId !== 'string') {
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

      // 共用房號池：模式對不上就擋
      const roomMode = room.type === 'bingo' ? 'bingo' : gameByRoom(room) ? room.type : 'baseball';
      const wantMode = game ? mode : isBingo ? 'bingo' : 'baseball';
      if (roomMode !== wantMode) {
        const label = MODE_LABEL[roomMode] || roomMode;
        return NextResponse.json({ error: 'WRONG_MODE', message: `這是${label}房，請從${label}模式加入` }, { status: 409 });
      }

      // 註冊表遊戲：統一分派
      if (game) {
        let seat, token;
        try {
          ({ seat, token } = game.join(room));
        } catch (e) {
          const info = errorResponseInfo(e);
          return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
        }
        await guardedSetRoom(code, room);
        return NextResponse.json({ code, token, view: game.viewFor(room, seat) });
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
