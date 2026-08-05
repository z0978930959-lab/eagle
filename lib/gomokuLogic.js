/* ------------------------------------------------------------------
 * 五子棋．雙人對戰
 *
 * 15×15 棋盤，黑先白後，先連成五子者勝。
 *
 * 先手（黑）的三種禁手（連珠標準三禁手），白方一種都沒有：
 *   ★ 三三禁手：一手同時做出兩個以上的「活三」
 *   ★ 四四禁手：一手同時做出兩個以上的「四」（活四、沖四都算）
 *   ★ 長連禁手：連成六子以上
 *   判定看的是「這一手」同時做出幾個，不是盤面上總共有幾個。
 *   一四一三（四三）合法，是主要的取勝手段。
 *   例外：那一手若本身就連成「正好五子」，五連優先，直接判勝。
 *   禁手會被後端直接擋下，輪到黑方時前端也會先把禁手點標成 ✕。
 *
 * 兩種模式：
 *   普通模式：正常下，只擋禁手。
 *   友善模式：任一方出現活三或死四時，把那三子／四子框成紅色；
 *             同一方同時出現兩個以上威脅（雙活三、活三＋死四…）時，
 *             再於棋盤旁的空白處秀出提示圖。
 *
 * ──────────────────────────────────────────────
 * 棋型判定（活三／死四）都建立在同一個小工具上：
 *   fivePoints(board, x, y, c, dir)
 *     → 沿著 dir 這條線，還有哪些「空點」補下去就能連成五，且那個五連
 *       會包含 (x,y)。
 *   兩個以上補點 → 活四；剛好一個 → 死四（沖四）；一個都沒有 → 還不是四。
 *   活三則定義為：目前不是四，但存在一個空點，補下去會變成活四。
 *   這是連珠慣用的遞迴式定義，比硬背棋型字串可靠得多。
 * ------------------------------------------------------------------ */

import { putSticker, stickerView } from './stickers';

const SIZE = 15;
const LOG_MAX = 40;
const BLACK = 1;
const WHITE = 2;
const DIRS = [
  [1, 0], // ─
  [0, 1], // │
  [1, 1], // ╲
  [1, -1], // ╱
];

const idx = (x, y) => y * SIZE + x;
const inB = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;
const other = (s) => (s === 'a' ? 'b' : 'a');
const seatName = (s) => (s === 'a' ? '玩家 A' : '玩家 B');
const colorName = (c) => (c === BLACK ? '黑' : '白');

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function pushLog(gm, text) {
  gm.log.unshift({ text, ts: Date.now() });
  if (gm.log.length > LOG_MAX) gm.log.length = LOG_MAX;
}

/* ================= 棋型工具 ================= */

// (x,y) 往 dir 兩側連續同色的長度與跨度（s = 往負方向幾格、e = 往正方向幾格）
function runSpan(board, x, y, c, dx, dy) {
  let s = 0;
  let e = 0;
  while (inB(x - dx * (s + 1), y - dy * (s + 1)) && board[idx(x - dx * (s + 1), y - dy * (s + 1))] === c) s++;
  while (inB(x + dx * (e + 1), y + dy * (e + 1)) && board[idx(x + dx * (e + 1), y + dy * (e + 1))] === c) e++;
  return { s, e, len: s + e + 1 };
}

// 沿 dir，哪些空點補下去會連成五（且該五連包含 (x,y)）
function fivePoints(board, x, y, c, dx, dy) {
  const pts = [];
  for (let k = -4; k <= 4; k++) {
    if (k === 0) continue;
    const px = x + dx * k;
    const py = y + dy * k;
    if (!inB(px, py) || board[idx(px, py)] !== 0) continue;
    board[idx(px, py)] = c;
    const { s, e, len } = runSpan(board, px, py, c, dx, dy);
    // (x,y) 相對於補點 px,py 的位移是 -k；要落在這段連續棋子的範圍內
    if (len >= 5 && -k >= -s && -k <= e) pts.push([px, py]);
    board[idx(px, py)] = 0;
  }
  return pts;
}

/**
 * (x,y) 這顆子在 dir 方向上構成什麼威脅。
 * @returns 'four_open'（活四）| 'four'（死四／沖四）| 'three_open'（活三）| null
 */
