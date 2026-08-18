'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Chat from './Chat';

/* ------------------------------------------------------------------
 * 單張撲克．雙人心理對戰前端
 *
 * 牌面圖：/poker/{s,h,d,c}_{2..10,J,Q,K,A}.png、牌背 /poker/back.png
 * 貼圖：/poker/stickers/taunt_1..10.png（沿用 17 撲克那組，可連發、雙方可同時按）
 * 頭像：/onepoker/av_{panic,tense,rich,feast}.png，依剩餘籌碼自動切換，雙方可見
 * 開牌：沿用 17 撲克的慢後快翻牌（pkFlip）
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
  save: (c, t) => { try { sessionStorage.setItem('onepoker_session', JSON.stringify({ code: c, token: t })); } catch {} },
  load: () => { try { return JSON.parse(sessionStorage.getItem('onepoker_session') || 'null'); } catch { return null; } },
  clear: () => { try { sessionStorage.removeItem('onepoker_session'); } catch {} },
};

const STICKERS = [
  ['taunt_1', '嗆聲'], ['taunt_2', '得意'], ['taunt_3', '冷笑'], ['taunt_4', '認真'], ['taunt_5', '不妙'],
  ['taunt_6', '思考'], ['taunt_7', '崩潰'], ['taunt_8', '挑釁'], ['taunt_9', '無言'], ['taunt_10', '爽'],
];

const RANK_LABEL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };
const cardSrc = (c) => (c ? `/poker/${c.s}_${RANK_LABEL[c.r]}.png` : '/poker/back.png');
const AVATAR = {
  panic: { img: '/onepoker/av_panic.png', label: '危急', tone: '#e05c5c' },
  tense: { img: '/onepoker/av_tense.png', label: '緊繃', tone: '#e0a24c' },
  calm: { img: null, label: '平穩', tone: '#8aa0b4' },
  rich: { img: '/onepoker/av_rich.png', label: '優勢', tone: '#5fcf8f' },
  feast: { img: '/onepoker/av_feast.png', label: '大勝', tone: '#ffd76a' },
};

function Card({ card, faceDown, flip, size = 'md', dim, glow, onClick, selected }) {
  const w = size === 'sm' ? 'w-10 sm:w-12' : size === 'lg' ? 'w-24 sm:w-28' : 'w-16 sm:w-20';
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`relative ${w} aspect-[5/7] rounded-lg overflow-hidden shadow-lg transition-transform
        ${dim ? 'opacity-45' : ''} ${onClick ? 'hover:-translate-y-1.5 cursor-pointer' : 'cursor-default'}
        ${selected ? '-translate-y-1.5' : ''}`}
      style={{
        animation: flip ? 'pkFlip 620ms cubic-bezier(.6,.02,.9,.6) both' : 'none',
        boxShadow: glow ? '0 0 0 3px #ffd76a, 0 0 22px rgba(255,215,106,0.5)'
          : selected ? '0 0 0 3px rgba(122,209,255,0.9)' : undefined,
      }}
    >
      <img src={faceDown ? '/poker/back.png' : cardSrc(card)} alt="" className="absolute inset-0 w-full h-full object-contain bg-[#0d1016]" />
    </button>
  );
}

/** 頭像＋籌碼（雙方可見，頭像隨籌碼變臉） */
function Seat({ name, chips, tier, me, bet }) {
  const av = AVATAR[tier] || AVATAR.calm;
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-2.5 ${me ? 'border-field-floodlight/35 bg-field-floodlight/[0.06]' : 'border-field-chalk/15 bg-black/25'}`}>
      <div className="relative w-14 h-14 rounded-full overflow-hidden border-2 shrink-0" style={{ borderColor: av.tone }}>
        {av.img
          ? <img src={av.img} alt={av.label} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center bg-black/50 font-display text-xl text-field-chalk/70">{name.slice(-1)}</div>}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-field-chalk/50 truncate">{name}{me && '（你）'}</div>
        <div className="font-display font-black text-2xl leading-tight" style={{ color: av.tone }}>{chips}<span className="text-xs font-normal text-field-chalk/40 ml-1">枚</span></div>
        {bet > 0 && <div className="text-[10px] text-field-chalk/45">本回合已投入 {bet}</div>}
      </div>
    </div>
  );
}

function UpDownTag({ up, total = 2, label }) {
  const down = total - up;
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px]">
      <span className="text-field-chalk/40">{label}</span>
      {up > 0 && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-bold">UP ×{up}</span>}
      {down > 0 && <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold">DOWN ×{down}</span>}
    </div>
  );
}

/* ---------------- 大廳 ---------------- */

function Lobby({ onEnter, initialError }) {
  const [tab, setTab] = useState('create');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');

  async function create() {
    setBusy(true); setErr('');
    try { const d = await api('/api/room/create', { mode: 'onepoker' }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) { setErr('房號是 4 位數字'); return; }
    setBusy(true); setErr('');
    try { const d = await api('/api/room/join', { code, mode: 'onepoker' }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#101822] via-[#0b1119] to-[#06090d]">
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="font-display text-4xl font-black text-field-chalk mb-1">單張撲克</div>
        <div className="text-field-chalk/45 text-xs tracking-[0.3em] mb-6">一張定生死．2 吃 A</div>
        <div className="text-[11px] text-field-chalk/40 leading-relaxed mb-7">
          雙方各 30 枚籌碼、20 回合。每回合各持 2 張手牌（只公開 Up／Down），
          秘密選一張出戰，底注 2 枚起，單方本回合最多投入 7 枚。
        </div>
        <div className="flex rounded-xl overflow-hidden border border-field-chalk/20 mb-5">
          {[['create', '建立房間'], ['join', '加入房間']].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setErr(''); }}
              className={`flex-1 py-2.5 text-sm ${tab === k ? 'bg-field-floodlight/20 text-field-floodlight' : 'text-field-chalk/50'}`}>{label}</button>
          ))}
        </div>
        {tab === 'create' ? (
          <button onClick={create} disabled={busy} className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40">
            {busy ? '建立中…' : '建立房間'}</button>
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

export default function OnePoker() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lobbyErr, setLobbyErr] = useState('');
  const [flip, setFlip] = useState(false);
  const [gold, setGold] = useState(null); // 'me' | 'opp'
  const [stickers, setStickers] = useState({ a: null, b: null });
  const pollRef = useRef(null);
  const lastShowdown = useRef(0);
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

  // 開牌：慢後快翻牌，1 秒後在勝方的牌亮金邊
  useEffect(() => {
    if (!view?.r?.showCards) { setGold(null); return; }
    if (view.seq === lastShowdown.current) return;
    lastShowdown.current = view.seq;
    setFlip(true); setGold(null);
    const t1 = setTimeout(() => setFlip(false), 640);
    const t2 = setTimeout(() => {
      if (view.r.tie) setGold('tie');
      else if (view.r.winner) setGold(view.r.iWonRound ? 'me' : 'opp');
    }, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [view?.seq, view?.r?.showCards]);

  // 貼圖：雙方各自獨立顯示 3 秒，可同時出現、可連發
  useEffect(() => {
    const incoming = view?.stickers;
    if (!incoming) return;
    for (const seat of ['a', 'b']) {
      const s = incoming[seat];
      if (!s || s.seq === stickerSeqRef.current[seat]) continue;
      stickerSeqRef.current[seat] = s.seq;
      setStickers((prev) => ({ ...prev, [seat]: s }));
      clearTimeout(stickerTimers.current[seat]);
      stickerTimers.current[seat] = setTimeout(() => setStickers((prev) => ({ ...prev, [seat]: null })), 3000);
    }
  }, [view?.stickers?.a?.seq, view?.stickers?.b?.seq]);

  useEffect(() => () => { clearTimeout(stickerTimers.current.a); clearTimeout(stickerTimers.current.b); }, []);

  function enter(code, token, v) { ss.save(code, token); setSession({ code, token }); setView(v); setLobbyErr(''); }
  function leave() { ss.clear(); setSession(null); setView(null); }

  async function act(action, payload) {
    if (busy && action !== 'op_sticker') return;
    if (action !== 'op_sticker') setBusy(true);
    setMsg('');
    try { const d = await api('/api/room/action', { ...session, action, payload }); setView(d.view); }
    catch (e) { setMsg(e.message); if (e.view) setView(e.view); }
    finally { if (action !== 'op_sticker') setBusy(false); }
  }

  if (!session || !view) return <Lobby onEnter={enter} initialError={lobbyErr} />;
  const v = view;
  const labels = { a: '玩家 A', b: '玩家 B' };
  const oppSeat = v.role === 'a' ? 'b' : 'a';

  if (!v.oppJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#101822] to-[#06090d] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">把房號給對手</div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em] text-field-floodlight">{v.code}</div>
        <div className="text-field-chalk/35 text-xs">等待對手加入…</div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">取消</button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  const r = v.r;
  const over = v.phase === 'over';
  const selecting = v.phase === 'select';
  const betting = v.phase === 'bet';
  const revealed = r?.revealed;

  // 加注可選金額：必須高於對手投入，且不超過 7 枚上限與自己的籌碼
  const raiseTargets = [];
  if (betting && r.myTurn) {
    for (let t = Math.max(r.bet.opp + 1, r.bet.me + 1); t <= r.maxRaise; t++) raiseTargets.push(t);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#101822] via-[#0b1119] to-[#06090d] pb-24">
      <div className="max-w-2xl mx-auto px-3 sm:px-5 pt-4">
        <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-field-chalk/12">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold text-field-chalk">單張撲克</span>
            <span className="font-mono text-xs text-field-chalk/35">房號 {v.code}　你是 {labels[v.role]}</span>
          </div>
          <span className="text-xs text-field-chalk/45">第 {v.round}/{v.totalRounds} 回合</span>
        </div>

        {/* 雙方頭像與籌碼 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Seat name={labels[v.role]} chips={v.chips.me} tier={v.avatars.me} me bet={r?.bet.me} />
          <Seat name={labels[oppSeat]} chips={v.chips.opp} tier={v.avatars.opp} bet={r?.bet.opp} />
        </div>

        {/* 對手：牌背 + Up/Down 提示 */}
        <div className="rounded-xl border border-field-chalk/12 bg-black/20 p-3 mb-3 text-center">
          <UpDownTag up={v.oppUp} label="對手手牌" />
          <div className="flex justify-center gap-2 mt-2">
            {Array.from({ length: v.oppHandCount }).map((_, i) => <Card key={i} faceDown size="sm" />)}
          </div>
        </div>

        {/* 出戰區 */}
        <div className="rounded-2xl border border-field-chalk/15 bg-black/30 p-4 mb-3">
          <div className="flex items-center justify-center gap-6 sm:gap-10">
            <div className="text-center">
              <div className="text-[10px] text-field-chalk/40 mb-1.5">對手出戰</div>
              <Card
                card={r?.oppCard}
                faceDown={!r?.oppCard}
                flip={flip && !!r?.oppCard}
                size="lg"
                dim={r?.folded && !r?.iFolded}
                glow={gold === 'opp'}
              />
            </div>
            <div className="text-center">
              <div className="font-display text-2xl text-field-chalk/25">VS</div>
              {r?.pot > 0 && revealed && <div className="text-[11px] text-field-chalk/45 mt-1">彩池 {r.pot}</div>}
            </div>
            <div className="text-center">
              <div className="text-[10px] text-field-chalk/40 mb-1.5">你的出戰</div>
              <Card
                card={r?.myCard}
                faceDown={!r?.myCard}
                size="lg"
                dim={r?.iFolded}
                glow={gold === 'me'}
              />
            </div>
          </div>

          {/* 回合結果 */}
          {revealed && (
            <div className="text-center mt-4">
              {r.folded ? (
                <div className="text-sm text-field-chalk/70">
                  {r.iFolded ? '你棄牌了' : '對手棄牌'}——<span className={r.iFolded ? 'text-red-300' : 'text-green-300'}>{r.delta >= 0 ? '+' : ''}{r.delta}</span> 枚
                  <div className="text-[10px] text-field-chalk/35 mt-1">棄牌局雙方牌都不公開</div>
                </div>
              ) : r.tie ? (
                <div className="text-sm text-field-chalk/70">平手——籌碼各自收回</div>
              ) : (
                <div className="font-display text-lg font-black" style={{ color: r.iWonRound ? '#5fcf8f' : '#e88' }}>
                  {r.iWonRound ? '你贏了這回合' : '對手贏了這回合'}　<span className="text-sm font-normal text-field-chalk/60">{r.delta >= 0 ? '+' : ''}{r.delta} 枚</span>
                </div>
              )}
              {!over && (
                <button onClick={() => act('op_next')} disabled={busy || r.ready.me}
                  className="mt-3 px-6 py-2 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-40">
                  {r.ready.me ? (r.ready.opp ? '進入下一回合…' : '等待對手確認…') : '確認，下一回合'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 我的手牌 / 下注 */}
        {!over && (
          <div className="rounded-2xl border border-field-chalk/15 bg-black/25 p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <UpDownTag up={v.myUp} label="你的手牌" />
              <span className="text-[10px] text-field-chalk/35">牌庫剩 {v.deckLeft}</span>
            </div>
            <div className="flex justify-center gap-3 mb-3">
              {v.myHand.map((c, i) => (
                <Card key={i} card={c} size="md"
                  selected={r?.myPickIndex === i}
                  dim={r?.myPickIndex !== null && r?.myPickIndex !== i}
                  onClick={selecting && r?.myPickIndex === null ? () => act('op_pick', { index: i }) : undefined} />
              ))}
            </div>

            {selecting && (
              <div className="text-center text-xs text-field-chalk/50">
                {r.myPickIndex === null ? '選一張牌出戰（對手看不到你選哪張）'
                  : r.oppPicked ? '雙方都選好了，準備下注…' : '已出牌，等待對手選牌…'}
              </div>
            )}

            {betting && (
              <div className="text-center">
                <div className="text-[11px] text-field-chalk/45 mb-2">
                  本回合先手：{labels[r.first]}　·　投入 你 {r.bet.me} / 對手 {r.bet.opp}　·　單方上限 {v.maxCommit}
                </div>
                {r.myTurn ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {r.canPass && (
                      <button onClick={() => act('op_bet', { move: 'pass' })} disabled={busy}
                        className="px-5 py-2 rounded-xl border border-field-chalk/30 text-field-chalk/75 text-sm disabled:opacity-40">PASS</button>
                    )}
                    {r.owed > 0 && (
                      <>
                        <button onClick={() => act('op_bet', { move: 'call' })} disabled={busy}
                          className="px-5 py-2 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm disabled:opacity-40">跟注 {Math.min(r.owed, v.chips.me)}</button>
                        <button onClick={() => act('op_bet', { move: 'fold' })} disabled={busy}
                          className="px-5 py-2 rounded-xl border border-red-400/45 text-red-300 text-sm disabled:opacity-40">棄牌</button>
                      </>
                    )}
                    {raiseTargets.map((t) => (
                      <button key={t} onClick={() => act('op_bet', { move: 'raise', to: t })} disabled={busy}
                        className="px-3.5 py-2 rounded-xl border border-amber-300/50 text-amber-200 text-sm disabled:opacity-40">
                        加到 {t}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-field-chalk/45">等待對手下注…{r.passedOpp && '（對手已 PASS）'}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 終局結算（不蓋盤面） */}
        {over && (
          <div className="rounded-2xl border p-4 mb-3 text-center"
            style={{ borderColor: v.result === 'draw' ? 'rgba(200,200,200,0.35)' : v.iWon ? 'rgba(95,207,143,0.45)' : 'rgba(201,72,79,0.45)',
              background: v.iWon ? 'rgba(63,155,104,0.10)' : 'rgba(201,72,79,0.08)' }}>
            <div className="text-3xl mb-1">{v.result === 'draw' ? '🤝' : v.iWon ? '🏆' : '💀'}</div>
            <div className="font-display text-2xl font-black mb-1" style={{ color: v.result === 'draw' ? '#ccc' : v.iWon ? '#5fcf8f' : '#e88' }}>
              {v.result === 'draw' ? '平手' : v.iWon ? '你贏了！' : '你輸了'}
            </div>
            <div className="text-xs text-field-chalk/55">
              {v.overReason === 'bust' ? '一方籌碼歸零' : `${v.totalRounds} 回合結束`}　·　你 {v.chips.me} 枚 / 對手 {v.chips.opp} 枚
            </div>
            <div className="flex gap-2 justify-center mt-4">
              <button onClick={() => act('op_rematch')} disabled={busy}
                className="px-5 py-2 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-40">再來一場</button>
              <button onClick={leave} className="px-5 py-2 rounded-xl border border-field-chalk/25 text-field-chalk/60 text-sm tracking-widest">離開房間</button>
            </div>
          </div>
        )}

        {/* 貼圖列 */}
        <div className="mb-3">
          <div className="text-[10px] text-field-chalk/35 mb-1 text-center">貼圖（可連發，雙方也可以同時按）</div>
          <div className="flex flex-wrap justify-center gap-2">
            {STICKERS.map(([key, label]) => (
              <button key={key} onClick={() => act('op_sticker', { name: key })} title={label}
                className="w-10 h-10 rounded-lg overflow-hidden border border-field-chalk/20 hover:border-field-floodlight">
                <img src={`/poker/stickers/${key}.png`} alt={label} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        {/* 對局紀錄：棄牌局只看得到自己的牌 */}
        <div className="rounded-2xl border border-field-chalk/12 bg-black/20 p-3">
          <div className="text-[11px] tracking-[0.2em] text-field-chalk/40 mb-2">對局紀錄</div>
          {v.history.length === 0 ? (
            <div className="text-[11px] text-field-chalk/30">尚無紀錄</div>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="text-field-chalk/35">
                  <tr className="text-left">
                    <th className="py-1 font-normal">局</th>
                    <th className="py-1 font-normal">你的牌</th>
                    <th className="py-1 font-normal">對手</th>
                    <th className="py-1 font-normal text-right">增減</th>
                    <th className="py-1 font-normal text-right">你/對手籌碼</th>
                  </tr>
                </thead>
                <tbody>
                  {[...v.history].reverse().map((h) => (
                    <tr key={h.round} className="border-t border-field-chalk/8">
                      <td className="py-1 text-field-chalk/50">{h.round}</td>
                      <td className="py-1 font-mono text-field-chalk/85">{h.myCard ? RANK_LABEL[h.myCard.r] : '—'}</td>
                      <td className="py-1 font-mono text-field-chalk/60">
                        {h.oppCard ? RANK_LABEL[h.oppCard.r] : <span className="text-field-chalk/25">未公開</span>}
                      </td>
                      <td className={`py-1 text-right font-bold ${h.delta > 0 ? 'text-green-300' : h.delta < 0 ? 'text-red-300' : 'text-field-chalk/40'}`}>
                        {h.delta > 0 ? '+' : ''}{h.delta}
                        {h.folded && <span className="ml-1 text-[9px] text-field-chalk/35">{h.iFolded ? '(你棄)' : '(對手棄)'}</span>}
                        {h.tie && <span className="ml-1 text-[9px] text-field-chalk/35">(平)</span>}
                      </td>
                      <td className="py-1 text-right text-field-chalk/45 font-mono">{h.chipsMe}/{h.chipsOpp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {msg && <div className="mt-3 text-center text-sm text-red-300/85">{msg}</div>}

        <div className="mt-4 text-center text-[10px] text-field-chalk/25 leading-relaxed">
          A &gt; K &gt; Q &gt; J &gt; 10 &gt; … &gt; 2，不看花色；但「2」遇到「A」時 2 獲勝。
        </div>
      </div>

      {/* 貼圖彈出：雙方各一側 */}
      {['a', 'b'].map((seat) => {
        const s = stickers[seat];
        if (!s) return null;
        const mine = seat === v.role;
        return (
          <div key={seat} className={`fixed bottom-28 z-[60] pointer-events-none ${mine ? 'right-4' : 'left-4'}`}
            style={{ animation: 'memePop 400ms cubic-bezier(.34,1.56,.64,1) both' }}>
            <img src={`/poker/stickers/${s.name}.png`} alt="" className="w-40 h-40 sm:w-56 sm:h-56 object-contain drop-shadow-2xl" />
          </div>
        );
      })}

      <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
    </div>
  );
}
