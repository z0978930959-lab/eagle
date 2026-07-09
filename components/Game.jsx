'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TEAMS, PITCH_TYPES, SHIFTS, QUADS, ROLE_NAMES, zoneId, zoneLabel, batsLabel, throwsLabel, isCellsContiguous } from '../data/teams';
import { PITCH_TYPE_MAP } from '../lib/engine';
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

// 好球帶 3x3 選取。支援多選（最多 maxCells 格，且需邊相連）：
//  - selected: 可以是單一 cell id 字串，也可以是陣列（多選）
//  - onSelect(next): next 為陣列。點擊已選格＝取消；點擊新格＝加入；破壞相連或超過上限則不加入
function ZoneGrid({ selected, onSelect, maxCells = 3, single = false }) {
  const selectedArr = Array.isArray(selected) ? selected : selected ? [selected] : [];
  const selSet = new Set(selectedArr);
  const handleClick = (key) => {
    if (single) {
      // 單選模式（投手選落點）：回傳「字串」而非陣列，點新格直接取代、點同格取消
      onSelect(selected === key ? null : key);
      return;
    }
    if (selSet.has(key)) {
      // 取消：移除後仍要保持相連（單獨移除若讓其他格斷開就拒絕）
      const next = selectedArr.filter((k) => k !== key);
      if (isCellsContiguous(next)) onSelect(next);
      return;
    }
    if (selectedArr.length >= maxCells) return; // 已滿
    const next = [...selectedArr, key];
    if (!isCellsContiguous(next)) return; // 會斷開就不加
    onSelect(next);
  };
  return (
    <div className="w-full max-w-[260px] mx-auto">
      <div className="grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => {
            const key = zoneId(r, c);
            const isHeart = r === 1 && c === 1;
            const isSel = selSet.has(key);
            const canAdd = single || (!isSel && selectedArr.length < maxCells && isCellsContiguous([...selectedArr, key]));
            const disabledLook = !isSel && !canAdd;
            return (
              <button
                key={key}
                onClick={() => handleClick(key)}
                className={`aspect-square rounded-md text-[11px] font-mono-tc flex items-center justify-center border transition
                  ${isSel ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : disabledLook ? 'bg-field-grass2/30 border-field-chalk/10 text-field-chalk/30 cursor-not-allowed' : 'bg-field-grass2/70 border-field-chalk/15 text-field-chalk/80 hover:bg-field-grass2'}
                  ${isHeart && !isSel ? 'ring-1 ring-field-floodlight/50' : ''}
                `}
              >
                {zoneLabel(r, c)}
              </button>
            );
          })
        )}
      </div>
      <div className="text-[10px] text-field-chalk/45 text-center mt-1.5">
        {single ? '點選目標落點（再點一次取消）' : `已選 ${selectedArr.length}/${maxCells} 格・需邊相連（可再點取消）`}
      </div>
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

// 投手體力血條：綠 > 黃 > 紅
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

function QuadGrid({ selected, onSelect }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 w-full max-w-[220px] mx-auto">
      {QUADS.map((q) => (
        <button
          key={q.id}
          onClick={() => onSelect(q.id)}
          className={`aspect-[2/1] rounded-md text-sm flex items-center justify-center border transition
            ${selected === q.id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'bg-field-grass2/70 border-field-chalk/15 text-field-chalk/80 hover:bg-field-grass2'}
          `}
        >
          {q.name}
        </button>
      ))}
    </div>
  );
}

