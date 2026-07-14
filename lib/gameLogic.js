import { TEAMS, ROLE_NAMES, PITCH_TYPES, SHIFTS } from '../data/teams.js';
import { resolvePitch, applyOutcome, resolveSteal, applyStealResult, applyDoubleStealResult, computeActualPosition, buildFlightPath, FIELD, clampCanvas, gradeOf, timingLabelOf } from './engine.js';

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

function cloneStats(stats) {
  return JSON.parse(JSON.stringify(stats || freshStats()));
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

export function createRoom({ code, innings, awayTeamId, extraMode }) {
  const awayTeam = TEAMS.find((t) => t.id === awayTeamId);
  if (!awayTeam) throw new Error('BAD_TEAM');
  return {
    code,
    status: 'waiting', // waiting | playing | over
    innings,
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
    challenges: { away: 2, home: 2 }, // 電視輔助判決挑戰，比照中職每隊每場 2 次（挑戰成功不扣次數）
    prePlay: null, // 挑戰用：打擊結算前快照
    pickoffsThisPA: 0, // 本打席已牽制次數（每打席上限，防止無限重置倒數拖時間）
    heldClose: 0, // 牽制成功壓回壘的次數：套用到「下一球」的盜壘成功率（每球結算後歸零）
    pendingSteal: null, // 進攻方在對方配球階段偷偷宣告的盜壘（{ base: 'first'|'second'|'double' }），守備方看不到
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

export function actDeclareSteal(room, role, payload) {
  const g = room.game;
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE'); // 只能在對方配球時起跑
  if (role !== battingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  const base = payload?.base;
  if (base === null || base === undefined) {
    g.pendingSteal = null; // 取消
    return;
  }
  if (!STEAL_BASES.has(base)) throw new Error('BAD_INPUT');
  if (!stealOptionsOf(g.bases).includes(base)) throw new Error('BAD_INPUT');
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
        runs > 0 ? '但壘上已經滿了——強迫取分，三壘跑者踩過本壘得分！' : `${batter.name} 把球棒一放，慢跑上一壘`,
      ],
      extra: [],
      runs,
      batterName: batter.name,
      hung: false,
      isFav: false,
      pitcherChoice: { typeId: null, zoneTarget: 'ibb', shift: null },
      batterChoice: { mode: 'ibb' },
      challengeable: false,
      challenge: null,
    };
    battingSide.lineupIdx += 1;
    g.heldClose = 0;
    g.pickoffsThisPA = 0;
    g.pendingSteal = null; // 敬遠死球，盜壘宣告作廢
    g.pendingPitch = null;
    g.prePlay = null;
    g.ready = { away: false, home: false };
    g.phase = 'result';
    g.deadline = Date.now() + RESULT_MS;
    if (g.half === 'bottom' && g.inning >= g.innings && g.home.score > g.away.score) {
      g.gameOverPending = true;
    }
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

  // 出手時機：控球微調（±11），停在差勁地帶（<22）直接失投紅中
  const badRelease = release != null && release < 22;
  const effControl = Math.max(20, pitcher.effControl + (release != null ? Math.round((release - 55) / 4) : 0));

  let actualX;
  let actualY;
  let hung = false;
  if (auto || badRelease) {
    actualX = 50;
    actualY = 50;
    hung = true;
    if (badRelease) pushLog(g, `💥 ${pitcher.name} 出手時機沒抓好——球失去尾勁，直直飄向紅中！`);
  } else {
    const pos = computeActualPosition({ targetX, targetY, pitchTypeId: typeId, control: effControl, grade });
    actualX = pos.x;
    actualY = pos.y;
    hung = Math.abs(actualX - 50) < 6 && Math.abs(actualY - 50) < 6 && (Math.abs(targetX - 50) > 10 || Math.abs(targetY - 50) > 10);
  }

  // 觸身球：用實際落點算連續機率，越靠近打者（actualX 越小於好球帶內側邊界）機率越高
  if (!auto && !badRelease) {
    const insideness = Math.max(0, Math.min(1, (FIELD.zoneMin - actualX) / FIELD.zoneMin));
    if (insideness > 0) {
      const hbpChance = insideness * Math.min(0.06, Math.max(0.008, 0.035 - (effControl - 50) / 600));
      if (Math.random() < hbpChance) {
        resolveHbp(room, { typeId, targetX, targetY, shift, batter, pitcher, battingSide, fieldingSide });
        return;
      }
    }
  }

  const pitchType = PITCH_TYPES.find((t) => t.id === typeId);
  const path = buildFlightPath({ targetX, targetY, actualX, actualY, pitchTypeId: typeId, grade, effStuff: pitcher.effStuff });

  g.pendingPitch = {
    typeId,
    targetX,
    targetY,
    waste: !!waste,
    shift,
    release,
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
    challengeable: false,
    challenge: null,
  };
  battingSide.lineupIdx += 1;
  g.heldClose = 0;
  g.pickoffsThisPA = 0;
  g.pendingSteal = null; // 死球，盜壘宣告作廢
  g.pendingPitch = null;
  g.prePlay = null;
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
      challengeable: false,
      challenge: null,
    };
    g.pendingPitch = null;
    g.prePlay = null;
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

  // 球棒最終位置（連續座標，球到位當下取樣）：null＝沒出棒／看球
  let batX = payload?.batX;
  let batY = payload?.batY;
  if (mode === 'take' || batX == null || batY == null) {
    batX = null;
    batY = null;
  } else {
    if (!isFiniteNum(batX) || !isFiniteNum(batY)) throw new Error('BAD_INPUT');
    batX = clampCanvas(batX);
    batY = clampCanvas(batY);
  }

  const shift = g.pendingPitch.shift || 'normal';
  const grade = g.pendingPitch.grade || 'B';
  const steal = g.pendingSteal; // 投球前偷偷宣告的盜壘
  const runnersGoing = !!steal;

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
    batterStats: batter,
    strikes: g.strikes,
  });

  const prevBases = { ...g.bases };
  const prevSpeeds = { ...g.baseSpeeds };
  const runnerOnFirstSpeed = prevBases.first ? prevSpeeds.first : 50;

  // 挑戰機制用快照（打擊結算前的完整局面）
  g.prePlay = {
    balls: g.balls,
    strikes: g.strikes,
    outs: g.outs,
    bases: { ...prevBases },
    baseSpeeds: { ...prevSpeeds },
    battingKey: bKey,
    battingScore: battingSide.score,
    battingStats: cloneStats(battingSide.stats),
    fieldingKey: fKey,
    fieldingStats: cloneStats(fieldingSide.stats),
    lineupIdx: battingSide.lineupIdx,
    kind: result.kind,
    batterName: batter.name,
    batterSpeed: batter.speed,
    opts: { shift, mode, runnerOnFirstSpeed, runnersGoing, groundBias: result.groundBias },
    hadSteal: false,
    challenged: false,
    closePlay: false,
  };

  const situation = applyOutcome(
    { balls: g.balls, strikes: g.strikes, outs: g.outs, bases: prevBases },
    result.kind,
    batter.name,
    { shift, mode, runnerOnFirstSpeed, runnersGoing, groundBias: result.groundBias }
  );
  g.prePlay.closePlay = !!situation.closePlay;

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

  // ---- 盜壘結算（前置宣告制） ----
  const walked = situation.walked || result.kind === 'HBP';
  const wastePitch = !!g.pendingPitch.waste;
  const isFastball = g.pendingPitch.typeId === 'fastball';
  const breakingWhiff = !isFastball && !!situation.swingMiss; // 變化球揮空：捕手接球位置差

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
      if (steal.base === 'double') {
        const leadName = prevBases.second;
        const trailName = prevBases.first;
        // 打者結算後跑者仍在原壘且未滿 3 出局才成立
        if (leadName && trailName && g.bases.second === leadName && g.bases.first === trailName && g.outs < 3) {
          g.prePlay.hadSteal = true;
          const success = resolveSteal({
            runnerSpeed: prevSpeeds.second,
            wastePitch,
            fastball: isFastball,
            breakingWhiff,
            heldClose: g.heldClose || 0,
            doubleSteal: true,
          });
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
          g.prePlay.hadSteal = true;
          const runnerName = g.bases[base];
          const success = resolveSteal({
            runnerSpeed: g.baseSpeeds[base],
            wastePitch,
            fastball: isFastball,
            breakingWhiff,
            heldClose: g.heldClose || 0,
          });
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

  // 只有「千鈞一髮」的時間差判決可挑戰（外野接殺、乾淨安打都不行）
  const CHALLENGEABLE = ['OUT', 'SINGLE', 'BUNT_HIT', 'BUNT_OUT_NO_ADV'];
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
    pitcherChoice: { typeId: g.pendingPitch.typeId, targetX: g.pendingPitch.targetX, targetY: g.pendingPitch.targetY, shift, grade, release: g.pendingPitch.release ?? null },
    batterChoice: { mode, batX, batY, steal: steal ? steal.base : null, contactQuality: result.contactQuality, timingLabel: timingLabelOf(result.contactQuality) },
    challengeable: CHALLENGEABLE.includes(result.kind) && !!situation.closePlay && !g.prePlay.hadSteal,
    closePlay: !!situation.closePlay,
    challenge: null,
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

/* ------------ 挑戰機制（電視輔助判決） ------------ */

const FLIP_KIND = { OUT: 'SINGLE', SINGLE: 'OUT', BUNT_HIT: 'BUNT_OUT_NO_ADV', BUNT_OUT_NO_ADV: 'BUNT_HIT' };

export function actChallenge(room, role) {
  const g = room.game;
  if (g.phase !== 'result') throw new Error('WRONG_PHASE');
  if (g.ready[role]) throw new Error('ALREADY_READY');
  if ((g.challenges?.[role] ?? 0) <= 0) throw new Error('NO_CHALLENGE');
  const pp = g.prePlay;
  // 只有「千鈞一髮」的時間差判決（滾地刺殺／內野安打／觸擊）才可挑戰；
  // 外野接殺、乾淨的外野安打、三振保送全壘打都不存在改判空間
  if (!pp || pp.challenged || pp.hadSteal || !pp.closePlay || !FLIP_KIND[pp.kind] || !g.lastResult?.challengeable) {
    throw new Error('NOT_CHALLENGEABLE');
  }
  pp.challenged = true;
  g.lastResult.challengeable = false;
  const sideName = g[role].team.short;
  // close play 改判率 45%（本來就差一點，重播確實可能翻案）
  const success = Math.random() < 0.45;

  if (!success) {
    g.challenges[role] -= 1;
    pushLog(g, `📺 ${sideName} 提出挑戰！重播中心逐格檢視……確認原判決正確，維持原判（挑戰機會 -1）`);
    g.lastResult = {
      ...g.lastResult,
      challenge: { by: role, success: false, text: '📺 重播多角度逐格檢視：時間差確實存在，維持原判（挑戰機會 -1）' },
    };
    return;
  }

  // 挑戰成功：回復到打擊結算前的局面，套用改判後的結果（挑戰成功不扣次數）
  const flipped = FLIP_KIND[pp.kind];
  const toSafe = flipped === 'SINGLE' || flipped === 'BUNT_HIT'; // 出局改安打，或反之
  const battingSide = g[pp.battingKey];
  const fieldingSide = g[pp.fieldingKey];
  battingSide.stats = cloneStats(pp.battingStats);
  if (fieldingSide) fieldingSide.stats = cloneStats(pp.fieldingStats);
  const situation = applyOutcome(
    { balls: pp.balls, strikes: pp.strikes, outs: pp.outs, bases: { ...pp.bases } },
    flipped,
    pp.batterName,
    pp.opts
  );
  g.balls = situation.balls;
  g.strikes = situation.strikes;
  g.outs = situation.outs;
  g.bases = situation.bases;
  const mapSpeed = (name) => {
    if (!name) return 50;
    if (name === pp.batterName) return pp.batterSpeed;
    for (const b of ['first', 'second', 'third']) {
      if (pp.bases[b] === name) return pp.baseSpeeds[b];
    }
    return 50;
  };
  g.baseSpeeds = { first: mapSpeed(g.bases.first), second: mapSpeed(g.bases.second), third: mapSpeed(g.bases.third) };
  const runs = situation.runsThisPlay || 0;
  battingSide.score = pp.battingScore + runs;
  battingSide.lineupIdx = pp.lineupIdx + (situation.paEnded ? 1 : 0);
  applyBoxStats({ battingSide, fieldingSide, kind: flipped, situation, batterName: pp.batterName });

  // 改判敘述必須符合改判方向
  const verdictLine = toSafe
    ? '逐格畫面顯示——跑者的腳步確實早一步踩上壘包，球晚到了！改判：安全上壘！'
    : '逐格畫面顯示——球先進手套、觸壘在前，跑者慢了半步！改判：出局！';

  let line = `📺 ${sideName} 提出挑戰！重播中心逐格檢視……改判！${situation.log}`;
  if (runs > 0) line += `，${battingSide.team.short} 得 ${runs} 分`;
  pushLog(g, line);
  g.lastResult = {
    ...g.lastResult,
    summary: situation.log,
    runs,
    narration: [
      '📺 挑戰成立！大螢幕開始重播慢動作，全場屏息——',
      verdictLine,
      `場上判決更正：${situation.log}`,
    ],
    challenge: { by: role, success: true, text: `📺 ${verdictLine}（挑戰成功不扣次數）` },
  };

  // 改判可能改變出局數/得分，重新檢查再見情況
  if (g.half === 'bottom' && g.inning >= g.innings && g.home.score > g.away.score) {
    g.gameOverPending = true;
  } else {
    g.gameOverPending = false;
  }
  g.deadline = Date.now() + RESULT_MS;
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
      challenges: g.challenges,
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
