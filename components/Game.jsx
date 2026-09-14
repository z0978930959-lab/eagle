'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import World from './World';
import Quest from './Quest';
import Battle from './Battle';
import Items from './Items';
import Tree from './Tree';
import Skills from './Skills';
import Profile from './Profile';
import Tower from './Tower';
import QuizCenter from './QuizCenter';
import Danger from './Danger';
import Hotel from './Hotel';
import Pets from './Pets';
import LastCar from './LastCar';
import Echo from './Echo';
import Hall from './Hall';
import { QUESTS } from '@/lib/quests';
import { stats, expToNext, apLeft, cycleId, questState, potionHeal, resetDailyQuests,
         dailyBonus, dblActive, dblLeft, DBL_MS, ADV_LV, MAX_LV, megaExpActive,
         BOOSTS, BOOST_MS, boostLeft, boostOn, ADV_JOBS } from '@/lib/engine';
import { POTIONS } from '@/lib/data';

const TABS = [
  { id:'world',  label:'主世界' },
  { id:'quest',  label:'任務' },
  { id:'quiz',   label:'題庫' },
  { id:'items',  label:'道具裝備' },
  { id:'pets',   label:'寵物' },
  { id:'tree',   label:'能力樹' },
  { id:'skills', label:'職業技能' },
  { id:'me',     label:'角色' },
];

