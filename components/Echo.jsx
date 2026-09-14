'use client';
// ── 回聲 · 山區中繼電台 ── 副本主元件（第一部分：骨架與核心機制）
// 路徑：foshan/components/Echo.jsx
// 掛載：Game.jsx  scene==='echo' ? <Echo S={S} patch={patch} exit={()=>setScene(null)} />

import { useState, useEffect, useRef } from 'react';
import { INITIAL, INTRO, SCENES, ITEMS, CIRCUITS, MAX_LOAD, ENDINGS, LOCK_ON_EXIT,
         RUNDOWN, TAPES, TAPE_ORDER, TAPE_FAIL, SIG_LO, SIG_HI,
         MORSE_WORD, MORSE_TRACE, DIAL_LEN, FILE_LINES, MIRROR_HIDDEN,
         VOICE_LINES, VOICE_PROBE } from '@/lib/echo';

/* ── 小元件 ────────────────────────────── */

function Typewriter({ text, speed = 40, onDone }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0); if (!text) return;
    const t = setInterval(() => setN(v => {
      if (v >= text.length) { clearInterval(t); onDone && onDone(); return v; }
      return v + 1;
    }), speed);
    return () => clearInterval(t);
  }, [text]);
  return <p style={{ lineHeight:1.9, minHeight:'3em' }}>{text.slice(0, n)}</p>;
}

function Pic({ src }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return <img src={src} alt="" onError={()=>setBad(true)}
              style={{ width:'100%', borderRadius:12, display:'block', marginBottom:10 }} />;
}

/* ── 主元件 ────────────────────────────── */

