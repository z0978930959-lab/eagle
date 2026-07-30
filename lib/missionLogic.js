/* ------------------------------------------------------------------
 * 密語連線．單向引導猜詞（改版，取代舊的雙人合作版）
 *
 * 5×5＝25 格，一份名單。兩位玩家：
 *   ‧ 引導者(guide)：看得到全部答案（關鍵綠 / 炸彈紅 / 路人灰），給提示詞＋數字
 *   ‧ 猜的人(guesser)：看不到答案，依提示猜格子
 *
 * 難度（決定盤面組成與回合數）：
 *   簡單 easy   ─ 關鍵15 炸彈1 路人9 ─ 9 回合
 *   普通 normal ─ 關鍵15 炸彈1 路人9 ─ 8 回合
 *   困難 hard   ─ 關鍵15 炸彈2 路人8 ─ 7 回合
 *
 * 每回合：引導者給「詞＋數字 n」→ 猜方最多猜 n 次（不可超過設定值）
 *   ‧ 猜到關鍵 → 得分、可繼續（在剩餘次數內）
 *   ‧ 猜到路人 → 本回合結束（消耗一回合）
 *   ‧ 達次數上限 → 本回合結束（即使 n 次全部猜對，同樣消耗一回合）
 *   ‧ 主動放棄 → 本回合結束
 *   ‧ 猜到炸彈 → 慢動作翻出結果後，跳失敗畫面
 * 勝：找齊 15 關鍵；敗：回合用完仍未找齊，或翻到炸彈。
 * ------------------------------------------------------------------ */

import { drawWords } from './wordBank';
import { putSticker, stickerView } from './stickers';

const LOG_MAX = 40;
const GRID = 25;
const KEY_COUNT = 15;

export const DIFFICULTIES = {
  easy: { key: 15, bomb: 1, civ: 9, rounds: 9, label: '簡單' },
  normal: { key: 15, bomb: 1, civ: 9, rounds: 8, label: '普通' },
  hard: { key: 15, bomb: 2, civ: 8, rounds: 7, label: '困難' },
};

const KEY_IMG_COUNT = 15;
const CIV_IMG_COUNT = 9;
const BOMB_IMG_COUNT = 2;

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
function pushLog(ms, text) {
  ms.log.unshift({ text, ts: Date.now() });
  if (ms.log.length > LOG_MAX) ms.log.length = LOG_MAX;
}

function generateBoard(diff) {
  const cfg = DIFFICULTIES[diff] || DIFFICULTIES.normal;
  const words = drawWords(GRID);
  const roles = [
    ...Array(cfg.key).fill('key'),
    ...Array(cfg.bomb).fill('bomb'),
    ...Array(cfg.civ).fill('civ'),
  ];
  shuffle(roles);

  const keyImgs = shuffle([...Array(KEY_IMG_COUNT).keys()].map((n) => n + 1));
  const civImgs = shuffle([...Array(CIV_IMG_COUNT).keys()].map((n) => n + 1));
  const bombImgs = shuffle([...Array(BOMB_IMG_COUNT).keys()].map((n) => n + 1));
  let ki = 0, ci = 0, bi = 0;
  const imgFor = (r) =>
    r === 'key' ? keyImgs[ki++ % KEY_IMG_COUNT] : r === 'civ' ? civImgs[ci++ % CIV_IMG_COUNT] : bombImgs[bi++ % BOMB_IMG_COUNT];

  const cells = words.map((w, i) => ({
    word: w,
    role: roles[i],
    img: imgFor(roles[i]),
    revealed: false,
  }));

  return { cells, cfg };
}

