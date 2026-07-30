'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Chat from './Chat';
import SeriesBar, { MatchPointMeme } from './SeriesBar';

/* ------------------------------------------------------------------
 * 17 張撲克．雙人牌桌前端
 * 牌面圖：/poker/{d,c,h,s}_{J,Q,K,A}.png、joker.png、back.png
 *   紅心 A 有 40% 機率顯示特殊臉 h_A_special.png（彩蛋）
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
  save: (c, t) => { try { sessionStorage.setItem('poker_session', JSON.stringify({ code: c, token: t })); } catch {} },
  load: () => { try { return JSON.parse(sessionStorage.getItem('poker_session') || 'null'); } catch { return null; } },
  clear: () => { try { sessionStorage.removeItem('poker_session'); } catch {} },
};

const SUIT = ['d', 'c', 'h', 's'];
const RANK = ['J', 'Q', 'K', 'A'];

// 卡片圖檔路徑。紅心 A 以 40% 機率用特殊臉（用穩定亂數依卡片位置決定，避免每次輪詢跳動）
function cardSrc(card, eggFlag) {
  if (!card) return '/poker/back.png';
  if (card.joker) return '/poker/joker.png';
  const s = SUIT[card.suit];
  const r = RANK[card.rank];
  if (s === 'h' && r === 'A' && eggFlag) return '/poker/h_A_special.png';
  return `/poker/${s}_${r}.png`;
}

function CardImg({ card, faceDown, eggFlag, flip, small }) {
  return (
    <div
      className={`relative ${small ? 'w-12' : 'w-16 sm:w-20'} aspect-[5/7] rounded-lg overflow-hidden shadow-lg`}
      style={{ animation: flip ? 'pkFlip 560ms cubic-bezier(.6,.02,.9,.6) both' : 'none' }}
    >
      <img src={faceDown ? '/poker/back.png' : cardSrc(card, eggFlag)} alt="" className="absolute inset-0 w-full h-full object-contain bg-[#0d1016]" />
    </div>
  );
}

/* ---------------- 大廳（含 BO 選擇）---------------- */

function Lobby({ onEnter, initialError }) {
  const [tab, setTab] = useState('create');
  const [code, setCode] = useState('');
  const [series, setSeries] = useState('BO1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');

  async function create() {
    setBusy(true); setErr('');
    try {
      const d = await api('/api/room/create', { mode: 'poker', seriesMode: series });
      onEnter(d.code, d.token, d.view);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) { setErr('房號是 4 位數字'); return; }
    setBusy(true); setErr('');
    try {
      const d = await api('/api/room/join', { code, mode: 'poker' });
      onEnter(d.code, d.token, d.view);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1c1712] via-[#14100c] to-[#0a0806]">
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="font-display text-4xl font-black text-field-chalk mb-1">17 張撲克</div>
        <div className="text-field-chalk/45 text-xs tracking-[0.3em] mb-8">JQKA＋鬼牌．六回合定勝負</div>

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
          </>
        )}
        {err && <div className="mt-4 text-sm text-red-300/85">{err}</div>}
      </div>
    </div>
  );
}

/* ---------------- 牌型示範面板 ---------------- */

