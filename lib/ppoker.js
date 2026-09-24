/* ------------------------------------------------------------------
 * 精準預測撲克　路徑：foshan/lib/ppoker.js
 *
 * 2~5 人真金額對賭牌局。跟 E 卡一樣，這個檔案只負責「規則本身」，不碰資料庫、
 * 不知道「金幣」是什麼——房間物件全部由 API 層（app/api/ppoker/*）存進 Postgres，
 * 玩家的視野（ppokerViewFor）會把還不該被看到的牌（底牌、牌堆）過濾掉，
 * 這是防作弊的核心：瀏覽器永遠只拿得到「已經攤開」的資訊。
 *
 * ── 入桌 ──
 * 建房時決定人數（2~5）跟這場比賽金額（500萬/2000萬/1億/3億）。玩家依序加入，
 * 每個人加入後要「抽座位」：從 1~10 裡抽一個還沒被抽走的數字，抽了就代表同意
 * 入桌，抽完之前隨時可以退出、不扣錢。人數抽滿之後，照抽到的數字由大到小排定
 * 座位（同時就是整場比賽固定的行動順序，不會再變），並且立刻檢查所有人的金幣
 * 是否都還夠付這場的金額，都夠才會真的扣款、正式開局。
 *
 * ── 籌碼與金幣的關係 ──
 * 每人進場發 60 籌碼，籌碼只是牌局本身的計算單位，過程中不會去動任何人的金幣。
 * 真正碰金幣只有兩個時間點：抽滿當下扣一次「這場的金額」，打到只剩一人還有
 * 籌碼時，把所有人繳的錢（人數 × 金額）一次全部給那個人。中途離開／斷線被判
 * 棄權的人，籌碼歸零、預扣的錢拿不回來，錢就留在最後的獎池裡給贏家。
 *
 * ── 一手牌的流程 ──
 * 開局前每個還在場上的人收 1 份底注（ante，見下方 anteOf），發 2 張底牌＋2 張
 * 公牌 → 第一輪下注 → 再發 2 張公牌（公牌共 4 張）→ 第二輪下注 → 狙擊階段
 * （依座位順序，還在牌局裡的人可以依序宣告「猜某個牌型＋關鍵點數」，被猜中的
 * 牌型本場算最小、不能贏）→ 攤牌結算。
 *
 * 牌只用 A~10（不分花色），A 當最小（等於 1），10 最大；每個點數有 4 張
 * （對應真實撲克牌的四個花色，只是花色不參與比較），一副牌共 40 張，每手重新
 * 洗一副全新的。比牌是「手上 2 張＋公牌 4 張＝6 張裡面選最大的 5 張組合」，
 * 不看花色，所以牌型只有：四條 > 葫蘆 > 順子 > 三條 > 兩對 > 一對 > 高牌
 * （沒有同花、同花順——花色本來就不存在）。
 * ------------------------------------------------------------------ */

export const SEAT_SIZES = [2, 3, 4, 5];
export const BUY_INS = [5000000, 20000000, 100000000, 300000000];
export const START_CHIPS = 60;
export const DRAW_NUMBERS = [1,2,3,4,5,6,7,8,9,10];

const LOG_MAX = 60;
function pushLog(room, text) {
  room.log.unshift({ text, ts: Date.now() });
  if (room.log.length > LOG_MAX) room.log.length = LOG_MAX;
}
function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// 每 10 手升一級底注：1~10 局＝1，11~20 局＝2，21~30 局＝3……
export function anteOf(handNo) {
  return Math.floor((handNo - 1) / 10) + 1;
}

/* ================= 建房／加入／抽座位 ================= */

export function createPpokerRoom({ code, size, buyIn }) {
  if (!SEAT_SIZES.includes(size)) throw new Error('BAD_SIZE');
  if (!BUY_INS.includes(buyIn)) throw new Error('BAD_BUYIN');
  return {
    code, type: 'ppoker', size, buyIn,
    status: 'seating',        // 'seating' → 'playing' → 'done'
    createdAt: Date.now(),
    players: [],               // { token, playerId, drawn:null|number, seat:null|number, chips:0, out:false, leftEarly:false }
    seatOrder: null,           // 抽滿之後才會有：依座位排好的 players 陣列索引
    match: null,
    lastSeen: {},               // { [token]: ts }，棄局判定用
    log: [], seq: 0,
  };
}

