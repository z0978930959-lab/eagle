/* ------------------------------------------------------------------
 * 你畫我猜．合作猜詞（drawguess）
 *
 * 兩位玩家共用一個總分，輪流當「畫的人 / 猜的人」：
 *   ‧ 第 1、3、5… 回合：玩家 A 畫、玩家 B 猜
 *   ‧ 第 2、4、6… 回合：玩家 B 畫、玩家 A 猜
 *
 * 一個回合的節奏：
 *   draw  ── 畫的人有 60 秒作圖（黑/紅 × 粗/中/細），筆畫即時同步給猜方；
 *            猜方看得到畫面與「幾個字」提示，可隨時打字猜。
 *            畫的人也可提早按「畫好了」進入猜題階段。
 *   guess ── 作圖結束後定格於當下圖畫，猜方有 30 秒打字猜。
 *   reveal── 公佈答案：猜中則共用總分 +1；沒猜中不加分。
 *   over  ── 設定的回合數（5 / 10 / 15）跑完，顯示總分。
 *
 * 計時：deadline 為伺服器端絕對時間戳。狀態路由不會自動存檔，
 *       所以「時間到」的相位轉換由前端輪詢後呼叫 dg_finish_draw /
 *       dg_timeout_guess 觸發（伺服器再以 deadline 把關，雙方可同時呼叫，
 *       靠相位判斷冪等，不會重複結算）。
 * ------------------------------------------------------------------ */

import { drawOneWord } from './drawWordBank';
import { putSticker, stickerView } from './stickers';

export const DRAW_SECONDS = 60;
export const GUESS_SECONDS = 30;
export const ROUND_OPTIONS = [5, 10, 15];

// 畫布可用的顏色與筆寬（前後端共用；前端依索引對照實際色碼與線寬）
export const DRAW_COLORS = ['#111111', '#d23b3b']; // 黑、紅
export const DRAW_WIDTHS = [3, 7, 13]; // 細、中、粗

// 筆畫資料上限（避免 Redis 值無限膨脹）
const MAX_STROKES = 400;
const MAX_POINTS_PER_STROKE = 800; // 每個數字為一個座標分量，故 400 個 (x,y) 點
const MAX_TOTAL_NUMS = 24000; // 全部筆畫的座標分量總數上限
const COORD_MAX = 1000; // 座標正規化到 0~1000 的整數
const LOG_MAX = 30;

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function clampInt(v, lo, hi) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
function pushLog(dg, text) {
  dg.log.unshift({ text, ts: Date.now() });
  if (dg.log.length > LOG_MAX) dg.log.length = LOG_MAX;
}

// 猜詞正規化：去掉空白與標點，轉小寫，只留下可辨識字元
function normalizeGuess(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·、，。！？!?.,~～\-—_（）()\[\]{}「」『』"'’“”:：;；]/g, '')
    .trim();
}

// 每回合由誰畫：第 0、2、4…（1、3、5 回合）由 a 畫；奇數索引由 b 畫
function drawerOf(roundIndex) {
  return roundIndex % 2 === 0 ? 'a' : 'b';
}

function totalNums(strokes) {
  let n = 0;
  for (const s of strokes) n += s.p.length;
  return n;
}

// 開始一個新回合：抽題、清空筆畫、設定 60 秒作圖倒數
function startRound(dg) {
  const pick = drawOneWord(dg.usedWords);
  dg.usedWords.push(pick.w);
  dg.word = pick;
  dg.strokes = [];
  dg.guessLog = [];
  dg.lastResult = null;
  dg.phase = 'draw';
  dg.deadline = Date.now() + DRAW_SECONDS * 1000;
  dg.seq += 1;
  const drawer = drawerOf(dg.roundIndex);
  pushLog(dg, `🖌️ 第 ${dg.roundIndex + 1} 回合：${drawer === 'a' ? '玩家 A' : '玩家 B'} 作畫`);
}

export function createDrawGuessRoom({ code, rounds }) {
  const roundsTotal = ROUND_OPTIONS.includes(Number(rounds)) ? Number(rounds) : 10;
  const room = {
    code,
    type: 'drawguess',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { a: randomToken(), b: null },
    chat: [],
    dg: {
      roundsTotal,
      roundIndex: 0,
      roundsDone: 0,
      score: 0,
      phase: 'draw',
      word: null,
      usedWords: [],
      strokes: [],
      guessLog: [],
      deadline: null,
      lastResult: null,
      log: [],
      seq: 0,
    },
  };
  return room;
}

