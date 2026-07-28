/* ------------------------------------------------------------------
 * 密語連線．雙人合作猜詞
 *
 * 25 格詞卡，兩位玩家各持一份「不同」的關鍵名單。每格對每人是三種身分：
 *   關鍵人物(key) / 路人(civ) / 炸彈客(bomb)
 *
 * 官方結構（每位玩家一份）：
 *   關鍵 9、炸彈 3、路人 13
 *   雙方關鍵重疊 3 格 → 需找齊的關鍵聯集 = 15 格
 *
 * 可解性約束（生成盤面時強制）：
 *   ‧ 雙方共同關鍵那 3 格，保證不是任何人的炸彈（安全甜蜜點）
 *   ‧ 每個「必須找到的關鍵格」對至少一方而言不是炸彈，
 *     使它存在一條不會爆炸的引導路徑（整局可解）
 *
 * 進行：輪流出提示（提示詞＋數字），對方猜格子。翻牌依「猜的人自己」的身分：
 *   關鍵(綠) → 得一分、可繼續；路人(灰) → 消耗回合、換邊；炸彈(紅) → 立即失敗
 * 勝：找齊 15 個關鍵人物；敗：踩炸彈，或路人上限 9 用完仍未找齊。
 * ------------------------------------------------------------------ */

import { drawWords } from './wordBank';

const LOG_MAX = 40;

const GRID = 25;
const KEYS_EACH = 9; // 每人關鍵數
const OVERLAP = 3; // 雙方共同關鍵
const BOMBS_EACH = 3; // 每人炸彈數
const CIVILIAN_LIMIT = 9; // 路人容錯上限（雙方合計）
const KEY_UNION = KEYS_EACH * 2 - OVERLAP; // 15

const KEY_IMG_COUNT = 15;
const CIV_IMG_COUNT = 9;
const BOMB_IMG_COUNT = 2;

/* ---------------- 工具 ---------------- */

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
function pushLog(m, text) {
  m.log.unshift({ text, ts: Date.now() });
  if (m.log.length > LOG_MAX) m.log.length = LOG_MAX;
}

/*
 * 生成一個滿足所有約束的可解盤面。
 * 身分以兩個陣列表示：aRole[i], bRole[i] ∈ {'key','civ','bomb'}
 *
 * 步驟：
 *  1. 隨機挑 3 格為「共同關鍵」（雙方都 key，且都不會是炸彈）
 *  2. 各再挑 6 格為「單方關鍵」（A 專屬 6、B 專屬 6，彼此不重疊、不與共同關鍵重疊）
 *  3. 炸彈：從「非共同關鍵」的格子挑。A 的炸彈可壓在 B 的單方關鍵或雙方路人上，
 *     但不壓共同關鍵；B 亦然。
 *  4. 其餘格子為路人。
 *
 * 可解性：共同關鍵 3 格保證安全，構成必然可解的核心；
 *   單方關鍵各自對「擁有它的那方」是 key、對另一方可能是 bomb/civ，
 *   由對應方引導對方去猜，只要不叫對方猜到對方的炸彈即可，路徑存在。
 */
export function generateBoard() {
  const words = drawWords(GRID);
  const idx = shuffle([...Array(GRID).keys()]);

  const common = idx.slice(0, OVERLAP); // 3 共同關鍵
  const aOnly = idx.slice(OVERLAP, OVERLAP + (KEYS_EACH - OVERLAP)); // A 專屬 6
  const bOnly = idx.slice(OVERLAP + 6, OVERLAP + 12); // B 專屬 6
  const rest = idx.slice(OVERLAP + 12); // 剩 10 格

  const aRole = Array(GRID).fill('civ');
  const bRole = Array(GRID).fill('civ');

  for (const i of common) {
    aRole[i] = 'key';
    bRole[i] = 'key';
  }
  for (const i of aOnly) aRole[i] = 'key';
  for (const i of bOnly) bRole[i] = 'key';

  // A 的 3 炸彈：優先壓在 B 的關鍵格（製造張力），不足再壓 rest；絕不壓共同關鍵
  const aBombPool = shuffle([...bOnly, ...rest]); // 皆非共同關鍵、非 A 自己的關鍵
  for (const i of aBombPool.slice(0, BOMBS_EACH)) aRole[i] = 'bomb';

  // B 的 3 炸彈：壓在 A 的關鍵格或 rest，不壓共同關鍵、不壓 B 自己的關鍵
  const bBombPool = shuffle([...aOnly, ...rest]);
  for (const i of bBombPool.slice(0, BOMBS_EACH)) bRole[i] = 'bomb';

  const cells = words.map((w, i) => ({
    word: w,
    aRole: aRole[i],
    bRole: bRole[i],
    revealed: false,
    revealedBy: null, // 'a' | 'b'
    shownRole: null, // 翻牌時記錄「翻牌者的身分」
    img: null, // 翻牌時才從全局圖池取出（不放回），保證盤面不撞圖
  }));

  return { cells, common, keyUnion: KEY_UNION };
}