export default function Echo({ S, patch, exit }) {
  const E = { ...INITIAL, ...(S.echo || {}) };
  const F = E.flags || {};
  const P = E.power || [];

  const [msg, setMsg]   = useState('');
  const [view, setView] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [introIdx, setIntroIdx]   = useState(0);
  const [endIdx, setEndIdx]       = useState(0);
  const [queue, setQueue]   = useState([]);      // 播帶順序
  const [dialV, setDialV]   = useState('');      // 字母轉盤
  const [scan, setScan]     = useState(30);      // 掃頻位置
  const [vIdx, setVIdx]     = useState(0);       // 無線電對話進度

  const set = up => patch(p => ({ echo:{ ...INITIAL, ...(p.echo||{}), ...up } }));
  const setFlags = up => patch(p => {
    const c = { ...INITIAL, ...(p.echo||{}) };
    return { echo:{ ...c, flags:{ ...c.flags, ...up } } };
  });
  const addItem = (...ids) => patch(p => {
    const c = { ...INITIAL, ...(p.echo||{}) };
    return { echo:{ ...c, bag:[...new Set([...(c.bag||[]), ...ids])] } };
  });
  const dropItem = id => patch(p => {
    const c = { ...INITIAL, ...(p.echo||{}) };
    return { echo:{ ...c, bag:(c.bag||[]).filter(x=>x!==id), held:null } };
  });
  const note = (...t) => patch(p => {
    const c = { ...INITIAL, ...(p.echo||{}) };
    return { echo:{ ...c, notes:[...new Set([...(c.notes||[]), ...t])] } };
  });

  const go   = s   => { set({ scene:s, sub:null }); setMsg(''); };
  const open = sub => { set({ sub }); setMsg(''); };
  const back = ()  => { set({ sub:null }); setMsg(''); };

  const on = id => P.includes(id);
  const held = E.held;

  /* 進子頁時自動記筆記：一律在 effect 做，不能在 render 內改 state */
  const SUB_NOTES = {
    notice:  '公佈欄：發電機最大負載兩路，開三路會跳閘全站斷電',
    glow:    '走廊牆上的夜光標記：一個向下的箭頭，下面三條橫線',
    logbook: '值班日誌：三天的紀錄，第三筆的筆跡跟前兩筆不一樣',
    roster:  '值班表：有一列被劃掉重寫，後面還夾著第二張',
    chart:   '控制室牆上有一份摩斯電碼對照表',
    playlist:'排播單：台呼 22:00 → 測試訊號 02:55 → 例行回報 03:00',
  };
  useEffect(() => {
    const t = SUB_NOTES[E.sub];
    if (t) note(t);
    if (E.sub === 'window' && !P.includes('D'))
      note('窗上的霜：滿滿的正字記號，下面寫著「第 1043 夜」');
  }, [E.sub, E.power]);

  /* ── 核心機制：切換迴路 ── */
  function toggle(id) {
    let next;
    if (P.includes(id)) next = P.filter(x => x !== id);
    else if (P.length < MAX_LOAD) next = [...P, id];
    else { setMsg('發電機負載已滿。要開這一路，得先關掉另一路。'); return; }
    set({ power: next });
    setMsg(next.includes(id) ? `${CIRCUITS.find(c=>c.id===id).name}　已送電。`
                             : `${CIRCUITS.find(c=>c.id===id).name}　已斷電。`);
  }

  /* ── 道具使用 ── */
  function useHeld(target) {
    if (!held) return false;
    if (target === 'torch' && held === 'battery' && E.bag.includes('torch')) {
      dropItem('battery'); dropItem('torch'); addItem('torchOn');
      setMsg('你把兩顆電池塞進去，旋緊蓋子。燈亮了——很暗，但夠用。');
      return true;
    }
    if (target === 'locker' && held === 'key' && !F.lockerOpen) {
      setFlags({ lockerOpen:true }); dropItem('key');
      setMsg('鑰匙轉了一圈。櫃門開了。');
      return true;
    }
    if (target === 'junction' && held === 'connector' && !F.feederFixed) {
      if (!on('B')) { setMsg('接線盒沒電，現在動它很危險。'); return false; }
      setFlags({ feederFixed:true }); dropItem('connector');
      setMsg('接頭鎖上了。饋線接回去了。');
      return true;
    }
    setMsg('放不上去。');
    return false;
  }

  /* ── 背包 ── */
  function Bag() {
    if (!E.bag.length) return null;
    return (
      <div style={{ display:'flex', gap:10, marginTop:14, paddingTop:12,
                    borderTop:'1px solid var(--line)', flexWrap:'wrap' }}>
        {E.bag.map(id => {
          const it = ITEMS[id]; if (!it) return null;
          return (
            <div key={id} onClick={()=>setView(id)}
              style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                       cursor:'pointer', padding:6, borderRadius:8,
                       border: held===id ? '2px solid var(--brass)' : '2px solid transparent' }}>
              <img src={it.img} alt="" style={{ width:44, height:44, objectFit:'contain', borderRadius:6 }}
                   onError={e=>{e.target.style.opacity=.2;}} />
              <span className="muted" style={{ fontSize:11 }}>
                {it.name}{held===id ? '（拿著）' : ''}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  function HeldBar() {
    if (!held) return null;
    return (
      <div className="card" style={{ marginTop:12, padding:'8px 12px', display:'flex',
             alignItems:'center', gap:10, borderColor:'var(--brass)' }}>
        <span>手上：{ITEMS[held]?.name}</span>
        <span className="muted" style={{ fontSize:12 }}>　點目標使用</span>
        <button className="btn" style={{ marginLeft:'auto' }} onClick={()=>set({held:null})}>放下</button>
      </div>
    );
  }

  function ViewModal() {
    if (!view) return null;
    const it = ITEMS[view]; if (!it) return null;
    return (
      <div className="card" style={{ marginTop:14 }}>
        <img src={it.img} alt="" style={{ width:'100%', maxWidth:220, borderRadius:10, marginBottom:10 }}
             onError={e=>{e.target.style.display='none';}} />
        <p className="muted">{it.view}</p>
        <div style={{ display:'flex', gap:10, marginTop:10 }}>
          <button className="btn key" onClick={()=>{ set({held:view}); setView(null); }}>拿起</button>
          <button className="btn" onClick={()=>setView(null)}>關閉</button>
        </div>
      </div>
    );
  }

  function Notes() {
    if (!notesOpen) return null;
    return (
      <div className="card" style={{ marginTop:14 }}>
        <p className="h2">筆記</p>
        {E.notes.length === 0
          ? <p className="muted">還沒有記下任何東西。</p>
          : E.notes.map((t,i) => <p className="muted" key={i} style={{marginBottom:6}}>· {t}</p>)}
        <button className="btn" style={{ marginTop:10 }} onClick={()=>setNotesOpen(false)}>關閉</button>
      </div>
    );
  }

  /* ── 常駐電力列 ── */
  function PowerBar() {
    return (
      <div style={{ display:'flex', gap:6, marginTop:12, flexWrap:'wrap', alignItems:'center' }}>
        <span className="muted" style={{ fontSize:11 }}>負載 {P.length}/{MAX_LOAD}</span>
        {CIRCUITS.map(c => (
          <span key={c.id} className="mono"
            style={{ fontSize:11, padding:'2px 8px', borderRadius:6,
                     border:'1px solid var(--line)',
                     color: on(c.id) ? 'var(--brass)' : 'var(--dim)',
                     opacity: on(c.id) ? 1 : .5 }}>
            {c.id}·{c.name}{on(c.id) ? ' 開' : ' 關'}
          </span>
        ))}
      </div>
    );
  }

  function Shell({ sc, children }) {
    const spots = (sc.spots || []).filter(s => !(s.hideWhen && s.hideWhen(P)));
    return (
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
          <p className="h2" style={{ margin:0 }}>{sc.title}</p>
          <button className="btn" style={{ marginLeft:'auto' }} onClick={()=>setNotesOpen(v=>!v)}>
            筆記{E.notes.length ? `（${E.notes.length}）` : ''}
          </button>
        </div>
        <Pic src={sc.img(P)} />
        {sc.text(P).map((t,i)=><p className="muted" key={i} style={{marginBottom:6}}>{t}</p>)}
        <div className="grid2" style={{ marginTop:14 }}>
          {spots.map(s => (
            <button key={s.id} className="btn" onClick={()=>open(s.id)}>{s.label}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap' }}>
          {(sc.exits||[]).map(x => (
            <button key={x.to} className="btn key" onClick={()=>tryGo(x.to)}>→ {x.label}</button>
          ))}
        </div>
        {children}
        {msg && <p className="muted" style={{ marginTop:10 }}>{msg}</p>}
        <PowerBar />
        <HeldBar />
        <Bag />
        <ViewModal />
        <Notes />
      </div>
    );
  }

  function tryGo(to) {
    const t = SCENES[to];
    if (t.needC && !on('C')) { setMsg('資料庫的門是電磁鎖，沒電打不開。'); return; }
    if ((to === 'hall' || to === 'control' || to === 'tower' || to === 'archive')
        && !on('A') && !E.bag.includes('torchOn')) {
      setMsg('沒有燈，也沒有光源。你什麼都看不見。'); return;
    }
    go(to);
  }

  function Sub({ title, children }) {
    return (
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
          <p className="h2" style={{ margin:0 }}>{title}</p>
          <button className="btn" style={{ marginLeft:'auto' }} onClick={()=>setNotesOpen(v=>!v)}>筆記</button>
        </div>
        {children}
        {msg && <p className="muted" style={{ marginTop:10 }}>{msg}</p>}
        <PowerBar />
        <HeldBar />
        <Bag />
        <ViewModal />
        <Notes />
        <button className="btn" style={{ marginTop:14 }} onClick={back}>返回</button>
      </div>
    );
  }

  /* ── 結局 ── */
  function finish(k) {
    patch(p => {
      const c = { ...INITIAL, ...(p.echo||{}) };
      const first = !c.cleared;
      return {
        echo:{ ...c, cleared:true, locked:true, ending:k, scene:'endPlay', sub:null, held:null },
        bag: first ? { ...p.bag, megaExp:(p.bag?.megaExp||0) + ENDINGS[k].reward } : p.bag,
      };
    });
    setEndIdx(0);
  }

  /* ═══ intro ═══ */
  if (E.scene === 'intro') {
    if (E.locked) return (
      <div className="card">
        <p className="h2">回聲 · 山區中繼電台</p>
        <p className="muted" style={{marginBottom:14}}>
          你已經上去過了。結局：{ENDINGS[E.ending]?.name || '—'}。
        </p>
        <p className="muted" style={{marginBottom:14}}>路又封了。這一次沒有人叫你上山。</p>
        <button className="btn key" onClick={exit}>離開</button>
      </div>
    );
    return (
      <div className="card">
        <p className="h2">回聲 · 山區中繼電台</p>
        <p className="muted" style={{marginBottom:14}}>
          解謎副本，任何等級都能進入。<b style={{color:'var(--vermilion)'}}>只能通關一次</b>——
          取得任何結局後永久鎖定。
        </p>
        <p className="muted" style={{marginBottom:14}}>
          {LOCK_ON_EXIT ? '中途離開也算，一樣會鎖定。'
                        : '中途離開沒關係，進度會保留，下次從原地接回。'}
        </p>
        <div style={{display:'flex', gap:10}}>
          <button className="btn" onClick={exit}>先不要</button>
          <button className="btn key" onClick={()=>{ set({scene:'open'}); setIntroIdx(0); }}>上山</button>
        </div>
      </div>
    );
  }

  if (E.scene === 'open') {
    const last = introIdx >= INTRO.length - 1;
    return (
      <div className="card">
        <Pic src="/echo/exterior.png" />
        <Typewriter text={INTRO[introIdx]} />
        <button className="btn key" style={{marginTop:12}}
          onClick={()=> last
            ? go('duty')
            : setIntroIdx(i=>i+1)}>
          {last ? '進站' : '繼續'}
        </button>
      </div>
    );
  }

  /* ═══ 結局播放 ═══ */
  if (E.scene === 'endPlay') {
    const X = ENDINGS[E.ending]; const last = endIdx >= X.lines.length - 1;
    return (
      <div className="card">
        <Pic src={X.img} />
        <Typewriter text={X.lines[endIdx]} />
        <button className="btn key" style={{marginTop:12}}
          onClick={()=> last ? set({scene:'end'}) : setEndIdx(i=>i+1)}>
          {last ? '結束' : '繼續'}
        </button>
      </div>
    );
  }
  if (E.scene === 'end') {
    const X = ENDINGS[E.ending];
    return (
      <div className="card">
        <p className="h2">結局：{X.name}</p>
        <p className="muted">{X.best ? '這是最好的結局。' : '還有別的結局。'}</p>
        <p className="muted" style={{marginTop:8}}>獲得十倍經驗卷 ×{X.reward}</p>
        <button className="btn key" style={{marginTop:16}} onClick={exit}>離開</button>
      </div>
    );
  }

  /* ═══ 子頁 ═══ */
  const sub = E.sub;

  if (sub === 'panel') {
    return (
      <Sub title="配電盤">
        <Pic src="/echo/panel_open.png" />
        <p className="muted" style={{marginBottom:10}}>
          四支閘刀。上方的負載表指針貼在紅區邊緣。
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {CIRCUITS.map(c => (
            <button key={c.id}
              className={`btn${on(c.id) ? ' key' : ''}`}
              style={{ textAlign:'left', opacity: on(c.id) ? 1 : .65 }}
              onClick={()=>toggle(c.id)}>
              <b>{c.id}</b>　{c.name}　
              <span className="muted" style={{fontSize:12}}>{c.desc}</span>
              <span style={{ float:'right' }}>{on(c.id) ? '● 送電' : '○ 斷電'}</span>
            </button>
          ))}
        </div>
        <p className="muted" style={{ marginTop:10, fontSize:12 }}>
          目前負載 {P.length} / {MAX_LOAD}
        </p>
      </Sub>
    );
  }

  if (sub === 'notice') {
    return (
      <Sub title="公佈欄">
        <Pic src="/echo/notice.png" />
        <div className="card" style={{ padding:16 }}>
          <p style={{ marginBottom:8, fontWeight:700 }}>【發電機負載限制】</p>
          <p className="muted" style={{ lineHeight:2 }}>
            本站發電機最大負載為兩路。<br/>同時開啟三路以上將導致跳閘，全站斷電。
          </p>
        </div>
      </Sub>
    );
  }

  if (sub === 'glow') {
    return (
      <Sub title="牆面">
        <Pic src="/echo/hall_dark.png" />
        <p className="muted">
          手電筒關掉之後，牆上浮出一片淡綠色的光。是用夜光漆畫的：
          一個很大的向下箭頭，底下三條短橫線。
        </p>
        <p className="muted" style={{marginTop:6}}>畫得很急，漆滴下來過。</p>
      </Sub>
    );
  }

  if (sub === 'window') {
    if (!on('D')) {
      return (
        <Sub title="窗戶">
          <Pic src="/echo/frost.png" />
          <p className="muted">霜結滿了整片玻璃。有人用手指在上面寫過字。</p>
          <p className="muted" style={{marginTop:6}}>
            正字記號。一排一排，寫滿了整面窗。
          </p>
          <p className="muted" style={{marginTop:6}}>最底下一行寫著：第 1043 夜。</p>
        </Sub>
      );
    }
    return (
      <Sub title="窗戶">
        <p className="muted">玻璃是乾淨的，外面什麼都看不見，只有雪。</p>
        <p className="muted" style={{marginTop:6}}>暖氣開著的時候，這扇窗不會結霜。</p>
      </Sub>
    );
  }

  if (sub === 'drawer') {
    return (
      <Sub title="抽屜">
        {!F.gotTorch ? (
          <>
            <Pic src="/echo/item_torch.png" />
            <p className="muted">抽屜裡有一支手電筒。電池蓋是開的，裡面空的。</p>
            <button className="btn key" style={{marginTop:12}}
              onClick={()=>{ setFlags({gotTorch:true}); addItem('torch'); setMsg('拿了手電筒。它沒有電池。'); }}>
              拿走手電筒
            </button>
          </>
        ) : <p className="muted">抽屜裡剩下幾份空白表單和一把生鏽的美工刀。</p>}
      </Sub>
    );
  }

  if (sub === 'radio') {
    return (
      <Sub title="收音機">
        <Pic src="/echo/item_radio.png" />
        {!F.gotBattery ? (
          <>
            <p className="muted">一台舊收音機，背蓋被人拆下來擱在旁邊。電池槽裡有兩顆電池。</p>
            <button className="btn key" style={{marginTop:12}}
              onClick={()=>{ setFlags({gotBattery:true}); addItem('battery'); setMsg('你拿走了兩顆電池。'); }}>
              拿走電池
            </button>
          </>
        ) : <p className="muted">電池槽空了。收音機不會再響。</p>}
      </Sub>
    );
  }

  if (sub === 'desk') {
    return (
      <Sub title="書桌">
        <p className="muted">桌面結了一層薄冰。一個菸灰缸，裡面一根抽到底的菸。</p>
        <p className="muted" style={{marginTop:6}}>一支藍色原子筆躺在桌上，筆蓋沒有蓋回去。</p>
        {E.bag.includes('torch') && !E.bag.includes('torchOn') && (
          <button className="btn key" style={{marginTop:12}}
            onClick={()=>{ if(held==='battery') useHeld('torch'); else setMsg('先從背包拿起電池，再點這裡。'); }}>
            {held==='battery' ? '把電池裝進手電筒' : '（手上要拿著電池）'}
          </button>
        )}
      </Sub>
    );
  }

  if (sub === 'logbook') {
    return (
      <Sub title="值班日誌">
        <Pic src="/echo/logbook.png" />
        <p className="muted">日誌記到三天前為止。三筆紀錄，每一筆最後都有簽名。</p>
        <p className="muted" style={{marginTop:6}}>
          前兩筆的字跡一樣。第三筆——筆畫比較圓，下筆也重得多。
        </p>
        <p className="muted" style={{marginTop:6}}>不是同一個人寫的。</p>
      </Sub>
    );
  }

  if (sub === 'mirror') {
    return (
      <Sub title="鏡子">
        <p className="muted">
          鏡面斑駁得厲害。你從鏡子裡看見身後桌上那本攤開的日誌。
        </p>
        <div style={{ marginTop:12 }}>
          <img src="/echo/logbook_hidden.png" alt=""
               style={{ width:'100%', borderRadius:12,
                        transform: F.mirrorRead ? 'none' : 'scaleX(-1)' }}
               onError={e=>{e.target.style.display='none';}} />
        </div>
        <p className="muted" style={{marginTop:10}}>
          {F.mirrorRead
            ? '從鏡子裡看，字是正的。'
            : '紙上的字是反的。直接看，一個字都讀不出來。'}
        </p>
        {!F.mirrorRead ? (
          <button className="btn key" style={{marginTop:12}}
            onClick={()=>{ setFlags({mirrorRead:true});
                           note('日誌反面藏字：他寫了一千零四十三次，每次回報完就重來'); }}>
            從鏡子裡讀
          </button>
        ) : (
          <div className="card" style={{marginTop:12, padding:16}}>
            <p className="muted" style={{fontSize:12, marginBottom:8}}>
              紀錄底下還有一段，字更小，擠在行距之間。
            </p>
            {MIRROR_HIDDEN.map((t,i)=>(
              <p key={i} style={{lineHeight:2, marginBottom:4}}>{t}</p>
            ))}
          </div>
        )}
      </Sub>
    );
  }

  if (sub === 'locker') {
    if (!F.lockerOpen) return (
      <Sub title="鐵櫃">
        <p className="muted">一人高的灰色鐵櫃，把手上掛著一副簡單的櫃鎖。</p>
        {held === 'key'
          ? <button className="btn key" style={{marginTop:12}} onClick={()=>useHeld('locker')}>用鑰匙開鎖</button>
          : <p className="muted" style={{marginTop:10}}>鎖著。需要鑰匙。</p>}
      </Sub>
    );
    return (
      <Sub title="鐵櫃">
        <Pic src="/echo/manual_torn.png" />
        <p className="muted">櫃子裡有一份被撕碎的維修手冊，散成好幾片。</p>
        {!E.bag.includes('manual') && (
          <button className="btn key" style={{marginTop:12}}
            onClick={()=>{ addItem('manual'); setMsg('你把碎片收起來了。'); }}>
            收起碎片
          </button>
        )}
        <p className="muted" style={{marginTop:12}}>櫃子後半還有一層，鎖著。</p>
        <button className="btn" style={{marginTop:8}} onClick={()=>open('dial')}>查看內層</button>
      </Sub>
    );
  }

  if (sub === 'tapes') {
    return (
      <Sub title="帶庫">
        <Pic src="/echo/item_tapebox.png" />
        <p className="muted">層架上一整排空白標籤的紙盒。只有三個寫了字：</p>
        <p className="muted" style={{marginTop:6}}>測試訊號　／　台呼　／　例行回報範本</p>
        {!F.gotTapes ? (
          <button className="btn key" style={{marginTop:12}}
            onClick={()=>{ setFlags({ gotTapes:true }); setMsg('你把三個盒子抱去控制室。'); }}>
            把這三盒搬去控制室
          </button>
        ) : <p className="muted" style={{marginTop:10}}>那三盒已經搬去控制室了。</p>}
      </Sub>
    );
  }

  if (sub === 'roster') {
    return (
      <Sub title="值班表">
        <Pic src="/echo/roster.png" />
        <p className="muted">列印的值班表。日期在左邊，三欄名字。</p>
        <p className="muted" style={{marginTop:6}}>有一列被劃掉，用手寫改過。</p>
        {!F.gotKey && (
          <button className="btn key" style={{marginTop:12}}
            onClick={()=>{ setFlags({gotKey:true}); addItem('key'); setMsg('夾層裡掉出一把小鑰匙。'); }}>
            翻開後面那張
          </button>
        )}
      </Sub>
    );
  }

  if (sub === 'floor') {
    if (!F.floorOpen) return (
      <Sub title="地板" >
        <Pic src="/echo/floor_panel.png" />
        <p className="muted">角落有一塊活動地板翹起來，邊緣有撬過的痕跡。</p>
        <button className="btn key" style={{marginTop:12}}
          onClick={()=>{ setFlags({floorOpen:true}); addItem('tape','connector');
                         setMsg('底下有一個鐵盒。裡面是一捲沒有標籤的盤帶，和一個接頭。'); }}>
          撬開地板
        </button>
      </Sub>
    );
    return (
      <Sub title="地板">
        <Pic src="/echo/floor_open.png" />
        <p className="muted">水泥凹槽，空的鐵盒還擺在裡面。</p>
      </Sub>
    );
  }

  if (sub === 'junction') {
    return (
      <Sub title="接線盒">
        <Pic src={F.feederFixed ? '/echo/feeder_fixed.png' : '/echo/feeder_cut.png'} />
        <p className="muted">
          {F.feederFixed
            ? '饋線接回去了，接頭鎖得很緊。'
            : '粗黑的同軸饋線從盒子裡拉出來，末端被整齊地切斷了，銅網露在外面。'}
        </p>
        {!F.feederFixed && (
          held === 'connector'
            ? <button className="btn key" style={{marginTop:12}} onClick={()=>useHeld('junction')}>接上接頭</button>
            : <p className="muted" style={{marginTop:10}}>切口很平整。這不是斷的，是有人剪的。</p>
        )}
      </Sub>
    );
  }

  if (sub === 'mainsw') {
    return (
      <Sub title="總開關">
        <Pic src="/echo/main_switch.png" />
        <p className="muted">水泥牆上一支紅色的大型閘刀，裝在鋼製護罩裡。現在是推上去的。</p>
        <p className="muted" style={{marginTop:6}}>拉下去，整座站會斷電。塔頂的燈也會滅。</p>
        {F.clock3 ? (
          <button className="btn key" style={{marginTop:12}} onClick={()=>finish('silence')}>
            雙手握住，往下拉
          </button>
        ) : (
          <button className="btn" style={{marginTop:12}}
            onClick={()=>setMsg(
              !F.feederFixed ? '你把手放在閘刀上。冰冷的。這座站現在本來就是死的，拉下去沒有任何意義。'
              : !F.tapesDone ? '閘刀很緊。你想了想——發射機都還沒發出過一個字，關掉它做什麼。'
              : !F.scanned   ? '你握著閘刀站了一會兒。有些事你還沒弄清楚。'
              : '總台快要呼叫了。先聽聽他怎麼說。')}>
            握住閘刀
          </button>
        )}
      </Sub>
    );
  }

  if (sub === 'chart') {
    return (
      <Sub title="電碼對照表">
        <Pic src="/echo/code_chart.png" />
        <p className="muted">泛黃的對照表，用圖釘釘在牆上。左邊 A 到 T，右上 U 到 Z，右下是數字。</p>
      </Sub>
    );
  }

  /* ── 盤帶機：播放順序 ── */
  if (sub === 'tapemachine') {
    if (!on('B')) return (
      <Sub title="盤帶機">
        <Pic src="/echo/tape_machine.png" />
        <p className="muted">沒有電，兩個捲盤軸紋風不動。</p>
      </Sub>
    );
    if (!F.gotTapes) return (
      <Sub title="盤帶機">
        <Pic src="/echo/tape_machine.png" />
        <p className="muted">機器是活的，但兩個捲盤軸都是空的。</p>
        <p className="muted" style={{marginTop:6}}>沒有帶子，什麼都放不了。</p>
      </Sub>
    );
    if (F.tapesDone) return (
      <Sub title="盤帶機">
        <Pic src="/echo/tape_machine.png" />
        <p className="muted">三捲都跑完了。VU 表的針停在中間，穩住不動。</p>
        <p className="muted" style={{marginTop:6}}>發射機的載波燈亮著。</p>
      </Sub>
    );
    const play = () => {
      if (queue.join() === TAPE_ORDER.join()) {
        setFlags({ tapesDone:true });
        setMsg('三捲跑完，針停在中間不動了。發射機的載波燈亮起來。');
      } else {
        const i = queue.findIndex((x,k)=>x!==TAPE_ORDER[k]);
        setMsg(i === 0 ? TAPE_FAIL.first : TAPE_FAIL.mid);
      }
      setQueue([]);
    };
    return (
      <Sub title="盤帶機">
        <Pic src="/echo/tape_machine.png" />
        <p className="muted">兩個空捲盤軸。旁邊擺著從帶庫拿來的三個盒子。</p>
        <p className="muted" style={{marginTop:6}}>要照順序上帶。順序不對，機器不會認。</p>
        <div className="grid2" style={{marginTop:14}}>
          {TAPES.map(t => (
            <button key={t.id} className="btn"
              disabled={queue.includes(t.id)}
              onClick={()=>setQueue(q=>[...q, t.id])}>
              {t.name}
            </button>
          ))}
        </div>
        <p className="mono" style={{marginTop:12, minHeight:24}}>
          {queue.length
            ? queue.map(id=>TAPES.find(t=>t.id===id).name).join(' → ')
            : '（尚未上帶）'}
        </p>
        <div style={{display:'flex', gap:8, marginTop:8}}>
          <button className="btn" onClick={()=>{setQueue([]); setMsg('');}}>退帶</button>
          <button className="btn key" disabled={queue.length !== 3} onClick={play}>播放</button>
        </div>
      </Sub>
    );
  }

  /* ── 排播單 ── */
  if (sub === 'playlist') {
    return (
      <Sub title="排播單">
        <div className="card mono" style={{padding:16, lineHeight:2.2}}>
          {RUNDOWN.map(r => <div key={r.t}>{r.t}　{r.s}</div>)}
        </div>
        <p className="muted" style={{marginTop:10}}>
          一張夾在唱盤旁邊的例行排播單。每天的流程都一樣，所以沒有人會去改它。
        </p>
      </Sub>
    );
  }

  if (sub === 'turntable') return (
    <Sub title="唱盤">
      <p className="muted">唱針早就斷了。轉盤上還壓著一張沒有封套的黑膠，積了灰。</p>
      <p className="muted" style={{marginTop:6}}>旁邊夾著一張紙。</p>
    </Sub>
  );

  /* ── 掃頻：只看得到強度條 ── */
  if (sub === 'freq') {
    if (!on('B')) return (
      <Sub title="頻率轉盤">
        <Pic src="/echo/freq_dial.png" />
        <p className="muted">刻度盤是暗的。</p>
      </Sub>
    );
    if (!F.feederFixed || !F.tapesDone) return (
      <Sub title="頻率轉盤">
        <Pic src="/echo/freq_dial.png" />
        <p className="muted">背光亮著，但強度表的針貼在最左邊，動也不動。</p>
        <p className="muted" style={{marginTop:6}}>發射機沒有載波，接收端也收不到東西。</p>
      </Sub>
    );
    const d = Math.abs(scan - (SIG_LO + SIG_HI) / 2);
    const strength = Math.max(0, Math.round(100 - d * 9));
    const locked = scan >= SIG_LO && scan <= SIG_HI;
    return (
      <Sub title="頻率轉盤">
        <Pic src="/echo/freq_dial.png" />
        <p className="muted">刻度上的數字早就磨光了。只能看強度表。</p>
        <input type="range" min="0" max="100" value={scan}
          onChange={e=>setScan(Number(e.target.value))}
          style={{ width:'100%', marginTop:14 }} />
        <div style={{ height:14, background:'var(--line)', borderRadius:7, overflow:'hidden', marginTop:10 }}>
          <div style={{ width:`${strength}%`, height:'100%',
                        background: locked ? 'var(--brass)' : 'var(--dim)',
                        transition:'width .12s' }} />
        </div>
        <p className="muted mono" style={{marginTop:8, fontSize:12}}>
          訊號強度 {strength}%{locked ? '　—　鎖定' : ''}
        </p>
        {locked && (
          <button className="btn key" style={{marginTop:12}}
            onClick={()=>{ setFlags({ scanned:true }); open('signal'); }}>
            接上示波器
          </button>
        )}
      </Sub>
    );
  }

  /* ── 訊號波形：視覺化的長短脈衝 ── */
  if (sub === 'signal') {
    return (
      <Sub title="示波器">
        <p className="muted">畫面上跑出一段規律的脈衝，每隔幾秒重複一次。</p>
        <div className="card" style={{ padding:18, marginTop:12 }}>
          {MORSE_TRACE.map((row,i)=>(
            <div key={i} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:12 }}>
              {row.map((sym,j)=>(
                <span key={j} style={{
                  display:'inline-block', height:9, borderRadius:2,
                  width: sym === '—' ? 34 : 9,
                  background:'var(--brass)' }} />
              ))}
            </div>
          ))}
        </div>
        <p className="muted" style={{marginTop:10}}>四組。長的和短的。</p>
        {!F.decoded && (
          <button className="btn" style={{marginTop:12}}
            onClick={()=>{ setFlags({ decoded:true });
                           note('示波器上的四組脈衝，可以對照控制室牆上那張表'); }}>
            記下波形
          </button>
        )}
      </Sub>
    );
  }

  /* ── 鐵櫃第二層：字母轉盤 ── */
  if (sub === 'dial') {
    if (F.fileOpen) return (
      <Sub title="鐵櫃 · 內層">
        {FILE_LINES.map((t,i)=><p className="muted" key={i} style={{marginBottom:6}}>{t}</p>)}
      </Sub>
    );
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const submit = () => {
      if (dialV === MORSE_WORD) {
        setFlags({ fileOpen:true });
        note('鐵櫃內層：一張人事卡，本站呼號 ECHO，單人值勤，無輪替');
        setMsg('四個轉輪同時落下。內層開了。');
      } else { setMsg('轉輪卡住，沒有落下。'); setDialV(''); }
    };
    return (
      <Sub title="鐵櫃 · 內層">
        <p className="muted">櫃子裡面還有一層。四格字母轉盤，沒有標示。</p>
        <p className="mono" style={{ fontSize:26, letterSpacing:'.3em', textAlign:'center', margin:'14px 0' }}>
          {dialV.padEnd(DIAL_LEN, '＿')}
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:5 }}>
          {letters.map(L => (
            <button key={L} className="btn" style={{ padding:'6px 0' }}
              onClick={()=>dialV.length < DIAL_LEN && setDialV(dialV + L)}>{L}</button>
          ))}
        </div>
        <div style={{display:'flex', gap:8, marginTop:10}}>
          <button className="btn" onClick={()=>{setDialV(''); setMsg('');}}>清除</button>
          <button className="btn key" disabled={dialV.length !== DIAL_LEN} onClick={submit}>對位</button>
        </div>
      </Sub>
    );
  }

  /* ── 麥克風 / 無線電：03:00 ── */
  if (sub === 'mic') {
    const ready = F.tapesDone && F.feederFixed;
    if (!ready) return (
      <Sub title="麥克風">
        <p className="muted">推桿是推上去的，但 ON AIR 沒有亮。發射機還沒有載波。</p>
      </Sub>
    );
    const lines = F.scanned ? [...VOICE_LINES, ...VOICE_PROBE] : VOICE_LINES;
    if (vIdx < lines.length) return (
      <Sub title="麥克風">
        <p className="muted" style={{fontSize:12, marginBottom:10}}>
          監聽喇叭壞了。所有通話都轉成文字，打在旁邊那台電傳機上。
        </p>
        <div className="card" style={{padding:16}}>
          <Typewriter text={lines[vIdx]} />
        </div>
        <button className="btn key" style={{marginTop:12}}
          onClick={()=>{ if (vIdx >= lines.length - 1 && F.scanned) setFlags({ clock3:true });
                         setVIdx(i=>i+1); }}>
          {vIdx >= lines.length - 1 ? '不說話' : '繼續'}
        </button>
      </Sub>
    );
    return (
      <Sub title="麥克風">
        <p className="muted">電傳機安靜下來。三點整。總台在等。</p>
        <p className="muted" style={{marginTop:6}}>範本就攤在你面前。唸完就好，很快。</p>
        <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:16}}>
          <button className="btn key" onClick={()=>finish('shift')}>照著範本唸完回報</button>
          <button className="btn" onClick={()=>finish('descent')}>不回報，推開鐵門走進雪裡</button>
          <button className="btn" onClick={back}>先不決定</button>
        </div>
      </Sub>
    );
  }

  /* ═══ 場景 ═══ */
  const sc = SCENES[E.scene];
  if (!sc) return null;
  return <Shell sc={sc} />;
}
