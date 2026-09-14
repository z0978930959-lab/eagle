'use client';
import { useState, useEffect, useRef } from 'react';
import { QUESTS } from '@/lib/quests';
import { MONSTERS, MAPS, GEAR, QUALITY } from '@/lib/data';
import { questState, rollScroll, makeInst, expToNext, maxHp, maxMp, MAX_LV, dayId, gearOf } from '@/lib/engine';
import { makePet, rollColor, exchangeBaby, PETS, petLabel } from '@/lib/nowhere';

const monName = id => MONSTERS.find(m => m.id === id)?.name || id;
const monImg  = id => MONSTERS.find(m => m.id === id)?.img;
const mapName = id => MAPS.find(m => m.id === id)?.name || id;
const LABEL = { locked:'等級不足', open:'可接取', active:'進行中', ready:'可回報', done:'已完成' };

function Dialog({ quest, mode, onAccept, onClose, onBranch, gold }) {
  const lines = mode === 'done' ? [quest.done] : quest.lines;
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState('');
  const [branch, setBranch] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setShown(''); let i = 0; const full = lines[idx];
    timer.current = setInterval(() => {
      i++; setShown(full.slice(0, i));
      if (i >= full.length) clearInterval(timer.current);
    }, 42);
    return () => clearInterval(timer.current);
  }, [idx, quest.id, mode]);

  const typing = shown.length < lines[idx].length;
  const last = idx >= lines.length - 1;

  function next() {
    if (typing) { clearInterval(timer.current); setShown(lines[idx]); return; }
    if (!last) { setIdx(i => i + 1); return; }
    if (mode === 'done') { onClose(); return; }
    if (quest.branch) { setBranch(true); return; }
    onAccept();
  }

  return (
    <div className="talk" onClick={branch ? undefined : next}>
      <div className="talk-goal">
        <b>{quest.title}</b>
        <span>{quest.goals.map(g => `${monName(g.id)} ×${g.n}`).join('　')}</span>
      </div>
      <div className="talk-body">
        <div className="talk-npc">
          {quest.img
            ? <img src={quest.img} alt="" onError={e=>{e.target.style.display='none';}} />
            : <span className="serif">{quest.npc[0]}</span>}
          <p>{quest.npc}</p>
        </div>
        <div className="talk-bubble">
          <p>{shown}<span className="caret" /></p>
          {!branch && (
            <span className="talk-hint">
              {typing ? '點擊跳過' : last ? (mode==='done'?'點擊領取獎勵':'點擊繼續') : '點擊繼續'}
            </span>
          )}
        </div>
      </div>
      {branch && (
        <div className="row" style={{ marginTop:14 }}>
          <button className="btn key" disabled={gold < quest.branch.pay.cost}
            onClick={() => onBranch('pay')}>
            {quest.branch.pay.label}（{quest.branch.pay.cost.toLocaleString()} 金）
          </button>
          <button className="btn" onClick={() => onBranch('fight')}>{quest.branch.fight.label}</button>
        </div>
      )}
    </div>
  );
}

