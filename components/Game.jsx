'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TEAMS, PITCH_TYPES, SHIFTS, ROLE_NAMES, zoneId, zoneLabel, batsLabel, throwsLabel } from '../data/teams';
import { PITCH_TYPE_MAP, gradeOf, GRADE_PARAMS, FIELD, clampCanvas, zoneLabelFromXY, SWEET_RADIUS, CONTACT_RADIUS, POWER_SWEET_RADIUS, POWER_CONTACT_RADIUS, flightPointAt, swingWindowsOf } from '../lib/engine';
import { battingKey, fieldingKey, currentPitcher, staminaOf } from '../lib/gameLogic';

const POLL_MS = 2000;

/* ---------------- API helpers ---------------- */

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || '連線失敗');
  return data;
}

// token 只放 sessionStorage：分頁關閉即失效，降低 XSS 竊 token 後可長期冒充的風險
function saveSession(code, token) {
  try {
    sessionStorage.setItem('bb_session', JSON.stringify({ code, token }));
  } catch {}
}
function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem('bb_session'));
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    sessionStorage.removeItem('bb_session');
    // 順便清掉舊版可能殘留的 localStorage
    localStorage.removeItem('bb_session');
  } catch {}
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

/* ---------------- 小元件 ---------------- */

const GRADE_STYLE = {
  S: 'bg-gradient-to-br from-amber-300 to-yellow-500 text-black',
  A: 'bg-gradient-to-br from-red-400 to-rose-500 text-white',
  B: 'bg-gradient-to-br from-sky-400 to-blue-500 text-white',
  C: 'bg-gradient-to-br from-zinc-400 to-zinc-500 text-black',
};

function GradeBadge({ grade }) {
  return (
    <span className={`inline-flex items-center justify-center w-4.5 h-4.5 min-w-[18px] min-h-[18px] rounded text-[11px] font-black align-middle ${GRADE_STYLE[grade] || GRADE_STYLE.C}`}>
      {grade}
    </span>
  );
}

