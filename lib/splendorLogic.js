/* ------------------------------------------------------------------
 * 璀璨寶石．2～3 人對決
 *
 * 官方人數設定：
 *   2 人 — 五色寶石各 4 枚、貴族翻 3 張
 *   3 人 — 五色寶石各 5 枚、貴族翻 4 張
 *   黃金一律 5 枚；其餘規則與人數無關
 *
 * 決定順位：
 *   2 人 — 猜金幣，雙方必須押不同面，猜中者先手
 *   3 人 — 全員入座後自動抽籤決定 1／2／3 順位
 *
 * 結束條件（關鍵）：
 *   有人達到 15 分後，該輪必須走完才結算，讓每位玩家回合數完全相同，
 *   避免先手優勢。實作上以「輪回到順位第一位」作為一輪的結束點。
 *   分數最高者勝；同分時買卡較少者勝。
 *
 * 所有判定都在伺服器端完成，前端只送意圖、不送結果。
 * ------------------------------------------------------------------ */

const LOG_MAX = 40;

// [等級, 寶石色, 分數, [白,藍,綠,紅,黑]]　色序 0白 1藍 2綠 3紅 4黑
const CARD_DATA = [[1,0,0,[0,1,1,1,1]],[1,0,0,[0,1,2,1,1]],[1,0,0,[0,2,2,0,1]],[1,0,0,[3,1,0,0,1]],[1,0,0,[0,0,0,2,1]],[1,0,0,[0,2,0,0,2]],[1,0,0,[0,3,0,0,0]],[1,0,1,[0,0,4,0,0]],[1,1,0,[1,0,1,1,1]],[1,1,0,[1,0,1,2,1]],[1,1,0,[1,0,2,2,0]],[1,1,0,[0,1,3,1,0]],[1,1,0,[1,0,0,0,2]],[1,1,0,[0,0,2,0,2]],[1,1,0,[0,0,0,0,3]],[1,1,1,[0,0,0,4,0]],[1,2,0,[1,1,0,1,1]],[1,2,0,[1,1,0,1,2]],[1,2,0,[0,1,0,2,2]],[1,2,0,[1,3,1,0,0]],[1,2,0,[2,1,0,0,0]],[1,2,0,[0,2,0,2,0]],[1,2,0,[0,0,0,3,0]],[1,2,1,[0,0,0,0,4]],[1,3,0,[1,1,1,0,1]],[1,3,0,[2,1,1,0,1]],[1,3,0,[2,0,1,0,2]],[1,3,0,[1,1,3,0,0]],[1,3,0,[0,0,2,0,1]],[1,3,0,[2,2,0,0,0]],[1,3,0,[0,0,3,0,0]],[1,3,1,[4,0,0,0,0]],[1,4,0,[1,1,1,1,0]],[1,4,0,[1,1,1,2,0]],[1,4,0,[2,0,1,2,0]],[1,4,0,[0,0,1,3,1]],[1,4,0,[0,2,0,1,0]],[1,4,0,[0,0,2,2,0]],[1,4,0,[0,0,0,3,0]],[1,4,1,[0,4,0,0,0]],[2,0,1,[0,0,3,2,2]],[2,0,1,[2,3,0,3,0]],[2,0,2,[0,0,1,4,2]],[2,0,2,[0,0,0,5,3]],[2,0,2,[0,0,0,5,0]],[2,0,3,[6,0,0,0,0]],[2,1,1,[0,0,2,3,2]],[2,1,1,[0,3,3,0,2]],[2,1,2,[5,0,3,0,0]],[2,1,2,[2,0,0,1,4]],[2,1,2,[0,5,0,0,0]],[2,1,3,[0,6,0,0,0]],[2,2,1,[0,0,0,3,3]],[2,2,1,[2,3,0,0,2]],[2,2,2,[4,2,0,0,1]],[2,2,2,[0,0,5,3,0]],[2,2,2,[0,0,5,0,0]],[2,2,3,[0,0,6,0,0]],[2,3,1,[0,3,0,0,3]],[2,3,1,[0,3,3,0,3]],[2,3,2,[1,0,2,0,4]],[2,3,2,[3,0,0,0,5]],[2,3,2,[0,0,0,0,5]],[2,3,3,[0,0,0,6,0]],[2,4,1,[3,2,2,0,0]],[2,4,1,[0,2,2,3,0]],[2,4,2,[0,1,4,2,0]],[2,4,2,[0,0,5,3,0]],[2,4,2,[5,0,0,0,0]],[2,4,3,[0,0,0,0,6]],[3,0,3,[0,3,3,5,3]],[3,0,4,[7,0,0,0,0]],[3,0,4,[3,0,0,3,6]],[3,0,5,[3,0,0,0,7]],[3,1,3,[3,0,3,3,5]],[3,1,4,[0,7,0,0,0]],[3,1,4,[6,3,3,0,0]],[3,1,5,[7,3,0,0,0]],[3,2,3,[5,3,0,3,3]],[3,2,4,[0,0,7,0,0]],[3,2,4,[3,0,6,3,0]],[3,2,5,[0,0,7,0,3]],[3,3,3,[3,5,3,0,3]],[3,3,4,[0,0,0,7,0]],[3,3,4,[0,3,3,6,0]],[3,3,5,[0,7,3,0,0]],[3,4,3,[3,3,5,3,0]],[3,4,4,[0,0,0,0,7]],[3,4,4,[0,6,3,0,3]],[3,4,5,[0,0,3,7,0]]];