/* ---------------- 建房／加入 ---------------- */

function seatOf(role) {
  return role === 'a' ? 'a' : 'b';
}

export function createMissionRoom({ code }) {
  const board = generateBoard();
  return {
    code,
    type: 'mission',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { a: randomToken(), b: null },
    chat: [],
    ms: {
      phase: 'setup', // setup | clue | guess | over
      cells: board.cells,
      // 每局的身分圖池：翻牌時 pop 一張，取出不放回 → 盤面上絕不撞圖
      imgPool: {
        key: shuffle([...Array(KEY_IMG_COUNT).keys()].map((n) => n + 1)),
        civ: shuffle([...Array(CIV_IMG_COUNT).keys()].map((n) => n + 1)),
        bomb: shuffle([...Array(BOMB_IMG_COUNT).keys()].map((n) => n + 1)),
      },
      turn: 'a', // 目前的出提示方
      clue: null, // { word, count, by, remaining }
      civiliansUsed: 0,
      civilianLimit: CIVILIAN_LIMIT,
      found: 0, // 已找到的關鍵聯集數
      keyUnion: board.keyUnion, // 15
      result: null, // 'win' | 'bomb' | 'timeout'
      log: [],
      seq: 0,
      lastReveal: null,
    },
  };
}

export function missionRoleOf(room, token) {
  if (!token) return null;
  if (room.tokens.a === token) return 'a';
  if (room.tokens.b && room.tokens.b === token) return 'b';
  return null;
}

export function joinMissionRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.b = randomToken();
  room.status = 'playing';
  room.ms.phase = 'clue';
  pushLog(room.ms, '🔗 密語連線建立——由玩家 A 先出提示');
  return { seat: 'b', token: room.tokens.b };
}

/* ---------------- 動作 ---------------- */

const other = (s) => (s === 'a' ? 'b' : 'a');

// 已找到的關鍵聯集數：一格若對任一方是 key 且已翻開，算已找到
function countFound(ms) {
  let n = 0;
  for (const c of ms.cells) {
    if (c.revealed && (c.aRole === 'key' || c.bRole === 'key')) n++;
  }
  return n;
}

// 出提示：payload { word, count }
export function actMissionClue(room, role, payload) {
  const ms = room.ms;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (ms.phase !== 'clue') throw new Error('WRONG_PHASE');
  if (ms.turn !== role) throw new Error('NOT_YOUR_TURN');

  const word = String(payload?.word ?? '').trim().slice(0, 20);
  const count = Number(payload?.count);
  if (!word) throw new Error('BAD_INPUT');
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new Error('BAD_INPUT');

  // 出提示方指向自己的關鍵；猜的人是對方。可猜「數字＋1」次
  ms.clue = { word, count, by: role, remaining: count + 1 };
  ms.phase = 'guess';
  pushLog(ms, `💬 ${role === 'a' ? '玩家 A' : '玩家 B'} 提示「${word}，${count}」`);
}