export function createMissionRoom({ code, difficulty = 'normal' }) {
  const diff = DIFFICULTIES[difficulty] ? difficulty : 'normal';
  const board = generateBoard(diff);
  return {
    code,
    type: 'mission',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { a: randomToken(), b: null },
    chat: [],
    ms: {
      phase: 'pickRole',
      difficulty: diff,
      roundsTotal: board.cfg.rounds,
      roundsUsed: 0,
      cells: board.cells,
      keyTotal: KEY_COUNT,
      found: 0,
      roles: { guide: null, guesser: null },
      seatRole: { a: null, b: null },
      clue: null,
      result: null,
      lastReveal: null,
      // 貼圖狀態不放這裡：換場會重建 room.ms 導致 seq 歸零（見 lib/stickers.js）
      log: [],
      seq: 0,
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
  pushLog(room.ms, '🔗 對手已加入——請雙方選擇「引導者」或「猜的人」');
  return { seat: 'b', token: room.tokens.b };
}

// payload { role: 'guide' | 'guesser' }
export function actMissionPickRole(room, seat, payload) {
  const ms = room.ms;
  if (ms.phase !== 'pickRole') throw new Error('WRONG_PHASE');
  const role = payload?.role;
  if (role !== 'guide' && role !== 'guesser') throw new Error('BAD_INPUT');
  if (ms.roles[role] && ms.roles[role] !== seat) throw new Error('SIDE_TAKEN');

  // 先清掉此座位舊選擇（允許改選）
  const prev = ms.seatRole[seat];
  if (prev && ms.roles[prev] === seat) ms.roles[prev] = null;
  ms.seatRole[seat] = role;
  ms.roles[role] = seat;
  pushLog(ms, `${seat === 'a' ? '玩家 A' : '玩家 B'} 選擇當${role === 'guide' ? '引導者' : '猜的人'}`);
  ms.seq += 1;

  if (ms.roles.guide && ms.roles.guesser && ms.roles.guide !== ms.roles.guesser) {
    ms.phase = 'clue';
    pushLog(ms, `🚀 開始！由引導者出提示（難度：${DIFFICULTIES[ms.difficulty].label}）`);
  }
}

export function actMissionClue(room, seat, payload) {
  const ms = room.ms;
  if (ms.phase !== 'clue') throw new Error('WRONG_PHASE');
  if (ms.roles.guide !== seat) throw new Error('NOT_YOUR_TURN');
  const word = String(payload?.word ?? '').trim().slice(0, 20);
  const count = Number(payload?.count);
  if (!word) throw new Error('BAD_INPUT');
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new Error('BAD_INPUT');

  // 提示不得提到盤面上的字（字元層級比對）。
  // 盤面 25 個詞由 drawWords() 保證兩兩不共用字，所以這組禁用字約 40 個上下，
  // 不會把引導者可用的詞彙壓得太死。已翻開的格子同樣算在盤面上，
  // 讓整局的禁用字固定不變，引導者不必猜規則什麼時候變。
  const boardChars = new Set();
  for (const c of ms.cells) for (const ch of c.word) boardChars.add(ch);
  if ([...new Set(word)].some((ch) => boardChars.has(ch))) throw new Error('CLUE_ON_BOARD');

  // 猜的次數上限＝引導者設定的數字（不再送 +1 的加猜機會）
  ms.clue = { word, count, remaining: count };
  ms.phase = 'guess';
  pushLog(ms, `💬 引導者提示「${word}，${count}」`);
  ms.seq += 1;
}

export function actMissionGuess(room, seat, payload) {
  const ms = room.ms;
  if (ms.phase !== 'guess') throw new Error('WRONG_PHASE');
  if (ms.roles.guesser !== seat) throw new Error('NOT_YOUR_TURN');
  const i = payload?.index;
  if (!Number.isInteger(i) || i < 0 || i >= GRID) throw new Error('BAD_INPUT');
  const cell = ms.cells[i];
  if (cell.revealed) throw new Error('ALREADY_REVEALED');

  cell.revealed = true;
  ms.seq += 1;
  ms.lastReveal = { index: i, role: cell.role, seq: ms.seq };

  if (cell.role === 'bomb') {
    ms.phase = 'over';
    ms.result = 'bomb';
    pushLog(ms, '💥 翻到炸彈——挑戰失敗');
    return;
  }

  if (cell.role === 'key') {
    ms.found += 1;
    pushLog(ms, `✅ 找到關鍵人物（${ms.found}/${ms.keyTotal}）`);
    if (ms.found >= ms.keyTotal) {
      ms.phase = 'over';
      ms.result = 'win';
      pushLog(ms, '🎉 找齊所有關鍵人物——挑戰成功！');
      return;
    }
    ms.clue.remaining -= 1;
    // 次數用完就收回合——即使這 n 次全部猜對，也一樣消耗一個回合數
    if (ms.clue.remaining <= 0) endRound(ms);
    return;
  }

  pushLog(ms, '⬜ 翻到路人——本回合結束');
  endRound(ms);
}

export function actMissionStop(room, seat) {
  const ms = room.ms;
  if (ms.phase !== 'guess') throw new Error('WRONG_PHASE');
  if (ms.roles.guesser !== seat) throw new Error('NOT_YOUR_TURN');
  pushLog(ms, '🚪 猜方放棄本回合');
  endRound(ms);
}

function endRound(ms) {
  ms.clue = null;
  ms.roundsUsed += 1;

  if (ms.found >= ms.keyTotal) {
    ms.phase = 'over';
    ms.result = 'win';
    return;
  }
  if (ms.roundsUsed >= ms.roundsTotal) {
    ms.phase = 'over';
    ms.result = 'timeout';
    pushLog(ms, '⏳ 回合用完仍未找齊——挑戰失敗');
    return;
  }
  ms.phase = 'clue';
}

const MS_STICKERS = ['taunt_1', 'taunt_2', 'taunt_3', 'taunt_4'];

export function actMissionSticker(room, seat, payload) {
  const name = payload?.name;
  if (!MS_STICKERS.includes(name)) throw new Error('BAD_INPUT');
  // 不設任何次數或間隔限制：雙方可同時按，也可以連發。
  // 狀態掛在 room 上（見 lib/stickers.js）：BO3 換場會重建 room.ms，
  // 計數器若掛在裡面會歸零、和前端記住的舊值撞號，導致第二場之後按了沒反應。
  putSticker(room, seat, name);
}

export function missionViewFor(room, seat) {
  const ms = room.ms;
  const myRole = ms.seatRole[seat];
  const isGuide = myRole === 'guide';

  return {
    type: 'mission',
    code: room.code,
    status: room.status,
    seat,
    myRole,
    phase: ms.phase,
    difficulty: ms.difficulty,
    difficultyLabel: DIFFICULTIES[ms.difficulty].label,
    roundsTotal: ms.roundsTotal,
    roundsUsed: ms.roundsUsed,
    roundsLeft: ms.roundsTotal - ms.roundsUsed,
    keyTotal: ms.keyTotal,
    found: ms.found,
    remainingKeys: ms.keyTotal - ms.found,
    cardsLeft: ms.cells.filter((c) => !c.revealed).length,
    clue: ms.clue ? { word: ms.clue.word, count: ms.clue.count, remaining: ms.clue.remaining } : null,
    myTurnToClue: ms.phase === 'clue' && isGuide,
    myTurnToGuess: ms.phase === 'guess' && myRole === 'guesser',
    result: ms.result,
    lastReveal: ms.lastReveal,
    stickers: stickerView(room),
    rolesTaken: { guide: !!ms.roles.guide, guesser: !!ms.roles.guesser },
    oppJoined: !!room.tokens.b,
    cells: ms.cells.map((c) => ({
      word: c.word,
      revealed: c.revealed,
      role: c.revealed ? c.role : null,
      img: c.revealed ? c.img : null,
      answer: !c.revealed && isGuide ? c.role : null,
    })),
    log: ms.log,
    seq: ms.seq,
  };
}