// 10 張貴族：五組雙色 4+4、五組三色 3+3+3，皆 3 分
const NOBLE_DATA = [[4,4,0,0,0],[0,4,4,0,0],[0,0,4,4,0],[0,0,0,4,4],[4,0,0,0,4],
                    [3,3,3,0,0],[0,3,3,3,0],[0,0,3,3,3],[3,0,0,3,3],[3,3,0,0,3]];

export const GEM_NAMES = ['鑽石', '藍寶石', '綠寶石', '紅寶石', '瑪瑙'];

const DEV_IMG_COUNT = 15;   // public/splendor/dev/1..15.jpg（3 等級 × 5 色，一對一）
const NOBLE_IMG_COUNT = 10; // public/splendor/noble/1..10.jpg

const WIN_POINTS = 15;
const TOKEN_CAP = 10;
const RESERVE_CAP = 3;
const GOLD_COUNT = 5;

// 官方人數設定
const SETUP = {
  2: { gems: 4, nobles: 3 },
  3: { gems: 5, nobles: 4 },
};

const SEAT_NAMES = ['玩家一', '玩家二', '玩家三'];

/* ---------------- 基礎工具 ---------------- */

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function randInt(n) {
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pushLog(sp, text) {
  sp.log.unshift({ text, ts: Date.now() });
  if (sp.log.length > LOG_MAX) sp.log.length = LOG_MAX;
}

const seatName = (seat) => SEAT_NAMES[Number(String(seat).slice(1))] || seat;

function markAction(sp, by, action) {
  sp.seq = (sp.seq || 0) + 1;
  const entry = { seq: sp.seq, by, ...action };
  sp.lastAction = entry;
  // 一次操作可能連帶觸發多個動作（例如買牌後立刻迎來貴族），
  // 全部留著讓前端一次補播完，不會漏掉中間那段。
  sp.recent = [...(sp.recent || []), entry].slice(-8);
}

function freshPlayer() {
  return { tok: [0, 0, 0, 0, 0], gold: 0, bonus: [0, 0, 0, 0, 0], pts: 0, cards: 0, res: [], nobles: 0 };
}

function buildDecks() {
  return [1, 2, 3].map((lv) =>
    shuffle(
      CARD_DATA.filter((c) => c[0] === lv).map((c, i) => ({
        id: `${lv}-${c[1]}-${c[2]}-${i}`,
        lv: c[0],
        col: c[1],
        pv: c[2],
        cost: c[3].slice(),
        img: (((lv - 1) * 5 + c[1]) % DEV_IMG_COUNT) + 1,
      }))
    )
  );
}

/* ---------------- 建房／加入 ---------------- */

export function createSplendorRoom({ code, players = 2 }) {
  const n = players === 3 ? 3 : 2;
  const cfg = SETUP[n];
  const decks = buildDecks();
  const nobleDeck = shuffle(NOBLE_DATA.map((req, i) => ({ req: req.slice(), img: (i % NOBLE_IMG_COUNT) + 1 })));
  const seats = Array.from({ length: n }, (_, i) => `s${i}`);

  const tokens = {};
  const playersMap = {};
  seats.forEach((s, i) => {
    tokens[s] = i === 0 ? randomToken() : null;
    playersMap[s] = i === 0 ? freshPlayer() : null;
  });

  return {
    code,
    type: 'splendor',
    status: 'waiting',
    createdAt: Date.now(),
    tokens,
    chat: [],
    sp: {
      playerCount: n,
      seats,
      phase: 'setup', // setup | coin | play | noble | discard | over
      bank: [cfg.gems, cfg.gems, cfg.gems, cfg.gems, cfg.gems],
      gold: GOLD_COUNT,
      decks,
      board: decks.map((d) => [d.pop(), d.pop(), d.pop(), d.pop()]),
      nobles: nobleDeck.slice(0, cfg.nobles).map((x) => ({ ...x, taken: null })),
      players: playersMap,
      order: null, // 決定後為座位陣列，索引 0 為首家
      turnIdx: 0,
      coin: null,
      draw: null,
      pendingDiscard: 0,
      nobleChoices: [],
      seq: 0,
      recent: [],
      lastAction: null,
      winner: null,
      standings: null,
      endReason: null,
      surrenderedBy: null,
      log: [],
    },
  };
}

export function splendorRoleOf(room, token) {
  if (!token) return null;
  for (const seat of room.sp.seats) {
    if (room.tokens[seat] && room.tokens[seat] === token) return seat;
  }
  return null;
}

export function joinSplendorRoom(room) {
  const sp = room.sp;
  const seat = sp.seats.find((s) => !room.tokens[s]);
  if (!seat) throw new Error('ROOM_FULL');

  const token = randomToken();
  room.tokens[seat] = token;
  sp.players[seat] = freshPlayer();
  pushLog(sp, `🪑 ${seatName(seat)} 入座`);

  if (sp.seats.every((s) => room.tokens[s])) {
    room.status = 'playing';
    if (sp.playerCount === 2) startCoinToss(sp);
    else startLottery(sp);
  }
  return { seat, token };
}

/* ---------------- 決定順位 ---------------- */

// 2 人：猜金幣。先押的人佔走一面，另一位只能選剩下那面。
function startCoinToss(sp) {
  sp.phase = 'coin';
  sp.coin = { picks: { s0: null, s1: null }, toss: null, first: null };
  pushLog(sp, '🪙 雙方入座——猜金幣決定先後手');
}

const flipCoin = () => (randInt(2) === 0 ? 'H' : 'T');
const SIDE_NAME = { H: '正面', T: '反面' };

// payload { side: 'H' | 'T' }
export function actSpCoin(room, role, payload) {
  const sp = room.sp;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (sp.phase !== 'coin') throw new Error('WRONG_PHASE');
  const side = payload?.side;
  if (side !== 'H' && side !== 'T') throw new Error('BAD_INPUT');
  if (sp.coin.picks[role]) throw new Error('ALREADY_PICKED');

  const otherSeat = sp.seats.find((s) => s !== role);
  if (sp.coin.picks[otherSeat] === side) throw new Error('SIDE_TAKEN');

  sp.coin.picks[role] = side;
  if (!sp.coin.picks[otherSeat]) return; // 等另一位

  const toss = flipCoin();
  sp.coin.toss = toss;
  const winner = sp.seats.find((s) => sp.coin.picks[s] === toss);
  sp.coin.first = winner;
  beginPlay(sp, [winner, sp.seats.find((s) => s !== winner)]);
  pushLog(sp, `🪙 金幣是${SIDE_NAME[toss]}——${seatName(winner)} 先手`);
}

// 3 人：全員入座後直接抽籤
function startLottery(sp) {
  const order = shuffle(sp.seats.slice());
  sp.draw = { order: order.slice() };
  beginPlay(sp, order);
  pushLog(sp, `🎲 抽籤結果——${order.map((s, i) => `${i + 1}. ${seatName(s)}`).join('　')}`);
}

function beginPlay(sp, order) {
  sp.order = order;
  sp.turnIdx = 0;
  sp.phase = 'play';
}

const currentSeat = (sp) => (sp.order ? sp.order[sp.turnIdx] : null);

/* ---------------- 規則判定 ---------------- */

function payment(p, card) {
  const pay = [0, 0, 0, 0, 0];
  let need = 0;
  for (let i = 0; i < 5; i++) {
    const c = Math.max(0, card.cost[i] - p.bonus[i]);
    pay[i] = Math.min(c, p.tok[i]);
    need += c - pay[i];
  }
  if (need > p.gold) return null;
  return { pay, gold: need };
}

export function canAfford(p, card) {
  return payment(p, card) !== null;
}

const totalTokens = (p) => p.tok.reduce((a, b) => a + b, 0) + p.gold;

function requireTurn(room, role) {
  const sp = room.sp;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (sp.phase === 'coin' || sp.phase === 'setup') throw new Error('COIN_PENDING');
  if (sp.phase === 'over') throw new Error('GAME_OVER');
  if (currentSeat(sp) !== role) throw new Error('NOT_YOUR_TURN');
}

/* ---------------- 回合收尾 ---------------- */

function settleTurn(room, role) {
  const sp = room.sp;
  const p = sp.players[role];

  const eligible = sp.nobles
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.taken === null && n.req.every((v, k) => p.bonus[k] >= v));

  if (eligible.length === 1) {
    claimNoble(room, role, eligible[0].i);
  } else if (eligible.length > 1) {
    sp.phase = 'noble';
    sp.nobleChoices = eligible.map((e) => e.i);
    return;
  }
  afterNoble(room, role);
}

