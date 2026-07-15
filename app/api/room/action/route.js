import { NextResponse } from 'next/server';
import {
  viewFor,
  roleOf,
  actPitcherSubmit,
  actBatterSubmit,
  actChangePitcher,
  actPinchHit,
  actReadyNext,
  actSurrenderOffer,
  actSurrenderRespond,
  actPickoff,
  actDeclareSteal,
  enforceTimeouts,
} from '../../../../lib/gameLogic';
import { getRoom, storeReady, withRoomLock, assertCode } from '../../../../lib/store';
import { safeErrorCode, errorResponseInfo } from '../../../../lib/apiError';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE' }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }
  const { code, token, action, payload } = body || {};
  try {
    assertCode(code);
  } catch {
    return NextResponse.json({ error: 'BAD_CODE' }, { status: 400 });
  }
  if (typeof token !== 'string' || typeof action !== 'string') {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }

  try {
    return await withRoomLock(code, async ({ guardedSetRoom }) => {
      const room = await getRoom(code);
      if (!room) return NextResponse.json({ error: 'NOT_FOUND', message: '房間不存在或已過期' }, { status: 404 });
      const role = roleOf(room, token);
      if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
      if (!room.game) return NextResponse.json({ error: 'NOT_STARTED', message: '對手尚未加入' }, { status: 409 });

      // 先做超時判定：若該階段已超時被自動處理，晚到的操作會落入 WRONG_PHASE 由前端刷新
      const timedOut = enforceTimeouts(room);

      try {
        switch (action) {
          case 'pitcher_submit':
            actPitcherSubmit(room, role, payload);
            break;
          case 'batter_submit':
            actBatterSubmit(room, role, payload);
            break;
          case 'change_pitcher':
            actChangePitcher(room, role, payload?.idx);
            break;
          case 'pinch_hit':
            actPinchHit(room, role, payload?.benchIdx);
            break;
          case 'ready_next':
            actReadyNext(room, role);
            break;
          case 'surrender_offer':
            actSurrenderOffer(room, role);
            break;
          case 'surrender_respond':
            actSurrenderRespond(room, role, payload);
            break;
          case 'pickoff':
            actPickoff(room, role);
            break;
          case 'declare_steal':
            actDeclareSteal(room, role, payload);
            break;
          default:
            return NextResponse.json({ error: 'BAD_ACTION' }, { status: 400 });
        }
      } catch (e) {
        if (timedOut) await guardedSetRoom(code, room); // 超時判定的結果仍要保存
        return NextResponse.json({ error: safeErrorCode(e) }, { status: 409 });
      }

      await guardedSetRoom(code, room);
      return NextResponse.json({ view: viewFor(room, role) });
    });
  } catch (e) {
    const info = errorResponseInfo(e);
    return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
  }
}