// 8 種牌型的示範牌組（由大到小），用實際牌面圖展示
const HAND_DEMOS = [
  { name: '帶鬼牌五條', cards: [{ suit: 3, rank: 3 }, { suit: 2, rank: 3 }, { suit: 1, rank: 3 }, { suit: 0, rank: 3 }, { joker: true }] },
  { name: '帶鬼牌同花順', cards: [{ suit: 2, rank: 0 }, { suit: 2, rank: 1 }, { suit: 2, rank: 2 }, { suit: 2, rank: 3 }, { joker: true }] },
  { name: '四條', cards: [{ suit: 3, rank: 2 }, { suit: 2, rank: 2 }, { suit: 1, rank: 2 }, { suit: 0, rank: 2 }, { suit: 3, rank: 0 }] },
  { name: '葫蘆', cards: [{ suit: 3, rank: 3 }, { suit: 2, rank: 3 }, { suit: 1, rank: 3 }, { suit: 3, rank: 1 }, { suit: 2, rank: 1 }] },
  { name: '順子', cards: [{ joker: true }, { suit: 0, rank: 0 }, { suit: 1, rank: 1 }, { suit: 2, rank: 2 }, { suit: 3, rank: 3 }] },
  { name: '三條', cards: [{ suit: 3, rank: 3 }, { suit: 2, rank: 3 }, { suit: 1, rank: 3 }, { suit: 3, rank: 1 }, { suit: 2, rank: 0 }] },
  { name: '兩對', cards: [{ suit: 3, rank: 3 }, { suit: 2, rank: 3 }, { suit: 3, rank: 2 }, { suit: 2, rank: 2 }, { suit: 1, rank: 0 }] },
  { name: '一對', cards: [{ suit: 3, rank: 3 }, { suit: 2, rank: 3 }, { suit: 3, rank: 2 }, { suit: 2, rank: 1 }, { suit: 1, rank: 0 }] },
];

function MiniCard({ card }) {
  return (
    <div className="w-6 aspect-[5/7] rounded overflow-hidden shrink-0">
      <img src={cardSrc(card, false)} alt="" className="w-full h-full object-contain bg-[#0d1016]" />
    </div>
  );
}

