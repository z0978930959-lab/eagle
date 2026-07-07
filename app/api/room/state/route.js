import { NextResponse } from 'next/server';
import { viewFor, roleOf } from '../../../../lib/gameLogic';
import { getRoom, storeReady } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE' }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const token = searchParams.get('token');
  const room = await getRoom(code);
  if (!room) return NextResponse.json({ error: 'NOT_FOUND', message: '房間不存在或已過期' }, { status: 404 });
  const role = roleOf(room, token);
  if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  return NextResponse.json({ view: viewFor(room, role) });
}
