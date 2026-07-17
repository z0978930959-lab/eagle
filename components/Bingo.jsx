'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ------------------------------------------------------------------
 * 賓果對決前端
 * 流程：大廳（建房/加房）→ 等待對手 → 三選一盤面 → 猜拳定先手 →
 *       輪流圈選（雙盤同步、連線數置頂、對方聽牌警示）→ 五連線終局
 * ------------------------------------------------------------------ */

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || '連線失敗');
    err.code = data.error;
    err.view = data.view;
    throw err;
  }
  return data;
}

// token 只放 sessionStorage：分頁關閉即失效
function saveSession(code, token) {
  try {
    sessionStorage.setItem('bingo_session', JSON.stringify({ code, token }));
  } catch {}
}
function loadSession() {
  try {
    const raw = sessionStorage.getItem('bingo_session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    sessionStorage.removeItem('bingo_session');
  } catch {}
}

const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const linesCn = (n) => (n >= 1 && n <= 10 ? NUM_CN[n - 1] : String(n));

/* ---------------- 小盤面（選盤預覽用） ---------------- */
function MiniBoard({ board, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border-2 p-1.5 transition-colors ${
        selected ? 'border-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20 bg-black/30 hover:border-field-chalk/40'
      }`}
    >
      <div className="grid grid-cols-5 gap-[3px]">
        {board.map((n, i) => (
          <div key={i} className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded bg-black/40 text-[11px] sm:text-xs font-mono-tc text-field-chalk/85">
            {n}
          </div>
        ))}
      </div>
    </button>
  );
}

/* ---------------- 對戰盤面 ---------------- */
function PlayBoard({ board, calledSet, myTurn, busy, onMark }) {
  return (
    <div className="grid grid-cols-5 gap-1.5 max-w-[340px] mx-auto">
      {board.map((n, i) => {
        const called = calledSet.has(n);
        const clickable = myTurn && !called && !busy;
        return (
          <button
            key={i}
            disabled={!clickable}
            onClick={() => onMark(n)}
            className={`relative aspect-square rounded-lg border text-lg font-mono-tc font-bold flex items-center justify-center transition-all ${
              called
                ? 'border-field-floodlight/60 bg-field-floodlight/15 text-field-floodlight'
                : clickable
                  ? 'border-field-chalk/30 bg-black/40 text-field-chalk hover:border-field-floodlight hover:scale-105 active:scale-95'
                  : 'border-field-chalk/15 bg-black/30 text-field-chalk/60'
            }`}
          >
            {n}
            {called && (
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="w-[80%] h-[80%] rounded-full border-[3px] border-field-floodlight/80" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- 戰報 ---------------- */
function BingoLog({ log }) {
  if (!log?.length) return null;
  return (
    <div className="mt-6 max-w-[380px] mx-auto rounded-lg bg-black/30 border border-field-chalk/12 px-3 py-2 max-h-36 overflow-y-auto">
      {log.map((l, i) => (
        <div key={i} className={`text-[11px] leading-relaxed ${/🏆|🔥|聽牌/.test(l.text) ? 'text-field-floodlight/90' : 'text-field-chalk/55'}`}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

/* ---------------- 大廳 ---------------- */
function BingoLobby({ error, onEnter }) {
  const [tab, setTab] = useState('create');
  const [code, setCode] = useState('');
  const [reveal, setReveal] = useState(false); // 情報規則：false=隱藏情報（預設）、true=公開情報
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error || '');

  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const data = await api('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'bingo', reveal }),
      });
      saveSession(data.code, data.token);
      onEnter(data.code, data.token, data.view);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const join = async () => {
    if (!/^\d{4}$/.test(code)) {
      setErr('請輸入 4 位數房號');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const data = await api('/api/room/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'bingo', code }),
      });
      saveSession(data.code, data.token);
      onEnter(data.code, data.token, data.view);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="max-w-md mx-auto px-6 py-14 text-center">
      <div className="font-display text-4xl font-black tracking-wide">賓果對決</div>
      <div className="text-field-chalk/50 text-sm mt-1 mb-8">1~25 盤面攻防・圈一個號雙盤同動・先五連線者勝</div>

      <div className="flex rounded-lg overflow-hidden border border-field-chalk/25 mb-6">
        {[
          ['create', '建立房間'],
          ['join', '加入房間'],
        ].map(([id, name]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2 text-sm font-bold ${tab === id ? 'bg-field-floodlight text-field-night' : 'text-field-chalk/70'}`}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'create' ? (
        <div>
          {/* 情報規則（開房者決定，整場適用） */}
          <div className="text-left text-xs text-field-chalk/60 mb-2">情報規則</div>
          <div className="flex flex-col gap-2 mb-5">
            <button
              onClick={() => setReveal(false)}
              className={`rounded-xl border-2 px-4 py-3 text-left transition-colors ${!reveal ? 'border-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20 bg-black/25'}`}
            >
              <div className="text-sm font-bold">🕶️ 隱藏情報</div>
              <div className="text-[11px] text-field-chalk/55 mt-0.5">連線數保密、終局才揭曉；聽牌只有自己知道，可選擇「宣告聽牌」嗆聲施壓</div>
            </button>
            <button
              onClick={() => setReveal(true)}
              className={`rounded-xl border-2 px-4 py-3 text-left transition-colors ${reveal ? 'border-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20 bg-black/25'}`}
            >
              <div className="text-sm font-bold">📊 公開情報</div>
              <div className="text-[11px] text-field-chalk/55 mt-0.5">即時顯示雙方連線數；對方聽牌時自動警示（聽幾張）</div>
            </button>
          </div>
          <button
            disabled={busy}
            onClick={create}
            className="w-full py-3 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-40"
          >
            建立賓果房間
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4 位數房號"
            inputMode="numeric"
            className="flex-1 rounded-lg bg-black/40 border border-field-chalk/25 px-4 py-3 text-center font-mono-tc text-lg tracking-[0.3em] outline-none focus:border-field-floodlight"
          />
          <button
            disabled={busy}
            onClick={join}
            className="px-6 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-40"
          >
            加入
          </button>
        </div>
      )}

      {err && <div className="mt-4 text-sm text-red-300">⚠️ {err}</div>}

      <div className="mt-10 text-left text-[11px] text-field-chalk/45 leading-relaxed rounded-lg border border-field-chalk/12 bg-black/25 px-3 py-2.5 space-y-1">
        <div>・雙方各從三張隨機盤面挑一張（1~25 不重複），猜拳決定先手</div>
        <div>・輪到你時圈自己盤上的數字——同一個數字在對方盤上也會被圈</div>
        <div>・情報規則由開房者決定：公開（即時連線數＋聽牌警示）或隱藏（終局揭曉、聽牌可自行宣告）</div>
        <div>・率先達成五連線獲勝；同一手雙方同時達標＝比連線數，一樣多平手</div>
      </div>
    </div>
  );
}

