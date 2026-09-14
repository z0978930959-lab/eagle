'use client';
// ── 末班車 · 23:47 ── 副本主元件
// 路徑：foshan/components/LastCar.jsx
// 掛載：Game.jsx 內 scene==='lastcar' ? <LastCar S={S} patch={patch} exit={()=>setScene(null)} />
//
// 【六條運行規則】
// 1 鎖先於鑰匙：進車廂第一畫面就同時看得見兩把鎖，且明說位數
// 2 只用點擊：點道具 → 進入「手上」→ 可用熱點自動發光 → 點熱點觸發（手機桌機一致）
// 3 自動筆記：看過的線索自動入筆記，玩家不用抄
// 4 分級回饋：錯誤分四級，不再只有「沒有反應」
// 5 不給提示：線索全部埋在場景裡，靠玩家自己組合
// 6 一次性：取得任何結局 → locked=true，永久不可再進入。獎勵只發一次

import { useState, useEffect, useRef } from 'react';
import {
  INITIAL, INTRO_LINES, SCENES, CAR_HOTSPOTS, CAB_HOTSPOTS, ITEMS,
  TICKET, TIMETABLE, ROUTEMAP_NOTE, ROUTEMAP_NOTE2, MANUAL_PAGES, LOG_SCREEN,
  JACKET_TEXT, WINDOW_TEXT, WINDOW_AGAIN, LOCKER_OPEN_TEXT, PHONE_ON,
  NOTES, ENDINGS,
  LOCKER_CODE, CAB_CODE, TRUE_STATION, STATIONS, checkCode, CLUE_IMG, LOCK_ON_EXIT,
} from '@/lib/lastcar';

/* ───────────────────────── 共用小元件 ───────────────────────── */

function Typewriter({ text, speed = 42, onDone }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    const t = setInterval(() => {
      setN(v => { if (v >= text.length) { clearInterval(t); onDone && onDone(); return v; } return v + 1; });
    }, speed);
    return () => clearInterval(t);
  }, [text]);
  return <p style={{ lineHeight:1.9, minHeight:'3em' }}>{text.slice(0, n)}</p>;
}

// 規則 4：分級回饋的數字鍵盤
function Keypad({ len, answer, onPass, onFail }) {
  const [v, setV] = useState('');
  const [msg, setMsg] = useState('');
  const push = d => v.length < len && setV(v + d);
  const submit = () => {
    const r = checkCode(v, answer);
    if (r.ok) { onPass(); return; }
    setMsg(r.msg); setV(''); onFail && onFail();
  };
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, marginTop:12 }}>
      <div className="mono" style={{ fontSize:26, letterSpacing:'.35em', minHeight:34 }}>
        {v.padEnd(len, '＿')}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, width:210 }}>
        {[1,2,3,4,5,6,7,8,9].map(n => <button key={n} className="btn" onClick={()=>push(String(n))}>{n}</button>)}
        <button className="btn" onClick={()=>{setV('');setMsg('');}}>清除</button>
        <button className="btn" onClick={()=>push('0')}>0</button>
        <button className="btn key" onClick={submit} disabled={v.length !== len}>確認</button>
      </div>
      {msg && <p className="muted" style={{ marginTop:4 }}>{msg}</p>}
    </div>
  );
}

// 氣氛圖：只負責好看，載入失敗就消失，關鍵文字一律另外用文字呈現
function Pic({ src }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return <img src={src} alt="" onError={()=>setBad(true)}
              style={{ width:'100%', borderRadius:12, display:'block', marginBottom:10 }} />;
}

// 線索圖：載入失敗自動退回純文字版，關鍵數字永遠不會消失
function Clue({ src, fallback }) {
  const [bad, setBad] = useState(false);
  if (bad) return <div className="card">{fallback}</div>;
  return <img src={src} alt="" onError={()=>setBad(true)}
              style={{ width:'100%', borderRadius:12, display:'block' }} />;
}

/* ───────────────────────── 主元件 ───────────────────────── */

