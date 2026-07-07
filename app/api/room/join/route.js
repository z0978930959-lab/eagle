import { NextResponse } from 'next/server';
import { joinRoom, viewFor } from '../../../../lib/gameLogic';
import { getRoom, setRoom, storeReady } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE', message: '尚未設定資料庫' }, { status: 500 });
  }
  const { code, teamId } = await req.json();
  const room = await getRoom(code);
  if (!room) return NextResponse.json({ error: 'NOT_FOUND', message: '找不到這個房號' }, { status: 404 });
  if (room.status !== 'waiting') return NextResponse.json({ error: 'ROOM_FULL', message: '房間已滿或比賽已開始' }, { status: 409 });
  if (!teamId) return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  if (teamId === room.awayTeamId) {
    return NextResponse.json({ error: 'TEAM_TAKEN', message: '對方已選這支球隊，請換一隊' }, { status: 409 });
  }

  joinRoom(room, teamId);
  await setRoom(code, room);

  return NextResponse.json({ code, token: room.tokens.home, view: viewFor(room, 'home') });
}
