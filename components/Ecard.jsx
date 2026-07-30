'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Chat from './Chat';
import SeriesBar, { MatchPointMeme } from './SeriesBar';

/* ------------------------------------------------------------------
 * E 卡．雙人心理對戰前端
 * 角色圖：/ecard/{emperor,slave,citizen,back}.png
 * 貼圖：/ecard/sticker_{name}.png（顯示 3 秒，每回合限 3 次）
 * 牌桌可見雙方手牌背與換序；翻牌慢後快。
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
  save: (c, t) => { try { sessionStorage.setItem('ecard_session', JSON.stringify({ code: c, token: t })); } catch {} },
  load: () => { try { return JSON.parse(sessionStorage.getItem('ecard_session') || 'null'); } catch { return null; } },
  clear: () => { try { sessionStorage.removeItem('ecard_session'); } catch {} },
};

const CARD_IMG = { emperor: '/ecard/emperor.png', slave: '/ecard/slave.png', citizen: '/ecard/citizen.png' };
const STICKERS = [
  ['taunt', '挑釁'], ['eat', '吃掉'], ['serious', '認真'], ['confident', '自信'], ['dog', '狗懷疑'],
  ['cat', '貓問號'], ['emperor_face', '皇帝'], ['slave_face', '奴隸'], ['honest', '誠實'],
];

function Card({ role, faceDown, flip, small, dim }) {
  return (
    <div className={`relative ${small ? 'w-11' : 'w-16 sm:w-20'} aspect-[5/7] rounded-lg overflow-hidden shadow-lg ${dim ? 'opacity-50' : ''}`}
      style={{ animation: flip ? 'ecFlip 560ms cubic-bezier(.6,.02,.9,.6) both' : 'none' }}>
      <img src={faceDown ? '/ecard/back.png' : CARD_IMG[role]} alt="" className="absolute inset-0 w-full h-full object-contain bg-[#0d0a12]" />
    </div>
  );
}

/* ---------------- 大廳 ---------------- */

