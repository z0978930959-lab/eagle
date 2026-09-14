'use client';
import { useState, useEffect, useMemo } from 'react';
import { MAPS, MONSTERS } from '@/lib/data';
import { QUIZ } from '@/lib/quiz';
import { spawnList, cycleId, msToReset, stats, dmgIn, mapOf, expDecay, leftOf, dangerCycle, msToDanger } from '@/lib/engine';

const byId = id => MONSTERS.find(m => m.id === id);

export default function World({ S, patch, onFight, onTower, onScene, map, setMap , demo }) {
  const [left, setLeft] = useState(msToReset());

  useEffect(() => {
    const t = setInterval(() => setLeft(msToReset()), 1000);
    return () => clearInterval(t);
  }, []);

  const spots = useMemo(
    () => map ? spawnList(S.cycle + (S.refresh || 0), map) : [],
    [S.cycle, S.refresh, map]
  );
  const st = stats(S);
  const killed = S.killed?.[map] || {};
  const quizLeft = QUIZ.length - (S.quiz || []).length;

  // 曾國城改成跟危險境地共用同一組四小時循環狀態
  useEffect(() => {
    const c = dangerCycle();
    if (S.dangerCycle !== c) patch({ dangerCycle:c, dangerKilled:[] });
  }, [S.dangerCycle]);
  const tsengUp = map === 'foshan' && !(S.dangerKilled || []).includes('tseng');

  if (!map) {
    return (
      <>
        <p className="h2">{demo ? '密室逃脫' : '主世界 · 冒險'}</p>
        <div className="maps">
          {MAPS.filter(m => !demo || m.escape).map(m => {
            const lock = m.reqLv && S.lv < m.reqLv;
            return (
              <button
                key={m.id}
                className={`mapcard ${lock ? 'lock' : 'open'}`}
                onClick={() => { if(lock) return; if(m.tower) onTower(); else if(m.danger) onScene('danger'); else if(m.hall) onScene('hall'); else if(m.hotel) onScene('hotel'); else if(m.lastcar) onScene('lastcar'); else if(m.echo) onScene('echo'); else setMap(m.id); }}
                disabled={lock}
              >
                <div className="thumb">
                  {m.img ? <img src={m.img} alt="" /> : <span className="muted">未開放</span>}
                </div>
                <div className="meta">
                  <b>{m.name}</b>
                  <p>{m.lvRange}{lock && `　需 LV.${m.reqLv}`}</p>
                  {m.desc && <p className="mapdesc">{m.desc}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  const M = mapOf(map);
  const mm = Math.floor(left / 60000), ss = Math.floor(left % 60000 / 1000);
  const allDead = spots.length > 0 && spots.every(sp => leftOf(S, map, sp.id, sp.total) <= 0);


  return (
    <>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14, flexWrap:'wrap' }}>
        <button className="btn" onClick={() => setMap(null)}>← 返回</button>
        <span className="serif" style={{ fontSize:17, letterSpacing:'.14em' }}>{M.name}</span>
        <span className="mono" style={{ fontSize:12, color:'var(--dim)' }}>{M.lvRange}</span>
        {M.mods && (
          <span className="riskflag">
            ATK ×{M.mods.atk}　EXP ×{M.mods.exp}　金幣 ×{M.mods.gold}
          </span>
        )}
        <span className="mono" style={{ fontSize:12, color:'var(--brass)', marginLeft:'auto' }}>
          下次重置 {String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}
        </span>
        <span className="mono" style={{ fontSize:11, color:'var(--dim)' }}>
          想提前刷新？到「題庫」分頁答題
        </span>
      </div>

      <div className="field">
        {M.img && <img className="bg" src={M.img} alt="" />}
        {spots.map(sp => {
          const m = byId(sp.id);
          const left = leftOf(S, map, sp.id, sp.total);
          const dead = left <= 0;
          const atk = Math.round(m.atk * (M.mods?.atk || 1));
          const turns = Math.max(1, Math.ceil(m.hp / Math.max(1, st.atk)));
          const risk = dmgIn(atk, st.def) * (turns - 1);
          const lethal = risk >= S.hp;
          const dec = expDecay(S.lv, m.lv);
          return (
            <button
              key={sp.key}
              className={`spot ${m.kind === 'boss' ? 'boss' : ''} ${m.kind === 'elite' ? 'elite' : ''} ${dead ? 'dead' : ''}`}
              style={{ left:`${sp.x}%`, top:`${sp.y}%` }}
              onClick={() => !dead && onFight({ key:sp.key, id:sp.id, map })}
              title={`${m.name}　LV.${m.lv}　剩 ${left} 隻`}
            >
              <div className="face" style={lethal && !dead ? { borderColor:'var(--vermilion)' } : undefined}>
                <img src={m.img} alt="" />
                {!dead && sp.total > 1 && <span className="cnt">×{left}</span>}
              </div>
              <small>{m.name.replace('（虛弱）','').replace('（初階）','')}</small>
              <small style={lethal ? { color:'var(--vermilion)' } : undefined}>
                {dead ? '已清空' : lethal ? `LV.${m.lv} 危險` : `LV.${m.lv}`}
                {!dead && dec < 1 && `　EXP ${Math.round(dec*100)}%`}
              </small>
            </button>
          );
        })}
        {map === 'foshan' && (() => {
          const tm = byId('tseng');
          return (
            <button
              key="tseng"
              className={`spot ${!tsengUp ? 'dead' : ''}`}
              style={{ left:`${tm.pos[0]}%`, top:`${tm.pos[1]}%` }}
              onClick={() => tsengUp && onFight({ key:'tseng', id:'tseng', map })}
              title={tsengUp ? `${tm.name}　LV.${tm.lv}　每四小時限一次` : `${tm.name}　本輪已擊敗，等待四小時重置`}
            >
              <div className="face">
                <img src={tm.img} alt="" />
              </div>
              <small>{tm.name}</small>
              <small>{tsengUp ? '四小時限定' : '已擊敗'}</small>
            </button>
          );
        })()}
      </div>

      <p className="muted" style={{ marginTop:10 }}>
        {allDead
          ? '這一輪的怪物都清光了。等待重置，或用「提前刷新」答題。'
          : '紅框代表以你目前的血量可能會死。點擊頭像開始戰鬥。'}
      </p>
    </>
  );
}
