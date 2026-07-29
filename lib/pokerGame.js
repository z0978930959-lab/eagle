/* ------------------------------------------------------------------
 * 17 張撲克．對戰流程
 *
 * 接上 pokerLogic 的牌型引擎，處理：發牌、下注、換牌、all-in、
 * 破產出局、6 回合、真正平手（下注各自拿回）。
 *
 * 一場：雙方各 100 枚，6 回合。每回合流程：
 *   1. 各下底注 5（不足 5 → 出局）
 *   2. 各發 5 張
 *   3. 下注階段一：1~10（或 all-in 剩餘全部）
 *   4. 換牌（該回合先手先換；後換方受牌庫剩量限制；換幾張對方看得到）
 *   5. 下注階段二：1~15
 *   6. 對方可 棄牌 / 跟注 / 加注
 *   7. 無人棄牌 → 開牌比大小
 *
 * 換牌先手：6 回合 A/B 交替（回合 1 A 先、回合 2 B 先…）
 * ------------------------------------------------------------------ */

import { buildDeck, evaluateHand, compareScore, HAND_NAME } from './pokerLogic';

const LOG_MAX = 40;
const START_CHIPS = 100;
const ANTE = 5;
const TOTAL_ROUNDS = 6;
const BET1_MAX = 10;
const BET2_MAX = 15;

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function randInt(n) {
  if (globalThis.crypto?.getRandomValues) {
    const b = new Uint32Array(1);
    globalThis.crypto.getRandomValues(b);
    return b[0] % n;
  }
  return Math.floor(Math.random() * n);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pushLog(pk, text) {
  pk.log.unshift({ text, ts: Date.now() });
  if (pk.log.length > LOG_MAX) pk.log.length = LOG_MAX;
}

const other = (s) => (s === 'a' ? 'b' : 'a');
const seatName = (s) => (s === 'a' ? '玩家 A' : '玩家 B');

/* ---------------- 建房／加入 ---------------- */

export function createPokerRoom({ code, seriesMode = 'BO1' }) {
  return {
    code,
    type: 'poker',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { a: randomToken(), b: null },
    chat: [],
    series: makeSeries(seriesMode),
    pk: null, // 對局狀態，雙方到齊才開第一場
  };
}

function makeSeries(mode) {
  const need = mode === 'BO5' ? 3 : mode === 'BO3' ? 2 : 1;
  return { mode, need, wins: { a: 0, b: 0 }, gameNo: 0, over: false, champion: null };
}

export function pokerRoleOf(room, token) {
  if (!token) return null;
  if (room.tokens.a === token) return 'a';
  if (room.tokens.b && room.tokens.b === token) return 'b';
  return null;
}

export function joinPokerRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.b = randomToken();
  room.status = 'playing';
  startGame(room);
  return { seat: 'b', token: room.tokens.b };
}

/* ---------------- 一場的開始 ---------------- */

function startGame(room) {
  room.series.gameNo += 1;
  room.pk = {
    phase: 'round', // round | showdown | gameover
    chips: { a: START_CHIPS, b: START_CHIPS },
    round: 0,
    firstDrawer: 'a', // 該回合換牌先手
    result: null, // 一場結束：'a' | 'b' | null(平局場，理論不發生)
    bustLoser: null,
    log: [],
    seq: 0,
    r: null, // 當前回合狀態
  };
  pushLog(room.pk, `🃏 第 ${room.series.gameNo} 場開始（${room.series.mode}）`);
  startRound(room);
}

