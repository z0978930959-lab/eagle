'use client';

import { useReducer } from 'react';
import { TEAMS, PITCH_TYPES, SHIFTS, ROLE_NAMES, zoneId, zoneLabel } from '../data/teams';
import { resolvePitch, applyOutcome, resolveSteal, applyStealResult, PITCH_TYPE_MAP } from '../lib/engine';

function battingKey(half) {
  return half === 'top' ? 'away' : 'home';
}
function fieldingKey(half) {
  return half === 'top' ? 'home' : 'away';
}

function freshTeamState(team) {
  return {
    team,
    lineup: team.batters.map((b) => ({ ...b })),
    bench: team.bench.map((b) => ({ ...b, used: false })),
    lineupIdx: 0,
    score: 0,
    staff: {
      currentIdx: 0,
      used: [0],
      changesLeft: 2,
      pitchCounts: { 0: 0 },
    },
  };
}

function currentPitcher(sideState) {
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

function initialState() {
  return {
    phase: 'setup',
    innings: 3,
    away: null,
    home: null,
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: { first: null, second: null, third: null },
    baseSpeeds: { first: 50, second: 50, third: 50 },
    log: [],
    pendingPitch: null,
    lastResult: null,
    handoffMessage: '',
    handoffNext: null,
    winner: null,
    endReason: '',
    gameOverPending: false,
  };
}

function pushLog(state, text) {
  return [{ id: `${Date.now()}-${Math.random()}`, inning: state.inning, half: state.half, text }, ...state.log].slice(0, 80);
}

function checkGameOver(state) {
  const { innings, inning, half, away, home } = state;
  if (half === 'top' && inning > innings) return { over: true, reason: '比賽結束' };
  if (half === 'bottom' && inning === innings && home.score > away.score) {
    return { over: true, reason: '主隊領先，不需再打，比賽結束' };
  }
  if (half === 'bottom' && inning > innings) return { over: true, reason: '比賽結束' };
  return { over: false };
}

function reducer(state, action) {
  switch (action.type) {
    case 'START_GAME': {
      const { awayId, homeId, innings } = action.payload;
      const awayTeam = TEAMS.find((t) => t.id === awayId);
      const homeTeam = TEAMS.find((t) => t.id === homeId);
      return {
        ...initialState(),
        innings,
        away: freshTeamState(awayTeam),
        home: freshTeamState(homeTeam),
        phase: 'handoff',
        handoffNext: 'pitcher',
        handoffMessage: `第 1 局上半開始。${homeTeam.name} 投手準備投球，請 ${awayTeam.name} 的打者暫時別看螢幕。`,
      };
    }
    case 'ACK_HANDOFF':
      return { ...state, phase: state.handoffNext };

    case 'CHANGE_PITCHER': {
      const fKey = fieldingKey(state.half);
      const side = state[fKey];
      const newIdx = action.payload.idx;
      if (side.staff.changesLeft <= 0 || side.staff.used.includes(newIdx)) return state;
      const newStaff = {
        ...side.staff,
        currentIdx: newIdx,
        used: [...side.staff.used, newIdx],
        changesLeft: side.staff.changesLeft - 1,
        pitchCounts: { ...side.staff.pitchCounts, [newIdx]: 0 },
      };
      const p = side.team.pitchers[newIdx];
      return {
        ...state,
        [fKey]: { ...side, staff: newStaff },
        log: pushLog(state, `${side.team.short} 更換投手：${ROLE_NAMES[p.role]} ${p.name} 登板`),
      };
    }

    case 'PINCH_HIT': {
      const bKey = battingKey(state.half);
      const side = state[bKey];
      const benchIdx = action.payload.benchIdx;
      const bench = side.bench[benchIdx];
      if (!bench || bench.used) return state;
      const slot = side.lineupIdx % side.lineup.length;
      const outgoing = side.lineup[slot];
      const newLineup = [...side.lineup];
      newLineup[slot] = { ...bench };
      const newBench = side.bench.map((b, i) => (i === benchIdx ? { ...b, used: true } : b));
      return {
        ...state,
        [bKey]: { ...side, lineup: newLineup, bench: newBench },
        log: pushLog(state, `${side.team.short} 代打：${bench.name} 上場（取代 ${outgoing.name}）`),
      };
    }

    case 'CONFIRM_PITCH': {
      const fKey = fieldingKey(state.half);
      const bKey = battingKey(state.half);
      return {
        ...state,
        pendingPitch: action.payload, // { typeId, zoneTarget, shift }
        phase: 'handoff',
        handoffNext: 'batter',
        handoffMessage: `${state[fKey].team.name} 投手已完成配球。換 ${state[bKey].team.name} 打者反應，請投手方先別看螢幕。`,
      };
    }

    case 'CONFIRM_BATTER': {
      const bKey = battingKey(state.half);
      const fKey = fieldingKey(state.half);
      const battingSide = state[bKey];
      const fieldingSide = state[fKey];
      const batter = battingSide.lineup[battingSide.lineupIdx % battingSide.lineup.length];
      const pitcher = currentPitcher(fieldingSide);
      const { mode, guessTypeId, guessZone, steal } = action.payload;
      const shift = state.pendingPitch.shift || 'normal';
      const isFav = pitcher.fav.includes(state.pendingPitch.typeId);

      const result = resolvePitch({
        pitcherZoneTarget: state.pendingPitch.zoneTarget,
        pitcherPitchTypeId: state.pendingPitch.typeId,
        pitcherStats: { control: pitcher.effControl, stuff: pitcher.effStuff, isFav },
        shift,
        batterMode: mode,
        batterGuessTypeId: guessTypeId,
        batterGuessZone: guessZone,
        batterStats: batter,
        strikes: state.strikes,
      });

      const runnerOnFirstSpeed = state.bases.first ? state.baseSpeeds.first : 50;
      const situation = applyOutcome(
        { balls: state.balls, strikes: state.strikes, outs: state.outs, bases: state.bases },
        result.kind,
        batter.name,
        { shift, mode, runnerOnFirstSpeed }
      );

      let s = { ...state };
      s.balls = situation.balls;
      s.strikes = situation.strikes;
      s.outs = situation.outs;

      // 同步壘上跑者與速度值
      const newSpeeds = { first: 50, second: 50, third: 50 };
      const mapSpeed = (name) => {
        if (!name) return 50;
        if (name === batter.name) return batter.speed;
        for (const base of ['first', 'second', 'third']) {
          if (state.bases[base] === name) return state.baseSpeeds[base];
        }
        return 50;
      };
      s.bases = situation.bases;
      for (const base of ['first', 'second', 'third']) {
        newSpeeds[base] = mapSpeed(situation.bases[base]);
      }
      s.baseSpeeds = newSpeeds;

      let runs = situation.runsThisPlay || 0;
      let extraLogs = [];

      // 盜壘/打帶跑跑者判定（球未進場內時）
      const walked = situation.log === '四壞球保送';
      const wastePitch = state.pendingPitch.zoneTarget === 'waste';

      let stealTarget = null;
      if (mode === 'hitrun' && situation.swingMiss && state.bases.first && s.bases.first === state.bases.first) {
        stealTarget = { base: 'first', hitAndRun: true, swingMiss: true };
      } else if (
        steal &&
        !situation.ballInPlay &&
        !situation.foul &&
        !walked &&
        state.bases[steal] &&
        s.bases[steal] === state.bases[steal] &&
        s.outs < 3
      ) {
        stealTarget = { base: steal, hitAndRun: false, swingMiss: false };
      }

      if (stealTarget) {
        const runnerName = s.bases[stealTarget.base];
        const runnerSpeed = s.baseSpeeds[stealTarget.base];
        const success = resolveSteal({
          runnerSpeed,
          wastePitch,
          hitAndRun: stealTarget.hitAndRun,
          swingMiss: stealTarget.swingMiss,
        });
        const stealRes = applyStealResult({ bases: s.bases, outs: s.outs }, success, stealTarget.base, runnerName);
        s.outs = stealRes.outs;
        // 更新速度對應
        const toBase = stealTarget.base === 'first' ? 'second' : 'third';
        const sp = s.baseSpeeds[stealTarget.base];
        s.bases = stealRes.bases;
        s.baseSpeeds = { ...s.baseSpeeds, [stealTarget.base]: 50, [toBase]: success ? sp : 50 };
        extraLogs.push(stealRes.log);
      }

      if (runs > 0) {
        s[bKey] = { ...battingSide, score: battingSide.score + runs };
      }

      // 投手球數 +1
      const staff = fieldingSide.staff;
      const newCounts = { ...staff.pitchCounts, [staff.currentIdx]: (staff.pitchCounts[staff.currentIdx] || 0) + 1 };
      s[fKey] = { ...(runs > 0 && fKey === bKey ? s[fKey] : fieldingSide), staff: { ...staff, pitchCounts: newCounts } };

      let logLine = `【${batter.name}】${pitcher.name} 投出${result.pitchTypeName}${result.hung ? '（失投！）' : ''}（落點：${result.actualZoneLabel}）→ ${situation.log}`;
      if (runs > 0) logLine += `，${battingSide.team.short} 得 ${runs} 分`;
      s.log = pushLog(state, logLine);
      for (const el of extraLogs) s.log = [{ id: `${Date.now()}-${Math.random()}`, inning: s.inning, half: s.half, text: el }, ...s.log];

      s.lastResult = {
        pitchTypeName: result.pitchTypeName,
        zoneLabel: result.actualZoneLabel,
        summary: situation.log,
        extra: extraLogs,
        runs,
        batterName: batter.name,
        hung: result.hung,
        isFav,
      };

      if (situation.paEnded) {
        const bs = s[bKey];
        s[bKey] = { ...bs, lineupIdx: bs.lineupIdx + 1 };
      }

      s.pendingPitch = null;
      s.phase = 'result';

      if (s.half === 'bottom' && s.inning === s.innings && s.home.score > s.away.score) {
        s.gameOverPending = true;
      }
      return s;
    }

    case 'NEXT_PITCH': {
      let s = { ...state };

      if (s.gameOverPending) {
        s.phase = 'gameover';
        s.winner = s.home.score > s.away.score ? s.home.team.name : s.away.team.name;
        s.endReason = '再見得分，比賽結束！';
        return s;
      }

      if (s.outs >= 3) {
        s.outs = 0;
        s.balls = 0;
        s.strikes = 0;
        s.bases = { first: null, second: null, third: null };
        s.baseSpeeds = { first: 50, second: 50, third: 50 };
        if (s.half === 'top') {
          s.half = 'bottom';
        } else {
          s.half = 'top';
          s.inning += 1;
        }
      }

      const over = checkGameOver(s);
      if (over.over) {
        s.phase = 'gameover';
        s.winner = s.home.score === s.away.score ? null : s.home.score > s.away.score ? s.home.team.name : s.away.team.name;
        s.endReason = over.reason;
        return s;
      }

      const fKey = fieldingKey(s.half);
      const bKey = battingKey(s.half);
      s.phase = 'handoff';
      s.handoffNext = 'pitcher';
      s.handoffMessage = `${s.inning} 局${s.half === 'top' ? '上' : '下'}。${s[fKey].team.name} 投手準備投球，請 ${s[bKey].team.name} 的打者先別看螢幕。`;
      return s;
    }

    case 'RESTART':
      return initialState();
    default:
      return state;
  }
}

/* ---------------- UI 元件 ---------------- */

function ZoneGrid({ selected, onSelect, disabled = false }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 w-full max-w-[260px] mx-auto">
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => {
          const key = zoneId(r, c);
          const isHeart = r === 1 && c === 1;
          const isSel = selected === key;
          return (
            <button
              key={key}
              disabled={disabled}
              onClick={() => onSelect(key)}
              className={`aspect-square rounded-md text-[11px] font-mono-tc flex items-center justify-center border transition
                ${isSel ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'bg-field-grass2/70 border-field-chalk/15 text-field-chalk/80 hover:bg-field-grass2'}
                ${isHeart && !isSel ? 'ring-1 ring-field-floodlight/50' : ''}
              `}
            >
              {zoneLabel(r, c)}
            </button>
          );
        })
      )}
    </div>
  );
}