function claimNoble(room, role, i) {
  const sp = room.sp;
  const p = sp.players[role];
  sp.nobles[i].taken = role;
  p.pts += 3;
  p.nobles += 1;
  markAction(sp, role, { kind: 'noble', idx: i, img: sp.nobles[i].img });
  pushLog(sp, `👑 ${seatName(role)} 迎來一位貴族（+3 分）`);
}

function afterNoble(room, role) {
  const sp = room.sp;
  const p = sp.players[role];
  sp.nobleChoices = [];

  const over = totalTokens(p) - TOKEN_CAP;
  if (over > 0) {
    sp.phase = 'discard';
    sp.pendingDiscard = over;
    return;
  }
  endTurn(room, role);
}

/*
 * 一輪的結束點 = 輪回到順位第一位。
 * 只有整輪走完時才檢查勝利條件，因此每位玩家的回合數必定相同：
 * 首家達標後，後面每一位都仍有一次行動機會。
 */
function endTurn(room, role) {
  const sp = room.sp;
  sp.phase = 'play';
  sp.pendingDiscard = 0;

  const nextIdx = (sp.turnIdx + 1) % sp.order.length;
  if (nextIdx === 0 && sp.seats.some((s) => sp.players[s].pts >= WIN_POINTS)) {
    finishGame(sp, 'points');
    return;
  }
  sp.turnIdx = nextIdx;
}

