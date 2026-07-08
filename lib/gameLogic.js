import { TEAMS, ROLE_NAMES, PITCH_TYPES, SHIFTS, QUADS, isCellsContiguous } from '../data/teams.js';
import { resolvePitch, applyOutcome, resolveSteal, applyStealResult } from './engine.js';

const TEAM_IDS = new Set(TEAMS.map((t) => t.id));
const PITCH_TYPE_IDS = new Set(PITCH_TYPES.map((p) => p.id));
const BREAKING_TYPE_IDS = new Set(PITCH_TYPES.filter((p) => p.id !== 'fastball').map((p) => p.id));
const SHIFT_IDS = new Set(SHIFTS.map((s) => s.id));
const ZONE_IDS = new Set(['0-0', '0-1', '0-2', '1-0', '1-1', '1-2', '2-0', '2-1', '2-2']);
const QUAD_IDS = new Set(QUADS.map((q) => q.id));
const MODES = new Set(['lock', 'protect', 'take', 'bunt', 'hitrun']);
const STEAL_BASES = new Set(['first', 'second']);

/* ------------ 共用工具（前後端都會 import） ------------ */

export const PHASE_MS = 15000; // 投球/打擊選擇時限 15 秒
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
  };
  return room;
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

  const { typeId, zoneTarget, shift = 'normal' } = payload || {};
  if (!PITCH_TYPE_IDS.has(typeId) || !(ZONE_IDS.has(zoneTarget) || zoneTarget === 'waste') || !SHIFT_IDS.has(shift)) {
    throw new Error('BAD_INPUT');
  }
  g.pendingPitch = { typeId, zoneTarget, shift: shift || 'normal' };
  g.phase = 'batter';
  g.deadline = Date.now() + PHASE_MS;
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
  const { mode, guessCat, guessSpecies, guessZoneKind = 'cell', guessZone, steal } = payload || {};
  if (!MODES.has(mode)) throw new Error('BAD_INPUT');
  // 不論 mode 為何都要白名單化這些欄位，避免非 lock 模式塞入超長字串隨 lastResult 存回 Redis 撐爆房間物件
  if (guessCat != null && !['fastball', 'breaking'].includes(guessCat)) throw new Error('BAD_INPUT');
  if (guessSpecies != null && !PITCH_TYPE_IDS.has(guessSpecies)) throw new Error('BAD_INPUT');
  if (guessZoneKind != null && !['cell', 'quad'].includes(guessZoneKind)) throw new Error('BAD_INPUT');
  // guessZone：quad 模式為單一 quad id；cell 模式為 1~3 個相連格子的陣列（或單一 cell id 作為兼容輸入）
  if (guessZone != null) {
    if (guessZoneKind === 'quad') {
      if (typeof guessZone !== 'string' || !QUAD_IDS.has(guessZone)) throw new Error('BAD_INPUT');
    } else {
      // cell 模式
      const cells = Array.isArray(guessZone) ? guessZone : [guessZone];
      if (cells.length < 1 || cells.length > 3) throw new Error('BAD_INPUT');
      for (const c of cells) {
        if (typeof c !== 'string' || !ZONE_IDS.has(c)) throw new Error('BAD_INPUT');
      }
      if (new Set(cells).size !== cells.length) throw new Error('BAD_INPUT');
      if (!isCellsContiguous(cells)) throw new Error('BAD_INPUT');
    }
  }
  if (steal != null && !STEAL_BASES.has(steal)) throw new Error('BAD_INPUT');
  if (mode === 'lock') {
    // lock 模式要求這些欄位必須被指定且合法（上一段白名單已擋掉非法值，這裡只補「必填」檢查）
    if (!['fastball', 'breaking'].includes(guessCat)) throw new Error('BAD_INPUT');
    if (guessCat === 'fastball' && guessSpecies) throw new Error('BAD_INPUT');
    if (guessCat === 'breaking' && guessSpecies && !BREAKING_TYPE_IDS.has(guessSpecies)) throw new Error('BAD_INPUT');
    if (!['cell', 'quad'].includes(guessZoneKind)) throw new Error('BAD_INPUT');
    if (guessZone == null) throw new Error('BAD_INPUT');
  }
  const shift = g.pendingPitch.shift || 'normal';
  const isFav = pitcher.fav.includes(g.pendingPitch.typeId);

  const result = resolvePitch({
    pitcherZoneTarget: g.pendingPitch.zoneTarget,
    pitcherPitchTypeId: g.pendingPitch.typeId,
    pitcherStats: { control: pitcher.effControl, stuff: pitcher.effStuff, isFav, throws: pitcher.throws },
    shift,
    batterMode: mode,
    batterGuessCat: guessCat,
    batterGuessSpecies: guessSpecies,
    batterGuessZoneKind: guessZoneKind || 'cell',
    batterGuessZone: guessZone,
    batterStats: batter,
    strikes: g.strikes,
    forceHung: !!g.pendingPitch.auto, // 投手超時的自動失投球
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
    opts: { shift, mode, runnerOnFirstSpeed },
    hadSteal: false,
    challenged: false,
  };

  const situation = applyOutcome(
    { balls: g.balls, strikes: g.strikes, outs: g.outs, bases: prevBases },
    result.kind,
    batter.name,
    { shift, mode, runnerOnFirstSpeed }
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

  // 死球（保送/觸身球）不能盜壘——用 engine 標記的旗標判斷，避免依賴中文 log 文案
  const walked = situation.walked || result.kind === 'HBP';
  const wastePitch = g.pendingPitch.zoneTarget === 'waste';

  let stealTarget = null;
  if (mode === 'hitrun' && situation.swingMiss && prevBases.first && g.bases.first === prevBases.first) {
    stealTarget = { base: 'first', hitAndRun: true, swingMiss: true };
  } else if (
    steal &&
    !situation.ballInPlay &&
    !situation.foul &&
    !walked &&
    prevBases[steal] &&
    g.bases[steal] === prevBases[steal] &&
    g.outs < 3
  ) {
    stealTarget = { base: steal, hitAndRun: false, swingMiss: false };
  }

  if (stealTarget) {
    g.prePlay.hadSteal = true;
    const runnerName = g.bases[stealTarget.base];
    const runnerSpeed = g.baseSpeeds[stealTarget.base];
    const success = resolveSteal({
      runnerSpeed,
      wastePitch,
      hitAndRun: stealTarget.hitAndRun,
      swingMiss: stealTarget.swingMiss,
    });
    const stealRes = applyStealResult({ bases: g.bases, outs: g.outs }, success, stealTarget.base, runnerName);
    const battingStats = battingSide.stats || (battingSide.stats = freshStats());
    if (success) battingStats.steals += 1;
    else battingStats.caughtStealing += 1;
    // 若打擊結算已滿 3 出局，盜壘刺殺不再累加（避免出現 4 outs）
    g.outs = Math.min(3, stealRes.outs);
    const toBase = stealTarget.base === 'first' ? 'second' : 'third';
    const sp = g.baseSpeeds[stealTarget.base];
    g.bases = stealRes.bases;
    g.baseSpeeds = { ...g.baseSpeeds, [stealTarget.base]: 50, [toBase]: success ? sp : 50 };
    extraLogs.push(stealRes.log);
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

  const CHALLENGEABLE = ['OUT', 'SINGLE', 'BUNT_HIT', 'BUNT_OUT_NO_ADV'];
  g.lastResult = {
    pitchTypeName: result.pitchTypeName,
    zoneLabel: result.actualZoneLabel,
    summary: situation.log,
    narration: situation.narration || null, // 逐句轉播文字
    extra: extraLogs,
    runs,
    batterName: batter.name,
    hung: result.hung,
    isFav,
    pitcherChoice: { typeId: g.pendingPitch.typeId, zoneTarget: g.pendingPitch.zoneTarget, shift },
    batterChoice: { mode, guessCat: guessCat || null, guessSpecies: guessSpecies || null, guessZoneKind: guessZoneKind || 'cell', guessZone: guessZone || null, steal: steal || null },
    challengeable: CHALLENGEABLE.includes(result.kind) && !g.prePlay.hadSteal,
    challenge: null,
  };

  if (situation.paEnded) battingSide.lineupIdx += 1;

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
  if (g.outs >= 3) {
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
    g.pendingPitch = { typeId: 'fastball', zoneTarget: '1-1', shift: 'normal', auto: true };
    pushLog(g, '⏰ 守備方超時未配球——投手倉促出手，一顆失投的紅中直球！');
    g.phase = 'batter';
    g.deadline = Date.now() + PHASE_MS;
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
  if (!pp || pp.challenged || pp.hadSteal || !FLIP_KIND[pp.kind] || !g.lastResult?.challengeable) {
    throw new Error('NOT_CHALLENGEABLE');
  }
  pp.challenged = true;
  g.lastResult.challengeable = false;
  const sideName = g[role].team.short;
  const success = Math.random() < 0.35;

  if (!success) {
    g.challenges[role] -= 1;
    pushLog(g, `📺 ${sideName} 提出挑戰！電視輔助判決重看慢動作……維持原判（挑戰機會用完）`);
    g.lastResult = { ...g.lastResult, challenge: { by: role, success: false, text: '📺 電視輔助判決：維持原判，挑戰機會 -1' } };
    return;
  }

  // 挑戰成功：回復到打擊結算前的局面，套用改判後的結果（挑戰成功不扣次數）
  const flipped = FLIP_KIND[pp.kind];
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

  let line = `📺 ${sideName} 提出挑戰！電視輔助判決重看慢動作……改判！${situation.log}`;
  if (runs > 0) line += `，${battingSide.team.short} 得 ${runs} 分`;
  pushLog(g, line);
  g.lastResult = {
    ...g.lastResult,
    summary: situation.log,
    runs,
    narration: [...(situation.narration || [situation.log]), '📺 經電視輔助判決改判！'],
    challenge: { by: role, success: true, text: '📺 電視輔助判決：改判成立！（挑戰成功不扣次數）' },
  };
  // 改判可能影響再見得分判定，重新計算
  g.gameOverPending = g.half === 'bottom' && g.inning >= g.innings && g.home.score > g.away.score;
  g.ready = { away: false, home: false };
  // 改判動畫需要重看，重新給滿 RESULT_MS，避免原本快到期的 deadline 讓 result 一輪詢就被 timeout 推進
  g.deadline = Date.now() + RESULT_MS;
}

// 過濾要傳給某個玩家的視圖（隱藏對手 token 與投手的秘密選擇）
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
      challenges: g.challenges,
      winner: g.winner,
      endReason: g.endReason,
      away: g.away,
      home: g.home,
      // 打者只能看到佈陣，看不到球種與落點；即便是守備方也不外送內部旗標（auto）
      pendingPitch: g.pendingPitch
        ? role === fieldingKey(g.half)
          ? { typeId: g.pendingPitch.typeId, zoneTarget: g.pendingPitch.zoneTarget, shift: g.pendingPitch.shift }
          : { shift: g.pendingPitch.shift }
        : null,
    },
  };
  return view;
}
