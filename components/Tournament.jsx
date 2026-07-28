'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ------------------------------------------------------------------
 * 綜合比賽．賓果 + E卡 + 17撲克 隨機三場，先贏兩場者奪冠（2:0 提前結束）
 *
 * 這是一個「賽事外殼」：本身用一個 tournament 房記錄系列賽進度與當前子賽事，
 * 每一場子賽事沿用既有的連線房（各自獨立房號）。外殼負責：
 *   ‧ 隨機決定三場順序
 *   ‧ 顯示賽事進度與氣氛過場
 *   ‧ 串接每一場的建立/加入與勝負回報
 *
 * 為了不改動既有三款遊戲，綜合比賽採「引導式」串接：由主機端在 tournament
 * 狀態機推進，雙方在同一 tournament 房內輪詢，systemMessage 指示下一步。
 * ------------------------------------------------------------------ */

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || '連線失敗');
    err.code = data.error;
    throw err;
  }
  return data;
}
const ss = {
  save: (o) => { try { sessionStorage.setItem('tourney_session', JSON.stringify(o)); } catch {} },
  load: () => { try { return JSON.parse(sessionStorage.getItem('tourney_session') || 'null'); } catch { return null; } },
  clear: () => { try { sessionStorage.removeItem('tourney_session'); } catch {} },
};

const GAME_META = {
  bingo: { icon: '🎯', title: '賓果對決', color: '#5fcf8f' },
  ecard: { icon: '👑', title: 'E 卡', color: '#f5cf6a' },
  poker: { icon: '🃏', title: '17 張撲克', color: '#e8a', label: '' },
};