export function ppokerPlayerOf(room, token) {
  if (!token) return -1;
  return room.players.findIndex(p => p.token === token);
}

export function joinPpokerRoom(room, playerId) {
  if (room.status !== 'seating') throw new Error('ROOM_STARTED');
  if (room.players.some(p => p.playerId === playerId)) throw new Error('ALREADY_IN');
  if (room.players.length >= room.size) throw new Error('ROOM_FULL');
  const token = randomToken();
  room.players.push({ token, playerId, drawn: null, seat: null, chips: 0, out: false, leftEarly: false });
  pushLog(room, `👤 ${playerId} 加入了牌桌（${room.players.length}/${room.size}）`);
  room.seq += 1;
  return token;
}

// 抽座位之前隨時可以退出，不扣錢。抽了之後就不能反悔了（見檔頭說明）。
export function leavePpokerSeating(room, token) {
  if (room.status !== 'seating') throw new Error('ROOM_STARTED');
  const idx = ppokerPlayerOf(room, token);
  if (idx === -1) throw new Error('NOT_IN_ROOM');
  const p = room.players[idx];
  if (p.drawn != null) throw new Error('ALREADY_DRAWN');
  room.players.splice(idx, 1);
  pushLog(room, `👋 ${p.playerId} 離開了等待中的牌桌`);
  room.seq += 1;
}

// 回傳 { ready:true } 代表人抽滿了、輪到 API 層去檢查金幣＋扣款＋開局；
// 呼叫端要在扣款成功後呼叫 startFirstHand()。扣款失敗的話呼叫 kickPpokerPlayer()
// 把那個人請出去，房間留在 'seating' 讓別人補位。
export function drawPpokerSeat(room, token) {
  if (room.status !== 'seating') throw new Error('ROOM_STARTED');
  const idx = ppokerPlayerOf(room, token);
  if (idx === -1) throw new Error('NOT_IN_ROOM');
  const p = room.players[idx];
  if (p.drawn != null) throw new Error('ALREADY_DRAWN');

  const used = room.players.map(x => x.drawn).filter(n => n != null);
  const avail = DRAW_NUMBERS.filter(n => !used.includes(n));
  const n = avail[Math.floor(Math.random() * avail.length)];
  p.drawn = n;
  pushLog(room, `🎴 ${p.playerId} 抽到了 ${n}`);
  room.seq += 1;

  const allDrawn = room.players.length === room.size && room.players.every(x => x.drawn != null);
  return { ready: allDrawn };
}

// 有人扣款失敗時用這個把他請出等位室，讓其他人可以補位
export function kickPpokerPlayer(room, token, reason) {
  const idx = ppokerPlayerOf(room, token);
  if (idx === -1) return;
  const p = room.players[idx];
  room.players.splice(idx, 1);
  pushLog(room, `⚠️ ${p.playerId} 因為「${reason}」被請出牌桌`);
  room.seq += 1;
}

// 抽滿＋扣款成功後呼叫：排座位（抽到的數字由大到小），開第一手牌
export function startFirstHand(room) {
  const order = room.players
    .map((p, i) => i)
    .sort((a, b) => room.players[b].drawn - room.players[a].drawn);
  order.forEach((playerIdx, seat) => { room.players[playerIdx].seat = seat; room.players[playerIdx].chips = START_CHIPS; });
  room.seatOrder = order;   // seatOrder[seat] = players 陣列的索引
  room.status = 'playing';
  pushLog(room, `🀄 座位排定：${order.map(i => room.players[i].playerId).join(' → ')}（由大到小）`);
  room.seq += 1;
  dealHand(room);
}

/* ================= 牌堆／比牌 ================= */