export function drawGuessRoleOf(room, token) {
  if (!token) return null;
  if (room.tokens.a === token) return 'a';
  if (room.tokens.b && room.tokens.b === token) return 'b';
  return null;
}

export function joinDrawGuessRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.b = randomToken();
  room.status = 'playing';
  // 對手到齊，正式開第一回合
  startRound(room.dg);
  pushLog(room.dg, '🎨 對手已加入——遊戲開始！');
  return { seat: 'b', token: room.tokens.b };
}

// ── 動作：畫的人送出筆畫（一批新完成的筆畫）──
export function actDgStroke(room, seat, payload) {
  const dg = room.dg;
  if (dg.phase !== 'draw') throw new Error('WRONG_PHASE');
  if (drawerOf(dg.roundIndex) !== seat) throw new Error('NOT_YOUR_TURN');
  const incoming = Array.isArray(payload?.strokes) ? payload.strokes : null;
  if (!incoming) throw new Error('BAD_INPUT');

  for (const raw of incoming) {
    if (dg.strokes.length >= MAX_STROKES) break;
    if (totalNums(dg.strokes) >= MAX_TOTAL_NUMS) break;
    const c = clampInt(raw?.c, 0, DRAW_COLORS.length - 1);
    const w = clampInt(raw?.w, 0, DRAW_WIDTHS.length - 1);
    const pRaw = Array.isArray(raw?.p) ? raw.p : [];
    const p = [];
    for (let i = 0; i + 1 < pRaw.length && p.length < MAX_POINTS_PER_STROKE; i += 2) {
      p.push(clampInt(pRaw[i], 0, COORD_MAX), clampInt(pRaw[i + 1], 0, COORD_MAX));
    }
    if (p.length >= 2) dg.strokes.push({ c, w, p });
  }
  dg.seq += 1;
}

// ── 動作：畫的人清空畫布 ──
export function actDgClear(room, seat) {
  const dg = room.dg;
  if (dg.phase !== 'draw') throw new Error('WRONG_PHASE');
  if (drawerOf(dg.roundIndex) !== seat) throw new Error('NOT_YOUR_TURN');
  dg.strokes = [];
  dg.seq += 1;
}

// ── 動作：作圖結束 → 進入 30 秒猜題（畫的人可提早按；或時間到由任一方觸發）──
export function actDgFinishDraw(room, seat) {
  const dg = room.dg;
  if (dg.phase !== 'draw') return; // 已轉相位：冪等，不報錯
  const isDrawer = drawerOf(dg.roundIndex) === seat;
  const expired = dg.deadline != null && Date.now() >= dg.deadline - 1200;
  if (!isDrawer && !expired) return; // 非畫的人、且時間還沒到 → 忽略
  dg.phase = 'guess';
  dg.deadline = Date.now() + GUESS_SECONDS * 1000;
  dg.seq += 1;
  pushLog(dg, expired && !isDrawer ? '⏱️ 作圖時間到，圖畫定格——開始猜題！' : '✏️ 畫好了！開始猜題');
}

// ── 動作：猜的人打字猜（draw 或 guess 階段皆可）──
export function actDgGuess(room, seat, payload) {
  const dg = room.dg;
  if (dg.phase !== 'draw' && dg.phase !== 'guess') throw new Error('WRONG_PHASE');
  if (drawerOf(dg.roundIndex) === seat) throw new Error('NOT_YOUR_TURN'); // 畫的人不能猜
  const text = String(payload?.text ?? '').trim().slice(0, 30);
  if (!text) throw new Error('BAD_INPUT');

  const correct = dg.word && normalizeGuess(text) === normalizeGuess(dg.word.w);
  dg.guessLog.unshift({ by: seat, text, correct, ts: Date.now() });
  if (dg.guessLog.length > 12) dg.guessLog.length = 12;
  dg.seq += 1;

  if (correct) {
    dg.score += 1;
    dg.lastResult = 'correct';
    dg.phase = 'reveal';
    dg.deadline = null;
    pushLog(dg, `✅ 猜中「${dg.word.w}」——總分 +1（目前 ${dg.score} 分）`);
  }
}

