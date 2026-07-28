import { NextResponse } from 'next/server';
import { tournamentRoleOf, tournamentReport, tournamentSetSubRoom, tournamentViewFor } from '../../../../lib/tournamentLogic';
import { chatOf } from '../../../../lib/chat';
import { getRoom, storeReady, withRoomLock, assertCode } from '../../../../lib/store';
import { errorResponseInfo } from '../../../../lib/apiError';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!storeReady()) return NextResponse.json({ error: 'NO_STORE' }, { status: 500 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 }); }
  const { code, token, winner, subRoom } = body || {};
  try { assertCode(code); } catch { return NextResponse.json({ error: 'BAD_CODE' }, { status: 400 }); }
  if (typeof token !== 'string') return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });

  try {
    return await withRoomLock(code, async ({ guardedSetRoom }) => {
      const room = await getRoom(code);
      if (!room || room.type !== 'tournament') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      const role = tournamentRoleOf(room, token);
      if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
      try {
        if (typeof subRoom === 'string') tournamentSetSubRoom(room, role, subRoom);
        if (winner) tournamentReport(room, role, winner);
      } catch (e) {
        const info = errorResponseInfo(e);
        await guardedSetRoom(code, room);
        return NextResponse.json({ error: info.code, message: info.message, view: { ...tournamentViewFor(room, role), chat: chatOf(room), chatRole: role } }, { status: info.status });
      }
      await guardedSetRoom(code, room);
      return NextResponse.json({ view: { ...tournamentViewFor(room, role), chat: chatOf(room), chatRole: role } });
    });
  } catch (e) {
    const info = errorResponseInfo(e);
    return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
  }
}