function freshDeck() {
  const deck = [];
  for (let r = 1; r <= 10; r++) for (let k = 0; k < 4; k++) deck.push(r);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 6 張（手牌2＋公牌4）選最大 5 張。回傳可以直接字典序比較的陣列：
// [類別, 主要點數, ...次要點數]，類別越大越強；同類別逐位比對次要點數。
// 類別：7=四條 6=葫蘆 5=順子 4=三條 3=兩對 2=一對 1=高牌
export function evaluate6(cards) {
  const counts = {};
  for (const c of cards) counts[c] = (counts[c] || 0) + 1;
  const byCount = Object.entries(counts)
    .map(([r, c]) => ({ r: Number(r), c }))
    .sort((a, b) => b.c - a.c || b.r - a.r);

  const four = byCount.find(x => x.c >= 4);
  if (four) {
    const kicker = Math.max(...cards.filter(c => c !== four.r));
    return [7, four.r, kicker];
  }
  const triples = byCount.filter(x => x.c >= 3).sort((a, b) => b.r - a.r);
  if (triples.length) {
    const tripRank = triples[0].r;
    const pairCandidates = byCount.filter(x => x.r !== tripRank && x.c >= 2).sort((a, b) => b.r - a.r);
    if (pairCandidates.length) return [6, tripRank, pairCandidates[0].r];
  }
  const distinct = [...new Set(cards)].sort((a, b) => a - b);
  let straightHigh = 0;
  for (let low = 1; low <= 6; low++) {
    const need = [low, low+1, low+2, low+3, low+4];
    if (need.every(n => distinct.includes(n))) straightHigh = need[4];
  }
  if (straightHigh) return [5, straightHigh];

  if (triples.length) {
    const tripRank = triples[0].r;
    const pool = [...cards];
    for (let i = 0; i < 3; i++) { const idx = pool.indexOf(tripRank); pool.splice(idx, 1); }
    const kickers = pool.sort((a, b) => b - a).slice(0, 2);
    return [4, tripRank, ...kickers];
  }
  const pairs = byCount.filter(x => x.c >= 2).sort((a, b) => b.r - a.r);
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const pool = [...cards];
    for (const r of [p1.r, p1.r, p2.r, p2.r]) { const idx = pool.indexOf(r); pool.splice(idx, 1); }
    const kicker = Math.max(...pool);
    return [3, p1.r, p2.r, kicker];
  }
  if (pairs.length === 1) {
    const p = pairs[0].r;
    const pool = [...cards];
    for (let i = 0; i < 2; i++) { const idx = pool.indexOf(p); pool.splice(idx, 1); }
    const kickers = pool.sort((a, b) => b - a).slice(0, 3);
    return [2, p, ...kickers];
  }
  const top5 = [...cards].sort((a, b) => b - a).slice(0, 5);
  return [1, ...top5];
}

