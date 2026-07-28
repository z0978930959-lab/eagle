import { NextResponse } from 'next/server';
import { createTournamentRoom, tournamentViewFor } from '../../../../lib/tournamentLogic';
import { createRoomIfAbsent, storeReady, rateLimit } from '../../../../lib/store';
import { errorResponseInfo } from '../../../../lib/apiError';
import { clientIp } from '../../../../lib/clientIp';

export const dynamic = 'force-dynamic';

function genCode() {
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return String(1000 + (buf[0] % 9000));
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function POST(req) {
  if (!storeReady()) return NextResponse.json({ error: 'NO_STORE', message: '尚未設定資料庫' }, { status: 500 });
  const ip = clientIp(req);
  const rl = await rateLimit('create-min', ip, 5, 60);
  const rl2 = await rateLimit('create-hr', ip, 20, 3600);
  if (!rl.ok || !rl2.ok) return NextResponse.json({ error: 'RATE_LIMITED', message: '建立賽事過於頻繁，請稍候' }, { status: 429 });

  for (let i = 0; i < 30; i++) {
    const code = genCode();
    const room = createTournamentRoom({ code });
    try {
      if (await createRoomIfAbsent(code, room)) {
        return NextResponse.json({ code, token: room.tokens.a, view: tournamentViewFor(room, 'a') });
      }
    } catch (e) {
      const info = errorResponseInfo(e);
      return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
    }
  }
  return NextResponse.json({ error: 'CODE_POOL_BUSY', message: '房號暫時擁擠' }, { status: 503 });
}
