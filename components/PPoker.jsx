'use client';
// ── 夢幻樂園 · 精準預測撲克　路徑：foshan/components/PPoker.jsx
//
// 2~5 人即時真金幣撲克局，規則在 lib/ppoker.js。發牌、底牌、狙擊判定、比牌全部在
// 伺服器算，這裡只負責顯示伺服器回傳的內容、把操作送出去——瀏覽器自己完全不知道
// 底牌長怎樣，也不知道還沒發的牌是什麼，開牌前看原始碼也看不出答案。
import { useState, useEffect, useRef, useCallback } from 'react';

const SIZES = [2,3,4,5];
const BUYINS = [5000000, 20000000, 100000000, 300000000];
const SNIPE_OPTS = [
  ['four','四條'], ['fullhouse','葫蘆'], ['straight','順子'],
  ['three','三條'], ['twopair','兩對'], ['pair','一對'], ['high','高牌'],
];
const CARD_NAME = n => (n === 1 ? 'A' : String(n));

async function api(path, body) {
  const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) { const e = new Error(d.error || '連線失敗'); e.view = d.view; e.status = r.status; throw e; }
  return d;
}

const ss = {
  save:(code,token,playerId)=>{ try{ sessionStorage.setItem('ppoker_session', JSON.stringify({code,token,playerId})); }catch{} },
  load:()=>{ try{ return JSON.parse(sessionStorage.getItem('ppoker_session')||'null'); }catch{ return null; } },
  clear:()=>{ try{ sessionStorage.removeItem('ppoker_session'); }catch{} },
};

function Card({ n, faceDown, small, highlight }) {
  return (
    <div style={{
      width: small ? 30 : 44, aspectRatio:'5/7', borderRadius:6, flex:'none',
      border: highlight ? `2px solid ${highlight}` : '1px solid var(--line)',
      background: faceDown ? '#0d0a12' : 'var(--panel)',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:'"JetBrains Mono",monospace', fontWeight:700,
      fontSize: small ? 13 : 18, color: faceDown ? 'transparent' : 'var(--brass)',
    }}>
      {faceDown ? '' : CARD_NAME(n)}
    </div>
  );
}

