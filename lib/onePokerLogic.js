/* ------------------------------------------------------------------
 * 單張撲克．雙人心理對戰
 *
 * 牌組：52 張（去掉兩張鬼牌）。點數 2~14（11=J 12=Q 13=K 14=A），不看花色。
 * 大小：A > K > Q > J > 10 > … > 2
 * 特殊牌理：最小的「2」遇到最大的「A」時，2 擊敗 A（其餘一律照大小）
 *
 * 一場 20 回合，雙方各 30 籌碼。每回合：
 *   1. 雙方各持 2 張手牌 → 公開「Up(8~A)／Down(2~7)」組成給雙方看
 *   2. 各自秘密選出 1 張出戰
 *   3. 底注各 2 枚 → 先手 PASS 或加注 → 對手可跟注／再加注／棄牌
 *      （德州式往返加注，但單方本回合投入上限 7 枚 ＝ 底注 2 ＋ 加注 5）
 *   4. 開牌比大小（棄牌則雙方牌都不公開）
 *   5. 雙方確認後，打出的那張淘汰、各補抽 1 張，回到 2 張手牌
 *
 * 結束：20 回合打完比籌碼；中途一方籌碼歸零立即結束。
 * 先手：第 1 回合 A，之後每回合輪流。
 * 牌量：20 回合最多用 4 + 20×2 = 44 張，52 張牌足夠。
 * ------------------------------------------------------------------ */
import { putSticker, stickerView } from './stickers';

const LOG_MAX = 40;
export const OP_TOTAL_ROUNDS = 20;
export const OP_START_CHIPS = 30;
export const OP_ANTE = 2;
export const OP_MAX_COMMIT = 7; // 單方單回合投入上限（含底注）

const SUITS = ['s', 'h', 'd', 'c'];
export const RANK_LABEL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
const other = (s) => (s === 'a' ? 'b' : 'a');
const seatName = (s) => (s === 'a' ? '玩家 A' : '玩家 B');
function pushLog(op, text) {
  op.log.unshift({ text, ts: Date.now() });
  if (op.log.length > LOG_MAX) op.log.length = LOG_MAX;
}

/* ---------------- 牌組 ---------------- */

function buildDeck() {
  const deck = [];
  for (let r = 2; r <= 14; r++) for (const s of SUITS) deck.push({ r, s });
  return deck;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
/** Up = 8~A、Down = 2~7 */
export function isUp(card) {
  return card.r >= 8;
}
/** 手牌的 Up/Down 提示（雙方可見）：回傳 up 的張數 */
function upCount(hand) {
  return hand.filter(isUp).length;
}
/**
 * 比大小。回傳 1（x 勝）、-1（y 勝）、0（平手）。
 * 特殊牌理：2 遇 A 時 2 勝。
 */
export function compareCards(x, y) {
  if (x.r === 2 && y.r === 14) return 1;
  if (x.r === 14 && y.r === 2) return -1;
  if (x.r > y.r) return 1;
  if (x.r < y.r) return -1;
  return 0;
}
const cardText = (c) => (c ? RANK_LABEL[c.r] : '？');

/**
 * 依剩餘籌碼決定頭像分級（雙方可見）。
 *   0 < c ≤ 10 → panic（危急）
 *  10 < c ≤ 20 → tense（緊繃）
 *  20 < c < 40 → calm（平常，預設頭像）
 *  40 ≤ c < 50 → rich（優勢）
 *  50 ≤ c      → feast（大勝）
 */
export function avatarTier(chips) {
  if (chips <= 10) return 'panic';
  if (chips <= 20) return 'tense';
  if (chips < 40) return 'calm';
  if (chips < 50) return 'rich';
  return 'feast';
}

/* ---------------- 建房／加入 ---------------- */

export function createOnePokerRoom({ code }) {
  return {
    code,
    type: 'onepoker',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { a: randomToken(), b: null },
    chat: [],
    op: null,
  };
}
export function onePokerRoleOf(room, token) {
  if (!token) return null;
  if (room.tokens.a === token) return 'a';
  if (room.tokens.b && room.tokens.b === token) return 'b';
  return null;
}
export function joinOnePokerRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.b = randomToken();
  room.status = 'playing';
  startMatch(room);
  return { seat: 'b', token: room.tokens.b };
}

/* ---------------- 一場 ---------------- */