export default function Game({ initial, playerId }) {
  const [S, setS] = useState(initial);
  const [tab, setTab] = useState('world');
  // 分流：預設只看得到密室逃脫。輸入通關碼後解鎖完整遊戲，狀態存進存檔。
  const full = !!S.fullMode;
  const demo = !full;
  const [codeV, setCodeV] = useState('');
  const [foe, setFoe] = useState(null);
  const [map, setMap] = useState(null);
  const [inTower, setInTower] = useState(false);
  const [scene, setScene] = useState(null);   // danger | hall
  const [tick, setTick] = useState(0);
  const [sync, setSync] = useState('ok');
  const [syncErr, setSyncErr] = useState('');
  const [potUsed, setPotUsed] = useState(false);   // 戰鬥中每回合限用一次回復藥
  const pending = useRef(null), timer = useRef(null);

  const flush = useCallback(async (state, retry = true) => {
    setSync('saving');
    try {
      const r = await fetch('/api/state', {
        method:'POST', cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id:playerId, state }),
      });
      const d = await r.json();
      if (d.ok) { setSync('ok'); setSyncErr(''); return true; }
      throw new Error(d.error || '伺服器回應異常');
    } catch (e) {
      if (retry) { await new Promise(r => setTimeout(r, 1200)); return flush(state, false); }
      setSync('error'); setSyncErr(e.message || '連線失敗');
      return false;
    }
  }, [playerId]);

  useEffect(() => {
    pending.current = S;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(pending.current), 1200);
    return () => clearTimeout(timer.current);
  }, [S, flush]);

  useEffect(() => {
    const bye = () => {
      if (!pending.current) return;
      navigator.sendBeacon?.('/api/state',
        new Blob([JSON.stringify({ id:playerId, state:pending.current })], { type:'application/json' }));
    };
    window.addEventListener('beforeunload', bye);
    return () => window.removeEventListener('beforeunload', bye);
  }, [playerId]);

  // 每日首次登入送經驗加倍券
  useEffect(() => {
    const b = dailyBonus(S);
    if (b) setS(p => ({ ...p, ...b }));
  }, []);

  // 加倍券與食物增益倒數
  const anyBoost = dblActive(S) || Object.keys(BOOSTS).some(id => boostOn(S, id));
  useEffect(() => {
    if (!anyBoost) return;
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [anyBoost]);

  useEffect(() => {
    const check = () => setS(p => {
      const c = cycleId();
      const nq = resetDailyQuests(p);
      if (p.cycle === c && !nq) return p;
      const out = { ...p };
      if (p.cycle !== c) { out.cycle = c; out.killed = {}; out.refresh = 0; }
      if (nq) out.quests = nq;
      return out;
    });
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  const st = stats(S);
  const need = expToNext(S.lv);
  // 稱號：有三轉顯示三轉、有二轉顯示二轉，否則顯示基礎職業（之前這裡寫死只顯示基礎職業，是 bug）
  const advA = S.advJob ? ADV_JOBS[S.advJob] : null;
  const jobTitle = (advA?.tier3 && S.lv >= advA.tier3.lv) ? advA.tier3.name
    : advA ? advA.name
    : S.job ? { mage:'法師', martial:'武術師', lin:'林董' }[S.job]
    : null;
  const ap = apLeft(S);
  const jobReady = (!S.job && S.lv >= 10) || (S.job && !S.advJob && S.lv >= ADV_LV);
  const qReady = QUESTS.filter(q => ['open','ready'].includes(questState(S,q))).length;
  const patch = up => setS(p => ({ ...p, ...(typeof up==='function' ? up(p) : up) }));
  const busy = !!foe;
  const unlock = () => {
    if (codeV.trim().toLowerCase() === 'te') { patch({ fullMode:true }); setCodeV(''); }
    else setCodeV('');
  };

  return (
    <div className="shell">
      {demo && (
        <div style={{ gridColumn:'1 / -1', display:'flex', gap:8, alignItems:'center',
                      padding:'8px 12px', borderBottom:'1px solid var(--line)', flexWrap:'wrap' }}>
          <span className="muted" style={{ fontSize:12 }}>通關碼</span>
          <input value={codeV} onChange={e=>setCodeV(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') unlock(); }}
            placeholder="輸入後解鎖完整遊戲"
            style={{ flex:'1 1 140px', maxWidth:220, padding:'5px 9px', borderRadius:8,
                     border:'1px solid var(--line)', background:'transparent', color:'inherit' }} />
          <button className="btn" onClick={unlock}>確認</button>
        </div>
      )}
      <aside className="side">
        <div className="brand">牛之谷</div>
        <nav className="nav">
          {TABS.filter(t => full || t.id==='world').map(t => (
            <button key={t.id}
              className={tab===t.id && !busy && !inTower ? 'on' : ''}
              onClick={() => { if(!busy){ setTab(t.id); setInTower(false);} }}
              disabled={busy}>
              <span>{t.label}</span>
              {t.id==='quest'  && qReady>0   && <span className="dot">{qReady}</span>}
              {t.id==='tree'   && ap>0       && <span className="dot">{ap}</span>}
              {t.id==='skills' && jobReady   && <span className="dot">!</span>}
            </button>
          ))}
        </nav>
        <div className="quickpot">
          <p className="quicklabel">快捷回復</p>
          {POTIONS.filter(p => ['hp_s','hp_m','hp_l','mp','exp'].includes(p.id)).map(p0 => {
            const n = S.bag[p0.id] || 0;
            const isHp = p0.kind === 'hp';
            const isExp = p0.kind === 'exp';
            const full = isExp ? S.charm > 0 : isHp ? S.hp >= st.hpMax : S.mp >= st.mpMax;
            const lock = (!isExp && busy && potUsed) || (isHp && inTower);
            return (
              <button key={p0.id} className="potbtn"
                disabled={n <= 0 || full || lock}
                title={inTower && isHp ? '塔內不可補血'
                  : isExp ? (S.charm>0 ? '經驗符生效中' : '經驗符：接下來 10 隻怪 +10%')
                  : lock ? '本回合已用過藥水' : p0.name}
                onClick={() => {
                  if (n <= 0) return;
                  if (isExp) {
                    patch(q => ({ charm: p0.val, bag:{ ...q.bag, [p0.id]: q.bag[p0.id] - 1 } }));
                    return;
                  }
                  if (isHp) {
                    const heal = potionHeal(p0.val, S.tree);
                    patch(q => ({ hp: Math.min(stats(q).hpMax, q.hp + heal),
                                  bag: { ...q.bag, [p0.id]: q.bag[p0.id] - 1 } }));
                    if (busy) setPotUsed(true);
                  } else {
                    patch(q => ({ mp: stats(q).mpMax, bag: { ...q.bag, [p0.id]: q.bag[p0.id] - 1 } }));
                    if (busy) setPotUsed(true);
                  }
                }}>
                {p0.img && <img src={p0.img} alt="" />}
                <span className="potn">{n}</span>
              </button>
            );
          })}
          {(S.bag?.dbl > 0) && !dblActive(S) && (
            <button className="potbtn dblbtn" title="經驗加倍券：5 分鐘內經驗 ×2"
              onClick={() => patch(q => ({ dblUntil: Date.now() + DBL_MS, bag:{ ...q.bag, dbl:q.bag.dbl - 1 } }))}>
              <img src="/item/dbl.png" alt="" />
              <span className="potn">{S.bag.dbl}</span>
            </button>
          )}
          {(S.bag?.megaExp > 0) && !megaExpActive(S) && (
            <button className="potbtn dblbtn" title="十倍經驗卷：經驗 ×10，直到下次升級才會消耗，登出不會中斷"
              onClick={() => patch(q => ({ megaExpActive:true, megaExpLv:q.lv, bag:{ ...q.bag, megaExp:q.bag.megaExp - 1 } }))}>
              <img src="/item/megaExp.png" alt="" />
              <span className="potn">{S.bag.megaExp}</span>
            </button>
          )}
          {Object.entries(BOOSTS).map(([id, b]) => (S.bag?.[id] > 0) && (
            <button key={id} className="potbtn dblbtn"
              title={`${b.name}：30 分鐘攻擊力 +${b.atk}，可與其他增益疊加` +
                     (boostOn(S,id) ? `（生效中，重複使用會重新計時）` : '')}
              onClick={() => patch(q => ({ boost:{ ...(q.boost||{}), [id]: Date.now() + BOOST_MS },
                                           bag:{ ...q.bag, [id]: q.bag[id] - 1 } }))}>
              <img src={POTIONS.find(p => p.id === id)?.img} alt="" />
              <span className="potn">{S.bag[id]}</span>
            </button>
          ))}
          {(S.bag?.badge > 0) && (
            <button className="potbtn dblbtn" title="遠征隊徽章：下一場大型 BOSS 傷害 +40%、受傷 −20%"
              onClick={() => patch(q => ({ badgeArmed:(q.badgeArmed||0)+1,
                                           bag:{ ...q.bag, badge:q.bag.badge - 1 } }))}>
              <img src="/item/badge.png" alt="" />
              <span className="potn">{S.bag.badge}</span>
            </button>
          )}
          {inTower && <p className="potnote">塔內不可補血</p>}
          {busy && potUsed && <p className="potnote">本回合已用過藥水</p>}
        </div>

        <div className="side-foot">
          ID：{playerId}<br />
          {busy ? '戰鬥中，選單暫停' : '進度自動儲存'}
        </div>
      </aside>

      <div className="main">
        <header className={`topbar ${S.hp/st.hpMax<0.3?'low':''}`}>
          <span className="serif" style={{fontSize:14,letterSpacing:'.1em'}}>
            LV.{S.lv}{jobTitle && ` · ${jobTitle}`}
          </span>
          <div className="meter">
            <label>HP</label>
            <div className="track"><i className="f-hp" style={{width:`${Math.max(0,S.hp/st.hpMax*100)}%`}} /></div>
            <span className="mval">{Math.max(0,S.hp)} / {st.hpMax}</span>
          </div>
          <div className="meter">
            <label>MP</label>
            <div className="track"><i className="f-mp" style={{width:`${Math.max(0,S.mp/st.mpMax*100)}%`}} /></div>
            <span className="mval">{Math.max(0,S.mp)} / {st.mpMax}</span>
          </div>
          <div className="meter">
            <label>EXP</label>
            <div className="track thin"><i className="f-exp" style={{width:`${S.lv>=MAX_LV?100:Math.min(100,S.exp/need*100)}%`}} /></div>
            <span className="mval">{S.lv>=MAX_LV?'MAX':`${S.exp.toLocaleString()} / ${need.toLocaleString()}`}</span>
          </div>
          <span className="mval" style={{color:'var(--brass)'}}>◈ {S.gold.toLocaleString()}</span>
          {dblActive(S) && (
            <span className="charmflag dbl" title="經驗加倍券生效中">
              <img src="/item/dbl.png" alt="" />
              經驗 ×2　剩 <b>{Math.ceil(dblLeft(S)/1000)}</b> 秒
            </span>
          )}
          {S.charm > 0 && (
            <span className="charmflag" title="經驗符生效中，死亡會歸零">
              <img src="/item/exp.png" alt="" />
              經驗 +10%　剩 <b>{S.charm}</b> 隻
            </span>
          )}
          {Object.entries(BOOSTS).map(([id, b]) => boostOn(S, id) && (
            <span key={id} className="charmflag dbl" title={`${b.name}：攻擊 +${b.atk}（與其他增益疊加）`}>
              <img src={POTIONS.find(p => p.id === id)?.img} alt="" />
              ATK +{b.atk}　剩 <b>{Math.ceil(boostLeft(S, id) / 60000)}</b> 分
            </span>
          ))}
          {(S.badgeArmed || 0) > 0 && (
            <span className="charmflag" title="下一場大型 BOSS 戰自動生效">
              <img src="/item/badge.png" alt="" />
              徽章待命 <b>{S.badgeArmed}</b>
            </span>
          )}
          {megaExpActive(S) && (
            <span className="charmflag" title="經驗 ×10，直到下次升級才會消耗">
              <img src="/item/megaExp.png" alt="" />
              經驗 ×10　持續到升級
            </span>
          )}
          <span className={`sync ${sync==='error'?'bad':''}`}
            title={sync==='error' ? syncErr : ''}
            onClick={()=>sync==='error' && flush(S)}
            style={sync==='error'?{cursor:'pointer'}:undefined}>
            {sync==='saving'?'同步中…':sync==='error'?`⚠ 儲存失敗（點此重試）`:'✓ 已同步'}
          </span>
        </header>

        <div className="page">
          {foe ? <Battle S={S} patch={patch} foe={foe} exit={()=>{setFoe(null);setPotUsed(false);}}
                          potUsed={potUsed} setPotUsed={setPotUsed} />
          : inTower ? <Tower S={S} patch={patch} exit={()=>setInTower(false)}
                             potUsed={potUsed} setPotUsed={setPotUsed} />
          : scene==='danger' ? <Danger S={S} patch={patch} onFight={setFoe} exit={()=>setScene(null)} />
          : scene==='hotel'  ? <Hotel S={S} patch={patch} exit={()=>setScene(null)} />
          : scene==='lastcar' ? <LastCar S={S} patch={patch} exit={()=>setScene(null)} />
          : scene==='echo'   ? <Echo S={S} patch={patch} exit={()=>setScene(null)} />
          : scene==='hall'   ? <Hall S={S} onFight={setFoe} exit={()=>setScene(null)} />
          : <>
              {tab==='world'  && <World demo={demo} S={S} patch={patch} onFight={setFoe}
                                        onTower={()=>setInTower(true)} onScene={setScene}
                                        map={map} setMap={setMap} />}
              {tab==='quest'  && <Quest S={S} patch={patch} />}
              {tab==='quiz'   && <QuizCenter S={S} patch={patch} />}
              {tab==='items'  && <Items S={S} patch={patch} />}
              {tab==='pets'   && <Pets S={S} patch={patch} />}
              {tab==='tree'   && <Tree S={S} patch={patch} />}
              {tab==='skills' && <Skills S={S} patch={patch} />}
              {tab==='me'     && <Profile S={S} patch={patch} playerId={playerId} />}
            </>}
        </div>
      </div>
    </div>
  );
}
