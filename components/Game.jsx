'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TEAMS, PITCH_TYPES, SHIFTS, ROLE_NAMES, zoneId, zoneLabel } from '../data/teams';
import { PITCH_TYPE_MAP } from '../lib/engine';
import { battingKey, fieldingKey, currentPitcher } from '../lib/gameLogic';

const POLL_MS = 2000;

/* ---------------- API helpers ---------------- */

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || '連線失敗');
  return data;
}

function saveSession(code, token) {
  try {
    localStorage.setItem('bb_session', JSON.stringify({ code, token }));
  } catch {}
}
function loadSession() {
  try {
    return JSON.parse(localStorage.getItem('bb_session'));
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    localStorage.removeItem('bb_session');
  } catch {}
}

/* ---------------- 小元件 ---------------- */

function ZoneGrid({ selected, onSelect }) {
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

function PitchTypeRow({ selected, onSelect, favIds = [] }) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {PITCH_TYPES.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={`px-3 py-1.5 rounded-full text-sm border transition
            ${selected === p.id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25 text-field-chalk/85 hover:border-field-chalk/50'}
          `}
        >
          {favIds.includes(p.id) && <span className="mr-0.5">★</span>}
          {p.name}
        </button>
      ))}
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

function Scoreboard({ g }) {
  const { away, home, inning, innings, half, outs, balls, strikes } = g;
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
        <Diamond bases={g.bases} />
        <div className="text-sm">{balls} 壞 － {strikes} 好</div>
      </div>
    </div>
  );
}