function cmpEval(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? -1, y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

const CAT_NAME = { 7:'四條', 6:'葫蘆', 5:'順子', 4:'三條', 3:'兩對', 2:'一對', 1:'高牌' };
export const SNIPE_CATS = [
  { id:'four',      cat:7, label:'四條' },
  { id:'fullhouse', cat:6, label:'葫蘆' },
  { id:'straight',  cat:5, label:'順子' },
  { id:'three',     cat:4, label:'三條' },
  { id:'twopair',   cat:3, label:'兩對' },
  { id:'pair',      cat:2, label:'一對' },
  { id:'high',      cat:1, label:'高牌' },
];
export function evalLabel(tuple) {
  const cat = tuple[0];
  if (cat === 5) return `${tuple[1]}順子（${[0,1,2,3,4].map(i=>tuple[1]-4+i).join('')}）`;
  return `${tuple[1]}${CAT_NAME[cat]}`;
}

/* ================= 一手牌 ================= */

function seatPlayer(room, seat) {
  return room.players[room.seatOrder[seat]];
}
function activeSeats(room) {
  // 還在整場比賽裡（沒被淘汰）的座位，依座位順序
  return room.seatOrder.map((_, seat) => seat).filter(seat => !seatPlayer(room, seat).out);
}

// 把 liveSeats（已經是升冪排好的座位陣列）從 startSeat 開始「轉」一輪，
// 例如 liveSeats=[0,1,2,3]、startSeat=2 → [2,3,0,1]。如果 startSeat 剛好是
// 已經出局的座位（陣列裡沒有這個數字），就從下一個還活著的座位開始；
// 如果 startSeat 比所有活著的座位都大（繞回開頭），就從第一個開始。
function rotateFrom(liveSeats, startSeat) {
  let idx = liveSeats.findIndex(s => s >= startSeat);
  if (idx === -1) idx = 0;
  return [...liveSeats.slice(idx), ...liveSeats.slice(0, idx)];
}

function dealHand(room) {
  const m = room.match || { handNo: 0 };
  const handNo = (m.handNo || 0) + 1;
  const ante = anteOf(handNo);
  const seats = activeSeats(room);

  if (seats.length <= 1) {
    room.status = 'done';
    pushLog(room, seats.length === 1 ? `🏆 ${seatPlayer(room, seats[0]).playerId} 是最後贏家！` : '牌局結束。');
    room.match = null;
    room.seq += 1;
    return;
  }

  // 繳不出底注的人這手直接淘汰
  for (const seat of seats) {
    const p = seatPlayer(room, seat);
    if (p.chips < ante) {
      p.out = true;
      pushLog(room, `💀 ${p.playerId} 繳不出底注，出局`);
    }
  }
  const live = activeSeats(room);
  if (live.length <= 1) { dealHand(room); return; }   // 淘汰完可能只剩一人，直接結束

  // 每一局的起手玩家輪替（不是永遠固定同一個人先手）：第 1 局從座位 0 開始，
  // 第 2 局從座位 1 開始……繞一圈之後再重來。避免整場比賽都由同一個人承擔
  // 「資訊最少、最先表態」的劣勢，這樣下注順序跟狙擊順序都會跟著換人開始。
  const startSeat = (handNo - 1) % room.size;
  const rotated = rotateFrom(live, startSeat);

  const deck = freshDeck();
  const hole = {};
  for (const seat of rotated) hole[seat] = [deck.pop(), deck.pop()];
  const community = [deck.pop(), deck.pop()];   // 先發兩張公牌

  const committed = {}, curBet = {};
  for (const seat of rotated) { committed[seat] = ante; curBet[seat] = 0; seatPlayer(room, seat).chips -= ante; }

  room.match = {
    handNo, ante, deck, hole, community, communityFull: false,
    phase: 'bet1',
    active: rotated,           // 這手還在（沒棄牌）的座位，順序已經照本局起手玩家排好
    folded: [],
    allIn: [],
    committed,                 // 這手總共投入（含底注）
    curBet,                    // 這一輪投入
    toCallLevel: 0,
    lastRaiser: null,
    toAct: firstToAct(room, rotated, [], []),
    actedSinceRaise: [],
    snipes: [],
    revealed: [],              // 棄牌後主動選擇亮牌的座位
    log: [], seq: 0,
    results: null,
  };
  pushLog(room, `— 第 ${handNo} 局 —　底注 ${ante}`);
  room.seq += 1;
}

function firstToAct(room, active, folded, allIn) {
  const can = active.filter(s => !folded.includes(s) && !allIn.includes(s));
  return can.length ? can[0] : null;
}
// 找「from 這個座位之後，照這手固定的座位順序（m.active，本局起手玩家轉好之後
// 就不會再變），下一個還能行動的人」。不能拿「濾掉棄牌/全下之後」的短陣列去算
// 位置——那個陣列每次有人棄牌就會變短，索引會亂掉，一旦剛好輪到的人是陣列裡
// 找不到自己（因為他自己就是剛棄牌的那個），就會誤跳回最前面，等於棋盤上有人
// 棄牌時，順位會被打亂，不符合德州撲克「跳過棄牌的人、繼續往下一位」的規則。
// 正確做法：永遠照 m.active 這個固定順序走，只是逐一跳過已經不能動作的人。
function nextToAct(room, from) {
  const m = room.match;
  const order = m.active;
  const can = new Set(order.filter(s => !m.folded.includes(s) && !m.allIn.includes(s)));
  if (!can.size) return null;
  const startIdx = order.indexOf(from);
  for (let step = 1; step <= order.length; step++) {
    const cand = order[(startIdx + step) % order.length];
    if (can.has(cand)) return cand;
  }
  return null;
}

function bettingRoundOver(room) {
  const m = room.match;
  const can = m.active.filter(s => !m.folded.includes(s) && !m.allIn.includes(s));
  if (can.length === 0) return true;   // 所有還在場上的人都全下了，沒人能再動作，輪次自然結束
  // 注意：這裡不能因為「只剩一個人能動作」就直接算這輪結束——那個人還沒真的
  // 回應過目前最高的注額（例如對方剛全下，他還沒跟注/棄牌），一定要他真的
  // 跟到 toCallLevel（或棄牌，被踢出 can）才算這輪結束。
  return can.every(s => m.actedSinceRaise.includes(s) && m.curBet[s] === m.toCallLevel);
}

/* ---------------- 下注 ---------------- */

// action: 'check' | 'call' | 'raise' | 'fold'；raise 要帶 payload.to（把這一輪的
// 投入「補到」多少，不是「再加多少」——這樣前端比較好算，伺服器也照這個驗證）
export function actPpokerBet(room, token, payload) {
  const m = room.match;
  if (!m || !['bet1', 'bet2'].includes(m.phase)) throw new Error('WRONG_PHASE');
  const idx = ppokerPlayerOf(room, token);
  const seat = idx === -1 ? -1 : room.players[idx].seat;
  if (seat !== m.toAct) throw new Error('NOT_YOUR_TURN');
  const p = seatPlayer(room, seat);
  const action = payload?.action;

  if (action === 'fold') {
    m.folded.push(seat);
    pushLog(room, `🙅 ${p.playerId} 棄牌`);
  } else if (action === 'check') {
    if (m.toCallLevel !== m.curBet[seat]) throw new Error('CANNOT_CHECK');
    m.actedSinceRaise.push(seat);
    pushLog(room, `✋ ${p.playerId} 過牌`);
  } else if (action === 'call' || action === 'raise') {
    const to = action === 'call' ? m.toCallLevel : Number(payload?.to);
    if (!Number.isInteger(to) || to < m.toCallLevel) throw new Error('BAD_INPUT');
    const need = to - m.curBet[seat];
    const pay = Math.min(need, p.chips);   // 籌碼不夠就自動全下
    p.chips -= pay;
    m.curBet[seat] += pay;
    m.committed[seat] += pay;
    const wentAllIn = p.chips === 0;
    if (wentAllIn) { m.allIn.push(seat); pushLog(room, `💥 ${p.playerId} 全下 ${m.curBet[seat]}`); }
    else pushLog(room, action === 'call' ? `🔁 ${p.playerId} 跟注 ${m.curBet[seat]}` : `📈 ${p.playerId} 加注到 ${m.curBet[seat]}`);

    if (m.curBet[seat] > m.toCallLevel) {
      m.toCallLevel = m.curBet[seat];
      m.actedSinceRaise = [seat];   // 有人加注，其他人要重新表態
      m.lastRaiser = seat;          // 本輪目前的加注者，畫面上籌碼旁會標注
    } else {
      m.actedSinceRaise.push(seat);
    }
  } else {
    throw new Error('BAD_INPUT');
  }
  room.seq += 1;
  advancePpokerHand(room);
}

function advancePpokerHand(room) {
  const m = room.match;
  const stillIn = m.active.filter(s => !m.folded.includes(s));
  if (stillIn.length <= 1) {
    resolveShowdown(room, stillIn);   // 剩一個人，其他人都棄牌，不用比牌直接贏
    return;
  }
  if (!bettingRoundOver(room)) {
    m.toAct = nextToAct(room, m.toAct);
    return;
  }
  // 這輪下注結束了
  if (m.phase === 'bet1') {
    m.community.push(m.deck.pop(), m.deck.pop());
    m.communityFull = true;
    m.phase = 'bet2';
    m.curBet = Object.fromEntries(m.active.map(s => [s, 0]));
    m.toCallLevel = 0;
    m.actedSinceRaise = [];
    m.lastRaiser = null;   // 新一輪下注，上一輪的加注者標記重置
    m.toAct = firstToAct(room, m.active, m.folded, m.allIn);
    pushLog(room, `🂠 補發公牌，第二輪下注開始`);
    if (m.toAct == null) { m.phase = 'snipe'; m.toAct = firstToAct(room, m.active, m.folded, []); startSnipePhase(room); }
  } else if (m.phase === 'bet2') {
    m.phase = 'snipe';
    m.toAct = firstToAct(room, m.active, m.folded, []);   // 全下的人也能狙擊，只是不能再下注
    startSnipePhase(room);
  }
  room.seq += 1;
}

function startSnipePhase(room) {
  const m = room.match;
  pushLog(room, `🔭 狙擊階段開始`);
  if (m.toAct == null) resolveShowdown(room, m.active.filter(s => !m.folded.includes(s)));
}

// payload: { skip:true } 或 { cat:'four'|'fullhouse'|...|'high', rank:number }
export function actPpokerSnipe(room, token, payload) {
  const m = room.match;
  if (!m || m.phase !== 'snipe') throw new Error('WRONG_PHASE');
  const idx = ppokerPlayerOf(room, token);
  const seat = idx === -1 ? -1 : room.players[idx].seat;
  if (seat !== m.toAct) throw new Error('NOT_YOUR_TURN');
  const p = seatPlayer(room, seat);

  if (!payload?.skip) {
    const def = SNIPE_CATS.find(c => c.id === payload?.cat);
    const rank = Number(payload?.rank);
    if (!def || !Number.isInteger(rank) || rank < 1 || rank > 10) throw new Error('BAD_INPUT');
    m.snipes.push({ seat, cat: def.cat, rank, label: `${rank}${def.label}` });
    pushLog(room, `🔭 ${p.playerId} 狙擊了「${rank}${def.label}」`);
  } else {
    pushLog(room, `🔭 ${p.playerId} 不狙擊`);
  }
  room.seq += 1;

  const stillIn = m.active.filter(s => !m.folded.includes(s));
  const canSnipe = stillIn;   // 全下的人也能狙擊，只有棄牌的人不行
  const nextIdx = canSnipe.indexOf(seat) + 1;
  if (nextIdx < canSnipe.length) {
    m.toAct = canSnipe[nextIdx];
  } else {
    resolveShowdown(room, stillIn);
  }
}

/* ---------------- 邊池 + 狙擊結算 ---------------- */

function buildPots(committed, seats) {
  const entries = seats.map(s => [s, committed[s] || 0]).filter(([, amt]) => amt > 0);
  const levels = [...new Set(entries.map(([, amt]) => amt))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lvl of levels) {
    const eligible = entries.filter(([, amt]) => amt >= lvl).map(([s]) => s);
    const contributingCount = entries.filter(([, amt]) => amt > prev).length;
    const amount = (lvl - prev) * contributingCount;
    if (amount > 0) pots.push({ amount, eligible });
    prev = lvl;
  }
  return pots;
}

function resolveShowdown(room, contestants) {
  const m = room.match;
  const allSeats = m.active;   // 含棄牌的人，邊池計算要用「所有這手投入過的人」
  const pots = buildPots(m.committed, allSeats);

  const sniped = new Set(m.snipes.map(s => `${s.cat}:${s.rank}`));
  const evals = {};
  for (const seat of contestants) evals[seat] = evaluate6([...m.hole[seat], ...m.community]);

  const payouts = {};   // seat -> 贏得的籌碼
  const potResults = [];
  for (const pot of pots) {
    const elig = pot.eligible.filter(s => contestants.includes(s));   // 棄牌的人沒資格贏，但錢還是算在池子裡
    if (!elig.length) continue;   // 理論上不會發生（至少留一個沒棄牌的人才會走到攤牌）
    const notSniped = elig.filter(s => !sniped.has(`${evals[s][0]}:${evals[s][1]}`));
    let winners, allSnipedOut;
    if (notSniped.length) {
      const best = notSniped.reduce((a, b) => cmpEval(evals[b], evals[a]) > 0 ? b : a);
      winners = notSniped.filter(s => cmpEval(evals[s], evals[best]) === 0);
      allSnipedOut = false;
    } else {
      winners = elig;   // 這個池子裡有資格的人全被狙擊到，平手均分
      allSnipedOut = true;
    }
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;
    winners.forEach((s, i) => { payouts[s] = (payouts[s] || 0) + share + (i === 0 ? remainder : 0); });
    potResults.push({ amount: pot.amount, eligible: elig, winners, allSnipedOut });
  }

  for (const [seat, amt] of Object.entries(payouts)) seatPlayer(room, Number(seat)).chips += amt;

  for (const pr of potResults) {
    const names = pr.winners.map(s => seatPlayer(room, s).playerId).join('、');
    pushLog(room, pr.allSnipedOut
      ? `🤝 一個池子（${pr.amount}）裡的人全被狙擊，平分給 ${names}`
      : `🏆 ${names} 贏得 ${pr.amount} 籌碼`);
  }

  m.phase = 'handOver';
  m.results = {
    evals: Object.fromEntries(contestants.map(s => [s, evals[s]])),
    payouts, potResults,
    revealHole: m.hole,   // 攤牌了，底牌全部公開
  };
  m.readyNext = [];
  room.seq += 1;
}

// 每手結束後，雙方都按「繼續」才會開下一手；任何一手若打到只剩一人有籌碼，
// dealHand() 裡會直接把 room.status 設成 'done'，不會再等人按繼續。
// 棄牌的人結算畫面預設不會被看到底牌，除非自己主動選擇亮出來（常見的撲克禮儀
// 選項）。只有「這手棄過牌的人」能對「這手」呼叫，亮了就不能收回。
export function actPpokerReveal(room, token) {
  const m = room.match;
  if (!m || m.phase !== 'handOver') throw new Error('WRONG_PHASE');
  const idx = ppokerPlayerOf(room, token);
  const seat = idx === -1 ? -1 : room.players[idx].seat;
  if (seat == null || !m.folded.includes(seat)) throw new Error('NOT_YOUR_TURN');
  m.revealed = m.revealed || [];
  if (!m.revealed.includes(seat)) {
    m.revealed.push(seat);
    pushLog(room, `👀 ${seatPlayer(room, seat).playerId} 主動亮出了棄掉的牌`);
  }
  room.seq += 1;
}

export function actPpokerReadyNext(room, token) {
  const m = room.match;
  if (!m || m.phase !== 'handOver') throw new Error('WRONG_PHASE');
  const idx = ppokerPlayerOf(room, token);
  const seat = idx === -1 ? -1 : room.players[idx].seat;
  if (seat == null || seatPlayer(room, seat).out) throw new Error('NOT_YOUR_TURN');
  m.readyNext = m.readyNext || [];
  if (!m.readyNext.includes(seat)) m.readyNext.push(seat);
  room.seq += 1;

  const need = activeSeats(room);
  if (need.every(s => m.readyNext.includes(s))) dealHand(room);
}

/* ================= 棄局／斷線偵測 ================= */

export const WARN_MS = 60000;     // 超過 1 分鐘沒動作，開始警告
export const ABANDON_MS = 120000; // 超過 2 分鐘沒動作，判定中離
export function markSeen(room, token) {
  room.lastSeen = room.lastSeen || {};
  room.lastSeen[token] = Date.now();
}
// 回傳這一輪偵測到沉默、該被判棄權的 token（一次只處理一個，呼叫端要重複呼叫直到回傳 null）
export function checkPpokerAbandonment(room, exceptToken) {
  if (room.status !== 'playing') return null;
  const now = Date.now();
  for (const p of room.players) {
    if (p.out || p.token === exceptToken) continue;
    const seen = room.lastSeen?.[p.token] || 0;
    if (now - seen > ABANDON_MS) return p.token;
  }
  return null;
}

// 中途離開／被判沉默棄權：籌碼歸零、直接淘汰，可以留著看。牌局不會提前結束，
// 剩下的人繼續打；如果這個人正好輪到他行動，等同於自動棄牌／不狙擊。
export function forfeitPpokerPlayer(room, token, reason) {
  const idx = ppokerPlayerOf(room, token);
  if (idx === -1) return;
  const p = room.players[idx];
  if (p.out) return;
  p.out = true; p.leftEarly = true; p.chips = 0;
  pushLog(room, reason === 'timeout'
    ? `⌛ ${p.playerId} 長時間沒有回應，判定棄權出局`
    : `🚪 ${p.playerId} 離開了牌桌，判定棄權出局`);
  room.seq += 1;

  const m = room.match;
  if (m && p.seat != null && m.active.includes(p.seat) && !m.folded.includes(p.seat)) {
    if (m.phase === 'bet1' || m.phase === 'bet2') {
      if (m.toAct === p.seat) { m.folded.push(p.seat); advancePpokerHand(room); }
      else m.folded.push(p.seat);
    } else if (m.phase === 'snipe') {
      m.folded.push(p.seat);
      if (m.toAct === p.seat) {
        const stillIn = m.active.filter(s => !m.folded.includes(s));
        if (stillIn.length) {
          // 跟下注輪的道理一樣：照 m.active 固定順序，從被棄權那個人的原始位置
          // 往後找下一個還能狙擊的人，不能直接跳回陣列最前面。
          const order = m.active;
          const canSet = new Set(stillIn);
          const startIdx = order.indexOf(p.seat);
          let next = null;
          for (let step = 1; step <= order.length; step++) {
            const cand = order[(startIdx + step) % order.length];
            if (canSet.has(cand)) { next = cand; break; }
          }
          m.toAct = next;
          if (next == null) resolveShowdown(room, stillIn);
        } else {
          resolveShowdown(room, stillIn);
        }
      }
    }
  }
  if (activeSeats(room).length <= 1 && room.status === 'playing') {
    if (!m || m.phase === 'handOver') dealHand(room);
  }
}

/* ================= 視野 ================= */

export function ppokerViewFor(room, token) {
  const idx = ppokerPlayerOf(room, token);
  const mySeat = idx === -1 ? null : room.players[idx].seat;
  const now = Date.now();

  const base = {
    type: 'ppoker', code: room.code, status: room.status,
    size: room.size, buyIn: room.buyIn,
    players: room.players.map(p => ({
      playerId: p.playerId, seat: p.seat, drawn: room.status === 'seating' ? p.drawn : (p.drawn != null),
      chips: p.chips, out: p.out, leftEarly: p.leftEarly, isMe: p.token === token,
      // 閒置多久沒動作，只給「還在場上、比賽還在進行」的人算，前端拿這個顯示
      // 「快被判定中離」的警告（WARN_MS）；已經出局或比賽已結束的人不用算。
      idleMs: (room.status === 'playing' && !p.out) ? Math.max(0, now - (room.lastSeen?.[p.token] || now)) : 0,
    })),
    mySeat, log: room.log, seq: room.seq,
  };
  if (room.status !== 'playing' || !room.match) return base;

  const m = room.match;
  const seatName = s => seatPlayer(room, s).playerId;
  const sniped = new Set(m.snipes.map(s => `${s.cat}:${s.rank}`));
  base.match = {
    handNo: m.handNo, ante: m.ante, phase: m.phase,
    community: m.community, communityFull: m.communityFull,
    active: m.active, folded: m.folded, allIn: m.allIn,
    committed: m.committed, curBet: m.curBet, toCallLevel: m.toCallLevel,
    toAct: m.toAct, toActName: m.toAct != null ? seatName(m.toAct) : null,
    myTurn: mySeat != null && m.toAct === mySeat,
    myHole: mySeat != null && m.hole[mySeat] ? m.hole[mySeat] : null,
    snipes: m.snipes.map(s => ({
      ...s, seatName: seatName(s.seat),
      // 這條狙擊宣告攤牌後有沒有真的命中某個人——只有攤牌以後才算得出來，
      // 攤牌前一律先當作「還不知道」，前端在那之前不會顯示驚嘆號。
      hit: (m.phase === 'handOver' && m.results)
        ? Object.values(m.results.evals).some(tup => tup[0] === s.cat && tup[1] === s.rank)
        : null,
    })),
    readyNext: m.readyNext || [],
    pot: Object.values(m.committed).reduce((a, b) => a + b, 0),
    startSeat: m.active[0],                          // 本局起手玩家（箭頭標示用）
    startSeatName: seatName(m.active[0]),
    lastRaiser: m.lastRaiser ?? null,                 // 本輪目前的加注者（籌碼旁標注用）
    lastRaiserName: m.lastRaiser != null ? seatName(m.lastRaiser) : null,
  };
  if (m.phase === 'handOver' && m.results) {
    // 攤牌只公開「真的比牌的人」的底牌；棄牌的人預設不公開，除非自己主動
    // 用 actPpokerReveal 亮出來——那樣的話額外附上牌型算給大家看，跟正常
    // 攤牌一樣，只是特別標記這是「棄牌後主動亮的」，不算進誰贏誰輸。
    const revealedFolded = (m.revealed || []).filter(s => !(String(s) in m.results.evals));
    const evalsOut = Object.fromEntries(Object.entries(m.results.evals).map(([s, tup]) => [
      s, { tuple: tup, label: evalLabel(tup), sniped: sniped.has(`${tup[0]}:${tup[1]}`) },
    ]));
    const holeOut = {};
    for (const s of Object.keys(m.results.evals)) holeOut[s] = m.results.revealHole[s];
    for (const s of revealedFolded) {
      holeOut[s] = m.results.revealHole[s];
      evalsOut[s] = { tuple: null, label: '（棄牌）', sniped: false };
    }
    base.match.results = {
      evals: evalsOut,
      payouts: m.results.payouts,
      potResults: m.results.potResults.map(pr => ({
        ...pr,
        eligibleNames: pr.eligible.map(seatName),
        winnerNames: pr.winners.map(seatName),
      })),
      hole: holeOut,
      foldedRevealed: revealedFolded,
    };
  }
  return base;
}