function rank(sp, seats) {
  return seats
    .map((s) => ({ seat: s, name: seatName(s), pts: sp.players[s].pts, cards: sp.players[s].cards }))
    .sort((a, b) => b.pts - a.pts || a.cards - b.cards);
}

function finishGame(sp, reason) {
  sp.phase = 'over';
  sp.endReason = reason;
  const ranked = rank(sp, sp.seats);
  const tiedTop = ranked.filter((r) => r.pts === ranked[0].pts && r.cards === ranked[0].cards);
  sp.winner = tiedTop.length > 1 ? 'draw' : ranked[0].seat;
  sp.standings = ranked;
  pushLog(
    sp,
    sp.winner === 'draw'
      ? '🏁 平手！分數與卡數完全相同'
      : `🏆 ${seatName(sp.winner)} 獲勝（${sp.players[sp.winner].pts} 分）`
  );
}

/* ---------------- 動作 ---------------- */

export function actSpTake(room, role, payload) {
  requireTurn(room, role);
  const sp = room.sp;
  if (sp.phase !== 'play') throw new Error('WRONG_PHASE');

  const gems = Array.isArray(payload?.gems) ? payload.gems : null;
  if (!gems || !gems.length || gems.length > 3) throw new Error('BAD_INPUT');
  if (!gems.every((g) => Number.isInteger(g) && g >= 0 && g < 5)) throw new Error('BAD_INPUT');

  const cnt = [0, 0, 0, 0, 0];
  gems.forEach((g) => cnt[g]++);

  if (cnt.some((n) => n > 2)) throw new Error('BAD_TAKE');
  const twoIdx = cnt.findIndex((n) => n === 2);
  if (twoIdx > -1) {
    if (gems.length !== 2) throw new Error('BAD_TAKE');
    // 拿同色 2 個需該色檯面上有 4 枚以上——此門檻與人數無關
    if (sp.bank[twoIdx] < 4) throw new Error('NOT_ENOUGH_GEMS');
  } else {
    const available = sp.bank.filter((n) => n > 0).length;
    if (gems.length < Math.min(3, available)) throw new Error('BAD_TAKE');
  }
  if (!gems.every((g) => sp.bank[g] >= cnt[g])) throw new Error('NOT_ENOUGH_GEMS');

  const p = sp.players[role];
  gems.forEach((g) => {
    sp.bank[g] -= 1;
    p.tok[g] += 1;
  });
  const desc = cnt.map((n, i) => (n ? `${n} ${GEM_NAMES[i]}` : '')).filter(Boolean).join('、');
  pushLog(sp, `💠 ${seatName(role)} 拿取 ${desc}`);
  markAction(sp, role, { kind: 'take', gems: gems.slice() });
  settleTurn(room, role);
}

