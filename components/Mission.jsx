'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Chat from './Chat';

/* ------------------------------------------------------------------
 * 密語連線．單向引導猜詞前端
 *  ‧ 引導者：看得到全部答案（關鍵綠/炸彈紅/路人灰底色），出提示
 *  ‧ 猜的人：看不到答案，依提示點格子
 * 翻牌慢動作；踩炸彈先翻出結果再跳失敗畫面（花臉貓）。
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
  save: (c, t) => { try { sessionStorage.setItem('mission_session', JSON.stringify({ code: c, token: t })); } catch {} },
  load: () => { try { return JSON.parse(sessionStorage.getItem('mission_session') || 'null'); } catch { return null; } },
  clear: () => { try { sessionStorage.removeItem('mission_session'); } catch {} },
};

const ROLE_COLOR = {
  key: { solid: '#3f9b68', soft: 'rgba(63,155,104,0.22)', label: '關鍵人物' },
  civ: { solid: '#8b93a8', soft: 'rgba(139,147,168,0.18)', label: '路人' },
  bomb: { solid: '#c9484f', soft: 'rgba(201,72,79,0.20)', label: '炸彈' },
};
const roleImg = (role, n) => `/mission/${role === 'key' ? 'key' : role === 'civ' ? 'civilian' : 'bomb'}_${n}.png`;
const MS_STICKERS = [
  ['taunt_1', '柴犬'], ['taunt_2', '哈士奇'], ['taunt_3', '你這隻豬'], ['taunt_4', '要那個幹什麼'],
  ['taunt_5', '做得好'], ['taunt_6', '兄弟你懂我'], ['taunt_7', '哦是嗎'], ['taunt_8', '你認真的？'],
];

/* ---------------- 格子 ---------------- */

function Cell({ cell, canGuess, onGuess, justRevealed, showAnswer, revealAll }) {
  const revealed = cell.revealed;
  const answer = cell.answer; // 引導者未翻時可見的答案（終局時雙方都拿得到）
  const shown = cell.role; // 翻開後的真身分
  // 終局攤牌：沒被翻到的格子也把圖翻出來，但用暗一階的樣式標成「未翻開」，
  // 一眼就分得出「這局實際翻到的」和「藏著沒被找到的」。
  const openFace = revealed || (revealAll && !!shown);
  const soft = !openFace && showAnswer && answer ? ROLE_COLOR[answer].soft : 'transparent';

  return (
    <button
      onClick={() => canGuess && !revealed && onGuess(cell._idx)}
      disabled={!canGuess || revealed}
      className={`relative rounded-lg aspect-[5/7] w-full overflow-hidden transition-transform border
        ${openFace ? 'border-transparent' : 'border-field-chalk/15'}
        ${canGuess && !revealed ? 'hover:-translate-y-0.5 hover:border-field-floodlight cursor-pointer' : 'cursor-default'}`}
      style={{ background: openFace ? '#0d1016' : soft }}
    >
      {!openFace && (
        <span className="absolute inset-0 flex flex-col items-center justify-center p-1">
          <span className="font-display font-bold text-center leading-tight text-field-chalk" style={{ fontSize: cell.word.length > 2 ? '0.82rem' : '1.05rem' }}>
            {cell.word}
          </span>
          {showAnswer && answer && (
            <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full" style={{ background: ROLE_COLOR[answer].solid, opacity: 0.85 }} />
          )}
        </span>
      )}
      {openFace && (
        <span
          className="absolute inset-0"
          style={{
            animation: justRevealed
              ? 'msFlip 620ms cubic-bezier(.6,.02,.9,.6) both'
              : !revealed
                ? 'msFlip 620ms cubic-bezier(.6,.02,.9,.6) both'
                : 'none',
            opacity: revealed ? 1 : 0.62,
          }}
        >
          <img src={roleImg(shown, cell.img)} alt="" className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: revealed ? 'none' : 'grayscale(0.55)' }} />
          <span className="absolute inset-0" style={{ background: ROLE_COLOR[shown].soft, mixBlendMode: 'multiply' }} />
          <span className="absolute inset-0 rounded-lg"
            style={{ boxShadow: `inset 0 0 0 2px ${ROLE_COLOR[shown].solid}`, opacity: revealed ? 1 : 0.55 }} />
          <span className="absolute top-0 left-0 right-0 py-0.5 text-center text-[9px] font-bold text-white"
            style={{ background: ROLE_COLOR[shown].solid }}>
            {ROLE_COLOR[shown].label}
          </span>
          {!revealed && (
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-black/70 whitespace-nowrap">
              未翻開
            </span>
          )}
          <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[11px] font-display font-bold text-white bg-black/55">{cell.word}</span>
        </span>
      )}
    </button>
  );
}