export default function Tournament() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lobbyErr, setLobbyErr] = useState('');
  const [code, setCode] = useState('');
  const [tab, setTab] = useState('create');
  const pollRef = useRef(null);

  useEffect(() => { const s = ss.load(); if (s?.code && s?.token) setSession(s); }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const d = await api('/api/tournament/state', session);
      setView(d.view);
    } catch (e) {
      if (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN') { ss.clear(); setSession(null); setView(null); setLobbyErr('賽事已過期或不存在'); }
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    pollRef.current = setInterval(refresh, 1800);
    return () => clearInterval(pollRef.current);
  }, [session, refresh]);

  async function create() {
    setBusy(true); setLobbyErr('');
    try {
      const d = await api('/api/tournament/create', {});
      ss.save({ code: d.code, token: d.token });
      setSession({ code: d.code, token: d.token }); setView(d.view);
    } catch (e) { setLobbyErr(e.message); } finally { setBusy(false); }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) { setLobbyErr('房號是 4 位數字'); return; }
    setBusy(true); setLobbyErr('');
    try {
      const d = await api('/api/tournament/join', { code });
      ss.save({ code: d.code, token: d.token });
      setSession({ code: d.code, token: d.token }); setView(d.view);
    } catch (e) { setLobbyErr(e.message); } finally { setBusy(false); }
  }
  function leave() { ss.clear(); setSession(null); setView(null); }

  async function reportWin(winner) {
    setBusy(true);
    try { const d = await api('/api/tournament/report', { ...session, winner }); setView(d.view); }
    catch (e) { setLobbyErr(e.message); } finally { setBusy(false); }
  }
  async function advance() {
    setBusy(true);
    try { const d = await api('/api/tournament/advance', session); setView(d.view); }
    catch (e) { setLobbyErr(e.message); } finally { setBusy(false); }
  }

  // 大廳
  if (!session || !view) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1a1414] via-[#120e0e] to-[#080606]">
        <div className="max-w-md mx-auto px-6 py-16 text-center">
          <div className="text-4xl mb-2">🏆</div>
          <div className="font-display text-4xl font-black text-field-chalk mb-1">綜合比賽</div>
          <div className="text-field-chalk/45 text-xs tracking-[0.25em] mb-8">賓果 · E卡 · 17撲克　隨機三場．先贏兩場奪冠</div>
          <div className="flex rounded-xl overflow-hidden border border-field-chalk/20 mb-5">
            {[['create', '建立賽事'], ['join', '加入賽事']].map(([k, label]) => (
              <button key={k} onClick={() => { setTab(k); setLobbyErr(''); }}
                className={`flex-1 py-2.5 text-sm ${tab === k ? 'bg-field-floodlight/20 text-field-floodlight' : 'text-field-chalk/50'}`}>{label}</button>
            ))}
          </div>
          {tab === 'create' ? (
            <button onClick={create} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
              {busy ? '建立中…' : '建立賽事'}
            </button>
          ) : (
            <>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && join()} placeholder="4 位數房號" inputMode="numeric"
                className="w-full text-center font-mono text-2xl tracking-[0.5em] bg-black/40 border border-field-chalk/25 rounded-xl py-3 mb-4 text-field-chalk focus:outline-none focus:border-field-floodlight/70" />
              <button onClick={join} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
                {busy ? '加入中…' : '加入賽事'}
              </button>
            </>
          )}
          {lobbyErr && <div className="mt-4 text-sm text-red-300/85">{lobbyErr}</div>}
        </div>
      </div>
    );
  }

  const v = view;
  const labels = { a: '玩家 A', b: '玩家 B' };
  const me = v.role;
  const opp = me === 'a' ? 'b' : 'a';

  // 等待對手
  if (!v.oppJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#1a1414] to-[#080606] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">把房號給對手</div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em] text-field-floodlight">{v.code}</div>
        <div className="text-field-chalk/35 text-xs">等待對手加入賽事…</div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">取消</button>
      </div>
    );
  }

  const champion = v.champion;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1414] via-[#120e0e] to-[#080606] pb-20">
      <div className="max-w-lg mx-auto px-5 py-6">
        <div className="text-center mb-6">
          <div className="text-3xl mb-1">🏆</div>
          <div className="font-display text-2xl font-black text-field-chalk">綜合比賽</div>
          <div className="font-mono text-xs text-field-chalk/35 mt-1">房號 {v.code}　你是 {labels[me]}</div>
        </div>

        {/* 系列比分 */}
        <div className="flex items-center justify-center gap-5 py-4 rounded-2xl border border-field-chalk/12 bg-black/25 mb-5">
          <div className="text-center">
            <div className="text-xs text-field-chalk/45">{labels[me]}（你）</div>
            <div className="font-display font-black text-4xl text-field-floodlight">{v.wins[me]}</div>
          </div>
          <div className="text-field-chalk/25 text-2xl">:</div>
          <div className="text-center">
            <div className="text-xs text-field-chalk/45">{labels[opp]}</div>
            <div className="font-display font-black text-4xl text-field-chalk/70">{v.wins[opp]}</div>
          </div>
        </div>

        {/* 三場賽程 */}
        <div className="space-y-2 mb-6">
          {v.schedule.map((g, i) => {
            const meta = GAME_META[g];
            const done = i < v.currentIndex;
            const current = i === v.currentIndex && !champion;
            const winner = v.results[i];
            return (
              <div key={i}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                  current ? 'border-field-floodlight/60 bg-field-floodlight/[0.08] scale-[1.02]' : done ? 'border-field-chalk/15 bg-black/20' : 'border-field-chalk/10 bg-black/10 opacity-60'
                }`}>
                <span className="text-2xl">{meta.icon}</span>
                <div className="flex-1 text-left">
                  <div className="text-sm font-bold text-field-chalk">第 {i + 1} 場　{meta.title}</div>
                  {done && winner && <div className="text-[11px]" style={{ color: winner === me ? '#f5cf6a' : '#e88' }}>{winner === me ? '你獲勝' : '對手獲勝'}</div>}
                  {current && <div className="text-[11px] text-field-floodlight">進行中…</div>}
                </div>
                {done && <span className="text-lg">{winner === me ? '✓' : '✗'}</span>}
              </div>
            );
          })}
        </div>

        {/* 冠軍 */}
        {champion ? (
          <div className="text-center rounded-2xl border-2 border-field-floodlight/40 bg-field-floodlight/[0.08] p-6">
            <div className="text-5xl mb-2">{champion === me ? '🏆' : '🥈'}</div>
            <div className="font-display text-3xl font-black mb-1" style={{ color: '#f5cf6a' }}>
              {champion === me ? '綜合冠軍！' : '綜合亞軍'}
            </div>
            <div className="text-sm text-field-chalk/50 mb-4">最終比分 {v.wins[me]} : {v.wins[opp]}</div>
            <button onClick={leave} className="px-6 py-2 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest">結束賽事</button>
          </div>
        ) : (
          <CurrentMatch v={v} me={me} busy={busy} onReport={reportWin} onAdvance={advance} labels={labels} />
        )}

        {lobbyErr && <div className="mt-4 text-sm text-red-300/85 text-center">{lobbyErr}</div>}
        <button onClick={leave} className="mt-6 mx-auto block text-field-chalk/30 text-[11px] underline underline-offset-4">離開賽事</button>
      </div>
    </div>
  );
}

/* 當前子賽事的引導卡 */
function CurrentMatch({ v, me, busy, onReport, onAdvance, labels }) {
  const g = v.schedule[v.currentIndex];
  const meta = GAME_META[g];
  const stage = v.matchStage; // 'intro' | 'playing' | 'reporting'

  // 過場動畫
  if (stage === 'intro') {
    return (
      <div className="text-center rounded-2xl border border-field-chalk/15 bg-black/30 p-6" style={{ animation: 'memePop 500ms ease-out both' }}>
        <div className="text-[11px] tracking-[0.3em] text-field-chalk/40 mb-2">第 {v.currentIndex + 1} 場</div>
        <div className="text-5xl mb-2">{meta.icon}</div>
        <div className="font-display text-2xl font-black mb-4" style={{ color: meta.color }}>{meta.title}</div>
        <button onClick={onAdvance} disabled={busy}
          className="px-8 py-3 rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 text-field-floodlight tracking-widest disabled:opacity-40">
          開始這一場
        </button>
      </div>
    );
  }

  // 進行中：導引雙方到子遊戲房，回來回報勝負
  return (
    <div className="rounded-2xl border border-field-chalk/15 bg-black/30 p-5 text-center">
      <div className="text-2xl mb-1">{meta.icon}</div>
      <div className="font-display text-lg font-bold text-field-chalk mb-1">{meta.title}　進行中</div>
      <div className="text-[11px] text-field-chalk/45 leading-relaxed mb-4">
        在下方另開的{meta.title}房完成這一場，
        <br />結束後回到這裡回報勝負。
      </div>

      {v.subRoom ? (
        <div className="mb-4 rounded-xl border border-field-floodlight/25 bg-field-floodlight/[0.05] p-3">
          <div className="text-[10px] text-field-chalk/40">這一場的房號</div>
          <div className="font-mono text-2xl tracking-[0.3em] text-field-floodlight">{v.subRoom}</div>
          <div className="text-[10px] text-field-chalk/35 mt-1">
            {v.role === 'a' ? '你是建房方，對手用此房號加入' : '用此房號進入對應遊戲'}
          </div>
        </div>
      ) : (
        v.role === 'a' && (
          <div className="text-[11px] text-field-chalk/40 mb-3">（由你先在 {meta.title} 建房，把房號填入下方）</div>
        )
      )}

      {/* 回報勝負 */}
      <div className="text-[11px] text-field-chalk/45 mb-2">這一場結果</div>
      <div className="flex gap-2">
        <button onClick={() => onReport(me)} disabled={busy}
          className="flex-1 py-2.5 rounded-xl border border-field-floodlight/50 text-field-floodlight text-sm">我贏了</button>
        <button onClick={() => onReport(me === 'a' ? 'b' : 'a')} disabled={busy}
          className="flex-1 py-2.5 rounded-xl border border-field-chalk/25 text-field-chalk/70 text-sm">對手贏了</button>
      </div>
      <div className="text-[10px] text-field-chalk/30 mt-2">雙方回報一致才會計分，避免誤按</div>
    </div>
  );
}