export function actSpBuy(room, role, payload) {
  requireTurn(room, role);
  const sp = room.sp;
  if (sp.phase !== 'play') throw new Error('WRONG_PHASE');
  const p = sp.players[role];

  let card, remove;
  if (payload?.from === 'reserve') {
    const idx = payload.idx;
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.res.length) throw new Error('BAD_INPUT');
    card = p.res[idx];
    remove = () => p.res.splice(idx, 1);
  } else if (payload?.from === 'board') {
    const { lv, slot } = payload;
    if (![1, 2, 3].includes(lv) || !Number.isInteger(slot) || slot < 0 || slot > 3) throw new Error('BAD_INPUT');
    card = sp.board[lv - 1][slot];
    if (!card) throw new Error('NO_CARD');
    remove = () => {
      sp.board[lv - 1][slot] = sp.decks[lv - 1].pop() || null;
    };
  } else {
    throw new Error('BAD_INPUT');
  }

  const pm = payment(p, card);
  if (!pm) throw new Error('CANNOT_AFFORD');

  for (let i = 0; i < 5; i++) {
    p.tok[i] -= pm.pay[i];
    sp.bank[i] += pm.pay[i];
  }
  p.gold -= pm.gold;
  sp.gold += pm.gold;
  p.bonus[card.col] += 1;
  p.pts += card.pv;
  p.cards += 1;
  remove();

  pushLog(sp, `🛒 ${seatName(role)} 購買 ${'★'.repeat(card.lv)} ${GEM_NAMES[card.col]}卡${card.pv ? `（+${card.pv} 分）` : ''}`);
  markAction(sp, role, {
    kind: 'buy',
    from: payload.from === 'reserve' ? 'reserve' : 'board',
    lv: card.lv,
    slot: payload.from === 'reserve' ? null : payload.slot,
    resIdx: payload.from === 'reserve' ? payload.idx : null,
    card: { img: card.img, lv: card.lv, col: card.col, pv: card.pv, cost: card.cost.slice() },
  });
  settleTurn(room, role);
}