export default function Quest({ S, patch }) {
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');

  function accept(q) {
    patch(p => ({ quests:{ ...p.quests, [q.id]:{ prog:{}, done:false } } }));
    setOpen(null); setMsg(`已接受「${q.title}」。`);
  }

  function branch(q, kind) {
    if (kind === 'pay') {
      const b = q.branch.pay;
      patch(p => ({
        gold: p.gold - b.cost,
        bagGear: [...(p.bagGear||[]), makeInst(b.gear, 'blue', 2)],
        quests: { ...p.quests, [q.id]:{ prog:{}, done:true, paid:true, doneDay:dayId() } },
      }));
      setOpen(null);
      setMsg(`匯出 ${b.cost.toLocaleString()} 金幣，取得史塔克集團。`);
    } else {
      accept(q);
    }
  }

  const [choosing, setChoosing] = useState(null);

  function claim(q) {
    if (q.reward.gearChoice) { setOpen(null); setChoosing(q); return; }
    if (q.exchange) { exchange(q); return; }
    finalize(q, null);
  }

  // 英雄爸媽：繳交 T1/T2/T3 各一隻，換一隻寶貝英雄。沒有經驗也沒有金幣。
  function exchange(q) {
    const have = S.pets || [];
    const pick = [];
    for (const pid of q.exchange) {
      const one = have.find(p => p.pid === pid && !pick.includes(p));
      if (!one) { setMsg(`還缺「${PETS[pid].name}」。三隻都要帶來。`); setOpen(null); return; }
      pick.push(one);
    }
    const { inst, nextPity, forced } = exchangeBaby(S);
    patch(p => ({
      pets: [...(p.pets || []).filter(x => !pick.includes(x)), inst],
      petPity: nextPity,
      quests: { ...p.quests, [q.id]: { ...p.quests[q.id], done:true, doneDay:dayId() } },
    }));
    setOpen(null);
    setMsg(`${q.done}\n\n獲得　${petLabel(inst)}${forced ? '（保底）' : ''}`);
  }

  function finalize(q, gid) {
    const n = q.reward.scroll || 0;
    const drops = Array.from({ length:n }, () => rollScroll(q.reqLv >= 25 ? 2 : 1));
    patch(p => {
      let lv=p.lv, exp=p.exp+q.reward.exp, gained=0;
      while (lv<MAX_LV && exp>=expToNext(lv)) { exp-=expToNext(lv); lv++; gained++; }
      const sc={...p.scrolls}; for(const d of drops) sc[d.id]=(sc[d.id]||0)+1;
      const out = { lv, exp, gold:p.gold+q.reward.gold, scrolls:sc,
                    quests:{...p.quests,[q.id]:{...p.quests[q.id],done:true,doneDay:dayId()}} };
      if (gid) out.bagGear = [...(p.bagGear||[]), makeInst(gid, 'white', 0)];
      if (q.reward.pet) out.pets = [...(p.pets||[]), makePet(q.reward.pet, rollColor())];
      if (gained) { out.hp=maxHp(lv); out.mp=maxMp(lv); }
      return out;
    });
    setOpen(null); setChoosing(null);
    const gname = gid ? gearOf(gid)?.name : null;
    setMsg(`任務完成！獲得 ${q.reward.exp.toLocaleString()} EXP、${q.reward.gold.toLocaleString()} 金幣` +
           `${n?`、卷軸 ×${n}`:''}${gname?`、${gname}`:''}。`);
  }

  if (choosing) {
    const q = choosing;
    return (
      <div className="card">
        <p className="h2">{q.title}　·　選一件裝備</p>
        <p className="muted" style={{marginBottom:16}}>四選一，選定後無法更改。品質固定為白字，不會再抽卷軸強化的空間更小，但基礎數值比同等級塔裝備略高。</p>
        <div className="grid2">
          {q.reward.gearChoice.map(gid => {
            const g = gearOf(gid);
            const w = QUALITY.find(x=>x.id==='white');
            return (
              <button key={gid} className="card" style={{textAlign:'left',cursor:'pointer'}}
                onClick={()=>finalize(q, gid)}>
                {g.img && <img className="icon" src={g.img} alt="" style={{width:48,height:48}} />}
                <p className="serif" style={{fontSize:15,marginTop:8}}>{g.name}</p>
                <p className="muted" style={{fontSize:11.5}}>
                  {g.slot==='weapon'?'武器':g.slot==='top'?'上衣':g.slot==='helm'?'頭盔':'飾品'}　·　需求 LV.{g.reqLv}
                </p>
                <p style={{fontSize:12,marginTop:6}}>
                  ATK +{g.atk}　DEF +{g.def}{g.pierce?`　穿透 +${g.pierce}`:''}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (open) return (
    <Dialog quest={open.quest} mode={open.mode} gold={S.gold}
      onAccept={()=>accept(open.quest)}
      onBranch={k=>branch(open.quest,k)}
      onClose={()=>claim(open.quest)} />
  );

  const hidden = S.hideQuests || [];
  const toggleHide = id => patch(p => ({
    hideQuests: (p.hideQuests||[]).includes(id)
      ? (p.hideQuests||[]).filter(x=>x!==id)
      : [...(p.hideQuests||[]), id],
  }));
  const byMap = {};
  for (const q of QUESTS) (byMap[q.map] ||= []).push(q);
  for (const k in byMap) byMap[k].sort((a,b)=>a.reqLv-b.reqLv);

  return (
    <>
      <div className="card">
        <p className="h2">任務</p>
        <p className="muted">
          完成後回到這裡回報領獎。任務依需求等級排序，可個別隱藏（隱藏狀態會保存）。已完成的任務於每日 00:00 重置可再接一次
          （鋼鐵人的委託除外，那是一次性的）。
        </p>
      </div>

      {Object.entries(byMap).map(([mid, list]) => (
        <div key={mid}>
          <p className="h2" style={{ marginTop:20 }}>{mapName(mid)}</p>
          {list.map(q => {
            const stt = questState(S, q);
            const rec = S.quests?.[q.id];
            if (hidden.includes(q.id)) return (
              <div className="questmini" key={q.id}>
                <span>LV.{q.reqLv}　{q.title}　·　{q.npc}</span>
                <button className="btn tiny" onClick={()=>toggleHide(q.id)}>顯示</button>
              </div>
            );
            return (
              <div className="card questcard" key={q.id}>
                <div className="q-head">
                  <div className="q-npc">
                    {q.img ? <img src={q.img} alt="" onError={e=>{e.target.style.display='none';}} />
                           : <span className="serif">{q.npc[0]}</span>}
                  </div>
                  <div className="grow">
                    <b>{q.title}</b>
                    <p className="muted">{q.npc}　·　需求 LV.{q.reqLv}</p>
                  </div>
                  <span className={`qtag t-${stt}`}>{LABEL[stt]}</span>
                  <button className="btn tiny" onClick={()=>toggleHide(q.id)}>隱藏</button>
                </div>
                <div className="q-goals">
                  {q.goals.map(g => {
                    const cur = Math.min(g.n, rec?.prog?.[g.id] || 0);
                    return (
                      <div className="q-goal" key={g.id}>
                        {monImg(g.id) && <img src={monImg(g.id)} alt="" />}
                        <span>{monName(g.id)}</span>
                        <b style={{ color: cur>=g.n ? 'var(--brass)' : undefined }}>
                          {rec ? `${cur} / ${g.n}` : `× ${g.n}`}
                        </b>
                      </div>
                    );
                  })}
                </div>
                <div className="q-foot">
                  <span className="muted">
                    獎勵　{q.reward.exp.toLocaleString()} EXP　·　{q.reward.gold.toLocaleString()} 金幣
                    {q.reward.scroll ? `　·　卷軸 ×${q.reward.scroll}` : ''}
                    {q.reward.gearChoice ? `　·　裝備任選一` : ''}
                    {q.reward.pet ? `　·　${PETS[q.reward.pet].name}` : ''}
                    {q.exchange ? `　·　以三隻英雄兌換寶貝英雄（無經驗金幣）` : ''}
                    {q.branch ? '　·　可選擇匯款結局' : ''}
                  </span>
                  {stt==='open'   && <button className="btn key" onClick={()=>setOpen({quest:q,mode:'take'})}>接取</button>}
                  {stt==='ready'  && <button className="btn key" onClick={()=>setOpen({quest:q,mode:'done'})}>回報</button>}
                  {stt==='active' && <button className="btn" disabled>進行中</button>}
                  {stt==='done'   && <button className="btn" disabled>已完成</button>}
                  {stt==='locked' && <button className="btn" disabled>LV.{q.reqLv}</button>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {msg && <p className="muted" style={{ marginTop:12, color:'var(--brass)' }}>{msg}</p>}
    </>
  );
}
