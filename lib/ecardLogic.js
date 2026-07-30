/* ------------------------------------------------------------------
 * E 卡．雙人心理對戰（加分制，無破產）
 *
 * 三角色循環相剋：皇帝 > 市民、市民 > 奴隸、奴隸 > 皇帝
 *   皇帝方牌組：1 皇帝 + 4 市民
 *   奴隸方牌組：1 奴隸 + 4 市民
 *
 * 一場 6 回合，攻守來回輪替（雙方各主導 3 次）。每回合：
 *   1. 主導方選當皇帝方或奴隸方
 *   2. 定注：主導方自己主導的前 2 次由自己定(1~10)，第 3 次由對方定(1~30)
 *   3. 逐輪出牌：奴隸方先出、皇帝方後應（先手每輪交替）
 *      奴隸vs皇帝→奴隸方勝；皇帝vs市民→皇帝方勝；奴隸vs市民→皇帝方勝；
 *      市民vs市民→平手續下一輪
 *   4. 勝方得「注 × 賠率」分（奴隸方 5 倍、皇帝方 1 倍）
 *   5. 六回合累計總分，高者勝（純加分，無扣分無出局）
 *
 * 呈現需求（給前端）：牌桌可見雙方手牌背與換序、翻牌慢後快。
 * ------------------------------------------------------------------ */
import { putSticker, stickerView } from './stickers';

const LOG_MAX = 40;
const TOTAL_ROUNDS = 6;
const MAX_TRICKS = 5; // 每回合最多 5 輪（手牌 5 張）
const ODDS = { slave: 5, emperor: 1 }; // 賠率

// 卡片角色
const CITIZEN = 'citizen';
const EMPEROR = 'emperor';
const SLAVE = 'slave';

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function pushLog(ec, text) {
  ec.log.unshift({ text, ts: Date.now() });
  if (ec.log.length > LOG_MAX) ec.log.length = LOG_MAX;
}
const other = (s) => (s === 'a' ? 'b' : 'a');
const seatName = (s) => (s === 'a' ? '玩家 A' : '玩家 B');

/* ---------------- 建房／加入 ---------------- */

export function createEcardRoom({ code, seriesMode = 'BO1' }) {
  return {
    code,
    type: 'ecard',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { a: randomToken(), b: null },
    chat: [],
    series: makeSeries(seriesMode),
    ec: null,
  };
}
function makeSeries(mode) {
  const need = mode === 'BO5' ? 3 : mode === 'BO3' ? 2 : 1;
  return { mode, need, wins: { a: 0, b: 0 }, gameNo: 0, over: false, champion: null };
}
export function ecardRoleOf(room, token) {
  if (!token) return null;
  if (room.tokens.a === token) return 'a';
  if (room.tokens.b && room.tokens.b === token) return 'b';
  return null;
}
export function joinEcardRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.b = randomToken();
  room.status = 'playing';
  startGame(room);
  return { seat: 'b', token: room.tokens.b };
}

/* ---------------- 一場 ---------------- */

// 6 回合的「主導方」序列：A B A B A B（雙方各主導 3 次）
function leaderOfRound(roundIdx /*0-based*/) {
  return roundIdx % 2 === 0 ? 'a' : 'b';
}

// 該主導方這是他第幾次主導（1..3）→ 決定誰定注
function leaderTurnNumber(roundIdx) {
  return Math.floor(roundIdx / 2) + 1; // round 0,1→1; 2,3→2; 4,5→3
}

function startGame(room) {
  room.series.gameNo += 1;
  room.ec = {
    phase: 'chooseRole', // chooseRole | setStake | play | roundEnd | gameover
    round: 0, // 0-based
    scores: { a: 0, b: 0 },
    result: null,
    log: [],
    seq: 0,
    r: null,
  };
  pushLog(room.ec, `🎴 第 ${room.series.gameNo} 場開始（${room.series.mode}）`);
  startRound(room);
}

