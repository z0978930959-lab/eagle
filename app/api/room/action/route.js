import { pushChat, chatOf } from '../../../../lib/chat';
import { actBingoChoose, actBingoRps, actBingoMark, actBingoAnnounce, actBingoDrawOffer, actBingoDrawRespond, bingoViewFor } from '../../../../lib/bingoLogic';
import { gameByRoom } from '../../../../lib/gameRegistry';
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

// 依房型挑對應的 viewFor（註冊表遊戲走 registry，其餘走專用）
function viewOf(room, role) {
  const game = gameByRoom(room);
  if (game) return game.viewFor(room, role);
  if (room.type === 'bingo') return bingoViewFor(room, role);
  return viewFor(room, role);
}

// 註冊表遊戲：是否全員到齊、可以行動
function allPlayersReady(room) {
  if (room.type === 'splendor') return room.sp.seats.every((st) => room.tokens[st]);
  // mission/poker/ecard：雙人，b 有 token 即到齊
  return !!room.tokens.b;
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

      const game = gameByRoom(room);
      const role = game ? game.roleOf(room, token) : roleOf(room, token);
      if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      // 聊天：所有房型共用，任何階段都能發言
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

      // 註冊表遊戲（璀璨寶石/密語連線/17撲克/E卡）：統一分派
      if (game) {
        if (!allPlayersReady(room)) {
          return NextResponse.json({ error: 'NOT_STARTED', message: '還在等其他玩家加入' }, { status: 409 });
        }
        const handler = game.actions[action];
        if (!handler) return NextResponse.json({ error: 'BAD_ACTION' }, { status: 400 });
        try {
          handler(room, role, payload);
        } catch (e) {
          const info = errorResponseInfo(e);
          return NextResponse.json(
            { error: info.code, message: info.message, view: withChat(game.viewFor(room, role), room, role) },
            { status: info.status }
          );
        }
        await guardedSetRoom(code, room);
        return NextResponse.json({ view: withChat(game.viewFor(room, role), room, role) });
      }

      // 賓果房：獨立的動作分派
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
          await guardedSetRoom(code, room);
          return NextResponse.json({ error: safeErrorCode(e), view: withChat(bingoViewFor(room, role), room, role) }, { status: 409 });
        }
        await guardedSetRoom(code, room);
        return NextResponse.json({ view: withChat(bingoViewFor(room, role), room, role) });
      }

      if (!room.game) return NextResponse.json({ error: 'NOT_STARTED', message: '對手尚未加入' }, { status: 409 });

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
        if (timedOut) await guardedSetRoom(code, room);
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