export default function LastCar({ S, patch, exit }) {
  const L = { ...INITIAL, ...(S.lastcar || {}) };
  const F = L.flags || {};

  const [msg, setMsg]           = useState('');
  const [viewing, setViewing]   = useState(null);   // 背包點開的道具
  const [notesOpen, setNotes]   = useState(false);
  const [introIdx, setIntroIdx] = useState(0);
  const [endIdx, setEndIdx]     = useState(0);
  const [confirmStation, setCS] = useState(null);
  const [confirmJump, setCJ]    = useState(false);

  const set = up => patch(p => ({ lastcar: { ...INITIAL, ...(p.lastcar||{}), ...up } }));
  const setFlags = up => patch(p => {
    const cur = { ...INITIAL, ...(p.lastcar||{}) };
    return { lastcar: { ...cur, flags: { ...cur.flags, ...up } } };
  });
  const addNote = (...ids) => patch(p => {
    const cur = { ...INITIAL, ...(p.lastcar||{}) };
    const next = [...new Set([...(cur.notes||[]), ...ids])];
    return { lastcar: { ...cur, notes: next } };
  });
  const addItem = (...ids) => patch(p => {
    const cur = { ...INITIAL, ...(p.lastcar||{}) };
    return { lastcar: { ...cur, bag: [...new Set([...(cur.bag||[]), ...ids])] } };
  });
  const go   = s   => { set({ scene:s, sub:null, held:null }); setMsg(''); };
  const open = sub => { set({ sub }); setMsg(''); };
  const back = ()  => { set({ sub:null }); setMsg(''); };

  /* ── 規則 3：進入子頁時自動記筆記（統一在 effect 做，不在 render 內改 state）── */
  const seenWindowRef = useRef(F.sawWindow);
  useEffect(() => {
    const s = L.sub;
    if (!s) return;
    if (s === 'locker')    addNote('locker');
    if (s === 'routemap')  addNote('routemap');
    if (s === 'timetable') addNote('timetable');
    if (s === 'log')  { addNote('log'); if (!F.sawLog) setFlags({ sawLog:true }); }
    if (s === 'window' && !seenWindowRef.current) {
      seenWindowRef.current = true;
      setFlags({ sawWindow:true });
    }
  }, [L.scene, L.sub]);

  useEffect(() => {
    if (L.sub === 'manual') addNote(`manual${L.manualPage}`);
  }, [L.sub, L.manualPage]);


  /* ── 規則 2：點擊式道具（不用拖曳）── */
  const held = L.held;
  const canUseHere = id => {
    if (!held) return false;
    if (id === 'panel' && held === 'key'   && !F.panelOpen) return true;
    if (id === 'panel' && held === 'phone' &&  F.panelOpen && !F.phoneOn) return true;
    return false;
  };
  function useHeldOn(id) {
    if (id === 'panel' && held === 'key' && !F.panelOpen) {
      setFlags({ panelOpen:true }); set({ held:null });
      setMsg('鑰匙轉了半圈，蓋板打開了。裡面是一個老式插座。');
      return true;
    }
    if (id === 'panel' && held === 'phone' && F.panelOpen && !F.phoneOn) {
      setFlags({ phoneOn:true }); set({ held:null }); addNote('phone');
      setMsg('你把手機插上去。黑掉的螢幕閃了一下，跳出充電的圖示……然後亮了。');
      return true;
    }
    setMsg('放不上去。');
    return false;
  }

  function Backpack() {
    if (!L.bag.length) return null;
    return (
      <div style={{ display:'flex', gap:10, marginTop:14, paddingTop:12,
                    borderTop:'1px solid var(--line)', flexWrap:'wrap' }}>
        {L.bag.map(id => {
          const it = ITEMS[id];
          const on = held === id;
          return (
            <div key={id} onClick={() => setViewing(id)} title={`${it.name}　點一下查看`}
              style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                       cursor:'pointer', padding:6, borderRadius:8,
                       border: on ? '2px solid var(--brass)' : '2px solid transparent' }}>
              <img src={it.img} alt="" style={{ width:44, height:44, objectFit:'contain', borderRadius:6 }}
                   onError={e=>{e.target.style.opacity=.2;}} />
              <span className="muted" style={{ fontSize:11 }}>{it.name}{on ? '（拿著）' : ''}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function HeldBar() {
    if (!held) return null;
    return (
      <div className="card" style={{ marginTop:12, padding:'8px 12px',
             display:'flex', alignItems:'center', gap:10, borderColor:'var(--brass)' }}>
        <img src={ITEMS[held].img} alt="" style={{ width:26, height:26, objectFit:'contain' }} />
        <span>手上：{ITEMS[held].name}</span>
        <span className="muted" style={{ fontSize:12 }}>　點發光的地方使用</span>
        <button className="btn" style={{ marginLeft:'auto' }} onClick={()=>set({held:null})}>放下</button>
      </div>
    );
  }

  // 有專屬頁面的道具，點開直接跳到該頁（在 effect 裡做，避免 render 期間改 state）
  useEffect(() => {
    if (!viewing) return;
    if (viewing === 'manual' || viewing === 'ticket' || (viewing === 'phone' && F.phoneOn)) {
      const target = viewing;
      setViewing(null);
      open(target);
    }
  }, [viewing, F.phoneOn]);

  function ItemModal() {
    if (!viewing) return null;
    if (viewing === 'manual' || viewing === 'ticket' || (viewing === 'phone' && F.phoneOn)) return null;
    const it = ITEMS[viewing];
    return (
      <div className="card" style={{ marginTop:14 }}>
        <img src={it.img} alt="" style={{ width:'100%', maxWidth:220, borderRadius:10, marginBottom:10 }}
             onError={e=>{e.target.style.display='none';}} />
        <p className="muted">{it.view}</p>
        <div style={{ display:'flex', gap:10, marginTop:10 }}>
          <button className="btn key" onClick={()=>{ set({held:viewing}); setViewing(null); }}>拿起</button>
          <button className="btn" onClick={()=>setViewing(null)}>關閉</button>
        </div>
      </div>
    );
  }

  /* ── 規則 3：自動筆記 ── */
  function NotesPanel() {
    if (!notesOpen) return null;
    return (
      <div className="card" style={{ marginTop:14 }}>
        <p className="h2">筆記</p>
        {L.notes.length === 0
          ? <p className="muted">還沒有記下任何東西。</p>
          : L.notes.map(id => <p className="muted" key={id} style={{ marginBottom:6 }}>· {NOTES[id]}</p>)}
        <button className="btn" style={{ marginTop:10 }} onClick={()=>setNotes(false)}>關閉</button>
      </div>
    );
  }

  // 每個場景共用同一套骨架
  function Shell({ sc, hotspots, children }) {
    return (
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
          <p className="h2" style={{ margin:0 }}>{sc.title}</p>
          <button className="btn" style={{ marginLeft:'auto' }} onClick={()=>setNotes(v=>!v)}>
            筆記{L.notes.length ? `（${L.notes.length}）` : ''}
          </button>
        </div>
        <img src={sc.img} alt="" style={{ width:'100%', borderRadius:12, marginBottom:12 }}
             onError={e=>{e.target.style.display='none';}} />
        {sc.text.map((t,i)=><p className="muted" key={i} style={{marginBottom:6}}>{t}</p>)}
        {hotspots && (
          <div className="grid2" style={{ marginTop:14 }}>
            {hotspots.map(h => (
              <button key={h.id}
                className={`btn${canUseHere(h.id) ? ' key' : ''}`}
                style={canUseHere(h.id)
                  ? { outline:'2px dashed var(--brass)', outlineOffset:3 } : undefined}
                onClick={() => { if (held) { useHeldOn(h.id); } else { open(h.id); } }}>
                {h.label}
              </button>
            ))}
          </div>
        )}
        {children}
        {msg && <p className="muted" style={{ marginTop:10 }}>{msg}</p>}
        <HeldBar />
        <Backpack />
        <ItemModal />
        <NotesPanel />
      </div>
    );
  }

  function Sub({ title, children }) {
    return (
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
          <p className="h2" style={{ margin:0 }}>{title}</p>
          <button className="btn" style={{ marginLeft:'auto' }} onClick={()=>setNotes(v=>!v)}>筆記</button>
        </div>
        {children}
        {msg && <p className="muted" style={{ marginTop:10 }}>{msg}</p>}
        <HeldBar />
        <Backpack />
        <ItemModal />
        <NotesPanel />
        <button className="btn" style={{ marginTop:14 }} onClick={back}>返回</button>
      </div>
    );
  }

  /* ── 規則 6：獎勵一次性，關卡可重進 ── */
  function finish(n) {
    patch(p => {
      const cur = { ...INITIAL, ...(p.lastcar||{}) };
      const first = !cur.cleared;
      return {
        lastcar: { ...cur, cleared:true, locked:true, ending:n,
                   scene:'endingPlay', sub:null, held:null, _got:n },
        bag: first ? { ...p.bag, megaExp:(p.bag?.megaExp||0) + ENDINGS[n].reward } : p.bag,
      };
    });
    setEndIdx(0);
  }

  /* ───────────────── 場景：intro ───────────────── */
  if (L.scene === 'intro') {
    if (L.locked) return (
      <div className="card">
        <p className="h2">末班車 · 23:47</p>
        <p className="muted" style={{ marginBottom:14 }}>
          你已經搭過這班車了。結局：{ENDINGS[L.ending]?.name || '—'}。
        </p>
        <p className="muted" style={{ marginBottom:14 }}>末班車一個人只會來一次。這扇門不會再打開了。</p>
        <button className="btn key" onClick={exit}>離開</button>
      </div>
    );
    return (
      <div className="card">
        <p className="h2">末班車 · 23:47</p>
        <p className="muted" style={{ marginBottom:14 }}>
          解謎副本，任何等級都能進入。<b style={{color:'var(--vermilion)'}}>整個副本只能通關一次</b>——
          取得任何一個結局之後就永久鎖定，無法再進入。
        </p>
        <p className="muted" style={{ marginBottom:14 }}>
          {LOCK_ON_EXIT
            ? '中途離開也算，一樣會永久鎖定。'
            : '中途離開沒關係，進度會保留，下次可以從原本的地方接回。'}
        </p>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button className="btn" onClick={exit}>先不要</button>
          <button className="btn key"
            onClick={()=>{ set({ scene:'seat', started:true }); setIntroIdx(0); }}>上車</button>
        </div>
      </div>
    );
  }

  /* ───────────────── 場景：seat（開場 + 教學）───────────────── */
  if (L.scene === 'seat') {
    if (!F.stood) {
      const last = introIdx >= INTRO_LINES.length - 1;
      return (
        <div className="card">
          <img src={SCENES.seat.img} alt="" style={{width:'100%',borderRadius:12,marginBottom:12}}
               onError={e=>{e.target.style.display='none';}} />
          <Typewriter text={INTRO_LINES[introIdx]} />
          <button className="btn key" style={{ marginTop:12 }}
            onClick={() => last
              ? (setFlags({ stood:true }), addItem('ticket'), addNote('ticket'))
              : setIntroIdx(i=>i+1)}>
            {last ? '起身' : '繼續'}
          </button>
        </div>
      );
    }
    if (L.sub === 'ticket') return <TicketPage />;
    return (
      <Shell sc={SCENES.seat}>
        <p className="muted" style={{ marginTop:12 }}>
          你撿起了車票。<b>點下面的道具可以查看，看過的線索會自動記進「筆記」。</b>
        </p>
        <button className="btn key" style={{ marginTop:14, width:'100%' }} onClick={()=>go('car')}>
          走到車廂中間看看
        </button>
      </Shell>
    );
  }

  /* ───────────────── 子頁：車票 ───────────────── */
  function TicketPage() {
    return (
      <Sub title="車票">
        <Clue src={CLUE_IMG.ticket} fallback={
          <div className="mono" style={{ padding:18, lineHeight:2, textAlign:'center' }}>
            <div>發車　{TICKET.depart}</div>
            <div style={{ fontSize:22 }}>第 {TICKET.car} 車　{TICKET.row} 排　{TICKET.seat} 號</div>
            <div>往　{TICKET.to}</div>
          </div>} />
        <p className="muted" style={{marginTop:10}}>{ITEMS.ticket.view}</p>
      </Sub>
    );
  }

  /* ───────────────── 子頁：站務手冊 ───────────────── */
  function ManualPage() {
    const p = MANUAL_PAGES[L.manualPage - 1];
    return (
      <Sub title={`站務手冊　第 ${p.n} 頁`}>
        <Pic src={`/lastcar/manual_p${p.n}.png`} />
        <div className="card" style={{ padding:18 }}>
          <p style={{ marginBottom:10, fontWeight:700 }}>【{p.title}】</p>
          <p className="muted" style={{ lineHeight:2 }}>{p.text}</p>
        </div>
        <div style={{display:'flex',gap:8,marginTop:12}}>
          <button className="btn" disabled={L.manualPage<=1} onClick={()=>set({manualPage:L.manualPage-1})}>上一頁</button>
          <button className="btn" disabled={L.manualPage>=MANUAL_PAGES.length} onClick={()=>set({manualPage:L.manualPage+1})}>下一頁</button>
        </div>
      </Sub>
    );
  }

  /* ───────────────── 場景：car ───────────────── */
  if (L.scene === 'car') {
    const sub = L.sub;

    if (sub === 'ticket') return <TicketPage />;

    if (sub === 'locker') {
      if (!F.lockerOpen) {
        return (
          <Sub title="遺失物櫃">
            <Pic src="/lastcar/locker.png" />
            <p className="muted">{CAR_HOTSPOTS[0].desc}</p>
            <Keypad len={3} answer={LOCKER_CODE}
              onPass={() => { setFlags({ lockerOpen:true }); addItem('phone','key','manual'); setMsg(''); }} />
          </Sub>
        );
      }
      return (
        <Sub title="遺失物櫃">
          <Pic src="/lastcar/locker_open.png" />
          {LOCKER_OPEN_TEXT.map((t,i)=><p className="muted" key={i} style={{marginBottom:6}}>{t}</p>)}
        </Sub>
      );
    }

    if (sub === 'keypad') {
      if (!F.cabOpen) return (
        <Sub title="駕駛室門">
          <Pic src="/lastcar/keypad.png" />
          <p className="muted">{CAR_HOTSPOTS[1].desc}</p>
          <Keypad len={4} answer={CAB_CODE}
            onPass={() => { setFlags({ cabOpen:true }); setMsg('嗶。紅燈轉綠，門滑開了。'); }} />
        </Sub>
      );
      return (
        <Sub title="駕駛室門">
          <p className="muted">綠燈亮著，門是開的。</p>
          <button className="btn key" style={{marginTop:12}} onClick={()=>go('cab')}>走進駕駛室</button>
        </Sub>
      );
    }

    if (sub === 'routemap') {
      return (
        <Sub title="路線圖燈箱">
          <Clue src={CLUE_IMG.routemap} fallback={
            <div className="mono" style={{ padding:16, textAlign:'center', lineHeight:2.2 }}>
              {STATIONS.join(' ─ ')}
            </div>} />
          <p className="muted" style={{marginTop:10}}>{ROUTEMAP_NOTE}</p>
          {F.phoneOn && <p className="muted" style={{marginTop:6}}>{ROUTEMAP_NOTE2}</p>}
        </Sub>
      );
    }

    if (sub === 'timetable') {
      return (
        <Sub title="時刻表">
          <Clue src={CLUE_IMG.timetable} fallback={
            <div className="mono" style={{ padding:16, textAlign:'center', lineHeight:2.1 }}>
              {TIMETABLE.map(r => (
                <div key={r.time} style={ r.last ? { color:'var(--vermilion)', fontWeight:700 } : undefined }>
                  {r.time}{r.last && '　★ 末班車'}
                </div>
              ))}
            </div>} />
        </Sub>
      );
    }

    if (sub === 'window') {
      return (
        <Sub title="車窗">
          <Pic src="/lastcar/window.png" />
          {seenWindowRef.current && F.sawWindow
            ? <p className="muted">{WINDOW_AGAIN}</p>
            : WINDOW_TEXT.map((t,i)=><p className="muted" key={i} style={{marginBottom:6}}>{t}</p>)}
        </Sub>
      );
    }

    if (sub === 'handle') return (
      <Sub title="緊急開門把手">
        <p className="muted">拉下去，車門就會打開。</p>
        <p className="muted">外面是隧道，車還在跑。</p>
        {!confirmJump
          ? <button className="btn" style={{marginTop:12}} onClick={()=>setCJ(true)}>拉下把手</button>
          : (
            <div className="card" style={{marginTop:12, borderColor:'var(--vermilion)'}}>
              <p style={{marginBottom:10}}>真的要在隧道裡打開車門嗎？</p>
              <div style={{display:'flex',gap:10}}>
                <button className="btn" onClick={()=>setCJ(false)}>算了</button>
                <button className="btn key" onClick={()=>finish(3)}>拉下去</button>
              </div>
            </div>
          )}
      </Sub>
    );

    if (sub === 'manual') return <ManualPage />;

    if (sub === 'phone' && F.phoneOn) return <PhonePage />;

    return (
      <Shell sc={SCENES.car} hotspots={CAR_HOTSPOTS}>
        {F.cabOpen && (
          <button className="btn key" style={{marginTop:14,width:'100%'}} onClick={()=>go('cab')}>
            走進駕駛室
          </button>
        )}
      </Shell>
    );
  }

  /* ───────────────── 子頁：手機（開機後）───────────────── */
  function PhonePage() {
    return (
      <Sub title="手機">
        <Clue src="/lastcar/clue_phone.png" fallback={
          <div style={{ padding:20, textAlign:'center' }}>
            <div className="mono" style={{ fontSize:34 }}>{PHONE_ON.clock}</div>
            <div className="muted" style={{ fontSize:12, marginBottom:16 }}>{PHONE_ON.date}</div>
            <p style={{ fontSize:12 }}>訊息　·　{PHONE_ON.from}</p>
            <p style={{ lineHeight:1.9 }}>「{PHONE_ON.msg}」</p>
          </div>} />
        <p className="muted" style={{marginTop:12}}>{PHONE_ON.note}</p>
        <p className="muted" style={{marginTop:6}}>{PHONE_ON.after}</p>
      </Sub>
    );
  }

  /* ───────────────── 場景：cab ───────────────── */
  if (L.scene === 'cab') {
    const sub = L.sub;

    if (sub === 'ticket') return <TicketPage />;
    if (sub === 'manual') return <ManualPage />;
    if (sub === 'phone' && F.phoneOn) return <PhonePage />;

    if (sub === 'log') {
      return (
        <Sub title="行車紀錄">
          <Clue src={CLUE_IMG.log} fallback={
            <div className="mono" style={{ padding:18, lineHeight:2.1 }}>
              {LOG_SCREEN.rows.map((r,i)=><div key={i}>{r.t}　{r.s}</div>)}
              <div style={{ marginTop:10, color:'var(--vermilion)', fontWeight:700 }}>{LOG_SCREEN.status}</div>
            </div>} />
          <p className="muted" style={{marginTop:10}}>{LOG_SCREEN.after}</p>
        </Sub>
      );
    }

    if (sub === 'jacket') return (
      <Sub title="外套">
        <Pic src="/lastcar/jacket.png" />
        {JACKET_TEXT.map((t,i)=><p className="muted" key={i} style={{marginBottom:6}}>{t}</p>)}
      </Sub>
    );

    if (sub === 'panel') return (
      <Sub title="插座蓋板">
        <Pic src={F.panelOpen ? '/lastcar/panel_open.png' : '/lastcar/panel.png'} />
        <p className="muted">
          {!F.panelOpen ? CAB_HOTSPOTS[1].desc
            : F.phoneOn ? '蓋板開著，手機插在插座上，螢幕亮著。'
            : '蓋板打開了，裡面是一個老式插座。'}
        </p>
        {!F.phoneOn && (
          <p className="muted" style={{marginTop:10}}>
            {!F.panelOpen ? '需要用什麼東西才打得開。' : '有東西可以插上去嗎？'}
            　<b>先在下面點選道具，再點這裡的「使用」。</b>
          </p>
        )}
        {held && !F.phoneOn && (
          <button className="btn key" style={{marginTop:12, outline:'2px dashed var(--brass)', outlineOffset:3}}
            onClick={()=>useHeldOn('panel')}>
            對蓋板使用「{ITEMS[held].name}」
          </button>
        )}
        {F.phoneOn && (
          <button className="btn key" style={{marginTop:12}} onClick={()=>open('phone')}>查看手機</button>
        )}
      </Sub>
    );

    if (sub === 'dial') return (
      <Sub title="目的地轉盤">
        <Pic src="/lastcar/dial.png" />
        <p className="muted">{CAB_HOTSPOTS[2].desc}</p>
        <div className="grid2" style={{marginTop:14}}>
          {STATIONS.map(s => (
            <button key={s} className="btn" onClick={()=>setCS(s)}>{s}</button>
          ))}
        </div>
        {confirmStation && (
          <div className="card" style={{marginTop:14, borderColor:'var(--vermilion)'}}>
            <p style={{marginBottom:10}}>你要把終點設在「{confirmStation}」嗎？設定之後不能再改。</p>
            <div style={{display:'flex',gap:10}}>
              <button className="btn" onClick={()=>setCS(null)}>再想想</button>
              <button className="btn key"
                onClick={()=>finish(confirmStation === TRUE_STATION ? 1 : 2)}>確定</button>
            </div>
          </div>
        )}
      </Sub>
    );

    return (
      <Shell sc={SCENES.cab} hotspots={CAB_HOTSPOTS}>
        <button className="btn" style={{marginTop:14,width:'100%'}} onClick={()=>go('car')}>回到車廂</button>
      </Shell>
    );
  }

  /* ───────────────── 結局播放 ───────────────── */
  if (L.scene === 'endingPlay') {
    const n = L._got || L.ending || 1;
    const E = ENDINGS[n];
    const last = endIdx >= E.lines.length - 1;
    return (
      <div className="card">
        <img src={E.img} alt="" style={{width:'100%',borderRadius:12,marginBottom:12}}
             onError={e=>{e.target.style.display='none';}} />
        <Typewriter text={E.lines[endIdx]} />
        <button className="btn key" style={{marginTop:12}}
          onClick={()=> last ? set({ scene:'ending' }) : setEndIdx(i=>i+1)}>
          {last ? '結束' : '繼續'}
        </button>
      </div>
    );
  }

  if (L.scene === 'ending') {
    const n = L._got || L.ending || 1;
    const E = ENDINGS[n];
    return (
      <div className="card">
        <p className="h2">結局：{E.name}</p>
        <p className="muted">{E.best ? '這是最好的結局。' : '還有別的結局。'}</p>
        <p className="muted" style={{marginTop:8}}>
          獲得十倍經驗卷 ×{E.reward}
        </p>
        <button className="btn key" style={{marginTop:16}} onClick={exit}>離開</button>
      </div>
    );
  }

  return null;
}
