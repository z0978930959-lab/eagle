import { actSpTake, actSpBuy, actSpReserve, actSpDiscard, actSpNoble, actSpRematch, actSpCoin, splendorViewFor } from '../../../../lib/splendorLogic';
import { pushChat, chatOf } from '../../../../lib/chat';
import { actBingoChoose, actBingoRps, actBingoMark, actBingoAnnounce, actBingoDrawOffer, actBingoDrawRespond, bingoViewFor } from '../../../../lib/bingoLogic';
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
  actTaunt,
  actDeclareSqueeze,
  actDeclarePitchOut,
  actDeclareSteal,
  actForceRight,
  actRematch,
  enforceTimeouts,
} from '../../../../lib/gameLogic';
import { getRoom, storeReady, withRoomLock, assertCode } from '../../../../lib/store';
import { safeErrorCode, errorResponseInfo } from '../../../../lib/apiError';

export const dynamic = 'force-dynamic';

function withChat(view, room, role) {
  return { ...view, chat: chatOf(room), chatRole: role };
}

// 依房型挑對應的 viewFor
function viewOf(room, role) {
  if (room.type === 'splendor') return splendorViewFor(room, role);
  if (room.type === 'bingo') return bingoViewFor(room, role);
  return viewFor(room, role);
}

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

      // 聊天：三種房型共用，任何階段都能發言（含終局後）
      if (action === 'chat_send') {
        try {
          pushChat(room, role, payload?.text);
        } catch (e) {
          const info = errorResponseInfo(e);
          return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
        }
        await guardedSetRoom(code, room);
        return NextResponse.json({ view: withChat(viewOf(room, role), room, role) });
      }

      // 璀璨寶石房：伺服器端全權判定，前端只送意圖
      if (room.type === 'splendor') {
        if (!room.sp.players.home) return NextResponse.json({ error: 'NOT_STARTED', message: '對手尚未加入' }, { status: 409 });
        try {
          switch (action) {
            case 'sp_take':
              actSpTake(room, role, payload);
              break;
            case 'sp_buy':
              actSpBuy(room, role, payload);
              break;
            case 'sp_reserve':
              actSpReserve(room, role, payload);
              break;
            case 'sp_discard':
              actSpDiscard(room, role, payload);
              break;
            case 'sp_noble':
              actSpNoble(room, role, payload);
              break;
            case 'sp_coin':
              actSpCoin(room, role, payload);
              break;
            case 'sp_rematch':
              actSpRematch(room, role);
              break;
            default:
              return NextResponse.json({ error: 'BAD_ACTION' }, { status: 400 });
          }
        } catch (e) {
          const info = errorResponseInfo(e);
          return NextResponse.json(
            { error: info.code, message: info.message, view: withChat(splendorViewFor(room, role), room, role) },
            { status: info.status }
          );
        }
        await guardedSetRoom(code, room);
        return NextResponse.json({ view: withChat(splendorViewFor(room, role), room, role) });
      }

      // 賓果房：獨立的動作分派（無超時機制，輪到誰就等誰）
      if (room.type === 'bingo') {
        if (!room.bingo.players.home) return NextResponse.json({ error: 'NOT_STARTED', message: '對手尚未加入' }, { status: 409 });
        try {
          switch (action) {
            case 'bingo_choose':
              actBingoChoose(room, role, payload);
              break;
            case 'bingo_rps':
              actBingoRps(room, role, payload);
              break;
            case 'bingo_mark':
              actBingoMark(room, role, payload);
              break;
            case 'bingo_announce':
              actBingoAnnounce(room, role);
              break;
            case 'bingo_draw_offer':
              actBingoDrawOffer(room, role);
              break;
            case 'bingo_draw_respond':
              actBingoDrawRespond(room, role, payload);
              break;
            default:
              return NextResponse.json({ error: 'BAD_ACTION' }, { status: 400 });
          }
        } catch (e) {
          // BOARD_CLASH 會重抽選項（房間有變動），錯誤路徑也要先存檔再回應
          await guardedSetRoom(code, room);
          return NextResponse.json({ error: safeErrorCode(e), view: withChat(bingoViewFor(room, role), room, role) }, { status: 409 });
        }
        await guardedSetRoom(code, room);
        return NextResponse.json({ view: withChat(bingoViewFor(room, role), room, role) });
      }

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
            actSurrenderOffer(room, role, payload);
            break;
          case 'surrender_respond':
            actSurrenderRespond(room, role, payload);
            break;
          case 'taunt':
            actTaunt(room, role);
            break;
          case 'pickoff':
            actPickoff(room, role);
            break;
          case 'declare_squeeze':
            actDeclareSqueeze(room, role, payload);
            break;
          case 'declare_pitchout':
            actDeclarePitchOut(room, role, payload);
            break;
          case 'declare_steal':
            actDeclareSteal(room, role, payload);
            break;
          case 'force_right':
            actForceRight(room, role, payload);
            break;
          case 'rematch':
            actRematch(room, role);
            break;
          default:
            return NextResponse.json({ error: 'BAD_ACTION' }, { status: 400 });
        }
      } catch (e) {
        if (timedOut) await guardedSetRoom(code, room); // 超時判定的結果仍要保存
        return NextResponse.json({ error: safeErrorCode(e) }, { status: 409 });
      }

      await guardedSetRoom(code, room);
      return NextResponse.json({ view: withChat(viewFor(room, role), room, role) });
    });
  } catch (e) {
    const info = errorResponseInfo(e);
    return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
  }
}
