import { NextResponse } from 'next/server';
import {
  viewFor,
  roleOf,
  actPitcherSubmit,
  actBatterSubmit,
  actChangePitcher,
  actPinchHit,
  actReadyNext,
} from '../../../../lib/gameLogic';
import { getRoom, setRoom, storeReady } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE' }, { status: 500 });
  }
  const { code, token, action, payload } = await req.json();
  const room = await getRoom(code);
  if (!room) return NextResponse.json({ error: 'NOT_FOUND', message: '房間不存在或已過期' }, { status: 404 });
  const role = roleOf(room, token);
  if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!room.game) return NextResponse.json({ error: 'NOT_STARTED', message: '對手尚未加入' }, { status: 409 });

  try {
    switch (action) {
      case 'pitcher_submit':
        actPitcherSubmit(room, role, payload);
        break;
      case 'batter_submit':
        actBatterSubmit(room, role, payload);
        break;
      case 'change_pitcher':
        actChangePitcher(room, role, payload.idx);
        break;
      case 'pinch_hit':
        actPinchHit(room, role, payload.benchIdx);
        break;
      case 'ready_next':
        actReadyNext(room, role);
        break;
      default:
        return NextResponse.json({ error: 'BAD_ACTION' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 409 });
  }

  await setRoom(code, room);
  return NextResponse.json({ view: viewFor(room, role) });
}