function Lobby({ onEnter, initialError }) {
  const [tab, setTab] = useState('create');
  const [code, setCode] = useState('');
  const [series, setSeries] = useState('BO1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');

  async function create() {
    setBusy(true); setErr('');
    try { const d = await api('/api/room/create', { mode: 'ecard', seriesMode: series }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) { setErr('房號是 4 位數字'); return; }
    setBusy(true); setErr('');
    try { const d = await api('/api/room/join', { code, mode: 'ecard' }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#171021] via-[#100b18] to-[#08060c]">
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="font-display text-4xl font-black text-field-chalk mb-1">E 卡</div>
        <div className="text-field-chalk/45 text-xs tracking-[0.3em] mb-8">皇帝．市民．奴隸——三者相剋</div>
        <div className="flex rounded-xl overflow-hidden border border-field-chalk/20 mb-5">
          {[['create', '建立房間'], ['join', '加入房間']].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setErr(''); }}
              className={`flex-1 py-2.5 text-sm ${tab === k ? 'bg-field-floodlight/20 text-field-floodlight' : 'text-field-chalk/50'}`}>{label}</button>
          ))}
        </div>
        {tab === 'create' ? (
          <>
            <div className="text-[10px] tracking-[0.25em] text-field-chalk/35 mb-2">賽制</div>
            <div className="flex gap-2 mb-5">
              {['BO1', 'BO3', 'BO5'].map((m) => (
                <button key={m} onClick={() => setSeries(m)}
                  className={`flex-1 py-3 rounded-xl border-2 ${series === m ? 'border-field-floodlight text-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20 text-field-chalk/50'}`}>
                  <div className="font-bold">{m}</div><div className="text-[10px] opacity-70">先 {m === 'BO5' ? 3 : m === 'BO3' ? 2 : 1} 勝</div>
                </button>
              ))}
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

export default function Ecard() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lobbyErr, setLobbyErr] = useState('');
  const [stakeVal, setStakeVal] = useState(1);
  const [flip, setFlip] = useState(false);
  const [goldSide, setGoldSide] = useState(null); // 分勝負後亮金邊的一方 'me'|'opp'
  const [sticker, setSticker] = useState(null); // { role, name }
  const [showGameOver, setShowGameOver] = useState(false);
  const pollRef = useRef(null);
  const lastTrickSeq = useRef(0);
  const lastStickerSeq = useRef(0);

  useEffect(() => { const s = ss.load(); if (s?.code && s?.token) setSession(s); }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try { const d = await api('/api/room/state', session); setView(d.view); }
    catch (e) { if (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN') { ss.clear(); setSession(null); setView(null); setLobbyErr('房間已過期或不存在'); } }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    pollRef.current = setInterval(refresh, 1500);
    return () => clearInterval(pollRef.current);
  }, [session, refresh]);

  // 翻牌動畫：雙方都出牌時，慢動作翻牌；分勝負則 1 秒後勝方亮金邊
  useEffect(() => {
    if (view?.r?.bothPlayed && view.seq > lastTrickSeq.current) {
      lastTrickSeq.current = view.seq;
      setFlip(true);
      setGoldSide(null);
      const t = setTimeout(() => setFlip(false), 600);
      // 分出勝負（進入 roundEnd 且有勝方）→ 1 秒後在勝方的牌亮金邊
      let t2;
      if (view.phase === 'roundEnd' && view.r?.winner) {
        t2 = setTimeout(() => setGoldSide(view.r.winner === view.role ? 'me' : 'opp'), 1000);
      }
      return () => { clearTimeout(t); if (t2) clearTimeout(t2); };
    }
  }, [view?.seq, view?.r?.bothPlayed]);

  // 離開回合結束畫面時清掉金邊
  useEffect(() => {
    if (view?.phase !== 'roundEnd') setGoldSide(null);
  }, [view?.phase]);

  // 對手貼圖：顯示 3 秒
  useEffect(() => {
    const s = view?.lastSticker;
    if (s && s.seq > lastStickerSeq.current) {
      lastStickerSeq.current = s.seq;
      setSticker(s);
      const t = setTimeout(() => setSticker(null), 3000);
      return () => clearTimeout(t);
    }
  }, [view?.lastSticker?.seq]);

  // 一場結束時，先讓最後一輪結果顯示，延遲 1.4 秒再跳結算框
  useEffect(() => {
    if (view?.phase === 'gameover') {
      const t = setTimeout(() => setShowGameOver(true), 1400);
      return () => clearTimeout(t);
    }
    setShowGameOver(false);
  }, [view?.phase, view?.series?.gameNo]);

  function enter(code, token, v) { ss.save(code, token); setSession({ code, token }); setView(v); setLobbyErr(''); }
  function leave() { ss.clear(); setSession(null); setView(null); }

  async function act(action, payload) {
    if (busy && action !== 'ec_sticker') return;
    if (action !== 'ec_sticker') setBusy(true);
    setMsg('');
    try { const d = await api('/api/room/action', { ...session, action, payload }); setView(d.view); }
    catch (e) { setMsg(e.message); if (e.view) setView(e.view); }
    finally { if (action !== 'ec_sticker') setBusy(false); }
  }

  if (!session || !view) return <Lobby onEnter={enter} initialError={lobbyErr} />;
  const v = view;
  const labels = { a: '玩家 A', b: '玩家 B' };

  if (!v.oppJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#171021] to-[#08060c] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">把房號給對手</div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em] text-field-floodlight">{v.code}</div>
        <SeriesBar series={v.series} labels={labels} me={v.role} />
        <div className="text-field-chalk/35 text-xs">等待對手加入…</div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">取消</button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  const r = v.r;
  const gameOver = v.phase === 'gameover';
  const seriesOver = v.series?.over;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#171021] via-[#100b18] to-[#08060c] pb-24">
      <div className="max-w-2xl mx-auto px-3 sm:px-5 pt-4">
        <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-field-chalk/12">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold text-field-chalk">E 卡</span>
            <span className="font-mono text-xs text-field-chalk/35">房號 {v.code}　你是 {labels[v.role]}</span>
          </div>
          {v.round >= 0 && <span className="text-xs text-field-chalk/45">第 {v.round + 1}/{v.totalRounds} 回合</span>}
        </div>

        <SeriesBar series={v.series} labels={labels} me={v.role} />

        {/* 總分 */}
        <div className="grid grid-cols-2 gap-2 my-3">
          <div className="rounded-xl border border-field-floodlight/30 bg-field-floodlight/[0.06] p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">你的總分</div>
            <div className="font-display font-black text-2xl text-field-floodlight">{v.scores?.me ?? 0}</div>
          </div>
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">對手總分</div>
            <div className="font-display font-black text-2xl text-field-chalk/80">{v.scores?.opp ?? 0}</div>
          </div>
        </div>

        {r && (
          <>
            {/* 主導與角色 */}
            <div className="text-center text-[11px] text-field-chalk/50 mb-2">
              本回合主導：<span className="text-field-floodlight">{labels[r.leader]}</span>
              {r.myRoleSide && <>　你是 <span className={r.myRoleSide === 'emperor' ? 'text-yellow-300' : 'text-red-300'}>{r.myRoleSide === 'emperor' ? '皇帝方' : '奴隸方'}</span></>}
              {r.stake && <>　注額 <span className="text-field-floodlight">{r.stake}</span></>}
            </div>

            {/* 對手手牌背 + 換序同步 */}
            <div className="text-center mb-2">
              <div className="text-[10px] text-field-chalk/40 mb-1">對手手牌（{r.oppHandCount} 張）</div>
              <div className="flex justify-center gap-1">
                {Array.from({ length: r.oppHandCount }).map((_, i) => (
                  <Card key={i} faceDown small />
                ))}
                {r.oppPlayed && r.oppPlayed !== 'hidden' && (
                  <div className="ml-2"><Card role={r.oppPlayed} flip={flip} small /></div>
                )}
                {r.oppPlayed === 'hidden' && <div className="ml-2"><Card faceDown small dim /></div>}
              </div>
            </div>

            {/* 中央對戰區（出牌中與分勝負後都顯示，分勝負時勝方亮金邊） */}
            {(v.phase === 'play' || v.phase === 'roundEnd') && (
              <div className="my-4 py-3 rounded-xl border border-field-chalk/12 bg-black/25 text-center">
                <div className="text-[11px] text-field-chalk/45 mb-2">
                  {v.phase === 'roundEnd'
                    ? (r.winnerSide === 'emperor' ? '皇帝方勝' : '奴隸方勝')
                    : `第 ${r.trick + 1} 輪　·　${r.firstPlayer === v.role ? '你' : '對手'}先出`}
                </div>
                <div className="flex justify-center items-center gap-8">
                  <div>
                    <div className="text-[10px] text-field-chalk/40 mb-1">你出的</div>
                    {r.myPlayed ? <div className={goldSide === 'me' ? 'pk-win-glow' : ''}><Card role={r.myPlayed} flip={flip} /></div> : <div className="w-16 sm:w-20 aspect-[5/7] rounded-lg border-2 border-dashed border-field-chalk/20" />}
                  </div>
                  <div className="text-field-chalk/30 text-2xl">VS</div>
                  <div>
                    <div className="text-[10px] text-field-chalk/40 mb-1">對手出的</div>
                    {r.oppPlayed && r.oppPlayed !== 'hidden' ? <div className={goldSide === 'opp' ? 'pk-win-glow' : ''}><Card role={r.oppPlayed} flip={flip} /></div>
                      : r.oppPlayed === 'hidden' ? <Card faceDown />
                        : <div className="w-16 sm:w-20 aspect-[5/7] rounded-lg border-2 border-dashed border-field-chalk/20" />}
                  </div>
                </div>
              </div>
            )}

            {/* 操作區 */}
            <EcardControls v={v} r={r} busy={busy} stakeVal={stakeVal} setStakeVal={setStakeVal} onAct={act} labels={labels} />
          </>
        )}

        {/* 貼圖列 */}
        <div className="mt-4">
          <div className="text-[10px] text-field-chalk/35 mb-1 text-center">貼圖（每回合限 3 次）</div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {STICKERS.map(([key, label]) => (
              <button key={key} onClick={() => act('ec_sticker', { name: key })}
                className="w-10 h-10 rounded-lg border border-field-chalk/15 bg-black/30 hover:border-field-floodlight overflow-hidden" title={label}>
                <img src={`/ecard/sticker_${key}.png`} alt={label} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        {msg && <div className="text-[12px] text-red-300/85 my-3 text-center">{msg}</div>}

        {v.log?.length > 0 && (
          <div className="rounded-xl border border-field-chalk/12 bg-black/25 px-3 py-2 max-h-28 overflow-y-auto mt-3">
            {v.log.map((l, i) => (
              <div key={i} className={`text-[11px] leading-relaxed ${/🏅|🏆|🏁/.test(l.text) ? 'text-field-floodlight/90' : 'text-field-chalk/45'}`}>{l.text}</div>
            ))}
          </div>
        )}

        <button onClick={leave} className="mt-6 text-field-chalk/30 text-[11px] underline underline-offset-4">離開房間</button>
      </div>

      {/* 貼圖顯示（雙方都顯示，放大兩倍）*/}
      {sticker && (
        <div className={`fixed z-[60] pointer-events-none ${sticker.role === v.role ? 'bottom-24 right-6' : 'bottom-24 left-6'}`} style={{ animation: 'stickerPop 3s ease-out both' }}>
          <img src={`/ecard/sticker_${sticker.name}.png`} alt="" className="w-56 h-56 object-contain drop-shadow-2xl" />
          <div className="text-center text-[11px] text-field-chalk/60 mt-1">{sticker.role === v.role ? '你' : '對手'}</div>
        </div>
      )}

      {v.series?.matchPoint && <MatchPointMeme />}

      {/* 一場結束 */}
      {gameOver && !seriesOver && showGameOver && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-field-chalk/20 bg-[#120c1a] p-7 text-center">
            <div className="font-display text-2xl font-black mb-2" style={{ color: v.iWon ? '#f5cf6a' : '#e88' }}>
              {v.result ? (v.iWon ? '你贏了這場' : '對手贏了這場') : '這場平手'}
            </div>
            <div className="text-xs text-field-chalk/50 mb-1">系列比分 {v.series.wins[v.role]} : {v.series.wins[v.role === 'a' ? 'b' : 'a']}</div>
            <div className="text-[11px] text-field-chalk/35 mb-5">總分 你 {v.scores.me} / 對手 {v.scores.opp}</div>
            <button onClick={() => act('ec_next')} disabled={busy} className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-40">下一場</button>
            <button onClick={leave} className="mt-3 text-field-chalk/40 text-xs underline underline-offset-4">離開</button>
          </div>
        </div>
      )}

      {seriesOver && showGameOver && (
        <div className="fixed inset-0 z-[70] bg-black/88 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-field-floodlight/30 bg-[#120c1a] p-7 text-center">
            <div className="text-5xl mb-3">{v.series.champion === v.role ? '🏆' : '🥈'}</div>
            <div className="font-display text-3xl font-black mb-2" style={{ color: '#f5cf6a' }}>
              {v.series.champion === v.role ? '系列賽冠軍！' : '系列賽落敗'}
            </div>
            <div className="text-xs text-field-chalk/50 mb-5">最終比分 {v.series.wins[v.role]} : {v.series.wins[v.role === 'a' ? 'b' : 'a']}</div>
            <button onClick={() => act('ec_rematch')} disabled={busy} className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest">再來一輪</button>
            <button onClick={leave} className="mt-3 text-field-chalk/40 text-xs underline underline-offset-4">離開</button>
          </div>
        </div>
      )}

      <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
    </div>
  );
}

/* ---------------- 操作區 ---------------- */

function EcardControls({ v, r, busy, stakeVal, setStakeVal, onAct, labels }) {
  if (v.phase === 'chooseRole') {
    if (!r.iAmLeader) return <div className="text-center text-sm text-field-chalk/50 py-3">等待 {labels[r.leader]} 選擇角色…</div>;
    return (
      <div className="rounded-xl border border-field-chalk/15 bg-black/30 p-3">
        <div className="text-center text-[11px] text-field-chalk/45 mb-3">你是本回合主導方，選擇要當哪一方</div>
        <div className="flex gap-3">
          <button onClick={() => onAct('ec_role', { side: 'emperor' })} disabled={busy}
            className="flex-1 py-3 rounded-xl border-2 border-yellow-400/40 text-yellow-200 hover:bg-yellow-400/10">
            👑 皇帝方<div className="text-[10px] opacity-70 mt-0.5">1 皇帝 + 4 市民</div>
          </button>
          <button onClick={() => onAct('ec_role', { side: 'slave' })} disabled={busy}
            className="flex-1 py-3 rounded-xl border-2 border-red-400/40 text-red-200 hover:bg-red-400/10">
            ⛓️ 奴隸方<div className="text-[10px] opacity-70 mt-0.5">1 奴隸 + 4 市民　贏 5 倍</div>
          </button>
        </div>
      </div>
    );
  }

  if (v.phase === 'setStake') {
    if (!r.iSetStake) return <div className="text-center text-sm text-field-chalk/50 py-3">等待 {labels[r.stakeSetter]} 決定注額…</div>;
    return (
      <div className="rounded-xl border border-field-chalk/15 bg-black/30 p-3">
        <div className="text-center text-[11px] text-field-chalk/45 mb-2">
          由你決定本回合注額（1~{r.stakeMax}）{r.stakeSetter !== r.leader && '　—— 這是對方主導、由你定注'}
        </div>
        <div className="flex items-center gap-3">
          <input type="range" min={1} max={r.stakeMax} value={Math.min(stakeVal, r.stakeMax)}
            onChange={(e) => setStakeVal(Number(e.target.value))} className="flex-1 accent-[#f5cf6a]" />
          <span className="font-mono text-lg text-field-floodlight w-8 text-center">{Math.min(stakeVal, r.stakeMax)}</span>
          <button onClick={() => onAct('ec_stake', { stake: Math.min(stakeVal, r.stakeMax) })} disabled={busy}
            className="px-4 py-2 rounded-lg border border-field-floodlight/60 text-field-floodlight">確定</button>
        </div>
      </div>
    );
  }

  if (v.phase === 'play') {
    if (!r.myTurnToPlay) return <div className="text-center text-sm text-field-chalk/50 py-3">等待對手出牌…</div>;
    return (
      <div className="rounded-xl border border-field-chalk/15 bg-black/30 p-3">
        <div className="text-center text-[11px] text-field-chalk/45 mb-2">選一張出牌（你是{r.myRoleSide === 'emperor' ? '皇帝' : '奴隸'}方）</div>
        <div className="flex justify-center gap-2 flex-wrap">
          {r.myHand?.map((card, i) => (
            <button key={i} onClick={() => onAct('ec_play', { cardIndex: i })} disabled={busy}
              className="transition-transform hover:-translate-y-2">
              <Card role={card} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (v.phase === 'roundEnd') {
    return (
      <div className="rounded-xl border border-field-floodlight/25 bg-field-floodlight/[0.06] p-4 text-center">
        <div className="font-display font-bold text-lg" style={{ color: r.winner === v.role ? '#f5cf6a' : '#bbb' }}>
          {r.winnerSide === 'emperor' ? '皇帝方勝' : '奴隸方勝'}（{labels[r.winner]}）
        </div>
        <div className="text-sm text-field-chalk/60 mt-1">得 {r.gain} 分</div>
        <button onClick={() => onAct('ec_next_round')} disabled={busy}
          className="mt-3 px-6 py-2 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest">下一回合</button>
      </div>
    );
  }
  return null;
}