function startMatch(room) {
  const deck = shuffle(buildDeck());
  room.op = {
    phase: 'select', // select | bet | showdown | roundEnd | over
    round: 1,
    chips: { a: OP_START_CHIPS, b: OP_START_CHIPS },
    deck,
    hands: { a: [deck.pop(), deck.pop()], b: [deck.pop(), deck.pop()] },
    r: null,
    history: [],
    result: null, // 'a' | 'b' | 'draw'
    overReason: null,
    log: [],
    seq: 0,
    rematch: {},
  };
  pushLog(room.op, `🃏 單張撲克開始：各 ${OP_START_CHIPS} 枚籌碼，共 ${OP_TOTAL_ROUNDS} 回合`);
  startRound(room);
}

function startRound(room) {
  const op = room.op;
  const first = op.round % 2 === 1 ? 'a' : 'b'; // 第 1 回合 A 先，之後輪流

  // 籌碼不足底注時以剩餘全部當底注（all-in）
  const ante = { a: Math.min(OP_ANTE, op.chips.a), b: Math.min(OP_ANTE, op.chips.b) };
  op.chips.a -= ante.a;
  op.chips.b -= ante.b;

  op.r = {
    first,
    turn: first,
    startChips: { a: op.chips.a + ante.a, b: op.chips.b + ante.b }, // 底注扣款前的籌碼，結算時算淨增減用
    picked: { a: null, b: null }, // 出戰牌在手牌中的索引
    cards: { a: null, b: null }, // 出戰牌本身
    bet: { ...ante },
    passed: { a: false, b: false },
    lastRaiser: null,
    folded: null,
    tie: false,
    winner: null,
    pot: 0,
    delta: { a: 0, b: 0 },
    ready: { a: false, b: false },
  };
  op.phase = 'select';
  op.seq += 1;
  pushLog(op, `— 第 ${op.round} 回合 —　先手：${seatName(first)}（底注各 ${OP_ANTE}）`);
}

/* ---------------- 選牌 ---------------- */

// payload { index: 0|1 }
export function actOpPick(room, role, payload) {
  const op = room.op;
  if (!op || op.phase !== 'select') throw new Error('WRONG_PHASE');
  const idx = Number(payload?.index);
  if (![0, 1].includes(idx)) throw new Error('BAD_INPUT');
  const r = op.r;
  if (r.picked[role] !== null) throw new Error('ALREADY_PICKED');

  r.picked[role] = idx;
  r.cards[role] = op.hands[role][idx];
  op.seq += 1;

  if (r.picked.a !== null && r.picked.b !== null) {
    op.phase = 'bet';
    pushLog(op, `雙方已選牌，開始下注（${seatName(r.turn)} 先喊）`);
  }
}

/* ---------------- 下注 ---------------- */

/** 自己這回合還能再投入多少（受籌碼與 7 枚上限雙重限制） */
function maxCommitOf(op, seat) {
  const r = op.r;
  return Math.min(OP_MAX_COMMIT, r.bet[seat] + op.chips[seat]);
}

// payload { move: 'pass'|'call'|'raise'|'fold', to?: number }
export function actOpBet(room, role, payload) {
  const op = room.op;
  if (!op || op.phase !== 'bet') throw new Error('WRONG_PHASE');
  const r = op.r;
  if (r.turn !== role) throw new Error('NOT_YOUR_TURN');

  const opp = other(role);
  const move = payload?.move;
  const owed = r.bet[opp] - r.bet[role]; // 需要跟的差額

  if (move === 'fold') {
    if (owed <= 0) throw new Error('NOTHING_TO_FOLD'); // 沒被下注就不用棄牌，請用 PASS
    r.folded = role;
    finishRound(room);
    return;
  }

  if (move === 'pass') {
    if (owed > 0) throw new Error('MUST_CALL_OR_FOLD');
    r.passed[role] = true;
    op.seq += 1;
    if (r.passed.a && r.passed.b) {
      pushLog(op, `雙方 PASS，直接開牌`);
      finishRound(room);
      return;
    }
    r.turn = opp;
    pushLog(op, `${seatName(role)} PASS`);
    return;
  }

  if (move === 'call') {
    if (owed <= 0) throw new Error('NOTHING_TO_CALL');
    const pay = Math.min(owed, op.chips[role]); // 籌碼不足則 all-in，差額結算時退還
    op.chips[role] -= pay;
    r.bet[role] += pay;
    op.seq += 1;
    pushLog(op, `${seatName(role)} 跟注到 ${r.bet[role]}`);
    finishRound(room);
    return;
  }

  if (move === 'raise') {
    const to = Number(payload?.to);
    const cap = maxCommitOf(op, role);
    if (!Number.isInteger(to)) throw new Error('BAD_INPUT');
    if (to <= r.bet[opp]) throw new Error('RAISE_TOO_SMALL'); // 必須高於對手投入
    if (to > cap) throw new Error('RAISE_TOO_BIG'); // 超過 7 枚上限或籌碼不足
    const pay = to - r.bet[role];
    op.chips[role] -= pay;
    r.bet[role] = to;
    r.lastRaiser = role;
    r.passed = { a: false, b: false }; // 有人加注，PASS 紀錄重來
    r.turn = opp;
    op.seq += 1;
    pushLog(op, `${seatName(role)} 加注到 ${to}`);
    return;
  }

  throw new Error('BAD_INPUT');
}