function startRound(room) {
  const ec = room.ec;
  if (ec.round >= TOTAL_ROUNDS) {
    ec.phase = 'gameover';
    if (ec.scores.a !== ec.scores.b) ec.result = ec.scores.a > ec.scores.b ? 'a' : 'b';
    else ec.result = null; // 平局場
    pushLog(ec, `🏁 六回合結束（A ${ec.scores.a} / B ${ec.scores.b}）`);
    settleGame(room);
    return;
  }

  const leader = leaderOfRound(ec.round);
  const turnNo = leaderTurnNumber(ec.round);
  // 定注方：主導方前 2 次自己定(1~10)、第 3 次對方定(1~30)
  const stakeSetter = turnNo <= 2 ? leader : other(leader);
  const stakeMax = turnNo <= 2 ? 10 : 30;

  ec.r = {
    leader,
    turnNo,
    stakeSetter,
    stakeMax,
    stake: null,
    emperorSide: null, // 哪一方當皇帝
    slaveSide: null,
    hands: null, // { a:[...], b:[...] } 角色陣列
    order: { a: null, b: null }, // 各自的手牌排序（索引）— 供換序呈現
    trick: 0, // 第幾輪（0-based）
    firstPlayer: null, // 本輪先出方（奴隸方先，之後每輪交替）
    played: { a: null, b: null }, // 本輪雙方出的牌（角色）
    winner: null,
  };
  ec.phase = 'chooseRole';
  pushLog(ec, `— 第 ${ec.round + 1} 回合 —　主導：${seatName(leader)}（第 ${turnNo} 次）`);
  ec.seq += 1;
}

// 主導方選角色：payload { side:'emperor'|'slave' }
export function actEcardChooseRole(room, role, payload) {
  const ec = room.ec;
  if (!ec || ec.phase !== 'chooseRole') throw new Error('WRONG_PHASE');
  const r = ec.r;
  if (role !== r.leader) throw new Error('NOT_YOUR_TURN');
  const side = payload?.side;
  if (side !== 'emperor' && side !== 'slave') throw new Error('BAD_INPUT');

  const emperorSide = side === 'emperor' ? role : other(role);
  const slaveSide = other(emperorSide);
  r.emperorSide = emperorSide;
  r.slaveSide = slaveSide;

  // 發牌：皇帝方 1皇帝+4市民、奴隸方 1奴隸+4市民
  r.hands = {
    [emperorSide]: shuffleHand([EMPEROR, CITIZEN, CITIZEN, CITIZEN, CITIZEN]),
    [slaveSide]: shuffleHand([SLAVE, CITIZEN, CITIZEN, CITIZEN, CITIZEN]),
  };
  r.order = { a: [0, 1, 2, 3, 4], b: [0, 1, 2, 3, 4] };
  r.firstPlayer = slaveSide; // 奴隸方先出
  ec.phase = 'setStake';
  pushLog(ec, `${seatName(role)} 選擇當${side === 'emperor' ? '皇帝' : '奴隸'}方`);
  ec.seq += 1;
}

