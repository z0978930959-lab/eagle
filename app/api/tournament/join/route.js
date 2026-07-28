import { NextResponse } from 'next/server';
import { joinTournamentRoom, tournamentViewFor } from '../../../../lib/tournamentLogic';
import { getRoom, storeReady, withRoomLock, assertCode, rateLimit } from '../../../../lib/store';
import { errorResponseInfo } from '../../../../lib/apiError';
import { clientIp } from '../../../../lib/clientIp';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!storeReady()) return NextResponse.json({ error: 'NO_STORE' }, { status: 500 });
  const ip = clientIp(req);
  const rl = await rateLimit('join-min', ip, 20, 60);
  if (!rl.ok) return NextResponse.json({ error: 'RATE_LIMITED', message: '加入過於頻繁' }, { status: 429 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 }); }
  const { code } = body || {};
  try { assertCode(code); } catch { return NextResponse.json({ error: 'BAD_CODE' }, { status: 400 }); }

  try {
    return await withRoomLock(code, async ({ guardedSetRoom }) => {
      const room = await getRoom(code);
      if (!room) return NextResponse.json({ error: 'NOT_FOUND', message: '找不到這個賽事' }, { status: 404 });
      if (room.type !== 'tournament') return NextResponse.json({ error: 'WRONG_MODE', message: '這不是綜合比賽房' }, { status: 409 });
      if (room.status !== 'waiting') return NextResponse.json({ error: 'ROOM_FULL', message: '賽事已滿' }, { status: 409 });
      let seat, token;
      try { ({ seat, token } = joinTournamentRoom(room)); }
      catch (e) { const info = errorResponseInfo(e); return NextResponse.json({ error: info.code, message: info.message }, { status: info.status }); }
      await guardedSetRoom(code, room);
      return NextResponse.json({ code, token, view: tournamentViewFor(room, seat) });
    });
  } catch (e) {
    const info = errorResponseInfo(e);
    return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
  }
}