function Countdown({ deadline, serverNow }) {
  const [now, setNow] = useState(() => Date.now());
  const offsetRef = useRef(0);
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
  const urgent = remain <= 5;
  return (
    <div className={`mt-2 mx-auto max-w-[220px] rounded-lg border px-3 py-2 text-center font-mono-tc font-bold transition
      ${urgent ? 'border-red-300/70 bg-red-500/15 text-red-200 animate-pulse' : 'border-field-floodlight/30 bg-black/25 text-field-floodlight'}`}
    >
      <div className="text-[10px] tracking-[0.18em] text-field-chalk/45">COUNTDOWN</div>
      <div className="text-2xl leading-none mt-0.5">{remain}</div>
      <div className={`mt-1 h-1.5 rounded-full bg-black/40 overflow-hidden ${urgent ? 'ring-1 ring-red-300/40' : ''}`}>
        <div
          className={`h-full transition-all duration-300 ${urgent ? 'bg-red-300' : 'bg-field-floodlight'}`}
          style={{ width: `${Math.max(0, Math.min(100, (remain / 15) * 100))}%` }}
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
    pitcher: ['配球不是只拼最強球路。拿手球更穩，但越明顯越容易被鎖定。', '佈陣會被打者看見，等於你先亮一張心理戰線索。'],
    batter: ['鎖定猜球獎勵最高，但猜反會很傷。保護打法適合對付變化球與拉打佈陣。', '方位猜法比較安全；單格猜中才是真正的大獎。', '出棒後會進入「揮棒時機」：猜球決定你讀不讀得懂對手，時機決定你的手上功夫。'],
    result: ['結果畫面會揭曉雙方決策。看懂這一球，下一球才有反制空間。'],
  }[type];
  if (!content) return null;
  return (
    <div className="mt-3 rounded-lg border border-field-floodlight/20 bg-black/25 px-3 py-2 text-[11px] leading-relaxed text-field-chalk/55">
      {content.map((t) => <div key={t}>{t}</div>)}
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
  const [zone, setZone] = useState(null);
  const [shift, setShift] = useState('normal');
  const [showBullpen, setShowBullpen] = useState(false);

  const fKey = fieldingKey(g.half);
  const side = g[fKey];
  const pitcher = currentPitcher(side);
  const remainingArms = side.team.pitchers.length - side.staff.used.length;

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
          {pitcher.fatigue > 0 && <span className="text-red-300/80">（疲勞 -{pitcher.fatigue}）</span>}
          ・已投 {pitcher.pitchCount} 球
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
        <div className="text-sm mb-2 text-field-chalk/70 text-center">球種（★ 擅長）</div>
        <PitchTypeRow selected={typeId} onSelect={setTypeId} favIds={pitcher.fav} />
      </div>

      <div className="mt-5">
        <div className="text-sm mb-2 text-field-chalk/70 text-center">目標落點</div>
        <ZoneGrid selected={zone} onSelect={setZone} single />
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
            牽制會重置你的配球倒數；有機率直接抓到離壘過大的跑者、也可能暴傳讓跑者推進（越疲勞越容易失誤，最高 20%）。跑者回壘後這一球更難盜壘成功
          </div>
        )}
      </div>

      <GameLog log={g.log} />
    </div>
  );
}

/* ---------------- 打者回合 ---------------- */

