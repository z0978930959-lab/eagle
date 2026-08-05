'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Chat from './Chat';
import SeriesBar, { MatchPointMeme } from './SeriesBar';

/* ------------------------------------------------------------------
 * 五子棋．雙人對戰前端
 *
 * 棋子圖：/gomoku/black.png、/gomoku/white.png
 *   （想換成別的黑白子，直接覆蓋這兩個檔案即可，程式不用動）
 * 友善模式提示圖：/gomoku/alert.png
 * 貼圖：/gomoku/stickers/taunt_1.png、taunt_2.png（尺寸與 17 撲克一致 w-56）
 *
 * 規則面板固定放在棋盤旁邊（手機版落到棋盤下方），內容與後端擋禁手的邏輯一致。
 * ------------------------------------------------------------------ */

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || '連線失敗');
    err.code = data.error;
    err.view = data.view;
    throw err;
  }
  return data;
}
const ss = {
  save: (c, t) => { try { sessionStorage.setItem('gomoku_session', JSON.stringify({ code: c, token: t })); } catch {} },
  load: () => { try { return JSON.parse(sessionStorage.getItem('gomoku_session') || 'null'); } catch { return null; } },
  clear: () => { try { sessionStorage.removeItem('gomoku_session'); } catch {} },
};

const STAR_POINTS = [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
const GM_STICKER_LABELS = [['taunt_1', '無言'], ['taunt_2', '傻眼貓咪']];
const FORBIDDEN_LABEL = { double_three: '三三禁手', double_four: '四四禁手', overline: '長連禁手' };

/* ---------------- 規則面板（棋盤旁的說明）---------------- */

/* 規則示意圖：四張 7×5 的局部棋盤，中心點就是「這一手」。
   紅圈 ✕＝黑方不能下（三種禁手各一例），綠圈 ✓＝合法（四三）。
   全部用同一個中心點做對照，差別只在周圍多／少一顆子，比純文字好懂。 */
const FIG_PANELS = [
  { stones: [[2, 2], [4, 2], [3, 1], [3, 3]], ok: false, caption: '✕ 三三禁手（兩個活三）' },
  { stones: [[1, 2], [2, 2], [4, 2], [3, 0], [3, 1], [3, 3]], ok: false, caption: '✕ 四四禁手（兩個四）' },
  { stones: [[0, 2], [1, 2], [2, 2], [4, 2], [5, 2]], ok: false, caption: '✕ 長連禁手（六子以上）' },
  { stones: [[1, 2], [2, 2], [4, 2], [3, 1], [3, 3]], ok: true, caption: '✓ 四三合法（一四一三）' },
];

function RuleFigure() {
  const P = 14; // 格距
  const COLS = 7;
  const ROWS = 5;
  const RECT_X = 48;
  const RECT_W = 104;
  const RECT_H = 76;
  const PITCH = 100; // 每一格示意圖佔的垂直高度

  return (
    <svg viewBox={`0 0 200 ${FIG_PANELS.length * PITCH + 10}`} className="w-full" role="img"
      aria-label="黑方三種禁手與合法四三的示意圖">
      {FIG_PANELS.map((panel, i) => {
        const ry = 10 + i * PITCH;
        const ox = RECT_X + 10;
        const oy = ry + 10;
        const cx = ox + 3 * P; // 中心點就是這一手
        const cy = oy + 2 * P;
        const c = panel.ok ? '#84cc16' : '#ef4444';
        return (
          <g key={i}>
            <rect x={RECT_X} y={ry} width={RECT_W} height={RECT_H} rx={6} fill="#c8985d" />
            <g stroke="rgba(60,35,10,0.55)" strokeWidth="0.7">
              {Array.from({ length: ROWS }).map((_, r) => (
                <line key={`r${r}`} x1={ox} y1={oy + r * P} x2={ox + (COLS - 1) * P} y2={oy + r * P} />
              ))}
              {Array.from({ length: COLS }).map((_, k) => (
                <line key={`c${k}`} x1={ox + k * P} y1={oy} x2={ox + k * P} y2={oy + (ROWS - 1) * P} />
              ))}
            </g>
            {panel.stones.map(([gx, gy], k) => (
              <circle key={k} cx={ox + gx * P} cy={oy + gy * P} r={5.2} fill="#23201c" stroke="rgba(0,0,0,0.5)" strokeWidth="0.5" />
            ))}
            {/* 記號底下先蓋一塊底色，不然格線會穿過去，紅 ✕ 看起來像米字 */}
            <circle cx={cx} cy={cy} r={6.4} fill="#c8985d" />
            <g fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round">
              <circle cx={cx} cy={cy} r={6.4} />
              {panel.ok ? (
                <path d={`M${cx - 3} ${cy} L${cx - 0.8} ${cy + 2.3} L${cx + 3} ${cy - 2.6}`} />
              ) : (
                <path d={`M${cx - 3.2} ${cy - 3.2} L${cx + 3.2} ${cy + 3.2} M${cx + 3.2} ${cy - 3.2} L${cx - 3.2} ${cy + 3.2}`} />
              )}
            </g>
            <text x="100" y={ry + RECT_H + 15} textAnchor="middle" fontSize="10.5" fill={c} fontWeight="bold">
              {panel.caption}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function RulePanel({ boardMode }) {
  return (
    <div className="rounded-xl border border-field-chalk/12 bg-black/25 p-3 space-y-3">
      <div>
        <div className="text-[11px] tracking-wider text-field-chalk/50 mb-1.5">遊戲規則</div>
        <div className="text-[11px] leading-relaxed text-field-chalk/60">
          15×15 棋盤，黑先白後，輪流在交叉點落子。橫、直、斜任一方向先連成五子者勝。
        </div>
      </div>

      <div className="rounded-lg border border-red-400/35 bg-red-500/[0.07] p-2.5 space-y-1.5">
        <div className="text-[11px] font-bold text-red-300">⛔ 先手（黑）的三種禁手</div>
        <div className="text-[11px] leading-relaxed text-field-chalk/60 space-y-1">
          <div><span className="text-red-300 font-bold">三三禁手</span>　一手同時做出兩個以上的「活三」</div>
          <div><span className="text-red-300 font-bold">四四禁手</span>　一手同時做出兩個以上的「四」（活四、沖四都算）</div>
          <div><span className="text-red-300 font-bold">長連禁手</span>　連成六子以上</div>
        </div>
        <div className="text-[11px] leading-relaxed text-field-chalk/60 pt-0.5">
          判定看的是<span className="text-field-chalk/85">「這一手」同時做出幾個</span>，不是盤面上總共有幾個——
          先前就存在的活三、四都不算在內。這些點會被系統直接擋下，輪到黑方時就先在盤面標成
          <span className="text-red-400 font-bold mx-0.5">✕</span>（滑過去看得到是哪一種）。
        </div>
        <div className="text-[10px] leading-relaxed text-field-chalk/40 pt-0.5">
          例外：該手若本身就連成<span className="text-field-chalk/60">正好五子</span>，五連優先，判勝不算禁手。
          白方連六子則照樣算贏。
        </div>
      </div>

      {/* 示意圖就放在規則旁邊，紅圈不能下、綠圈可以下 */}
      <div className="rounded-lg border border-field-chalk/12 bg-black/20 p-2">
        <RuleFigure />
      </div>

      <div className="rounded-lg border border-field-chalk/12 p-2.5 space-y-1.5">
        <div className="text-[11px] leading-relaxed text-field-chalk/60">
          <span className="text-field-chalk/85">活三</span>＝再補一子就會變成兩端都能成五的「活四」。
          <span className="text-field-chalk/85">四</span>＝再補一子就能成五。
        </div>
        <div className="text-[11px] leading-relaxed text-field-chalk/60">
          <span className="text-lime-300/90">四三是合法的</span>——一手做出一個四加一個活三不受限制，
          這是最主要的取勝手段。只有「三＋三」和「四＋四」才禁。
        </div>
        <div className="text-[11px] leading-relaxed text-field-chalk/60">
          白方（後手）<span className="text-field-chalk/85">三種禁手一種都沒有</span>。
        </div>
      </div>

      <div className={`rounded-lg border p-2.5 ${boardMode === 'friendly' ? 'border-field-floodlight/35 bg-field-floodlight/[0.06]' : 'border-field-chalk/12'}`}>
        <div className="text-[11px] font-bold mb-1" style={{ color: boardMode === 'friendly' ? '#f5cf6a' : 'rgba(242,234,217,0.5)' }}>
          {boardMode === 'friendly' ? '🤝 友善模式（本局啟用）' : '⚔️ 普通模式（本局）'}
        </div>
        <div className="text-[11px] leading-relaxed text-field-chalk/55">
          {boardMode === 'friendly'
            ? '任一方出現活三或死四時，那三子／四子會亮紅框；同一方同時出現兩個以上威脅（雙活三、活三＋死四…）時，旁邊還會跳出提示圖。'
            : '不做任何棋型提示，只擋禁手，一切自己看。'}
        </div>
      </div>
    </div>
  );
}

/* ---------------- 大廳 ---------------- */

function Lobby({ onEnter, initialError }) {
  const [tab, setTab] = useState('create');
  const [code, setCode] = useState('');
  const [series, setSeries] = useState('BO1');
  const [boardMode, setBoardMode] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');

  async function create() {
    setBusy(true); setErr('');
    try {
      const d = await api('/api/room/create', { mode: 'gomoku', seriesMode: series, boardMode });
      onEnter(d.code, d.token, d.view);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) { setErr('房號是 4 位數字'); return; }
    setBusy(true); setErr('');
    try {
      const d = await api('/api/room/join', { code, mode: 'gomoku' });
      onEnter(d.code, d.token, d.view);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#20180f] via-[#15100a] to-[#0a0705]">
      <div className="max-w-md mx-auto px-6 py-14 text-center">
        <div className="font-display text-4xl font-black text-field-chalk mb-1">五子棋</div>
        <div className="text-field-chalk/45 text-xs tracking-[0.3em] mb-8">15×15．先手三大禁手</div>

        <div className="flex rounded-xl overflow-hidden border border-field-chalk/20 mb-5">
          {[['create', '建立房間'], ['join', '加入房間']].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setErr(''); }}
              className={`flex-1 py-2.5 text-sm ${tab === k ? 'bg-field-floodlight/20 text-field-floodlight' : 'text-field-chalk/50'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'create' ? (
          <>
            <div className="text-[10px] tracking-[0.25em] text-field-chalk/35 mb-2">模式</div>
            <div className="flex gap-2 mb-5">
              {[
                ['normal', '⚔️ 普通模式', '正常遊玩，只擋禁手'],
                ['friendly', '🤝 友善模式', '活三／死四亮紅框提示'],
              ].map(([k, title, desc]) => (
                <button key={k} onClick={() => setBoardMode(k)}
                  className={`flex-1 py-3 px-2 rounded-xl border-2 ${boardMode === k ? 'border-field-floodlight text-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20 text-field-chalk/50'}`}>
                  <div className="font-bold text-sm">{title}</div>
                  <div className="text-[10px] opacity-70 mt-0.5 leading-tight">{desc}</div>
                </button>
              ))}
            </div>

            <div className="text-[10px] tracking-[0.25em] text-field-chalk/35 mb-2">賽制</div>
            <div className="flex gap-2 mb-5">
              {['BO1', 'BO3', 'BO5'].map((m) => (
                <button key={m} onClick={() => setSeries(m)}
                  className={`flex-1 py-3 rounded-xl border-2 ${series === m ? 'border-field-floodlight text-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20 text-field-chalk/50'}`}>
                  <div className="font-bold">{m}</div>
                  <div className="text-[10px] opacity-70">先 {m === 'BO5' ? 3 : m === 'BO3' ? 2 : 1} 勝</div>
                </button>
              ))}
            </div>
            <button onClick={create} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
              {busy ? '建立中…' : '建立房間'}
            </button>
          </>
        ) : (
          <>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && join()} placeholder="4 位數房號" inputMode="numeric"
              className="w-full text-center font-mono text-2xl tracking-[0.5em] bg-black/40 border border-field-chalk/25 rounded-xl py-3 mb-4 text-field-chalk focus:outline-none focus:border-field-floodlight/70" />
            <button onClick={join} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
              {busy ? '加入中…' : '加入房間'}
            </button>
            <div className="text-[10px] text-field-chalk/30 mt-3">模式與賽制由建房的人決定</div>
          </>
        )}
        {err && <div className="mt-4 text-sm text-red-300/85">{err}</div>}
      </div>
    </div>
  );
}

/* ---------------- 棋盤 ---------------- */

const SIZE = 15;

function Board({ v, onPlace, disabled }) {
  // 座標 → 樣式查表，避免每一格都去掃陣列（225 格 × 每次重繪）
  const marks = useMemo(() => {
    const threat = new Map(); // 'x,y' → 'three_open' | 'four' | 'four_open'
    const rank = { three_open: 1, four: 2, four_open: 3 };
    for (const t of v.threats || []) {
      for (const [x, y] of t.stones) {
        const k = `${x},${y}`;
        if (!threat.has(k) || rank[t.kind] > rank[threat.get(k)]) threat.set(k, t.kind);
      }
    }
    const forbidden = new Map((v.forbidden || []).map(([x, y, kind]) => [`${x},${y}`, kind]));
    const win = new Set((v.winLine || []).map(([x, y]) => `${x},${y}`));
    return { threat, forbidden, win };
  }, [v.threats, v.forbidden, v.winLine]);

  const showForbidden = v.myTurn && v.iAmBlack && v.phase === 'playing';

  return (
    <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-black/40 shadow-dugout"
      style={{ background: 'linear-gradient(160deg,#d9b078,#c8985d 55%,#b8853f)' }}>
      {/* 格線與星位 */}
      <svg viewBox="0 0 15 15" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
        {Array.from({ length: SIZE }).map((_, i) => (
          <g key={i}>
            <line x1={0.5} y1={i + 0.5} x2={14.5} y2={i + 0.5} stroke="rgba(60,35,10,0.65)" strokeWidth={0.035} />
            <line x1={i + 0.5} y1={0.5} x2={i + 0.5} y2={14.5} stroke="rgba(60,35,10,0.65)" strokeWidth={0.035} />
          </g>
        ))}
        {STAR_POINTS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.11} fill="rgba(60,35,10,0.8)" />
        ))}
      </svg>

      {/* 落子點 */}
      {/* 落子點：15×15 等分格，每格中心正好落在上面 SVG 的線交叉點上。
          ★ 行高一定要一起指定 15 等分——只給 gridTemplateColumns 的話，
            grid-auto-rows 預設是 auto，空格高度會塌成 0，整盤棋子會被擠到
            上緣，看起來既不在格子裡也不在交叉點上。 */}
      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${SIZE}, minmax(0,1fr))`,
          gridTemplateRows: `repeat(${SIZE}, minmax(0,1fr))`,
        }}
      >
        {Array.from({ length: SIZE * SIZE }).map((_, i) => {
          const x = i % SIZE;
          const y = Math.floor(i / SIZE);
          const key = `${x},${y}`;
          const cell = v.board[i];
          const isLast = v.last && v.last.x === x && v.last.y === y;
          const kind = marks.threat.get(key);
          const forbiddenKind = showForbidden ? marks.forbidden.get(key) : null;
          const isForbidden = !!forbiddenKind;
          const isWin = marks.win.has(key);

          return (
            <button key={i} disabled={disabled || cell !== 0}
              onClick={() => onPlace(x, y)}
              title={isForbidden ? `${FORBIDDEN_LABEL[forbiddenKind]}：不能下這裡` : `${x + 1},${y + 1}`}
              className="relative flex items-center justify-center disabled:cursor-default">
              {cell !== 0 && (
                <div className={`relative w-[88%] aspect-square rounded-full ${isWin ? 'pk-win-glow' : ''}`}>
                  <img src={cell === 1 ? '/gomoku/black.png' : '/gomoku/white.png'} alt="" className="w-full h-full object-contain drop-shadow" />
                  {kind && (
                    <span
                      className="absolute -inset-[6%] rounded-full pointer-events-none"
                      style={{ boxShadow: `0 0 0 2px ${kind === 'three_open' ? '#ef4444' : '#f87171'}, 0 0 7px 1px rgba(239,68,68,0.6)` }}
                    />
                  )}
                  {/* 最新的一手：中央金點閃爍 ＋ 外圈擴散，對手一眼看得出剛下在哪 */}
                  {isLast && (
                    <>
                      <span className="gm-last-ring absolute inset-0 rounded-full border-2 border-field-floodlight pointer-events-none" />
                      <span className="gm-last-dot absolute inset-0 m-auto w-[26%] h-[26%] rounded-full bg-field-floodlight shadow-[0_0_6px_2px_rgba(245,207,106,0.75)] pointer-events-none" />
                    </>
                  )}
                </div>
              )}
              {/* 禁手點的 ✕：用兩根旋轉的橫槓畫，會跟著格子大小縮放。
                  用文字的 ✕ 在手機上會小到看不見（字級沒辦法跟著格寬走）。 */}
              {cell === 0 && isForbidden && (
                <span className="relative block w-[52%] h-[52%] pointer-events-none">
                  <span className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rotate-45 rounded-full bg-red-500 shadow-[0_0_3px_rgba(0,0,0,0.5)]" />
                  <span className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 -rotate-45 rounded-full bg-red-500 shadow-[0_0_3px_rgba(0,0,0,0.5)]" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- 友善模式提示圖 ---------------- */

function ThreatAlert({ v }) {
  const who = v.myAlert && v.oppAlert ? '雙方' : v.myAlert ? '你' : '對手';
  return (
    <div className="rounded-xl border-2 border-red-400/50 bg-red-500/[0.08] p-3 text-center"
      style={{ animation: 'memePop 500ms cubic-bezier(.34,1.56,.64,1) both' }}>
      <img src="/gomoku/alert.png" alt="" className="w-24 mx-auto rounded-lg" />
      <div className="font-display font-black text-red-300 mt-2 text-sm">⚠ {who}同時出現兩個以上威脅</div>
      <div className="text-[10px] text-field-chalk/50 mt-1 leading-relaxed">
        雙活三、或活三加死四——紅框的那幾子快要成形了
      </div>
    </div>
  );
}

/* ---------------- 主元件 ---------------- */

export default function Gomoku() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lobbyErr, setLobbyErr] = useState('');
  const [showGameOver, setShowGameOver] = useState(false);
  const [stickers, setStickers] = useState({ a: null, b: null });
  const [showRules, setShowRules] = useState(false); // 手機版規則收展
  const pollRef = useRef(null);
  const stickerSeqRef = useRef({ a: 0, b: 0 });
  const stickerTimers = useRef({ a: null, b: null });

  useEffect(() => { const s = ss.load(); if (s?.code && s?.token) setSession(s); }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const d = await api('/api/room/state', session);
      setView(d.view);
    } catch (e) {
      if (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN') { ss.clear(); setSession(null); setView(null); setLobbyErr('房間已過期或不存在'); }
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    pollRef.current = setInterval(refresh, 1600);
    return () => clearInterval(pollRef.current);
  }, [session, refresh]);

  // 貼圖：雙方各自獨立顯示 2 秒，可同時出現、也可以連發（連發會重新計時）。
  // 用 !== 而不是 >：換場時 seq 會重來，用 > 會因為前端記著舊高水位而再也不顯示。
  useEffect(() => {
    const incoming = view?.stickers;
    if (!incoming) return;
    for (const seat of ['a', 'b']) {
      const s = incoming[seat];
      if (!s) continue;
      if (s.seq === stickerSeqRef.current[seat]) continue;
      stickerSeqRef.current[seat] = s.seq;
      setStickers((prev) => ({ ...prev, [seat]: s }));
      clearTimeout(stickerTimers.current[seat]);
      stickerTimers.current[seat] = setTimeout(() => setStickers((prev) => ({ ...prev, [seat]: null })), 2000);
    }
  }, [view?.stickers?.a?.seq, view?.stickers?.b?.seq]);

  useEffect(() => () => {
    clearTimeout(stickerTimers.current.a);
    clearTimeout(stickerTimers.current.b);
  }, []);

  // 一場結束：先讓勝利連線亮完，1.4 秒後才跳結算框
  useEffect(() => {
    if (view?.phase === 'gameover') {
      const t = setTimeout(() => setShowGameOver(true), 1400);
      return () => clearTimeout(t);
    }
    setShowGameOver(false);
  }, [view?.phase, view?.series?.gameNo]);

  // 錯誤訊息 3 秒後自動收掉（禁手提示很常按到，不該一直卡在畫面上）
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  function enter(code, token, v) { ss.save(code, token); setSession({ code, token }); setView(v); setLobbyErr(''); }
  function leave() { ss.clear(); setSession(null); setView(null); }

  async function act(action, payload) {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      const d = await api('/api/room/action', { ...session, action, payload });
      setView(d.view);
    } catch (e) { setMsg(e.message); if (e.view) setView(e.view); } finally { setBusy(false); }
  }

  if (!session || !view) return <Lobby onEnter={enter} initialError={lobbyErr} />;
  const v = view;
  const labels = { a: '玩家 A', b: '玩家 B' };

  if (!v.oppJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#20180f] to-[#0a0705] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">把房號給對手</div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em] text-field-floodlight">{v.code}</div>
        <div className="text-[11px] text-field-chalk/40">
          {v.boardMode === 'friendly' ? '🤝 友善模式' : '⚔️ 普通模式'}
        </div>
        <SeriesBar series={v.series} labels={labels} me={v.role} />
        <div className="text-field-chalk/35 text-xs">等待對手加入…</div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">取消</button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  const gameOver = v.phase === 'gameover';
  const seriesOver = v.series?.over;
  const alertOn = v.boardMode === 'friendly' && (v.myAlert || v.oppAlert);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#20180f] via-[#15100a] to-[#0a0705] pb-24">
      <div className="max-w-5xl mx-auto px-3 sm:px-5 pt-4">
        {/* 頂列 */}
        <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-field-chalk/12">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold text-field-chalk">五子棋</span>
            <span className="font-mono text-xs text-field-chalk/35">房號 {v.code}</span>
          </div>
          <span className="text-xs text-field-chalk/45">
            {v.boardMode === 'friendly' ? '🤝 友善模式' : '⚔️ 普通模式'}　第 {v.series.gameNo} 場
          </span>
        </div>

        <SeriesBar series={v.series} labels={labels} me={v.role} />

        {/* 執子與輪次 */}
        <div className="grid grid-cols-2 gap-2 my-3">
          <div className={`rounded-xl border p-2 text-center ${v.myTurn ? 'border-field-floodlight/60 bg-field-floodlight/10' : 'border-field-chalk/15 bg-black/25'}`}>
            <div className="text-[10px] text-field-chalk/45">你（{labels[v.role]}）</div>
            <div className="flex items-center justify-center gap-1.5 mt-0.5">
              <img src={v.iAmBlack ? '/gomoku/black.png' : '/gomoku/white.png'} alt="" className="w-5 h-5" />
              <span className="font-display font-black text-lg text-field-chalk">{v.iAmBlack ? '黑（先手）' : '白（後手）'}</span>
            </div>
          </div>
          <div className={`rounded-xl border p-2 text-center ${!v.myTurn && !gameOver ? 'border-field-floodlight/40 bg-field-floodlight/[0.06]' : 'border-field-chalk/15 bg-black/25'}`}>
            <div className="text-[10px] text-field-chalk/45">對手</div>
            <div className="flex items-center justify-center gap-1.5 mt-0.5">
              <img src={v.iAmBlack ? '/gomoku/white.png' : '/gomoku/black.png'} alt="" className="w-5 h-5" />
              <span className="font-display font-black text-lg text-field-chalk/75">{v.iAmBlack ? '白（後手）' : '黑（先手）'}</span>
            </div>
          </div>
        </div>

        <div className="text-center text-sm mb-2">
          {gameOver ? (
            <span className="text-field-chalk/50">本場結束</span>
          ) : v.myTurn ? (
            <span className="text-field-floodlight">輪到你落子</span>
          ) : (
            <span className="text-field-chalk/45">等待對手落子…</span>
          )}
          <span className="text-field-chalk/30 text-xs">　已下 {v.moves} 手</span>
        </div>

        {/* 棋盤 ＋ 旁邊的規則／提示欄 */}
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="w-full lg:flex-1 min-w-0 max-w-[560px] mx-auto lg:mx-0">
            <Board v={v} disabled={!v.myTurn || busy || gameOver} onPlace={(x, y) => act('gm_place', { x, y })} />
            {msg && <div className="text-[12px] text-red-300/90 mt-2 text-center">{msg}</div>}
          </div>

          {/* 旁邊的空白處：規則常駐，友善模式觸發時提示圖疊在上面 */}
          <aside className="w-full lg:w-64 shrink-0 space-y-3">
            {alertOn && <ThreatAlert v={v} />}
            <div className="hidden lg:block"><RulePanel boardMode={v.boardMode} /></div>
            <div className="lg:hidden">
              <button onClick={() => setShowRules((p) => !p)}
                className="w-full py-2 rounded-lg border border-field-chalk/15 bg-black/25 text-field-chalk/60 text-xs">
                {showRules ? '▲ 收起規則' : '▼ 查看規則（先手三大禁手）'}
              </button>
              {showRules && <div className="mt-2"><RulePanel boardMode={v.boardMode} /></div>}
            </div>

            {/* 貼圖列 */}
            <div>
              <div className="text-[10px] text-field-chalk/35 mb-1 text-center">貼圖</div>
              <div className="flex flex-wrap justify-center gap-2">
                {GM_STICKER_LABELS.map(([key, label]) => (
                  <button key={key} onClick={() => act('gm_sticker', { name: key })} disabled={busy}
                    className="w-12 h-12 rounded-lg border border-field-chalk/15 bg-black/30 hover:border-field-floodlight overflow-hidden" title={label}>
                    <img src={`/gomoku/stickers/${key}.png`} alt={label} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            {!gameOver && (
              <button onClick={() => act('gm_resign')} disabled={busy}
                className="w-full py-2 rounded-lg border border-red-400/35 text-red-300/70 text-xs">認輸</button>
            )}

            {/* 戰報 */}
            {v.log?.length > 0 && (
              <div className="rounded-xl border border-field-chalk/12 bg-black/25 px-3 py-2 max-h-28 overflow-y-auto">
                {v.log.map((l, i) => (
                  <div key={i} className={`text-[11px] leading-relaxed ${/🏆|🤝|🏳️/.test(l.text) ? 'text-field-floodlight/90' : 'text-field-chalk/45'}`}>{l.text}</div>
                ))}
              </div>
            )}
          </aside>
        </div>

        <button onClick={leave} className="mt-6 text-field-chalk/30 text-[11px] underline underline-offset-4">離開房間</button>
      </div>

      {/* 貼圖顯示（雙方畫面都會出現；同時按會左右並列）*/}
      {['a', 'b'].map((seat) => {
        const s = stickers[seat];
        if (!s) return null;
        const mine = seat === v.role;
        return (
          <div key={`${seat}-${s.seq}`}
            className={`fixed bottom-28 z-[60] pointer-events-none ${mine ? 'right-6' : 'left-6'}`}
            style={{ animation: 'stickerPop 2s ease-out both' }}>
            <img src={`/gomoku/stickers/${s.name}.png`} alt="" className="w-56 h-56 object-contain drop-shadow-2xl" />
            <div className="text-center text-[11px] text-field-chalk/60 mt-1">{mine ? '你' : '對手'}</div>
          </div>
        );
      })}

      {v.series?.matchPoint && <MatchPointMeme />}

      {/* 一場結束（系列未結束）*/}
      {gameOver && !seriesOver && showGameOver && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-field-chalk/20 bg-[#170f08] p-7 text-center">
            <div className="font-display text-2xl font-black mb-2" style={{ color: v.iWon ? '#f5cf6a' : '#e88' }}>
              {v.winner ? (v.iWon ? '你贏了這場' : '對手贏了這場') : '這場和局'}
            </div>
            <div className="text-xs text-field-chalk/50 mb-5">系列比分 {v.series.wins[v.role]} : {v.series.wins[v.role === 'a' ? 'b' : 'a']}</div>
            <button onClick={() => act('gm_next')} disabled={busy}
              className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-40">
              下一場（換黑白）
            </button>
            <button onClick={leave} className="mt-3 text-field-chalk/40 text-xs underline underline-offset-4">離開</button>
          </div>
        </div>
      )}

      {/* 系列賽結束 */}
      {seriesOver && showGameOver && (
        <div className="fixed inset-0 z-[70] bg-black/88 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-field-floodlight/30 bg-[#170f08] p-7 text-center">
            <div className="text-5xl mb-3">{v.series.champion === v.role ? '🏆' : '🥈'}</div>
            <div className="font-display text-3xl font-black mb-2" style={{ color: '#f5cf6a' }}>
              {v.series.champion === v.role ? '系列賽冠軍！' : '系列賽落敗'}
            </div>
            <div className="text-xs text-field-chalk/50 mb-5">最終比分 {v.series.wins[v.role]} : {v.series.wins[v.role === 'a' ? 'b' : 'a']}</div>
            <button onClick={() => act('gm_rematch')} disabled={busy}
              className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest">
              再來一輪
            </button>
            <button onClick={leave} className="mt-3 text-field-chalk/40 text-xs underline underline-offset-4">離開</button>
          </div>
        </div>
      )}

      <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
    </div>
  );
}
