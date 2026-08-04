/* ------------------------------------------------------------------
 * 17 張撲克．雙人對戰
 *
 * 牌組：JQKA 四花色（16 張）＋ 鬼牌 1 張 ＝ 17 張
 *   點數索引 0=J 1=Q 2=K 3=A；花色 0-3；鬼牌 rank=-1 花色=-1
 *   鬼牌萬用，可替代任何牌，並可充當「10」湊 10-J-Q-K-A 的順子
 *
 * 牌型（大→小）：五條 > 同花順 > 四條 > 葫蘆 > 順子 > 三條 > 兩對 > 一對
 *   無同花、無散牌（點數只有四種，任 5 張至少構成一對）
 *
 * 一場：雙方各 100 枚，8 回合。每回合：
 *   各下底注 5 → 發 5 張 → 下注(1~10) → 換牌 → 下注(1~15)
 *   → 對方棄牌/跟注/加注 → 開牌比大小
 *   籌碼不足時加注上限為剩餘全部(all-in)；回合前不足 5 判出局；歸零出局
 *
 * 換牌：8 回合 A/B 交替先手，先喊先換；先換方抽走後，
 *   牌庫剩量決定後換方最多能換幾張；換幾張雙方都看得到。
 * ------------------------------------------------------------------ */

// 牌型分數（越大越強）
export const HAND_RANK = {
  FIVE: 8, // 五條
  STRAIGHT_FLUSH: 7, // 同花順
  FOUR: 6, // 四條
  FULL_HOUSE: 5, // 葫蘆
  STRAIGHT: 4, // 順子
  THREE: 3, // 三條
  TWO_PAIR: 2, // 兩對
  PAIR: 1, // 一對
};

export const HAND_NAME = {
  8: '五條',
  7: '同花順',
  6: '四條',
  5: '葫蘆',
  4: '順子',
  3: '三條',
  2: '兩對',
  1: '一對',
};

export const RANK_LABEL = ['J', 'Q', 'K', 'A']; // 索引 0-3
const NUM_RANKS = 4;

// 建立整副牌：16 張一般牌 + 1 張鬼牌
export function buildDeck() {
  const deck = [];
  for (let r = 0; r < NUM_RANKS; r++) {
    for (let s = 0; s < 4; s++) deck.push({ rank: r, suit: s, joker: false });
  }
  deck.push({ rank: -1, suit: -1, joker: true });
  return deck;
}

/*
 * 評估一手 5 張牌，回傳 { rank, tiebreak, name }。
 * rank 為 HAND_RANK 的值；tiebreak 為比較用的次要陣列（大→小）。
 * 鬼牌萬用：列舉它所有可能化身，取最大結果。
 */
export function evaluateHand(cards) {
  if (cards.length !== 5) throw new Error('手牌必須是 5 張');

  const jokerCount = cards.filter((c) => c.joker).length;
  const normals = cards.filter((c) => !c.joker);

  if (jokerCount === 0) return scoreConcrete(normals);

  // 鬼牌只有 1 張。列舉它化身為每個 (rank, suit)，以及「當 10」的特殊情形，取最大。
  let best = null;
  const consider = (hand) => {
    const s = scoreConcrete(hand);
    if (!best || compareScore(s, best) > 0) best = s;
  };

  for (let r = 0; r < NUM_RANKS; r++) {
    for (let s = 0; s < 4; s++) {
      consider([...normals, { rank: r, suit: s, joker: false }]);
    }
  }
  // 鬼牌當 10：用特殊 rank=-10 標記，只在順子/同花順判定中有意義
  for (let s = 0; s < 4; s++) {
    consider([...normals, { rank: -10, suit: s, joker: false, isTen: true }]);
  }
  return best;
}

// 評估「已無鬼牌」的具體 5 張牌
function scoreConcrete(cards) {
  // 統計一般點數 (0-3) 的張數
  const counts = [0, 0, 0, 0];
  let tenSuit = null; // 若有「當 10」的牌，記其花色
  for (const c of cards) {
    if (c.isTen) tenSuit = c.suit;
    else counts[c.rank] += 1;
  }

  const hasTen = tenSuit !== null;

  // 順子/同花順：唯一序列 10-J-Q-K-A，需各一張且含一張 10
  let straight = false;
  let straightFlush = false;
  if (hasTen && counts[0] === 1 && counts[1] === 1 && counts[2] === 1 && counts[3] === 1) {
    straight = true;
    // 同花順：JQKA 四張同花色，且該花色 == 當 10 的花色
    const suitsOfNormals = cards.filter((c) => !c.isTen).map((c) => c.suit);
    if (suitsOfNormals.every((s) => s === suitsOfNormals[0]) && suitsOfNormals[0] === tenSuit) {
      straightFlush = true;
    }
  }

  // 依同點數張數分組（僅一般點數）
  const groups = counts
    .map((n, r) => ({ r, n }))
    .filter((g) => g.n > 0)
    .sort((a, b) => b.n - a.n || b.r - a.r);
  const sizes = groups.map((g) => g.n);

  // tiebreak：先照張數多寡、再照點數大小排出的點數序列
  const tb = [];
  for (const g of groups) for (let i = 0; i < g.n; i++) tb.push(g.r);
  if (hasTen) tb.push(-1); // 10 視為最小點數（低於 J=0）作為次要比較

  if (sizes[0] === 5) return mk(HAND_RANK.FIVE, groups);
  if (straightFlush) return { rank: HAND_RANK.STRAIGHT_FLUSH, tiebreak: [3], name: HAND_NAME[7] };
  if (sizes[0] === 4) return mk(HAND_RANK.FOUR, groups);
  if (sizes[0] === 3 && sizes[1] === 2) return mk(HAND_RANK.FULL_HOUSE, groups);
  if (straight) return { rank: HAND_RANK.STRAIGHT, tiebreak: [3], name: HAND_NAME[4] };
  if (sizes[0] === 3) return mk(HAND_RANK.THREE, groups);
  if (sizes[0] === 2 && sizes[1] === 2) return mk(HAND_RANK.TWO_PAIR, groups);
  if (sizes[0] === 2) return mk(HAND_RANK.PAIR, groups);

  // 四種點數各一張但無 10：不成順子，取最大點數當「一對」以下……
  // 實際上五張中僅四種點數，必有一對，故此分支不會發生。保底回傳最小。
  return { rank: 0, tiebreak: groups.map((g) => g.r), name: '無' };
}

function mk(rank, groups) {
  // tiebreak：依組別（已排序）展開點數
  const tb = [];
  for (const g of groups) for (let i = 0; i < g.n; i++) tb.push(g.r);
  return { rank, tiebreak: tb, name: HAND_NAME[rank] };
}

// 比較兩個 score：>0 表 a 較大
export function compareScore(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const la = a.tiebreak,
    lb = b.tiebreak;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    const x = la[i] ?? -99;
    const y = lb[i] ?? -99;
    if (x !== y) return x - y;
  }
  return 0;
}

export { scoreConcrete };