/* ---------------- 結算一回合 ---------------- */

function finishRound(room) {
  const op = room.op;
  const r = op.r;

  // 投入不對等（有人 all-in 跟不完）→ 多出來的部分退還
  if (r.bet.a !== r.bet.b) {
    const big = r.bet.a > r.bet.b ? 'a' : 'b';
    const back = Math.abs(r.bet.a - r.bet.b);
    op.chips[big] += back;
    r.bet[big] -= back;
  }
  const pot = r.bet.a + r.bet.b;
  r.pot = pot;

  if (r.folded) {
    const win = other(r.folded);
    r.winner = win;
    op.chips[win] += pot;
    pushLog(op, `${seatName(r.folded)} 棄牌，${seatName(win)} 收下 ${pot} 枚（雙方牌不公開）`);
  } else {
    const cmp = compareCards(r.cards.a, r.cards.b);
    if (cmp === 0) {
      r.tie = true;
      op.chips.a += r.bet.a;
      op.chips.b += r.bet.b;
      pushLog(op, `平手（${cardText(r.cards.a)} vs ${cardText(r.cards.b)}），籌碼各自收回`);
    } else {
      const win = cmp > 0 ? 'a' : 'b';
      r.winner = win;
      op.chips[win] += pot;
      const special = (r.cards.a.r === 2 && r.cards.b.r === 14) || (r.cards.a.r === 14 && r.cards.b.r === 2);
      pushLog(op, `${cardText(r.cards.a)} vs ${cardText(r.cards.b)} → ${seatName(win)} 收下 ${pot} 枚${special ? '（2 吃 A！）' : ''}`);
    }
  }

  // 淨增減以「本回合開打前的籌碼」為基準（底注也算在內）
  r.delta = { a: op.chips.a - r.startChips.a, b: op.chips.b - r.startChips.b };

  op.history.push({
    round: op.round,
    first: r.first,
    folded: r.folded,
    tie: r.tie,
    winner: r.winner,
    bet: { ...r.bet },
    pot,
    // 棄牌局不公開任何一方的牌，視野層會只回傳自己的那張
    cards: { a: r.cards.a, b: r.cards.b },
    delta: { ...r.delta },
    chips: { ...op.chips },
  });

  op.phase = r.folded ? 'roundEnd' : 'showdown'; // 有開牌就先停在翻牌畫面
  op.seq += 1;
}

// 翻牌動畫看完／棄牌看完 → 雙方確認進下一回合
export function actOpNextRound(room, role) {
  const op = room.op;
  if (!op || !['showdown', 'roundEnd'].includes(op.phase)) throw new Error('WRONG_PHASE');
  const r = op.r;
  if (r.ready[role]) return; // idempotent
  r.ready[role] = true;
  op.phase = 'roundEnd';
  op.seq += 1;
  if (!(r.ready.a && r.ready.b)) return;

  // 打出的那張淘汰，各補抽 1 張
  for (const seat of ['a', 'b']) {
    const idx = r.picked[seat];
    if (idx !== null) op.hands[seat].splice(idx, 1);
    if (op.deck.length) op.hands[seat].push(op.deck.pop());
  }

  // 結束條件
  if (op.chips.a <= 0 || op.chips.b <= 0) {
    finishMatch(room, op.chips.a <= 0 ? 'b' : 'a', 'bust');
    return;
  }
  if (op.round >= OP_TOTAL_ROUNDS) {
    const res = op.chips.a === op.chips.b ? 'draw' : op.chips.a > op.chips.b ? 'a' : 'b';
    finishMatch(room, res, 'rounds');
    return;
  }
  op.round += 1;
  startRound(room);
}