// ── 動作：時間到沒猜中 → 進入公佈（由任一方在猜題時限過後觸發）──
export function actDgTimeoutGuess(room, seat) {
  const dg = room.dg;
  if (dg.phase !== 'guess') return; // 冪等
  const expired = dg.deadline != null && Date.now() >= dg.deadline - 1200;
  if (!expired) return;
  dg.phase = 'reveal';
  dg.lastResult = 'timeout';
  dg.deadline = null;
  dg.seq += 1;
  pushLog(dg, `⏳ 時間到——答案是「${dg.word.w}」`);
}

// ── 動作：猜的人放棄本回合 ──
export function actDgGiveUp(room, seat) {
  const dg = room.dg;
  if (dg.phase !== 'draw' && dg.phase !== 'guess') throw new Error('WRONG_PHASE');
  if (drawerOf(dg.roundIndex) === seat) throw new Error('NOT_YOUR_TURN');
  dg.phase = 'reveal';
  dg.lastResult = 'giveup';
  dg.deadline = null;
  dg.seq += 1;
  pushLog(dg, `🚪 放棄本回合——答案是「${dg.word.w}」`);
}

// ── 動作：下一回合（公佈畫面，任一方可按）──
export function actDgNext(room, seat) {
  const dg = room.dg;
  if (dg.phase !== 'reveal') throw new Error('WRONG_PHASE');
  dg.roundsDone += 1;
  if (dg.roundsDone >= dg.roundsTotal) {
    dg.phase = 'over';
    dg.deadline = null;
    dg.seq += 1;
    pushLog(dg, `🏁 全部 ${dg.roundsTotal} 回合結束，總分 ${dg.score} 分`);
    return;
  }
  dg.roundIndex += 1;
  startRound(dg);
}

// ── 動作：再玩一局（結束後，沿用同房、同回合數重開）──
export function actDgRematch(room, seat) {
  const dg = room.dg;
  if (dg.phase !== 'over') throw new Error('WRONG_PHASE');
  dg.roundIndex = 0;
  dg.roundsDone = 0;
  dg.score = 0;
  dg.usedWords = [];
  startRound(dg);
  pushLog(dg, '🔁 再玩一局！');
}

const DG_STICKERS = ['taunt_1', 'taunt_2', 'taunt_3', 'taunt_4'];
export function actDgSticker(room, seat, payload) {
  const name = payload?.name;
  if (!DG_STICKERS.includes(name)) throw new Error('BAD_INPUT');
  putSticker(room, seat, name);
}

export function drawGuessViewFor(room, seat) {
  const dg = room.dg;
  const drawer = drawerOf(dg.roundIndex);
  const iAmDrawer = drawer === seat;
  const revealing = dg.phase === 'reveal' || dg.phase === 'over';
  const now = Date.now();
  const secondsLeft =
    dg.deadline != null ? Math.max(0, Math.ceil((dg.deadline - now) / 1000)) : null;

  // 答案：畫的人隨時看得到；猜的人只有公佈時看得到
  const wordShown = iAmDrawer || revealing ? dg.word?.w ?? null : null;
  const hint =
    dg.word && !iAmDrawer && !revealing
      ? { count: [...dg.word.w].length, category: dg.word.c }
      : null;

  return {
    type: 'drawguess',
    code: room.code,
    status: room.status,
    seat,
    oppJoined: !!room.tokens.b,
    roundsTotal: dg.roundsTotal,
    round: dg.roundIndex + 1, // 1-based 顯示用
    roundsDone: dg.roundsDone,
    score: dg.score,
    phase: dg.phase,
    drawerSeat: drawer,
    iAmDrawer,
    iAmGuesser: !iAmDrawer,
    deadline: dg.deadline,
    serverNow: now,
    secondsLeft,
    drawSeconds: DRAW_SECONDS,
    guessSeconds: GUESS_SECONDS,
    colors: DRAW_COLORS,
    widths: DRAW_WIDTHS,
    coordMax: COORD_MAX,
    strokes: dg.strokes,
    guessLog: dg.guessLog,
    lastResult: dg.lastResult,
    word: wordShown,
    wordCategory: revealing ? dg.word?.c ?? null : iAmDrawer ? dg.word?.c ?? null : null,
    hint,
    stickers: stickerView(room),
    log: dg.log,
    seq: dg.seq,
  };
}