function GameLog({ log }) {
  return (
    <div className="mt-8">
      <div className="text-xs text-field-chalk/40 mb-2">戰報</div>
      <div className="space-y-1 max-h-48 overflow-y-auto text-sm text-field-chalk/70 pr-1">
        {log.map((l) => (
          <div key={l.id}>
            <span className="text-field-chalk/30 mr-1">{l.inning}{l.half === 'top' ? '上' : '下'}</span>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function WaitingCard({ title, sub }) {
  return (
    <div className="text-center py-10">
      <div className="inline-block w-8 h-8 border-2 border-field-chalk/20 border-t-field-floodlight rounded-full animate-spin mb-4" />
      <div className="text-lg font-bold">{title}</div>
      {sub && <div className="text-sm text-field-chalk/50 mt-1">{sub}</div>}
    </div>
  );
}

/* ---------------- 大廳 ---------------- */

function Lobby({ onEnter, error }) {
  const [tab, setTab] = useState('create');
  const [teamId, setTeamId] = useState(TEAMS[0].id);
  const [innings, setInnings] = useState(3);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error || '');

  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const data = await api('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ innings, teamId }),
      });
      saveSession(data.code, data.token);
      onEnter(data.code, data.token, data.view);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const join = async () => {
    setBusy(true);
    setErr('');
    try {
      const data = await api('/api/room/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: joinCode.trim(), teamId }),
      });
      saveSession(data.code, data.token);
      onEnter(data.code, data.token, data.view);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="max-w-xl mx-auto px-5 py-10">
      <h1 className="font-display text-3xl font-black tracking-wide text-center mb-1">中職夜戰</h1>
      <p className="text-center text-field-chalk/60 text-sm mb-8">線上雙人・逐球猜球心理戰</p>

      <div className="flex gap-2 mb-6">
        {[['create', '建立房間'], ['join', '加入房間']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2 rounded-lg border font-bold ${tab === id ? 'bg-field-floodlight text-field-night border-field-floodlight' : 'border-field-chalk/25'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'join' && (
        <div className="mb-6">
          <div className="text-sm mb-2 text-field-chalk/70">房號（向對方要 4 位數字）</div>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder="0000"
            className="w-full text-center text-3xl font-mono-tc tracking-[0.5em] bg-black/30 border border-field-chalk/25 rounded-lg py-3 outline-none focus:border-field-floodlight"
          />
        </div>
      )}

      {tab === 'create' && (
        <div className="mb-6">
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
      )}

      <div className="mb-6">
        <div className="text-sm mb-2 text-field-chalk/70">
          選擇你的球隊{tab === 'create' ? '（房主先攻）' : '（加入者後攻）'}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {TEAMS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTeamId(t.id)}
              className={`py-2 px-2 rounded-lg border text-sm ${teamId === t.id ? 'border-field-floodlight bg-field-floodlight/10 font-bold' : 'border-field-chalk/25'}`}
              style={{ color: teamId === t.id ? t.color : undefined }}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="mb-4 text-center text-red-300 text-sm">{err}</div>}

      <button
        onClick={tab === 'create' ? create : join}
        disabled={busy || (tab === 'join' && joinCode.length !== 4)}
        className="w-full py-3 rounded-lg bg-field-floodlight text-field-night font-bold text-lg disabled:opacity-40"
      >
        {busy ? '連線中…' : tab === 'create' ? '建立房間' : '加入對戰'}
      </button>

      <p className="text-xs text-field-chalk/40 leading-relaxed mt-6">
        雙方各自用自己的手機或電腦進入。每隊 3 名投手（最多換投 2 次）＋2 名板凳代打。★ 為投手擅長球路。球員數值為參考值，非官方精確數據。
      </p>
    </div>
  );
}

/* ---------------- 投手回合 ---------------- */

function PitcherScreen({ view, send, busy }) {
  const g = view.game;
  const [typeId, setTypeId] = useState('fastball');
  const [zone, setZone] = useState(null);
  const [shift, setShift] = useState('normal');
  const [showBullpen, setShowBullpen] = useState(false);

  const fKey = fieldingKey(g.half);
  const side = g[fKey];
  const pitcher = currentPitcher(side);

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <div className="text-center mb-4">
        <div className="text-xs text-field-chalk/50">你是守備方・輪到你配球</div>
        <div className="font-display text-xl font-bold" style={{ color: side.team.color }}>
          {side.team.name}｜{ROLE_NAMES[pitcher.role]} {pitcher.name}
        </div>
        <div className="text-[11px] text-field-chalk/40 mt-0.5">
          控球 {pitcher.effControl} ・球威 {pitcher.effStuff}
          {pitcher.fatigue > 0 && <span className="text-red-300/80">（疲勞 -{pitcher.fatigue}）</span>}
          ・已投 {pitcher.pitchCount} 球
        </div>
      </div>
      <Scoreboard g={g} />

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
          {side.team.pitchers.map((p, i) => {
            if (i === side.staff.currentIdx) return null;
            const used = side.staff.used.includes(i);
            return (
              <button
                key={p.name}
                disabled={used || busy}
                onClick={() => {
                  send('change_pitcher', { idx: i });
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
        <div className="text-sm mb-2 text-field-chalk/70 text-center">守備佈陣（打者看得到）</div>
        <div className="flex gap-2 justify-center flex-wrap">
          {SHIFTS.map((sh) => (
            <button
              key={sh.id}
              onClick={() => setShift(sh.id)}
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
          disabled={!zone || busy}
          onClick={() => send('pitcher_submit', { typeId, zoneTarget: zone, shift })}
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
        >
          投出這一球
        </button>
        <button
          disabled={busy}
          onClick={() => send('pitcher_submit', { typeId, zoneTarget: 'waste', shift })}
          className="text-xs text-field-chalk/50 underline underline-offset-2"
        >
          故意投壞球引誘出棒（順帶防跑，盜壘成功率 -15%）
        </button>
      </div>

      <GameLog log={g.log} />
    </div>
  );
}

/* ---------------- 打者回合 ---------------- */

function BatterScreen({ view, send, busy }) {
  const g = view.game;
  const [mode, setMode] = useState('lock');
  const [guessType, setGuessType] = useState('fastball');
  const [guessZone, setGuessZone] = useState(null);
  const [steal, setSteal] = useState(null);
  const [showBench, setShowBench] = useState(false);

  const bKey = battingKey(g.half);
  const fKey = fieldingKey(g.half);
  const side = g[bKey];
  const fieldingSide = g[fKey];
  const batter = side.lineup[side.lineupIdx % side.lineup.length];
  const oppPitcher = currentPitcher(fieldingSide);
  const shift = g.pendingPitch?.shift || 'normal';

  const runnersOn = !!(g.bases.first || g.bases.second || g.bases.third);
  const canBunt = runnersOn && g.outs < 2;
  const canHitRun = !!g.bases.first;
  const canStealFirst = !!g.bases.first && !g.bases.second;
  const canStealSecond = !!g.bases.second && !g.bases.third;
  const availableBench = side.bench.filter((b) => !b.used);

  const modes = [
    ['lock', '鎖定猜球', true],
    ['protect', '保護打法', true],
    ['take', '看球', true],
    ['bunt', '觸擊短打', canBunt],
    ['hitrun', '打帶跑', canHitRun],
  ];

  const canConfirm = mode !== 'lock' || !!guessZone;

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <div className="text-center mb-4">
        <div className="text-xs text-field-chalk/50">你是進攻方・對方已投出，換你反應</div>
        <div className="font-display text-xl font-bold" style={{ color: side.team.color }}>
          {side.team.name}｜第 {(side.lineupIdx % side.lineup.length) + 1} 棒 {batter.name}
        </div>
        <div className="text-[11px] text-field-chalk/40 mt-0.5">
          力量 {batter.power} ・準度 {batter.contact} ・選球眼 {batter.eye} ・速度 {batter.speed}
        </div>
      </div>
      <Scoreboard g={g} />

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
              disabled={b.used || busy}
              onClick={() => {
                send('pinch_hit', { benchIdx: i });
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
          {mode === 'hitrun' && '一壘跑者提前起跑＋打者必須揮棒；破壞雙殺，但揮空跑者幾乎必死'}
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
          <div className="text-sm mb-2 text-field-chalk/70 text-center">跑者盜壘（球沒被打進場內時發動）</div>
          <div className="flex gap-2 justify-center flex-wrap">
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
                一壘跑者盜二壘（速 {g.baseSpeeds.first}）
              </button>
            )}
            {canStealSecond && (
              <button
                onClick={() => setSteal('second')}
                className={`px-3 py-1.5 rounded-full text-sm border ${steal === 'second' ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
              >
                二壘跑者盜三壘（速 {g.baseSpeeds.second}）
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-center">
        <button
          disabled={!canConfirm || busy}
          onClick={() =>
            send('batter_submit', {
              mode,
              guessTypeId: mode === 'lock' ? guessType : null,
              guessZone: mode === 'lock' ? guessZone : null,
              steal: mode === 'hitrun' ? null : steal,
            })
          }
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
        >
          {mode === 'take' ? '不揮棒' : mode === 'bunt' ? '擺短棒' : '出棒'}
        </button>
      </div>

      <GameLog log={g.log} />
    </div>
  );
}

/* ---------------- 結果 / 等待 / 結束 ---------------- */

function ResultScreen({ view, send, busy }) {
  const g = view.game;
  const r = g.lastResult;
  const iAmReady = g.ready[view.role];
  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <Scoreboard g={g} />
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
        {r.batterChoice?.mode === 'lock' && (
          <div className="mt-3 text-xs text-field-chalk/45">
            打者鎖定：{PITCH_TYPE_MAP[r.batterChoice.guessTypeId]?.name}・
            {r.batterChoice.guessZone
              ? zoneLabel(...r.batterChoice.guessZone.split('-').map(Number))
              : ''}
          </div>
        )}
      </div>
      <div className="mt-8 flex justify-center">
        {iAmReady ? (
          <WaitingCard title="等待對方按繼續…" />
        ) : (
          <button
            disabled={busy}
            onClick={() => send('ready_next')}
            className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
          >
            下一球
          </button>
        )}
      </div>
      <GameLog log={g.log} />
    </div>
  );
}

function GameOverScreen({ view, onLeave }) {
  const g = view.game;
  return (
    <div className="max-w-md mx-auto px-6 py-20 text-center">
      <div className="font-display text-3xl font-black mb-2">比賽結束</div>
      <div className="text-field-chalk/50 text-sm mb-6">{g.endReason}</div>
      <div className="flex items-center justify-center gap-6 mb-6">
        <div>
          <div className="font-display font-bold" style={{ color: g.away.team.color }}>{g.away.team.short}</div>
          <div className="text-4xl font-mono-tc font-bold">{g.away.score}</div>
        </div>
        <div className="text-field-chalk/30">－</div>
        <div>
          <div className="font-display font-bold" style={{ color: g.home.team.color }}>{g.home.team.short}</div>
          <div className="text-4xl font-mono-tc font-bold">{g.home.score}</div>
        </div>
      </div>
      <div className="text-lg font-bold mb-8">{g.winner ? `🏆 ${g.winner} 獲勝！` : '平手！'}</div>
      <button onClick={onLeave} className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold">
        回到大廳
      </button>
    </div>
  );
}

/* ---------------- 主元件 ---------------- */

export default function Game() {
  const [session, setSession] = useState(null); // {code, token}
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pollRef = useRef(null);

  const refresh = useCallback(async (code, token) => {
    try {
      const data = await api(`/api/room/state?code=${code}&token=${token}`);
      setView(data.view);
      setErr('');
    } catch (e) {
      if (e.message.includes('不存在') || e.message.includes('過期')) {
        clearSession();
        setSession(null);
        setView(null);
        setErr('房間已過期，請重新建立');
      }
    }
  }, []);

  // 開頁時嘗試恢復先前的對戰
  useEffect(() => {
    const s = loadSession();
    if (s?.code && s?.token) {
      setSession(s);
      refresh(s.code, s.token);
    }
  }, [refresh]);

  // 輪詢
  useEffect(() => {
    if (!session) return;
    pollRef.current = setInterval(() => refresh(session.code, session.token), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [session, refresh]);

  const send = async (action, payload) => {
    setBusy(true);
    try {
      const data = await api('/api/room/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: session.code, token: session.token, action, payload }),
      });
      setView(data.view);
    } catch (e) {
      // 動作衝突（例如已被處理）時直接刷新
      refresh(session.code, session.token);
    }
    setBusy(false);
  };

  const leave = () => {
    clearSession();
    setSession(null);
    setView(null);
  };

  let screen = null;
  if (!session || !view) {
    screen = <Lobby error={err} onEnter={(code, token, v) => { setSession({ code, token }); setView(v); }} />;
  } else if (view.status === 'waiting') {
    screen = (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="text-sm text-field-chalk/50 mb-2">把房號告訴對方，請他選「加入房間」</div>
        <div className="text-6xl font-mono-tc font-bold tracking-[0.3em] text-field-floodlight mb-6">{view.code}</div>
        <WaitingCard title="等待對手加入…" sub="對方加入後比賽自動開始" />
        <button onClick={leave} className="mt-6 text-xs text-field-chalk/50 underline underline-offset-2">
          取消並回到大廳
        </button>
      </div>
    );
  } else if (view.game) {
    const g = view.game;
    const myTurnPitcher = g.phase === 'pitcher' && view.role === fieldingKey(g.half);
    const myTurnBatter = g.phase === 'batter' && view.role === battingKey(g.half);

    if (g.phase === 'gameover') {
      screen = <GameOverScreen view={view} onLeave={leave} />;
    } else if (g.phase === 'result') {
      screen = <ResultScreen view={view} send={send} busy={busy} />;
    } else if (myTurnPitcher) {
      screen = <PitcherScreen key={`p-${g.log.length}`} view={view} send={send} busy={busy} />;
    } else if (myTurnBatter) {
      screen = <BatterScreen key={`b-${g.log.length}`} view={view} send={send} busy={busy} />;
    } else {
      const waitWhat = g.phase === 'pitcher' ? '對方投手正在配球…' : '對方打者正在反應…';
      screen = (
        <div className="max-w-xl mx-auto px-5 py-8">
          <Scoreboard g={g} />
          <WaitingCard title={waitWhat} sub="猜猜他會怎麼出招" />
          <GameLog log={g.log} />
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grass-stripes floodlight-glow bg-gradient-to-b from-field-grass2 via-field-grass to-field-night" />
      <div className="relative z-10">{screen}</div>
    </div>
  );
}
