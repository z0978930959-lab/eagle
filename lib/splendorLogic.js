/* ------------------------------------------------------------------
 * 璀璨寶石．雙人對決（第三種遊戲模式）
 *
 * 規則採用官方雙人設定：
 *   ‧ 五色寶石各 4 枚、黃金 5 枚、貴族翻 3 張、先到 15 分結束
 *   ‧ 市場三排（一星 40 張／二星 30 張／三星 20 張），每排固定 4 張
 *   ‧ 每回合擇一：拿 3 個不同色／拿同色 2 個（該色需 4 枚以上）／
 *     保留 1 張並取 1 黃金／購買 1 張（市場或自己保留的）
 *   ‧ 保留上限 3 張；回合結束持有寶石上限 10 枚
 *   ‧ 回合結束符合貴族需求即迎接（同時符合多位時自己選一位）
 *   ‧ 先手達 15 分後後手仍有一回合；同分時買卡較少者勝
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
export const GEM_KEYS = ['w', 'u', 'g', 'r', 'k'];

const DEV_IMG_COUNT = 15;  // public/splendor/dev/1..15.jpg（3 等級 × 5 色，一對一）
const NOBLE_IMG_COUNT = 10; // public/splendor/noble/1..10.jpg

const WIN_POINTS = 15;
const TOKEN_CAP = 10;
const RESERVE_CAP = 3;
const GEM_PER_COLOR = 4;    // 雙人局：每色 4 枚
const GOLD_COUNT = 5;
const NOBLE_COUNT = 3;      // 雙人局：翻 3 張

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

const other = (role) => (role === 'away' ? 'home' : 'away');

// 記錄最近一次動作，前端據此播放飛行動畫。
// 注意：暗抽的卡片內容不可寫進來，否則會從動畫外洩情報。
function markAction(sp, by, action) {
  sp.seq = (sp.seq || 0) + 1;
  const entry = { seq: sp.seq, by, ...action };
  sp.lastAction = entry;
  // 一次操作可能連帶觸發多個動作（例如買牌後立刻迎來貴族），
  // 全部留著讓前端一次補播完，不會漏掉中間那段。
  sp.recent = [...(sp.recent || []), entry].slice(-6);
}

function freshPlayer() {
  return {
    tok: [0, 0, 0, 0, 0],
    gold: 0,
    bonus: [0, 0, 0, 0, 0],
    pts: 0,
    cards: 0,
    res: [],
    nobles: 0,
  };
}

function buildDecks() {
  // 同一等級同一寶石色共用一張底圖，卡面數值仍各自顯示
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

export function createSplendorRoom({ code }) {
  const decks = buildDecks();
  const nobleDeck = shuffle(NOBLE_DATA.map((req, i) => ({ req: req.slice(), img: (i % NOBLE_IMG_COUNT) + 1 })));
  return {
    code,
    type: 'splendor',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { away: randomToken(), home: null },
    chat: [],
    sp: {
      phase: 'setup', // setup | coin | play | noble | discard | over
      bank: [GEM_PER_COLOR, GEM_PER_COLOR, GEM_PER_COLOR, GEM_PER_COLOR, GEM_PER_COLOR],
      gold: GOLD_COUNT,
      decks,
      board: decks.map((d) => [d.pop(), d.pop(), d.pop(), d.pop()]),
      nobles: nobleDeck.slice(0, NOBLE_COUNT).map((n) => ({ ...n, taken: null })),
      players: { away: freshPlayer(), home: null },
      turn: null,
      coin: null,
      pendingDiscard: 0,
      nobleChoices: [],
      seq: 0,
      recent: [],
      lastAction: null, // 給前端播放「剛剛發生了什麼」的動畫用
      winner: null,
      log: [],
    },
  };
}

export function joinSplendorRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.home = randomToken();
  room.sp.players.home = freshPlayer();
  room.status = 'playing';
  startCoinToss(room.sp);
  return room;
}

/* ---------------- 猜金幣決定先後手 ---------------- */