function finishMatch(room, result, reason) {
  const op = room.op;
  op.phase = 'over';
  op.result = result;
  op.overReason = reason;
  op.seq += 1;
  if (reason === 'bust') pushLog(op, `💥 ${seatName(other(result))} 籌碼歸零，${seatName(result)} 獲勝`);
  else if (result === 'draw') pushLog(op, `🏁 ${OP_TOTAL_ROUNDS} 回合結束，籌碼相同——平手`);
  else pushLog(op, `🏁 ${OP_TOTAL_ROUNDS} 回合結束，${seatName(result)} 以 ${op.chips[result]} 枚獲勝`);
}

export function actOpRematch(room, role) {
  const op = room.op;
  if (!op || op.phase !== 'over') throw new Error('WRONG_PHASE');
  op.rematch = op.rematch || {};
  op.rematch[role] = true;
  if (op.rematch.a && op.rematch.b) startMatch(room);
}

/* ---------------- 貼圖（沿用 17 撲克的 10 張） ---------------- */

const OP_STICKERS = ['taunt_1', 'taunt_2', 'taunt_3', 'taunt_4', 'taunt_5', 'taunt_6', 'taunt_7', 'taunt_8', 'taunt_9', 'taunt_10'];

export function actOpSticker(room, role, payload) {
  if (!room.op) throw new Error('NOT_STARTED');
  const name = payload?.name;
  if (!OP_STICKERS.includes(name)) throw new Error('BAD_INPUT');
  putSticker(room, role, name);
}

/* ---------------- 視野 ---------------- */

export function onePokerViewFor(room, role) {
  const op = room.op;
  const opp = other(role);
  const base = {
    type: 'onepoker',
    code: room.code,
    status: room.status,
    role,
    oppJoined: !!room.tokens.b,
    totalRounds: OP_TOTAL_ROUNDS,
    maxCommit: OP_MAX_COMMIT,
    ante: OP_ANTE,
  };
  if (!op) return { ...base, phase: 'waiting' };

  const r = op.r;
  const revealed = op.phase === 'showdown' || op.phase === 'roundEnd' || op.phase === 'over';
  const showCards = revealed && !r.folded; // 棄牌局雙方牌都不公開

  const view = {
    ...base,
    phase: op.phase,
    round: op.round,
    seq: op.seq,
    chips: { me: op.chips[role], opp: op.chips[opp] },
    avatars: { me: avatarTier(op.chips[role]), opp: avatarTier(op.chips[opp]) },
    // 手牌：自己看得到牌面，對手只公開 Up/Down 組成
    myHand: op.hands[role].map((c) => ({ ...c })),
    myUp: upCount(op.hands[role]),
    oppUp: upCount(op.hands[opp]),
    oppHandCount: op.hands[opp].length,
    deckLeft: op.deck.length,
    result: op.result,
    resultName: op.result && op.result !== 'draw' ? seatName(op.result) : null,
    iWon: op.result === role,
    overReason: op.overReason,
    stickers: stickerView(room),
    log: op.log,
    // 對局紀錄：棄牌局只看得到自己的那張牌
    history: op.history.map((h) => ({
      round: h.round,
      folded: h.folded,
      iFolded: h.folded === role,
      tie: h.tie,
      iWon: h.winner === role,
      winner: h.winner,
      pot: h.pot,
      delta: h.delta[role],
      chipsMe: h.chips[role],
      chipsOpp: h.chips[opp],
      myCard: h.cards[role] ? { ...h.cards[role] } : null,
      oppCard: !h.folded && h.cards[opp] ? { ...h.cards[opp] } : null,
    })),
  };

  view.r = {
    first: r.first,
    iAmFirst: r.first === role,
    turn: r.turn,
    myTurn: op.phase === 'bet' && r.turn === role,
    myPickIndex: r.picked[role],
    oppPicked: r.picked[opp] !== null,
    myCard: r.cards[role] ? { ...r.cards[role] } : null,
    oppCard: showCards && r.cards[opp] ? { ...r.cards[opp] } : null,
    bet: { me: r.bet[role], opp: r.bet[opp] },
    owed: Math.max(0, r.bet[opp] - r.bet[role]),
    maxRaise: Math.min(OP_MAX_COMMIT, r.bet[role] + op.chips[role]),
    canPass: op.phase === 'bet' && r.turn === role && r.bet[opp] === r.bet[role],
    passedOpp: r.passed[opp],
    folded: r.folded,
    iFolded: r.folded === role,
    tie: r.tie,
    winner: r.winner,
    iWonRound: r.winner === role,
    pot: r.pot,
    delta: r.delta[role],
    revealed,
    showCards,
    ready: { me: r.ready[role], opp: r.ready[opp] },
  };
  return view;
}
