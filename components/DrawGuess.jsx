'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Chat from './Chat';

/* ------------------------------------------------------------------
 * 你畫我猜．合作猜詞前端
 *  ‧ 畫的人：黑/紅 × 細/中/粗，60 秒作圖，筆畫即時同步；可提早「畫好了」
 *  ‧ 猜的人：看得到即時圖畫與「幾個字」提示，打字猜；作圖結束後另有 30 秒
 *  共用總分，答對 +1；可設定 5 / 10 / 15 回合，輪流畫與猜。
 * ------------------------------------------------------------------ */

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || '連線失敗');
    err.code = data.error; err.view = data.view;
    throw err;
  }
  return data;
}
const ss = {
  save: (c, t) => { try { sessionStorage.setItem('drawguess_session', JSON.stringify({ code: c, token: t })); } catch {} },
  load: () => { try { return JSON.parse(sessionStorage.getItem('drawguess_session') || 'null'); } catch { return null; } },
  clear: () => { try { sessionStorage.removeItem('drawguess_session'); } catch {} },
};

const CANVAS_PX = 640; // 內部繪圖解析度（顯示時再以 CSS 縮放）
const DG_STICKERS = [['taunt_1', '柴犬'], ['taunt_2', '哈士奇'], ['taunt_3', '你這隻豬'], ['taunt_4', '要那個幹什麼']];

/* ---------------- 畫布 ---------------- */

function DrawCanvas({ strokes, editable, colorIdx, widthIdx, colors, widths, coordMax, onStroke }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(null); // 進行中的筆畫 { c, w, p:[] }
  const dprRef = useRef(1);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const size = CANVAS_PX;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const scale = size / coordMax;
    const all = drawingRef.current ? [...strokes, drawingRef.current] : strokes;
    for (const st of all) {
      const pts = st.p;
      if (!pts || pts.length < 2) continue;
      ctx.strokeStyle = colors[st.c] || '#111';
      ctx.lineWidth = Math.max(1, (widths[st.w] || 3) * scale);
      ctx.beginPath();
      ctx.moveTo(pts[0] * scale, pts[1] * scale);
      for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo(pts[i] * scale, pts[i + 1] * scale);
      // 單點也點一下（避免只按一下沒有線）
      if (pts.length === 2) ctx.lineTo(pts[0] * scale + 0.01, pts[1] * scale + 0.01);
      ctx.stroke();
    }
  }, [strokes, colors, widths, coordMax]);

  useEffect(() => { draw(); }, [draw]);

  const toCoord = (e) => {
    const cv = canvasRef.current;
    const rect = cv.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * coordMax;
    const y = ((e.clientY - rect.top) / rect.height) * coordMax;
    return [Math.max(0, Math.min(coordMax, x)), Math.max(0, Math.min(coordMax, y))];
  };

  const onDown = (e) => {
    if (!editable) return;
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    const [x, y] = toCoord(e);
    drawingRef.current = { c: colorIdx, w: widthIdx, p: [Math.round(x), Math.round(y)] };
    draw();
  };
  const onMove = (e) => {
    if (!editable || !drawingRef.current) return;
    e.preventDefault();
    const [x, y] = toCoord(e);
    const p = drawingRef.current.p;
    const lx = p[p.length - 2], ly = p[p.length - 1];
    // 距離過近就略過，壓低點數
    if (Math.hypot(x - lx, y - ly) < 6) return;
    p.push(Math.round(x), Math.round(y));
    draw();
  };
  const onUp = (e) => {
    if (!editable || !drawingRef.current) return;
    e.preventDefault();
    const st = drawingRef.current;
    drawingRef.current = null;
    if (st.p.length >= 2) onStroke(st);
    draw();
  };

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_PX}
      height={CANVAS_PX}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="w-full aspect-square rounded-xl bg-white select-none"
      style={{ touchAction: 'none', cursor: editable ? 'crosshair' : 'default' }}
    />
  );
}

/* ---------------- 大廳 ---------------- */

