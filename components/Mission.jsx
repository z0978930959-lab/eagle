'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Chat from './Chat';

/* ------------------------------------------------------------------
 * 密語連線．雙人合作猜詞前端
 * 翻牌前：自己名單的淺綠/淺灰/淺紅底色提示（只有自己看得到）
 * 翻牌後：慢動作後快翻，換成身分圖＋飽和綠/灰/紅
 * ------------------------------------------------------------------ */

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || '連線失敗');
    err.code = data.error;
    err.view = data.view;
    throw err;
  }
  return data;
}

function saveSession(code, token) {
  try {
    sessionStorage.setItem('mission_session', JSON.stringify({ code, token }));
  } catch {}
}
function loadSession() {
  try {
    const raw = sessionStorage.getItem('mission_session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    sessionStorage.removeItem('mission_session');
  } catch {}
}

// 身分配色
const ROLE_COLOR = {
  key: { solid: '#3f9b68', soft: 'rgba(63,155,104,0.22)', label: '關鍵人物', ring: '#3f9b68' },
  civ: { solid: '#8b93a8', soft: 'rgba(139,147,168,0.18)', label: '路人', ring: '#8b93a8' },
  bomb: { solid: '#c9484f', soft: 'rgba(201,72,79,0.20)', label: '炸彈客', ring: '#c9484f' },
};
const roleImg = (role, n) =>
  `/mission/${role === 'key' ? 'key' : role === 'civ' ? 'civilian' : 'bomb'}_${n}.png`;

/* ---------------- 格子 ---------------- */

function Cell({ cell, canGuess, onGuess, justRevealed }) {
  const revealed = cell.revealed;
  const myRole = cell.myRole; // 翻牌前：自己名單的身分（淺色提示）
  const shown = cell.shownRole; // 翻牌後：翻牌者的身分
  const soft = myRole ? ROLE_COLOR[myRole].soft : 'transparent';

  return (
    <button
      onClick={() => canGuess && !revealed && onGuess(cell._idx)}
      disabled={!canGuess || revealed}
      className={`relative rounded-lg aspect-[5/7] w-full overflow-hidden transition-transform border
        ${revealed ? 'border-transparent' : 'border-field-chalk/15'}
        ${canGuess && !revealed ? 'hover:-translate-y-0.5 hover:border-field-floodlight cursor-pointer' : 'cursor-default'}`}
      style={{
        background: revealed ? '#0d1016' : soft,
        perspective: '600px',
      }}
    >
      {/* 翻牌前：詞 + 淺色身分提示 */}
      {!revealed && (
        <span className="absolute inset-0 flex flex-col items-center justify-center p-1">
          <span
            className="font-display font-bold text-center leading-tight text-field-chalk"
            style={{ fontSize: cell.word.length > 2 ? '0.82rem' : '1.05rem' }}
          >
            {cell.word}
          </span>
          {myRole && (
            <span
              className="absolute bottom-1 right-1 w-2 h-2 rounded-full"
              style={{ background: ROLE_COLOR[myRole].solid, opacity: 0.7 }}
            />
          )}
        </span>
      )}

      {/* 翻牌後：身分圖 + 飽和色 + 慢後快翻牌動畫 */}
      {revealed && (
        <span
          className="absolute inset-0"
          style={{ animation: justRevealed ? 'msFlip 620ms cubic-bezier(.6,.02,.9,.6) both' : 'none' }}
        >
          <img src={roleImg(shown, cell.img)} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <span className="absolute inset-0" style={{ background: ROLE_COLOR[shown].soft, mixBlendMode: 'multiply' }} />
          <span className="absolute inset-0 ring-2 rounded-lg" style={{ boxShadow: `inset 0 0 0 2px ${ROLE_COLOR[shown].ring}` }} />
          <span className="absolute top-0 left-0 right-0 py-0.5 text-center text-[9px] font-bold text-white" style={{ background: ROLE_COLOR[shown].solid }}>
            {ROLE_COLOR[shown].label}
          </span>
          <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[11px] font-display font-bold text-white bg-black/55">
            {cell.word}
          </span>
        </span>
      )}
    </button>
  );
}

/* ---------------- 大廳 ---------------- */

function Lobby({ onEnter, initialError }) {
  const [tab, setTab] = useState('create');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');

  async function create() {
    setBusy(true);
    setErr('');
    try {
      const d = await api('/api/room/create', { mode: 'mission' });
      onEnter(d.code, d.token, d.view);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) {
      setErr('房號是 4 位數字');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const d = await api('/api/room/join', { code, mode: 'mission' });
      onEnter(d.code, d.token, d.view);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-b from-[#141a24] via-[#0f1620] to-[#0a0e14]">
      <div className="relative z-10 max-w-md mx-auto px-6 py-16 text-center">
        <div className="font-display text-4xl font-black tracking-wide mb-1 text-field-chalk">密語連線</div>
        <div className="text-field-chalk/45 text-xs tracking-[0.3em] mb-8">雙人合作．找出所有關鍵人物</div>

        <div className="flex rounded-xl overflow-hidden border border-field-chalk/20 mb-5">
          {[['create', '建立房間'], ['join', '加入房間']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setErr('');
              }}
              className={`flex-1 py-2.5 text-sm transition-colors ${
                tab === k ? 'bg-field-floodlight/20 text-field-floodlight' : 'text-field-chalk/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'create' ? (
          <>
            <p className="text-xs text-field-chalk/45 leading-relaxed mb-5">
              兩人合作，輪流給提示，找齊 15 個關鍵人物。
              <br />
              小心炸彈客——翻到就結束。
            </p>
            <button onClick={create} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
              {busy ? '建立中…' : '建立房間'}
            </button>
          </>
        ) : (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="4 位數房號"
              inputMode="numeric"
              className="w-full text-center font-mono text-2xl tracking-[0.5em] bg-black/40 border border-field-chalk/25 rounded-xl py-3 mb-4 text-field-chalk focus:outline-none focus:border-field-floodlight/70"
            />
            <button onClick={join} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
              {busy ? '加入中…' : '加入房間'}
            </button>
          </>
        )}
        {err && <div className="mt-4 text-sm text-red-300/85">{err}</div>}
      </div>
    </div>
  );
}

/* ---------------- 主元件 ---------------- */

export default function Mission() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [clueWord, setClueWord] = useState('');
  const [clueCount, setClueCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lobbyErr, setLobbyErr] = useState('');
  const [flipIdx, setFlipIdx] = useState(null); // 剛翻開的格子（播動畫）
  const pollRef = useRef(null);
  const lastRevealSeq = useRef(0);

  useEffect(() => {
    const s = loadSession();
    if (s?.code && s?.token) setSession(s);
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const d = await api('/api/room/state', session);
      setView(d.view);
    } catch (e) {
      if (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN') {
        clearSession();
        setSession(null);
        setView(null);
        setLobbyErr('房間已過期或不存在');
      }
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    const period = view && (view.myTurnToClue || view.myTurnToGuess) ? 2500 : 1500;
    pollRef.current = setInterval(refresh, period);
    return () => clearInterval(pollRef.current);
  }, [session, refresh, view?.myTurnToClue, view?.myTurnToGuess]);

  // 偵測新翻牌 → 播動畫
  useEffect(() => {
    const lr = view?.lastReveal;
    if (lr && lr.seq > lastRevealSeq.current) {
      lastRevealSeq.current = lr.seq;
      setFlipIdx(lr.index);
      const t = setTimeout(() => setFlipIdx(null), 700);
      return () => clearTimeout(t);
    }
  }, [view?.lastReveal?.seq]);

  function enter(code, token, v) {
    saveSession(code, token);
    setSession({ code, token });
    setView(v);
    setLobbyErr('');
  }
  function leave() {
    clearSession();
    setSession(null);
    setView(null);
  }

  async function act(action, payload) {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const d = await api('/api/room/action', { ...session, action, payload });
      setView(d.view);
    } catch (e) {
      setMsg(e.message);
      if (e.view) setView(e.view);
    } finally {
      setBusy(false);
    }
  }

  if (!session || !view) return <Lobby onEnter={enter} initialError={lobbyErr} />;
  const v = view;
  const labels = { a: '玩家 A', b: '玩家 B' };

  // 等待對手
  if (!v.oppJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#141a24] to-[#0a0e14] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">把房號給隊友</div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em] text-field-floodlight">{v.code}</div>
        <div className="text-field-chalk/35 text-xs">等待隊友加入…</div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">取消</button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  const cells = v.cells.map((c, i) => ({ ...c, _idx: i }));
  const isOver = v.phase === 'over';
  const canGuess = v.myTurnToGuess && !isOver;

  const statusLine = isOver
    ? v.result === 'win'
      ? '🎉 挑戰成功！'
      : v.result === 'bomb'
        ? '💥 踩到炸彈客——失敗'
        : '⏳ 路人用光——失敗'
    : v.myTurnToClue
      ? '輪到你出提示'
      : v.myTurnToGuess
        ? `隊友提示「${v.clue?.word}，${v.clue?.count}」，換你猜`
        : v.clue
          ? `你提示了「${v.clue.word}，${v.clue.count}」，等隊友猜`
          : '等待隊友出提示…';

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#141a24] via-[#0f1620] to-[#0a0e14] pb-24">
      <div className="max-w-3xl mx-auto px-3 sm:px-5 pt-4">
        {/* 頂列 */}
        <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-field-chalk/12">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold text-field-chalk">密語連線</span>
            <span className="font-mono text-xs text-field-chalk/35">房號 {v.code}　你是 {labels[v.role]}</span>
          </div>
          <div className={`text-xs tracking-wider ${v.myTurnToClue || v.myTurnToGuess ? 'text-field-floodlight' : 'text-field-chalk/45'}`}>
            {statusLine}
          </div>
        </div>

        {/* 記分板 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-xl border border-[#3f9b68]/40 bg-[#3f9b68]/[0.08] p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">已找到關鍵</div>
            <div className="font-display font-black text-2xl" style={{ color: '#5fcf8f' }}>
              {v.found}<span className="text-sm text-field-chalk/40">/{v.keyUnion}</span>
            </div>
          </div>
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">尚未找到</div>
            <div className="font-display font-black text-2xl text-field-chalk">{v.remainingKeys}</div>
          </div>
          <div className="rounded-xl border border-[#c9484f]/35 bg-[#c9484f]/[0.06] p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">路人（回合）</div>
            <div className="font-display font-black text-2xl" style={{ color: '#e88' }}>
              {v.civiliansUsed}<span className="text-sm text-field-chalk/40">/{v.civilianLimit}</span>
            </div>
          </div>
        </div>

        {/* 5×5 盤面 */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {cells.map((c) => (
            <Cell key={c._idx} cell={c} canGuess={canGuess} onGuess={(i) => act('ms_guess', { index: i })} justRevealed={flipIdx === c._idx} />
          ))}
        </div>

        {/* 提示區 */}
        {!isOver && (
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-3 mb-4">
            {v.myTurnToClue ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[140px]">
                  <div className="text-[10px] text-field-chalk/40 mb-1">提示詞（一個詞）</div>
                  <input
                    value={clueWord}
                    onChange={(e) => setClueWord(e.target.value.slice(0, 20))}
                    placeholder="例如：兇猛"
                    className="w-full bg-black/40 border border-field-chalk/20 rounded-lg px-3 py-2 text-field-chalk focus:outline-none focus:border-field-floodlight/60"
                  />
                </div>
                <div>
                  <div className="text-[10px] text-field-chalk/40 mb-1">數量</div>
                  <select
                    value={clueCount}
                    onChange={(e) => setClueCount(Number(e.target.value))}
                    className="bg-black/40 border border-field-chalk/20 rounded-lg px-3 py-2 text-field-chalk focus:outline-none"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => {
                    if (clueWord.trim()) {
                      act('ms_clue', { word: clueWord.trim(), count: clueCount });
                      setClueWord('');
                    }
                  }}
                  disabled={busy || !clueWord.trim()}
                  className="px-5 py-2 rounded-lg border border-field-floodlight/60 text-field-floodlight tracking-wider disabled:opacity-30"
                >
                  送出提示
                </button>
              </div>
            ) : v.myTurnToGuess ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-field-chalk/80">
                  隊友提示 <span className="text-field-floodlight font-bold">「{v.clue?.word}，{v.clue?.count}」</span>
                  　還可猜 <span className="text-field-floodlight">{v.clue?.remaining}</span> 次
                </div>
                <button onClick={() => act('ms_stop')} disabled={busy} className="px-4 py-1.5 rounded-lg border border-field-chalk/25 text-field-chalk/70 text-xs">
                  停止猜測
                </button>
              </div>
            ) : (
              <div className="text-sm text-field-chalk/50 text-center py-1">
                {v.clue ? `等待隊友猜「${v.clue.word}，${v.clue.count}」…` : '等待隊友出提示…'}
              </div>
            )}
          </div>
        )}

        {msg && <div className="text-[12px] text-red-300/85 mb-3 text-center">{msg}</div>}

        {/* 戰報 */}
        {v.log?.length > 0 && (
          <div className="rounded-xl border border-field-chalk/12 bg-black/25 px-3 py-2 max-h-32 overflow-y-auto">
            {v.log.map((l, i) => (
              <div key={i} className={`text-[11px] leading-relaxed ${/🎉|💥|⏳|👑/.test(l.text) ? 'text-field-floodlight/90' : 'text-field-chalk/45'}`}>
                {l.text}
              </div>
            ))}
          </div>
        )}

        <button onClick={leave} className="mt-6 text-field-chalk/30 text-[11px] underline underline-offset-4">離開房間</button>
      </div>

      {/* 終局 */}
      {isOver && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-field-chalk/20 bg-[#12161e] p-7 text-center">
            <div className="text-5xl mb-3">{v.result === 'win' ? '🎉' : v.result === 'bomb' ? '💥' : '⏳'}</div>
            <div className="font-display text-2xl font-black mb-2" style={{ color: v.result === 'win' ? '#5fcf8f' : '#e88' }}>
              {v.result === 'win' ? '挑戰成功！' : v.result === 'bomb' ? '踩到炸彈客' : '路人用光了'}
            </div>
            <div className="text-xs text-field-chalk/50 mb-5">找到 {v.found}/{v.keyUnion} 個關鍵人物</div>
            <button onClick={() => location.reload()} className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest">
              再玩一局
            </button>
            <button onClick={leave} className="mt-3 text-field-chalk/40 text-xs underline underline-offset-4">離開</button>
          </div>
        </div>
      )}

      <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
    </div>
  );
}