function HandRankPanel({ current }) {
  return (
    <div className="rounded-xl border border-field-chalk/12 bg-black/25 p-3">
      <div className="text-[11px] tracking-wider text-field-chalk/50 mb-2 text-center">牌型大小（大 → 小）</div>
      <div className="space-y-1.5">
        {HAND_DEMOS.map((h, i) => {
          const active = current === h.name;
          return (
            <div key={h.name} className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${active ? 'bg-field-floodlight/15 ring-1 ring-field-floodlight/50' : ''}`}>
              <span className="font-mono text-[10px] text-field-chalk/30 w-3">{i + 1}</span>
              <div className="flex gap-0.5">{h.cards.map((c, j) => <MiniCard key={j} card={c} />)}</div>
              <span className={`text-[10px] ml-auto ${active ? 'text-field-floodlight font-bold' : 'text-field-chalk/55'}`}>{h.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- 貼圖列 ---------------- */

const PK_STICKER_LABELS = [['taunt_1', '超大貓'], ['taunt_2', '好大'], ['taunt_3', '大概這麼大吧'], ['taunt_4', '你輸定了'], ['taunt_5', '算我倒楣'], ['taunt_6', '嘿嘿']];

function StickerBar({ onSend, busy }) {
  return (
    <div>
      <div className="text-[10px] text-field-chalk/35 mb-1 text-center">嘲諷貼圖（2 秒內不能連點）</div>
      <div className="flex flex-wrap justify-center gap-2">
        {PK_STICKER_LABELS.map(([key, label]) => (
          <button key={key} onClick={() => onSend(key)} disabled={busy}
            className="w-12 h-12 rounded-lg border border-field-chalk/15 bg-black/30 hover:border-field-floodlight overflow-hidden" title={label}>
            <img src={`/poker/stickers/${key}.png`} alt={label} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 主元件 ---------------- */

export default function Poker() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [lobbyErr, setLobbyErr] = useState('');
  const [selDiscards, setSelDiscards] = useState([]);
  const [raiseAmt, setRaiseAmt] = useState(1);
  const [showFlip, setShowFlip] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [stickers, setStickers] = useState({ a: null, b: null }); // 雙方各自獨立顯示
  const [showPanel, setShowPanel] = useState(false); // 手機版牌型面板收展
  const [goldSide, setGoldSide] = useState(null); // 開牌後亮金邊的一方 'me'|'opp'
  const pollRef = useRef(null);
  const stickerSeqRef = useRef({ a: 0, b: 0 });
  const stickerTimers = useRef({ a: null, b: null });
  const lastSeq = useRef(0);
  const eggRef = useRef(Math.random() < 0.4); // 本裝置此局的紅心A彩蛋旗標

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

  // 偵測開牌 → 播翻牌動畫，並重抽彩蛋旗標
  useEffect(() => {
    const rs = view?.round_state;
    if (rs?.reveal && view.seq > lastSeq.current) {
      lastSeq.current = view.seq;
      eggRef.current = Math.random() < 0.4;
      setShowFlip(true);
      const t = setTimeout(() => setShowFlip(false), 600);
      return () => clearTimeout(t);
    }
    if (view?.seq) lastSeq.current = Math.max(lastSeq.current, view.seq);
  }, [view?.seq, view?.round_state?.reveal]);

  // 一場結束時，先讓翻牌與牌型顯示，延遲 1.6 秒再跳結算框
  useEffect(() => {
    if (view?.phase === 'gameover') {
      const t = setTimeout(() => setShowGameOver(true), 1600);
      return () => clearTimeout(t);
    }
    setShowGameOver(false);
  }, [view?.phase, view?.series?.gameNo]);

  // 貼圖：雙方各自獨立顯示 2 秒，可同時出現、也可以連發（連發會重新計時）。
  useEffect(() => {
    const incoming = view?.stickers;
    if (!incoming) return;
    for (const seat of ['a', 'b']) {
      const s = incoming[seat];
      if (!s) continue;
      // 用 !== 而不是 >：系列賽下一場會重建 pk、seq 從 0 重新算，
      // 用 > 會因為前端還記著上一場的高水位而永遠不再顯示。
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

  // 送出「推進下一回合」。
  // 刻意不走 act()：act() 開頭有 `if (busy) return`，玩家在開牌後點貼圖時剛好會把
  // busy 佔住，一次性的自動推進就這樣被靜靜丟掉、且永不重送 → 雙方一起卡在開牌畫面。
  // 這裡不檢查也不佔用 busy，失敗就交給下面的重試迴圈；不 setView，
  // 讓 1.6 秒的輪詢去更新畫面，避免回應亂序蓋掉較新的狀態。
  const sendNextRound = useCallback(async () => {
    if (!session) return;
    try {
      await api('/api/room/action', { ...session, action: 'pk_next_round' });
    } catch {
      /* 忽略：由重試迴圈再送一次（後端此動作為 idempotent） */
    }
  }, [session]);

  // 開牌決勝：先翻牌 → 1 秒後勝方亮金邊 → 動畫看完自動推進下一回合。
  // 依賴只放 showdownHold 這個布林值（不放 seq）：進入開牌時執行一次、離開時清乾淨，
  // 中途任何 seq 變動（例如有人送貼圖）都不會把計時器清掉又重排。
  // 推進採「持續重試」直到真的離開開牌狀態，單次請求掉了也能自己復原。
  useEffect(() => {
    if (!view?.round_state?.showdownHold) { setGoldSide(null); return; }
    const rs = view.round_state;
    setGoldSide(null);
    const t1 = setTimeout(() => {
      if (rs.roundWinner) setGoldSide(rs.iWonRound ? 'me' : 'opp');
    }, 1000);
    let retry = null;
    const t2 = setTimeout(() => {
      setGoldSide(null);
      sendNextRound();
      retry = setInterval(sendNextRound, 1500);
    }, 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); if (retry) clearInterval(retry); };
  }, [view?.round_state?.showdownHold, sendNextRound]);


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
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#1c1712] to-[#0a0806] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">把房號給對手</div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em] text-field-floodlight">{v.code}</div>
        <SeriesBar series={v.series} labels={labels} me={v.role} />
        <div className="text-field-chalk/35 text-xs">等待對手加入…</div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4">取消</button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  const rs = v.round_state;
  const gameOver = v.phase === 'gameover';
  const seriesOver = v.series?.over;
  const myTurn = rs?.myTurn;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1c1712] via-[#14100c] to-[#0a0806] pb-24">
      <div className="max-w-5xl mx-auto px-3 sm:px-5 pt-4 flex gap-4">
        {/* 左側牌型面板（桌機固定） */}
        <aside className="hidden xl:block w-52 shrink-0">
          <div className="sticky top-4">
            <HandRankPanel current={rs?.myHandType} />
          </div>
        </aside>

        <div className="flex-1 min-w-0 max-w-2xl mx-auto">
          {/* 頂列 */}
        <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-field-chalk/12">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold text-field-chalk">17 張撲克</span>
            <span className="font-mono text-xs text-field-chalk/35">房號 {v.code}　你是 {labels[v.role]}</span>
          </div>
          {v.round > 0 && <span className="text-xs text-field-chalk/45">第 {v.round}/{v.totalRounds} 回合</span>}
        </div>

        <SeriesBar series={v.series} labels={labels} me={v.role} />

        {/* 籌碼 */}
        <div className="grid grid-cols-2 gap-2 my-3">
          <div className="rounded-xl border border-field-floodlight/30 bg-field-floodlight/[0.06] p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">你的籌碼</div>
            <div className="font-display font-black text-2xl text-field-floodlight">{v.chips?.me ?? '—'}</div>
          </div>
          <div className="rounded-xl border border-field-chalk/15 bg-black/25 p-2 text-center">
            <div className="text-[10px] text-field-chalk/45">對手籌碼</div>
            <div className="font-display font-black text-2xl text-field-chalk/80">{v.chips?.opp ?? '—'}</div>
          </div>
        </div>

        {rs && (
          <>
            {/* 對手手牌（背面，開牌後翻正）*/}
            <div className="text-center mb-2">
              <div className="text-[10px] text-field-chalk/40 mb-1">
                對手手牌{rs.drawn.opp !== null && `　（換了 ${rs.drawn.opp} 張）`}
              </div>
              <div className={`flex justify-center gap-1.5 ${goldSide === 'opp' ? 'pk-win-glow p-1' : ''}`}>
                {(rs.reveal ? rs.reveal.opp.hand : Array.from({ length: rs.oppHandCount })).map((c, i) => (
                  <CardImg key={i} card={rs.reveal ? c : null} faceDown={!rs.reveal} eggFlag={eggRef.current} flip={showFlip && rs.reveal} small />
                ))}
              </div>
              {rs.reveal && <div className="text-xs text-field-floodlight/80 mt-1">{rs.reveal.opp.name}</div>}
            </div>

            {/* 底池 */}
            <div className="text-center my-3">
              <span className="inline-block px-4 py-1.5 rounded-full bg-black/40 border border-field-floodlight/25 text-field-floodlight text-sm">
                底池 {rs.pot}
              </span>
            </div>

            {/* 自己手牌 */}
            <div className="text-center mb-3">
              <div className="text-[10px] text-field-chalk/40 mb-1">
                你的手牌
                {rs.stage === 'draw' && rs.myTurn && '　（點選要換掉的牌）'}
                {rs.drawn.me !== null && `　換了 ${rs.drawn.me} 張`}
              </div>
              <div className={`flex justify-center gap-1.5 ${goldSide === 'me' ? 'pk-win-glow p-1' : ''}`}>
                {rs.myHand?.map((c, i) => {
                  const sel = selDiscards.includes(i);
                  const pickable = rs.stage === 'draw' && rs.myTurn && rs.drawn.me === null;
                  return (
                    <button key={i} disabled={!pickable}
                      onClick={() => setSelDiscards((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}
                      className={`transition-transform ${pickable ? 'cursor-pointer hover:-translate-y-1' : ''} ${sel ? '-translate-y-2' : ''}`}>
                      <div className="relative">
                        <CardImg card={c} eggFlag={eggRef.current} flip={showFlip && rs.reveal} />
                        {sel && <div className="absolute inset-0 rounded-lg ring-2 ring-red-400 bg-red-500/20 flex items-center justify-center text-red-200 text-xs font-bold">換</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
              {rs.reveal ? (
                <div className="text-sm text-field-floodlight font-bold mt-1">{rs.reveal.me.name}</div>
              ) : (
                rs.myHandType && (
                  <div className="text-xs mt-1">
                    <span className="text-field-chalk/40">目前牌型：</span>
                    <span className="text-field-floodlight font-bold">{rs.myHandType}</span>
                  </div>
                )
              )}
            </div>

            {/* 操作區 */}
            {v.phase === 'round' && (
              <div className="rounded-xl border border-field-chalk/15 bg-black/30 p-3">
                {!myTurn ? (
                  <div className="text-center text-sm text-field-chalk/50 py-2">等待對手行動…</div>
                ) : rs.stage === 'draw' ? (
                  <button onClick={() => { act('pk_draw', { discards: selDiscards }); setSelDiscards([]); }} disabled={busy}
                    className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight tracking-widest disabled:opacity-40">
                    {selDiscards.length ? `換 ${selDiscards.length} 張` : '不換牌'}
                    {rs.deckLeft < selDiscards.length && `（牌庫僅剩 ${rs.deckLeft}）`}
                  </button>
                ) : (
                  <BetControls rs={rs} busy={busy} raiseAmt={raiseAmt} setRaiseAmt={setRaiseAmt} onAct={act} chips={v.chips.me} />
                )}
              </div>
            )}
          </>
        )}

        {msg && <div className="text-[12px] text-red-300/85 my-3 text-center">{msg}</div>}

        {/* 戰報 */}
        {v.log?.length > 0 && (
          <div className="rounded-xl border border-field-chalk/12 bg-black/25 px-3 py-2 max-h-28 overflow-y-auto mt-3">
            {v.log.map((l, i) => (
              <div key={i} className={`text-[11px] leading-relaxed ${/🏆|🎴|🤝|💸/.test(l.text) ? 'text-field-floodlight/90' : 'text-field-chalk/45'}`}>{l.text}</div>
            ))}
          </div>
        )}

        {/* 貼圖列 */}
        {v.phase !== 'waiting' && (
          <div className="mt-4">
            <StickerBar onSend={(name) => act('pk_sticker', { name })} busy={busy} />
          </div>
        )}

        {/* 手機版牌型面板（可收展） */}
        <div className="xl:hidden mt-4">
          <button onClick={() => setShowPanel((p) => !p)}
            className="w-full py-2 rounded-lg border border-field-chalk/15 bg-black/25 text-field-chalk/60 text-xs">
            {showPanel ? '▲ 收起牌型表' : '▼ 查看牌型大小表'}
          </button>
          {showPanel && <div className="mt-2"><HandRankPanel current={rs?.myHandType} /></div>}
        </div>

        <button onClick={leave} className="mt-6 text-field-chalk/30 text-[11px] underline underline-offset-4">離開房間</button>
      </div>
      </div>

      {/* 貼圖顯示（2 秒，雙方畫面都會出現；雙方同時按會左右並列） */}
      {['a', 'b'].map((seat) => {
        const s = stickers[seat];
        if (!s) return null;
        const mine = seat === v.role;
        // key 帶上 seq：連發同一張時強制重新掛載，動畫才會重播
        return (
          <div key={`${seat}-${s.seq}`}
            className={`fixed bottom-28 z-[60] pointer-events-none ${mine ? 'right-6' : 'left-6'}`}
            style={{ animation: 'stickerPop 2s ease-out both' }}>
            <img src={`/poker/stickers/${s.name}.png`} alt="" className="w-28 h-28 object-contain drop-shadow-2xl" />
            <div className="text-center text-[11px] text-field-chalk/60 mt-1">{mine ? '你' : '對手'}</div>
          </div>
        );
      })}
      {/* 生死局梗圖 */}
      {v.series?.matchPoint && <MatchPointMeme />}

      {/* 一場結束（系列未結束）*/}
      {gameOver && !seriesOver && showGameOver && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-field-chalk/20 bg-[#161009] p-7 text-center">
            <div className="font-display text-2xl font-black mb-2" style={{ color: v.iWon ? '#f5cf6a' : '#e88' }}>
              {v.result ? (v.iWon ? '你贏了這場' : '對手贏了這場') : '這場平手'}
            </div>
            <div className="text-xs text-field-chalk/50 mb-1">系列比分 {v.series.wins[v.role]} : {v.series.wins[v.role === 'a' ? 'b' : 'a']}</div>
            <div className="text-[11px] text-field-chalk/35 mb-5">籌碼 你 {v.chips.me} / 對手 {v.chips.opp}</div>
            <button onClick={() => act('pk_next')} disabled={busy}
              className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-40">
              {v.__nextReady ? '等待對手…' : '下一場'}
            </button>
            <button onClick={leave} className="mt-3 text-field-chalk/40 text-xs underline underline-offset-4">離開</button>
          </div>
        </div>
      )}

      {/* 系列賽結束 */}
      {seriesOver && showGameOver && (
        <div className="fixed inset-0 z-[70] bg-black/88 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-field-floodlight/30 bg-[#161009] p-7 text-center">
            <div className="text-5xl mb-3">{v.series.champion === v.role ? '🏆' : '🥈'}</div>
            <div className="font-display text-3xl font-black mb-2" style={{ color: '#f5cf6a' }}>
              {v.series.champion === v.role ? '系列賽冠軍！' : '系列賽落敗'}
            </div>
            <div className="text-xs text-field-chalk/50 mb-5">最終比分 {v.series.wins[v.role]} : {v.series.wins[v.role === 'a' ? 'b' : 'a']}</div>
            <button onClick={() => act('pk_rematch')} disabled={busy}
              className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-40">
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

/* ---------------- 下注控制 ---------------- */

function BetControls({ rs, busy, raiseAmt, setRaiseAmt, onAct, chips }) {
  const toCall = rs.toCall;
  const cap = rs.stage === 'bet1' ? rs.betCaps.bet1 : rs.betCaps.bet2;
  // 當前注額 = 雙方本回合已投入的較大者
  const curLevel = Math.max(rs.bets.me, rs.bets.opp);
  // 加注目標範圍：(當前注額, 上限]，且補差額不超過自己剩餘籌碼
  const maxTarget = Math.min(cap, rs.bets.me + chips);
  const canRaise = maxTarget > curLevel;
  const minTarget = curLevel + 1;
  const target = Math.max(minTarget, Math.min(raiseAmt, maxTarget));

  return (
    <div className="space-y-2">
      <div className="text-center text-[11px] text-field-chalk/45">
        {rs.stage === 'bet1' ? `第一次下注（注額上限 ${rs.betCaps.bet1}）` : `第二次下注（注額上限 ${rs.betCaps.bet2}）`}
        {curLevel > 0 && <span className="text-field-chalk/60">　目前注額 {curLevel}</span>}
        {toCall > 0 && <span className="text-field-floodlight">　需跟注 {toCall}</span>}
      </div>
      <div className="flex gap-2">
        {toCall > 0 ? (
          <>
            <button onClick={() => onAct('pk_bet', { move: 'fold' })} disabled={busy}
              className="flex-1 py-2 rounded-lg border border-red-400/40 text-red-300/80 text-sm">棄牌</button>
            <button onClick={() => onAct('pk_bet', { move: 'call' })} disabled={busy}
              className="flex-1 py-2 rounded-lg border border-field-floodlight/50 text-field-floodlight text-sm">跟注 {Math.min(toCall, chips)}</button>
          </>
        ) : (
          <button onClick={() => onAct('pk_bet', { move: 'check' })} disabled={busy}
            className="flex-1 py-2 rounded-lg border border-field-chalk/25 text-field-chalk/70 text-sm">過牌</button>
        )}
      </div>
      {canRaise && (
        <div className="flex items-center gap-2">
          <input type="range" min={minTarget} max={maxTarget} value={target}
            onChange={(e) => setRaiseAmt(Number(e.target.value))} className="flex-1 accent-[#f5cf6a]" />
          <span className="font-mono text-sm text-field-floodlight w-10 text-center">加到{target}</span>
          <button onClick={() => onAct('pk_bet', { move: toCall > 0 ? 'raise' : 'bet', amount: target })} disabled={busy}
            className="px-4 py-2 rounded-lg border border-field-floodlight/60 text-field-floodlight text-sm">
            {curLevel > 0 ? '加注' : '下注'}
          </button>
        </div>
      )}
    </div>
  );
}