export function actSpReserve(room, role, payload) {
  requireTurn(room, role);
  const sp = room.sp;
  if (sp.phase !== 'play') throw new Error('WRONG_PHASE');
  const p = sp.players[role];
  if (p.res.length >= RESERVE_CAP) throw new Error('RESERVE_FULL');

  const lv = payload?.lv;
  if (![1, 2, 3].includes(lv)) throw new Error('BAD_INPUT');

  let card;
  let hidden = false;
  if (payload?.from === 'deck') {
    card = sp.decks[lv - 1].pop();
    if (!card) throw new Error('NO_CARD');
    hidden = true;
  } else {
    const slot = payload?.slot;
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) throw new Error('BAD_INPUT');
    card = sp.board[lv - 1][slot];
    if (!card) throw new Error('NO_CARD');
    sp.board[lv - 1][slot] = sp.decks[lv - 1].pop() || null;
  }
  card.hidden = hidden; // 從檯面保留＝公開情報；從牌堆暗抽＝只有自己知道
  p.res.push(card);

  let goldNote = '';
  if (sp.gold > 0) {
    sp.gold -= 1;
    p.gold += 1;
    goldNote = '，取得 1 黃金';
  }
  pushLog(sp, `🔖 ${seatName(role)} 保留一張 ${'★'.repeat(lv)}${hidden ? '（暗抽牌堆頂）' : ''}卡${goldNote}`);
  markAction(sp, role, {
    kind: 'reserve',
    from: hidden ? 'deck' : 'board',
    lv,
    slot: hidden ? null : payload.slot,
    gotGold: !!goldNote,
    card: hidden ? null : { img: card.img, lv: card.lv, col: card.col, pv: card.pv, cost: card.cost.slice() },
  });
  settleTurn(room, role);
}

export function actSpDiscard(room, role, payload) {
  const sp = room.sp;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (sp.phase !== 'discard' || currentSeat(sp) !== role) throw new Error('WRONG_PHASE');
  const p = sp.players[role];
  const gem = payload?.gem;

  if (gem === 'gold') {
    if (p.gold <= 0) throw new Error('BAD_INPUT');
    p.gold -= 1;
    sp.gold += 1;
  } else {
    if (!Number.isInteger(gem) || gem < 0 || gem > 4 || p.tok[gem] <= 0) throw new Error('BAD_INPUT');
    p.tok[gem] -= 1;
    sp.bank[gem] += 1;
  }
  markAction(sp, role, { kind: 'discard', gem });
  sp.pendingDiscard -= 1;
  if (sp.pendingDiscard <= 0) {
    pushLog(sp, `↩️ ${seatName(role)} 放回多餘的寶石`);
    endTurn(room, role);
  }
}

export function actSpNoble(room, role, payload) {
  const sp = room.sp;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (sp.phase !== 'noble' || currentSeat(sp) !== role) throw new Error('WRONG_PHASE');
  const idx = payload?.idx;
  if (!sp.nobleChoices.includes(idx)) throw new Error('BAD_INPUT');
  claimNoble(room, role, idx);
  afterNoble(room, role);
}

// 直接投降。2 人局對手直接獲勝；3 人局投降者判負，其餘依當下分數排名。
export function actSpSurrender(room, role) {
  const sp = room.sp;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (sp.phase === 'over') throw new Error('GAME_OVER');

  sp.surrenderedBy = role;
  sp.phase = 'over';
  sp.endReason = 'surrender';
  sp.pendingDiscard = 0;
  sp.nobleChoices = [];

  const rest = sp.seats.filter((s) => s !== role);
  const ranked = rank(sp, rest);
  const tiedTop = ranked.filter((r) => r.pts === ranked[0].pts && r.cards === ranked[0].cards);
  sp.winner = tiedTop.length > 1 ? 'draw' : ranked[0].seat;
  sp.standings = [...ranked, { seat: role, name: seatName(role), pts: sp.players[role].pts, cards: sp.players[role].cards, surrendered: true }];
  pushLog(sp, `🏳️ ${seatName(role)} 投降`);
}

// 終局後重開一局（所有人都按才重置）
export function actSpRematch(room, role) {
  const sp = room.sp;
  if (sp.phase !== 'over') throw new Error('WRONG_PHASE');
  sp.rematch = sp.rematch || {};
  sp.rematch[role] = true;
  if (!sp.seats.every((s) => sp.rematch[s])) return;

  const fresh = createSplendorRoom({ code: room.code, players: sp.playerCount });
  room.sp = fresh.sp;
  room.sp.seats.forEach((s) => (room.sp.players[s] = freshPlayer()));
  room.sp.log = [];
  pushLog(room.sp, '🔄 再戰一局！牌堆已重新洗過');
  if (room.sp.playerCount === 2) startCoinToss(room.sp);
  else startLottery(room.sp);
}