function threatAt(board, x, y, c, dx, dy) {
  const fp = fivePoints(board, x, y, c, dx, dy);
  if (fp.length >= 2) return 'four_open';
  if (fp.length === 1) return 'four';

  // 還不是四 → 看看補一手能不能變活四；能的話現在就是活三
  for (let k = -4; k <= 4; k++) {
    if (k === 0) continue;
    const px = x + dx * k;
    const py = y + dy * k;
    if (!inB(px, py) || board[idx(px, py)] !== 0) continue;
    board[idx(px, py)] = c;
    const n = fivePoints(board, x, y, c, dx, dy).length;
    board[idx(px, py)] = 0;
    if (n >= 2) return 'three_open';
  }
  return null;
}

// 沿 dir 把同一組棋型的己方棋子收集起來（允許中間隔一格，供「跳三」正確框選）
function chainStones(board, x, y, c, dx, dy) {
  const out = [[x, y]];
  for (const sgn of [1, -1]) {
    let gapUsed = false;
    for (let k = 1; k <= 5; k++) {
      const px = x + dx * k * sgn;
      const py = y + dy * k * sgn;
      if (!inB(px, py)) break;
      const v = board[idx(px, py)];
      if (v === c) out.push([px, py]);
      else if (v === 0 && !gapUsed) gapUsed = true;
      else break;
    }
  }
  return out;
}

// 落子後是否連成五（含長連，本遊戲不禁長連）
function makesFive(board, x, y, c) {
  for (const [dx, dy] of DIRS) {
    if (runSpan(board, x, y, c, dx, dy).len >= 5) return true;
  }
  return false;
}

// 勝利的那五（含以上）顆子，給前端亮線用
function winLineOf(board, x, y, c) {
  for (const [dx, dy] of DIRS) {
    const { s, len } = runSpan(board, x, y, c, dx, dy);
    if (len >= 5) {
      const out = [];
      for (let k = -s; k < -s + len; k++) out.push([x + dx * k, y + dy * k]);
      return out;
    }
  }
  return null;
}

/**
 * 黑棋在 (x,y) 落子會犯哪一種禁手。
 * @returns 'overline'（長連）| 'double_four'（四四）| 'double_three'（三三）| null（合法）
 *
 * 判定順序照連珠慣例：先看五連（優先於一切）→ 長連 → 四四 → 三三。
 * 「正好五子」永遠合法且直接判勝，即使同一手也構成四四或三三。
 */
export function forbiddenKind(board, x, y) {
  if (board[idx(x, y)] !== 0) return null;
  board[idx(x, y)] = BLACK;

  let maxRun = 0;
  for (const [dx, dy] of DIRS) {
    const { len } = runSpan(board, x, y, BLACK, dx, dy);
    if (len > maxRun) maxRun = len;
  }

  let kind = null;
  if (maxRun === 5) {
    kind = null; // 五連優先，直接判勝
  } else if (maxRun >= 6) {
    kind = 'overline'; // 長連禁手
  } else {
    // 一手做出幾個四、幾個活三。四四優先於三三（一手可能兩者都犯）
    let fours = 0;
    let threes = 0;
    for (const [dx, dy] of DIRS) {
      const t = threatAt(board, x, y, BLACK, dx, dy);
      if (t === 'four' || t === 'four_open') fours++;
      else if (t === 'three_open') threes++;
    }
    if (fours >= 2) kind = 'double_four';
    else if (threes >= 2) kind = 'double_three';
  }

  board[idx(x, y)] = 0;
  return kind;
}

export function isForbidden(board, x, y) {
  return forbiddenKind(board, x, y) !== null;
}

// 目前盤面上黑棋所有的禁手點，附帶種類（前端做 tooltip 用）
function forbiddenPoints(board) {
  const out = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[idx(x, y)] !== 0) continue;
      const kind = forbiddenKind(board, x, y);
      if (kind) out.push([x, y, kind]);
    }
  }
  return out;
}

const FORBIDDEN_ERROR = {
  overline: 'FORBIDDEN_66',
  double_four: 'FORBIDDEN_44',
  double_three: 'FORBIDDEN_33',
};

/**
 * 掃描整個盤面上雙方的活三／死四（友善模式用）。
 * 同一條線上的每顆子都會回報同一個棋型，所以用「方向＋成員座標」去重。
 */
