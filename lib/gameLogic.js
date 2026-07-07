import { TEAMS, ROLE_NAMES } from '../data/teams.js';
import { resolvePitch, applyOutcome, resolveSteal, applyStealResult } from './engine.js';

/* ------------ 共用工具（前後端都會 import） ------------ */

export function battingKey(half) {
  return half === 'top' ? 'away' : 'home';
}
export function fieldingKey(half) {
  return half === 'top' ? 'home' : 'away';
}

export function currentPitcher(sideState) {
  const p = sideState.team.pitchers[sideState.staff.currentIdx];
  const count = sideState.staff.pitchCounts[sideState.staff.currentIdx] || 0;
  const fatigue = Math.min(16, Math.floor(count / 8) * 2);
  return {
    ...p,
    fatigue,
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
    staff: { currentIdx: 0, used: [0], changesLeft: 2, pitchCounts: { 0: 0 } },
  };
}

function randomToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function createRoom({ code, innings, awayTeamId }) {
  const awayTeam = TEAMS.find((t) => t.id === awayTeamId);
  return {
    code,
    status: 'waiting', // waiting | playing | over
    innings,
    tokens: { away: randomToken(), home: null },
    awayTeamId,
    homeTeamId: null,
    game: null,
    createdAt: Date.now(),
  };
}

export function joinRoom(room, homeTeamId) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.home = randomToken();
  room.homeTeamId = homeTeamId;
  room.status = 'playing';
  const awayTeam = TEAMS.find((t) => t.id === room.awayTeamId);
  const homeTeam = TEAMS.find((t) => t.id === homeTeamId);
  room.game = {
    innings: room.innings,
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

function checkGameOver(g) {
  if (g.half === 'top' && g.inning > g.innings) return { over: true, reason: '比賽結束' };
  if (g.half === 'bottom' && g.inning === g.innings && g.home.score > g.away.score) {
    return { over: true, reason: '主隊領先，不需再打，比賽結束' };
  }
  if (g.half === 'bottom' && g.inning > g.innings) return { over: true, reason: '比賽結束' };
  return { over: false };
}

export function actChangePitcher(room, role, idx) {
  const g = room.game;
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE');
  if (role !== fieldingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  const side = g[role];
  if (side.staff.changesLeft <= 0 || side.staff.used.includes(idx)) throw new Error('INVALID');
  side.staff.currentIdx = idx;
  side.staff.used.push(idx);
  side.staff.changesLeft -= 1;
  side.staff.pitchCounts[idx] = 0;
  const p = side.team.pitchers[idx];
  pushLog(g, `${side.team.short} 更換投手：${ROLE_NAMES[p.role]} ${p.name} 登板`);
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
  pushLog(g, `${side.team.short} 代打：${bench.name} 上場（取代 ${outgoing.name}）`);
}

export function actPitcherSubmit(room, role, payload) {
  const g = room.game;
  if (g.phase !== 'pitcher') throw new Error('WRONG_PHASE');
  if (role !== fieldingKey(g.half)) throw new Error('NOT_YOUR_TURN');
  const { typeId, zoneTarget, shift } = payload;
  g.pendingPitch = { typeId, zoneTarget, shift: shift || 'normal' };
  g.phase = 'batter';
}

export function actBatterSubmit(room, role, payload) {
  const g = room.game;
  if (g.phase !== 'batter') throw new Error('WRONG_PHASE');
  const bKey = battingKey(g.half);
  const fKey = fieldingKey(g.half);
  if (role !== bKey) throw new Error('NOT_YOUR_TURN');

  const battingSide = g[bKey];
  const fieldingSide = g[fKey];
  const batter = battingSide.lineup[battingSide.lineupIdx % battingSide.lineup.length];
  const pitcher = currentPitcher(fieldingSide);
  const { mode, guessTypeId, guessZone, steal } = payload;
  const shift = g.pendingPitch.shift || 'normal';
  const isFav = pitcher.fav.includes(g.pendingPitch.typeId);

  const result = resolvePitch({
    pitcherZoneTarget: g.pendingPitch.zoneTarget,
    pitcherPitchTypeId: g.pendingPitch.typeId,
    pitcherStats: { control: pitcher.effControl, stuff: pitcher.effStuff, isFav },
    shift,
    batterMode: mode,
    batterGuessTypeId: guessTypeId,
    batterGuessZone: guessZone,
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

  const walked = situation.log === '四壞球保送';
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
    const runnerName = g.bases[stealTarget.base];
    const runnerSpeed = g.baseSpeeds[stealTarget.base];
    const success = resolveSteal({
      runnerSpeed,
      wastePitch,
      hitAndRun: stealTarget.hitAndRun,
      swingMiss: stealTarget.swingMiss,
    });
    const stealRes = applyStealResult({ bases: g.bases, outs: g.outs }, success, stealTarget.base, runnerName);
    g.outs = stealRes.outs;
    const toBase = stealTarget.base === 'first' ? 'second' : 'third';
    const sp = g.baseSpeeds[stealTarget.base];
    g.bases = stealRes.bases;
    g.baseSpeeds = { ...g.baseSpeeds, [stealTarget.base]: 50, [toBase]: success ? sp : 50 };
    extraLogs.push(stealRes.log);
  }

  if (runs > 0) battingSide.score += runs;

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
    extra: extraLogs,
    runs,
    batterName: batter.name,
    hung: result.hung,
    isFav,
    pitcherChoice: { typeId: g.pendingPitch.typeId, zoneTarget: g.pendingPitch.zoneTarget },
    batterChoice: { mode, guessTypeId, guessZone, steal: steal || null },
  };

  if (situation.paEnded) battingSide.lineupIdx += 1;

  g.pendingPitch = null;
  g.ready = { away: false, home: false };
  g.phase = 'result';

  if (g.half === 'bottom' && g.inning === g.innings && g.home.score > g.away.score) {
    g.gameOverPending = true;
  }
}

export function actReadyNext(room, role) {
  const g = room.game;
  if (g.phase !== 'result') throw new Error('WRONG_PHASE');
  g.ready[role] = true;
  if (!(g.ready.away && g.ready.home)) return;

  // 兩邊都按繼續 → 推進
  g.ready = { away: false, home: false };

  if (g.gameOverPending) {
    g.phase = 'gameover';
    g.winner = g.home.score > g.away.score ? g.home.team.name : g.away.team.name;
    g.endReason = '再見得分，比賽結束！';
    room.status = 'over';
    return;
  }

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
  }

  const over = checkGameOver(g);
  if (over.over) {
    g.phase = 'gameover';
    g.winner = g.home.score === g.away.score ? null : g.home.score > g.away.score ? g.home.team.name : g.away.team.name;
    g.endReason = over.reason;
    room.status = 'over';
    return;
  }

  g.phase = 'pitcher';
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
      winner: g.winner,
      endReason: g.endReason,
      away: g.away,
      home: g.home,
      // 打者只能看到佈陣，看不到球種與落點
      pendingPitch: g.pendingPitch
        ? role === fieldingKey(g.half)
          ? g.pendingPitch
          : { shift: g.pendingPitch.shift }
        : null,
    },
  };
  return view;
}