/* ---------------- 選盤 ---------------- */
function ChooseScreen({ view, send, busy }) {
  const [sel, setSel] = useState(null);
  if (view.myChosen) {
    return (
      <div className="max-w-md mx-auto px-6 py-14 text-center">
        <div className="font-display text-2xl font-bold mb-2">盤面已鎖定 ✅</div>
        <div className="text-field-chalk/55 text-sm animate-pulse">等待對方選盤……</div>
        <BingoLog log={view.log} />
      </div>
    );
  }
  return (
    <div className="max-w-md mx-auto px-4 py-10 text-center">
      <div className="font-display text-2xl font-bold mb-1">挑一張你的賓果盤</div>
      <div className="text-xs text-field-chalk/50 mb-5">三張都是 1~25 隨機排列——佈局就是你的戰略（對方看不到）</div>
      <div className="flex flex-col items-center gap-3">
        {view.myOptions?.map((b, i) => (
          <MiniBoard key={i} board={b} selected={sel === i} onClick={() => setSel(i)} />
        ))}
      </div>
      <button
        disabled={sel == null || busy}
        onClick={() => send('bingo_choose', { idx: sel })}
        className="mt-5 px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
      >
        就用這張！
      </button>
      <BingoLog log={view.log} />
    </div>
  );
}

/* ---------------- 猜拳 ---------------- */
function RpsScreen({ view, send, busy }) {
  const picks = [
    ['rock', '✊', '石頭'],
    ['paper', '✋', '布'],
    ['scissors', '✌️', '剪刀'],
  ];
  return (
    <div className="max-w-md mx-auto px-6 py-14 text-center">
      <div className="font-display text-2xl font-bold mb-1">猜拳決定先手</div>
      <div className="text-xs text-field-chalk/50 mb-2">第 {view.rpsRound} 回合{view.rpsRound > 1 ? '（上回合平手）' : ''}</div>
      {view.rpsText && <div className="text-xs text-field-chalk/60 mb-4">{view.rpsText}</div>}

      {view.myRpsPicked ? (
        <div className="text-field-chalk/60 text-sm animate-pulse mt-6">
          你出好了……等待對方出拳{view.oppRpsPicked ? '（結算中）' : ''}
        </div>
      ) : (
        <div className="flex justify-center gap-3 mt-4">
          {picks.map(([id, emoji, name]) => (
            <button
              key={id}
              disabled={busy}
              onClick={() => send('bingo_rps', { pick: id })}
              className="w-24 h-24 rounded-2xl border-2 border-field-chalk/25 bg-black/35 hover:border-field-floodlight hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center gap-1 disabled:opacity-40"
            >
              <span className="text-3xl">{emoji}</span>
              <span className="text-xs text-field-chalk/70">{name}</span>
            </button>
          ))}
        </div>
      )}
      <BingoLog log={view.log} />
    </div>
  );
}