function Lobby({ playerId, onEnter, onSpectate, exit, lobbyErr }) {
  const [tab, setTab] = useState('create');
  const [size, setSize] = useState(2);
  const [buyIn, setBuyIn] = useState(BUYINS[0]);
  const [code, setCode] = useState('');
  const [specCode, setSpecCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    setBusy(true); setErr('');
    try { const d = await api('/api/ppoker/create', { id:playerId, size, buyIn }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function join() {
    if (!/^\d{4}$/.test(code)) { setErr('房號是 4 位數字'); return; }
    setBusy(true); setErr('');
    try { const d = await api('/api/ppoker/join', { id:playerId, code }); onEnter(d.code, d.token, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function spectate() {
    if (!/^\d{4}$/.test(specCode)) { setErr('房號是 4 位數字'); return; }
    setBusy(true); setErr('');
    try { const d = await api('/api/ppoker/state', { code:specCode, spectate:true }); onSpectate(specCode, d.view); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div style={{ display:'flex', alignItems:'center', marginBottom:6 }}>
        <p className="h2" style={{ margin:0 }}>精準預測撲克</p>
        <button className="btn" style={{ marginLeft:'auto' }} onClick={exit}>離開</button>
      </div>
      <p className="muted" style={{ marginBottom:12 }}>
        2~5 人真金幣對賭。抽數字排座位，兩張底牌＋四張公牌比大小（不看花色），
        開牌前還能依序狙擊一個牌型——猜中的話，被猜中的人這手直接輸。打到只剩一人有籌碼，贏家全拿。
      </p>
      {lobbyErr && (
        <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:8,
                      border:'1px solid var(--vermilion)', background:'rgba(200,60,60,.12)' }}>
          <p style={{ color:'var(--vermilion)', fontSize:13, lineHeight:1.6 }}>{lobbyErr}</p>
        </div>
      )}
      <div className="row" style={{ marginBottom:14 }}>
        <button className={`btn${tab==='create'?' key':''}`} onClick={()=>{setTab('create');setErr('');}}>開桌</button>
        <button className={`btn${tab==='join'?' key':''}`} onClick={()=>{setTab('join');setErr('');}}>加入</button>
        <button className={`btn${tab==='spectate'?' key':''}`} onClick={()=>{setTab('spectate');setErr('');}}>觀戰</button>
      </div>
      {tab === 'create' ? (
        <>
          <p className="muted" style={{ fontSize:12, marginBottom:6 }}>人數</p>
          <div style={{ display:'flex', gap:8, marginBottom:14 }}>
            {SIZES.map(s => (
              <button key={s} className={`btn${size===s?' on':''}`} style={{flex:1}} onClick={()=>setSize(s)}>{s} 人</button>
            ))}
          </div>
          <p className="muted" style={{ fontSize:12, marginBottom:6 }}>這場的金額（每人）</p>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
            {BUYINS.map(b => (
              <button key={b} className={`btn${buyIn===b?' on':''}`} onClick={()=>setBuyIn(b)}>{b.toLocaleString()}</button>
            ))}
          </div>
          <button className="btn key" disabled={busy} onClick={create} style={{ width:'100%' }}>
            {busy?'開桌中……':'開桌'}
          </button>
        </>
      ) : tab === 'join' ? (
        <>
          <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,4))}
            onKeyDown={e=>e.key==='Enter'&&join()} placeholder="4 位數房號" inputMode="numeric"
            style={{ width:'100%', textAlign:'center', fontSize:22, letterSpacing:8, padding:'10px',
                     borderRadius:8, border:'1px solid var(--line)', background:'transparent', color:'var(--fg)', marginBottom:12 }} />
          <button className="btn key" disabled={busy} onClick={join} style={{ width:'100%' }}>
            {busy?'加入中……':'加入'}
          </button>
        </>
      ) : (
        <>
          <p className="muted" style={{ marginBottom:10 }}>
            純觀戰不用付入場費，也不會佔用座位——只能看，不能下注或狙擊。看得到公牌、底池、籌碼跟已經公開的結算內容，看不到任何人的底牌。
          </p>
          <input value={specCode} onChange={e=>setSpecCode(e.target.value.replace(/\D/g,'').slice(0,4))}
            onKeyDown={e=>e.key==='Enter'&&spectate()} placeholder="4 位數房號" inputMode="numeric"
            style={{ width:'100%', textAlign:'center', fontSize:22, letterSpacing:8, padding:'10px',
                     borderRadius:8, border:'1px solid var(--line)', background:'transparent', color:'var(--fg)', marginBottom:12 }} />
          <button className="btn key" disabled={busy} onClick={spectate} style={{ width:'100%' }}>
            {busy?'連線中……':'開始觀戰'}
          </button>
        </>
      )}
      {err && <p className="muted" style={{ marginTop:10, color:'var(--vermilion)' }}>{err}</p>}
    </div>
  );
}

export default function PPoker({ playerId, patch, exit }) {
  const [session, setSession] = useState(null);
  const [view, setView] = useState(null);
  const [lobbyErr, setLobbyErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [raiseTo, setRaiseTo] = useState(1);
  const [snipeCat, setSnipeCat] = useState('pair');
  const [snipeRank, setSnipeRank] = useState(10);

  const pollRef = useRef(null);
  const wasPlaying = useRef(false);
  const wasDone = useRef(false);

  useEffect(() => {
    // 連線資訊是綁「分頁」存的，不是綁「帳號」——同一個分頁如果先後登入過不同
    // 遊戲帳號，殘留的舊連線資訊不能拿來用。存的時候多記一筆「當初是哪個帳號存的」，
    // 讀取時比對「現在登入的帳號」，對不上就直接當作舊資料清掉，逼玩家重新加入，
    // 不會誤用到別的帳號的 token。
    const s = ss.load();
    if (s?.code && s?.token) {
      if (s.playerId === playerId) setSession(s);
      else ss.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 連線資訊（房號＋token）不完整的話，任何動作送出去伺服器都會回「缺少參數」，
  // 但那對玩家來說是一句看不懂的話。統一在這裡擋下來，直接清掉重來、給明確提示——
  // 常見成因：同一個瀏覽器分頁先後登入了不同遊戲帳號，sessionStorage 是綁「分頁」
  // 不是綁「帳號」，殘留的舊連線資訊可能在某些時機點跟新帳號的搞混。
  function sessionValid(s) { return !!(s && s.code && (s.token || s.spectator)); }
  function sessionLost(context) {
    const detail = session ? `code=${session.code||'(空)'}／token=${session.token?'有':'(空)'}` : 'session=(完全沒有)';
    ss.clear(); setSession(null); setView(null);
    setLobbyErr(`連線資訊遺失，請重新加入牌桌。${context?`（發生於：${context}，${detail}）`:''}`);
  }

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const body = session.spectator ? { code: session.code, spectate: true } : session;
      const d = await api('/api/ppoker/state', body);
      setView(d.view); setLobbyErr('');
    }
    catch (e) {
      // 單次輪詢失敗（網路卡一下、伺服器冷啟動）不代表房間真的不見了，不要直接把整個
      // session 清掉、把人踢回大廳——先前這裡太激進，一次失敗就整個重來，
      // 玩家會覺得「明明加入成功了怎麼又跳回最初畫面」。只有從頭到尾都還沒拿到過
      // 任何一次畫面（view 還是 null）時，才顯示錯誤＋讓玩家自己選要不要回大廳；
      // 已經看過畫面的話，就留著上一次的畫面、安靜重試，下一輪（1.5 秒後）通常就好了。
      setLobbyErr(e.message || '連線不穩，正在重試……');
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    pollRef.current = setInterval(refresh, 1500);
    return () => clearInterval(pollRef.current);
  }, [session, refresh]);

  // 抽滿開局那一刻，本機同步扣入場費（伺服器已經真的扣了，這裡只是讓畫面馬上更新，
  // 不用等玩家重新整理）；打到只剩自己有籌碼時，同步加回全部入場費。兩個都只套用一次。
  useEffect(() => {
    if (!view) return;
    if (view.status === 'playing' && !wasPlaying.current) {
      wasPlaying.current = true;
      patch(p => ({ gold: (p.gold||0) - view.buyIn }));
    }
    if (view.status === 'done' && !wasDone.current) {
      wasDone.current = true;
      const me = view.players.find(p => p.isMe);
      if (me && !me.out) patch(p => ({ gold: (p.gold||0) + view.size * view.buyIn }));
    }
  }, [view, patch]);

  function onEnter(code, token, initialView) {
    ss.save(code, token, playerId);
    setSession({ code, token });
    if (initialView) setView(initialView);   // 不用等第一次輪詢，馬上就看得到畫面
    setLobbyErr('');
  }

  // 純觀戰不記錄到 sessionStorage（沒有身分、也不用跨重新整理保留），純粹是
  // 「現在正在看哪個房號」這個當下的狀態，重新整理就重新輸入房號即可。
  function onSpectate(code, initialView) {
    setSession({ code, token: null, spectator: true });
    if (initialView) setView(initialView);
    setLobbyErr('');
  }

  async function act(action, payload) {
    if (busy) return;
    if (!sessionValid(session)) { sessionLost(`act:${action}`); return; }
    setBusy(true); setMsg('');
    try { const d = await api('/api/ppoker/action', { ...session, action, payload }); setView(d.view); }
    catch (e) {
      if (e.status === 403) { sessionLost(`act:${action}（伺服器回：${e.message}）`); return; }
      setMsg(e.message); if (e.view) setView(e.view);
    }
    finally { setBusy(false); }
  }

  async function drawSeat() {
    if (busy) return;
    if (!sessionValid(session)) { sessionLost('抽座位'); return; }
    setBusy(true); setMsg('');
    try { const d = await api('/api/ppoker/draw', session); setView(d.view); if (d.kicked?.length) setMsg(`${d.kicked.join('、')} 金幣不足，已被請出牌桌。`); }
    catch (e) {
      if (e.status === 403) { sessionLost(`抽座位（伺服器回：${e.message}）`); return; }
      setMsg(e.message);
    }
    finally { setBusy(false); }
  }

  async function leaveSeating() {
    if (busy) return;
    if (!sessionValid(session)) { sessionLost('離開牌桌'); return; }
    setBusy(true);
    try { await api('/api/ppoker/leave', session); } catch {}
    ss.clear(); setSession(null); setView(null);
    setBusy(false);
  }

  async function leaveMatch() {
    if (!confirm('現在離開會直接判定你棄權：籌碼歸零、繳的入場費拿不回來，之後只能旁觀。確定要離開嗎？')) return;
    await act('leave');
    ss.clear(); setSession(null); setView(null);
  }

  if (!session) return <Lobby playerId={playerId} onEnter={onEnter} onSpectate={onSpectate} exit={exit} lobbyErr={lobbyErr} />;
  if (!view) return (
    <div className="card">
      <p className="muted">連線中……</p>
      {lobbyErr && <p className="muted" style={{ marginTop:10, color:'var(--vermilion)' }}>{lobbyErr}</p>}
      <button className="btn" style={{ marginTop:12 }} onClick={()=>{ss.clear();setSession(null);}}>回大廳</button>
    </div>
  );

  const me = view.players.find(p => p.isMe);
  const m = view.match;

  /* ── 等位／抽座位畫面 ── */
  if (view.status === 'seating') {
    return (
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
          <p className="h2" style={{ margin:0 }}>等待中</p>
        </div>
        <div style={{ textAlign:'center', margin:'4px 0 14px' }}>
          <p className="muted" style={{ fontSize:12, marginBottom:4 }}>房號</p>
          <p style={{ fontSize:40, fontWeight:700, letterSpacing:10, color:'var(--brass)',
                      fontFamily:'"JetBrains Mono",monospace' }}>{view.code}</p>
        </div>
        <p className="muted" style={{ marginBottom:12 }}>
          {view.players.length}/{view.size} 人　每人 {view.buyIn.toLocaleString()} 金幣　人數抽滿就會開局
        </p>
        <div className="list">
          {view.players.map(p => (
            <div className="item" key={p.playerId}>
              <div className="grow">{p.playerId}{p.isMe && '（你）'}</div>
              <div className="muted">{p.drawn ? `已抽：${p.drawn}` : '尚未抽座位'}</div>
            </div>
          ))}
        </div>
        {session.spectator ? (
          <p className="muted" style={{ marginTop:14 }}>觀戰中，等玩家抽滿座位開局……</p>
        ) : !me?.drawn ? (
          <button className="btn key" style={{ marginTop:14, width:'100%' }} disabled={busy} onClick={drawSeat}>
            同意金額，抽座位
          </button>
        ) : (
          <p className="muted" style={{ marginTop:14 }}>你抽到了 {me.drawn}，等其他人抽完……</p>
        )}
        <button className="btn" style={{ marginTop:10, width:'100%' }}
          disabled={busy || (!session.spectator && me?.drawn)}
          onClick={session.spectator ? ()=>{setSession(null);setView(null);} : leaveSeating}>
          {session.spectator ? '離開觀戰' : '離開牌桌'}
        </button>
        {msg && <p className="muted" style={{ marginTop:10, color:'var(--vermilion)' }}>{msg}</p>}
      </div>
    );
  }

  /* ── 比賽結束 ── */
  if (view.status === 'done') {
    const winner = view.players.find(p => !p.out);
    return (
      <div className="card">
        <p className="h2">比賽結束</p>
        <p style={{ marginTop:10 }}>
          🏆 <b style={{ color:'var(--brass)' }}>{winner?.playerId}</b> 拿走全部 {(view.size*view.buyIn).toLocaleString()} 金幣。
        </p>
        <div className="list" style={{ marginTop:12 }}>
          {view.players.map(p => (
            <div className="item" key={p.playerId}>
              <div className="grow">{p.playerId}{p.isMe && '（你）'}</div>
              <div className="muted">{p===winner ? '贏家' : p.leftEarly ? '中途離開' : '出局'}</div>
            </div>
          ))}
        </div>
        <button className="btn key" style={{ marginTop:14, width:'100%' }}
          onClick={()=>{ ss.clear(); setSession(null); setView(null); }}>回大廳</button>
      </div>
    );
  }

  /* ── 牌桌 ── */
  const mySeat = view.mySeat;
  const out = me?.out;
  const readOnly = out || session.spectator;
  return (
    <>
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <p className="h2" style={{ margin:0 }}>精準預測撲克</p>
          <span className="muted" style={{ fontSize:12 }}>
            第 {m.handNo} 局　底注 {m.ante}　{10 - ((m.handNo-1)%10)} 局後升盲
          </span>
          {readOnly ? (
            <button className="btn" style={{ marginLeft:'auto' }}
              onClick={()=>{ if (!session.spectator) ss.clear(); setSession(null); setView(null); }}>
              {session.spectator ? '離開觀戰' : '離開'}
            </button>
          ) : (
            <button className="btn" style={{ marginLeft:'auto' }} disabled={busy} onClick={leaveMatch}>離開</button>
          )}
        </div>
        {out && !session.spectator && (
          <p className="muted" style={{ marginTop:8 }}>你已經出局了，可以留在這裡看這場怎麼打完，也可以隨時按上面的「離開」。</p>
        )}
      </div>

      {m.phase !== 'handOver' && (
        <div style={{
          padding:'10px 14px', borderRadius:10, marginBottom:12, textAlign:'center',
          border: m.myTurn ? '1px solid var(--brass)' : '1px solid var(--line)',
          background: m.myTurn ? 'rgba(200,160,60,.14)' : 'transparent',
        }}>
          <p style={{ fontSize: m.myTurn ? 16 : 14, fontWeight: m.myTurn ? 700 : 400,
                      color: m.myTurn ? 'var(--brass)' : 'var(--fg)', margin:0 }}>
            {m.myTurn ? '🔔 輪到你了' : `現在輪到　${m.toActName}`}
            {m.phase === 'snipe' && '　（狙擊階段）'}
          </p>
        </div>
      )}

      <div className="card">
        <p className="muted" style={{ fontSize:12, marginBottom:8 }}>座位　<span style={{fontSize:11}}>（➤ 本局起手玩家）</span></p>
        <div className="list">
          {view.players.filter(p=>p.seat!=null).sort((a,b)=>a.seat-b.seat).map(p => {
            const idleWarn = !p.out && p.idleMs >= 60000;   // 跟後端 WARN_MS 一致
            return (
              <div className="item" key={p.playerId}
                style={p.seat===m.toAct ? { outline:'2px solid var(--brass)', borderRadius:8 } : undefined}>
                <div className="grow">
                  {p.seat === m.startSeat && <span title="本局起手玩家" style={{ marginRight:4 }}>➤</span>}
                  {p.playerId}{p.isMe && '（你）'}
                  {p.out && <span className="muted">　{p.leftEarly ? '（已離開）' : '（出局）'}</span>}
                  {m.folded.includes(p.seat) && !p.out && <span className="muted">　（棄牌）</span>}
                  {m.allIn.includes(p.seat) && <span style={{ color:'var(--brass)' }}>　（全下）</span>}
                  {idleWarn && (
                    <span style={{ color:'var(--vermilion)' }}>
                      　⚠️ {p.idleMs >= 120000 ? '即將判定中離' : '閒置中，快超過時限'}
                    </span>
                  )}
                </div>
                <div className="mono">
                  {p.chips} 籌碼
                  {m.lastRaiser === p.seat && <span style={{ color:'var(--brass)', fontSize:11, marginLeft:6 }}>🔺加注</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <p className="muted" style={{ fontSize:12 }}>公牌</p>
        <div style={{ display:'flex', gap:6, marginBottom:14 }}>
          {m.community.map((c,i) => <Card key={i} n={c} />)}
          {Array.from({ length: (m.communityFull?4:2) - m.community.length }).map((_,i) => <Card key={'x'+i} n={0} faceDown />)}
        </div>
        {m.myHole && (
          <>
            <p className="muted" style={{ fontSize:12 }}>我的手牌</p>
            <div style={{ display:'flex', gap:6, marginBottom:10 }}>
              {m.myHole.map((c,i) => <Card key={i} n={c} />)}
            </div>
          </>
        )}
        <p className="muted">底池　<b style={{ color:'var(--brass)' }}>{m.pot}</b></p>

        {(m.phase === 'bet1' || m.phase === 'bet2') && (
          m.myTurn ? (
            <div style={{ marginTop:12 }}>
              <p className="muted" style={{ marginBottom:8 }}>
                目前注額 {m.toCallLevel}，你已投入 {m.curBet[mySeat]}
              </p>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {m.curBet[mySeat] === m.toCallLevel
                  ? <button className="btn" disabled={busy} onClick={()=>act('bet',{action:'check'})}>過牌</button>
                  : <button className="btn" disabled={busy} onClick={()=>act('bet',{action:'call'})}>跟注 {m.toCallLevel}</button>}
                <button className="btn" disabled={busy} onClick={()=>act('bet',{action:'fold'})}>棄牌</button>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10 }}>
                <input type="number" min={m.toCallLevel+1} value={raiseTo}
                  onChange={e=>setRaiseTo(Number(e.target.value))}
                  style={{ width:100, padding:'8px 10px', borderRadius:8, border:'1px solid var(--line)', background:'transparent', color:'var(--fg)' }} />
                <button className="btn key" disabled={busy || raiseTo<=m.toCallLevel}
                  onClick={()=>act('bet',{action:'raise', to:raiseTo})}>加注到此</button>
              </div>
            </div>
          ) : <p className="muted" style={{ marginTop:10 }}>等 {m.toActName} 行動……</p>
        )}

          {m.phase === 'snipe' && (
            m.myTurn ? (
              <div style={{ marginTop:12 }}>
                <p className="muted" style={{ marginBottom:8 }}>
                  要狙擊哪個牌型？猜中的話，被猜中的人這手不能贏。
                </p>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                  <select value={snipeCat} onChange={e=>setSnipeCat(e.target.value)}
                    style={{ padding:'8px 10px', borderRadius:8, border:'1px solid var(--line)', background:'transparent', color:'var(--fg)' }}>
                    {SNIPE_OPTS.map(([id,label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                  <input type="number" min={1} max={10} value={snipeRank}
                    onChange={e=>setSnipeRank(Number(e.target.value))}
                    style={{ width:80, padding:'8px 10px', borderRadius:8, border:'1px solid var(--line)', background:'transparent', color:'var(--fg)' }} />
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn key" disabled={busy}
                    onClick={()=>act('snipe',{cat:snipeCat, rank:snipeRank})}>狙擊「{CARD_NAME(snipeRank)}{SNIPE_OPTS.find(o=>o[0]===snipeCat)?.[1]}」</button>
                  <button className="btn" disabled={busy} onClick={()=>act('snipe',{skip:true})}>不狙擊</button>
                </div>
              </div>
            ) : <p className="muted" style={{ marginTop:10 }}>等 {m.toActName} 決定要不要狙擊……</p>
          )}

          {m.phase === 'handOver' && m.results && (
            <div style={{ marginTop:14 }}>
              <p className="h2">攤牌</p>
              <div className="list" style={{ marginTop:8 }}>
                {Object.entries(m.results.hole).map(([seat, cards]) => {
                  const p = view.players.find(x => x.seat === Number(seat));
                  const ev = m.results.evals[seat];
                  const wasFolded = m.folded.includes(Number(seat));
                  return (
                    <div className="item" key={seat}>
                      <div className="grow">
                        {p?.playerId}
                        {ev && <span className="muted">　{ev.label}</span>}
                        {ev?.sniped && <span style={{ color:'var(--vermilion)' }}>　🎯 被狙擊</span>}
                        {wasFolded && <span className="muted">　（棄牌後主動亮牌）</span>}
                      </div>
                      <div style={{ display:'flex', gap:4 }}>
                        {cards.map((c,i)=><Card key={i} n={c} small highlight={ev?.sniped ? 'var(--vermilion)' : null} />)}
                      </div>
                    </div>
                  );
                })}
                {m.folded.filter(s => !(String(s) in m.results.hole)).map(seat => {
                  const p = view.players.find(x => x.seat === seat);
                  return (
                    <div className="item" key={'folded'+seat}>
                      <div className="grow">
                        {p?.playerId}
                        <span className="muted">　（棄牌，未亮牌）</span>
                      </div>
                      {seat === mySeat && (
                        <button className="btn" style={{ fontSize:12 }} disabled={busy} onClick={()=>act('reveal')}>
                          主動亮牌
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {m.results.potResults.map((pr, i) => (
                <p key={i} className="muted" style={{ marginTop:8 }}>
                  {pr.allSnipedOut
                    ? `池子（${pr.amount}）：${pr.eligibleNames.join('、')} 全被狙擊，平分`
                    : `池子（${pr.amount}）：${pr.winnerNames.join('、')} 贏得`}
                </p>
              ))}
              {!out && !session.spectator && (
                <button className="btn key" style={{ marginTop:12, width:'100%' }} disabled={busy || m.readyNext.includes(mySeat)}
                  onClick={()=>act('ready')}>
                  {m.readyNext.includes(mySeat) ? '等其他人準備好……' : '準備好了，下一局'}
                </button>
              )}
            </div>
          )}
        </div>

      {m.snipes.length > 0 && (
        <div style={{ padding:'10px 14px', borderRadius:10, marginBottom:12,
                      border:'1px solid var(--vermilion)', background:'rgba(200,60,60,.10)' }}>
          <p style={{ fontSize:12, marginBottom:6, color:'var(--vermilion)', fontWeight:700 }}>🚫 本局已 BAN 的牌型</p>
          {m.snipes.map((s,i) => (
            <p key={i} style={{ fontSize:14, margin:'4px 0' }}>
              <b>{s.label}</b>　<span className="muted">（{s.seatName} 狙擊）</span>
              {s.hit && <span style={{ color:'var(--vermilion)', fontWeight:700 }}>　❗ 命中</span>}
            </p>
          ))}
        </div>
      )}

      {msg && <div className="card"><p className="muted" style={{ color:'var(--vermilion)' }}>{msg}</p></div>}
    </>
  );
}