// 球種列：顯示 S/A/B/C 等級（疲勞會讓等級掉階，C 級陌生球種被打擊率提升）
function PitchTypeRow({ selected, onSelect, pitcher }) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {PITCH_TYPES.map((p) => {
        const grade = gradeOf(pitcher, p.id);
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5 ${
              selected === p.id
                ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold'
                : 'border-field-chalk/25 text-field-chalk/85'
            }`}
          >
            <GradeBadge grade={grade} />
            <span>{p.name}</span>
            <span className={`text-[10px] ${selected === p.id ? 'text-field-night/60' : 'text-field-chalk/40'}`}>{p.tag}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- 投手拖曳配球盤（連續座標） ----------------
 * 好球帶佔中央 40%（FIELD.zoneMin~zoneMax），可拖曳到更外側代表刻意瞄超遠、
 * 甚至讓變化球從外面飄進來或往外飄出去。故意壞球是獨立勾選的意圖旗標
 * （用於防盜壘判定），跟座標是否真的落在帶外是分開兩件事。
 * 球體依球種顯示位移球影：直球＝乾淨一顆球；縱向系（曲/叉/變速）＝向下墜落影；滑球＝向外橫移影。
 */
const CANVAS_SPAN = FIELD.canvasMax - FIELD.canvasMin;
const toBoardPct = (v) => ((v - FIELD.canvasMin) / CANVAS_SPAN) * 100;
const ZONE_START_PCT = toBoardPct(FIELD.zoneMin);
const ZONE_END_PCT = toBoardPct(FIELD.zoneMax);

function PitchTargetBoard({ typeId, target, onTarget, waste, onWasteChange }) {
  const boardRef = useRef(null);
  const pitchType = PITCH_TYPE_MAP[typeId];

  const posFromPoint = (clientX, clientY) => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    return {
      x: clampCanvas(FIELD.canvasMin + px * CANVAS_SPAN),
      y: clampCanvas(FIELD.canvasMin + py * CANVAS_SPAN),
    };
  };

  const handlePointer = (e) => {
    const pos = posFromPoint(e.clientX, e.clientY);
    if (pos) onTarget(pos);
  };

  const ballPos = target ? { x: toBoardPct(target.x), y: toBoardPct(target.y) } : null;
  const inZoneNow = !!target && target.x >= FIELD.zoneMin && target.x <= FIELD.zoneMax && target.y >= FIELD.zoneMin && target.y <= FIELD.zoneMax;

  const shadowStyle = pitchType.breakDir === 'low'
    ? { transform: 'translate(-50%, 30%)' }
    : pitchType.breakDir === 'outer'
      ? { transform: 'translate(10%, -50%)' }
      : null;

  return (
    <div>
      <div
        ref={boardRef}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); handlePointer(e); }}
        onPointerMove={(e) => { if (e.buttons > 0) handlePointer(e); }}
        className="relative w-full max-w-[300px] aspect-square mx-auto rounded-xl bg-black/50 border border-field-chalk/25 overflow-hidden touch-none select-none cursor-crosshair"
      >
        {/* 壞球區：好球帶外的整個延伸範圍，可拖到任意位置甚至畫面邊緣 */}
        <div className={`absolute inset-0 ${target && !inZoneNow ? 'bg-red-900/35' : 'bg-red-950/20'}`} />
        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] text-red-300/60">壞球區（可拖到帶外任意位置，甚至更遠）</div>
        {/* 好球帶 3×3（純視覺參考，整塊看板都是連續可拖曳範圍） */}
        <div
          className="absolute rounded-lg overflow-hidden border-2 border-field-chalk/40"
          style={{ left: `${ZONE_START_PCT}%`, top: `${ZONE_START_PCT}%`, right: `${100 - ZONE_END_PCT}%`, bottom: `${100 - ZONE_END_PCT}%` }}
        >
          <div className="grid grid-cols-3 grid-rows-3 w-full h-full">
            {[0, 1, 2].map((r) =>
              [0, 1, 2].map((c) => {
                const isHeart = r === 1 && c === 1;
                return (
                  <div
                    key={`${r}-${c}`}
                    className={`border border-field-chalk/15 flex items-center justify-center text-[9px] ${
                      isHeart ? 'bg-field-grass2/60 text-field-floodlight/50' : 'bg-field-grass2/40 text-field-chalk/35'
                    }`}
                  >
                    {zoneLabel(r, c)}
                  </div>
                );
              })
            )}
          </div>
        </div>
        {/* 球體＋球影：跟著連續座標即時移動 */}
        {ballPos && (
          <div className="absolute pointer-events-none" style={{ left: `${ballPos.x}%`, top: `${ballPos.y}%` }}>
            {pitchType.breakDir && (
              <div
                className="absolute w-6 h-6 rounded-full bg-white/15 border border-white/20 -translate-x-1/2 -translate-y-1/2"
                style={shadowStyle}
              />
            )}
            <div className="absolute w-6 h-6 rounded-full bg-white -translate-x-1/2 -translate-y-1/2 shadow-[0_0_12px_rgba(255,255,255,0.7)]">
              {/* 縫線 */}
              <div className="absolute inset-0 rounded-full border-[2.5px] border-transparent border-l-red-500 border-r-red-500 rotate-12" />
            </div>
          </div>
        )}
        {!target && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-xs text-field-chalk/50 bg-black/40 rounded-full px-3 py-1">拖曳或點擊放置球的位置</span>
          </div>
        )}
      </div>
      <label className="mt-2 flex items-center justify-center gap-2 text-xs text-field-chalk/60 select-none cursor-pointer">
        <input type="checkbox" checked={!!waste} onChange={(e) => onWasteChange(e.target.checked)} className="accent-field-floodlight" />
        故意壞球（防盜壘意圖旗標，跟實際落點分開判定）
      </label>
    </div>
  );
}

// 體力條：10 格電量式視覺，顏色隨體力由綠→黃→紅，低於 25% 閃爍警示
function StaminaBar({ pct, width = 'w-28', pitchCount = null }) {
  const zone = pct > 60 ? 'good' : pct > 25 ? 'warn' : 'bad';
  const fill = {
    good: 'bg-gradient-to-r from-emerald-500 to-emerald-300',
    warn: 'bg-gradient-to-r from-amber-500 to-yellow-300',
    bad: 'bg-gradient-to-r from-red-600 to-red-400',
  }[zone];
  const textColor = { good: 'text-emerald-300', warn: 'text-yellow-300', bad: 'text-red-300' }[zone];
  return (
    <div className="inline-flex items-center gap-1.5 align-middle">
      <span className="text-[10px] text-field-chalk/50">體力</span>
      <div className={`relative ${width} h-3.5 rounded-md bg-black/60 border border-field-chalk/25 overflow-hidden`}>
        {/* 電量填充 */}
        <div
          className={`h-full ${fill} transition-all duration-700 ease-out ${zone === 'bad' ? 'animate-pulse' : ''}`}
          style={{ width: `${pct}%` }}
        />
        {/* 10 格刻度線 */}
        <div className="absolute inset-0 flex pointer-events-none">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex-1 border-r border-black/45" />
          ))}
          <div className="flex-1" />
        </div>
        {/* 高光 */}
        <div className="absolute inset-x-0 top-0 h-[40%] bg-white/10 pointer-events-none" />
      </div>
      <span className={`text-[10px] font-mono-tc font-bold ${textColor}`}>{pct}%</span>
      {pitchCount != null && <span className="text-[10px] text-field-chalk/40 font-mono-tc">{pitchCount} 球</span>}
    </div>
  );
}

function Countdown({ deadline, serverNow }) {
  const [now, setNow] = useState(() => Date.now());
  const offsetRef = useRef(0);
  const totalRef = useRef({ deadline: null, total: 35 });
  useEffect(() => {
    // 用伺服器時間校正本機時鐘差
    offsetRef.current = (serverNow || Date.now()) - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  const remain = Math.max(0, Math.ceil((deadline - (now + offsetRef.current)) / 1000));
  // 每換一個 deadline 記下起始秒數，進度條比例才不會寫死（配球 35s／結果 60s 都正確）
  if (totalRef.current.deadline !== deadline) {
    totalRef.current = { deadline, total: Math.max(remain, 1) };
  }
  const total = totalRef.current.total;
  const warning = remain <= 10 && remain > 5;
  const urgent = remain <= 5;
  const boxCls = urgent
    ? 'border-red-400/70 bg-red-500/15 text-red-200 animate-pulse'
    : warning
      ? 'border-yellow-300/60 bg-yellow-500/10 text-yellow-200'
      : 'border-field-floodlight/30 bg-black/25 text-field-floodlight';
  const barCls = urgent ? 'bg-red-300' : warning ? 'bg-yellow-300' : 'bg-field-floodlight';
  return (
    <div className={`mt-2 mx-auto max-w-[220px] rounded-lg border px-3 py-2 text-center font-mono-tc font-bold transition ${boxCls}`}>
      <div className="text-[10px] tracking-[0.18em] text-field-chalk/45">COUNTDOWN</div>
      <div className="text-2xl leading-none mt-0.5">{remain}</div>
      <div className={`mt-1 h-1.5 rounded-full bg-black/40 overflow-hidden ${urgent ? 'ring-1 ring-red-300/40' : ''}`}>
        <div
          className={`h-full transition-all duration-300 ${barCls}`}
          style={{ width: `${Math.max(0, Math.min(100, (remain / total) * 100))}%` }}
        />
      </div>
    </div>
  );
}

// 洋將小標籤（純情報顯示，不影響操作）
function ForeignTag({ show }) {
  if (!show) return null;
  return <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-field-floodlight/20 text-field-floodlight align-middle">洋</span>;
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
          <div>
            {inning > innings ? `延長 第 ${inning} 局` : `第 ${inning} / ${innings} 局`} {half === 'top' ? '上' : '下'}
          </div>
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
      {g.notice && (
        <div className="mt-2 text-center text-xs bg-field-floodlight/15 border border-field-floodlight/40 rounded-md py-1.5 px-2 text-field-floodlight font-bold">
          {g.notice.text}
        </div>
      )}
    </div>
  );
}

function GameLog({ log }) {
  const toneFor = (text) => {
    if (/全壘打|再見|得 \d+ 分|擠回|突破僵局/.test(text)) return 'text-field-floodlight font-bold';
    if (/三振|雙殺|觸殺|超時|失敗/.test(text)) return 'text-red-200/90';
    if (/挑戰|電視輔助|改判/.test(text)) return 'text-sky-200/90';
    if (/安打|長打|二壘安打|三壘安打|盜.*成功/.test(text)) return 'text-emerald-200/90';
    return 'text-field-chalk/70';
  };
  return (
    <div className="mt-8">
      <div className="text-xs text-field-chalk/40 mb-2">戰報</div>
      <div className="space-y-1 max-h-48 overflow-y-auto text-sm text-field-chalk/70 pr-1">
        {log.map((l) => (
          <div key={l.id} className={toneFor(l.text)}>
            <span className="text-field-chalk/30 mr-1">{l.inning}{l.half === 'top' ? '上' : '下'}</span>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 打者即時反應（真實揮棒版） ----------------
 * 「按住畫面」＝持棒瞄準：球棒圖示跟著手指/滑鼠移動，甜蜜點（棒身上
 * 的球標）就是要對準來球的位置。「放開的一瞬間」＝揮棒——由放開時機
 * （vs 球到位時刻，時機窗依球速決定：直球窄、變化球寬）、放開當下甜
 * 蜜點與球的距離、以及球種，共同決定擊球結果。
 * 球沿伺服器算好的真實軌跡飛行：直球直線一閃而逝；滑球前段像直球、
 * 中段向外橫移；曲球出手就是大弧線；指叉/變速前段完全像直球，末段
 * 才突然下墜。本地顯示的判定僅供即時回饋，正式結果以伺服器為準。
 */
function BatCursor({ leftPct, topPct }) {
  return (
    <div className="absolute pointer-events-none z-10" style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
      <svg width="120" height="120" viewBox="0 0 120 120" className="absolute drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" style={{ left: '-26px', top: '-26px' }}>
        <g transform="rotate(38 26 26)">
          {/* 棒身：棒頭在甜蜜點側，往右下收成握把 */}
          <path
            d="M8 17.5 Q1.5 26 8 34.5 L58 31.5 L99 29 Q103.5 26 99 23 L58 20.5 Z"
            fill="#3ec6cf"
            stroke="#0e7c86"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* 握把尾 */}
          <circle cx="102.5" cy="26" r="5.5" fill="#3ec6cf" stroke="#0e7c86" strokeWidth="2" />
          {/* 甜蜜點球標：對準這裡打 */}
          <circle cx="26" cy="26" r="7" fill="#fff" stroke="#d63b3b" strokeWidth="1.5" />
          <path d="M21.5 21.5 Q26 26 21.5 30.5 M30.5 21.5 Q26 26 30.5 30.5" stroke="#d63b3b" strokeWidth="1.3" fill="none" />
        </g>
      </svg>
    </div>
  );
}

function BatAimGame({ path, mode = 'normal', onDone }) {
  const powerMode = mode === 'power';
  const [stage, setStage] = useState('windup'); // windup | flying | done
  const [ballPos, setBallPos] = useState(null); // {x,y} 連續座標（伺服器尺度）
  const [batPos, setBatPos] = useState({ x: 50, y: 62 });
  const [held, setHeld] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const boardRef = useRef(null);
  const doneRef = useRef(false);
  const batPosRef = useRef({ x: 50, y: 62 });
  const trailRef = useRef([]); // 殘影：最近幾個球位置
  const rafRef = useRef(null);
  const graceRef = useRef(null);
  const arrivalRef = useRef(null); // 球「到位」的 performance.now 時刻
  const stageRef = useRef('windup');

  const sweetR = powerMode ? POWER_SWEET_RADIUS : SWEET_RADIUS;
  const contactR = powerMode ? POWER_CONTACT_RADIUS : CONTACT_RADIUS;
  const windows = swingWindowsOf(path.durationMs, mode);
  const LATE_GRACE_MS = 250; // 球進手套後仍可補揮的緩衝（會被算成「太晚」）

  const finish = (swing) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (graceRef.current) clearTimeout(graceRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stageRef.current = 'done';
    setStage('done');

    if (!swing) {
      setVerdict({ label: '沒出棒……', tone: 'text-field-chalk/70' });
      setTimeout(() => onDone({ batX: null, batY: null, swingDelta: null }), 500);
      return;
    }
    const ad = Math.abs(swing.delta);
    const dist = Math.hypot(swing.x - path.endX, swing.y - path.endY);
    let v;
    if (ad > windows.contact) {
      v = swing.delta < 0 ? { label: '太早出棒——揮空！', tone: 'text-red-300' } : { label: '太晚出棒——揮空！', tone: 'text-red-300' };
    } else if (dist > contactR) {
      v = { label: '位置沒對上——揮空！', tone: 'text-red-300' };
    } else if (dist <= sweetR && ad <= windows.perfect) {
      v = { label: '完美咬中！', tone: 'text-field-floodlight' };
    } else {
      v = { label: '有碰到！', tone: 'text-emerald-300' };
    }
    setVerdict(v);
    setTimeout(() => onDone({ batX: swing.x, batY: swing.y, swingDelta: swing.delta }), 650);
  };

  useEffect(() => {
    const windupMs = 600 + Math.random() * 700;
    const windupTimer = setTimeout(() => {
      stageRef.current = 'flying';
      setStage('flying');
      const flyStart = performance.now();
      arrivalRef.current = flyStart + path.durationMs;
      const loop = (now) => {
        if (doneRef.current) return;
        const t = Math.min(1, (now - flyStart) / path.durationMs);
        const p = flightPointAt(path, t);
        trailRef.current = [...trailRef.current.slice(-3), p];
        setBallPos(p);
        if (t >= 1) {
          // 球進手套：短暫緩衝內放開仍算（太晚的）揮棒，否則視為沒出棒
          graceRef.current = setTimeout(() => finish(null), LATE_GRACE_MS);
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }, windupMs);
    return () => {
      clearTimeout(windupTimer);
      if (graceRef.current) clearTimeout(graceRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const posFromPoint = (clientX, clientY) => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    return {
      x: clampCanvas(FIELD.canvasMin + px * CANVAS_SPAN),
      y: clampCanvas(FIELD.canvasMin + py * CANVAS_SPAN),
    };
  };

  const updateBat = (e) => {
    const pos = posFromPoint(e.clientX, e.clientY);
    if (pos) {
      batPosRef.current = pos;
      setBatPos(pos);
    }
  };

  const onDown = (e) => {
    if (doneRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setHeld(true);
    updateBat(e);
  };
  const onMove = (e) => {
    if (doneRef.current || e.buttons === 0) return;
    updateBat(e);
  };
  const onUp = (e) => {
    if (doneRef.current) return;
    updateBat(e);
    setHeld(false);
    // 放開＝揮棒：只有球出手後的放開才算（醞釀期放開＝重新持棒即可）
    if (stageRef.current === 'flying' && arrivalRef.current != null) {
      const delta = Math.round(performance.now() - arrivalRef.current);
      finish({ ...batPosRef.current, delta });
    }
  };

  const ballPct = ballPos ? { x: toBoardPct(ballPos.x), y: toBoardPct(ballPos.y) } : null;
  const batPct = { x: toBoardPct(batPos.x), y: toBoardPct(batPos.y) };
  const contactPct = (contactR / CANVAS_SPAN) * 100;
  const trail = trailRef.current.slice(0, -1);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center px-5 select-none touch-none">
      <div className="text-field-chalk/85 text-sm font-bold mb-1">
        {stage === 'windup' ? '投手抬腿——按住畫面持棒！' : stage === 'flying' ? '放開的一瞬間＝揮棒！' : ''}
      </div>
      <div className="text-[11px] text-field-chalk/45 mb-4 text-center max-w-[300px]">
        {mode === 'bunt'
          ? '把棒身上的球標貼到來球，輕輕放開＝出棒觸擊'
          : powerMode
            ? '⚡ 強力打擊：時機窗與甜蜜點都更小——但咬中就是大的'
            : '球標對準來球、時機到就放開。直球一閃而逝；變化球會轉彎，盯到最後再出手'}
      </div>

      <div
        ref={boardRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative w-full max-w-[320px] aspect-square rounded-xl bg-black/60 border-2 border-field-chalk/25 overflow-hidden touch-none cursor-crosshair"
      >
        {/* 好球帶參考框 */}
        <div
          className="absolute rounded-lg border border-field-chalk/20 pointer-events-none"
          style={{ left: `${ZONE_START_PCT}%`, top: `${ZONE_START_PCT}%`, right: `${100 - ZONE_END_PCT}%`, bottom: `${100 - ZONE_END_PCT}%` }}
        />

        {/* 有效接觸範圍參考環（以甜蜜點為圓心，直接畫在看板上） */}
        <div
          className={`absolute rounded-full border -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity ${held ? 'border-field-floodlight/35 opacity-100' : 'border-white/15 opacity-60'}`}
          style={{ left: `${batPct.x}%`, top: `${batPct.y}%`, width: `${contactPct * 2}%`, height: `${contactPct * 2}%` }}
        />

        {/* 球棒游標：甜蜜點＝棒身上的球標 */}
        <BatCursor leftPct={batPct.x} topPct={batPct.y} />

        {/* 球的殘影（讀軌跡用，不預告未來） */}
        {stage !== 'windup' && trail.map((p, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/20 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${toBoardPct(p.x)}%`, top: `${toBoardPct(p.y)}%`, width: `${8 + i * 3}px`, height: `${8 + i * 3}px` }}
          />
        ))}

        {/* 球體：沿真實軌跡飛行 */}
        {ballPct && stage !== 'windup' && (
          <div
            className="absolute w-6 h-6 rounded-full bg-white -translate-x-1/2 -translate-y-1/2 shadow-[0_0_14px_rgba(255,255,255,0.85)] pointer-events-none"
            style={{ left: `${ballPct.x}%`, top: `${ballPct.y}%` }}
          >
            <div className="absolute inset-0 rounded-full border-[2.5px] border-transparent border-l-red-500 border-r-red-500 rotate-12" />
          </div>
        )}

        {stage === 'windup' && !held && (
          <div className="absolute inset-x-0 bottom-3 text-center pointer-events-none">
            <span className="text-xs text-field-floodlight bg-black/50 rounded-full px-3 py-1 animate-pulse">👆 按住畫面持棒</span>
          </div>
        )}
      </div>

      {verdict && (
        <div className={`mt-5 font-display text-3xl font-bold ${verdict.tone} animate-pulse`}>{verdict.label}</div>
      )}
    </div>
  );
}