/* ---------------- 對戰 ---------------- */
function PlayScreen({ view, send, busy }) {
  const calledSet = new Set(view.called);
  const myTurn = view.turn === view.role;
  return (
    <div className="max-w-md mx-auto px-4 py-8">
      {/* 醒目回合提示：輪到你＝大字＋跳動；對方回合＝暗色等待 */}
      {myTurn ? (
        <div className="mb-3 rounded-xl border-2 border-field-floodlight bg-field-floodlight/15 px-4 py-3 text-center animate-pulse shadow-[0_0_24px_rgba(255,200,60,0.25)]">
          <div className="font-display text-2xl font-black text-field-floodlight">🔔 換你了！</div>
          <div className="text-[11px] text-field-chalk/60 mt-0.5">點一個數字圈選（雙方盤面同步圈選）</div>
        </div>
      ) : (
        <div className="mb-3 rounded-xl border border-field-chalk/15 bg-black/30 px-4 py-3 text-center">
          <div className="font-display text-lg font-bold text-field-chalk/50">⏳ 對方回合</div>
          <div className="text-[11px] text-field-chalk/35 mt-0.5">等待對方圈選中……</div>
        </div>
      )}

      {/* 公開情報模式：置頂連線數 */}
      {view.reveal && (
        <div className="flex items-center justify-center gap-4 mb-1">
          <div className="text-center">
            <div className="text-[10px] text-field-chalk/45">我方連線</div>
            <div className="font-display text-3xl font-black text-field-floodlight">{view.myLines ?? 0}</div>
          </div>
          <div className="text-field-chalk/25 text-xl">vs</div>
          <div className="text-center">
            <div className="text-[10px] text-field-chalk/45">對方連線</div>
            <div className="font-display text-3xl font-black text-field-chalk/85">{view.oppLines ?? 0}</div>
          </div>
        </div>
      )}
      <div className="text-center text-[10px] text-field-chalk/40 mb-2">
        已圈 {view.called.length} 個號碼・率先五連線者勝{view.reveal ? '' : '（雙方連線數保密，終局揭曉）'}
      </div>

      {/* 對方聽牌：公開模式自動警示；隱藏模式要對方主動宣告才看得到 */}
      {view.oppTenpai > 0 && (
        <div className="text-center mb-2">
          <span className="inline-block px-3 py-1 rounded-full bg-red-500/20 border border-red-400/50 text-red-300 text-xs font-bold animate-pulse">
            {view.reveal ? `⚠️ 對方聽牌！（聽 ${view.oppTenpai} 張）` : `📢 對方宣告聽牌！（聽 ${view.oppTenpai} 張）`}
          </span>
        </div>
      )}

      {/* 自己聽牌 */}
      {view.myTenpai > 0 && (
        <div className="text-center mb-2 flex items-center justify-center gap-2 flex-wrap">
          <span className="inline-block px-3 py-1 rounded-full bg-field-floodlight/15 border border-field-floodlight/40 text-field-floodlight text-xs font-bold">
            🎯 你聽牌了（聽 {view.myTenpai} 張）{view.reveal ? '' : '——目前只有你知道'}
          </span>
          {!view.reveal && !view.myAnnounced && (
            <button
              disabled={busy}
              onClick={() => send('bingo_announce')}
              className="px-3 py-1 rounded-full border border-red-400/60 text-red-300 text-xs font-bold hover:bg-red-500/15 disabled:opacity-40"
            >
              📢 向對方宣告聽牌
            </button>
          )}
        </div>
      )}

      <div className={`rounded-2xl p-2 transition-shadow ${myTurn ? 'ring-2 ring-field-floodlight/60 shadow-[0_0_30px_rgba(255,200,60,0.15)]' : ''}`}>
        <PlayBoard board={view.myBoard} calledSet={calledSet} myTurn={myTurn} busy={busy} onMark={(n) => send('bingo_mark', { num: n })} />
      </div>

      {/* 平手提議 */}
      <div className="text-center mt-3">
        {view.drawOffer?.status === 'pending' && view.drawOffer.by === view.role ? (
          <span className="text-xs text-field-floodlight animate-pulse">🤝 平手提議已送上大屏幕，等待對方回應…</span>
        ) : (
          <button
            disabled={busy || view.drawOffer?.status === 'pending'}
            onClick={() => send('bingo_draw_offer')}
            className="px-4 py-1.5 rounded-full border border-field-chalk/30 text-xs text-field-chalk/70 hover:border-field-floodlight hover:text-field-floodlight disabled:opacity-40"
          >
            🤝 提議平手
          </button>
        )}
      </div>

      {/* 對方提議平手：大屏幕（投降輸一半梗圖） */}
      {view.drawOffer?.status === 'pending' && view.drawOffer.by !== view.role && (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="max-w-md w-full rounded-2xl border-4 border-field-floodlight/60 bg-field-night/95 overflow-hidden shadow-2xl">
            <div className="bg-field-floodlight/15 px-4 py-2 text-center text-xs tracking-[0.3em] text-field-floodlight font-bold">
              ── 球場大屏幕 ──
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/surrender.png" alt="投降輸一半" className="w-full block" draggable={false} />
            <div className="p-5 text-center">
              <div className="font-display text-xl font-bold mb-1">🤝 對方提議平手！</div>
              <div className="text-xs text-field-chalk/55 mb-4">接受＝雙方握手言和、以平局結束；不接受＝繼續分勝負。</div>
              <div className="flex gap-2 justify-center">
                <button
                  disabled={busy}
                  onClick={() => send('bingo_draw_respond', { accept: true })}
                  className="px-5 py-2 rounded-lg bg-field-floodlight text-field-night font-bold disabled:opacity-30"
                >
                  平局！就平局！
                </button>
                <button
                  disabled={busy}
                  onClick={() => send('bingo_draw_respond', { accept: false })}
                  className="px-5 py-2 rounded-lg border border-red-400/50 text-red-300 font-bold disabled:opacity-30"
                >
                  打完再說！
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BingoLog log={view.log} />
    </div>
  );
}

/* ---------------- 終局 ---------------- */
function BingoOverScreen({ view, onLeave }) {
  const iWin = view.winner === view.role;
  const draw = view.winner === 'draw';
  return (
    <div className="max-w-md mx-auto px-6 py-14 text-center">
      <div className="font-display text-3xl font-black mb-2">{draw ? '🤝 平手！' : iWin ? '🏆 你贏了！' : '😵 你輸了……'}</div>
      <div className="text-field-chalk/55 text-sm mb-5">
        終局揭曉：我方 {linesCn(view.myLines ?? 0)} 連線（{view.myLines ?? 0}）｜對方 {linesCn(view.oppLines ?? 0)} 連線（{view.oppLines ?? 0}）
      </div>
      <div className="max-w-sm mx-auto mb-5 rounded-xl overflow-hidden border-2 border-field-chalk/25">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/gohome.png" alt="大家可以回家啦" className="w-full block" draggable={false} />
        <div className="bg-black/40 text-center text-xs text-field-chalk/60 py-1.5">「大家可以回家啦」</div>
      </div>
      <PlayBoard board={view.myBoard} calledSet={new Set(view.called)} myTurn={false} busy onMark={() => {}} />
      <BingoLog log={view.log} />
      <button onClick={onLeave} className="mt-7 px-8 py-2.5 rounded-lg bg-field-floodlight text-field-night font-bold">
        回到大廳
      </button>
    </div>
  );
}

/* ---------------- 主元件 ---------------- */
export default function Bingo() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [actionErr, setActionErr] = useState('');
  const [rejectFlash, setRejectFlash] = useState(null);
  const lastDrawRef = useRef(null);
  const rejectTimer = useRef(null);
  const errTimer = useRef(null);
  const pollRef = useRef(null);

  // 拒絕偵測：drawOffer 從 pending → null 且比賽未結束＝對方拒絕
  useEffect(() => {
    const cur = view?.drawOffer;
    const prev = lastDrawRef.current;
    if (prev?.status === 'pending' && !cur && view?.phase !== 'over') {
      setRejectFlash(true);
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
      rejectTimer.current = setTimeout(() => setRejectFlash(false), 3000);
    }
    lastDrawRef.current = cur || null;
  }, [view?.drawOffer, view?.phase]);

  const showActionErr = (msg) => {
    setActionErr(msg);
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setActionErr(''), 4000);
  };

  const refresh = useCallback(async (code, token) => {
    try {
      const data = await api('/api/room/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, token }),
      });
      setView(data.view);
    } catch (e) {
      if (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN') {
        clearSession();
        setSession(null);
        setView(null);
        setErr('房間已過期或失效');
      }
    }
  }, []);

  // 恢復分頁內的既有對局
  useEffect(() => {
    const s = loadSession();
    if (s) {
      setSession(s);
      refresh(s.code, s.token);
    }
  }, [refresh]);

  // 2 秒輪詢
  useEffect(() => {
    if (!session) return;
    pollRef.current = setInterval(() => refresh(session.code, session.token), 2000);
    return () => clearInterval(pollRef.current);
  }, [session, refresh]);

  const send = async (action, payload) => {
    if (!session || busy) return;
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
      const TIP = {
        WRONG_PHASE: '目前不是這個階段，畫面已刷新',
        NOT_YOUR_TURN: '還沒輪到你',
        ALREADY_CALLED: '這個數字已經被圈過了',
        ALREADY_CHOSEN: '你已經選好盤面了',
        ALREADY_PICKED: '你已經出過拳了',
        BOARD_CLASH: '和對方撞盤了！已幫你重抽三張，請重新挑選',
        BAD_INPUT: '輸入不合法',
        NOT_STARTED: '對手尚未加入',
        NOT_TENPAI: '你還沒聽牌，不能宣告',
        ALREADY_ANNOUNCED: '你已經宣告過聽牌了',
        REVEAL_MODE: '公開情報房不需要宣告（對方本來就看得到）',
        DRAW_PENDING: '平手提議已在等待回應',
        NO_DRAW: '目前沒有待回應的平手提議',
      };
      const known = Object.keys(TIP).find((k) => (e.code || e.message || '').includes(k));
      showActionErr(known ? TIP[known] : e.message || '操作失敗');
      if (e.view) setView(e.view);
      else refresh(session.code, session.token);
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
    screen = <BingoLobby error={err} onEnter={(code, token, v) => { setSession({ code, token }); setView(v); setErr(''); }} />;
  } else if (view.status === 'waiting') {
    screen = (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="font-display text-2xl font-bold mb-3">等待對手加入</div>
        <div className="text-field-chalk/50 text-sm mb-1">把房號告訴朋友，從「賓果對決」加入</div>
        <div className="text-[11px] text-field-chalk/40 mb-4">本房規則：{view.reveal ? '📊 公開情報' : '🕶️ 隱藏情報'}</div>
        <button
          onClick={() => navigator.clipboard?.writeText(view.code).catch(() => {})}
          className="font-mono-tc text-5xl font-black tracking-[0.25em] text-field-floodlight"
          title="點擊複製"
        >
          {view.code}
        </button>
        <div className="text-[10px] text-field-chalk/35 mt-2">（點房號可複製）</div>
        <button onClick={leave} className="mt-10 text-xs text-field-chalk/50 underline">離開房間</button>
      </div>
    );
  } else if (view.phase === 'choose') {
    screen = <ChooseScreen view={view} send={send} busy={busy} />;
  } else if (view.phase === 'rps') {
    screen = <RpsScreen view={view} send={send} busy={busy} />;
  } else if (view.phase === 'play') {
    screen = <PlayScreen view={view} send={send} busy={busy} />;
  } else {
    screen = <BingoOverScreen view={view} onLeave={leave} />;
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grass-stripes floodlight-glow bg-gradient-to-b from-field-grass2 via-field-grass to-field-night" />
      <div className="relative z-10">{screen}</div>
      {rejectFlash && (
        <div className="fixed inset-0 z-[68] bg-black/85 backdrop-blur-sm flex items-center justify-center px-4 pointer-events-none">
          <div className="max-w-sm w-full rounded-2xl border-4 border-field-floodlight/60 bg-field-night/95 overflow-hidden shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/notthateasy.png" alt="不會那麼容易的" className="w-full block" draggable={false} />
            <div className="p-3 text-center">
              <div className="font-display text-lg font-bold">😤 對方拒絕平手</div>
              <div className="text-[11px] text-field-chalk/55 mt-1">「不會那麼容易的」</div>
            </div>
          </div>
        </div>
      )}
      {actionErr && session && view && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md bg-red-500/90 text-white text-sm font-medium shadow-lg border border-red-300/40 max-w-[90vw]" role="alert">
          ⚠️ {actionErr}
        </div>
      )}
    </div>
  );
}