function startRound(room) {
  const pk = room.pk;

  // 回合前檢查：任一方不足底注 → 出局，一場結束
  for (const s of ['a', 'b']) {
    if (pk.chips[s] < ANTE) {
      pk.phase = 'gameover';
      pk.result = other(s);
      pk.bustLoser = s;
      pushLog(pk, `💸 ${seatName(s)} 籌碼不足底注，出局——${seatName(other(s))} 贏得此場`);
      settleGame(room);
      return;
    }
  }

  if (pk.round >= TOTAL_ROUNDS) {
    // 6 回合打完，比總籌碼
    pk.phase = 'gameover';
    if (pk.chips.a !== pk.chips.b) pk.result = pk.chips.a > pk.chips.b ? 'a' : 'b';
    else pk.result = null; // 平局場（少見）
    pushLog(pk, `🏁 六回合結束（A ${pk.chips.a} / B ${pk.chips.b}）`);
    settleGame(room);
    return;
  }

  pk.round += 1;
  // 收底注
  pk.chips.a -= ANTE;
  pk.chips.b -= ANTE;

  const deck = shuffle(buildDeck());
  const hands = { a: deck.splice(0, 5), b: deck.splice(0, 5) };

  const firstDrawer = pk.round % 2 === 1 ? 'a' : 'b'; // 回合 1,3,5 → A 先；2,4,6 → B 先
  pk.firstDrawer = firstDrawer;

  pk.r = {
    deck,
    hands,
    pot: ANTE * 2,
    bets: { a: 0, b: 0 }, // 本回合各自已投入（不含底注）
    stage: 'bet1', // bet1 | draw | bet2 | decide | done
    toAct: firstDrawer, // 下注/換牌由誰先動
    acted: { a: false, b: false }, // 本下注階段是否已行動過
    drawn: { a: null, b: null }, // 各自換了幾張（null=尚未換）
    folded: null,
  };
  pushLog(pk, `— 第 ${pk.round} 回合 —　（${seatName(firstDrawer)} 先手）`);
  pk.seq += 1;
}

/* ---------------- 下注 ---------------- */

function maxRaise(pk, s, cap) {
  // 加注上限：不超過該階段上限，且不超過自己剩餘籌碼（all-in）
  return Math.min(cap, pk.chips[s]);
}