function shuffleHand(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 定注：payload { stake }
export function actEcardSetStake(room, role, payload) {
  const ec = room.ec;
  if (!ec || ec.phase !== 'setStake') throw new Error('WRONG_PHASE');
  const r = ec.r;
  if (role !== r.stakeSetter) throw new Error('NOT_YOUR_TURN');
  const stake = Number(payload?.stake);
  if (!Number.isInteger(stake) || stake < 1 || stake > r.stakeMax) throw new Error('BAD_INPUT');
  r.stake = stake;
  ec.phase = 'play';
  ec.r.trick = 0;
  ec.r.firstPlayer = r.slaveSide;
  pushLog(ec, `💰 本回合注額 ${stake}（${seatName(r.stakeSetter)} 決定）`);
  ec.seq += 1;
}

/* ---------------- 換手牌順序（純呈現，供對方看到牌背移動）---------------- */

// payload { order:[5 個索引的排列] }
export function actEcardReorder(room, role, payload) {
  const ec = room.ec;
  if (!ec || ec.phase !== 'play') throw new Error('WRONG_PHASE');
  const r = ec.r;
  const order = payload?.order;
  if (!Array.isArray(order) || order.length !== 5) throw new Error('BAD_INPUT');
  const sorted = [...order].sort((a, b) => a - b);
  if (sorted.some((v, i) => v !== i)) throw new Error('BAD_INPUT'); // 必須是 0-4 的排列
  r.order[role] = order.slice();
  ec.seq += 1;
}

/* ---------------- 出牌與逐輪判定 ---------------- */

// 出牌：payload { cardIndex } —— 依當前手牌陣列的索引
export function actEcardPlay(room, role, payload) {
  const ec = room.ec;
  if (!ec || ec.phase !== 'play') throw new Error('WRONG_PHASE');
  const r = ec.r;

  // 本輪先出方先出、後手方後出
  const isFirst = r.played[r.firstPlayer] === null;
  const expected = isFirst ? r.firstPlayer : other(r.firstPlayer);
  if (role !== expected) throw new Error('NOT_YOUR_TURN');
  if (r.played[role] !== null) throw new Error('ALREADY_PLAYED');

  const ci = payload?.cardIndex;
  const hand = r.hands[role];
  if (!Number.isInteger(ci) || ci < 0 || ci >= hand.length) throw new Error('BAD_INPUT');

  const card = hand[ci];
  r.played[role] = card;
  // 從手牌移除（保持 order 有效：改記錄「已出」數，前端用剩餘張數呈現）
  r.hands[role] = hand.filter((_, i) => i !== ci);
  r.order[role] = [...Array(r.hands[role].length).keys()];
  ec.seq += 1;

  if (isFirst) {
    pushLog(ec, `${seatName(role)} 先出一張（蓋牌）`);
    return; // 等後手出
  }

  // 雙方都出了 → 判定本輪
  resolveTrick(room);
}

function resolveTrick(room) {
  const ec = room.ec;
  const r = ec.r;
  const emp = r.emperorSide;
  const slv = r.slaveSide;
  const empCard = r.played[emp];
  const slvCard = r.played[slv];

  let roundWinner = null; // 'emperor' | 'slave' | null(平手續)

  // 相剋判定（只在皇帝/奴隸方視角）
  // 皇帝 vs 市民 → 皇帝勝；奴隸 vs 皇帝 → 奴隸勝；奴隸 vs 市民 → 皇帝方勝（奴隸廢）
  // 市民 vs 市民 → 平手續下一輪
  if (empCard === EMPEROR && slvCard === CITIZEN) roundWinner = 'emperor';
  else if (empCard === CITIZEN && slvCard === SLAVE) roundWinner = 'emperor'; // 市民克奴隸
  else if (empCard === EMPEROR && slvCard === SLAVE) roundWinner = 'slave'; // 奴隸克皇帝
  else if (empCard === CITIZEN && slvCard === CITIZEN) roundWinner = null; // 平手續
  // 註：皇帝方不可能出奴隸、奴隸方不可能出皇帝，故其餘組合不存在

  pushLog(
    ec,
    `翻牌：皇帝方 ${cardName(empCard)}　vs　奴隸方 ${cardName(slvCard)}` +
      (roundWinner ? `　→ ${roundWinner === 'emperor' ? '皇帝方' : '奴隸方'}勝` : '　→ 平手，續下一輪')
  );

  if (roundWinner) {
    endRound(room, roundWinner);
    return;
  }

  // 平手：進下一輪，先手交替，清本輪出牌
  r.trick += 1;
  r.played = { a: null, b: null };
  r.firstPlayer = other(r.firstPlayer);

  if (r.trick >= MAX_TRICKS || r.hands[emp].length === 0) {
    // 五輪出完仍未分勝負（全平手）→ 皇帝方勝（奴隸未能翻盤）
    endRound(room, 'emperor');
    return;
  }
  ec.seq += 1;
}

function endRound(room, winnerSide /* 'emperor'|'slave' */) {
  const ec = room.ec;
  const r = ec.r;
  const winnerSeat = winnerSide === 'emperor' ? r.emperorSide : r.slaveSide;
  const gain = r.stake * ODDS[winnerSide];
  ec.scores[winnerSeat] += gain;
  r.winner = winnerSeat;
  r.winnerSide = winnerSide;
  r.gain = gain;
  ec.phase = 'roundEnd';
  pushLog(
    ec,
    `🏅 ${seatName(winnerSeat)}（${winnerSide === 'emperor' ? '皇帝' : '奴隸'}方）勝，得 ${r.stake}×${ODDS[winnerSide]} = ${gain} 分`
  );
  ec.seq += 1;
}

// 進入下一回合（雙方都確認）
export function actEcardNextRound(room, role) {
  const ec = room.ec;
  if (!ec || ec.phase !== 'roundEnd') throw new Error('WRONG_PHASE');
  ec.r.ready = ec.r.ready || {};
  ec.r.ready[role] = true;
  if (ec.r.ready.a && ec.r.ready.b) {
    ec.round += 1;
    startRound(room);
  }
}

function cardName(c) {
  return c === EMPEROR ? '皇帝' : c === SLAVE ? '奴隸' : '市民';
}

/* ---------------- 系列賽 ---------------- */

function settleGame(room) {
  const ec = room.ec;
  const series = room.series;
  if (ec.result) {
    series.wins[ec.result] += 1;
    if (series.wins[ec.result] >= series.need) {
      series.over = true;
      series.champion = ec.result;
      pushLog(ec, `🏆 ${seatName(ec.result)} 贏得系列賽`);
    }
  }
}
export function actEcardNextGame(room, role) {
  const ec = room.ec;
  if (!ec || ec.phase !== 'gameover') throw new Error('WRONG_PHASE');
  if (room.series.over) throw new Error('SERIES_OVER');
  ec.nextReady = ec.nextReady || {};
  ec.nextReady[role] = true;
  if (ec.nextReady.a && ec.nextReady.b) startGame(room);
}
export function actEcardRematch(room, role) {
  if (!room.series.over) throw new Error('WRONG_PHASE');
  room.ec.rematch = room.ec.rematch || {};
  room.ec.rematch[role] = true;
  if (room.ec.rematch.a && room.ec.rematch.b) {
    room.series = makeSeries(room.series.mode);
    startGame(room);
  }
}

/* ---------------- 貼圖 ---------------- */

const STICKERS = [
  'taunt', 'eat', 'serious', 'confident', 'dog', 'cat',
  'emperor_face', 'slave_face', 'honest', 'beggar', 'lose', 'angry',
];

export function actEcardSticker(room, role, payload) {
  const ec = room.ec;
  if (!ec) throw new Error('NOT_STARTED');
  const name = payload?.name;
  if (!STICKERS.includes(name)) throw new Error('BAD_INPUT');
  // 不設任何次數或間隔限制：雙方可同時按，也可以連發。
  // 狀態掛在 room 上（見 lib/stickers.js）：BO3 換場會重建 room.ec，
  // 計數器若掛在裡面會歸零、和前端記住的舊值撞號，導致第二場之後按了沒反應。
  putSticker(room, role, name);
}

/* ---------------- 視野 ---------------- */

export function ecardViewFor(room, role) {
  const ec = room.ec;
  const series = room.series;
  const opp = other(role);

  const base = {
    type: 'ecard',
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
      matchPoint: !series.over && series.wins[role] === series.need - 1 && series.wins[opp] === series.need - 1,
    },
    oppJoined: !!room.tokens.b,
  };

  if (!ec) return { ...base, phase: 'waiting' };

  const r = ec.r;
  const view = {
    ...base,
    phase: ec.phase,
    round: ec.round,
    totalRounds: TOTAL_ROUNDS,
    scores: { me: ec.scores[role], opp: ec.scores[opp] },
    result: ec.result,
    resultName: ec.result ? seatName(ec.result) : null,
    iWon: ec.result === role,
    stickers: stickerView(room),
    log: ec.log,
    seq: ec.seq,
  };

  if (r) {
    const myPlayed = r.played?.[role] ?? null;
    const oppPlayed = r.played?.[opp] ?? null;
    const bothPlayed = myPlayed !== null && oppPlayed !== null;
    view.r = {
      leader: r.leader,
      turnNo: r.turnNo,
      stakeSetter: r.stakeSetter,
      stakeMax: r.stakeMax,
      stake: r.stake,
      iAmLeader: r.leader === role,
      iSetStake: r.stakeSetter === role,
      emperorSide: r.emperorSide,
      slaveSide: r.slaveSide,
      myRoleSide: r.emperorSide === role ? 'emperor' : r.slaveSide === role ? 'slave' : null,
      trick: r.trick,
      firstPlayer: r.firstPlayer,
      // 自己的手牌角色可見；對手只給張數與換序（牌背）
      myHand: r.hands ? r.hands[role] : null,
      myHandOrder: r.order?.[role] ?? null,
      oppHandCount: r.hands ? r.hands[opp].length : 0,
      oppOrder: r.order?.[opp] ?? null, // 對手換序 → 前端牌背同步移動
      // 本輪出牌：自己看得到自己出的；對手蓋牌，翻牌時才顯示
      myPlayed,
      oppPlayed: bothPlayed ? oppPlayed : oppPlayed !== null ? 'hidden' : null,
      bothPlayed,
      // 誰該出牌
      toPlay: r.played
        ? r.played[r.firstPlayer] === null
          ? r.firstPlayer
          : other(r.firstPlayer)
        : null,
      // 回合結束資訊
      winner: r.winner,
      winnerSide: r.winnerSide,
      gain: r.gain,
    };
    view.r.myTurnToPlay = ec.phase === 'play' && view.r.toPlay === role && myPlayed === null;
  }
  return view;
}
