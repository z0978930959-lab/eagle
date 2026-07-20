import { TEAMS, ROLE_NAMES, PITCH_TYPES, SHIFTS } from '../data/teams.js';
import { resolvePitch, applyOutcome, resolveSteal, applyStealResult, applyDoubleStealResult, releaseZoneOf, releaseOffset, buildFlightPath, FIELD, clampCanvas, gradeOf, timingLabelOf } from './engine.js';

const TEAM_IDS = new Set(TEAMS.map((t) => t.id));
const PITCH_TYPE_IDS = new Set(PITCH_TYPES.map((p) => p.id));
const SHIFT_IDS = new Set(SHIFTS.map((s) => s.id));
const MODES = new Set(['take', 'normal', 'power', 'bunt']);
const STEAL_BASES = new Set(['first', 'second', 'double']);

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/* ------------ 共用工具（前後端都會 import） ------------ */

export const PHASE_MS = 35000; // 投球/打擊選擇時限 35 秒
export const RESULT_MS = 60000; // 結果畫面最長停留 60 秒，避免對手斷線鎖死遊戲
const GRACE_MS = 1500; // 伺服器判定超時的寬限（吸收網路延遲）

export function battingKey(half) {
  return half === 'top' ? 'away' : 'home';
}
export function fieldingKey(half) {
  return half === 'top' ? 'home' : 'away';
}

// 體力：0 球＝100%，投滿 64 球歸零（疲勞懲罰也在 64 球封頂）
export function staminaOf(count) {
  return Math.max(0, Math.round(100 - (count / 64) * 100));
}

export function currentPitcher(sideState) {
  const p = sideState.team.pitchers[sideState.staff.currentIdx];
  const count = sideState.staff.pitchCounts[sideState.staff.currentIdx] || 0;
  const fatigue = Math.min(16, Math.floor(count / 8) * 2);
  return {
    ...p,
    fatigue,
    stamina: staminaOf(count),
    effControl: Math.max(30, p.control - fatigue),
    effStuff: Math.max(30, p.stuff - fatigue),
    pitchCount: count,
  };
}

/* ------------ 伺服器端狀態機 ------------ */

function freshTeamState(team) {
  return {
    team,
    lineup: team.batters.map((b) => ({ ...b })),
    bench: team.bench.map((b) => ({ ...b, used: false })),
    lineupIdx: 0,
    score: 0,
    stats: freshStats(),
    // 換投次數不設硬性上限，改由牛棚人數自然限制（每個投手用過就不能再上）
    staff: { currentIdx: 0, used: [0], pitchCounts: { 0: 0 } },
  };
}

function freshStats() {
  return {
    hits: 0,
    doublesTriples: 0,
    homeRuns: 0,
    battingStrikeouts: 0,
    pitchingStrikeouts: 0,
    walks: 0,
    hbp: 0,
    runsBattedIn: 0,
    steals: 0,
    caughtStealing: 0,
    doublePlays: 0, // 守備方完成的雙殺
    gidp: 0, // 攻擊方被打成雙殺（GIDP）
    biggestSwing: null,
  };
}

function recordHighlight(stats, runs, text) {
  if (!runs) return;
  if (!stats.biggestSwing || runs > stats.biggestSwing.runs) {
    stats.biggestSwing = { runs, text };
  }
}

function applyBoxStats({ battingSide, fieldingSide, kind, situation, batterName }) {
  const battingStats = battingSide.stats || (battingSide.stats = freshStats());
  const fieldingStats = fieldingSide.stats || (fieldingSide.stats = freshStats());
  const runs = situation.runsThisPlay || 0;

  battingStats.runsBattedIn += runs;
  if (situation.strikeout) {
    battingStats.battingStrikeouts = (battingStats.battingStrikeouts || 0) + 1;
    fieldingStats.pitchingStrikeouts = (fieldingStats.pitchingStrikeouts || 0) + 1;
  }
  if (kind === 'BALL' && situation.paEnded) battingStats.walks += 1;
  if (kind === 'HBP') battingStats.hbp += 1;
  if (kind === 'SINGLE' || kind === 'BUNT_HIT') battingStats.hits += 1;
  if (kind === 'XBH') {
    battingStats.hits += 1;
    battingStats.doublesTriples += 1;
  }
  if (kind === 'HR') {
    battingStats.hits += 1;
    battingStats.homeRuns += 1;
    recordHighlight(battingStats, runs, `${batterName} ${runs} 分砲`);
  } else {
    recordHighlight(battingStats, runs, `${batterName} ${runs} 分打點`);
  }
  if (situation.doublePlay) {
    // 打者被打成雙殺（GIDP）記在攻擊方；守備方記完成雙殺（DP）
    battingStats.gidp = (battingStats.gidp || 0) + 1;
    fieldingStats.doublePlays += 1;
  }
}

function randomToken() {
  // CSPRNG 產出 token，避免 Math.random 可被回推 PRNG 狀態進而預測他人房間 token
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // 環境沒有 WebCrypto 時的最後保底（Node 15+ 之後其實都有）
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function createRoom({ code, innings, awayTeamId, extraMode, cor }) {
  const awayTeam = TEAMS.find((t) => t.id === awayTeamId);
  if (!awayTeam) throw new Error('BAD_TEAM');
  // 彈力係數（開房設定）：0.5 死球 ~ 1.5 彈力球，預設 1.0；0.1 一格
  const corVal = Math.round(Math.min(1.5, Math.max(0.5, Number(cor) || 1)) * 10) / 10;
  return {
    code,
    status: 'waiting', // waiting | playing | over
    innings,
    cor: corVal,
    extraMode: extraMode === 'cpbl' ? 'cpbl' : 'tiebreak', // cpbl: 延長+3局仍平手＝和局；tiebreak: 突破僵局制打到分勝負
    tokens: { away: randomToken(), home: null },
    awayTeamId,
    homeTeamId: null,
    game: null,
    createdAt: Date.now(),
  };
}

export function joinRoom(room, homeTeamId) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  if (!TEAM_IDS.has(homeTeamId)) throw new Error('BAD_TEAM');
  room.tokens.home = randomToken();
  room.homeTeamId = homeTeamId;
  room.status = 'playing';
  const awayTeam = TEAMS.find((t) => t.id === room.awayTeamId);
  const homeTeam = TEAMS.find((t) => t.id === homeTeamId);
  if (!awayTeam || !homeTeam) throw new Error('BAD_TEAM');
  room.game = {
    innings: room.innings,
    extraMode: room.extraMode || 'tiebreak',
    away: freshTeamState(awayTeam),
    home: freshTeamState(homeTeam),
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: { first: null, second: null, third: null },
    baseSpeeds: { first: 50, second: 50, third: 50 },
    log: [],
    phase: 'pitcher', // pitcher | batter | result | gameover
    pendingPitch: null,
    lastResult: null,
    ready: { away: false, home: false },
    winner: null,
    endReason: '',
    gameOverPending: false,
    deadline: Date.now() + PHASE_MS,
    notice: null, // 換投/代打即時通知（雙方畫面顯眼顯示）
    surrender: null, // 彩蛋：投降輸一半（{ by: 'away'|'home', status: 'pending'|'accepted' }）
    cor: room.cor || 1, // 彈力係數（開房設定）
    // 挑釁系統：stage 1~11 對應梗圖（>11 停留在摔倒）；每次挑釁 20% 觸發裁判警告
    // 警告階梯：1 次＝警告；2 次＝總教練驅逐（禁盜壘/代打/佈陣）；
    // 3 次＝副教練也驅逐（追加禁換投/牽制）；4 次＝先判掉一分、直接裁定敗戰
    taunts: {
      away: { stage: 0, warnings: 0, ejected: false, coachEjected: false },
      home: { stage: 0, warnings: 0, ejected: false, coachEjected: false },
    },
    tauntSeq: 0,
    tauntFeed: null, // 最新一次挑釁事件（前端播圖用）：{ seq, by, stage, warned, ejected }
    pickoffsThisPA: 0, // 本打席已牽制次數（每打席上限，防止無限重置倒數拖時間）
    heldClose: 0, // 牽制成功壓回壘的次數：套用到「下一球」的盜壘成功率（每球結算後歸零）
    pendingSteal: null, // 進攻方在對方配球階段偷偷宣告的盜壘（{ base: 'first'|'second'|'double' }），守備方看不到
    pendingSqueeze: null, // 進攻方偷偷下的強迫取分暗號（{}）；三壘有人、<2 出局才能下，守方看不到
    pendingPitchOut: null, // 守方偷偷勾的 Pitch Out（{ height: 'high'|'low' }）——高外角＝抓盜壘/強迫取分理想球，低外角＝次佳；進攻方看不到
  };
  return room;
}

