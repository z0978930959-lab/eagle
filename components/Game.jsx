'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TEAMS, PITCH_TYPES, SHIFTS, ROLE_NAMES, zoneId, zoneLabel, batsLabel, throwsLabel } from '../data/teams';
import { PITCH_TYPE_MAP, gradeOf, GRADE_PARAMS, FIELD, clampCanvas, zoneLabelFromXY, SWEET_RADIUS, CONTACT_RADIUS, POWER_SWEET_RADIUS, POWER_CONTACT_RADIUS, flightPointAt, swingWindowsOf, releaseWindows } from '../lib/engine';
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
      <MomentumBar g={g} />
      {g.notice && (
        <div className="mt-2 text-center text-xs bg-field-floodlight/15 border border-field-floodlight/40 rounded-md py-1.5 px-2 text-field-floodlight font-bold">
          {g.notice.text}
        </div>
      )}
    </div>
  );
}

/* 氣勢條（公開）：g.momentum ∈ [-100,100]，>0 倒向客隊、<0 倒向主隊。
 * 條的填色從中線往氣勢方延伸；氣勢滿檔時該方下一球獲得小幅加成。 */
function MomentumBar({ g }) {
  const m = Math.max(-100, Math.min(100, g.momentum || 0));
  const awayColor = g.away.team.color;
  const homeColor = g.home.team.color;
  const pct = Math.abs(m) / 2; // 0~50%（從中線往單側延伸）
  const toAway = m > 0;
  const label = Math.abs(m) < 8 ? '勢均力敵' : `氣勢：${toAway ? g.away.team.short : g.home.team.short}`;
  return (
    <div className="mt-2">
      <div className="relative h-2 rounded-full bg-black/50 overflow-hidden border border-field-chalk/10">
        {/* 中線 */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-field-chalk/25 -translate-x-1/2 z-10" />
        {m !== 0 && (
          <div
            className="absolute top-0 bottom-0 transition-all duration-500"
            style={
              toAway
                ? { right: '50%', width: `${pct}%`, background: awayColor, opacity: 0.85 }
                : { left: '50%', width: `${pct}%`, background: homeColor, opacity: 0.85 }
            }
          />
        )}
      </div>
      <div className="text-center text-[9px] text-field-chalk/45 mt-0.5 tracking-wide">🔥 {label}</div>
    </div>
  );
}

function GameLog({ log }) {
  const toneFor = (text) => {
    if (/全壘打|再見|得 \d+ 分|擠回|突破僵局/.test(text)) return 'text-field-floodlight font-bold';
    if (/三振|雙殺|觸殺|超時|失敗/.test(text)) return 'text-red-200/90';
    if (/投降|白旗|平局|求和|握手/.test(text)) return 'text-sky-200/90';
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
/* 橫拿球棒游標（仿真持棒）：手指拖曳點＝握把處（棒尾），棒身向左伸出；
 * 甜蜜點（棒身上的球標）在棒頭內側——像真的握著棒尾揮棒一樣，
 * 要用「離手最遠的甜蜜點」去掃到球，手（游標）本身離球遠得很。 */
const BAT_GRIP_SVG_X = 108; // 握把（拖曳點）在 SVG 中的 x
const BAT_SWEET_SVG_X = 34; // 甜蜜點在 SVG 中的 x
const BAT_SWEET_FROM_GRIP_PX = BAT_GRIP_SVG_X - BAT_SWEET_SVG_X; // 甜蜜點與握把距離 74px

/* 左右打鏡像：
 * 右打（預設）：手在右、棒頭朝左＝甜蜜點在握把「左方」
 * 左打（flip） ：以握把為軸整支鏡像＝手在左、棒頭朝右、甜蜜點在握把「右方」
 * 左右開弓：依對方投手手系自動站異邊（對右投站左打、對左投站右打）
 */
function BatCursor({ gripLeftPct, gripTopPct, flip = false }) {
  return (
    <div className="absolute pointer-events-none z-10" style={{ left: `${gripLeftPct}%`, top: `${gripTopPct}%` }}>
      <svg
        width="128"
        height="30"
        viewBox="0 0 128 30"
        className="absolute drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
        style={{
          left: `-${BAT_GRIP_SVG_X}px`,
          top: '-15px',
          transform: flip ? 'scaleX(-1)' : undefined,
          transformOrigin: `${BAT_GRIP_SVG_X}px 15px`,
        }}
      >
        {/* 棒身：左端棒頭（粗）→ 右端握把（細，拖曳點） */}
        <path
          d="M4 6.5 Q-1 15 4 23.5 L58 20.5 L112 18 Q116 15 112 12 L58 9.5 Z"
          fill="#3ec6cf"
          stroke="#0e7c86"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* 握把尾 */}
        <circle cx="116" cy="15" r="5.5" fill="#3ec6cf" stroke="#0e7c86" strokeWidth="2" />
        {/* 握把握點標記（手指所在） */}
        <circle cx={BAT_GRIP_SVG_X} cy="15" r="3" fill="#0e7c86" opacity="0.9" />
        {/* 甜蜜點球標：拿這裡去掃球 */}
        <circle cx={BAT_SWEET_SVG_X} cy="15" r="7" fill="#fff" stroke="#d63b3b" strokeWidth="1.5" />
        <path
          d={`M${BAT_SWEET_SVG_X - 4.5} 10.5 Q${BAT_SWEET_SVG_X} 15 ${BAT_SWEET_SVG_X - 4.5} 19.5 M${BAT_SWEET_SVG_X + 4.5} 10.5 Q${BAT_SWEET_SVG_X} 15 ${BAT_SWEET_SVG_X + 4.5} 19.5`}
          stroke="#d63b3b"
          strokeWidth="1.3"
          fill="none"
        />
      </svg>
    </div>
  );
}

function BatAimGame({ path, mode = 'normal', bats = 'R', pitcherThrows = 'R', onDone }) {
  const powerMode = mode === 'power';
  // 左打＝鏡像持棒（棒頭朝右）；左右開弓依對方投手自動站異邊
  const effectiveBats = bats === 'S' ? (pitcherThrows === 'L' ? 'R' : 'L') : bats;
  const flip = effectiveBats === 'L';
  const [stage, setStage] = useState('windup'); // windup | flying | done
  const [ball, setBall] = useState(null); // {x,y,t}：位置＋縱深（t 越大＝越近、越大顆）
  const [batGrip, setBatGrip] = useState({ x: flip ? 22 : 78, y: 62 }); // 握把（拖曳點）：左打從左側持棒
  const [held, setHeld] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [countdown, setCountdown] = useState(null); // 3/2/1/0 → GO！倒數提示
  const boardRef = useRef(null);
  const doneRef = useRef(false);
  const sweetRef = useRef({ x: 50, y: 62 }); // 甜蜜點（握把左方一段棒身處，實際判定點）
  const trailRef = useRef([]); // 殘影：最近幾個球位置
  const rafRef = useRef(null);
  const graceRef = useRef(null);
  const arrivalRef = useRef(null); // 球「到位」的 performance.now 時刻
  const stageRef = useRef('windup');

  const sweetR = powerMode ? POWER_SWEET_RADIUS : SWEET_RADIUS;
  const contactR = powerMode ? POWER_CONTACT_RADIUS : CONTACT_RADIUS;
  const windows = swingWindowsOf(path.durationMs, mode);
  const LATE_GRACE_MS = 250; // 球進壘後仍可補揮的緩衝（會被算成「太晚」）

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
    const windupMs = 1500 + Math.random() * 800; // 拉長醞釀期，並在畫面上倒數 3-2-1
    let countdownTimers = [];
    const countdownSetters = [3, 2, 1].map((n, i) => {
      const t = setTimeout(() => setCountdown(n), windupMs - (3 - i) * 450);
      countdownTimers.push(t);
      return t;
    });
    countdownTimers.push(setTimeout(() => setCountdown(0), windupMs));

    const windupTimer = setTimeout(() => {
      stageRef.current = 'flying';
      setStage('flying');
      const flyStart = performance.now();
      arrivalRef.current = flyStart + path.durationMs;
      const loop = (now) => {
        if (doneRef.current) return;
        const t = Math.min(1, (now - flyStart) / path.durationMs);
        const p = flightPointAt(path, t);
        trailRef.current = [...trailRef.current.slice(-3), { ...p, t }];
        setBall({ ...p, t });
        if (t >= 1) {
          // 球進壘：進壘點閃紅＝判定瞬間；短暫緩衝內放開仍算（太晚的）揮棒
          graceRef.current = setTimeout(() => finish(null), LATE_GRACE_MS);
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }, windupMs);
    return () => {
      clearTimeout(windupTimer);
      countdownTimers.forEach(clearTimeout);
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
    // 甜蜜點在握把旁 BAT_SWEET_FROM_GRIP_PX：右打在左方、左打（鏡像）在右方——跟棒子圖示完全一致
    const sweetOff = (BAT_SWEET_FROM_GRIP_PX / rect.width) * CANVAS_SPAN;
    const grip = {
      x: clampCanvas(FIELD.canvasMin + px * CANVAS_SPAN),
      y: clampCanvas(FIELD.canvasMin + py * CANVAS_SPAN),
    };
    return { grip, sweet: { x: clampCanvas(flip ? grip.x + sweetOff : grip.x - sweetOff), y: grip.y } };
  };

  const updateBat = (e) => {
    const pos = posFromPoint(e.clientX, e.clientY);
    if (pos) {
      sweetRef.current = pos.sweet;
      setBatGrip(pos.grip);
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
      finish({ ...sweetRef.current, delta });
    }
  };

  // 縱深：球越接近進壘（t→1）越大顆；到位瞬間在進壘點閃紅＝判定點
  const ballSizePx = (t) => 9 + 19 * t * t;
  const arrived = ball && ball.t >= 1;
  const ballPct = ball ? { x: toBoardPct(ball.x), y: toBoardPct(ball.y) } : null;
  const gripPct = { x: toBoardPct(batGrip.x), y: toBoardPct(batGrip.y) };
  const sweetPct = { x: toBoardPct(sweetRef.current.x), y: toBoardPct(sweetRef.current.y) };
  const contactPct = (contactR / CANVAS_SPAN) * 100;
  const trail = trailRef.current.slice(0, -1);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center px-5 select-none touch-none">
      <div className="text-field-chalk/85 text-sm font-bold mb-1">
        {stage === 'windup' ? '投手抬腿——按住畫面持棒！' : stage === 'flying' ? '放開的一瞬間＝揮棒！' : ''}
      </div>
      <div className="text-[11px] text-field-chalk/45 mb-4 text-center max-w-[300px]">
        {mode === 'bunt'
          ? '手握棒尾，把棒頭球標貼到來球，輕輕放開＝出棒觸擊'
          : powerMode
            ? '⚡ 強力打擊：時機窗與甜蜜點都更小——但咬中就是大的'
            : '手握棒尾、把棒頭的球標掃到來球——球由遠而近放大，進壘瞬間放開'}
      </div>

      {/* 打擊反應倒數：3 → 2 → 1 → GO！讓玩家有時間就位、能預期出手時刻 */}
      {stage === 'windup' && countdown != null && (
        <div className="mb-2 h-16 flex items-center justify-center pointer-events-none">
          <div
            key={countdown}
            className={`font-display font-black tabular-nums transition-all animate-pulse ${
              countdown === 0
                ? 'text-6xl text-field-floodlight drop-shadow-[0_0_20px_rgba(255,200,60,0.6)]'
                : 'text-5xl text-field-chalk/80'
            }`}
          >
            {countdown === 0 ? 'GO！' : countdown}
          </div>
        </div>
      )}

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

        {/* 有效接觸範圍參考環（以「甜蜜點」為圓心，不是棒頭） */}
        <div
          className={`absolute rounded-full border -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity ${held ? 'border-field-floodlight/35 opacity-100' : 'border-white/15 opacity-60'}`}
          style={{ left: `${sweetPct.x}%`, top: `${sweetPct.y}%`, width: `${contactPct * 2}%`, height: `${contactPct * 2}%` }}
        />

        {/* 橫拿球棒（仿真持棒）：手握棒尾跟著手指，甜蜜點在棒頭內側 */}
        <BatCursor gripLeftPct={gripPct.x} gripTopPct={gripPct.y} flip={flip} />

        {/* 球的殘影（讀軌跡與縱深用，不預告未來） */}
        {stage !== 'windup' && !arrived && trail.map((p, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/20 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${toBoardPct(p.x)}%`, top: `${toBoardPct(p.y)}%`, width: `${ballSizePx(p.t) * 0.75}px`, height: `${ballSizePx(p.t) * 0.75}px` }}
          />
        ))}

        {/* 球體：出現在進壘位置附近、由遠而近放大（3D 縱深）；進壘瞬間閃紅＝判定點 */}
        {ballPct && stage !== 'windup' && (
          <div
            className={`absolute rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
              arrived ? 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.95)] animate-pulse' : 'bg-white shadow-[0_0_14px_rgba(255,255,255,0.85)]'
            }`}
            style={{ left: `${ballPct.x}%`, top: `${ballPct.y}%`, width: `${ballSizePx(ball.t)}px`, height: `${ballSizePx(ball.t)}px` }}
          >
            {!arrived && (
              <div className="absolute inset-0 rounded-full border-[2px] border-transparent border-l-red-500 border-r-red-500 rotate-12" />
            )}
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

/* 三秒黑幕梗圖橫幅：用在彩蛋與拒絕投降/平手時的即時反饋 */
function MemeFlash({ img, title, sub }) {
  return (
    <div className="fixed inset-0 z-[68] bg-black/85 backdrop-blur-sm flex items-center justify-center px-4 pointer-events-none">
      <div className="max-w-sm w-full rounded-2xl border-4 border-field-floodlight/60 bg-field-night/95 overflow-hidden shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={title} className="w-full block" draggable={false} />
        <div className="p-3 text-center">
          <div className="font-display text-lg font-bold">{title}</div>
          {sub && <div className="text-[11px] text-field-chalk/55 mt-1">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- 挑釁系統 ----------------
 * 「😤 挑釁」按鈕只出現在「擊球結果」畫面（下一球下方）。第 1~11 次各對應一張梗圖
 * （第 11 張＝摔倒，之後永遠停留在摔倒狀態），雙方大屏幕都會強制播 3 秒；
 * 若觸發裁判警告，警告畫面接著再播 3 秒。警告階梯（x/5）：
 * 1＝純警告；2＝總教練出場（禁代打）；3＝副教練出場（禁換投、代打）；
 * 4＝教練團全數出場（禁換投、代打、盜壘、牽制＋送對方一分）；5＝裁定比賽對方勝利。
 * 警告採洗牌袋制：每 5 次挑釁「保證恰好 1 次」主審警告（哪一次隨機、長期真 20%）。
 */
const TAUNT_IMGS = [
  '/taunt1.png', '/taunt2.png', '/taunt3.png', '/taunt4.png',
  '/taunt5.png', // 想逼我發飆啊？
  '/taunt6.png', // 球證、旁證……怎麼和我鬥？
  '/taunt7.png', // 回鄉下吧
  '/taunt8.png', // 外面有記者，要不要把他們叫進來？
  '/taunt9.png', // 老闆，你小心呀
  '/taunt10.png', // 我小你老母
  '/taunt11.png', // 摔倒（之後永遠停在這張）
];

function TauntSystem({ view, send, busy }) {
  const g = view?.game;
  const [show, setShow] = useState(null); // { img, title, sub }
  const seenRef = useRef(-1);
  const timerRef = useRef(null);

  useEffect(() => {
    const feed = g?.tauntFeed;
    if (seenRef.current === -1) {
      seenRef.current = feed?.seq || 0; // 首次同步：既有事件視為已看過（重整不重播）
      return;
    }
    if (!feed || feed.seq <= seenRef.current) return;
    seenRef.current = feed.seq;

    const mine = feed.by === view.role;
    const queue = [];
    // 挑釁梗圖：雙方都看得到（發起方也看），每張強制顯示 3 秒
    const stageIdx = Math.min(Math.max(feed.stage || 1, 1), TAUNT_IMGS.length) - 1;
    queue.push({ img: TAUNT_IMGS[stageIdx], title: mine ? '😤 你方挑釁！' : '😤 對方挑釁！', sub: null });
    if (feed.warned && !feed.ejected && !feed.coachEjected && !feed.allOut && !feed.forfeited) {
      queue.push({
        img: '/warn.png',
        title: `🟨 主審警告！（累計 ${feed.warnings ?? 1}/5）`,
        sub: mine ? '你的板凳吃下警告——第二次警告總教練就要出場！' : '對方板凳吃下警告',
      });
    }
    if (feed.ejected) {
      queue.push({
        img: '/eject.png',
        title: '🟥 總教練出場！（警告 2/5）',
        sub: mine ? '你本場無法再下達：代打' : '對方本場無法再下達：代打',
      });
    }
    if (feed.coachEjected) {
      queue.push({
        img: '/eject.png',
        title: '🟥 副教練也出場！（警告 3/5）',
        sub: mine ? '你本場無法再：換投、代打' : '對方本場無法再：換投、代打',
      });
    }
    if (feed.allOut) {
      queue.push({
        img: '/eject.png',
        title: '🟥 教練團全數驅逐！（警告 4/5）',
        sub: mine
          ? '你本場無法再：換投、代打、盜壘、牽制——並送對方一分！再吃警告直接裁定敗戰！'
          : '對方本場無法再：換投、代打、盜壘、牽制——你們獲判一分！',
      });
    }
    if (feed.forfeited) {
      queue.push({
        img: '/eject.png',
        title: '⚫ 第五次警告——裁定比賽！',
        sub: mine ? '主審裁定比賽結束，對方勝利！' : '主審裁定比賽結束，你們獲勝！',
      });
    }
    if (!queue.length) return;
    let i = 0;
    const playNext = () => {
      if (i >= queue.length) {
        setShow(null);
        return;
      }
      setShow(queue[i]);
      i += 1;
      timerRef.current = setTimeout(playNext, 3000); // 每張強制 3 秒（警告接著再 3 秒）
    };
    playNext();
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.tauntFeed?.seq]);

  if (!g) return null;
  const my = g.myTaunt;
  const playing = g.phase !== 'gameover';

  return (
    <>
      {/* 挑釁按鈕已移至「擊球結果」畫面的下一球下方（見 ResultScreen / TauntButton） */}

      {playing && my?.warnings >= 4 && (
        <div className="fixed bottom-4 left-4 z-40 px-3 py-1.5 rounded-full bg-red-900/70 border border-red-400/50 text-red-200 text-xs font-bold">
          🟥 教練團全數驅逐（禁：換投/代打/盜壘/牽制）・警告 4/5——再犯直接裁定敗戰！
        </div>
      )}
      {playing && my?.warnings === 3 && (
        <div className="fixed bottom-4 left-4 z-40 px-3 py-1.5 rounded-full bg-red-900/70 border border-red-400/50 text-red-200 text-xs font-bold">
          🟥 總教練＋副教練出場（禁：換投/代打）・警告 3/5
        </div>
      )}
      {playing && my?.warnings === 2 && (
        <div className="fixed bottom-4 left-4 z-40 px-3 py-1.5 rounded-full bg-red-900/70 border border-red-400/50 text-red-200 text-xs font-bold">
          🟥 總教練出場（禁：代打）・警告 2/5
        </div>
      )}
      {playing && my?.warnings === 1 && (
        <div className="fixed bottom-4 left-4 z-40 px-3 py-1.5 rounded-full bg-yellow-900/60 border border-yellow-400/40 text-yellow-200 text-xs font-bold">
          🟨 板凳警告 1/5（第二次總教練出場）
        </div>
      )}

      {show && (
        <div className="fixed inset-0 z-[65] bg-black/85 backdrop-blur-sm flex items-center justify-center px-4 pointer-events-none">
          <div className="max-w-md w-full rounded-2xl border-4 border-field-floodlight/60 bg-field-night/95 overflow-hidden shadow-2xl">
            <div className="bg-field-floodlight/15 px-4 py-2 text-center text-xs tracking-[0.3em] text-field-floodlight font-bold">
              ── 球場大屏幕 ──
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={show.img} alt={show.title} className="w-full block" draggable={false} />
            <div className="p-4 text-center">
              <div className="font-display text-xl font-bold">{show.title}</div>
              {show.sub && <div className="text-xs text-field-chalk/55 mt-1">{show.sub}</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- 彩蛋：投降輸一半／氣不夠了平局 ----------------
 * 隱藏指令（連點三下觸發）：
 *   投降：「直球」（投手）或「打擊」（打者）——接受＝發起方認輸
 *   平局：「指叉球」（投手）或「強力打擊」（打者）——接受＝握手言和
 * 發起後對方的大屏幕會播出對應經典畫面並選擇是否接受。
 */
const REJECT_IMG = '/notthateasy.png'; // 拒絕平手 → 三秒橫幅（draw 用）
const SURRENDER_REJECT_IMG = '/reject4.png'; // 拒絕投降 → 三秒橫幅（Image 4）
const RECONCILE_IMG = '/reconcile.png'; // 投降被接受＝和好 → 結算畫面（Image 3）
const BETRAY_IMG = '/betray.png'; // 變速球三連點 → 三秒橫幅

const EGGS = {
  surrender: {
    img: '/surrender2.png',
    icon: '🏳️',
    askTitle: '要向對方提出「投降輸一半」嗎？',
    askDesc: '對方接受＝這局算平手、握手言和，之後可以重開一局再打。',
    yesBtn: '舉白旗！投降輸一半～',
    bigTitle: '🏳️ 對方舉白旗：投降輸一半！',
    bigDesc: '接受＝這局算平手、握手言和，然後重開一局再打吧；不接受＝把白旗丟回去繼續打。',
    acceptBtn: '好啦～投降輸一半，重開一局！',
    declineBtn: '不接受，打完！',
  },
  draw: {
    img: '/draw.png',
    icon: '🤝',
    askTitle: '氣不夠了……要向對方提出「平局」嗎？',
    askDesc: '對方的大屏幕會播出你的求和請求；對方接受＝雙方握手言和、平局收場。',
    yesBtn: '氣不夠了……求和！',
    bigTitle: '🤝 對方喘著大氣：氣不夠了，是否平局？',
    bigDesc: '接受＝雙方握手言和、比賽以平局結束；不接受＝繼續打到分出勝負。',
    acceptBtn: '平局！就平局！',
    declineBtn: '氣不夠了？繼續打！',
  },
};
function useTripleTap(onTrigger) {
  const ref = useRef({ n: 0, t: 0 });
  return () => {
    const now = Date.now();
    if (now - ref.current.t > 1200) ref.current.n = 0;
    ref.current.n += 1;
    ref.current.t = now;
    if (ref.current.n >= 3) {
      ref.current.n = 0;
      onTrigger();
    }
  };
}

function SurrenderConfirm({ kind = 'surrender', onYes, onNo, busy }) {
  const egg = EGGS[kind];
  return (
    <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center px-6">
      <div className="max-w-sm w-full rounded-2xl border-2 border-field-floodlight/40 bg-field-night/95 p-6 text-center shadow-2xl">
        <div className="text-3xl mb-2">{egg.icon}</div>
        <div className="font-display text-xl font-bold mb-1">觸發隱藏指令</div>
        <div className="text-sm text-field-chalk/70 mb-5 leading-relaxed">
          {egg.askTitle}
          <br />
          {egg.askDesc}
        </div>
        <div className="flex gap-2 justify-center">
          <button disabled={busy} onClick={onYes} className="px-5 py-2 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30">
            {egg.yesBtn}
          </button>
          <button onClick={onNo} className="px-5 py-2 rounded-lg border border-field-chalk/30 text-field-chalk/80">
            當作沒按過
          </button>
        </div>
      </div>
    </div>
  );
}

function SurrenderBigScreen({ kind = 'surrender', send, busy }) {
  const egg = EGGS[kind];
  return (
    <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border-4 border-field-floodlight/60 bg-field-night/95 overflow-hidden shadow-2xl">
        <div className="bg-field-floodlight/15 px-4 py-2 text-center text-xs tracking-[0.3em] text-field-floodlight font-bold">
          ── 球場大屏幕 ──
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={egg.img} alt={egg.bigTitle} className="w-full block" draggable={false} />
        <div className="p-5 text-center">
          <div className="font-display text-xl font-bold mb-1">{egg.bigTitle}</div>
          <div className="text-xs text-field-chalk/55 mb-4">{egg.bigDesc}</div>
          <div className="flex gap-2 justify-center">
            <button
              disabled={busy}
              onClick={() => send('surrender_respond', { accept: true })}
              className="px-5 py-2 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
            >
              {egg.acceptBtn}
            </button>
            <button
              disabled={busy}
              onClick={() => send('surrender_respond', { accept: false })}
              className="px-5 py-2 rounded-lg border border-red-400/50 text-red-300 font-bold disabled:opacity-30"
            >
              {egg.declineBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 揮棒時機小遊戲 ----------------
 * 打者確認出棒後彈出：光標在時機條上來回擺動（對方投手球威越高越快），
 * 在中央甜蜜點按下「揮棒」拿高分。分數 0~100 送回伺服器放大/縮小打擊結果權重。
 * 3.2 秒內沒出手＝完全沒跟上（低分自動送出）。
 */
/* ---------------- 出手時機（四區域制・隨體力縮放） ----------------
 * 投手確認配球後彈出：光標在時機條上來回擺動（球威越高越快），按下「出手」定格。
 * 四區域寬度隨投手體力動態縮放（公式與伺服器 releaseWindows 完全一致）：
 *   體力滿檔：★完美 |d|≤7、○不錯 |d|≤21、△勉強 |d|≤36、其餘＝✕走鐘
 *   體力下滑：完美區越縮越小、被不錯/勉強區取代；
 *   低於 80%：走鐘區開始擴大；低於 60%：走鐘區顯著遞增、完美區顯著遞減
 *   ✕走鐘（含超時）：失投——變成超慢的紅中小便球
 */
function SwingTimingGame({ stuff = 50, stamina = 100, grade = 'B', actionLabel = '出手！', onDone }) {
  const [pos, setPos] = useState(50);
  const [result, setResult] = useState(null); // { score, label, tone }
  const doneRef = useRef(false);
  const posRef = useRef(50);
  // 擺動週期：球威 50 → 900ms／趟；球威 90 → 660ms；封頂 480~1100ms
  const periodRef = useRef(Math.max(480, Math.min(1100, 900 - (stuff - 50) * 6)));
  // 隨機起始相位，避免背節奏
  const startRef = useRef(performance.now() - Math.random() * periodRef.current * 2);
  // 四區域半寬（時機條半邊 0~50）：由「球種等級 × 體力」決定，跟伺服器判定用同一個公式
  const win = releaseWindows(stamina, grade);

  const finish = useCallback((score) => {
    if (doneRef.current) return;
    doneRef.current = true;
    let label, tone;
    if (score >= 100 - 2 * win.perfect) { label = '★完美！指哪投哪'; tone = 'text-field-floodlight'; }
    else if (score >= 100 - 2 * win.good) { label = '○不錯！微偏'; tone = 'text-emerald-300'; }
    else if (score >= 100 - 2 * win.poor) { label = '△勉強……會偏不少'; tone = 'text-yellow-300'; }
    else { label = '✕走鐘——紅中小便球！'; tone = 'text-red-300'; }
    setResult({ score, label, tone });
    setTimeout(() => onDone(score), 700);
  }, [onDone, win.perfect, win.good, win.poor]);

  useEffect(() => {
    let raf;
    const period = periodRef.current;
    const loop = (now) => {
      if (doneRef.current) return;
      if (now - startRef.current > 3200) {
        finish(8); // 站著沒出手＝走鐘（小便球）
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
    finish(Math.max(0, Math.round(100 - Math.abs(p - 50) * 2)));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center px-6 select-none">
      <div className="text-field-chalk/70 text-sm mb-1">出手時機——決定這球去哪！</div>
      <div className="text-[11px] text-field-chalk/40 mb-1 text-center max-w-[340px]">
        ★完美＝落點準・球速最快・位移最兇｜○不錯＝次佳｜△勉強＝大偏・球慢位移平｜✕走鐘＝超慢紅中小便球
      </div>
      <div className={`text-[11px] mb-1 text-center font-bold ${grade === 'S' ? 'text-field-floodlight' : grade === 'C' ? 'text-red-300' : 'text-field-chalk/55'}`}>
        {grade === 'S'
          ? '🅂 拿手球路——四區完全均等，閉著眼投都穩'
          : grade === 'A'
            ? '🄰 拿手球路——完美區偏大'
            : grade === 'B'
              ? '🄱 普通球路——標準四區'
              : '🄲 陌生球路——完美區很窄、走鐘區很大！'}
      </div>
      {stamina < 100 && (
        <div className={`text-[11px] mb-4 text-center font-bold ${stamina < 60 ? 'text-red-300' : stamina < 80 ? 'text-yellow-300' : 'text-field-chalk/55'}`}>
          {stamina < 60
            ? `🥵 體力 ${stamina}%——手臂快抬不起來了，完美區極小、走鐘區大開！`
            : stamina < 80
              ? `😮‍💨 體力 ${stamina}%——完美區縮小中，走鐘區開始擴大`
              : `體力 ${stamina}%——完美區已略為縮小`}
        </div>
      )}
      {stamina >= 100 && <div className="mb-4" />}

      {/* 時機條：四區域（走鐘/勉強/不錯/★完美/不錯/勉強/走鐘），寬度隨體力縮放 */}
      <div className="relative w-full max-w-sm h-12 rounded-xl bg-black/70 border border-field-chalk/25 overflow-hidden">
        <div className="absolute inset-0 flex">
          <div className="bg-red-900/65" style={{ width: `${50 - win.poor}%` }} />
          <div className="bg-yellow-700/50" style={{ width: `${win.poor - win.good}%` }} />
          <div className="bg-emerald-700/55" style={{ width: `${win.good - win.perfect}%` }} />
          <div className="bg-field-floodlight/45" style={{ width: `${win.perfect * 2}%` }} />
          <div className="bg-emerald-700/55" style={{ width: `${win.good - win.perfect}%` }} />
          <div className="bg-yellow-700/50" style={{ width: `${win.poor - win.good}%` }} />
          <div className="bg-red-900/65" style={{ width: `${50 - win.poor}%` }} />
        </div>
        {/* 完美區中線 */}
        <div className="absolute top-0 bottom-0 left-1/2 w-[2px] -translate-x-1/2 bg-white/90" />
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
      '出手時機四區域：★完美＝指哪投哪、○不錯＝微偏（邊角可能滑出帶外）、△勉強＝大偏、✕走鐘＝超慢的紅中小便球。壘上有人時可牽制——若對方剛好下了盜壘暗號，大概率直接抓死。',
    ],
    batter: [
      '按住畫面＝手握棒尾持棒（拖曳點在握把），棒頭的球標＝甜蜜點；放開的一瞬間＝揮棒，時機與位置都對才算咬中。',
      '直球一閃而逝、時機窗最窄；滑球中段外竄、曲球大弧線好認；指叉/變速前段完全像直球、末段才下墜——盯到最後再出手。',
      '切到球的上緣偏滾地、下緣偏飛球。強力打擊咬中就是大的但更難；壞球區的球別追。',
    ],
    result: [
      '結果畫面會揭曉雙方決策。看懂這一球，下一球才有反制空間。',
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
  const [cor, setCor] = useState(1.0); // 彈力係數：0.5 死球～1.5 彈力球，1.0 標準
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
        body: JSON.stringify({ innings, teamId, extraMode, cor }),
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
          <div className="text-sm mb-2 mt-4 text-field-chalk/70">
            彈力係數 <span className="font-mono-tc text-field-floodlight font-bold">{cor.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.1"
            value={cor}
            onChange={(e) => setCor(Number(e.target.value))}
            className="w-full accent-field-floodlight"
          />
          <div className="flex justify-between text-[10px] text-field-chalk/40 mt-0.5">
            <span>0.5 死球（投手戰）</span>
            <span>1.0 標準</span>
            <span>1.5 彈力球（打擊戰）</span>
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
  const [askEgg, setAskEgg] = useState(null); // null | 'surrender' | 'draw'
  const tapSurrender = useTripleTap(() => setAskEgg('surrender'));
  const tapDraw = useTripleTap(() => setAskEgg('draw'));
  const [betrayShow, setBetrayShow] = useState(false);
  const tapBetray = useTripleTap(() => {
    setBetrayShow(true);
    setTimeout(() => setBetrayShow(false), 3000);
  });
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

      {askEgg && (
        <SurrenderConfirm
          kind={askEgg}
          busy={busy}
          onYes={() => { const k = askEgg; setAskEgg(null); send('surrender_offer', { kind: k }); }}
          onNo={() => setAskEgg(null)}
        />
      )}
      {betrayShow && <MemeFlash img={BETRAY_IMG} title="😡 你這混蛋，你敢陰我！" />}

      <div className="mt-4 flex justify-center">
        <button
          onClick={() => setShowBullpen(!showBullpen)}
          disabled={remainingArms <= 0 || (g.myTaunt?.warnings || 0) >= 3}
          title={(g.myTaunt?.warnings || 0) >= 3 ? '副教練已出場，無法換投' : undefined}
          className="text-xs border border-field-chalk/25 rounded-full px-3 py-1 disabled:opacity-30"
        >
          {(g.myTaunt?.warnings || 0) >= 3 ? '🟥 副教練出場——無法換投' : `換投（牛棚尚有 ${remainingArms} 人可用）`}
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
        <PitchTypeRow
          selected={typeId}
          onSelect={(id) => {
            setTypeId(id);
            if (id === 'fastball') tapSurrender(); // 彩蛋：連點三下直球＝投降
            if (id === 'fork') tapDraw(); // 彩蛋：連點三下指叉球＝求平局
            if (id === 'change') tapBetray(); // 彩蛋：連點三下變速球＝你這混蛋你敢陰我
          }}
          pitcher={pitcher}
        />
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
              className={`px-3 py-1.5 rounded-full text-sm border disabled:opacity-30 ${shift === sh.id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
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
        {/* Pitch Out：一鍵直投高外角壞球抓對方偷跑——不必拖落點、不必抓出手時機 */}
        {(g.bases.first || g.bases.second || g.bases.third) && (
          <div className="w-full max-w-[280px] rounded-xl border border-field-chalk/15 bg-black/25 px-3 py-2.5">
            <div className="text-[11px] text-field-chalk/60 mb-1 font-bold">🎯 Pitch Out（對方看不到）</div>
            <div className="text-[10px] text-field-chalk/45 mb-2 leading-relaxed">
              按下立刻投出高外角壞球（免落點、免出手時機），賭對方偷跑——抓盜壘 50%、抓強迫取分 90%；必為壞球
            </div>
            <button
              disabled={busy}
              onClick={() => send('pitcher_submit', { pitchOut: true, shift })}
              className="w-full rounded-lg px-2 py-2 text-xs font-bold border bg-red-500/20 border-red-400/60 text-red-200 hover:ring-2 hover:ring-current disabled:opacity-30"
            >
              ⚡ 直接 Pitch Out！
            </button>
          </div>
        )}

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
            disabled={busy || (g.pickoffsThisPA ?? 0) >= 2 || (g.myTaunt?.warnings || 0) >= 4}
            title={(g.myTaunt?.warnings || 0) >= 4 ? '教練團全數驅逐，無法牽制' : undefined}
            onClick={() => send('pickoff')}
            className="mt-1 px-4 py-1.5 rounded-full text-xs font-bold border border-field-floodlight/60 text-field-floodlight disabled:opacity-30 hover:bg-field-floodlight/10"
          >
            {(g.myTaunt?.warnings || 0) >= 4
              ? '🟥 教練團全數驅逐——無法牽制'
              : `⚡ 牽制${g.bases.second ? '二壘' : '一壘'}跑者（剩 ${Math.max(0, 2 - (g.pickoffsThisPA ?? 0))} 次）`}
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
          stamina={pitcher.stamina}
          grade={grade}
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
  const [askEgg, setAskEgg] = useState(null); // null | 'surrender' | 'draw'
  const tapSurrender = useTripleTap(() => setAskEgg('surrender'));
  const tapDraw = useTripleTap(() => setAskEgg('draw'));
  const [betrayShow, setBetrayShow] = useState(false);
  const tapBetray = useTripleTap(() => {
    setBetrayShow(true);
    setTimeout(() => setBetrayShow(false), 3000);
  });
  const g = view.game;
  const [mode, setMode] = useState('normal');
  const [reacting, setReacting] = useState(false); // 即時反應小遊戲進行中

  const bKey = battingKey(g.half);
  const fKey = fieldingKey(g.half);
  const side = g[bKey];
  const oppSide = g[fKey];
  const oppPitcher = currentPitcher(oppSide);
  const batter = side.lineup[side.lineupIdx % side.lineup.length];
  const forceRight = !!side.forceRight; // [取消左打]：全隊以右打計算
  const effBats = forceRight ? 'R' : batter.bats;
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
            {batsLabel(effBats)}{forceRight && batter.bats !== 'R' && <span className="text-field-floodlight/80">（已改右打）</span>}<br />
            力 {batter.power}／準 {batter.contact}／眼 {batter.eye}／速 {batter.speed}
          </div>
          <button
            onClick={() => setShowBench(!showBench)}
            disabled={availableBench.length === 0 || (g.myTaunt?.warnings || 0) >= 2}
            title={(g.myTaunt?.warnings || 0) >= 2 ? '總教練已出場，無法代打' : undefined}
            className="mt-1.5 text-[11px] border border-field-chalk/25 rounded-full px-2.5 py-0.5 disabled:opacity-30"
          >
            代打（剩 {availableBench.length}）
          </button>
          <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-field-chalk/70 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={forceRight}
              disabled={busy}
              onChange={(e) => send('force_right', { on: e.target.checked })}
              className="accent-field-floodlight"
            />
            取消左打（全改右打）
          </label>
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
      {g.pendingSqueeze && (
        <div className="mt-2 text-center text-xs text-field-floodlight font-bold animate-pulse">
          🏃 三壘跑者已下強迫取分暗號——出手瞬間衝本壘！打者必須把球擊出去，否則跑者被抓死
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
          {BATTER_MODES.map((m) => {
            const noRunner = !g.bases.first && !g.bases.second && !g.bases.third;
            const squeezeOn = !!g.pendingSqueeze;
            const disabled = (m.id === 'bunt' && noRunner) || (m.id === 'power' && squeezeOn); // 無跑者不可觸擊；強迫取分不可強力打擊
            return (
              <button
                key={m.id}
                disabled={disabled}
                title={
                  m.id === 'bunt' && noRunner ? '沒人在壘不可觸擊'
                  : m.id === 'power' && squeezeOn ? '強迫取分不可搭配強力打擊（本意是犧牲，強力打擊風險過高）'
                  : undefined
                }
                onClick={() => {
                  setMode(m.id);
                  if (m.id === 'normal') tapSurrender(); // 彩蛋：連點三下打擊＝投降
                  if (m.id === 'power') tapDraw(); // 彩蛋：連點三下強力打擊＝求平局
                }}
                className={`rounded-lg border px-3 py-2 text-left disabled:opacity-30 disabled:cursor-not-allowed ${
                  mode === m.id ? 'bg-field-floodlight text-field-night border-field-floodlight' : 'border-field-chalk/25'
                }`}
              >
                <div className={`text-sm font-bold ${mode === m.id ? '' : 'text-field-chalk/90'}`}>
                  {m.name}
                  {disabled && <span className="text-[10px] font-normal text-red-300 ml-1">（無跑者）</span>}
                </div>
                <div className={`text-[10px] leading-snug mt-0.5 ${mode === m.id ? 'text-field-night/70' : 'text-field-chalk/45'}`}>{m.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-1.5">
        <button
          disabled={busy}
          onClick={() => {
            if (mode === 'take') {
              if (g.pendingSqueeze && !window.confirm('已下強迫取分暗號——選擇「不打擊」跑者一定被抓死本壘！確定要目送這一球？')) return;
              submit({ batX: null, batY: null, swingDelta: null });
            }
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

      {askEgg && (
        <SurrenderConfirm
          kind={askEgg}
          busy={busy}
          onYes={() => { const k = askEgg; setAskEgg(null); send('surrender_offer', { kind: k }); }}
          onNo={() => setAskEgg(null)}
        />
      )}
      {betrayShow && <MemeFlash img={BETRAY_IMG} title="😡 你這混蛋，你敢陰我！" />}

      {reacting && path && (
        <BatAimGame
          path={path}
          mode={mode}
          bats={effBats}
          pitcherThrows={oppPitcher.throws}
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
                  disabled={busy || (g.myTaunt?.warnings || 0) >= 4}
                  title={(g.myTaunt?.warnings || 0) >= 4 ? '教練團全數驅逐，無法下盜壘暗號' : undefined}
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

      {/* 強迫取分暗號：三壘有人 + <2 出局 才顯示 */}
      {g.bases.third && g.outs < 2 && !g.pendingSteal && (
        <div className="mt-4 rounded-xl bg-black/30 border border-red-400/25 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-red-200">🏃 強迫取分（squeeze play・對方看不到）</div>
            {g.pendingSqueeze && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/25 text-red-200 border border-red-400/50 animate-pulse">
                已下達
              </span>
            )}
          </div>
          <div className="mt-2 text-[11px] text-field-chalk/50 leading-relaxed">
            出手瞬間三壘跑者衝本壘。<span className="text-red-300 font-bold">打者必須把球擊出去（界內即可得分）</span>；揮空或沒揮＝跑者本壘刺殺出局；界外＝跑者退回。⚠️ 對方 Pitch Out 破解率 90%
          </div>
          <button
            disabled={busy || (g.myTaunt?.warnings || 0) >= 4}
            title={(g.myTaunt?.warnings || 0) >= 4 ? '教練團全數驅逐，無法下強迫取分' : undefined}
            onClick={() => send('declare_squeeze', g.pendingSqueeze ? { cancel: true } : {})}
            className={`mt-3 w-full rounded-lg px-3 py-2.5 text-left border transition ${
              g.pendingSqueeze
                ? 'bg-red-500 text-white border-red-400 font-bold'
                : 'bg-field-grass2/60 border-field-chalk/15 text-field-chalk/85 hover:bg-field-grass2'
            }`}
          >
            <div className="text-sm">{g.pendingSqueeze ? '✅ 已下強迫取分（點一下取消）' : '下達強迫取分暗號'}</div>
          </button>
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
  const ZONE_TXT = { perfect: '・出手★完美', good: '・出手○不錯', poor: '・出手△勉強', worst: '・出手✕走鐘（小便球）' };
  const rel = choice.releaseZone
    ? ZONE_TXT[choice.releaseZone] || ''
    : choice.release != null
      ? choice.release < 28 ? '・出手✕走鐘' : choice.release >= 86 ? '・出手★完美' : ''
    : '';
  return `${gradeTxt}${type}・${zone}${rel}`;
}

function squeezePitchOutText(r) {
  const bits = [];
  if (r.pitcherChoice?.pitchOut) bits.push(`🎯 Pitch Out（${r.pitcherChoice.pitchOut.height === 'high' ? '高外角' : '低外角'}）`);
  if (r.batterChoice?.squeeze) bits.push('🏃 強迫取分');
  return bits.length ? bits.join('・') : null;
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
        ['戰術暗號', squeezePitchOutText(result) || '（無）'],
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
        {JSON.stringify({ pitcher: r.pitcherChoice, batter: r.batterChoice, result: r.summary, runs: r.runs }, null, 2)}
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
  }, [r.summary]);

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
          {/* 挑釁：只能在結果畫面按，雙方大屏幕都會強制播 3 秒（每 5 次保證恰好 1 次裁判警告） */}
          {g.phase === 'result' && (
            <button
              disabled={busy}
              onClick={() => send('taunt')}
              title="挑釁對方（每 5 次保證恰好 1 次裁判警告：2 次禁代打、3 次禁換投、4 次禁盜壘牽制＋送一分、5 次裁定敗戰）"
              className="mt-1 px-6 py-2 rounded-lg text-sm font-bold border-2 border-red-400/70 bg-red-500/15 text-red-200 hover:bg-red-500/30 hover:border-red-300 disabled:opacity-40 shadow-[0_0_14px_rgba(239,68,68,0.25)]"
            >
              😤 挑釁對方板凳！
            </button>
          )}
        </div>
      )}

      <GameLog log={g.log} />
    </div>
  );
}

/* 結束畫面梗圖輪播（Image 5/6/7）：每次進入結算輪流換一張 */
const END_IMGS = [
  { src: '/end1.png', cap: '香檳開了——這場穩了！' },
  { src: '/end2.png', cap: '現在幾比幾？' },
  { src: '/end3.png', cap: '為什麼我的命運會這麼的悲慘…' },
];
let __endImgCounter = 0;

function GameOverScreen({ view, onLeave, send, busy }) {
  const g = view.game;
  // 投降被接受＝和好平手：改放 Image 3；否則走結束圖輪播
  const surrenderReconcile = g.surrender?.status === 'accepted' && g.surrender.kind === 'surrender';
  const endImg = useMemo(() => END_IMGS[(__endImgCounter++) % END_IMGS.length], []);
  const mvp = g.mvp;

  return (
    <div className="max-w-xl mx-auto px-6 py-16 text-center">
      <div className="font-display text-3xl font-black mb-2">{surrenderReconcile ? '握手言和' : '比賽結束'}</div>
      <div className="text-field-chalk/50 text-sm mb-4">{g.endReason}</div>

      {surrenderReconcile ? (
        <div className="max-w-sm mx-auto mb-6 rounded-xl overflow-hidden border-2 border-field-floodlight/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={RECONCILE_IMG} alt="握手言和" className="w-full block" draggable={false} />
          <div className="bg-black/40 text-center text-xs text-field-chalk/60 py-1.5">「投降輸一半——這局平手，重開一局再打吧！」</div>
        </div>
      ) : (
        <div className="max-w-sm mx-auto mb-6 rounded-xl overflow-hidden border-2 border-field-chalk/25">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={endImg.src} alt={endImg.cap} className="w-full block" draggable={false} />
          <div className="bg-black/40 text-center text-xs text-field-chalk/60 py-1.5">「{endImg.cap}」</div>
        </div>
      )}

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
      <div className="text-lg font-bold mb-6">{g.winner ? `🏆 ${g.winner} 獲勝！` : '平手！'}</div>

      {/* 賽後 MVP 圖卡（照片：傑立鼠） */}
      <MvpCard mvp={mvp} />

      <BoxScore g={g} />

      <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          disabled={busy}
          onClick={() => send('rematch')}
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-40"
        >
          🔄 重新開始
        </button>
        <button onClick={onLeave} className="px-8 py-2.5 rounded-lg border border-field-chalk/30 text-field-chalk/80">
          回到大廳
        </button>
      </div>
      <div className="text-[10px] text-field-chalk/35 mt-2">「重新開始」＝沿用同房號、同兩隊、同設定重開一局</div>
    </div>
  );
}

/* 賽後 MVP 圖卡：照片放傑立鼠，配上本場最佳貢獻打者 */
function MvpCard({ mvp }) {
  return (
    <div className="max-w-sm mx-auto mb-7 rounded-2xl overflow-hidden border-2 border-yellow-400/60 bg-gradient-to-b from-yellow-500/10 to-black/40 shadow-[0_0_22px_rgba(250,204,21,0.25)]">
      <div className="bg-yellow-400/20 py-1.5 text-xs font-bold tracking-[0.35em] text-yellow-200">★ 本 場 M V P ★</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mvp.png" alt="本場 MVP" className="w-32 h-32 object-cover rounded-full mx-auto mt-4 border-4 border-yellow-400/70" draggable={false} />
      {mvp ? (
        <div className="px-5 py-4">
          <div className="font-display text-xl font-black" style={{ color: mvp.teamColor }}>{mvp.name}</div>
          <div className="text-[11px] text-field-chalk/55 mt-0.5">{mvp.teamShort}</div>
          <div className="text-sm text-field-chalk/80 mt-2">
            {mvp.hits} 安打{mvp.hr > 0 ? `・${mvp.hr} 轟` : ''}・{mvp.rbi} 打點
          </div>
        </div>
      ) : (
        <div className="px-5 py-4">
          <div className="font-display text-lg font-black text-field-chalk/80">投手戰・從缺</div>
          <div className="text-[11px] text-field-chalk/50 mt-1">這場沒人打出關鍵一擊，MVP 由傑立鼠自己收下了</div>
        </div>
      )}
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
  const [rejectFlash, setRejectFlash] = useState(null); // 對方拒絕投降/平手時的三秒橫幅
  const actionErrTimer = useRef(null);
  const rejectTimer = useRef(null);
  const lastSurrenderRef = useRef(null); // 追蹤前一個 surrender 狀態，抓「pending → null」＝拒絕
  const pollRef = useRef(null);

  // 拒絕偵測：pending 狀態消失、比賽未終局＝對方拒絕了
  useEffect(() => {
    const cur = view?.game?.surrender;
    const prev = lastSurrenderRef.current;
    if (prev?.status === 'pending' && !cur && view?.game?.phase !== 'gameover') {
      const isDraw = prev.kind === 'draw';
      const kind = isDraw ? '平手' : '投降';
      setRejectFlash({
        title: `😤 對方拒絕${kind}`,
        sub: isDraw ? '「氣不夠了？繼續打！」' : '「想投降？把比賽打完！」',
        img: isDraw ? REJECT_IMG : SURRENDER_REJECT_IMG,
      });
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
      rejectTimer.current = setTimeout(() => setRejectFlash(null), 3000);
    }
    lastSurrenderRef.current = cur || null;
  }, [view?.game?.surrender, view?.game?.phase]);


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
        SURRENDER_PENDING: '投降請求已在進行中',
        EJECTED: '總教練已被驅逐，無法下達這個戰術',
        BUNT_NO_RUNNER: '沒人在壘不可觸擊',
        NO_THIRD: '三壘沒有跑者，不能下強迫取分',
        TWO_OUTS: '兩人出局下強迫取分無意義（跑者出局＝第三出局）',
        CONFLICT_STEAL: '已下盜壘暗號，不能再下強迫取分',
        CONFLICT_SQUEEZE: '已下強迫取分暗號，不能再下盜壘',
        NO_SURRENDER: '目前沒有待回應的投降請求',
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
      screen = <GameOverScreen view={view} onLeave={leave} send={send} busy={busy} />;
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
      {/* 挑釁系統：懸浮按鈕＋大屏幕輪播（gameover 仍掛載，讓「裁定敗戰」畫面播得出來；按鈕自行隱藏） */}
      {view?.game && session && (
        <TauntSystem view={view} send={send} busy={busy} />
      )}

      {/* 彩蛋：投降輸一半——待回應時對方看大屏幕、發起方看等待橫幅 */}
      {view?.game?.surrender?.status === 'pending' && view.game.phase !== 'gameover' && (
        view.game.surrender.by === view.role ? (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/80 border border-field-floodlight/40 text-field-floodlight text-sm font-bold animate-pulse">
            {view.game.surrender.kind === 'draw' ? '🤝 求和請求已送上大屏幕，等待對方回應…' : '🏳️ 投降請求已送上大屏幕，等待對方回應…'}
          </div>
        ) : (
          <SurrenderBigScreen kind={view.game.surrender.kind || 'surrender'} send={send} busy={busy} />
        )
      )}

      {rejectFlash && <MemeFlash img={rejectFlash.img || REJECT_IMG} title={rejectFlash.title} sub={rejectFlash.sub} />}

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