function startCoinToss(sp) {
  sp.phase = 'coin';
  sp.turn = null;
  sp.coin = { picks: { away: null, home: null }, toss: null, tiebreak: null, first: null };
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

  sp.coin.picks[role] = side;
  if (!sp.coin.picks.away || !sp.coin.picks.home) return; // 等另一位

  const toss = flipCoin();
  sp.coin.toss = toss;
  if (sp.coin.picks.away !== sp.coin.picks.home) {
    // 選了不同面：猜中的先手
    sp.coin.first = sp.coin.picks.away === toss ? 'away' : 'home';
  } else {
    // 兩人押同一面：再擲一次，由硬幣直接裁決
    sp.coin.tiebreak = flipCoin();
    sp.coin.first = sp.coin.tiebreak === 'H' ? 'away' : 'home';
  }

  sp.turn = sp.coin.first;
  sp.phase = 'play';
  pushLog(
    sp,
    `🪙 金幣是${SIDE_NAME[toss]}${sp.coin.tiebreak ? '（雙方同押，加擲一次裁決）' : ''}——${roleName(sp.coin.first)}先手`
  );
}

/* ---------------- 規則判定 ---------------- */

// 折抵後實際要付的寶石；不足的部分用黃金補。買不起回傳 null
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
  if (sp.turn !== role) throw new Error('NOT_YOUR_TURN');
}

/* ---------------- 回合收尾 ---------------- */

// 回合結束流程：先結算貴族 → 再檢查寶石上限 → 最後換手／終局
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
    return; // 等該玩家選貴族
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
  pushLog(sp, `👑 ${roleName(role)} 迎來一位貴族（+3 分）`);
}

function afterNoble(room, role) {
  const sp = room.sp;
  const p = sp.players[role];
  sp.nobleChoices = [];

  const over = totalTokens(p) - TOKEN_CAP;
  if (over > 0) {
    sp.phase = 'discard';
    sp.pendingDiscard = over;
    return; // 等該玩家放回多餘寶石
  }
  endTurn(room, role);
}

function endTurn(room, role) {
  const sp = room.sp;
  sp.phase = 'play';
  sp.pendingDiscard = 0;

  // 後手（home）走完才算一輪結束，此時才判定終局，確保雙方回合數相同
  if (role === 'home') {
    const a = sp.players.away;
    const h = sp.players.home;
    if (a.pts >= WIN_POINTS || h.pts >= WIN_POINTS) {
      sp.phase = 'over';
      if (a.pts !== h.pts) sp.winner = a.pts > h.pts ? 'away' : 'home';
      else if (a.cards !== h.cards) sp.winner = a.cards < h.cards ? 'away' : 'home';
      else sp.winner = 'draw';
      pushLog(
        sp,
        sp.winner === 'draw'
          ? '🏁 平手！雙方分數與卡數完全相同'
          : `🏆 ${roleName(sp.winner)} 獲勝（${sp.players[sp.winner].pts} 分）`
      );
      return;
    }
  }
  sp.turn = other(role);
}

function roleName(role) {
  return role === 'away' ? '建房方' : '加入方';
}

/* ---------------- 動作 ---------------- */

// 拿寶石：payload { gems: [色index, ...] }
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
    // 同色 2 個：不能混其他顏色，且該色開手前需有 4 枚以上
    if (gems.length !== 2) throw new Error('BAD_TAKE');
    if (sp.bank[twoIdx] < 4) throw new Error('NOT_ENOUGH_GEMS');
  } else {
    // 不同色：最多 3 種，且不足 3 種可用時才允許少拿
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
  pushLog(sp, `💠 ${roleName(role)} 拿取 ${desc}`);
  markAction(sp, role, { kind: 'take', gems: gems.slice() });
  settleTurn(room, role);
}

// 購買：payload { from:'board', lv:1|2|3, slot:0-3 } 或 { from:'reserve', idx:0-2 }
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
    const lv = payload.lv;
    const slot = payload.slot;
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

  pushLog(
    sp,
    `🛒 ${roleName(role)} 購買 ${'★'.repeat(card.lv)} ${GEM_NAMES[card.col]}卡${card.pv ? `（+${card.pv} 分）` : ''}`
  );
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

// 保留：payload { from:'board', lv, slot } 或 { from:'deck', lv }
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
    hidden = true; // 暗抽：不給對手看
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
  pushLog(sp, `🔖 ${roleName(role)} 保留一張 ${'★'.repeat(lv)}${hidden ? '（暗抽牌堆頂）' : ''}卡${goldNote}`);
  markAction(sp, role, {
    kind: 'reserve',
    from: hidden ? 'deck' : 'board',
    lv,
    slot: hidden ? null : payload.slot,
    gotGold: !!goldNote,
    // 暗抽的卡不揭露內容，前端只會飛一張牌背
    card: hidden ? null : { img: card.img, lv: card.lv, col: card.col, pv: card.pv, cost: card.cost.slice() },
  });
  settleTurn(room, role);
}