// 依壘包狀態計算目前可宣告的盜壘選項：
// 只有一壘 → 盜二壘；只有二壘 → 盜三壘；一二壘 → 雙盜壘；一三壘 → 只可一壘跑者盜二壘；其餘不可
export function stealOptionsOf(bases) {
  const f = !!bases.first, sec = !!bases.second, t = !!bases.third;
  if (f && sec) return ['double'];
  if (f && t) return ['first'];
  if (f && !sec) return ['first'];
  if (sec && !t) return ['second'];
  return [];
}

/* ------------ 強迫取分（squeeze play） ------------
 * 條件：三壘有跑者 + 未滿兩人出局 + 打者回合前的配球階段（跟盜壘同層）
 * 效果：投球出手瞬間三壘跑者衝本壘；打者「界內擊出」＝跑者得分；
 *       打者揮空/沒揮＝跑者被本壘刺殺（衝出去回不來）；界外＝跑者退回。
 * 對方看不到暗號（雙盲）。已下強迫取分＝不能下盜壘；反之亦然。
 */
export function actDeclareSqueeze(room, role, payload) {
  const g = room.game;
  if (g.taunts?.[role]?.ejected) throw new Error('EJECTED');
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE');
  if (role !== battingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  const cancel = payload && payload.cancel;
  if (cancel) { g.pendingSqueeze = null; return; }
  if (!g.bases.third) throw new Error('NO_THIRD');
  if (g.outs >= 2) throw new Error('TWO_OUTS'); // 兩出局下強迫取分無意義：跑者出局＝第三出局，白給
  if (g.pendingSteal) throw new Error('CONFLICT_STEAL'); // 已下盜壘就不能再下
  g.pendingSqueeze = {};
}

/* ------------ Pitch Out ------------
 * 守方在配球階段勾選：故意投高外角（或低外角）遠處壞球，
 * 用意是抓對方偷跑（盜壘 or 強迫取分）。這球必為壞球（B+1）。
 * height: 'high' → 高外角，捕手起身傳球快，抓壘率高
 *         'low'  → 低外角，捕手蹲下接完再起身，抓壘率低
 * 進攻方看不到。
 */
export function actDeclarePitchOut(room, role, payload) {
  const g = room.game;
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE');
  if (role !== fieldingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  const cancel = payload && payload.cancel;
  if (cancel) { g.pendingPitchOut = null; return; }
  const height = payload && payload.height;
  if (!['high', 'low'].includes(height)) throw new Error('BAD_INPUT');
  g.pendingPitchOut = { height };
}

export function actDeclareSteal(room, role, payload) {
  const g = room.game;
  if (g.taunts?.[role]?.ejected) throw new Error('EJECTED'); // 總教練被驅逐：不能下盜壘暗號
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE'); // 只能在對方配球時起跑
  if (role !== battingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  const base = payload?.base;
  if (base === null || base === undefined) {
    g.pendingSteal = null; // 取消
    return;
  }
  if (!STEAL_BASES.has(base)) throw new Error('BAD_INPUT');
  if (!stealOptionsOf(g.bases).includes(base)) throw new Error('BAD_INPUT');
  if (g.pendingSqueeze) throw new Error('CONFLICT_SQUEEZE'); // 已下強迫取分＝不能再下盜壘
  g.pendingSteal = { base };
}

export function roleOf(room, token) {
  if (room.tokens.away === token) return 'away';
  if (room.tokens.home && room.tokens.home === token) return 'home';
  return null;
}

function pushLog(g, text) {
  g.log = [{ id: `${Date.now()}-${Math.random()}`, inning: g.inning, half: g.half, text }, ...g.log].slice(0, 80);
}

function checkGameOver(g, newHalf) {
  // 一個完整局打完（剛換到下一局上半時才判定，避免延長賽上半中途得分就提前結束）
  if (newHalf && g.half === 'top' && g.inning > g.innings) {
    if (g.home.score !== g.away.score) {
      return { over: true, reason: g.inning > g.innings + 1 ? '延長賽分出勝負，比賽結束' : '比賽結束' };
    }
    // 中職例行賽制：延長最多 +3 局，仍平手＝和局
    if (g.extraMode === 'cpbl' && g.inning > g.innings + 3) {
      return { over: true, reason: `延長至第 ${g.inning - 1} 局仍平手，依中職例行賽賽制和局` };
    }
    return { over: false }; // 平手 → 進入延長賽
  }
  // 最後一局（含延長局）下半開打前，主隊已領先就不用打
  if (g.half === 'bottom' && g.inning >= g.innings && g.home.score > g.away.score) {
    return { over: true, reason: '主隊領先，不需再打，比賽結束' };
  }
  return { over: false };
}

export function actChangePitcher(room, role, idx) {
  const g = room.game;
  if (g.taunts?.[role]?.coachEjected) throw new Error('EJECTED'); // 副教練被驅逐：不能換投
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE');
  if (role !== fieldingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  const side = g[role];
  if (!side.team.pitchers[idx] || side.staff.used.includes(idx)) throw new Error('INVALID');
  side.staff.currentIdx = idx;
  side.staff.used.push(idx);
  side.staff.pitchCounts[idx] = 0;
  const p = side.team.pitchers[idx];
  const text = `${side.team.short} 更換投手：${ROLE_NAMES[p.role]} ${p.name} 登板`;
  pushLog(g, text);
  g.notice = { id: `${Date.now()}-${Math.random()}`, text: `🔄 ${text}` };
}

export function actPinchHit(room, role, benchIdx) {
  const g = room.game;
  if (g.taunts?.[role]?.ejected) throw new Error('EJECTED'); // 總教練被驅逐：不能代打
  if (g.phase !== 'batter') throw new Error('WRONG_PHASE');
  if (role !== battingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  const side = g[role];
  const bench = side.bench[benchIdx];
  if (!bench || bench.used) throw new Error('INVALID');
  const slot = side.lineupIdx % side.lineup.length;
  const outgoing = side.lineup[slot];
  side.lineup[slot] = { ...bench };
  side.bench[benchIdx].used = true;
  const text = `${side.team.short} 代打：${bench.name} 上場（取代 ${outgoing.name}）`;
  pushLog(g, text);
  g.notice = { id: `${Date.now()}-${Math.random()}`, text: `🔄 ${text}` };
}

export function actPitcherSubmit(room, role, payload) {
  const g = room.game;
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE');
  if (role !== fieldingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  // 總教練被驅逐：不能下佈陣（強制回一般站位；換投與牽制不受影響）
  if (g.taunts?.[role]?.ejected && payload) payload = { ...payload, shift: 'normal' };

  // 敬遠：比照中職自動故意四壞（比手勢即保送，不投球、不耗體力）
  if (payload.ibb) {
    const bKey = battingKey(g.half);
    const fKey = fieldingKey(g.half);
    const battingSide = g[bKey];
    const fieldingSide = g[fKey];
    const batter = battingSide.lineup[battingSide.lineupIdx % battingSide.lineup.length];
    const prevBases = { ...g.bases };
    const prevSpeeds = { ...g.baseSpeeds };

    const situation = applyOutcome(
      { balls: 3, strikes: g.strikes, outs: g.outs, bases: prevBases },
      'BALL',
      batter.name
    );
    g.balls = 0;
    g.strikes = 0;
    g.outs = situation.outs;
    g.bases = situation.bases;
    const mapSpeed = (name) => {
      if (!name) return 50;
      if (name === batter.name) return batter.speed;
      for (const b of ['first', 'second', 'third']) {
        if (prevBases[b] === name) return prevSpeeds[b];
      }
      return 50;
    };
    g.baseSpeeds = { first: mapSpeed(g.bases.first), second: mapSpeed(g.bases.second), third: mapSpeed(g.bases.third) };
    const runs = situation.runsThisPlay || 0;
    if (runs > 0) battingSide.score += runs;
    applyBoxStats({ battingSide, fieldingSide, kind: 'BALL', situation, batterName: batter.name });

    let line = `【${batter.name}】守備方比出敬遠手勢，故意四壞保送`;
    if (runs > 0) line += `，滿壘擠回 ${runs} 分`;
    pushLog(g, line);

    g.lastResult = {
      pitchTypeName: '敬遠',
      zoneLabel: '—',
      summary: runs > 0 ? `故意四壞保送（滿壘擠回 ${runs} 分！）` : '故意四壞保送',
      narration: [
        '捕手站了起來，往打擊區外側跨出一大步——',
        '守備方比出敬遠手勢！自動故意四壞',
        runs > 0 ? '但壘上已經滿了——擠壓保送，三壘跑者踩過本壘得分！' : `${batter.name} 把球棒一放，慢跑上一壘`,
      ],
      extra: [],
      runs,
      batterName: batter.name,
      hung: false,
      isFav: false,
      pitcherChoice: { typeId: null, zoneTarget: 'ibb', shift: null },
      batterChoice: { mode: 'ibb' },
    };
    battingSide.lineupIdx += 1;
    g.heldClose = 0;
    g.pickoffsThisPA = 0;
    g.pendingSteal = null; // 敬遠死球，盜壘宣告作廢
    g.pendingPitch = null;
    g.ready = { away: false, home: false };
    g.phase = 'result';
    g.deadline = Date.now() + RESULT_MS;
    if (g.half === 'bottom' && g.inning >= g.innings && g.home.score > g.away.score) {
      g.gameOverPending = true;
    }
    return;
  }

  // 一鍵 Pitch Out：不必再拖落點、不必再抓出手時機——按下即投出高外角壞球
  // （高外角＝捕手起身傳球最快、抓盜壘 50%／抓強迫取分 90%）
  if (payload.pitchOut) {
    const poShift = g.taunts?.[role]?.ejected
      ? 'normal'
      : SHIFT_IDS.has(payload.shift)
        ? payload.shift
        : 'normal';
    g.pendingPitchOut = { height: 'high' };
    commitPitch(room, { typeId: 'fastball', targetX: 92, targetY: 10, waste: true, shift: poShift, release: null, auto: false });
    return;
  }

  let { typeId, targetX, targetY, waste, shift = 'normal', release } = payload || {};
  if (!PITCH_TYPE_IDS.has(typeId) || !SHIFT_IDS.has(shift)) {
    throw new Error('BAD_INPUT');
  }
  if (!isFiniteNum(targetX) || !isFiniteNum(targetY)) throw new Error('BAD_INPUT');
  targetX = clampCanvas(targetX);
  targetY = clampCanvas(targetY);
  waste = !!waste;
  // 出手時機分數：0~100 或 null（相容舊客戶端）
  if (release != null) {
    if (typeof release !== 'number' || !Number.isFinite(release)) throw new Error('BAD_INPUT');
    release = Math.max(0, Math.min(100, Math.round(release)));
  } else {
    release = null;
  }
  // Pitch Out：強制落點在遠側壞球區——高角度＝上緣外側、低角度＝下緣外側
  // 對右投對右打／左投對左打時「外側」是 x 大；對面時倒過來——但簡化統一往外側投
  const pitchOut = g.pendingPitchOut;
  if (pitchOut) {
    targetY = pitchOut.height === 'high' ? 10 : 90;
    targetX = 92; // 外側壞球區
    waste = true; // 明確故意壞球
  }
  commitPitch(room, { typeId, targetX, targetY, waste, shift: shift || 'normal', release, auto: false });
}

// 投球落地流程（真人投球與超時自動失投共用）：
// 1. 出手時機差勁 → 直接失投紅中
// 2. 依球種等級算實際連續落點
// 3. 觸身球用「實際落點」（不是瞄準點）算連續機率——越靠近打者內側越高
// 4. 建立飛行路徑，存進 pendingPitch 供打者端動畫重播
function commitPitch(room, { typeId, targetX, targetY, waste, shift, release, auto }) {
  const g = room.game;
  const fKey = fieldingKey(g.half);
  const bKey = battingKey(g.half);
  const fieldingSide = g[fKey];
  const battingSide = g[bKey];
  const pitcher = currentPitcher(fieldingSide);
  const batter = battingSide.lineup[battingSide.lineupIdx % battingSide.lineup.length];
  const grade = auto ? 'C' : gradeOf(pitcher, typeId);

  // Pitch Out 對決前處理：拉出雙方暗號，等下方投球結算後套用
  const pitchOut = g.pendingPitchOut || null;
  const squeeze = g.pendingSqueeze || null;
  const steal = g.pendingSteal || null;

  // 出手時機四區域制：完美＝指哪投哪；不錯＝微偏；勉強＝大偏；走鐘＝超慢紅中小便球
  // 區域寬度隨投手體力縮放：越累完美區越小、走鐘區越大（與前端時機條完全一致）
  const releaseZone = auto ? 'worst' : releaseZoneOf(release, pitcher.stamina, grade);
  const eephus = releaseZone === 'worst';

  let actualX;
  let actualY;
  let hung = false;
  if (eephus) {
    // 失投小便球：軟軟飄進紅中附近，球速超慢——打者有大把時間
    actualX = clampCanvas(50 + (Math.random() * 4 - 2));
    actualY = clampCanvas(50 + (Math.random() * 4 - 2));
    hung = true;
    pushLog(g, auto
      ? `💥 ${pitcher.name} 配球超時——隨手一拋，超慢的紅中小便球飄了進來！`
      : `💥 ${pitcher.name} 出手時機完全走鐘——球軟掉了，超慢的紅中小便球！`);
  } else {
    const off = releaseOffset({ zone: releaseZone, control: pitcher.effControl, grade });
    actualX = clampCanvas(targetX + off.dx);
    actualY = clampCanvas(targetY + off.dy);
    // 偏移剛好偏進紅中一帶（原本瞄邊角）＝實質失投，打擊加成照算
    hung = Math.abs(actualX - 50) < 6 && Math.abs(actualY - 50) < 6 && (Math.abs(targetX - 50) > 10 || Math.abs(targetY - 50) > 10);
  }

  // 觸身球：用實際落點算連續機率，越靠近打者（actualX 越小於好球帶內側邊界）機率越高
  if (!auto && !eephus) {
    const insideness = Math.max(0, Math.min(1, (FIELD.zoneMin - actualX) / FIELD.zoneMin));
    if (insideness > 0) {
      const hbpChance = insideness * Math.min(0.06, Math.max(0.008, 0.035 - (pitcher.effControl - 50) / 600));
      if (Math.random() < hbpChance) {
        resolveHbp(room, { typeId, targetX, targetY, shift, batter, pitcher, battingSide, fieldingSide });
        return;
      }
    }
  }

  const pitchType = PITCH_TYPES.find((t) => t.id === typeId);
  const path = buildFlightPath({ targetX, targetY, actualX, actualY, pitchTypeId: typeId, grade, effStuff: pitcher.effStuff, eephus, releaseZone });

  g.pendingPitch = {
    typeId,
    targetX,
    targetY,
    waste: !!waste,
    shift,
    release,
    releaseZone,
    pitchOut,
    squeeze,
    grade,
    actualX,
    actualY,
    hung,
    auto,
    path,
  };
  g.phase = 'batter';
  g.deadline = Date.now() + PHASE_MS;
}

// 觸身球（死球）：投球出手瞬間就定案，不經打者反應，直接進結果畫面
function resolveHbp(room, { typeId, targetX, targetY, shift, batter, pitcher, battingSide, fieldingSide }) {
  const g = room.game;
  const prevBases = { ...g.bases };
  const prevSpeeds = { ...g.baseSpeeds };
  const situation = applyOutcome(
    { balls: g.balls, strikes: g.strikes, outs: g.outs, bases: prevBases },
    'HBP',
    batter.name
  );
  g.balls = situation.balls;
  g.strikes = situation.strikes;
  g.outs = situation.outs;
  g.bases = situation.bases;
  const mapSpeed = (name) => {
    if (!name) return 50;
    if (name === batter.name) return batter.speed;
    for (const b of ['first', 'second', 'third']) {
      if (prevBases[b] === name) return prevSpeeds[b];
    }
    return 50;
  };
  g.baseSpeeds = { first: mapSpeed(g.bases.first), second: mapSpeed(g.bases.second), third: mapSpeed(g.bases.third) };
  const runs = situation.runsThisPlay || 0;
  if (runs > 0) battingSide.score += runs;
  applyBoxStats({ battingSide, fieldingSide, kind: 'HBP', situation, batterName: batter.name });

  // 投手球數 +1
  const staff = fieldingSide.staff;
  staff.pitchCounts[staff.currentIdx] = (staff.pitchCounts[staff.currentIdx] || 0) + 1;

  pushLog(g, `【${batter.name}】${pitcher.name} 的球直接砸到打者——觸身球保送${runs > 0 ? `，擠回 ${runs} 分` : ''}`);
  g.lastResult = {
    pitchTypeName: PITCH_TYPES.find((t) => t.id === typeId)?.name || '—',
    zoneLabel: '觸身',
    summary: situation.log,
    narration: situation.narration,
    extra: [],
    runs,
    batterName: batter.name,
    hung: false,
    grade: null,
    pitcherChoice: { typeId, targetX, targetY, shift },
    batterChoice: { mode: 'hbp' },
  };
  battingSide.lineupIdx += 1;
  g.heldClose = 0;
  g.pickoffsThisPA = 0;
  g.pendingSteal = null; // 死球，盜壘宣告作廢
  g.pendingPitch = null;
  g.ready = { away: false, home: false };
  g.phase = 'result';
  g.deadline = Date.now() + RESULT_MS;
}

/* ------------ 牽制 ------------
 * 投手配球階段可對一/二壘跑者牽制（每打席上限 2 次，防拖延）：
 * - 一律重置投球倒數（回滿 25 秒）
 * - 小機率直接抓到離壘過大的跑者（跑者越慢越危險）
 * - 小機率暴傳失誤（隨疲勞上升，封頂 20%）：全部跑者推進一個壘包
 * - 若跑者平安回壘：被「牽制住」，本球宣告盜壘的成功率下降（-12%/次，可疊加）
 */
export const MAX_PICKOFFS_PER_PA = 2;

export function actPickoff(room, role) {
  const g = room.game;
  if (g.taunts?.[role]?.coachEjected) throw new Error('EJECTED'); // 副教練被驅逐：不能牽制
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE');
  if (role !== fieldingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  // 牽制對象：領先跑者（二壘優先），三壘跑者不牽制（本作盜壘僅限一/二壘）
  const targetBase = g.bases.second ? 'second' : g.bases.first ? 'first' : null;
  if (!targetBase) throw new Error('NO_RUNNER');
  if ((g.pickoffsThisPA || 0) >= MAX_PICKOFFS_PER_PA) throw new Error('PICKOFF_LIMIT');

  const fKey = fieldingKey(g.half);
  const bKey = battingKey(g.half);
  const fieldingSide = g[fKey];
  const battingSide = g[bKey];
  const pitcher = currentPitcher(fieldingSide);
  const batter = battingSide.lineup[battingSide.lineupIdx % battingSide.lineup.length];
  const runnerName = g.bases[targetBase];
  const runnerSpeed = g.baseSpeeds[targetBase] || 50;
  const baseLabel = targetBase === 'second' ? '二壘' : '一壘';

  g.pickoffsThisPA = (g.pickoffsThisPA || 0) + 1;

  // 失誤率：基礎 4%，疲勞每 +1 加 1%，封頂 20%（fatigue 上限 16 → 最高 20%）
  const errChance = Math.min(0.2, 0.04 + pitcher.fatigue * 0.01);
  // 直接牽制出局率：2%~12%，跑者越慢離壘越危險
  const catchChance = Math.max(0.02, Math.min(0.12, 0.06 + (50 - runnerSpeed) / 500));

  // 進攻方已偷偷宣告盜壘：跑者離壘準備起跑，牽制大概率直接抓死（78%）
  const stealing = g.pendingSteal && (
    (g.pendingSteal.base === 'double' && targetBase === 'second') ||
    g.pendingSteal.base === targetBase
  );

  const roll = Math.random();
  const finishAsResult = (summary, narration, runs) => {
    g.lastResult = {
      pitchTypeName: '牽制',
      zoneLabel: '—',
      summary,
      narration,
      extra: [],
      runs,
      batterName: batter.name,
      hung: false,
      isFav: false,
      pitcherChoice: { typeId: null, zoneTarget: 'pickoff', shift: null },
      batterChoice: { mode: 'pickoff' },
    };
    g.pendingPitch = null;
    g.ready = { away: false, home: false };
    g.phase = 'result';
    g.deadline = Date.now() + RESULT_MS;
  };

  if (stealing && roll >= errChance) {
    // 跑者已經起跳準備盜壘——牽制正中要害！78% 直接抓死
    g.pendingSteal = null; // 不論結果，這次盜壘宣告作廢
    if (Math.random() < 0.78) {
      g.outs = Math.min(3, g.outs + 1);
      g.bases = { ...g.bases, [targetBase]: null };
      g.baseSpeeds = { ...g.baseSpeeds, [targetBase]: 50 };
      const battingStats = battingSide.stats || (battingSide.stats = freshStats());
      battingStats.caughtStealing += 1;
      pushLog(g, `🔥🔥 ${pitcher.name} 識破盜壘企圖！往${baseLabel}牽制，${runnerName} 起跑到一半被夾殺出局！`);
      finishAsResult(
        `牽制識破盜壘！${runnerName} 被夾殺出局`,
        [
          `${runnerName} 悄悄加大離壘，重心已經完全朝前——`,
          `${pitcher.name} 彷彿背後長眼，突然轉身往${baseLabel}一甩！！`,
          `${runnerName} 進退不得，在壘間被守備夾殺——出局！！盜壘企圖被完全識破`,
        ],
        0
      );
    } else {
      // 22%：驚險撲回
      g.heldClose = (g.heldClose || 0) + 1;
      g.deadline = Date.now() + PHASE_MS;
      g.notice = { text: `${pitcher.name} 突然牽制${baseLabel}！起跑到一半的 ${runnerName} 千鈞一髮撲回壘包——盜壘企圖曝光了` };
      pushLog(g, `😅 ${pitcher.name} 牽制${baseLabel}，蠢蠢欲動的 ${runnerName} 驚險撲回（盜壘宣告取消）`);
    }
    return;
  }

  if (roll < errChance) {
    // 牽制暴傳：所有跑者各推進一個壘包，三壘跑者回來得分（若跑者正要盜壘等於白送）
    g.pendingSteal = null; // 壘包已變動，宣告作廢
    const prev = { ...g.bases };
    const prevSp = { ...g.baseSpeeds };
    let runs = 0;
    if (prev.third) runs = 1;
    g.bases = { first: null, second: prev.first, third: prev.second };
    g.baseSpeeds = {
      first: 50,
      second: prev.first ? prevSp.first : 50,
      third: prev.second ? prevSp.second : 50,
    };
    if (runs > 0) battingSide.score += runs;
    let line = `⚠️ ${pitcher.name} 往${baseLabel}牽制卻暴傳！跑者趁亂推進`;
    if (runs > 0) line += `，${battingSide.team.short} 撿到 ${runs} 分`;
    pushLog(g, line);
    finishAsResult(
      runs > 0 ? `牽制暴傳失誤！對方撿到 ${runs} 分` : '牽制暴傳失誤！跑者趁亂推進一個壘包',
      [
        `${pitcher.name} 突然轉身往${baseLabel}丟——`,
        '球卻甩高了！野手撲了個空，球滾向邊線！',
        runs > 0 ? '三壘跑者見機直奔本壘——得分！！' : `${runnerName} 見機拔腿，多推進一個壘包！`,
      ],
      runs
    );
    // 再見失分：最後一局下半主隊因對方失誤超前（僅發生在客隊守備＝主隊進攻時）
    if (g.half === 'bottom' && g.inning >= g.innings && g.home.score > g.away.score) {
      g.gameOverPending = true;
    }
    return;
  }

  if (roll < errChance + catchChance) {
    // 牽制成功：抓到離壘過大的跑者
    g.pendingSteal = null;
    g.outs = Math.min(3, g.outs + 1);
    g.bases = { ...g.bases, [targetBase]: null };
    g.baseSpeeds = { ...g.baseSpeeds, [targetBase]: 50 };
    const fieldingStats = fieldingSide.stats || (fieldingSide.stats = freshStats());
    const battingStats = battingSide.stats || (battingSide.stats = freshStats());
    battingStats.caughtStealing += 1; // 牽制出局計入跑壘遭刺
    pushLog(g, `🔥 ${pitcher.name} 冷不防往${baseLabel}一甩——${runnerName} 回不去了，牽制出局！`);
    finishAsResult(
      `牽制成功！${runnerName} 在${baseLabel}被抓出局`,
      [
        `${pitcher.name} 抬腿……突然轉身往${baseLabel}閃電一甩！`,
        `${runnerName} 離壘太大，慌忙撲回——`,
        '野手接球落刺，裁判拳頭一握：出局！',
      ],
      0
    );
    return;
  }

  // 跑者平安回壘：重置倒數，並讓本球的盜壘更難成功
  g.heldClose = (g.heldClose || 0) + 1;
  g.deadline = Date.now() + PHASE_MS;
  g.notice = { text: `${pitcher.name} 往${baseLabel}牽制！${runnerName} 撲回壘包——跑者被牽制住，本球盜壘成功率下降` };
  pushLog(g, `${pitcher.name} 往${baseLabel}牽制，${runnerName} 平安回壘（剩餘牽制次數 ${MAX_PICKOFFS_PER_PA - g.pickoffsThisPA}）`);
}

export function actBatterSubmit(room, role, payload) {
  const g = room.game;
  if (g.phase !== 'batter') throw new Error('WRONG_PHASE');
  if (role !== battingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  resolveBatterPlay(room, payload);
}

// 打擊結算核心（actBatterSubmit 與超時自動判定共用）
function resolveBatterPlay(room, payload) {
  const g = room.game;
  if (!g.pendingPitch) throw new Error('WRONG_PHASE');
  const bKey = battingKey(g.half);
  const fKey = fieldingKey(g.half);

  const battingSide = g[bKey];
  const fieldingSide = g[fKey];
  const batter = battingSide.lineup[battingSide.lineupIdx % battingSide.lineup.length];
  const pitcher = currentPitcher(fieldingSide);

  const { mode } = payload || {};
  if (!MODES.has(mode)) throw new Error('BAD_INPUT');
  // 沒人在壘不可觸擊（真實規則：觸擊為犧牲戰術，沒跑者可推＝無意義）
  if (mode === 'bunt' && !g.bases.first && !g.bases.second && !g.bases.third) {
    throw new Error('BUNT_NO_RUNNER');
  }

  // 球棒最終位置（連續座標，放開＝揮棒當下取樣）：null＝沒出棒／看球
  let batX = payload?.batX;
  let batY = payload?.batY;
  let swingDelta = payload?.swingDelta; // 揮棒時刻 − 球到位時刻（ms），null＝沒出棒或舊客戶端
  if (mode === 'take' || batX == null || batY == null) {
    batX = null;
    batY = null;
    swingDelta = null;
  } else {
    if (!isFiniteNum(batX) || !isFiniteNum(batY)) throw new Error('BAD_INPUT');
    batX = clampCanvas(batX);
    batY = clampCanvas(batY);
    if (swingDelta != null) {
      if (!isFiniteNum(swingDelta)) throw new Error('BAD_INPUT');
      swingDelta = Math.max(-2000, Math.min(2000, Math.round(swingDelta)));
    } else {
      swingDelta = null;
    }
  }

  const shift = g.pendingPitch.shift || 'normal';
  const grade = g.pendingPitch.grade || 'B';
  const steal = g.pendingSteal; // 投球前偷偷宣告的盜壘
  const runnersGoing = !!steal;

  const squeeze = g.pendingSqueeze;
  const pitchOut = g.pendingPitchOut;
  g.pendingSqueeze = null; // 這球完就作廢
  g.pendingPitchOut = null;
  const result = resolvePitch({
    actualX: g.pendingPitch.actualX,
    actualY: g.pendingPitch.actualY,
    hung: !!g.pendingPitch.hung,
    pitcherPitchTypeId: g.pendingPitch.typeId,
    grade,
    pitcherStats: { control: pitcher.effControl, stuff: pitcher.effStuff, throws: pitcher.throws },
    shift,
    batterMode: mode,
    batX,
    batY,
    swingDeltaMs: swingDelta,
    flightMs: g.pendingPitch.path?.durationMs || null,
    cor: g.cor || 1,
    batterStats: batter,
    strikes: g.strikes,
  });

  const prevBases = { ...g.bases };
  const prevSpeeds = { ...g.baseSpeeds };
  const runnerOnFirstSpeed = prevBases.first ? prevSpeeds.first : 50;

  const situation = applyOutcome(
    { balls: g.balls, strikes: g.strikes, outs: g.outs, bases: prevBases },
    result.kind,
    batter.name,
    { shift, mode, runnerOnFirstSpeed, runnersGoing, groundBias: result.groundBias }
  );

  g.balls = situation.balls;
  g.strikes = situation.strikes;
  g.outs = situation.outs;
  g.bases = situation.bases;

  // 重建速度對應
  const mapSpeed = (name) => {
    if (!name) return 50;
    if (name === batter.name) return batter.speed;
    for (const base of ['first', 'second', 'third']) {
      if (prevBases[base] === name) return prevSpeeds[base];
    }
    return 50;
  };
  g.baseSpeeds = {
    first: mapSpeed(g.bases.first),
    second: mapSpeed(g.bases.second),
    third: mapSpeed(g.bases.third),
  };

  let runs = situation.runsThisPlay || 0;
  const extraLogs = [];

  // 提前計算：強迫取分與盜壘結算都會用到
  const walked = situation.walked || result.kind === 'HBP';
  const wastePitch = !!g.pendingPitch.waste;
  const isFastball = g.pendingPitch.typeId === 'fastball';
  const breakingWhiff = !isFastball && !!situation.swingMiss;

  // ---- 強迫取分結算 ----
  // 三壘跑者已於投球出手瞬間衝本壘：界內＝得分（並取消原本 applyOutcome 對三壘跑者的既有處理）；
  // 揮空/沒揮＝跑者本壘刺殺（衝出去回不來）；界外＝跑者退回三壘（該球算好球，applyOutcome 已處理）；
  // Pitch Out（守方看穿）＝跑者 90% 被抓死。
  if (squeeze && prevBases.third) {
    const thirdName = prevBases.third;
    const thirdSpeed = prevSpeeds.third;
    const alreadyScoredByOutcome = !g.bases.third && situation.runsThisPlay > 0 && !prevBases.second; // 判斷三壘跑者是否已被 applyOutcome 記為得分
    if (situation.foul) {
      // 界外：跑者急停退回，applyOutcome 已把跑者留在三壘
      extraLogs.push('🏃 三壘跑者衝出去了！但這球被打成界外——跑者急煞退回三壘，虛驚一場');
    } else if (situation.ballInPlay) {
      // 界內：跑者一定得分（提前起跑，內野再守也守不下來）
      if (g.bases.third) {
        // applyOutcome 沒讓三壘跑者得分（例如打成內野安打）——手動把他送回本壘
        runs += 1;
        g.bases.third = null;
        g.baseSpeeds.third = 50;
      } else if (!alreadyScoredByOutcome) {
        // applyOutcome 讓別的跑者上了三壘、原三壘跑者被算得分 → 保持
      }
      extraLogs.push(`🏃 三壘跑者${thirdName ? '（' + thirdName + '）' : ''}提前起跑——強迫取分成功！打者擊出讓跑者輕鬆踩上本壘板！`);
    } else if (walked) {
      // 死球（保送/觸身球）：跑者強制推進，applyOutcome 已處理
      extraLogs.push('🏃 三壘跑者衝出去了，還好是死球——跑者踩本壘得分！');
    } else {
      // 打者揮空/沒揮＝跑者本壘刺殺
      const catcherCatch = pitchOut ? 0.9 : 0.85; // Pitch Out 加成
      const runnerAdj = (thirdSpeed - 50) / 400;
      const caught = Math.random() < Math.max(0.6, Math.min(0.98, catcherCatch - runnerAdj));
      if (caught) {
        g.outs = Math.min(3, g.outs + 1);
        g.bases.third = null;
        g.baseSpeeds.third = 50;
        const battingStats = battingSide.stats || (battingSide.stats = freshStats());
        battingStats.caughtStealing += 1;
        extraLogs.push(pitchOut
          ? `🎯 Pitch Out 破解強迫取分！三壘跑者${thirdName ? '（' + thirdName + '）' : ''}衝出去、捕手接球轉身在本壘前直接觸殺——出局！`
          : `💥 打者沒碰到球——三壘跑者${thirdName ? '（' + thirdName + '）' : ''}衝出去回不來，本壘刺殺出局！`);
      } else {
        // 少數情況跑者硬闖成功（滑壘避開觸殺）
        runs += 1;
        g.bases.third = null;
        g.baseSpeeds.third = 50;
        extraLogs.push(`🏃 三壘跑者拚了！打者沒碰到球，但跑者頭部滑壘避開觸殺——不可思議的一分！`);
      }
    }
  }

  // Pitch Out 但對方沒下暗號（既沒盜壘也沒強迫取分）＝白送一顆壞球
  if (pitchOut && !steal && !squeeze) {
    extraLogs.push(`🎯 守方勾了 Pitch Out——但進攻方沒動作，白白送了一顆壞球`);
  }

  // ---- 盜壘結算（前置宣告制） ----

  if (steal) {
    if (situation.foul) {
      // 界外球：沒事，跑者退回原壘（宣告保留？——退回即取消，下球要重按）
      extraLogs.push('界外球！起跑的跑者急停退回壘包，虛驚一場');
      g.pendingSteal = null;
    } else if (situation.ballInPlay) {
      // 球被打進場內：runnersGoing 已在 applyOutcome 內讓跑者多推進（安打上三壘/破壞雙殺）
      if (result.kind === 'SINGLE' || result.kind === 'XBH') {
        extraLogs.push('跑者提前起跑，趁安打大膽多搶了一個壘包！');
      }
      g.pendingSteal = null;
    } else if (walked) {
      g.pendingSteal = null; // 死球，自動推進
    } else {
      // 沒碰到球（好球/壞球/揮空/三振）：盜壘判定
      // Pitch Out 加成：高角度 50% 抓死、低角度 20%、無 Pitch Out 沿用原公式（~40%）
      const pitchOutCatch = pitchOut ? (pitchOut.height === 'high' ? 0.5 : 0.2) : null;
      if (steal.base === 'double') {
        const leadName = prevBases.second;
        const trailName = prevBases.first;
        // 打者結算後跑者仍在原壘且未滿 3 出局才成立
        if (leadName && trailName && g.bases.second === leadName && g.bases.first === trailName && g.outs < 3) {
          let success;
          if (pitchOutCatch != null) {
            success = Math.random() >= pitchOutCatch;
            extraLogs.push(`🎯 Pitch Out（${pitchOut.height === 'high' ? '高外角' : '低外角'}）——捕手起身直接傳三壘！`);
          } else {
            success = resolveSteal({
              runnerSpeed: prevSpeeds.second,
              wastePitch,
              fastball: isFastball,
              breakingWhiff,
              heldClose: g.heldClose || 0,
              doubleSteal: true,
            });
          }
          const stealRes = applyDoubleStealResult({ bases: g.bases, outs: g.outs }, success, leadName, trailName);
          const battingStats = battingSide.stats || (battingSide.stats = freshStats());
          if (success) battingStats.steals += 2;
          else { battingStats.caughtStealing += 1; battingStats.steals += 1; }
          g.outs = Math.min(3, stealRes.outs);
          g.bases = stealRes.bases;
          g.baseSpeeds = {
            first: 50,
            second: mapSpeed(g.bases.second),
            third: success ? prevSpeeds.second : 50,
          };
          if (success) g.baseSpeeds.third = prevSpeeds.second;
          extraLogs.push(stealRes.log);
        }
        g.pendingSteal = null;
      } else {
        const base = steal.base;
        if (prevBases[base] && g.bases[base] === prevBases[base] && g.outs < 3) {
          const runnerName = g.bases[base];
          let success;
          if (pitchOutCatch != null) {
            success = Math.random() >= pitchOutCatch;
            extraLogs.push(`🎯 Pitch Out（${pitchOut.height === 'high' ? '高外角' : '低外角'}）——捕手接球起身就傳${base === 'first' ? '二' : '三'}壘！`);
          } else {
            success = resolveSteal({
              runnerSpeed: g.baseSpeeds[base],
              wastePitch,
              fastball: isFastball,
              breakingWhiff,
              heldClose: g.heldClose || 0,
            });
          }
          const stealRes = applyStealResult({ bases: g.bases, outs: g.outs }, success, base, runnerName);
          const battingStats = battingSide.stats || (battingSide.stats = freshStats());
          if (success) battingStats.steals += 1;
          else battingStats.caughtStealing += 1;
          g.outs = Math.min(3, stealRes.outs);
          const toBase = base === 'first' ? 'second' : 'third';
          const sp = g.baseSpeeds[base];
          g.bases = stealRes.bases;
          g.baseSpeeds = { ...g.baseSpeeds, [base]: 50, [toBase]: success ? sp : 50 };
          if (breakingWhiff && success) extraLogs.push(`${stealRes.log}（變化球揮空捕手來不及，完美的起跑時機！）`);
          else if (isFastball && !success) extraLogs.push(`${stealRes.log}（直球到手套太快，捕手火速阻殺）`);
          else extraLogs.push(stealRes.log);
        }
        g.pendingSteal = null;
      }
    }
  }

  if (runs > 0) battingSide.score += runs;
  applyBoxStats({ battingSide, fieldingSide, kind: result.kind, situation, batterName: batter.name });

  // 投手球數 +1
  const staff = fieldingSide.staff;
  staff.pitchCounts[staff.currentIdx] = (staff.pitchCounts[staff.currentIdx] || 0) + 1;

  let logLine = `【${batter.name}】${pitcher.name} 投出${result.pitchTypeName}${result.hung ? '（失投！）' : ''}（落點：${result.actualZoneLabel}）→ ${situation.log}`;
  if (runs > 0) logLine += `，${battingSide.team.short} 得 ${runs} 分`;
  pushLog(g, logLine);
  for (const el of extraLogs) pushLog(g, el);

  g.lastResult = {
    pitchTypeName: result.pitchTypeName,
    zoneLabel: result.actualZoneLabel,
    summary: situation.log,
    narration: situation.narration || null,
    extra: extraLogs,
    runs,
    batterName: batter.name,
    hung: result.hung,
    grade,
    pitcherChoice: { typeId: g.pendingPitch.typeId, targetX: g.pendingPitch.targetX, targetY: g.pendingPitch.targetY, shift, grade, release: g.pendingPitch.release ?? null, releaseZone: g.pendingPitch.releaseZone ?? null, pitchOut: g.pendingPitch.pitchOut || null },
    batterChoice: { mode, batX, batY, swingDelta, steal: steal ? steal.base : null, squeeze: squeeze ? true : false, contactQuality: result.contactQuality, timingLabel: timingLabelOf(result.contactQuality) },
    closePlay: !!situation.closePlay,
  };

  if (situation.paEnded) battingSide.lineupIdx += 1;

  g.heldClose = 0; // 牽制壓制效果只作用到「這一球」，結算後歸零
  if (situation.paEnded) g.pickoffsThisPA = 0; // 打席結束，牽制次數重置

  g.pendingPitch = null;
  g.ready = { away: false, home: false };
  g.phase = 'result';
  g.deadline = Date.now() + RESULT_MS;

  // 再見得分：最後一局或延長局下半，主隊一超前立即結束
  if (g.half === 'bottom' && g.inning >= g.innings && g.home.score > g.away.score) {
    g.gameOverPending = true;
  }
}

export function actReadyNext(room, role) {
  const g = room.game;
  if (g.phase !== 'result') throw new Error('WRONG_PHASE');
  g.ready[role] = true;
  if (!(g.ready.away && g.ready.home)) return;
  advanceFromResult(room);
}

function advanceFromResult(room) {
  const g = room.game;
  // 兩邊都按繼續（或 result 超時）→ 推進
  g.ready = { away: false, home: false };
  g.notice = null;

  if (g.gameOverPending) {
    g.phase = 'gameover';
    g.deadline = null;
    g.winner = g.home.score > g.away.score ? g.home.team.name : g.away.team.name;
    g.endReason = '再見得分，比賽結束！';
    room.status = 'over';
    return;
  }

  let newHalf = false;
  g.heldClose = 0;
  if (g.outs >= 3) {
    g.pickoffsThisPA = 0;
    g.pendingSteal = null;
    g.outs = 0;
    g.balls = 0;
    g.strikes = 0;
    g.bases = { first: null, second: null, third: null };
    g.baseSpeeds = { first: 50, second: 50, third: 50 };
    if (g.half === 'top') {
      g.half = 'bottom';
    } else {
      g.half = 'top';
      g.inning += 1;
    }
    newHalf = true;
  }

  const over = checkGameOver(g, newHalf);
  if (over.over) {
    g.phase = 'gameover';
    g.deadline = null;
    g.winner = g.home.score === g.away.score ? null : g.home.score > g.away.score ? g.home.team.name : g.away.team.name;
    g.endReason = over.reason;
    room.status = 'over';
    return;
  }

  // 延長賽突破僵局制（快速決勝模式限定）：每個延長半局開始，前一棒打者站上二壘
  if (newHalf && g.inning > g.innings && g.extraMode !== 'cpbl') {
    const side = g[battingKey(g.half)];
    const len = side.lineup.length;
    const runner = side.lineup[(side.lineupIdx - 1 + len) % len];
    g.bases.second = runner.name;
    g.baseSpeeds.second = runner.speed;
    if (g.half === 'top') {
      pushLog(g, `⚔️ 進入第 ${g.inning} 局延長賽（突破僵局制：每半局開始二壘有跑者）`);
    }
    pushLog(g, `突破僵局制：${side.team.short} ${runner.name} 站上二壘`);
  }

  g.phase = 'pitcher';
  g.deadline = Date.now() + PHASE_MS;
}

/* ------------ 超時強制判定（state/action API 每次都會先跑） ------------ */

export function enforceTimeouts(room) {
  const g = room.game;
  if (!g || room.status !== 'playing') return false;
  if (!g.deadline || Date.now() < g.deadline + GRACE_MS) return false;

  if (g.phase === 'pitcher') {
    // 投手超時：自動失投紅中直球
    pushLog(g, '⏰ 守備方超時未配球——投手倉促出手，一顆失投的紅中直球！');
    commitPitch(room, { typeId: 'fastball', targetX: 50, targetY: 50, waste: false, shift: 'normal', release: null, auto: true });
    return true;
  }
  if (g.phase === 'batter') {
    // 打者超時：自動不揮棒
    pushLog(g, '⏰ 進攻方超時未反應——打者只能站著看這一球');
    resolveBatterPlay(room, { mode: 'take' });
    return true;
  }
  if (g.phase === 'result') {
    // 結果畫面逾時（例如對手斷線關掉瀏覽器）：直接推進到下一顆球，避免遊戲鎖死
    pushLog(g, '⏰ 結果畫面超時，自動繼續下一顆球');
    advanceFromResult(room);
    return true;
  }
  return false;
}

/* ------------ 挑釁系統 ------------ */
// 只能在「擊球結果」畫面按（按鈕在下一球下方）。第 1~11 次各對應一張梗圖（第 11 張＝摔倒，之後
// 永遠停留在摔倒狀態）。每次挑釁 20% 機率觸發主審警告，警告階梯（累計 x/4）：
//   1 次＝🟨 警告
//   2 次＝🟥 總教練驅逐（禁：盜壘、代打、佈陣）
//   3 次＝🟥 副教練也驅逐（追加禁：換投、牽制），並告知再犯先掉一分、直接裁定敗戰
//   4 次＝判對方得一分，隨即裁定敗戰、比賽結束
const TAUNT_LINES = [
  '「回家吧！下半場沒得踢啦！」',
  '「要不要一會我下去跳舞撐撐場面？」',
  '「跳舞也輪不到你跳，我跳！」',
  '直接在休息區前開心跳起舞來！',
  '瞪大眼睛怒吼：「想逼我發飆啊？」',
  '「球證、旁證，加上主辦、協辦所有的單位全部都是我的人，怎麼和我鬥？」',
  '不屑地揮揮手：「回鄉下吧！」',
  '指著休息區通道：「外面有記者，要不要把他們叫進來？」',
  '被自己人死命抱住還想往前衝——「老闆，你小心呀！」',
  '掙脫拉扯、破口大罵：「我小你老母！」',
  '氣過頭一個重心不穩，當場摔倒在場邊！',
];
const TAUNT_FALLEN_LINE = '躺在地上爬不起來，還在對著對面板凳比手畫腳！';
const TAUNT_MAX_STAGE = TAUNT_LINES.length; // 11：之後永遠停留在摔倒狀態

export const TAUNT_WARN_EVERY = 5; // 洗牌袋：每 5 次挑釁「保證恰好 1 次」警告（真・20%，不靠運氣）

// 洗牌袋抽取：袋內固定 1 張警告＋4 張安全牌，洗勻後逐張抽；抽完自動重洗新袋。
// 與「每次獨立擲 20%」的差別：長期精準 20%、不可能連續狂中、也不可能長期不中
// （最壞情況：上一袋第 1 張中＋下一袋第 5 張中＝最多隔 8 次；最密：跨袋背靠背 1 次）。
function drawWarnFromBag(me) {
  if (!Array.isArray(me.warnBag) || me.warnBag.length === 0) {
    const bag = Array.from({ length: TAUNT_WARN_EVERY }, (_, i) => i === 0);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // 上一張剛好是警告時，新袋的第一張（pop 端）不得又是警告——徹底杜絕連續兩次背靠背中獎
    if (me.lastDrawWasWarn && bag[bag.length - 1]) {
      const j = Math.floor(Math.random() * (bag.length - 1));
      [bag[bag.length - 1], bag[j]] = [bag[j], bag[bag.length - 1]];
    }
    me.warnBag = bag; // 舊房間（無此欄位）也會在這裡自動補上
  }
  const hit = !!me.warnBag.pop();
  me.lastDrawWasWarn = hit;
  return hit;
}

export function actTaunt(room, role) {
  const g = room.game;
  if (g.phase !== 'result') throw new Error('WRONG_PHASE'); // 只能在擊球結果畫面挑釁
  const me = g.taunts[role];
  const wasFallen = me.stage >= TAUNT_MAX_STAGE;
  me.stage = Math.min(me.stage + 1, TAUNT_MAX_STAGE);
  const short = g[role].team.short;
  pushLog(g, `😤 ${short} 對著對面板凳喊話：${wasFallen ? TAUNT_FALLEN_LINE : TAUNT_LINES[me.stage - 1]}`);

  // 警告階梯（洗牌袋制，每 5 次挑釁保證恰好 1 次）：
  //   第 1 次＝🟨 警告
  //   第 2 次＝🟥 總教練驅逐（禁：盜壘、代打、佈陣）
  //   第 3 次＝🟥 副教練也驅逐（追加禁：換投、牽制），並告知再犯先掉一分、直接裁定敗戰
  //   第 4 次＝判對方得一分，隨即裁定敗戰、比賽結束
  let warned = false;
  let justEjected = false;
  let justCoachEjected = false;
  let forfeited = false;
  if (me.warnings < 4 && drawWarnFromBag(me)) {
    warned = true;
    me.warnings += 1;
    if (me.warnings === 1) {
      pushLog(g, `🟨 主審臉色一沉，對 ${short} 板凳提出警告！（累計 1/4——兩次警告＝總教練驅逐）`);
    } else if (me.warnings === 2) {
      me.ejected = true;
      justEjected = true;
      pushLog(g, `🟥 主審大步走向 ${short} 休息區、比出驅逐手勢！總教練被驅逐出場——本場無法再下達盜壘、代打、佈陣戰術！`);
    } else if (me.warnings === 3) {
      me.coachEjected = true;
      justCoachEjected = true;
      pushLog(g, `🟥 主審這次連 ${short} 副教練也一起驅逐！本場追加禁止：換投、牽制！`);
      pushLog(g, `📢 主審厲聲告知 ${short}：再吃一次警告先判掉一分——第四次警告，直接裁定你們輸掉比賽！`);
    } else {
      // 第 4 次：掉一分＋直接裁定敗戰
      forfeited = true;
      const oppKey = role === 'away' ? 'home' : 'away';
      const opp = g[oppKey];
      opp.score += 1;
      pushLog(g, `⚫ ${short} 第四次警告！主審先判 ${opp.team.short} 得一分，隨即雙手一揮——裁定 ${short} 敗戰，比賽結束！`);
      g.phase = 'gameover';
      g.deadline = null;
      g.winner = opp.team.name;
      g.endReason = `${short} 累計四次警告——主審裁定敗戰（並判 ${opp.team.short} 加一分）`;
      room.status = 'over';
    }
  }
  g.tauntSeq += 1;
  g.tauntFeed = {
    seq: g.tauntSeq,
    by: role,
    stage: me.stage,
    warned,
    warnings: me.warnings,
    ejected: justEjected,
    coachEjected: justCoachEjected,
    forfeited,
  };
}

/* ------------ 彩蛋：投降輸一半／氣不夠了平局 ------------ */
// 觸發方式（前端）：
//   投降（surrender）：連點三下「直球」或「打擊」按鈕——接受＝發起方認輸
//   平局（draw）　　：連點三下「指叉球」或「強力打擊」按鈕——接受＝雙方握手言和
// 發起後對方大屏幕會播出對應的經典畫面並選擇是否接受。

export function actSurrenderOffer(room, role, payload) {
  const g = room.game;
  if (g.phase === 'gameover') throw new Error('WRONG_PHASE');
  if (g.surrender && g.surrender.status === 'pending') throw new Error('SURRENDER_PENDING');
  const kind = payload?.kind === 'draw' ? 'draw' : 'surrender';
  g.surrender = { by: role, status: 'pending', kind };
  pushLog(g, kind === 'draw'
    ? `🤝 ${g[role].team.short} 喘著大氣比出暫停手勢：「氣不夠了……是否平局？」全場愣住——`
    : `🏳️ ${g[role].team.short} 舉起白旗，向對方提出「投降輸一半」！全場譁然——`);
}

export function actSurrenderRespond(room, role, payload) {
  const g = room.game;
  if (!g.surrender || g.surrender.status !== 'pending') throw new Error('NO_SURRENDER');
  if (g.surrender.by === role) throw new Error('FORBIDDEN');
  const offerSide = g[g.surrender.by];
  const acceptSide = g[role];
  const kind = g.surrender.kind || 'surrender';
  if (payload?.accept) {
    g.surrender = { ...g.surrender, status: 'accepted' };
    g.phase = 'gameover';
    g.deadline = null;
    room.status = 'over';
    if (kind === 'draw') {
      g.winner = null;
      g.endReason = '雙方氣不夠了——握手言和，平局收場！';
      pushLog(g, `🤝 ${acceptSide.team.short} 也扶著膝蓋直點頭：「平局！就平局！」兩隊握手，比賽結束！`);
    } else {
      g.winner = acceptSide.team.name;
      g.endReason = `${offerSide.team.short} 投降輸一半——對啊！這裡流行投降輸一半！`;
      pushLog(g, `🏳️ ${acceptSide.team.short} 大手一揮接受投降：「對啊！這裡流行，這裡流行投降輸一半！」比賽結束！`);
    }
  } else {
    g.surrender = null;
    pushLog(g, kind === 'draw'
      ? `🤝 ${acceptSide.team.short} 冷冷一笑：「氣不夠了？那正好——繼續打！」比賽繼續！`
      : `🏳️ ${acceptSide.team.short} 把白旗丟了回去：「想投降？把比賽打完！」比賽繼續！`);
  }
}

export function viewFor(room, role) {
  const base = {
    code: room.code,
    status: room.status,
    innings: room.innings,
    role,
    awayTeamId: room.awayTeamId,
    homeTeamId: room.homeTeamId,
  };
  if (!room.game) return base;

  const g = room.game;
  const view = {
    ...base,
    game: {
      innings: g.innings,
      inning: g.inning,
      half: g.half,
      outs: g.outs,
      balls: g.balls,
      strikes: g.strikes,
      bases: g.bases,
      baseSpeeds: g.baseSpeeds,
      log: g.log,
      phase: g.phase,
      lastResult: g.lastResult,
      ready: g.ready,
      deadline: g.deadline,
      serverNow: Date.now(), // 供前端校正時鐘差計算倒數
      notice: g.notice,
      pickoffsThisPA: g.pickoffsThisPA || 0,
      heldClose: g.heldClose || 0,
      surrender: g.surrender || null,
      cor: g.cor || 1,
      tauntFeed: g.tauntFeed || null,
      // 注意：不能整包吐 taunts[role]——warnBag（洗牌袋剩餘內容）是隱藏資訊，
      // 外洩的話玩家看網路回應就能精準預知下一次警告何時來
      myTaunt: g.taunts?.[role]
        ? {
            stage: g.taunts[role].stage,
            warnings: g.taunts[role].warnings,
            ejected: g.taunts[role].ejected,
            coachEjected: g.taunts[role].coachEjected,
          }
        : null,
      oppEjected: !!g.taunts?.[role === 'away' ? 'home' : 'away']?.ejected,
      // 暗號（雙盲）：只給自己看，對方看不到——強迫取分歸打擊方、Pitch Out 歸守備方
      pendingSqueeze: role === battingKey(g.half) ? (g.pendingSqueeze || null) : null,
      pendingPitchOut: role === fieldingKey(g.half) ? (g.pendingPitchOut || null) : null,
      winner: g.winner,
      endReason: g.endReason,
      away: g.away,
      home: g.home,
      // 盜壘宣告是進攻方的祕密：守備方永遠看不到
      pendingSteal: role === battingKey(g.half) ? g.pendingSteal : null,
      stealOptions: role === battingKey(g.half) && g.phase === 'pitcher' ? stealOptionsOf(g.bases) : [],
      // 打者看得到佈陣與飛行路徑（path，即時反應動畫用）；
      // 球種名稱與投手瞄準點仍然保密到結果揭曉
      pendingPitch: g.pendingPitch
        ? role === fieldingKey(g.half)
          ? { typeId: g.pendingPitch.typeId, targetX: g.pendingPitch.targetX, targetY: g.pendingPitch.targetY, shift: g.pendingPitch.shift, grade: g.pendingPitch.grade }
          : { shift: g.pendingPitch.shift, path: g.pendingPitch.path }
        : null,
    },
  };
  return view;
}
