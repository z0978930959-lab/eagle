import { NextResponse } from 'next/server';
import { createRoom, viewFor } from '../../../../lib/gameLogic';
import { createBingoRoom, bingoViewFor } from '../../../../lib/bingoLogic';
import { gameByMode } from '../../../../lib/gameRegistry';
import { createRoomIfAbsent, storeReady, rateLimit } from '../../../../lib/store';
import { safeErrorCode, errorResponseInfo } from '../../../../lib/apiError';
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
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE', message: '尚未設定資料庫，請依 README 連接 Upstash Redis' }, { status: 500 });
  }

  const ip = clientIp(req);
  const minuteRl = await rateLimit('create-min', ip, 5, 60);
  const hourRl = await rateLimit('create-hr', ip, 20, 3600);
  if (!minuteRl.ok || !hourRl.ok) {
    return NextResponse.json({ error: 'RATE_LIMITED', message: '建房過於頻繁，請稍候再試' }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }
  const { innings, teamId, extraMode, mode, reveal, cor, players, seriesMode, difficulty, rounds } = body || {};

  const isBingo = mode === 'bingo';
  const game = gameByMode(mode); // 註冊表中的連線遊戲（splendor/mission/poker/ecard）
  const isBaseball = !isBingo && !game;

  if (isBaseball && (![1, 3].includes(innings) || typeof teamId !== 'string' || (extraMode && !['cpbl', 'tiebreak'].includes(extraMode)))) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }

  const validSeries = ['BO1', 'BO3', 'BO5'].includes(seriesMode) ? seriesMode : 'BO1';

  for (let i = 0; i < 30; i++) {
    const code = genCode();
    let room;
    try {
      if (game) {
        room = game.create({ code, players: players === 3 ? 3 : 2, seriesMode: validSeries, difficulty, rounds });
      } else if (isBingo) {
        room = createBingoRoom({ code, reveal: !!reveal });
      } else {
        room = createRoom({ code, innings, awayTeamId: teamId, extraMode, cor });
      }
    } catch (e) {
      return NextResponse.json({ error: safeErrorCode(e) }, { status: 400 });
    }

    try {
      if (await createRoomIfAbsent(code, room)) {
        let token, view;
        if (game) {
          token = room.tokens[game.hostSeat];
          view = game.viewFor(room, game.hostSeat);
        } else if (isBingo) {
          token = room.tokens.away;
          view = bingoViewFor(room, 'away');
        } else {
          token = room.tokens.away;
          view = viewFor(room, 'away');
        }
        return NextResponse.json({ code, token, view });
      }
    } catch (e) {
      const info = errorResponseInfo(e);
      return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
    }
  }

  return NextResponse.json({ error: 'CODE_POOL_BUSY', message: '房號暫時擁擠，請再試一次' }, { status: 503 });
}