// 超過 10 枚時放回：payload { gem: 0-4 } 或 { gem: 'gold' }
export function actSpDiscard(room, role, payload) {
  const sp = room.sp;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (sp.phase !== 'discard' || sp.turn !== role) throw new Error('WRONG_PHASE');
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
    pushLog(sp, `↩️ ${roleName(role)} 放回多餘的寶石`);
    endTurn(room, role);
  }
}

// 同時符合多位貴族時選一位：payload { idx: 貴族在場上的 index }
export function actSpNoble(room, role, payload) {
  const sp = room.sp;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (sp.phase !== 'noble' || sp.turn !== role) throw new Error('WRONG_PHASE');
  const idx = payload?.idx;
  if (!sp.nobleChoices.includes(idx)) throw new Error('BAD_INPUT');
  claimNoble(room, role, idx);
  afterNoble(room, role);
}

// 終局後重開一局（雙方都按才重置）
export function actSpRematch(room, role) {
  const sp = room.sp;
  if (sp.phase !== 'over') throw new Error('WRONG_PHASE');
  sp.rematch = sp.rematch || {};
  sp.rematch[role] = true;
  if (sp.rematch.away && sp.rematch.home) {
    const fresh = createSplendorRoom({ code: room.code });
    room.sp = fresh.sp;
    room.sp.players.home = freshPlayer();
    room.sp.log = [];
    pushLog(room.sp, '🔄 再戰一局！牌堆已重新洗過');
    startCoinToss(room.sp);
  }
}

/* ---------------- 視野 ---------------- */

// 依官方規則：從檯面保留的卡是公開情報，從牌堆暗抽的只揭露張數
function publicPlayer(p) {
  if (!p) return null;
  return {
    tok: p.tok.slice(),
    gold: p.gold,
    bonus: p.bonus.slice(),
    pts: p.pts,
    cards: p.cards,
    nobles: p.nobles,
    reserved: p.res.length,
    resOpen: p.res.filter((c) => !c.hidden).map((c) => ({ ...c })),
    resHidden: p.res.filter((c) => c.hidden).length,
  };
}

export function splendorViewFor(room, role) {
  const sp = room.sp;
  const me = sp.players[role];
  const opp = sp.players[other(role)];

  return {
    type: 'splendor',
    code: room.code,
    status: room.status,
    role,
    phase: sp.phase,
    turn: sp.turn,
    myTurn: sp.turn === role && sp.phase !== 'over',
    oppJoined: !!opp,
    bank: sp.bank.slice(),
    gold: sp.gold,
    deckCounts: sp.decks.map((d) => d.length),
    board: sp.board.map((row) => row.map((c) => (c ? { ...c } : null))),
    nobles: sp.nobles.map((n) => ({ req: n.req.slice(), img: n.img, taken: n.taken })),
    nobleChoices: sp.phase === 'noble' && sp.turn === role ? sp.nobleChoices.slice() : [],
    pendingDiscard: sp.phase === 'discard' && sp.turn === role ? sp.pendingDiscard : 0,
    me: me ? { ...publicPlayer(me), res: me.res.map((c) => ({ ...c })) } : null,
    opp: publicPlayer(opp),
    affordable: me
      ? {
          board: sp.board.map((row) => row.map((c) => (c ? canAfford(me, c) : false))),
          res: me.res.map((c) => canAfford(me, c)),
          // 對手的寶石與折扣都是公開情報，所以「對手買不買得起」也可以照實顯示
          oppBoard: opp ? sp.board.map((row) => row.map((c) => (c ? canAfford(opp, c) : false))) : null,
        }
      : null,
    lastAction: sp.lastAction,
    recentActions: sp.recent || [],
    coin: sp.coin
      ? {
          myPick: sp.coin.picks[role],
          oppPicked: !!sp.coin.picks[other(role)],
          oppPick: sp.coin.first ? sp.coin.picks[other(role)] : null,
          toss: sp.coin.toss,
          tiebreak: sp.coin.tiebreak,
          first: sp.coin.first,
        }
      : null,
    winner: sp.winner,
    rematch: sp.rematch || {},
    log: sp.log,
    winPoints: WIN_POINTS,
  };
}