function BatterScreen({ view, send, busy }) {
  const g = view.game;
  const [mode, setMode] = useState('lock');
  const [guessCat, setGuessCat] = useState('fastball'); // 'fastball' | 'breaking'
  const [guessSpecies, setGuessSpecies] = useState(null); // 變化球種類（null＝不指定）
  const [zoneKind, setZoneKind] = useState('cell'); // 'cell' 好球帶多選（1~3 格相連） | 'quad' 預設方位
  const [guessCells, setGuessCells] = useState([]); // cell 模式：1~3 個相連格
  const [guessQuad, setGuessQuad] = useState(null); // quad 模式：單一方位
  const [steal, setSteal] = useState(null);
  const [showBench, setShowBench] = useState(false);
  const [timingPayload, setTimingPayload] = useState(null); // 非 null＝時機小遊戲進行中，暫存待送 payload

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

  const zoneReady = zoneKind === 'quad' ? !!guessQuad : guessCells.length >= 1;
  const canConfirm = mode !== 'lock' || zoneReady;

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <div className="text-center mb-4">
        <div className="text-xs text-field-chalk/50">你是進攻方・對方已投出，換你反應</div>
        <div className="font-display text-xl font-bold" style={{ color: side.team.color }}>
          {side.team.name}｜第 {(side.lineupIdx % side.lineup.length) + 1} 棒 {batter.name}
          <ForeignTag show={batter.foreign} />
        </div>
        <div className="text-[11px] text-field-chalk/40 mt-0.5">
          {batsLabel(batter.bats)} ・力量 {batter.power} ・準度 {batter.contact} ・選球眼 {batter.eye} ・速度 {batter.speed}
        </div>
        <Countdown deadline={g.deadline} serverNow={g.serverNow} />
        <div className="text-[10px] text-field-chalk/35">時間到未選擇＝自動不揮棒</div>
      </div>
      <Scoreboard g={g} />
      <InfoTip type="batter" />

      <div className="mt-3 text-center text-xs text-field-chalk/55 space-y-0.5">
        <div>
          對方投手：{ROLE_NAMES[oppPitcher.role]} {oppPitcher.name}
          <ForeignTag show={oppPitcher.foreign} />（{throwsLabel(oppPitcher.throws)}・擅長：
          {oppPitcher.fav.map((f) => PITCH_TYPE_MAP[f].name).join('、')}
          {oppPitcher.fatigue > 0 && <span className="text-field-floodlight/80">，已顯疲態</span>}）
        </div>
        <div className="mt-0.5">
          <StaminaBar pct={oppPitcher.stamina} width="w-32" pitchCount={oppPitcher.pitchCount} />
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
          {mode === 'lock' && '猜直球/變化球（可加碼指定種類）＋猜單格或方位；猜得越細，獎勵越高'}
          {mode === 'protect' && '把球碰進場內求上壘，三振率低但長打少；剋拉打佈陣'}
          {mode === 'take' && '完全不揮棒'}
          {mode === 'bunt' && '犧牲觸擊推進跑者，兩好球後觸成界外＝三振'}
          {mode === 'hitrun' && '一壘跑者提前起跑＋打者必須揮棒；破壞雙殺，但揮空跑者幾乎必死'}
        </div>
      </div>

      {mode === 'lock' && (
        <>
          <div className="mt-5">
            <div className="text-sm mb-2 text-field-chalk/70 text-center">猜球路</div>
            <div className="flex gap-2 justify-center">
              {[['fastball', '直球'], ['breaking', '變化球']].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    setGuessCat(id);
                    if (id === 'fastball') setGuessSpecies(null);
                  }}
                  className={`px-4 py-1.5 rounded-full text-sm border ${guessCat === id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
                >
                  {id === 'fastball' && oppPitcher.fav.includes('fastball') && <span className="mr-0.5">★</span>}
                  {label}
                </button>
              ))}
            </div>
            {guessCat === 'breaking' && (
              <div className="mt-2">
                <div className="text-[11px] text-field-chalk/45 text-center mb-1.5">加碼指定種類（猜中獎勵更高，猜錯種類仍算猜中變化球）</div>
                <div className="flex flex-wrap gap-2 justify-center">
                  <button
                    onClick={() => setGuessSpecies(null)}
                    className={`px-3 py-1.5 rounded-full text-sm border ${guessSpecies === null ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
                  >
                    不指定
                  </button>
                  {PITCH_TYPES.filter((p) => p.id !== 'fastball').map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setGuessSpecies(p.id)}
                      className={`px-3 py-1.5 rounded-full text-sm border ${guessSpecies === p.id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
                    >
                      {oppPitcher.fav.includes(p.id) && <span className="mr-0.5">★</span>}
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-5">
            <div className="text-sm mb-2 text-field-chalk/70 text-center">猜位置</div>
            <div className="flex gap-2 justify-center mb-2">
              {[['cell', '好球帶格（1 格精準／2-3 格範圍）'], ['quad', '預設方位（4 選 1）']].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setZoneKind(id)}
                  className={`px-3 py-1.5 rounded-full text-xs border ${zoneKind === id ? 'bg-field-floodlight text-field-night border-field-floodlight font-bold' : 'border-field-chalk/25'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {zoneKind === 'cell' ? (
              <ZoneGrid selected={guessCells} onSelect={setGuessCells} maxCells={3} />
            ) : (
              <QuadGrid selected={guessQuad} onSelect={setGuessQuad} />
            )}
          </div>
        </>
      )}

      {mode !== 'hitrun' && (canStealFirst || canStealSecond) && (
        <div className="mt-5">
          <div className="text-sm mb-2 text-field-chalk/70 text-center">跑者盜壘（球沒被打進場內時發動）</div>
          {(g.heldClose ?? 0) > 0 && (
            <div className="text-[11px] text-red-300/90 text-center mb-2 animate-pulse">
              ⚠️ 跑者剛被牽制回壘 ×{g.heldClose}——這一球盜壘成功率下降 {g.heldClose * 12}%
            </div>
          )}
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
          onClick={() => {
            const payload = {
              mode,
              guessCat: mode === 'lock' ? guessCat : null,
              guessSpecies: mode === 'lock' && guessCat === 'breaking' ? guessSpecies : null,
              guessZoneKind: mode === 'lock' ? zoneKind : 'cell',
              guessZone: mode === 'lock' ? (zoneKind === 'quad' ? guessQuad : guessCells) : null,
              steal: mode === 'hitrun' ? null : steal,
            };
            if (mode === 'take') {
              send('batter_submit', payload); // 不揮棒＝沒有時機可言
            } else {
              setTimingPayload(payload); // 進入揮棒時機小遊戲
            }
          }}
          className="px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
        >
          {mode === 'take' ? '不揮棒' : mode === 'bunt' ? '擺短棒' : '出棒'}
        </button>
        {mode !== 'take' && (
          <div className="ml-3 self-center text-[10px] text-field-chalk/40 max-w-[130px]">
            按下後進入揮棒時機——抓準甜蜜點才有好結果
          </div>
        )}
      </div>

      {timingPayload && (
        <SwingTimingGame
          stuff={oppPitcher.effStuff}
          actionLabel={mode === 'bunt' ? '出棒點放！' : '揮棒！'}
          onDone={(score) => {
            setTimingPayload(null);
            send('batter_submit', { ...timingPayload, timing: score });
          }}
        />
      )}

      <GameLog log={g.log} />
    </div>
  );
}

/* ---------------- 結果 / 等待 / 結束 ---------------- */

function batterGuessText(c) {
  if (!c || c.mode !== 'lock') return '';
  let t = c.guessCat === 'fastball' ? '直球' : '變化球';
  if (c.guessSpecies) t += `（${PITCH_TYPE_MAP[c.guessSpecies]?.name}）`;
  let z = '';
  if (c.guessZone != null) {
    if (c.guessZoneKind === 'quad') {
      z = `方位・${QUADS.find((q) => q.id === c.guessZone)?.name || ''}`;
    } else {
      // cell 模式：兼容單一字串與陣列
      const cells = Array.isArray(c.guessZone) ? c.guessZone : [c.guessZone];
      const labels = cells.map((k) => zoneLabel(...k.split('-').map(Number)));
      z = cells.length === 1 ? labels[0] : `${cells.length} 格・${labels.join('／')}`;
    }
  }
  return `${t}・${z}`;
}

function pitchChoiceText(choice) {
  if (!choice) return '—';
  if (choice.zoneTarget === 'ibb') return '敬遠';
  if (choice.zoneTarget === 'pickoff') return '牽制';
  const type = PITCH_TYPE_MAP[choice.typeId]?.name || choice.typeId || '—';
  const zone = choice.zoneTarget === 'waste'
    ? '故意壞球'
    : choice.zoneTarget
      ? zoneLabel(...choice.zoneTarget.split('-').map(Number))
      : '—';
  return `${type}・${zone}`;
}

function shiftText(g, r) {
  const id = r.pitcherChoice?.shift;
  return SHIFTS.find((s) => s.id === id)?.name || '—';
}

function DecisionReplay({ g, result }) {
  const actual = `${result.pitchTypeName}${result.hung ? '（失投）' : ''}・${result.zoneLabel}`;
  const batter = result.batterChoice?.mode === 'lock'
    ? batterGuessText(result.batterChoice)
    : {
        protect: '保護打法',
        take: '看球',
        bunt: '觸擊短打',
        hitrun: '打帶跑',
        ibb: '敬遠',
        pickoff: '—（牽制事件）',
      }[result.batterChoice?.mode] || '—';
  const steal = result.batterChoice?.steal
    ? result.batterChoice.steal === 'first' ? '一壘跑者啟動' : '二壘跑者啟動'
    : '無';

  return (
    <div className="mt-4 grid grid-cols-1 gap-2 text-left max-w-md mx-auto">
      {[
        ['投手決策', pitchChoiceText(result.pitcherChoice)],
        ['守備佈陣', shiftText(g, result)],
        ['打者反應', batter],
        ...(result.batterChoice?.timing != null
          ? [['揮棒時機', `${result.batterChoice.timingLabel}（${result.batterChoice.timing} 分）`]]
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
            {r.batterChoice?.mode === 'lock' && (
              <div className="mt-3 text-xs text-field-chalk/45">打者鎖定：{batterGuessText(r.batterChoice)}</div>
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
        NOT_CHALLENGEABLE: '這球無法挑戰',
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
    } else {
      const waitWhat = g.phase === 'pitcher' ? '對方投手正在配球…' : '對方打者正在反應…';
      screen = (
        <div className="max-w-xl mx-auto px-5 py-8">
          <Scoreboard g={g} />
          <Countdown deadline={g.deadline} serverNow={g.serverNow} />
          <WaitingCard title={waitWhat} sub="猜猜他會怎麼出招（對方超時會被自動處理）" />
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