function scanThreats(board) {
  const seen = new Set();
  const out = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = board[idx(x, y)];
      if (c === 0) continue;
      for (let d = 0; d < DIRS.length; d++) {
        const [dx, dy] = DIRS[d];
        const kind = threatAt(board, x, y, c, dx, dy);
        if (kind !== 'three_open' && kind !== 'four' && kind !== 'four_open') continue;
        const stones = chainStones(board, x, y, c, dx, dy).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
        const key = `${d}|${kind}|${stones.map((p) => p.join(',')).join(';')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ color: c, kind, stones });
      }
    }
  }
  return out;
}

/* ================= 建房／加入 ================= */

export function createGomokuRoom({ code, seriesMode = 'BO1', boardMode = 'normal' }) {
  return {
    code,
    type: 'gomoku',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { a: randomToken(), b: null },
    chat: [],
    boardMode: boardMode === 'friendly' ? 'friendly' : 'normal',
    series: makeSeries(seriesMode),
    gm: null,
  };
}

function makeSeries(mode) {
  const need = mode === 'BO5' ? 3 : mode === 'BO3' ? 2 : 1;
  return { mode, need, wins: { a: 0, b: 0 }, gameNo: 0, over: false, champion: null };
}

export function gomokuRoleOf(room, token) {
  if (!token) return null;
  if (room.tokens.a === token) return 'a';
  if (room.tokens.b && room.tokens.b === token) return 'b';
  return null;
}

export function joinGomokuRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.b = randomToken();
  room.status = 'playing';
  startGame(room);
  return { seat: 'b', token: room.tokens.b };
}

/* ================= 一場 ================= */

function startGame(room) {
  room.series.gameNo += 1;
  // 執黑（先手）每一場輪換，BO3/BO5 才不會有人一直吃禁手
  const blackSeat = room.series.gameNo % 2 === 1 ? 'a' : 'b';
  room.gm = {
    phase: 'playing', // playing | gameover
    board: new Array(SIZE * SIZE).fill(0),
    blackSeat,
    turn: BLACK,
    moves: 0,
    last: null,
    winner: null, // 'a' | 'b' | null（null 且 phase=gameover 代表和局）
    winLine: null,
    threats: [],
    forbidden: [],
    log: [],
    seq: 0,
  };
  pushLog(room.gm, `⚫ 第 ${room.series.gameNo} 場開始——${seatName(blackSeat)} 執黑先手（${room.series.mode}）`);
  refreshAnalysis(room);
}

// 每次盤面變動後重算：禁手點（輪到黑才需要）＋ 友善模式的棋型掃描
function refreshAnalysis(room) {
  const gm = room.gm;
  gm.forbidden = gm.phase === 'playing' && gm.turn === BLACK ? forbiddenPoints(gm.board) : [];
  gm.threats = room.boardMode === 'friendly' ? scanThreats(gm.board) : [];
}

const seatOfColor = (gm, c) => (c === BLACK ? gm.blackSeat : other(gm.blackSeat));
const colorOfSeat = (gm, s) => (s === gm.blackSeat ? BLACK : WHITE);

// 落子：payload { x, y }
export function actGomokuPlace(room, role, payload) {
  const gm = room.gm;
  if (!gm) throw new Error('NOT_STARTED');
  if (gm.phase !== 'playing') throw new Error('GAME_OVER');
  if (colorOfSeat(gm, role) !== gm.turn) throw new Error('NOT_YOUR_TURN');

  const x = Number(payload?.x);
  const y = Number(payload?.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inB(x, y)) throw new Error('BAD_INPUT');
  if (gm.board[idx(x, y)] !== 0) throw new Error('OCCUPIED');

  const c = gm.turn;
  // ★ 禁手：黑方的三三／四四／長連（該手若直接成「正好五子」則不受限）
  if (c === BLACK) {
    const kind = forbiddenKind(gm.board, x, y);
    if (kind) throw new Error(FORBIDDEN_ERROR[kind]);
  }

  gm.board[idx(x, y)] = c;
  gm.moves += 1;
  gm.last = { x, y };

  if (makesFive(gm.board, x, y, c)) {
    gm.phase = 'gameover';
    gm.winner = seatOfColor(gm, c);
    gm.winLine = winLineOf(gm.board, x, y, c);
    pushLog(gm, `🏆 ${colorName(c)}方（${seatName(gm.winner)}）連成五子，勝！`);
    settleGame(room);
    gm.seq += 1;
    refreshAnalysis(room);
    return;
  }

  if (gm.moves >= SIZE * SIZE) {
    gm.phase = 'gameover';
    gm.winner = null;
    pushLog(gm, '🤝 棋盤下滿，和局');
    settleGame(room);
    gm.seq += 1;
    refreshAnalysis(room);
    return;
  }

  gm.turn = c === BLACK ? WHITE : BLACK;
  gm.seq += 1;
  refreshAnalysis(room);
}

// 認輸
export function actGomokuResign(room, role) {
  const gm = room.gm;
  if (!gm || gm.phase !== 'playing') throw new Error('WRONG_PHASE');
  gm.phase = 'gameover';
  gm.winner = other(role);
  pushLog(gm, `🏳️ ${seatName(role)} 認輸——${seatName(gm.winner)} 勝`);
  settleGame(room);
  gm.seq += 1;
  refreshAnalysis(room);
}

/* ================= 系列賽 ================= */

function settleGame(room) {
  const gm = room.gm;
  const series = room.series;
  if (!gm.winner) return;
  series.wins[gm.winner] += 1;
  if (series.wins[gm.winner] >= series.need) {
    series.over = true;
    series.champion = gm.winner;
    pushLog(gm, `🏆 ${seatName(gm.winner)} 贏得系列賽（${series.wins.a}:${series.wins.b}）`);
  }
}

export function actGomokuNextGame(room, role) {
  const gm = room.gm;
  if (!gm || gm.phase !== 'gameover') throw new Error('WRONG_PHASE');
  if (room.series.over) throw new Error('SERIES_OVER');
  gm.nextReady = gm.nextReady || {};
  gm.nextReady[role] = true;
  if (gm.nextReady.a && gm.nextReady.b) startGame(room);
}

export function actGomokuRematch(room, role) {
  if (!room.series.over) throw new Error('WRONG_PHASE');
  room.gm.rematch = room.gm.rematch || {};
  room.gm.rematch[role] = true;
  if (room.gm.rematch.a && room.gm.rematch.b) {
    room.series = makeSeries(room.series.mode);
    startGame(room);
  }
}

/* ================= 貼圖 ================= */

const GM_STICKERS = ['taunt_1', 'taunt_2'];

export function actGomokuSticker(room, role, payload) {
  const gm = room.gm;
  if (!gm) throw new Error('NOT_STARTED');
  const name = payload?.name;
  if (!GM_STICKERS.includes(name)) throw new Error('BAD_INPUT');
  // 不設次數／間隔限制；狀態掛在 room 上，換場才不會把 seq 歸零（見 lib/stickers.js）
  putSticker(room, role, name);
}

/* ================= 視野 ================= */

export function gomokuViewFor(room, role) {
  const gm = room.gm;
  const series = room.series;
  const opp = other(role);

  const base = {
    type: 'gomoku',
    code: room.code,
    status: room.status,
    role,
    boardMode: room.boardMode,
    size: SIZE,
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

  if (!gm) return { ...base, phase: 'waiting' };

  const myColor = colorOfSeat(gm, role);
  // 友善模式：同一方同時有兩個以上威脅 → 前端在旁邊空白處秀提示圖
  const counts = { [BLACK]: 0, [WHITE]: 0 };
  for (const t of gm.threats) counts[t.color] += 1;

  return {
    ...base,
    phase: gm.phase,
    board: gm.board,
    myColor,
    blackSeat: gm.blackSeat,
    iAmBlack: myColor === BLACK,
    turn: gm.turn,
    myTurn: gm.phase === 'playing' && gm.turn === myColor,
    moves: gm.moves,
    last: gm.last,
    // 禁手點只有輪到黑方時才有意義；只發給黑方自己（白方看了也沒用）
    forbidden: myColor === BLACK ? gm.forbidden : [],
    threats: gm.threats,
    alert: { black: counts[BLACK] >= 2, white: counts[WHITE] >= 2 },
    myAlert: counts[myColor] >= 2,
    oppAlert: counts[myColor === BLACK ? WHITE : BLACK] >= 2,
    winner: gm.winner,
    iWon: gm.winner === role,
    winLine: gm.winLine,
    stickers: stickerView(room),
    log: gm.log,
    seq: gm.seq,
  };
}