// 下注動作：payload { move:'check'|'bet'|'call'|'raise'|'fold', amount }
export function actPokerBet(room, role, payload) {
  const pk = room.pk;
  if (room.status !== 'playing' || !pk || pk.phase !== 'round') throw new Error('WRONG_PHASE');
  const r = pk.r;
  if (r.stage !== 'bet1' && r.stage !== 'bet2') throw new Error('WRONG_PHASE');
  if (r.toAct !== role) throw new Error('NOT_YOUR_TURN');

  const cap = r.stage === 'bet1' ? BET1_MAX : BET2_MAX;
  const opp = other(role);
  const move = payload?.move;
  const toCall = r.bets[opp] - r.bets[role]; // 需跟的差額

  if (move === 'fold') {
    r.folded = role;
    r.stage = 'done';
    endRoundByFold(room, role);
    return;
  }

  if (move === 'check') {
    if (toCall !== 0) throw new Error('MUST_CALL'); // 有注在身不能過牌
    r.acted[role] = true;
    if (r.acted[opp]) return closeStage(room); // 雙方都行動且無差額 → 結束本階段
    r.toAct = opp;
    pk.seq += 1;
    return;
  }

  if (move === 'call') {
    if (toCall <= 0) throw new Error('NOTHING_TO_CALL');
    const pay = Math.min(toCall, pk.chips[role]); // 不足則 all-in 跟
    pk.chips[role] -= pay;
    r.bets[role] += pay;
    r.pot += pay;
    r.acted[role] = true;
    return closeStage(room); // 跟注 → 結束本階段
  }

  if (move === 'bet' || move === 'raise') {
    const amount = Number(payload?.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('BAD_INPUT');
    // 加注量上限 = 該階段上限（bet1=10 / bet2=15），且先補跟注差額後不得超過剩餘籌碼。
    // 籌碼不足時，加注量最多就是剩下的全部（自然形成 all-in），不另開特例。
    const chipsAfterCall = pk.chips[role] - Math.max(0, toCall);
    if (chipsAfterCall <= 0) throw new Error('NOT_ENOUGH_CHIPS'); // 連跟都不夠，不能加注
    const raiseCap = Math.min(cap, chipsAfterCall);
    if (amount > raiseCap) throw new Error('OVER_CAP');
    const pay = Math.max(0, toCall) + amount;
    pk.chips[role] -= pay;
    r.bets[role] += pay;
    r.pot += pay;
    r.acted[role] = true;
    r.acted[opp] = false; // 對方需重新回應
    r.toAct = opp;
    pk.seq += 1;
    return;
  }

  throw new Error('BAD_INPUT');
}

function closeStage(room) {
  const pk = room.pk;
  const r = pk.r;
  r.acted = { a: false, b: false };
  if (r.stage === 'bet1') {
    r.stage = 'draw';
    r.toAct = pk.firstDrawer;
    pushLog(pk, '— 進入換牌 —');
  } else if (r.stage === 'bet2') {
    r.stage = 'showdown';
    doShowdown(room);
  }
  pk.seq += 1;
}

/* ---------------- 換牌 ---------------- */

// 換牌：payload { discards: [手牌索引...] }（可空陣列＝不換）
export function actPokerDraw(room, role, payload) {
  const pk = room.pk;
  if (!pk || pk.phase !== 'round' || pk.r.stage !== 'draw') throw new Error('WRONG_PHASE');
  const r = pk.r;
  if (r.toAct !== role) throw new Error('NOT_YOUR_TURN');
  if (r.drawn[role] !== null) throw new Error('ALREADY_DREW');

  const discards = Array.isArray(payload?.discards) ? [...new Set(payload.discards)] : [];
  if (discards.some((i) => !Number.isInteger(i) || i < 0 || i > 4)) throw new Error('BAD_INPUT');

  // 換牌數受牌庫剩量限制（先換方先抽，後換方只能換剩下的）
  const canDraw = Math.min(discards.length, r.deck.length);
  const actualDiscards = discards.slice(0, canDraw);

  const hand = r.hands[role];
  // 丟棄選定的牌，補新牌
  const kept = hand.filter((_, i) => !actualDiscards.includes(i));
  const fresh = r.deck.splice(0, actualDiscards.length);
  r.hands[role] = [...kept, ...fresh];
  r.drawn[role] = actualDiscards.length; // 換了幾張（公開）

  pushLog(pk, `🔄 ${seatName(role)} 換 ${actualDiscards.length} 張`);
  pk.seq += 1;

  const opp = other(role);
  if (r.drawn[opp] === null) {
    r.toAct = opp; // 換對方換牌
  } else {
    // 雙方都換完 → 進入第二次下注
    r.stage = 'bet2';
    r.toAct = pk.firstDrawer;
    r.acted = { a: false, b: false };
    pushLog(pk, '— 第二次下注 —');
  }
}

/* ---------------- 結算 ---------------- */

function endRoundByFold(room, folder) {
  const pk = room.pk;
  const r = pk.r;
  const winner = other(folder);
  pk.chips[winner] += r.pot;
  pushLog(pk, `🏳️ ${seatName(folder)} 棄牌——${seatName(winner)} 收下底池 ${r.pot}`);
  pk.seq += 1;
  startRound(room);
}

function doShowdown(room) {
  const pk = room.pk;
  const r = pk.r;
  const sa = evaluateHand(r.hands.a);
  const sb = evaluateHand(r.hands.b);
  const cmp = compareScore(sa, sb);

  r.reveal = { a: { hand: r.hands.a, score: sa }, b: { hand: r.hands.b, score: sb } };

  if (cmp === 0) {
    // 真正平手：下注各自拿回（含底注）
    pk.chips.a += ANTE + r.bets.a;
    pk.chips.b += ANTE + r.bets.b;
    pushLog(pk, `🤝 平手（雙方 ${sa.name}）——下注各自拿回`);
  } else {
    const winner = cmp > 0 ? 'a' : 'b';
    pk.chips[winner] += r.pot;
    pushLog(pk, `🎴 開牌：A ${sa.name} vs B ${sb.name} → ${seatName(winner)} 勝，收 ${r.pot}`);
  }
  pk.seq += 1;
  r.stage = 'done';
  startRound(room);
}

/* ---------------- 一場結束、系列賽推進 ---------------- */

function settleGame(room) {
  const pk = room.pk;
  const series = room.series;
  if (pk.result) {
    series.wins[pk.result] += 1;
    if (series.wins[pk.result] >= series.need) {
      series.over = true;
      series.champion = pk.result;
      pushLog(pk, `🏆 ${seatName(pk.result)} 贏得系列賽（${series.wins.a}:${series.wins.b}）`);
    }
  }
}

// 下一場（雙方都按才開）
export function actPokerNextGame(room, role) {
  const pk = room.pk;
  if (!pk || pk.phase !== 'gameover') throw new Error('WRONG_PHASE');
  if (room.series.over) throw new Error('SERIES_OVER');
  pk.nextReady = pk.nextReady || {};
  pk.nextReady[role] = true;
  if (pk.nextReady.a && pk.nextReady.b) startGame(room);
}

// 系列賽結束後重開一輪系列
export function actPokerRematch(room, role) {
  if (!room.series.over) throw new Error('WRONG_PHASE');
  room.pk.rematch = room.pk.rematch || {};
  room.pk.rematch[role] = true;
  if (room.pk.rematch.a && room.pk.rematch.b) {
    room.series = makeSeries(room.series.mode);
    startGame(room);
  }
}

/* ---------------- 視野 ---------------- */

export function pokerViewFor(room, role) {
  const pk = room.pk;
  const series = room.series;
  const opp = other(role);

  const base = {
    type: 'poker',
    code: room.code,
    status: room.status,
    role,
    series: {
      mode: series.mode,
      need: series.need,
      wins: { ...series.wins },
      gameNo: series.gameNo,
      over: series.over,
      champion: series.champion,
      // 生死局：再一勝就結束（BO3 1:1、BO5 2:2）
      matchPoint: !series.over && series.wins[role] === series.need - 1 && series.wins[opp] === series.need - 1,
    },
    oppJoined: !!room.tokens.b,
  };

  if (!pk) return { ...base, phase: 'waiting' };

  const r = pk.r;
  const view = {
    ...base,
    phase: pk.phase,
    chips: { me: pk.chips[role], opp: pk.chips[opp] },
    round: pk.round,
    totalRounds: TOTAL_ROUNDS,
    result: pk.result,
    resultName: pk.result ? seatName(pk.result) : null,
    iWon: pk.result === role,
    log: pk.log,
    seq: pk.seq,
  };

  if (r) {
    const showdownOn = pk.phase === 'round' && r.reveal;
    view.round_state = {
      stage: r.stage,
      pot: r.pot,
      toAct: r.toAct,
      myTurn: r.toAct === role && (r.stage === 'bet1' || r.stage === 'bet2' || r.stage === 'draw'),
      bets: { me: r.bets[role], opp: r.bets[opp] },
      toCall: Math.max(0, r.bets[opp] - r.bets[role]),
      firstDrawer: pk.firstDrawer,
      drawn: { me: r.drawn[role], opp: r.drawn[opp] }, // 換了幾張，雙方可見
      myHandCount: r.hands[role].length,
      oppHandCount: r.hands[opp].length,
      betCaps: { bet1: BET1_MAX, bet2: BET2_MAX },
      deckLeft: r.deck.length,
      // 自己的手牌永遠可見；對手手牌只有開牌後可見
      myHand: r.hands[role],
      oppHand: r.reveal ? r.hands[opp] : null,
      reveal: r.reveal
        ? {
            me: { hand: r.reveal[role].hand, name: r.reveal[role].score.name },
            opp: { hand: r.reveal[opp].hand, name: r.reveal[opp].score.name },
          }
        : null,
    };
  }
  return view;
}

export { HAND_NAME };