/* ---------------- 視野 ---------------- */

// 依官方規則：從檯面保留的卡是公開情報，從牌堆暗抽的只揭露張數
function publicPlayer(sp, seat) {
  const p = sp.players[seat];
  if (!p) return null;
  return {
    seat,
    name: seatName(seat),
    tok: p.tok.slice(),
    gold: p.gold,
    bonus: p.bonus.slice(),
    pts: p.pts,
    cards: p.cards,
    nobles: p.nobles,
    reserved: p.res.length,
    resOpen: p.res.filter((c) => !c.hidden).map((c) => ({ ...c })),
    resHidden: p.res.filter((c) => c.hidden).length,
    order: sp.order ? sp.order.indexOf(seat) : null,
  };
}

export function splendorViewFor(room, role) {
  const sp = room.sp;
  const me = sp.players[role];
  const turn = currentSeat(sp);
  const joinedCount = sp.seats.filter((s) => room.tokens[s]).length;
  // 其餘玩家依順位排列，尚未決定順位時依座位順序
  const others = sp.seats
    .filter((s) => s !== role && sp.players[s])
    .map((s) => publicPlayer(sp, s))
    .sort((a, b) => (a.order ?? 9) - (b.order ?? 9));

  return {
    type: 'splendor',
    code: room.code,
    status: room.status,
    playerCount: sp.playerCount,
    joinedCount,
    allJoined: joinedCount === sp.playerCount,
    role,
    myName: seatName(role),
    phase: sp.phase,
    turn,
    turnName: turn ? seatName(turn) : null,
    myTurn: turn === role && sp.phase !== 'over',
    order: sp.order ? sp.order.slice() : null,
    myOrder: sp.order ? sp.order.indexOf(role) : null,
    bank: sp.bank.slice(),
    gold: sp.gold,
    deckCounts: sp.decks.map((d) => d.length),
    board: sp.board.map((row) => row.map((c) => (c ? { ...c } : null))),
    nobles: sp.nobles.map((n) => ({ req: n.req.slice(), img: n.img, taken: n.taken })),
    nobleChoices: sp.phase === 'noble' && turn === role ? sp.nobleChoices.slice() : [],
    pendingDiscard: sp.phase === 'discard' && turn === role ? sp.pendingDiscard : 0,
    me: me ? { ...publicPlayer(sp, role), res: me.res.map((c) => ({ ...c })) } : null,
    others,
    affordable: me
      ? {
          board: sp.board.map((row) => row.map((c) => (c ? canAfford(me, c) : false))),
          res: me.res.map((c) => canAfford(me, c)),
          // 別人的寶石與折扣都是公開情報，所以「有沒有人買得起」也照實顯示
          oppBoard: sp.board.map((row) =>
            row.map((c) =>
              c ? sp.seats.some((s) => s !== role && sp.players[s] && canAfford(sp.players[s], c)) : false
            )
          ),
        }
      : null,
    coin: sp.coin
      ? {
          myPick: sp.coin.picks[role],
          // 對手押的面必須即時公開，另一位才知道只剩哪一面可選
          oppPick: sp.coin.picks[sp.seats.find((s) => s !== role)],
          toss: sp.coin.toss,
          first: sp.coin.first,
          firstName: sp.coin.first ? seatName(sp.coin.first) : null,
        }
      : null,
    draw: sp.draw ? { order: sp.draw.order.map((s) => ({ seat: s, name: seatName(s), isMe: s === role })) } : null,
    lastAction: sp.lastAction,
    recentActions: sp.recent || [],
    winner: sp.winner,
    winnerName: sp.winner && sp.winner !== 'draw' ? seatName(sp.winner) : null,
    standings: sp.standings || null,
    endReason: sp.endReason,
    surrenderedBy: sp.surrenderedBy,
    iSurrendered: sp.surrenderedBy === role,
    rematch: sp.rematch || {},
    log: sp.log,
    winPoints: WIN_POINTS,
  };
}