function Lobby({ onEnter, initialError }) {
  const [tab, setTab] = useState('create');
  const [code, setCode] = useState('');
  const [rounds, setRounds] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');

  async function create() {
    setBusy(true); setErr('');
    try { const d = await api('/api/room/create', { mode: 'drawguess', rounds }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) { setErr('房號是 4 位數字'); return; }
    setBusy(true); setErr('');
    try { const d = await api('/api/room/join', { code, mode: 'drawguess' }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#141a24] via-[#0f1620] to-[#0a0e14]">
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="font-display text-4xl font-black text-field-chalk mb-1">你畫我猜</div>
        <div className="text-field-chalk/45 text-xs tracking-[0.3em] mb-8">一人作畫．一人猜詞．共用總分</div>

        <div className="flex rounded-xl overflow-hidden border border-field-chalk/20 mb-5">
          {[['create', '建立房間'], ['join', '加入房間']].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setErr(''); }}
              className={`flex-1 py-2.5 text-sm ${tab === k ? 'bg-field-floodlight/20 text-field-floodlight' : 'text-field-chalk/50'}`}>{label}</button>
          ))}
        </div>

        {tab === 'create' ? (
          <>
            <div className="text-[10px] tracking-[0.25em] text-field-chalk/35 mb-2">回合數</div>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {[5, 10, 15].map((n) => (
                <button key={n} onClick={() => setRounds(n)}
                  className={`py-3 rounded-xl border-2 font-display font-bold ${rounds === n ? 'border-field-floodlight text-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20 text-field-chalk/50'}`}>
                  {n} 回合
                </button>
              ))}
            </div>
            <div className="text-[11px] text-field-chalk/40 mb-5 leading-relaxed">
              輪流畫與猜，答對一題共用總分 +1。<br />作圖 60 秒、猜題 30 秒。
            </div>
            <button onClick={create} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
              {busy ? '建立中…' : '建立房間'}</button>
          </>
        ) : (
          <>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && join()} placeholder="4 位數房號" inputMode="numeric"
              className="w-full text-center font-mono text-2xl tracking-[0.5em] bg-black/40 border border-field-chalk/25 rounded-xl py-3 mb-4 text-field-chalk focus:outline-none focus:border-field-floodlight/70" />
            <button onClick={join} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
              {busy ? '加入中…' : '加入房間'}</button>
          </>
        )}
        {err && <div className="mt-4 text-sm text-red-300/85">{err}</div>}
      </div>
    </div>
  );
}

/* ---------------- 主元件 ---------------- */