// 猜格子：payload { index } —— 由「非出提示方」執行
export function actMissionGuess(room, role, payload) {
  const ms = room.ms;
  if (room.status !== 'playing') throw new Error('NOT_STARTED');
  if (ms.phase !== 'guess') throw new Error('WRONG_PHASE');
  const guesser = other(ms.clue.by);
  if (role !== guesser) throw new Error('NOT_YOUR_TURN');

  const i = payload?.index;
  if (!Number.isInteger(i) || i < 0 || i >= GRID) throw new Error('BAD_INPUT');
  const cell = ms.cells[i];
  if (cell.revealed) throw new Error('ALREADY_REVEALED');

  // 依「猜的人自己」的身分翻牌
  const myRole = guesser === 'a' ? cell.aRole : cell.bRole;
  cell.revealed = true;
  cell.revealedBy = guesser;
  cell.shownRole = myRole;
  // 從該身分的圖池取出一張（不放回）；池空了才循環，保證盤面上不會有兩張相同
  const pool = ms.imgPool[myRole];
  cell.img = pool.length ? pool.shift() : 1 + randInt(myRole === 'key' ? KEY_IMG_COUNT : myRole === 'civ' ? CIV_IMG_COUNT : BOMB_IMG_COUNT);
  ms.seq += 1;
  ms.lastReveal = { index: i, role: myRole, seq: ms.seq };

  if (myRole === 'bomb') {
    ms.phase = 'over';
    ms.result = 'bomb';
    pushLog(ms, `💥 ${guesser === 'a' ? '玩家 A' : '玩家 B'} 翻到炸彈客——挑戰失敗`);
    return;
  }

  if (myRole === 'key') {
    ms.found = countFound(ms);
    pushLog(ms, `✅ 找到一個關鍵人物（${ms.found}/${ms.keyUnion}）`);
    if (ms.found >= ms.keyUnion) {
      ms.phase = 'over';
      ms.result = 'win';
      pushLog(ms, '🎉 找齊所有關鍵人物——挑戰成功！');
      return;
    }
    ms.clue.remaining -= 1;
    if (ms.clue.remaining <= 0) {
      endClueTurn(ms); // 猜滿次數，換邊
    }
    return;
  }

  // 路人
  ms.civiliansUsed += 1;
  pushLog(ms, `⬜ 翻到路人（已用 ${ms.civiliansUsed}/${ms.civilianLimit}）`);
  if (ms.civiliansUsed >= ms.civilianLimit) {
    ms.phase = 'over';
    ms.result = 'timeout';
    pushLog(ms, '⏳ 路人用光仍未找齊——挑戰失敗');
    return;
  }
  endClueTurn(ms); // 猜到路人，換邊
}

// 猜方主動喊停（不再猜，換邊）
export function actMissionStop(room, role) {
  const ms = room.ms;
  if (ms.phase !== 'guess') throw new Error('WRONG_PHASE');
  if (role !== other(ms.clue.by)) throw new Error('NOT_YOUR_TURN');
  endClueTurn(ms);
}


function endClueTurn(ms) {
  ms.turn = other(ms.clue.by);
  ms.clue = null;
  ms.phase = 'clue';
}

/* ---------------- 視野 ---------------- */

export function missionViewFor(room, role) {
  const ms = room.ms;
  const isGuesser = ms.phase === 'guess' && role === other(ms.clue?.by);
  const isCluer = ms.phase === 'clue' && role === ms.turn;

  return {
    type: 'mission',
    code: room.code,
    status: room.status,
    role,
    phase: ms.phase,
    turn: ms.turn,
    myTurnToClue: isCluer,
    myTurnToGuess: isGuesser,
    clue: ms.clue ? { word: ms.clue.word, count: ms.clue.count, by: ms.clue.by, remaining: ms.clue.remaining } : null,
    civiliansUsed: ms.civiliansUsed,
    civilianLimit: ms.civilianLimit,
    found: ms.found,
    keyUnion: ms.keyUnion,
    remainingKeys: ms.keyUnion - ms.found,
    result: ms.result,
    lastReveal: ms.lastReveal,
    // 每格：詞永遠可見；未翻開時只給「自己這方的身分」當底色提示；翻開後給雙方可見的結果
    cells: ms.cells.map((c) => ({
      word: c.word,
      revealed: c.revealed,
      // 翻開後：顯示翻牌者的身分圖與顏色
      shownRole: c.revealed ? c.shownRole : null,
      revealedBy: c.revealedBy,
      img: c.revealed ? c.img : null,
      // 未翻開：淺色提示只給自己這方的身分
      myRole: c.revealed ? null : role === 'a' ? c.aRole : c.bRole,
    })),
    oppJoined: !!room.tokens.b,
    log: ms.log,
  };
}