/* ---------------- 大廳 ---------------- */

const DIFF_OPTS = [
  ['easy', '簡單', '關鍵15 · 炸彈1 · 9 回合'],
  ['normal', '普通', '關鍵15 · 炸彈1 · 8 回合'],
  ['hard', '困難', '關鍵15 · 炸彈2 · 7 回合'],
];

function Lobby({ onEnter, initialError }) {
  const [tab, setTab] = useState('create');
  const [code, setCode] = useState('');
  const [difficulty, setDifficulty] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');

  async function create() {
    setBusy(true); setErr('');
    try { const d = await api('/api/room/create', { mode: 'mission', difficulty }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) { setErr('房號是 4 位數字'); return; }
    setBusy(true); setErr('');
    try { const d = await api('/api/room/join', { code, mode: 'mission' }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#141a24] via-[#0f1620] to-[#0a0e14]">
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="font-display text-4xl font-black text-field-chalk mb-1">密語連線</div>
        <div className="text-field-chalk/45 text-xs tracking-[0.3em] mb-8">一人引導．一人猜詞</div>

        <div className="flex rounded-xl overflow-hidden border border-field-chalk/20 mb-5">
          {[['create', '建立房間'], ['join', '加入房間']].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setErr(''); }}
              className={`flex-1 py-2.5 text-sm ${tab === k ? 'bg-field-floodlight/20 text-field-floodlight' : 'text-field-chalk/50'}`}>{label}</button>
          ))}
        </div>

        {tab === 'create' ? (
          <>
            <div className="text-[10px] tracking-[0.25em] text-field-chalk/35 mb-2">難度</div>
            <div className="space-y-2 mb-5">
              {DIFF_OPTS.map(([k, label, desc]) => (
                <button key={k} onClick={() => setDifficulty(k)}
                  className={`w-full py-2.5 px-4 rounded-xl border-2 flex items-center justify-between ${difficulty === k ? 'border-field-floodlight text-field-floodlight bg-field-floodlight/10' : 'border-field-chalk/20 text-field-chalk/50'}`}>
                  <span className="font-bold">{label}</span>
                  <span className="text-[10px] opacity-70">{desc}</span>
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

export default function Mission() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [clueWord, setClueWord] = useState('');
  const [clueCount, setClueCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lobbyErr, setLobbyErr] = useState('');
  const [flipIdx, setFlipIdx] = useState(null);
  const [stickers, setStickers] = useState({ a: null, b: null }); // 雙方各自獨立顯示
  const [showResult, setShowResult] = useState(false); // 終局結算：踩炸彈時延後 1.2 秒，讓翻牌動畫先跑完
  const pollRef = useRef(null);
  const lastRevealSeq = useRef(0);
  const stickerSeqRef = useRef({ a: 0, b: 0 });
  const stickerTimers = useRef({ a: null, b: null });

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

  // 翻牌動畫
  useEffect(() => {
    const lr = view?.lastReveal;
    if (lr && lr.seq > lastRevealSeq.current) {
      lastRevealSeq.current = lr.seq;
      setFlipIdx(lr.index);
      const t = setTimeout(() => setFlipIdx(null), 700);
      return () => clearTimeout(t);
    }
  }, [view?.lastReveal?.seq]);

  // 終局：勝利／逾時立刻結算；踩炸彈先讓那張牌翻出來（約 1.2 秒）再結算＋攤牌
  useEffect(() => {
    if (view?.phase !== 'over') { setShowResult(false); return; }
    if (view.result === 'bomb') {
      const t = setTimeout(() => setShowResult(true), 1200);
      return () => clearTimeout(t);
    }
    setShowResult(true);
  }, [view?.phase, view?.result]);

  // 貼圖：雙方各自獨立顯示 2 秒，可同時出現、也可以連發（連發會重新計時）。
  useEffect(() => {
    const incoming = view?.stickers;
    if (!incoming) return;
    for (const seat of ['a', 'b']) {
      const s = incoming[seat];
      if (!s) continue;
      // 用 !== 而不是 >：seq 若因為重開新局而歸零，用 > 會永遠追不上而不再顯示。
      if (s.seq === stickerSeqRef.current[seat]) continue;
      stickerSeqRef.current[seat] = s.seq;
      setStickers((prev) => ({ ...prev, [seat]: s }));
      clearTimeout(stickerTimers.current[seat]);
      stickerTimers.current[seat] = setTimeout(
        () => setStickers((prev) => ({ ...prev, [seat]: null })), 2000);
    }
  }, [view?.stickers?.a?.seq, view?.stickers?.b?.seq]);

  // 卸載時清掉貼圖計時器
  useEffect(() => () => {
    clearTimeout(stickerTimers.current.a);
    clearTimeout(stickerTimers.current.b);
  }, []);

  function enter(code, token, v) { ss.save(code, token); setSession({ code, token }); setView(v); setLobbyErr(''); }
  function leave() { ss.clear(); setSession(null); setView(null); }

  async function act(action, payload) {
    if (busy && action !== 'ms_sticker') return false;
    if (action !== 'ms_sticker') setBusy(true);
    setMsg('');
    try { const d = await api('/api/room/action', { ...session, action, payload }); setView(d.view); return true; }
    catch (e) { setMsg(e.message); if (e.view) setView(e.view); return false; }
    finally { if (action !== 'ms_sticker') setBusy(false); }
  }

  if (!session || !view) return <Lobby onEnter={enter} initialError={lobbyErr} />;
  const v = view;
  const labels = { a: '玩家 A', b: '玩家 B' };

  if (!v.oppJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#141a24] to-[#0a0e14] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">把房號給對手</div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em] text-field-floodlight">{v.code}</div>
        <div className="text-field-chalk/40 text-xs">難度：{v.difficultyLabel}</div>
        <div className="text-field-chalk/35 text-xs">等待對手加入…</div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">取消</button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  // 選角色階段
  if (v.phase === 'pickRole') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#141a24] to-[#0a0e14] px-6 text-center">
        <div className="font-display text-2xl font-black text-field-chalk">選擇你的角色</div>
        <div className="text-xs text-field-chalk/45">難度：{v.difficultyLabel}　·　房號 {v.code}</div>
        <div className="flex gap-4 w-full max-w-sm">
          <button onClick={() => act('ms_pick_role', { role: 'guide' })} disabled={busy || (v.rolesTaken.guide && v.myRole !== 'guide')}
            className={`flex-1 py-6 rounded-2xl border-2 ${v.myRole === 'guide' ? 'border-field-floodlight bg-field-floodlight/15 text-field-floodlight' : v.rolesTaken.guide ? 'border-field-chalk/10 text-field-chalk/25' : 'border-field-chalk/25 text-field-chalk/70 hover:border-field-floodlight'}`}>
            <div className="text-3xl mb-2">🧭</div>
            <div className="font-bold">引導者</div>
            <div className="text-[10px] opacity-70 mt-1">看得到答案<br />出提示</div>
            {v.rolesTaken.guide && v.myRole !== 'guide' && <div className="text-[10px] mt-1 text-red-300/70">已被選走</div>}
          </button>
          <button onClick={() => act('ms_pick_role', { role: 'guesser' })} disabled={busy || (v.rolesTaken.guesser && v.myRole !== 'guesser')}
            className={`flex-1 py-6 rounded-2xl border-2 ${v.myRole === 'guesser' ? 'border-field-floodlight bg-field-floodlight/15 text-field-floodlight' : v.rolesTaken.guesser ? 'border-field-chalk/10 text-field-chalk/25' : 'border-field-chalk/25 text-field-chalk/70 hover:border-field-floodlight'}`}>
            <div className="text-3xl mb-2">🔍</div>
            <div className="font-bold">猜的人</div>
            <div className="text-[10px] opacity-70 mt-1">看不到答案<br />依提示猜</div>
            {v.rolesTaken.guesser && v.myRole !== 'guesser' && <div className="text-[10px] mt-1 text-red-300/70">已被選走</div>}
          </button>
        </div>
        {v.myRole && <div className="text-xs text-field-chalk/50">你選了「{v.myRole === 'guide' ? '引導者' : '猜的人'}」，等待對手…</div>}
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">離開</button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  const cells = v.cells.map((c, i) => ({ ...c, _idx: i }));
  const isOver = v.phase === 'over';
  // 終局攤牌：伺服器已把所有格子的身分送給雙方，等結算時機到了就整盤打開
  const revealAll = isOver && showResult && !!v.finalReveal;
  const isGuide = v.myRole === 'guide';
  const canGuess = v.myTurnToGuess && !isOver;

  const statusLine = isOver
    ? v.result === 'win' ? '🎉 挑戰成功！' : v.result === 'bomb' ? '💥 踩到炸彈' : '⏳ 回合用完'
    : isGuide
      ? (v.myTurnToClue ? '輪到你出提示' : `你提示了「${v.clue?.word}，${v.clue?.count}」，等對方猜`)
      : (v.myTurnToGuess ? `提示「${v.clue?.word}，${v.clue?.count}」，換你猜` : '等待引導者出提示…');

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#141a24] via-[#0f1620] to-[#0a0e14] pb-24">
      <div className="max-w-3xl mx-auto px-3 sm:px-5 pt-4">
        <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-field-chalk/12">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold text-field-chalk">密語連線</span>
            <span className="font-mono text-xs text-field-chalk/35">房號 {v.code}　你是{isGuide ? '引導者' : '猜的人'}</span>
          </div>
          <div className={`text-xs tracking-wider ${v.myTurnToClue || v.myTurnToGuess ? 'text-field-floodlight' : 'text-field-chalk/45'}`}>{statusLine}</div>
        </div>

        {/* 記分板 */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="rounded-xl border border-[#3f9b68]/40 bg-[#3f9b68]/[0.08] p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">已找到</div>
            <div className="font-display font-black text-xl" style={{ color: '#5fcf8f' }}>{v.found}<span className="text-xs text-field-chalk/40">/{v.keyTotal}</span></div>
          </div>
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">剩餘回合</div>
            <div className="font-display font-black text-xl text-field-floodlight">{v.roundsLeft}<span className="text-xs text-field-chalk/40">/{v.roundsTotal}</span></div>
          </div>
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">剩餘卡牌</div>
            <div className="font-display font-black text-xl text-field-chalk">{v.cardsLeft}</div>
          </div>
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">難度</div>
            <div className="font-display font-black text-xl text-field-chalk/80">{v.difficultyLabel}</div>
          </div>
        </div>

        {/* 結算（v36：改成跟盤面排在一起的區塊，不再用全螢幕彈窗蓋住攤牌結果） */}
        {isOver && showResult && (
          <div
            className={`rounded-2xl border p-4 mb-4 text-center ${
              v.result === 'win' ? 'border-[#3f9b68]/50 bg-[#3f9b68]/[0.10]'
                : v.result === 'bomb' ? 'border-red-500/45 bg-red-500/[0.08]'
                  : 'border-field-chalk/25 bg-black/30'}`}
            style={{ animation: 'memePop 500ms cubic-bezier(.34,1.56,.64,1) both' }}
          >
            {v.result === 'bomb' && (
              <img src="/mission/fail.png" alt="失敗" className="w-full max-w-[220px] mx-auto rounded-xl border-2 border-red-500/40 shadow-2xl mb-3" />
            )}
            <div className="text-4xl mb-1">{v.result === 'win' ? '🎉' : v.result === 'bomb' ? '💥' : '⏳'}</div>
            <div className="font-display text-2xl font-black mb-1"
              style={{ color: v.result === 'win' ? '#5fcf8f' : v.result === 'bomb' ? '#f0949a' : '#e8b88a' }}>
              {v.result === 'win' ? '挑戰成功！' : v.result === 'bomb' ? '踩到炸彈了…' : '回合用完了'}
            </div>
            <div className="text-xs text-field-chalk/55">
              找到 {v.found}/{v.keyTotal} 個關鍵人物　·　用掉 {v.roundsUsed}/{v.roundsTotal} 回合
            </div>
            <div className="text-[11px] text-field-chalk/40 mt-1">
              下方盤面已全部攤開，暗色＝這局沒被翻到的牌（雙方都看得到）
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-3 text-[11px]">
              {[['key', '關鍵人物'], ['civ', '路人'], ['bomb', '炸彈']].map(([r, label]) => (
                <span key={r} className="flex items-center gap-1 text-field-chalk/60">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: ROLE_COLOR[r].solid }} />
                  {label}
                </span>
              ))}
            </div>
            {/* 舊版這裡是 location.reload()，但 sessionStorage 還留著同一間「已結束」的房，
                重新整理後又回到同一張結算畫面。改成真的退回大廳重開一局。 */}
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={leave}
                className="px-6 py-2 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest">回大廳・再開一局</button>
            </div>
            <div className="text-[10px] text-field-chalk/30 mt-2">想再看一下盤面就先別按，往下滑即可</div>
          </div>
        )}

        {/* 盤面 */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {cells.map((c) => (
            <Cell key={c._idx} cell={c} canGuess={canGuess} onGuess={(i) => act('ms_guess', { index: i })} justRevealed={flipIdx === c._idx} showAnswer={isGuide} revealAll={revealAll} />
          ))}
        </div>

        {/* 提示區 */}
        {!isOver && (
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-3 mb-4">
            {v.myTurnToClue ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[140px]">
                  <div className="text-[10px] text-field-chalk/40 mb-1">提示詞　<span className="text-field-chalk/30">不能用到盤面上出現的字</span></div>
                  <input value={clueWord} onChange={(e) => setClueWord(e.target.value.slice(0, 20))} placeholder="例如：兇猛"
                    className="w-full bg-black/40 border border-field-chalk/20 rounded-lg px-3 py-2 text-field-chalk focus:outline-none focus:border-field-floodlight/60" />
                </div>
                <div>
                  <div className="text-[10px] text-field-chalk/40 mb-1">數量</div>
                  <select value={clueCount} onChange={(e) => setClueCount(Number(e.target.value))}
                    className="bg-black/40 border border-field-chalk/20 rounded-lg px-3 py-2 text-field-chalk focus:outline-none">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <button onClick={async () => {
                  const w = clueWord.trim();
                  if (!w) return;
                  // 只有真的送出成功才清空——被駁回時（例如用到盤面上的字）保留原字，不用重打
                  if (await act('ms_clue', { word: w, count: clueCount })) setClueWord('');
                }}
                  disabled={busy || !clueWord.trim()} className="px-5 py-2 rounded-lg border border-field-floodlight/60 text-field-floodlight tracking-wider disabled:opacity-30">送出提示</button>
              </div>
            ) : v.myTurnToGuess ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-field-chalk/80">提示 <span className="text-field-floodlight font-bold">「{v.clue?.word}，{v.clue?.count}」</span>　還可猜 <span className="text-field-floodlight">{v.clue?.remaining}</span> 次</div>
                <button onClick={() => act('ms_stop')} disabled={busy} className="px-4 py-1.5 rounded-lg border border-field-chalk/25 text-field-chalk/70 text-xs">放棄本回合</button>
              </div>
            ) : (
              <div className="text-sm text-field-chalk/50 text-center py-1">
                {isGuide ? (v.clue ? `等待對方猜「${v.clue.word}，${v.clue.count}」…` : '請出提示') : (v.clue ? `等待你猜…` : '等待引導者出提示…')}
              </div>
            )}
          </div>
        )}

        {msg && <div className="text-[12px] text-red-300/85 mb-3 text-center">{msg}</div>}

        {/* 貼圖 */}
        <div className="mb-4">
          <div className="text-[10px] text-field-chalk/35 mb-1 text-center">貼圖</div>
          <div className="flex flex-wrap justify-center gap-2">
            {MS_STICKERS.map(([key, label]) => (
              <button key={key} onClick={() => act('ms_sticker', { name: key })}
                className="w-11 h-11 rounded-lg border border-field-chalk/15 bg-black/30 hover:border-field-floodlight overflow-hidden" title={label}>
                <img src={`/mission/stickers/${key}.png`} alt={label} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        {/* 戰報 */}
        {v.log?.length > 0 && (
          <div className="rounded-xl border border-field-chalk/12 bg-black/25 px-3 py-2 max-h-32 overflow-y-auto">
            {v.log.map((l, i) => (
              <div key={i} className={`text-[11px] leading-relaxed ${/🎉|💥|⏳|🚀/.test(l.text) ? 'text-field-floodlight/90' : 'text-field-chalk/45'}`}>{l.text}</div>
            ))}
          </div>
        )}

        <button onClick={leave} className="mt-6 text-field-chalk/30 text-[11px] underline underline-offset-4">離開房間</button>
      </div>

      {/* 貼圖顯示 */}
      {['a', 'b'].map((seat) => {
        const s = stickers[seat];
        if (!s) return null;
        // key 帶上 seq：連發同一張時強制重新掛載，動畫才會重播
        return (
          <div key={`${seat}-${s.seq}`}
            className={`fixed bottom-24 z-[60] pointer-events-none ${seat === v.seat ? 'right-6' : 'left-6'}`}
            style={{ animation: 'stickerPop 2s ease-out both' }}>
            {/* 尺寸放大兩倍：w-28/h-28 → w-56/h-56 */}
            <img src={`/mission/stickers/${s.name}.png`} alt="" className="w-56 h-56 object-contain drop-shadow-2xl" />
            <div className="text-center text-[11px] text-field-chalk/60 mt-1">{seat === v.seat ? '你' : '對手'}</div>
          </div>
        );
      })}

      <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
    </div>
  );
}