export default function DrawGuess() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lobbyErr, setLobbyErr] = useState('');

  // 作畫工具
  const [colorIdx, setColorIdx] = useState(0);
  const [widthIdx, setWidthIdx] = useState(1);
  const [localStrokes, setLocalStrokes] = useState([]);
  const [guessText, setGuessText] = useState('');
  const [now, setNow] = useState(Date.now());

  // 貼圖
  const [stickers, setStickers] = useState({ a: null, b: null });
  const stickerSeqRef = useRef({ a: 0, b: 0 });
  const stickerTimers = useRef({ a: null, b: null });

  const pollRef = useRef(null);
  const offsetRef = useRef(0); // 伺服器時間 − 本機時間
  const roundKeyRef = useRef(null);
  const firedRef = useRef(''); // 已觸發過的相位轉換（避免連發）
  const pendingRef = useRef([]); // 待送出的筆畫
  const flushingRef = useRef(false);

  useEffect(() => { const s = ss.load(); if (s?.code && s?.token) setSession(s); }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const d = await api('/api/room/state', session);
      setView(d.view);
      if (typeof d.view?.serverNow === 'number') offsetRef.current = d.view.serverNow - Date.now();
    } catch (e) {
      if (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN') { ss.clear(); setSession(null); setView(null); setLobbyErr('房間已過期或不存在'); }
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    pollRef.current = setInterval(refresh, 1200);
    return () => clearInterval(pollRef.current);
  }, [session, refresh]);

  // 本機碼表（每 250ms 走一次，用於倒數顯示與時間到觸發）
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  function enter(code, token, v) { ss.save(code, token); setSession({ code, token }); setView(v); setLobbyErr(''); if (typeof v?.serverNow === 'number') offsetRef.current = v.serverNow - Date.now(); }
  function leave() { ss.clear(); setSession(null); setView(null); }

  const act = useCallback(async (action, payload, opts = {}) => {
    if (busy && !opts.silent) return false;
    if (!opts.silent) setBusy(true);
    if (!opts.silent) setMsg('');
    try { const d = await api('/api/room/action', { ...session, action, payload }); setView(d.view); return true; }
    catch (e) { if (!opts.silent) setMsg(e.message); if (e.view) setView(e.view); return false; }
    finally { if (!opts.silent) setBusy(false); }
  }, [busy, session]);

  const v = view;

  // 回合／作畫者變動 → 清空本機筆畫、重設工具與觸發旗標
  useEffect(() => {
    if (!v) return;
    const key = `${v.round}:${v.drawerSeat}`;
    if (roundKeyRef.current !== key) {
      roundKeyRef.current = key;
      // 若我是這回合的畫者，從伺服器現有筆畫接續（處理重整）；否則清空
      setLocalStrokes(v.iAmDrawer ? (v.strokes || []).map((s) => ({ ...s, p: [...s.p] })) : []);
      pendingRef.current = [];
      setGuessText('');
    }
  }, [v?.round, v?.drawerSeat, v?.iAmDrawer]);

  // 重設「時間到」觸發旗標（相位改變時）
  useEffect(() => {
    firedRef.current = '';
  }, [v?.phase, v?.round]);

  // 送出待處理筆畫（節流：每 600ms 一批）
  useEffect(() => {
    if (!v || !v.iAmDrawer || v.phase !== 'draw') return;
    const t = setInterval(async () => {
      if (flushingRef.current || pendingRef.current.length === 0) return;
      flushingRef.current = true;
      const batch = pendingRef.current;
      pendingRef.current = [];
      const ok = await act('dg_stroke', { strokes: batch }, { silent: true });
      if (!ok) pendingRef.current = [...batch, ...pendingRef.current]; // 失敗放回重送
      flushingRef.current = false;
    }, 600);
    return () => clearInterval(t);
  }, [v?.iAmDrawer, v?.phase, act, v?.round]);

  // 倒數與時間到自動轉相位
  const secLeft = (() => {
    if (!v || v.deadline == null) return null;
    const serverNow = now + offsetRef.current;
    return Math.max(0, Math.ceil((v.deadline - serverNow) / 1000));
  })();

  useEffect(() => {
    if (!v || secLeft == null || secLeft > 0) return;
    const tag = `${v.phase}:${v.round}`;
    if (firedRef.current === tag) return;
    if (v.phase === 'draw') { firedRef.current = tag; act('dg_finish_draw', null, { silent: true }); }
    else if (v.phase === 'guess') { firedRef.current = tag; act('dg_timeout_guess', null, { silent: true }); }
  }, [secLeft, v?.phase, v?.round, act]);

  // 貼圖顯示
  useEffect(() => {
    const incoming = v?.stickers;
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
  }, [v?.stickers?.a?.seq, v?.stickers?.b?.seq]);
  useEffect(() => () => { clearTimeout(stickerTimers.current.a); clearTimeout(stickerTimers.current.b); }, []);

  // 畫者完成一筆
  const handleStroke = useCallback((stroke) => {
    setLocalStrokes((prev) => [...prev, stroke]);
    pendingRef.current.push(stroke);
  }, []);

  const doClear = useCallback(() => {
    setLocalStrokes([]);
    pendingRef.current = [];
    act('dg_clear');
  }, [act]);

  if (!session || !view) return <Lobby onEnter={enter} initialError={lobbyErr} />;

  const labels = { a: '玩家 A', b: '玩家 B' };
  const meLabel = labels[v.seat];

  // 等待對手
  if (!v.oppJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#141a24] to-[#0a0e14] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">把房號給對手</div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em] text-field-floodlight">{v.code}</div>
        <div className="text-field-chalk/40 text-xs">共 {v.roundsTotal} 回合　·　你是 {meLabel}</div>
        <div className="text-field-chalk/35 text-xs">等待對手加入…</div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">取消</button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  const isOver = v.phase === 'over';
  const isReveal = v.phase === 'reveal';
  const drawerLabel = labels[v.drawerSeat];
  const guesserLabel = labels[v.drawerSeat === 'a' ? 'b' : 'a'];

  // 倒數條顏色與比例
  const totalSec = v.phase === 'draw' ? v.drawSeconds : v.phase === 'guess' ? v.guessSeconds : 0;
  const ratio = totalSec ? Math.max(0, Math.min(1, (secLeft ?? 0) / totalSec)) : 0;
  const timerColor = v.phase === 'draw' ? '#7fd4ff' : '#ffce6b';

  const statusLine = isOver ? '🏁 遊戲結束'
    : isReveal ? '公佈答案'
    : v.iAmDrawer ? (v.phase === 'draw' ? '你正在作畫' : '等待對方猜…')
    : (v.phase === 'draw' ? '看圖猜詞（也可以先猜）' : '快猜！定格圖畫');

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#141a24] via-[#0f1620] to-[#0a0e14] pb-24">
      <div className="max-w-2xl mx-auto px-3 sm:px-5 pt-4">
        {/* 標題列 */}
        <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-field-chalk/12">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold text-field-chalk">你畫我猜</span>
            <span className="font-mono text-xs text-field-chalk/35">房號 {v.code}</span>
          </div>
          <div className={`text-xs tracking-wider ${!isOver && !isReveal && (v.iAmDrawer ? v.phase === 'draw' : true) ? 'text-field-floodlight' : 'text-field-chalk/45'}`}>{statusLine}</div>
        </div>

        {/* 記分板：共用總分（醒目）＋回合＋角色 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-xl border-2 border-field-floodlight/45 bg-field-floodlight/[0.08] p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">共用總分</div>
            <div className="font-display font-black text-2xl text-field-floodlight leading-tight">{v.score}</div>
          </div>
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">回合</div>
            <div className="font-display font-black text-2xl text-field-chalk leading-tight">{Math.min(v.round, v.roundsTotal)}<span className="text-xs text-field-chalk/40">/{v.roundsTotal}</span></div>
          </div>
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">本回合</div>
            <div className="font-display font-bold text-sm text-field-chalk/85 leading-tight mt-1">
              <span style={{ color: '#7fd4ff' }}>{drawerLabel}</span> 畫<br />
              <span className="text-field-chalk/55 text-[11px]">{guesserLabel} 猜</span>
            </div>
          </div>
        </div>

        {/* 倒數條 */}
        {(v.phase === 'draw' || v.phase === 'guess') && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-field-chalk/45">{v.phase === 'draw' ? '作圖時間' : '猜題時間'}</span>
              <span className="font-mono font-bold" style={{ color: timerColor }}>{secLeft ?? '–'} 秒</span>
            </div>
            <div className="h-2 rounded-full bg-black/40 overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-300 ease-linear" style={{ width: `${ratio * 100}%`, background: timerColor }} />
            </div>
          </div>
        )}

        {/* 猜的人：提示（幾個字＋類別）*/}
        {!v.iAmDrawer && v.hint && (v.phase === 'draw' || v.phase === 'guess') && (
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-3 mb-3 flex items-center justify-center gap-3 flex-wrap">
            <span className="text-[11px] text-field-chalk/45">提示</span>
            <div className="flex gap-1.5">
              {Array.from({ length: v.hint.count }).map((_, i) => (
                <span key={i} className="w-6 h-8 rounded-md border-b-2 border-field-floodlight/60 bg-white/5" />
              ))}
            </div>
            <span className="text-sm font-bold text-field-floodlight">{v.hint.count} 個字</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-field-chalk/10 text-field-chalk/60">類別：{v.hint.category}</span>
          </div>
        )}

        {/* 畫的人：看到的題目 */}
        {v.iAmDrawer && !isOver && (
          <div className="rounded-xl border border-[#7fd4ff]/30 bg-[#7fd4ff]/[0.06] p-3 mb-3 text-center">
            <span className="text-[11px] text-field-chalk/45">你要畫的題目</span>
            <div className="font-display font-black text-2xl text-[#aee4ff] mt-0.5">{v.word}</div>
            {v.wordCategory && <span className="text-[11px] text-field-chalk/40">（{v.wordCategory}）</span>}
          </div>
        )}

        {/* 畫布 */}
        <div className="rounded-2xl border border-field-chalk/15 bg-black/25 p-2 mb-3">
          <DrawCanvas
            strokes={v.iAmDrawer ? localStrokes : (v.strokes || [])}
            editable={v.iAmDrawer && v.phase === 'draw'}
            colorIdx={colorIdx}
            widthIdx={widthIdx}
            colors={v.colors}
            widths={v.widths}
            coordMax={v.coordMax}
            onStroke={handleStroke}
          />
        </div>

        {/* 畫的人工具列 */}
        {v.iAmDrawer && v.phase === 'draw' && (
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-field-chalk/40">顏色</span>
              {v.colors.map((col, i) => (
                <button key={i} onClick={() => setColorIdx(i)}
                  className={`w-8 h-8 rounded-full border-2 ${colorIdx === i ? 'border-field-floodlight scale-110' : 'border-field-chalk/25'}`}
                  style={{ background: col }} title={i === 0 ? '黑色' : '紅色'} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-field-chalk/40">筆寬</span>
              {v.widths.map((wd, i) => (
                <button key={i} onClick={() => setWidthIdx(i)}
                  className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center ${widthIdx === i ? 'border-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20'}`}
                  title={['細', '中', '粗'][i]}>
                  <span className="rounded-full bg-field-chalk/80" style={{ width: `${wd + 2}px`, height: `${wd + 2}px` }} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={doClear} disabled={busy} className="px-3 py-2 rounded-lg border border-field-chalk/25 text-field-chalk/70 text-xs">清除</button>
              <button onClick={() => act('dg_finish_draw')} disabled={busy} className="px-4 py-2 rounded-lg border border-field-floodlight/60 text-field-floodlight text-xs tracking-wider">畫好了</button>
            </div>
          </div>
        )}

        {/* 猜的人輸入區 */}
        {!v.iAmDrawer && (v.phase === 'draw' || v.phase === 'guess') && (
          <div className="flex items-center gap-2 mb-3">
            <input value={guessText} onChange={(e) => setGuessText(e.target.value.slice(0, 30))}
              onKeyDown={(e) => { if (e.key === 'Enter' && guessText.trim()) { act('dg_guess', { text: guessText.trim() }); setGuessText(''); } }}
              placeholder="打字猜答案，按 Enter 送出"
              className="flex-1 bg-black/40 border border-field-chalk/20 rounded-lg px-3 py-2.5 text-field-chalk focus:outline-none focus:border-field-floodlight/60" />
            <button onClick={() => { if (guessText.trim()) { act('dg_guess', { text: guessText.trim() }); setGuessText(''); } }}
              disabled={busy || !guessText.trim()} className="px-4 py-2.5 rounded-lg border border-field-floodlight/60 text-field-floodlight tracking-wider disabled:opacity-30">猜</button>
            <button onClick={() => act('dg_giveup')} disabled={busy} className="px-3 py-2.5 rounded-lg border border-field-chalk/25 text-field-chalk/60 text-xs">放棄</button>
          </div>
        )}

        {msg && <div className="text-[12px] text-red-300/85 mb-3 text-center">{msg}</div>}

        {/* 猜測紀錄 */}
        {v.guessLog?.length > 0 && (
          <div className="rounded-xl border border-field-chalk/12 bg-black/20 px-3 py-2 mb-3 max-h-28 overflow-y-auto">
            {v.guessLog.map((g, i) => (
              <div key={i} className={`text-[12px] leading-relaxed ${g.correct ? 'text-[#5fcf8f] font-bold' : 'text-field-chalk/55'}`}>
                {labels[g.by]}：{g.text} {g.correct ? '✅ 答對！' : ''}
              </div>
            ))}
          </div>
        )}

        {/* 貼圖列 */}
        <div className="mb-4">
          <div className="flex justify-center gap-2">
            {DG_STICKERS.map(([key, label]) => (
              <button key={key} onClick={() => act('dg_sticker', { name: key }, { silent: true })}
                className="w-10 h-10 rounded-lg border border-field-chalk/15 bg-black/30 hover:border-field-floodlight overflow-hidden" title={label}>
                <img src={`/mission/stickers/${key}.png`} alt={label} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        <button onClick={leave} className="mt-2 text-field-chalk/30 text-[11px] underline underline-offset-4">離開房間</button>
      </div>

      {/* 貼圖顯示 */}
      {['a', 'b'].map((seat) => {
        const s = stickers[seat];
        if (!s) return null;
        return (
          <div key={`${seat}-${s.seq}`}
            className={`fixed bottom-24 z-[60] pointer-events-none ${seat === v.seat ? 'right-6' : 'left-6'}`}
            style={{ animation: 'stickerPop 2s ease-out both' }}>
            <img src={`/mission/stickers/${s.name}.png`} alt="" className="w-48 h-48 object-contain drop-shadow-2xl" />
            <div className="text-center text-[11px] text-field-chalk/60 mt-1">{seat === v.seat ? '你' : '對手'}</div>
          </div>
        );
      })}

      {/* 公佈答案 */}
      {isReveal && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6" style={{ animation: 'overlayIn 0.35s ease-out both' }}>
          <div className="w-full max-w-sm rounded-2xl border border-field-chalk/20 bg-[#12161e] p-7 text-center">
            <div className="text-5xl mb-3">{v.lastResult === 'correct' ? '🎉' : v.lastResult === 'giveup' ? '🙈' : '⏳'}</div>
            <div className="font-display text-xl font-black mb-1" style={{ color: v.lastResult === 'correct' ? '#5fcf8f' : '#e8b56b' }}>
              {v.lastResult === 'correct' ? '答對了！總分 +1' : v.lastResult === 'giveup' ? '這回合放棄' : '時間到，沒猜中'}
            </div>
            <div className="text-xs text-field-chalk/50 mb-1">答案是</div>
            <div className="font-display text-2xl font-black text-field-chalk mb-1">{v.word}</div>
            {v.wordCategory && <div className="text-[11px] text-field-chalk/40 mb-4">（{v.wordCategory}）</div>}
            <div className="text-xs text-field-chalk/50 mb-5">目前共用總分 <span className="text-field-floodlight font-bold">{v.score}</span>　·　已完成 {v.roundsDone}/{v.roundsTotal} 回合</div>
            <button onClick={() => act('dg_next')} disabled={busy} className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-40">
              {v.roundsDone + 1 >= v.roundsTotal ? '看結算' : '下一回合'}
            </button>
          </div>
        </div>
      )}

      {/* 結算 */}
      {isOver && (
        <div className="fixed inset-0 z-[70] bg-black/88 flex items-center justify-center p-6" style={{ animation: 'overlayIn 0.4s ease-out both' }}>
          <div className="w-full max-w-sm rounded-2xl border border-field-chalk/20 bg-[#12161e] p-7 text-center">
            <div className="text-5xl mb-3">🏆</div>
            <div className="font-display text-2xl font-black mb-2 text-field-floodlight">遊戲結束</div>
            <div className="text-sm text-field-chalk/60 mb-1">{v.roundsTotal} 回合合作結果</div>
            <div className="font-display text-5xl font-black text-field-chalk my-3">{v.score}<span className="text-lg text-field-chalk/40"> / {v.roundsTotal}</span></div>
            <div className="text-xs text-field-chalk/50 mb-5">
              {v.score >= v.roundsTotal ? '全部命中，完美默契！' : v.score >= v.roundsTotal * 0.6 ? '很有默契，不錯的表現！' : '再接再厲，多練幾局會更好！'}
            </div>
            <button onClick={() => act('dg_rematch')} disabled={busy} className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-40">再玩一局</button>
            <button onClick={leave} className="mt-3 text-field-chalk/40 text-xs underline underline-offset-4">離開</button>
          </div>
        </div>
      )}

      <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
    </div>
  );
}