function PitchTypeRow({ selected, onSelect, favIds = [], disabled = false }) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {PITCH_TYPES.map((p) => {
        const isFav = favIds.includes(p.id);
        return (
          <button
            key={p.id}
            disabled={disabled}
            onClick={() => onSelect(p.id)}
            className={`px-3 py-1.5 rounded-full text-sm border transition relative
              ${selected === p.id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25 text-field-chalk/85 hover:border-field-chalk/50'}
            `}
          >
            {isFav && <span className="mr-0.5">★</span>}
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

function Diamond({ bases }) {
  const dot = (on) => (on ? 'bg-field-floodlight border-field-floodlight' : 'bg-transparent border-field-chalk/30');
  return (
    <div className="relative w-16 h-16 mx-auto">
      <div className={`absolute w-4 h-4 rotate-45 border-2 top-0 left-1/2 -translate-x-1/2 ${dot(bases.second)}`} />
      <div className={`absolute w-4 h-4 rotate-45 border-2 top-1/2 left-0 -translate-y-1/2 ${dot(bases.third)}`} />
      <div className={`absolute w-4 h-4 rotate-45 border-2 top-1/2 right-0 -translate-y-1/2 ${dot(bases.first)}`} />
      <div className="absolute w-3 h-3 rotate-45 border-2 bottom-0 left-1/2 -translate-x-1/2 border-field-chalk/30" />
    </div>
  );
}

function Scoreboard({ state }) {
  const { away, home, inning, innings, half, outs, balls, strikes } = state;
  return (
    <div className="rounded-xl bg-black/30 shadow-dugout px-4 py-3 font-mono-tc">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold" style={{ color: away.team.color }}>{away.team.short}</span>
          <span className="text-2xl font-bold">{away.score}</span>
        </div>
        <div className="text-xs text-field-chalk/60 text-center leading-tight">
          <div>第 {inning} / {innings} 局 {half === 'top' ? '上' : '下'}</div>
          <div className="mt-0.5">{'●'.repeat(Math.min(outs, 2))}{'○'.repeat(Math.max(0, 2 - outs))} 出局</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold">{home.score}</span>
          <span className="font-display font-bold" style={{ color: home.team.color }}>{home.team.short}</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-6 mt-2">
        <Diamond bases={state.bases} />
        <div className="text-sm">{balls} 壞 － {strikes} 好</div>
      </div>
    </div>
  );
}

function SetupScreen({ onStart }) {
  const [awayId, setAwayId] = useReducer((s, v) => v, TEAMS[0].id);
  const [homeId, setHomeId] = useReducer((s, v) => v, TEAMS[1].id);
  const [innings, setInnings] = useReducer((s, v) => v, 3);

  return (
    <div className="max-w-xl mx-auto px-5 py-10">
      <h1 className="font-display text-3xl font-black tracking-wide text-center mb-1">中職夜戰</h1>
      <p className="text-center text-field-chalk/60 text-sm mb-8">本機雙人・逐球猜球心理戰</p>

      <div className="space-y-6">
        <div>
          <div className="text-sm mb-2 text-field-chalk/70">局數</div>
          <div className="flex gap-2">
            {[1, 3].map((n) => (
              <button
                key={n}
                onClick={() => setInnings(n)}
                className={`flex-1 py-2 rounded-lg border font-mono-tc ${innings === n ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
              >
                {n} 局制
              </button>
            ))}
          </div>
        </div>

        {[['玩家 1 ・ 先攻', awayId, setAwayId, homeId], ['玩家 2 ・ 後攻', homeId, setHomeId, awayId]].map(([label, val, set, other]) => (
          <div key={label}>
            <div className="text-sm mb-2 text-field-chalk/70">{label}</div>
            <div className="grid grid-cols-2 gap-2">
              {TEAMS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => set(t.id)}
                  disabled={t.id === other}
                  className={`py-2 px-2 rounded-lg border text-sm disabled:opacity-30 ${val === t.id ? 'border-field-floodlight bg-field-floodlight/10 font-bold' : 'border-field-chalk/25'}`}
                  style={{ color: val === t.id ? t.color : undefined }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={() => onStart({ awayId, homeId, innings })}
          className="w-full py-3 rounded-lg bg-field-floodlight text-field-night font-bold text-lg"
        >
          開始比賽
        </button>
        <p className="text-xs text-field-chalk/40 leading-relaxed">
          每隊 3 名投手（先發／中繼／終結者，一場最多換投 2 次）＋2 名板凳代打。★ 為投手擅長球路：更會位移騙人、被猜中傷害也較低；非擅長球路有失投跑進紅中的風險。球員數值為參考值，非官方精確數據。
        </p>
      </div>
    </div>
  );
}

function PitcherScreen({ state, dispatch }) {
  const [typeId, setTypeId] = useReducer((s, v) => v, 'fastball');
  const [zone, setZone] = useReducer((s, v) => v, null);
  const [shift, setShift] = useReducer((s, v) => v, 'normal');
  const [showBullpen, setShowBullpen] = useReducer((s, v) => v, false);

  const fKey = fieldingKey(state.half);
  const side = state[fKey];
  const team = side.team;
  const pitcher = currentPitcher(side);

  const confirm = (target) => {
    dispatch({ type: 'CONFIRM_PITCH', payload: { typeId, zoneTarget: target, shift } });
  };

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <div className="text-center mb-4">
        <div className="text-xs text-field-chalk/50">投手方</div>
        <div className="font-display text-xl font-bold" style={{ color: team.color }}>
          {team.name}｜{ROLE_NAMES[pitcher.role]} {pitcher.name}
        </div>
        <div className="text-[11px] text-field-chalk/40 mt-0.5">
          控球 {pitcher.effControl} ・球威 {pitcher.effStuff}
          {pitcher.fatigue > 0 && <span className="text-red-300/80">（疲勞 -{pitcher.fatigue}）</span>}
          ・已投 {pitcher.pitchCount} 球
        </div>
      </div>
      <Scoreboard state={state} />

      <div className="mt-4 flex justify-center">
        <button
          onClick={() => setShowBullpen(!showBullpen)}
          disabled={side.staff.changesLeft <= 0}
          className="text-xs border border-field-chalk/25 rounded-full px-3 py-1 disabled:opacity-30"
        >
          換投（剩 {side.staff.changesLeft} 次）
        </button>
      </div>
      {showBullpen && (
        <div className="mt-2 flex flex-col gap-1.5 max-w-[300px] mx-auto">
          {team.pitchers.map((p, i) => {
            const used = side.staff.used.includes(i);
            if (i === side.staff.currentIdx) return null;
            return (
              <button
                key={p.name}
                disabled={used}
                onClick={() => {
                  dispatch({ type: 'CHANGE_PITCHER', payload: { idx: i } });
                  setShowBullpen(false);
                }}
                className="text-sm border border-field-chalk/25 rounded-lg px-3 py-2 disabled:opacity-30 text-left"
              >
                {ROLE_NAMES[p.role]} {p.name}
                <span className="text-field-chalk/40 text-xs ml-2">
                  控 {p.control}／威 {p.stuff}／★{p.fav.map((f) => PITCH_TYPE_MAP[f].name).join('、')}
                </span>
                {used && <span className="text-xs text-red-300/70 ml-2">已退場</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <div className="text-sm mb-2 text-field-chalk/70 text-center">球種（★ 擅長）</div>
        <PitchTypeRow selected={typeId} onSelect={setTypeId} favIds={pitcher.fav} />
      </div>

      <div className="mt-5">
        <div className="text-sm mb-2 text-field-chalk/70 text-center">目標落點</div>
        <ZoneGrid selected={zone} onSelect={setZone} />
      </div>

      <div className="mt-5">
        <div className="text-sm mb-2 text-field-chalk/70 text-center">守備佈陣</div>
        <div className="flex gap-2 justify-center flex-wrap">
          {SHIFTS.map((sh) => (
            <button
              key={sh.id}
              onClick={() => setShift(sh.id)}
              title={sh.desc}
              className={`px-3 py-1.5 rounded-full text-sm border ${shift === sh.id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
            >
              {sh.name}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-field-chalk/40 text-center mt-1">
          {SHIFTS.find((sh) => sh.id === shift)?.desc}
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          disabled={!zone}
          onClick={() => confirm(zone)}
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
        >
          投出這一球
        </button>
        <button onClick={() => confirm('waste')} className="text-xs text-field-chalk/50 underline underline-offset-2">
          故意投壞球引誘出棒（順帶防跑，盜壘成功率 -15%）
        </button>
      </div>
    </div>
  );
}

function BatterScreen({ state, dispatch }) {
  const [mode, setMode] = useReducer((s, v) => v, 'lock');
  const [guessType, setGuessType] = useReducer((s, v) => v, 'fastball');
  const [guessZone, setGuessZone] = useReducer((s, v) => v, null);
  const [steal, setSteal] = useReducer((s, v) => v, null);
  const [showBench, setShowBench] = useReducer((s, v) => v, false);

  const bKey = battingKey(state.half);
  const fKey = fieldingKey(state.half);
  const side = state[bKey];
  const fieldingSide = state[fKey];
  const batter = side.lineup[side.lineupIdx % side.lineup.length];
  const oppPitcher = currentPitcher(fieldingSide);
  const shift = state.pendingPitch?.shift || 'normal';

  const runnersOn = !!(state.bases.first || state.bases.second || state.bases.third);
  const canBunt = runnersOn && state.outs < 2;
  const canHitRun = !!state.bases.first;
  const canStealFirst = !!state.bases.first && !state.bases.second;
  const canStealSecond = !!state.bases.second && !state.bases.third;
  const availableBench = side.bench.filter((b) => !b.used);

  const modes = [
    ['lock', '鎖定猜球', true],
    ['protect', '保護打法', true],
    ['take', '看球', true],
    ['bunt', '觸擊短打', canBunt],
    ['hitrun', '打帶跑', canHitRun],
  ];

  const confirm = () => {
    dispatch({
      type: 'CONFIRM_BATTER',
      payload: {
        mode,
        guessTypeId: mode === 'lock' ? guessType : null,
        guessZone: mode === 'lock' ? guessZone : null,
        steal: mode === 'hitrun' ? null : steal,
      },
    });
  };

  const canConfirm = mode !== 'lock' || !!guessZone;

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <div className="text-center mb-4">
        <div className="text-xs text-field-chalk/50">打擊方</div>
        <div className="font-display text-xl font-bold" style={{ color: side.team.color }}>
          {side.team.name}｜第 {(side.lineupIdx % side.lineup.length) + 1} 棒 {batter.name}
        </div>
        <div className="text-[11px] text-field-chalk/40 mt-0.5">
          力量 {batter.power} ・準度 {batter.contact} ・選球眼 {batter.eye} ・速度 {batter.speed}
        </div>
      </div>
      <Scoreboard state={state} />

      {/* 情報區 */}
      <div className="mt-3 text-center text-xs text-field-chalk/55 space-y-0.5">
        <div>
          對方投手：{ROLE_NAMES[oppPitcher.role]} {oppPitcher.name}（擅長：
          {oppPitcher.fav.map((f) => PITCH_TYPE_MAP[f].name).join('、')}
          {oppPitcher.fatigue > 0 && <span className="text-field-floodlight/80">，已顯疲態</span>}）
        </div>
        <div>對方佈陣：<span className="text-field-chalk/80">{SHIFTS.find((sh) => sh.id === shift)?.name}</span></div>
      </div>

      <div className="mt-3 flex justify-center">
        <button
          onClick={() => setShowBench(!showBench)}
          disabled={availableBench.length === 0}
          className="text-xs border border-field-chalk/25 rounded-full px-3 py-1 disabled:opacity-30"
        >
          代打（剩 {availableBench.length} 人）
        </button>
      </div>
      {showBench && (
        <div className="mt-2 flex flex-col gap-1.5 max-w-[320px] mx-auto">
          {side.bench.map((b, i) => (
            <button
              key={b.name}
              disabled={b.used}
              onClick={() => {
                dispatch({ type: 'PINCH_HIT', payload: { benchIdx: i } });
                setShowBench(false);
              }}
              className="text-sm border border-field-chalk/25 rounded-lg px-3 py-2 disabled:opacity-30 text-left"
            >
              {b.name}
              <span className="text-field-chalk/40 text-xs ml-2">
                力 {b.power}／準 {b.contact}／眼 {b.eye}／速 {b.speed}
              </span>
              {b.used && <span className="text-xs text-red-300/70 ml-2">已用</span>}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5">
        <div className="text-sm mb-2 text-field-chalk/70 text-center">打擊策略</div>
        <div className="flex gap-2 justify-center flex-wrap">
          {modes.map(([id, label, enabled]) => (
            <button
              key={id}
              disabled={!enabled}
              onClick={() => setMode(id)}
              className={`px-3 py-1.5 rounded-full text-sm border disabled:opacity-25 ${mode === id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-field-chalk/40 text-center mt-1.5 min-h-[16px]">
          {mode === 'lock' && '同時猜球種＋位置，全中紅中直球高機率長打'}
          {mode === 'protect' && '把球碰進場內求上壘，三振率低但長打少；剋拉打佈陣'}
          {mode === 'take' && '完全不揮棒'}
          {mode === 'bunt' && '犧牲觸擊推進跑者，兩好球後觸成界外＝三振'}
          {mode === 'hitrun' && '一壘跑者提前起跑＋打者必須揮棒；破壞雙殺、安打多推一壘，但揮空跑者幾乎必死'}
        </div>
      </div>

      {mode === 'lock' && (
        <>
          <div className="mt-5">
            <div className="text-sm mb-2 text-field-chalk/70 text-center">鎖定球種</div>
            <PitchTypeRow selected={guessType} onSelect={setGuessType} favIds={oppPitcher.fav} />
          </div>
          <div className="mt-5">
            <div className="text-sm mb-2 text-field-chalk/70 text-center">鎖定位置</div>
            <ZoneGrid selected={guessZone} onSelect={setGuessZone} />
          </div>
        </>
      )}

      {mode !== 'hitrun' && (canStealFirst || canStealSecond) && (
        <div className="mt-5">
          <div className="text-sm mb-2 text-field-chalk/70 text-center">跑者盜壘（打者未把球打進場內時發動）</div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => setSteal(null)}
              className={`px-3 py-1.5 rounded-full text-sm border ${steal === null ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
            >
              不盜壘
            </button>
            {canStealFirst && (
              <button
                onClick={() => setSteal('first')}
                className={`px-3 py-1.5 rounded-full text-sm border ${steal === 'first' ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
              >
                一壘跑者盜二壘（速 {state.baseSpeeds.first}）
              </button>
            )}
            {canStealSecond && (
              <button
                onClick={() => setSteal('second')}
                className={`px-3 py-1.5 rounded-full text-sm border ${steal === 'second' ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
              >
                二壘跑者盜三壘（速 {state.baseSpeeds.second}）
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-center">
        <button
          disabled={!canConfirm}
          onClick={confirm}
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
        >
          {mode === 'take' ? '不揮棒' : mode === 'bunt' ? '擺短棒' : '出棒'}
        </button>
      </div>
    </div>
  );
}

function HandoffScreen({ state, dispatch }) {
  return (
    <div className="max-w-md mx-auto px-6 py-24 text-center">
      <div className="text-5xl mb-6">🔄</div>
      <p className="text-lg leading-relaxed mb-8">{state.handoffMessage}</p>
      <button
        onClick={() => dispatch({ type: 'ACK_HANDOFF' })}
        className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold"
      >
        換我看螢幕，繼續
      </button>
    </div>
  );
}

function ResultScreen({ state, dispatch }) {
  const r = state.lastResult;
  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <Scoreboard state={state} />
      <div className="mt-8 text-center">
        <div className="text-sm text-field-chalk/50 mb-1">
          {r.batterName} ・ 面對{r.pitchTypeName}
          {r.isFav && '（拿手球）'}
          {r.hung && <span className="text-field-floodlight">（失投！）</span>}
          ・落點 {r.zoneLabel}
        </div>
        <div className="font-display text-2xl font-bold">{r.summary}</div>
        {r.extra?.map((e, i) => (
          <div key={i} className="mt-1 text-field-chalk/80">{e}</div>
        ))}
        {r.runs > 0 && <div className="mt-2 text-field-floodlight font-bold">得分 +{r.runs}</div>}
      </div>
      <div className="mt-8 flex justify-center">
        <button
          onClick={() => dispatch({ type: 'NEXT_PITCH' })}
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold"
        >
          下一球
        </button>
      </div>

      <div className="mt-10">
        <div className="text-xs text-field-chalk/40 mb-2">戰報</div>
        <div className="space-y-1 max-h-56 overflow-y-auto text-sm text-field-chalk/70 pr-1">
          {state.log.map((l) => (
            <div key={l.id}>
              <span className="text-field-chalk/30 mr-1">{l.inning}{l.half === 'top' ? '上' : '下'}</span>
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GameOverScreen({ state, dispatch }) {
  const { away, home, winner, endReason } = state;
  return (
    <div className="max-w-md mx-auto px-6 py-20 text-center">
      <div className="font-display text-3xl font-black mb-2">比賽結束</div>
      <div className="text-field-chalk/50 text-sm mb-6">{endReason}</div>
      <div className="flex items-center justify-center gap-6 mb-6">
        <div>
          <div className="font-display font-bold" style={{ color: away.team.color }}>{away.team.short}</div>
          <div className="text-4xl font-mono-tc font-bold">{away.score}</div>
        </div>
        <div className="text-field-chalk/30">－</div>
        <div>
          <div className="font-display font-bold" style={{ color: home.team.color }}>{home.team.short}</div>
          <div className="text-4xl font-mono-tc font-bold">{home.score}</div>
        </div>
      </div>
      <div className="text-lg font-bold mb-8">{winner ? `🏆 ${winner} 獲勝！` : '平手！'}</div>
      <button onClick={() => dispatch({ type: 'RESTART' })} className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold">
        再來一場
      </button>
    </div>
  );
}

export default function Game() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grass-stripes floodlight-glow bg-gradient-to-b from-field-grass2 via-field-grass to-field-night" />
      <div className="relative z-10">
        {state.phase === 'setup' && <SetupScreen onStart={(payload) => dispatch({ type: 'START_GAME', payload })} />}
        {state.phase === 'handoff' && <HandoffScreen state={state} dispatch={dispatch} />}
        {state.phase === 'pitcher' && <PitcherScreen state={state} dispatch={dispatch} />}
        {state.phase === 'batter' && <BatterScreen state={state} dispatch={dispatch} />}
        {state.phase === 'result' && <ResultScreen state={state} dispatch={dispatch} />}
        {state.phase === 'gameover' && <GameOverScreen state={state} dispatch={dispatch} />}
      </div>
    </div>
  );
}