/* ---------------- 揮棒時機小遊戲 ----------------
 * 打者確認出棒後彈出：光標在時機條上來回擺動（對方投手球威越高越快），
 * 在中央甜蜜點按下「揮棒」拿高分。分數 0~100 送回伺服器放大/縮小打擊結果權重。
 * 3.2 秒內沒出手＝完全沒跟上（低分自動送出）。
 */
function SwingTimingGame({ stuff = 50, actionLabel = '揮棒！', onDone }) {
  const [pos, setPos] = useState(50);
  const [result, setResult] = useState(null); // { score, label, tone }
  const doneRef = useRef(false);
  const posRef = useRef(50);
  // 擺動週期：球威 50 → 900ms／趟；球威 90 → 660ms；封頂 480~1100ms
  const periodRef = useRef(Math.max(480, Math.min(1100, 900 - (stuff - 50) * 6)));
  // 隨機起始相位，避免背節奏
  const startRef = useRef(performance.now() - Math.random() * periodRef.current * 2);

  const finish = useCallback((score, p) => {
    if (doneRef.current) return;
    doneRef.current = true;
    let label, tone;
    if (score >= 90) { label = '完美！'; tone = 'text-field-floodlight'; }
    else if (score >= 70) { label = '不錯！'; tone = 'text-emerald-300'; }
    else if (score >= 40) { label = '普通'; tone = 'text-field-chalk/80'; }
    else { label = p < 50 ? '太早了…' : '太晚了…'; tone = 'text-red-300'; }
    setResult({ score, label, tone });
    setTimeout(() => onDone(score), 700);
  }, [onDone]);

  useEffect(() => {
    let raf;
    const period = periodRef.current;
    const loop = (now) => {
      if (doneRef.current) return;
      if (now - startRef.current > 3200 + Math.random() * 0) {
        finish(8, posRef.current); // 站著沒出手＝完全沒跟上
        return;
      }
      const t = (now - startRef.current) % (period * 2);
      const p = (t < period ? t / period : 2 - t / period) * 100; // 三角波 0→100→0
      posRef.current = p;
      setPos(p);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [finish]);

  const swing = () => {
    const p = posRef.current;
    finish(Math.max(0, Math.round(100 - Math.abs(p - 50) * 2)), p);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center px-6 select-none">
      <div className="text-field-chalk/70 text-sm mb-1">球來了——看準時機！</div>
      <div className="text-[11px] text-field-chalk/40 mb-5">光標越靠近中央甜蜜點，擊球品質越好（對方球威越強，擺動越快）</div>

      {/* 時機條 */}
      <div className="relative w-full max-w-sm h-12 rounded-xl bg-black/70 border border-field-chalk/25 overflow-hidden">
        {/* 分區底色：紅（沒跟上）→ 黃（普通）→ 綠（甜蜜點） */}
        <div className="absolute inset-0 flex">
          <div className="bg-red-900/60" style={{ width: '30%' }} />
          <div className="bg-yellow-700/50" style={{ width: '12.5%' }} />
          <div className="bg-emerald-600/60" style={{ width: '15%' }} />
          <div className="bg-yellow-700/50" style={{ width: '12.5%' }} />
          <div className="bg-red-900/60" style={{ width: '30%' }} />
        </div>
        {/* 甜蜜點中線 */}
        <div className="absolute top-0 bottom-0 left-1/2 w-[2px] -translate-x-1/2 bg-field-floodlight/80" />
        {/* 光標 */}
        <div
          className="absolute top-0 bottom-0 w-[5px] -ml-[2.5px] bg-white rounded shadow-[0_0_10px_rgba(255,255,255,0.9)]"
          style={{ left: `${pos}%` }}
        />
      </div>

      {result ? (
        <div className={`mt-6 font-display text-3xl font-bold ${result.tone} animate-pulse`}>
          {result.label}
          <span className="ml-2 text-base font-mono-tc text-field-chalk/50">{result.score}</span>
        </div>
      ) : (
        <button
          onClick={swing}
          className="mt-6 w-40 h-40 rounded-full bg-field-floodlight text-field-night font-display font-bold text-2xl active:scale-90 transition-transform shadow-[0_0_30px_rgba(255,200,60,0.35)]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function InfoTip({ type }) {
  const content = {
    pitcher: [
      'S/A 是拿手球路：更不容易失投、位移也更急更快。B/C 陌生球路容易被咬中，疲勞還會讓全部等級下修。',
      '球可拖到帶內任意位置、甚至帶外。每種球路的軌跡不同：直球最快最直、滑球外竄、曲球大弧線、指叉/變速末段下墜。',
      '出手時機條太差＝失投紅中。壘上有人時可牽制——若對方剛好下了盜壘暗號，大概率直接抓死。',
    ],
    batter: [
      '按住畫面＝持棒瞄準（棒身上的球標＝甜蜜點），放開的一瞬間＝揮棒。時機與位置都對才算咬中。',
      '直球一閃而逝、時機窗最窄；滑球中段外竄、曲球大弧線好認；指叉/變速前段完全像直球、末段才下墜——盯到最後再出手。',
      '切到球的上緣偏滾地、下緣偏飛球。強力打擊咬中就是大的但更難；壞球區的球別追。',
    ],
    result: [
      '結果畫面會揭曉雙方決策。看懂這一球，下一球才有反制空間。',
      '只有「毫釐之差」的刺殺 play 才能挑戰；高飛接殺挑戰必維持原判。',
    ],
  }[type];
  if (!content) return null;
  return (
    <details className="mt-4 rounded-lg border border-field-chalk/15 bg-black/25 max-w-md mx-auto">
      <summary className="cursor-pointer px-3 py-2 text-xs text-field-chalk/55 select-none">📖 玩法提示（點開查看）</summary>
      <div className="px-3 pb-2.5 text-[11px] leading-relaxed text-field-chalk/55 space-y-1.5">
        {content.map((t) => <div key={t}>・{t}</div>)}
      </div>
    </details>
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
  const [extraMode, setExtraMode] = useState('tiebreak');
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
        body: JSON.stringify({ innings, teamId, extraMode }),
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
      <h1 className="font-display text-3xl font-black tracking-wide text-center mb-1">中職對戰</h1>
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
          <div className="text-sm mb-2 mt-4 text-field-chalk/70">延長賽制</div>
          <div className="flex gap-2">
            {[
              ['tiebreak', '快速決勝', '突破僵局制（二壘有跑者），打到分出勝負'],
              ['cpbl', '中職例行賽制', '延長最多 +3 局，仍平手＝和局'],
            ].map(([id, label, desc]) => (
              <button
                key={id}
                onClick={() => setExtraMode(id)}
                className={`flex-1 py-2 px-2 rounded-lg border text-left ${extraMode === id ? 'border-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/25'}`}
              >
                <div className={`text-sm ${extraMode === id ? 'font-bold text-field-floodlight' : ''}`}>{label}</div>
                <div className="text-[10px] text-field-chalk/45 mt-0.5">{desc}</div>
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
        雙方各自用自己的手機或電腦進入。每隊 9 棒打線（DH 制，投手不打擊）＋2 名板凳代打，牛棚 4 人可全部輪替。★ 為投手擅長球路，「洋」為洋將。平手進入延長賽（可選賽制）。球員數值與左右打／洋將標記為參考值，非官方精確數據。
      </p>
    </div>
  );
}

/* ---------------- 投手回合 ---------------- */

function PitcherScreen({ view, send, busy }) {
  const g = view.game;
  const [typeId, setTypeId] = useState('fastball');
  const [target, setTarget] = useState(null); // {x,y} 連續座標 | null
  const [waste, setWaste] = useState(false); // 故意壞球意圖旗標
  const [shift, setShift] = useState('normal');
  const [showBullpen, setShowBullpen] = useState(false);
  const [releasing, setReleasing] = useState(false); // 出手時機小遊戲進行中

  const fKey = fieldingKey(g.half);
  const side = g[fKey];
  const pitcher = currentPitcher(side);
  const remainingArms = side.team.pitchers.length - side.staff.used.length;
  const grade = gradeOf(pitcher, typeId);

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <div className="text-center mb-4">
        <div className="text-xs text-field-chalk/50">你是守備方・輪到你配球</div>
        <div className="font-display text-xl font-bold" style={{ color: side.team.color }}>
          {side.team.name}｜{ROLE_NAMES[pitcher.role]} {pitcher.name}
          <ForeignTag show={pitcher.foreign} />
        </div>
        <div className="text-[11px] text-field-chalk/40 mt-0.5">
          {throwsLabel(pitcher.throws)} ・控球 {pitcher.effControl} ・球威 {pitcher.effStuff}
          {pitcher.fatigue > 0 && <span className="text-red-300/80">（疲勞 -{pitcher.fatigue}，球種等級掉落中）</span>}
        </div>
        <div className="mt-1">
          <StaminaBar pct={pitcher.stamina} width="w-40" pitchCount={pitcher.pitchCount} />
        </div>
        <Countdown deadline={g.deadline} serverNow={g.serverNow} />
        <div className="text-[10px] text-field-chalk/35">時間到未配球＝失投紅中直球！</div>
      </div>
      <Scoreboard g={g} />
      <InfoTip type="pitcher" />

      <div className="mt-4 flex justify-center">
        <button
          onClick={() => setShowBullpen(!showBullpen)}
          disabled={remainingArms <= 0}
          className="text-xs border border-field-chalk/25 rounded-full px-3 py-1 disabled:opacity-30"
        >
          換投（牛棚尚有 {remainingArms} 人可用）
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
                <div>
                  {ROLE_NAMES[p.role]} {p.name}
                  <ForeignTag show={p.foreign} />
                  <span className="text-field-chalk/40 text-xs ml-2">
                    {throwsLabel(p.throws)}／控 {p.control}／威 {p.stuff}／★{p.fav.map((f) => PITCH_TYPE_MAP[f].name).join('、')}
                  </span>
                  {used && <span className="text-xs text-red-300/70 ml-2">已退場</span>}
                </div>
                <div className="mt-1">
                  <StaminaBar pct={staminaOf(side.staff.pitchCounts[i] || 0)} width="w-20" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <div className="text-sm mb-2 text-field-chalk/80 text-center font-bold">① 選球種<span className="font-normal text-field-chalk/45 text-xs ml-2">（S/A 拿手・B/C 陌生易失投）</span></div>
        <PitchTypeRow selected={typeId} onSelect={setTypeId} pitcher={pitcher} />
      </div>

      <div className="mt-5">
        <div className="text-sm mb-2 text-field-chalk/80 text-center font-bold">② 拖曳落點</div>
        <PitchTargetBoard typeId={typeId} target={target} onTarget={setTarget} waste={waste} onWasteChange={setWaste} />
        {target && (
          <div className="text-[11px] text-field-chalk/50 text-center mt-1.5">
            目標：{zoneLabelFromXY(target.x, target.y)}{waste && '（故意壞球）'}・
            <GradeBadge grade={grade} /> {PITCH_TYPE_MAP[typeId].name}
          </div>
        )}
      </div>

      <div className="mt-5">
        <div className="text-sm mb-2 text-field-chalk/80 text-center font-bold">③ 守備佈陣<span className="font-normal text-field-chalk/45 text-xs ml-2">（打者看得到）</span></div>
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
          disabled={!target || busy}
          onClick={() => setReleasing(true)}
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
        >
          投出這一球（進入出手時機）
        </button>
        <button
          disabled={busy}
          onClick={() => send('pitcher_submit', { ibb: true })}
          className="text-xs text-field-chalk/50 underline underline-offset-2"
        >
          比出敬遠手勢（自動故意四壞，直接保送這名打者）
        </button>
        {(g.bases.first || g.bases.second) && (
          <button
            disabled={busy || (g.pickoffsThisPA ?? 0) >= 2}
            onClick={() => send('pickoff')}
            className="mt-1 px-4 py-1.5 rounded-full text-xs font-bold border border-field-floodlight/60 text-field-floodlight disabled:opacity-30 hover:bg-field-floodlight/10"
          >
            ⚡ 牽制{g.bases.second ? '二壘' : '一壘'}跑者（剩 {Math.max(0, 2 - (g.pickoffsThisPA ?? 0))} 次）
          </button>
        )}
        {(g.bases.first || g.bases.second) && (
          <div className="text-[10px] text-field-chalk/40 text-center max-w-[280px]">
            牽制會重置配球倒數；若對方正好偷按了盜壘，大概率直接抓死！投手越疲勞越容易暴傳（最高 20%）
          </div>
        )}
      </div>

      {releasing && (
        <SwingTimingGame
          stuff={pitcher.effStuff}
          actionLabel="出手！"
          onDone={(score) => {
            setReleasing(false);
            send('pitcher_submit', { typeId, targetX: target.x, targetY: target.y, waste, shift, release: score });
          }}
        />
      )}

      <GameLog log={g.log} />
    </div>
  );
}

/* ---------------- 打者回合 ---------------- */

const BATTER_MODES = [
  { id: 'take', name: '不打擊', desc: '目送這一球（壞球免費、好球挨一顆）' },
  { id: 'normal', name: '打擊', desc: '均衡出棒，時機窗正常' },
  { id: 'power', name: '強力打擊', desc: '時機窗 -15%、甜蜜點更小；咬中就是長打或紅不讓' },
  { id: 'bunt', name: '觸擊短棒', desc: '犧牲推進跑者，時機窗最寬（碰到就好）' },
];

function BatterScreen({ view, send, busy }) {
  const g = view.game;
  const [mode, setMode] = useState('normal');
  const [reacting, setReacting] = useState(false); // 即時反應小遊戲進行中

  const bKey = battingKey(g.half);
  const fKey = fieldingKey(g.half);
  const side = g[bKey];
  const oppSide = g[fKey];
  const oppPitcher = currentPitcher(oppSide);
  const batter = side.lineup[side.lineupIdx % side.lineup.length];
  const shift = g.pendingPitch?.shift || 'normal';
  const path = g.pendingPitch?.path;
  const availableBench = side.bench.filter((b) => !b.used);
  const [showBench, setShowBench] = useState(false);

  const submit = (payload) => send('batter_submit', { mode, ...payload });

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <div className="text-center mb-3">
        <div className="text-xs text-field-chalk/50">你是進攻方・對方已出手，準備反應</div>
        <Countdown deadline={g.deadline} serverNow={g.serverNow} />
        <div className="text-[10px] text-field-chalk/35">時間到未選擇＝自動不揮棒</div>
      </div>
      <Scoreboard g={g} />

      {/* 對戰情報卡：左＝我方打者、右＝敵方投手，一眼看完 */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-left">
        <div className="rounded-xl bg-black/30 border border-field-chalk/12 px-3 py-2.5">
          <div className="text-[10px] text-field-chalk/40 mb-1">我方打者</div>
          <div className="font-display font-bold text-sm leading-tight" style={{ color: side.team.color }}>
            第 {(side.lineupIdx % side.lineup.length) + 1} 棒 {batter.name}
            <ForeignTag show={batter.foreign} />
          </div>
          <div className="text-[10px] text-field-chalk/50 mt-1 leading-relaxed">
            {batsLabel(batter.bats)}<br />
            力 {batter.power}／準 {batter.contact}／眼 {batter.eye}／速 {batter.speed}
          </div>
          <button
            onClick={() => setShowBench(!showBench)}
            disabled={availableBench.length === 0}
            className="mt-1.5 text-[11px] border border-field-chalk/25 rounded-full px-2.5 py-0.5 disabled:opacity-30"
          >
            代打（剩 {availableBench.length}）
          </button>
        </div>
        <div className="rounded-xl bg-black/30 border border-field-chalk/12 px-3 py-2.5">
          <div className="text-[10px] text-field-chalk/40 mb-1">敵方投手</div>
          <div className="font-display font-bold text-sm leading-tight text-field-chalk/90">
            {ROLE_NAMES[oppPitcher.role]} {oppPitcher.name}
            <ForeignTag show={oppPitcher.foreign} />
          </div>
          <div className="text-[10px] text-field-chalk/50 mt-1 leading-relaxed">
            {throwsLabel(oppPitcher.throws)}・擅長 {oppPitcher.fav.map((f) => PITCH_TYPE_MAP[f].name).join('、')}
            {oppPitcher.fatigue > 0 && <span className="text-field-floodlight/80">（顯疲態）</span>}
            <br />佈陣：{SHIFTS.find((sh) => sh.id === shift)?.name}
          </div>
          <div className="mt-1.5">
            <StaminaBar pct={oppPitcher.stamina} width="w-20" pitchCount={oppPitcher.pitchCount} />
          </div>
        </div>
      </div>

      {g.pendingSteal && (
        <div className="mt-2 text-center text-xs text-field-floodlight font-bold animate-pulse">
          🏃 跑者已啟動盜壘（{g.pendingSteal.base === 'double' ? '雙盜壘！' : g.pendingSteal.base === 'first' ? '一壘→二壘' : '二壘→三壘'}）
        </div>
      )}
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
        <div className="grid grid-cols-2 gap-2 max-w-sm mx-auto">
          {BATTER_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-lg border px-3 py-2 text-left ${
                mode === m.id ? 'bg-field-floodlight text-field-night border-field-floodlight' : 'border-field-chalk/25'
              }`}
            >
              <div className={`text-sm font-bold ${mode === m.id ? '' : 'text-field-chalk/90'}`}>{m.name}</div>
              <div className={`text-[10px] leading-snug mt-0.5 ${mode === m.id ? 'text-field-night/70' : 'text-field-chalk/45'}`}>{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-1.5">
        <button
          disabled={busy}
          onClick={() => {
            if (mode === 'take') submit({ batX: null, batY: null, swingDelta: null });
            else setReacting(true);
          }}
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
        >
          {mode === 'take' ? '目送這一球' : mode === 'bunt' ? '擺短棒（進入反應）' : '站上打擊區（進入反應）'}
        </button>
        {mode !== 'take' && (
          <div className="text-[10px] text-field-chalk/40 text-center max-w-[280px]">
            按住畫面持棒瞄準，<span className="text-field-floodlight/80 font-bold">放開的一瞬間＝揮棒</span>——時機與位置都要對
          </div>
        )}
      </div>

      <InfoTip type="batter" />

      {reacting && path && (
        <BatAimGame
          path={path}
          mode={mode}
          onDone={({ batX, batY, swingDelta }) => {
            setReacting(false);
            submit({ batX, batY, swingDelta });
          }}
        />
      )}

      <GameLog log={g.log} />
    </div>
  );
}

/* ---------------- 結果 / 等待 / 結束 ---------------- */

const STEAL_LABEL = {
  first: { name: '一壘跑者盜二壘', desc: '直球有風險、變化球揮空大加成' },
  second: { name: '二壘跑者盜三壘', desc: '距離較短，被抓機率略高' },
  double: { name: '雙盜壘（一二壘齊跑）', desc: '成功二三壘有人；失敗前位跑者出局' },
};

// 進攻方在對方配球階段的等待畫面：可以「偷偷」宣告盜壘（守備方看不到）
function OffenseWaitScreen({ view, send, busy }) {
  const g = view.game;
  const options = g.stealOptions || [];
  const pending = g.pendingSteal;
  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <Scoreboard g={g} />
      <Countdown deadline={g.deadline} serverNow={g.serverNow} />
      <WaitingCard title="對方投手正在配球…" sub="現在是下暗號的時機（對方超時會被自動處理）" />

      {options.length > 0 && (
        <div className="mt-4 rounded-xl bg-black/30 border border-field-chalk/12 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-field-chalk/85">🏃 盜壘暗號（對方看不到）</div>
            {pending && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-field-floodlight/20 text-field-floodlight border border-field-floodlight/40 animate-pulse">
                已下達・{STEAL_LABEL[pending.base]?.name}
              </span>
            )}
          </div>
          <div className="mt-2 text-[11px] text-field-chalk/50 leading-relaxed">
            投球出手後跑者立刻啟動。⚠️ 若對方選擇牽制，已啟動的跑者大概率被抓死；界外球不算、安打可多推進一個壘包。
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2">
            {options.map((b) => {
              const on = pending?.base === b;
              return (
                <button
                  key={b}
                  disabled={busy}
                  onClick={() => send('declare_steal', { base: on ? null : b })}
                  className={`rounded-lg px-3 py-2.5 text-left border transition ${on
                    ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold'
                    : 'bg-field-grass2/60 border-field-chalk/15 text-field-chalk/85 hover:bg-field-grass2'}`}
                >
                  <div className="text-sm">{on ? '✅ ' : ''}{STEAL_LABEL[b]?.name}</div>
                  <div className={`text-[10px] mt-0.5 ${on ? 'text-field-night/70' : 'text-field-chalk/45'}`}>
                    {on ? '再點一次取消暗號' : STEAL_LABEL[b]?.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <GameLog log={g.log} />
    </div>
  );
}

function batterModeText(c) {
  if (!c) return '—';
  const names = {
    take: '看球（不出棒）',
    normal: '正常打擊',
    power: '強力打擊',
    bunt: '觸擊短打',
    ibb: '敬遠',
    pickoff: '—（牽制事件）',
    hbp: '—（觸身球）',
  };
  let t = names[c.mode] || '—';
  if (c.mode === 'normal' || c.mode === 'power' || c.mode === 'bunt') {
    if (c.batX != null && c.batY != null) {
      t += `・揮棒點 ${zoneLabelFromXY(c.batX, c.batY)}`;
      if (c.swingDelta != null) {
        t += c.swingDelta === 0 ? '・時機正點' : `・出棒${c.swingDelta < 0 ? '早' : '晚'} ${Math.abs(c.swingDelta)}ms`;
      }
    } else t += '・沒出棒';
  }
  return t;
}

function pitchChoiceText(choice) {
  if (!choice) return '—';
  if (choice.zoneTarget === 'ibb') return '敬遠';
  if (choice.zoneTarget === 'pickoff') return '牽制';
  const t = PITCH_TYPE_MAP[choice.typeId];
  const type = t?.name || choice.typeId || '—';
  const gradeTxt = choice.grade ? `【${choice.grade}】` : '';
  const zone = choice.targetX != null && choice.targetY != null ? zoneLabelFromXY(choice.targetX, choice.targetY) : '—';
  const rel = choice.release != null
    ? choice.release < 22 ? '・出手失手！' : choice.release >= 80 ? '・出手完美' : ''
    : '';
  return `${gradeTxt}${type}・${zone}${rel}`;
}

function shiftText(g, r) {
  const id = r.pitcherChoice?.shift;
  return SHIFTS.find((s) => s.id === id)?.name || '—';
}

function DecisionReplay({ g, result }) {
  const actual = `${result.pitchTypeName}${result.hung ? '（失投）' : ''}・${result.zoneLabel}`;
  const batter = batterModeText(result.batterChoice);
  const steal = result.batterChoice?.steal
    ? { first: '一壘跑者啟動', second: '二壘跑者啟動', double: '雙盜壘發動！' }[result.batterChoice.steal] || '跑者啟動'
    : '無';

  return (
    <div className="mt-4 grid grid-cols-1 gap-2 text-left max-w-md mx-auto">
      {[
        ['投手決策', pitchChoiceText(result.pitcherChoice)],
        ['守備佈陣', shiftText(g, result)],
        ['打者反應', batter],
        ...(result.batterChoice?.contactQuality != null
          ? [['揮擊品質', `${result.batterChoice.timingLabel}（${result.batterChoice.contactQuality} 分）`]]
          : []),
        ['跑壘企圖', steal],
        ['實際結果', actual],
      ].map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 rounded-md bg-black/25 border border-field-chalk/10 px-3 py-2">
          <span className="text-[11px] text-field-chalk/40">{label}</span>
          <span className="text-sm text-field-chalk/85 text-right">{value}</span>
        </div>
      ))}
    </div>
  );
}

function BoxScore({ g }) {
  const rows = [
    ['得分', g.away.score, g.home.score],
    ['安打', g.away.stats?.hits || 0, g.home.stats?.hits || 0],
    ['長打', g.away.stats?.doublesTriples || 0, g.home.stats?.doublesTriples || 0],
    ['全壘打', g.away.stats?.homeRuns || 0, g.home.stats?.homeRuns || 0],
    ['奪三振', g.away.stats?.pitchingStrikeouts || 0, g.home.stats?.pitchingStrikeouts || 0],
    ['被三振', g.away.stats?.battingStrikeouts || 0, g.home.stats?.battingStrikeouts || 0],
    ['保送/死球', (g.away.stats?.walks || 0) + (g.away.stats?.hbp || 0), (g.home.stats?.walks || 0) + (g.home.stats?.hbp || 0)],
    ['盜壘', `${g.away.stats?.steals || 0}-${g.away.stats?.caughtStealing || 0}`, `${g.home.stats?.steals || 0}-${g.home.stats?.caughtStealing || 0}`],
    // 打者被打成雙殺（GIDP）與守備方完成雙殺（DP）分開呈現，避免同一次雙殺被兩隊同時計數
    ['被雙殺 GIDP', g.away.stats?.gidp || 0, g.home.stats?.gidp || 0],
    ['守備雙殺 DP', g.away.stats?.doublePlays || 0, g.home.stats?.doublePlays || 0],
  ];
  const awayPitches = Object.values(g.away.staff.pitchCounts || {}).reduce((a, b) => a + b, 0);
  const homePitches = Object.values(g.home.staff.pitchCounts || {}).reduce((a, b) => a + b, 0);
  rows.push(['投球數', awayPitches, homePitches]);
  const highlights = [g.away.stats?.biggestSwing, g.home.stats?.biggestSwing].filter(Boolean).sort((a, b) => b.runs - a.runs);

  return (
    <div className="mt-7 text-left">
      <div className="text-xs text-field-chalk/40 mb-2">BOX SCORE</div>
      <div className="rounded-lg border border-field-chalk/15 bg-black/25 overflow-hidden">
        <div className="grid grid-cols-[1fr_72px_72px] text-xs bg-field-chalk/5">
          <div className="px-3 py-2 text-field-chalk/45">項目</div>
          <div className="px-3 py-2 text-right font-bold" style={{ color: g.away.team.color }}>{g.away.team.short}</div>
          <div className="px-3 py-2 text-right font-bold" style={{ color: g.home.team.color }}>{g.home.team.short}</div>
        </div>
        {rows.map(([label, away, home]) => (
          <div key={label} className="grid grid-cols-[1fr_72px_72px] border-t border-field-chalk/10 text-sm">
            <div className="px-3 py-2 text-field-chalk/65">{label}</div>
            <div className="px-3 py-2 text-right font-mono-tc">{away}</div>
            <div className="px-3 py-2 text-right font-mono-tc">{home}</div>
          </div>
        ))}
      </div>
      {highlights[0] && (
        <div className="mt-3 rounded-md border border-field-floodlight/25 bg-field-floodlight/10 px-3 py-2 text-sm text-field-floodlight">
          關鍵一擊：{highlights[0].text}
        </div>
      )}
    </div>
  );
}

function DebugPanel({ g }) {
  if (process.env.NODE_ENV !== 'development') return null;
  const r = g.lastResult;
  if (!r) return null;
  return (
    <details className="mt-4 max-w-md mx-auto text-left rounded-lg border border-field-chalk/10 bg-black/25 px-3 py-2">
      <summary className="cursor-pointer text-xs text-field-chalk/45">Debug</summary>
      <pre className="mt-2 max-h-56 overflow-auto text-[10px] text-field-chalk/60 whitespace-pre-wrap">
        {JSON.stringify({ pitcher: r.pitcherChoice, batter: r.batterChoice, result: r.summary, runs: r.runs, challengeable: r.challengeable }, null, 2)}
      </pre>
    </details>
  );
}

function WaitingRoom({ view, onLeave }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await copyText(view.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <div className="text-sm text-field-chalk/50 mb-2">把房號告訴對方，請他選「加入房間」</div>
      <div className="text-6xl font-mono-tc font-bold tracking-[0.3em] text-field-floodlight mb-4">{view.code}</div>
      <button
        onClick={onCopy}
        className="mb-5 px-4 py-2 rounded-lg border border-field-floodlight/40 bg-field-floodlight/10 text-field-floodlight text-sm font-bold"
      >
        {copied ? '已複製' : '複製房號'}
      </button>
      <WaitingCard title="等待對手加入…" sub="對方加入後比賽自動開始" />
      <button onClick={onLeave} className="mt-6 text-xs text-field-chalk/50 underline underline-offset-2">
        取消並回到大廳
      </button>
    </div>
  );
}

function ResultScreen({ view, send, busy }) {
  const g = view.game;
  const r = g.lastResult;
  const iAmReady = g.ready[view.role];
  const lines = r.narration && r.narration.length > 0 ? r.narration : null;

  // 逐字打字機播報：每 45ms 出一個字，每句結尾停頓一拍（約 0.6 秒）再進下一句
  const LINE_PAUSE = 13; // 句尾虛擬停頓字數（13 × 45ms ≈ 0.6s）
  const CHAR_MS = 45;
  const budgets = lines ? lines.map((ln) => ln.length + LINE_PAUSE) : [];
  const totalTicks = budgets.reduce((a, b) => a + b, 0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!lines) return;
    setTick(0);
    const t = setInterval(() => {
      setTick((c) => {
        if (c + 1 >= totalTicks) clearInterval(t);
        return c + 1;
      });
    }, CHAR_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.summary, r.challenge?.success]);

  // 依 tick 換算每一句目前顯示到第幾個字
  let remain = tick;
  const lineStates = budgets.map((budget, i) => {
    const chars = Math.max(0, Math.min(lines[i].length, remain));
    const started = remain > 0;
    const typing = started && remain < budget;
    remain -= budget;
    return { chars, started, typing };
  });

  const done = !lines || tick >= totalTicks;
  const myChallenges = g.challenges?.[view.role] ?? 0;
  const canChallenge = done && !iAmReady && r.challengeable && myChallenges > 0 && !r.challenge;

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <Scoreboard g={g} />
      <div className="mt-6 text-center">
        <div className="text-sm text-field-chalk/50 mb-2">
          {r.batterName} ・ 面對{r.pitchTypeName}
          {r.isFav && '（拿手球）'}
          {r.hung && <span className="text-field-floodlight">（失投！）</span>}
          ・落點 {r.zoneLabel}
        </div>

        {lines && (
          <div className="text-left max-w-md mx-auto space-y-2 min-h-[90px]">
            {lines.map((ln, i) => {
              const st = lineStates[i];
              if (!st.started) return null;
              return (
                <div
                  key={i}
                  className={`text-[15px] leading-relaxed ${st.typing ? 'text-field-chalk' : 'text-field-chalk/75'}`}
                >
                  <span className="text-field-floodlight/60 mr-1.5">▸</span>
                  {ln.slice(0, st.chars)}
                  {st.typing && <span className="inline-block w-[2px] h-[1em] bg-field-floodlight/80 align-middle ml-0.5 animate-pulse" />}
                </div>
              );
            })}
          </div>
        )}

        {done && (
          <>
            <div className="font-display text-2xl font-bold mt-4">{r.summary}</div>
            {r.extra?.map((e, i) => (
              <div key={i} className="mt-1 text-field-chalk/80">{e}</div>
            ))}
            {r.runs > 0 && <div className="mt-2 text-field-floodlight font-bold">得分 +{r.runs}</div>}
            {r.challenge && (
              <div className={`mt-3 text-sm font-bold ${r.challenge.success ? 'text-field-floodlight' : 'text-red-300'}`}>
                {r.challenge.text}
              </div>
            )}
            <DecisionReplay g={g} result={r} />
            <InfoTip type="result" />
            <DebugPanel g={g} />
          </>
        )}
      </div>

      {done && (
        <div className="mt-6 flex flex-col items-center gap-2">
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
          {canChallenge && (
            <button
              disabled={busy}
              onClick={() => send('challenge')}
              className="text-xs border border-field-chalk/30 rounded-full px-4 py-1.5 text-field-chalk/80 hover:border-field-floodlight hover:text-field-floodlight"
            >
              📺 挑戰判決（剩 {myChallenges} 次・成功改判不扣次數）
            </button>
          )}
        </div>
      )}

      <GameLog log={g.log} />
    </div>
  );
}

function GameOverScreen({ view, onLeave }) {
  const g = view.game;
  return (
    <div className="max-w-xl mx-auto px-6 py-16 text-center">
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
      <BoxScore g={g} />
      <button onClick={onLeave} className="mt-7 px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold">
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
  const [err, setErr] = useState(''); // 連線 / session 級錯誤（Lobby 用）
  const [actionErr, setActionErr] = useState(''); // 動作級錯誤（遊戲畫面 toast）
  const actionErrTimer = useRef(null);
  const pollRef = useRef(null);

  // 動作錯誤自動 4 秒消失；被 refresh 輪詢覆蓋不會清掉這個
  const showActionErr = useCallback((msg) => {
    setActionErr(msg);
    if (actionErrTimer.current) clearTimeout(actionErrTimer.current);
    actionErrTimer.current = setTimeout(() => setActionErr(''), 4000);
  }, []);

  const refresh = useCallback(async (code, token) => {
    try {
      const data = await api('/api/room/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, token }),
      });
      setView(data.view);
      setErr('');
      // 注意：actionErr 不在此清除，避免 send 剛設的錯誤被 2 秒輪詢覆蓋
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

  // 卸載時清 actionErr 的 timeout
  useEffect(() => () => {
    if (actionErrTimer.current) clearTimeout(actionErrTimer.current);
  }, []);

  const send = async (action, payload) => {
    setBusy(true);
    try {
      const data = await api('/api/room/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: session.code, token: session.token, action, payload }),
      });
      setView(data.view);
      setActionErr('');
    } catch (e) {
      // 常見錯誤代碼給使用者可讀提示；其他錯誤直接顯示訊息
      const msg = e?.message || '';
      const CODE_TIP = {
        WRONG_PHASE: '目前不是這個階段，畫面已刷新',
        NOT_YOUR_TURN: '現在不是你的操作回合',
        BAD_INPUT: '輸入不合法',
        INVALID: '這個選項目前不可用',
        ALREADY_READY: '你已經按過繼續了',
        NO_CHALLENGE: '挑戰次數已用完',
        NOT_CHALLENGEABLE: '這球不是毫釐之差的判決，無法挑戰',
        NO_RUNNER: '壘上沒有可牽制／盜壘的跑者',
        PICKOFF_LIMIT: '這個打席的牽制次數已用完',
        ROOM_BUSY: '房間忙碌，請再試一次',
        NOT_FOUND: '房間不存在或已過期',
        FORBIDDEN: '你沒有這個房間的權限',
      };
      const known = Object.keys(CODE_TIP).find((k) => msg.includes(k));
      showActionErr(known ? CODE_TIP[known] : (msg || '操作失敗'));
      // 讓畫面重新同步，避免本地 view 與伺服器不一致；refresh 不會清 actionErr
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
    screen = <WaitingRoom view={view} onLeave={leave} />;
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
    } else if (g.phase === 'pitcher' && view.role === battingKey(g.half)) {
      screen = <OffenseWaitScreen view={view} send={send} busy={busy} />;
    } else {
      screen = (
        <div className="max-w-xl mx-auto px-5 py-8">
          <Scoreboard g={g} />
          <Countdown deadline={g.deadline} serverNow={g.serverNow} />
          <WaitingCard title="對方打者正在反應…" sub="等待對方出棒（超時會被自動處理）" />
          <GameLog log={g.log} />
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grass-stripes floodlight-glow bg-gradient-to-b from-field-grass2 via-field-grass to-field-night" />
      <div className="relative z-10">{screen}</div>
      {/* 動作錯誤浮動提示：所有遊戲畫面都能看到；4 秒自動消失，不會被輪詢覆蓋 */}
      {actionErr && session && view && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md bg-red-500/90 text-white text-sm font-medium shadow-lg border border-red-300/40 max-w-[90vw]"
          role="alert"
        >
          ⚠️ {actionErr}
        </div>
      )}
    </div>
  );
}
