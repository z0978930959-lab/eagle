import { NextResponse } from 'next/server';
import { createRoom, viewFor } from '../../../../lib/gameLogic';
import { setRoom, roomExists, storeReady } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

function genCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function POST(req) {
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE', message: '尚未設定資料庫，請依 README 連接 Upstash Redis' }, { status: 500 });
  }
  const { innings, teamId } = await req.json();
  if (![1, 3].includes(innings) || !teamId) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }

  let code = genCode();
  for (let i = 0; i < 5 && (await roomExists(code)); i++) code = genCode();

  const room = createRoom({ code, innings, awayTeamId: teamId });
  await setRoom(code, room);

  return NextResponse.json({ code, token: room.tokens.away, view: viewFor(room, 'away') });
}
