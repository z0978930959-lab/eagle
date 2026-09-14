'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { MONSTERS, POTIONS, SKILLS, QUALITY, GEAR, FOOD_DROP, GOD_SCROLLS } from '@/lib/data';
import { ADV_JOBS } from '@/lib/advance';
import { MOB_SKILLS, MECHANICS, RPS, MOB_QUIZ } from '@/lib/mobskills';
import {
  MULT, LABEL, MULT_CAP, DEATH_PENALTY, zones, judge, period, needlePos, stats,
  dmgOut, dmgIn, goldGain, expGain, potionHeal, expToNext, maxHp, maxMp, MAX_LV,
  gapMiss, rollScroll, rollPotion, rollCharm, rollQuality, rollQualityByKind, gearForLevel,
  dropKind, isElevated, MAP_DROP_RATE, MAP_SCROLL_RATE, megaExpActive,
  CENTER_BLOCK_RATE, makeInst, bumpQuests, perksOf, mapOf, gearOf,
  dblActive, DANGER_CYCLE_MS, talents, expDecay, rollShard, BADGE, boostAtk, TOWERS, fleeRate,
} from '@/lib/engine';
import { petEffect } from '@/lib/nowhere';

const COLOR = { center:'#c8a24a', best:'#c8a24a', good:'#8f9e62', normal:'#8f8a7d', miss:'#b5372f' };

export default function Battle({
  S, patch, foe, exit, potUsed, setPotUsed,
  towerFoe = null, towerBuffs = {}, towerFloor = 0, towerId = null, onWin, onLose,
}) {
  const isTower = !!towerFoe;
  const M = isTower ? towerFoe : MONSTERS.find(m => m.id === foe.id);
  const MP0 = isTower ? null : mapOf(foe.map);
  const mods = MP0?.mods || { atk:1, exp:1, gold:1 };
  const B = towerBuffs;
  const T = isTower ? TOWERS[towerId] : null;
  const st0 = stats(S, B);
  // 這幾座塔明確不吃心跳停止糖／章魚燒這類道具加成，戰鬥內直接扣掉
  const st = (T?.noItemBoost) ? { ...st0, atk: st0.atk - boostAtk(S) } : st0;
  const PK = perksOf(S);
  const TL = talents(S.tree);

  const foeAtkBase = Math.round(M.atk * (mods.atk || 1));
  const foeHpMax = M.hp;

  const [hp, setHp] = useState(foeHpMax);
  const [log, setLog] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(null);
  const [fx, setFx] = useState(null);
  const [menu, setMenu] = useState('main');
  const [gasped, setGaspedState] = useState(false);
  const [result, setResult] = useState(null);
  const [hitFx, setHitFx] = useState(null);
  const [ouch, setOuch] = useState(0);
  const [inch, setInch] = useState(0);
  const [cd, setCd] = useState({});
  const [chain, setChain] = useState(0);
  const [multi, setMulti] = useState(null);
  const [turn, setTurn] = useState(0);
  const [charge, setCharge] = useState(0);
  const [skillUsedThisTurn, setSkillUsed] = useState(0);
  const burnRef = useRef([]);        // 燃燒層 [{turns,pct}]
  const defDownRef = useRef(0);      // 怪物減防
  const atkDownRef = useRef(0);      // 怪物減攻
  const immuneRef = useRef(0);       // 免疫回合數
  const ipoRef = useRef({ turns:0, pct:0 });   // 上市敲鐘：全體數值提升
  const goldUpRef = useRef(0);       // 併購案：本場金幣加成
  const badgeRef = useRef(false);    // 遠征隊徽章是否在本場生效
  const takenRef = useRef(0);        // 累計受到的傷害
  const coldRef = useRef(false);     // 冷血：上次 MISS
  const pierceBonusRef = useRef(0);  // 猜拳獲勝：暫時無視防禦
  const winDmgRef = useRef(0);       // 檢定視窗內累計傷害
  const winJudgeRef = useRef(false); // 檢定視窗內是否打出最佳以上
  const [check, setCheck] = useState(null);   // 檢定結果提示
  const [inter, setInter] = useState(null);   // 進行中的互動檢定
  const shieldRef = useRef(false);   // BOSS 護盾
  const poisonRef = useRef(0);       // 中毒回合
  const silenceRef = useRef(false);  // 沉默（無法用技能）

  const gaspRef = useRef(false), blockRef = useRef(false);
  const frozenRef = useRef(0), stunRef = useRef(false);   // frozenRef：剩餘凍結回合數（不是開關）
  const suedRef = useRef(false), savedRef = useRef(false), revivedRef = useRef(false);
  const barRef = useRef(null), needleRef = useRef(null);
  const t0 = useRef(0), raf = useRef(null), runRef = useRef(false);
  const posRef = useRef(50), multiScale = useRef(1), atkCount = useRef(0);

  const setGasped = v => { gaspRef.current = v; setGaspedState(v); };
  const foeAtk = Math.round(foeAtkBase * (suedRef.current ? 0.7 : 1));

  // 怪物「當前」防禦：腐蝕之霧的減防、猜拳獲勝的無視防禦都在這裡結算
  const foeDefNow = () => {
    if (pierceBonusRef.current > 0) return 0;
    return Math.max(0, Math.round((M.def || 0) * (1 - (defDownRef.current || 0))));
  };

  const P = period(S.tree, (B.period || 0) + (turn < 3 ? TL.fastStart : 0));
  const GAP = isTower ? 0 : gapMiss(S.lv, M.lv);
  const Z = zones(S.tree, {
    gasped, forceMiss:GAP,
    centerUp:(PK.centerUp?1:0) + (B.centerUp||0),
    goodUp:B.goodUp||0, bestUp:B.bestUp||0, noMiss:!!B.noMiss,
  });
  const insight = S.tree.c2 || 0;
  const push = (t,c) => setLog(L => [{t,c,k:Math.random()}, ...L].slice(0,40));

  const loop = useCallback(now => {
    if (!runRef.current) return;
    const w = barRef.current?.offsetWidth || 0;
    const p = needlePos(now - t0.current, P);
    posRef.current = p;
    if (needleRef.current) needleRef.current.style.transform = `translateX(${p/100*w}px)`;
    raf.current = requestAnimationFrame(loop);
  }, [P]);
  const start = useCallback(() => {
    runRef.current = true; setRunning(true);
    t0.current = performance.now(); raf.current = requestAnimationFrame(loop);
  }, [loop]);
  const halt = useCallback(() => {
    runRef.current = false; setRunning(false);
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  useEffect(() => {
    gaspRef.current=false; blockRef.current=false; frozenRef.current=0;
    stunRef.current=false; suedRef.current=false; savedRef.current=false;
    push(isTower ? `── 第 ${towerFloor} 層　${M.name} ──` : `── ${M.name} 擋住了去路 ──`, 'hi');
    // 遠征隊徽章：只在大型 BOSS 戰觸發，進場時消耗一枚
    if (!isTower && M.big && (S.badgeArmed || 0) > 0) {
      badgeRef.current = true;
      patch(p => ({ badgeArmed: Math.max(0, (p.badgeArmed || 0) - 1) }));
      push(`遠征隊徽章生效：你的傷害 +${Math.round(BADGE.dmgUp*100)}%，${M.name} 的傷害 −${Math.round(BADGE.takenDown*100)}%。`, 'gold');
    }
    if (TL.startHeal) {
      const h = Math.round(st.hpMax * TL.startHeal);
      patch(p => ({ hp: Math.min(st.hpMax, p.hp + h) }));
      push(`續戰：回復 ${h} HP。`, 'gold');
    }
    const t = setTimeout(start, 480);
    return () => { clearTimeout(t); runRef.current=false; if(raf.current)cancelAnimationFrame(raf.current); };
  }, []);

  useEffect(() => { if(!fx) return; const t=setTimeout(()=>setFx(null),1100); return ()=>clearTimeout(t); }, [fx]);

  // 問答倒數，逾時視同答錯
  useEffect(() => {
    if (!inter || inter.type !== 'quiz' || inter.done) return;
    if (inter.left <= 0) { resolveInter(-1); return; }
    const t = setTimeout(() => setInter(v => v && !v.done ? { ...v, left:v.left - 1 } : v), 1000);
    return () => clearTimeout(t);
  }, [inter]);

  const strike = (type='slash') => { setHitFx({type,k:Math.random()}); setTimeout(()=>setHitFx(null),620); };
  const show = (kind,dmg) => setVerdict({kind,dmg,k:Math.random()});

  function dealDamage(raw) {
    // 護盾要在扣血「之前」判定，否則血照樣會掉
    if (shieldRef.current) {
      shieldRef.current = false;
      push(`${M.name} 的護盾吸收了這一擊。`, 'bad');
      return hp;
    }
    let d = raw;
    winDmgRef.current += raw;
    if (B.pierce) d = Math.round(d * (1 + B.pierce * 0.3));
    const nhp = hp - d;
    setHp(nhp);
    if (M.skill === 'reflect') {
      const rf = Math.round(raw * 0.20);
      patch(p => ({ hp: Math.max(1, p.hp - rf) }));
      push(`反傷！你受到 ${rf} 傷害。`, 'bad');
    }
    const ls = (B.lifesteal || 0) + TL.lifesteal;
    if (ls) patch(p => ({ hp: Math.min(st.hpMax, p.hp + Math.round(d * ls)) }));
    return nhp;
  }

  function swing(scale = 1, onDone) {
    if (!runRef.current) return;
    const pos = posRef.current;
    halt();
    atkCount.current++;
    let kind = judge(pos, Z);
    if (B.metronome && atkCount.current % B.metronome === 0) kind = 'center';
    if (chain >= 2 && kind !== 'center') { kind='best'; push('連擊發動，必定最佳！','gold'); }

    // 寸勁的加成疊在倍率上限「之外」，所以中心判定也吃得到
    let mult = kind==='miss' ? 0 : Math.min(MULT_CAP, MULT[kind]) + inch;
    if (kind==='center' && PK.critUp) mult *= 1.15;
    if (charge) mult *= (1 + charge);
    let atkMul = 1;
    if (M.kind === 'boss' || M.boss) atkMul += TL.bossDmg;
    if (kind === 'center') atkMul += TL.critDmg;
    if (atkCount.current === 1) atkMul += TL.firstHit;
    if (coldRef.current) { atkMul += TL.coldBlood; coldRef.current = false; }
    if (badgeRef.current) atkMul += BADGE.dmgUp;
    if (ipoRef.current.turns > 0) atkMul += ipoRef.current.pct;
    if (TL.execute && hp / foeHpMax < 0.20) atkMul *= 2;
    const PE = petEffect(S, M.kind==='boss' || !!M.boss);
    let dmg = dmgOut(st.atk * scale * atkMul * (1 + (PE?.dmg || 0)), mult, foeDefNow(), st.pierce + (B.pierce||0));
    if (B.storm && kind!=='miss' && Math.random() < B.storm) {
      dmg = Math.round(dmg * (B.gemini && kind==='center' ? 2.5 : 2));
      push('暴風觸發，傷害翻倍！','gold');
    } else if (B.gemini && kind==='center') {
      dmg = Math.round(dmg * 2); push('雙生觸發，攻擊執行兩遍！','gold');
    }
    if (B.mirror && kind==='best') { dmg = Math.round(dmg * 1.5); push('鏡像追擊！','gold'); }

    if (kind==='best'||kind==='center') winJudgeRef.current = true;
    setChain(c => (kind==='best'||kind==='center') ? (c>=2?0:c+1) : 0);
    setCharge(kind==='miss' ? Math.min(1.5,(B.chargeUp||0)*((charge/(B.chargeUp||1))+1)) : 0);
    // 揮空不消耗寸勁，蓄的力留到下一擊
    if (inch && kind !== 'miss') setInch(0);
    setGasped(false);
    patch(p => ({ stat:{...p.stat,[kind]:(p.stat[kind]||0)+1}, bestHit:Math.max(p.bestHit||0,dmg) }));
    if ((kind==='best'||kind==='center') && S.tree.c1) patch(p=>({exp:p.exp+S.tree.c1}));
    if (kind==='miss') {
      if (PK.mpRegen) patch(p=>({mp:Math.min(st.mpMax,p.mp+5*PK.mpRegen)}));
      if (B.missHeal) patch(p=>({hp:Math.min(st.hpMax,p.hp+Math.round(st.hpMax*B.missHeal))}));
    }

    const blocked = kind !== 'miss' && dmg <= 0;
    show(blocked ? 'miss' : kind, dmg);
    if (kind!=='miss' && !blocked) strike(kind==='center'?'crit':'slash');
    push(kind==='miss' ? '你揮空了。'
         : blocked ? `${LABEL[kind]}判定，但攻擊力不足以破防！`
         : `${LABEL[kind]}判定，造成 ${dmg} 傷害。`,
         (kind==='miss'||blocked) ? 'bad' : (kind==='center'||kind==='best'?'gold':null));
    // 連段技能的中心不觸發阻擋；一般中心有 60% 機率讓怪物落空
    if (kind==='center' && multi == null) {
      if (M.skill === 'steady') {
        push(`${M.name} 不動如山，中心命中無法阻止牠。`, 'bad');
      } else if (Math.random() < CENTER_BLOCK_RATE) {
        blockRef.current = true;
        push('中心命中！下一次攻擊將被擋下。', 'gold');
      } else {
        push('中心命中，但牠站穩了。', 'bad');
      }
    }

    const nhp = dealDamage(dmg);
    if (nhp<=0) { setTimeout(win,440); return; }
    if (onDone) { onDone(); return; }
    setTimeout(foeTurn,600);
  }

  useEffect(() => {
    if (multi==null) return;
    if (multi<=0) { setMulti(null); setTimeout(foeTurn,480); return; }
    const t=setTimeout(start,250); return ()=>clearTimeout(t);
  }, [multi]);

  const multiSwing = s => swing(s, ()=>setMulti(m=>m-1));
  function doSwing() {
    if (!runRef.current) return;
    multi!=null ? multiSwing(multiScale.current) : swing();
  }

  function foeTurn() {
    setTurn(t=>t+1);
    setSkillUsed(0);
    // 戒指「生機」詞條：每回合開始回復 3% 最大 HP
    if (PK.vitality && S.hp > 0 && S.hp < st.hpMax) {
      const heal = Math.round(st.hpMax * 0.03 * PK.vitality);
      patch(p => ({ hp: Math.min(st.hpMax, p.hp + heal) }));
      push(`戒指的生機發動，回復 ${heal} HP。`, 'gold');
    }
    // 中毒結算
    if (poisonRef.current > 0) {
      poisonRef.current--;
      const pd = Math.max(1, Math.round(st.hpMax * 0.05));
      patch(p => ({ hp: Math.max(0, p.hp - pd) }));
      push(`劇毒發作，損失 ${pd} HP。`, 'bad');
      if (S.hp - pd <= 0) { setTimeout(lose, 500); return; }
    }
    // 燃燒結算
    if (burnRef.current.length) {
      let bd = 0;
      burnRef.current = burnRef.current.filter(b => {
        bd += Math.ceil(st.atk * b.pct); b.turns--; return b.turns > 0;
      });
      if (bd > 0) { push(`燃燒造成 ${bd} 傷害。`,'gold');
        const nh = hp - bd; setHp(nh);
        if (nh <= 0) { setTimeout(win,440); return; } }
    }
    // ── 回合檢定（無視免疫）──
    const MC = M.mechanic;
    if (MC && (turn + 1) % MC.every === 0) {
      if (MC.type === 'rps') {
        const foePick = RPS[Math.floor(Math.random() * 3)];
        setInter({ type:'rps', foe:foePick, mc:MC, k:Math.random() });
        return;                          // 等玩家出拳，流程在 resolveInter 續接
      }
      if (MC.type === 'quiz') {
        const q = MOB_QUIZ[Math.floor(Math.random() * MOB_QUIZ.length)];
        setInter({ type:'quiz', q, mc:MC, left:8, k:Math.random() });
        return;
      }
      const pass = MC.type === 'dmgCheck'
        ? winDmgRef.current >= Math.round(foeHpMax * MC.pct * MC.every)
        : winJudgeRef.current;
      const needTxt = MC.type === 'dmgCheck'
        ? `${Math.round(foeHpMax * MC.pct * MC.every).toLocaleString()} 傷害`
        : '最佳以上判定';
      finishCheck(pass, needTxt, MC);
      if (!pass && S.hp - Math.round(S.hp * MC.punishPct) <= 0) return;
    }

    continueFoeTurn();
  }

  function continueFoeTurn() {
    // 沉默在怪物行動「之前」解除，這樣本回合新施加的沉默才會留到玩家下一回合
    silenceRef.current = false;
    if (ipoRef.current.turns > 0) {
      ipoRef.current.turns--;
      if (ipoRef.current.turns === 0) push('上市敲鐘的效果結束了。');
    }
    if (immuneRef.current > 0) {
      immuneRef.current--;
      push(`${M.name} 的攻擊被法院擋下。`,'gold');
      setPotUsed?.(false); setTimeout(start,380); return;
    }
    if (B.freeze && (turn+1) % B.freeze === 0) {
      push(`${M.name} 被冰結，無法行動。`,'gold');
      setPotUsed?.(false); setTimeout(start,380); return;
    }
    if (frozenRef.current > 0) {
      frozenRef.current -= 1;
      push(`${M.name} 被冰封，無法行動。${frozenRef.current>0?`（還剩 ${frozenRef.current} 回合）`:''}`,'gold');
      setPotUsed?.(false); setTimeout(start,380); return;
    }
    if (blockRef.current) {
      blockRef.current=false; push(`${M.name} 的攻勢被擋下。`,'gold');
      setPotUsed?.(false); setTimeout(start,380); return;
    }
    let hits=1;
    if (M.skill==='sneak' && Math.random()<0.35) {
      hits=2; setFx({img:'/mon/fx_sneak.png',label:'偷　襲'}); push(`${M.name} 發動偷襲，攻擊兩次！`,'bad');
    }
    if (M.skill==='gasp' && Math.random()<0.5) {
      setGasped(true); setFx({img:'/mon/fx_gasp.png',label:'沒氣了'}); push(`${M.name} 喘了口氣，你的最佳區被打亂！`,'bad');
    }
    if (M.skill==='snap' && Math.random()<0.3) { hits=2; push(`${M.name} 打了個響指。`,'bad'); }
    if (M.skill==='curse' && Math.random()<0.4) { setGasped(true); push(`${M.name} 降下詛咒！`,'bad'); }
    if (M.skill==='rage' && hp/foeHpMax < 0.5) { hits = 2; push(`${M.name} 陷入狂暴，攻勢加倍！`,'bad'); }
    if (M.skill==='drain') { const heal=Math.round(foeHpMax*0.03); setHp(h=>Math.min(foeHpMax,h+heal));
      push(`${M.name} 吸取生命，回復 ${heal} HP。`,'bad'); }
    if (M.skill==='shield' && (turn+1)%3===0) { shieldRef.current = true; push(`${M.name} 展開護盾，下一擊將被吸收。`,'bad'); }
    if (M.skill==='poison') { poisonRef.current = 3; push(`${M.name} 施放劇毒，接下來 3 回合持續受傷。`,'bad'); }
    if (M.skill==='quake' && Math.random()<0.35) { silenceRef.current = true; push(`${M.name} 震盪大地，你下回合無法使用技能。`,'bad'); }
    if (M.skill==='reflect') push(`${M.name} 架起反擊姿態。`,'bad');

    const lowHp = TL.lastStand && S.hp / st.hpMax < 0.30;
    let defNow = lowHp ? Math.round(st.def * 1.5) : st.def;
    if (ipoRef.current.turns > 0) defNow = Math.round(defNow * (1 + ipoRef.current.pct));
    const inAtk = Math.round(foeAtk * (1 - atkDownRef.current) * (badgeRef.current ? 1 - BADGE.takenDown : 1));
    let dmg = dmgIn(inAtk, defNow, (B.taken||0) + TL.taken) * hits;
    if (PK.guard) dmg = Math.max(1, Math.round(dmg*(1-0.20*PK.guard)));
    let nhp = S.hp - dmg;

    if (nhp<=0 && B.revive && !revivedRef.current) {
      revivedRef.current=true; nhp=Math.round(st.hpMax*0.3);
      push('不死鳥展翅！你以 30% 血量復活。','gold');
    } else if (nhp<=0 && S.tree.c5 && !savedRef.current) {
      savedRef.current=true;
      if (Math.random() < 0.7 + TL.tenacity) { nhp=1; push('不屈發動！你在倒下前站穩了。','gold'); }
    }
    takenRef.current += dmg;
    patch({hp:nhp}); setOuch(Date.now());
    push(`${M.name} 攻擊，你損失 ${dmg} HP。`,'bad');
    setPotUsed?.(false);
    if (pierceBonusRef.current > 0) pierceBonusRef.current--;
    setCd(c=>{const n={};for(const k in c)if(c[k]>1)n[k]=c[k]-1;return n;});
    if (nhp<=0) { setTimeout(lose,480); return; }
    if (stunRef.current) {
      stunRef.current=false; push('你仍在隕石的餘勁中，無法行動。','bad');
      setTimeout(()=>{ if(!over) foeTurn(); },880); return;
    }
    setTimeout(start,400);
  }

  // ── 結算 ──
  function finishCheck(pass, needTxt, MC) {
    if (pass) {
      push(`${MC.warn}　你頂住了。`, 'gold');
      setCheck({ ok:true, need:needTxt, k:Math.random() });
    } else {
      const pen = Math.max(1, Math.round(S.hp * MC.punishPct));
      patch(p => ({ hp: Math.max(0, p.hp - pen) }));
      push(`${MC.warn}　檢定失敗！損失 ${pen.toLocaleString()} HP。`, 'bad');
      setCheck({ ok:false, need:needTxt, k:Math.random() });
      setOuch(Date.now());
      if (S.hp - pen <= 0) { setTimeout(lose, 700); return false; }
    }
    winDmgRef.current = 0; winJudgeRef.current = false;
    setTimeout(() => setCheck(null), 2200);
    return true;
  }

  // 互動檢定：玩家做出選擇後，停留兩秒再續接怪物回合
  function resolveInter(playerPick) {
    if (!inter || inter.done) return;
    const MC = inter.mc;
    let pass = false, needTxt = '';

    if (inter.type === 'rps') {
      const me = RPS.find(r => r.id === playerPick);
      const foe = inter.foe;
      const draw = me && me.id === foe.id;
      const win  = me && me.beats === foe.id;
      needTxt = `你出${me ? me.name : '—'}，牠出${foe.name}`;
      pass = draw || win;                    // 平手就平手，不重來也不受罰
      setInter(v => ({ ...v, done:true, mine:playerPick, result: draw ? 'draw' : win ? 'win' : 'lose' }));
      if (win) {
        pierceBonusRef.current = 2;          // 獲勝：兩回合無視其防禦
        push('猜拳獲勝！接下來兩回合無視牠的防禦。', 'gold');
      } else if (draw) {
        push('平手。誰也沒佔到便宜。');
      }
    } else {
      const right = playerPick === inter.q.a;
      needTxt = `正確答案：${inter.q.o[inter.q.a]}`;
      pass = right;
      setInter(v => ({ ...v, done:true, mine:playerPick, result: right ? 'win' : 'lose' }));
    }

    setTimeout(() => {
      setInter(null);
      const alive = finishCheck(pass, needTxt, MC);
      if (alive !== false) continueFoeTurn();
    }, 2000);
  }

  function grant(ratio=1) {
    const rawG = goldGain(M.gold, S.tree,
      (PK.greed?0.25:0) + (B.gold||0) + goldUpRef.current) * (mods.gold||1);
    const g = M.noDrop ? 0 : Math.round(rawG*ratio);
        const decay = isTower ? 1 : expDecay(S.lv, M.lv, !!M.noDecay);
    let e = Math.round(expGain(M.exp, S.tree, S.charm, B.exp||0, dblActive(S), decay, megaExpActive(S))*(mods.exp||1)*ratio);
    if (M.expPct) e = Math.max(1, Math.round(expToNext(S.lv) * M.expPct));   // 彩蛋怪：固定比例，不受加成
    let gained=0;

    // 地獄不掉任何東西（一般卷軸、裝備、基本道具全部排除，只給經驗金幣）
    const isHell = M.map === 'hell';
    const kind = dropKind(M);          // normal / elite / boss / bigboss
    const hi = isElevated(M);          // 基本道具是否套用「BOSS 等級」的提升機率

    // 一般卷軸：地獄、超王不適用（超王走神王卷軸），其餘依種類機率
    const scrollRate = (!M.noDrop && !isHell && !M.superKing) ? (MAP_SCROLL_RATE[kind] ?? 0) : 0;
    const drop = (scrollRate && Math.random() < scrollRate * (1+TL.dropUp))
      ? rollScroll(M.lv>=50?3:M.lv>=25?2:1) : null;

    // 基本道具：地獄不適用，其餘全套用，BOSS/大型BOSS/超王吃提升機率
    const pot = (M.noDrop || isHell) ? null : (rollPotion(M.lv, hi) || (TL.harvest && Math.random()<TL.harvest ? rollPotion(M.lv+10, hi) : null));
    const charmDrop = (M.noDrop || isHell) ? false : rollCharm(hi);
    const shardDrop = (M.noDrop || isHell) ? false : rollShard(hi);
    // 食物增益：地獄不適用，其餘全怪物共通，各自獨立判定（BOSS 等級吃提升機率）
    const foodDrops = (M.noDrop || isHell) ? []
      : FOOD_DROP.filter(f => Math.random() < (hi ? f.rateBoss : f.rate) * (1 + TL.dropUp)).map(f => f.id);

    // 裝備：地獄、超王不適用（超王走戒指），其餘依種類機率＋種類品質表，掉出來的階對應怪物等級
    const gearRate = (!M.noGear && !M.noDrop && !isHell && !M.superKing) ? (MAP_DROP_RATE[kind] ?? 0) : 0;
    const gearDrop = (gearRate && Math.random() < gearRate * (1+TL.dropUp)) ? (()=>{
      const gg = gearForLevel(M.lv);
      const q = rollQualityByKind(kind, (M.dropGearBonus||0));
      return makeInst(gg.id, q.quality, q.qv, 3);   // 一般地圖固定 3 插槽（含 BOSS）
    })() : null;
    // 超王專屬：戒指 + 神王卷軸，各自獨立判定，互不影響
    const ringDrop = (M.ringId && Math.random() < M.ringRate) ? (() => {
      const q = rollQualityByKind('ring', 0);
      return makeInst(M.ringId, q.quality, q.qv, 3);
    })() : null;
    const godScrollDrop = (M.godScrollRate && Math.random() < M.godScrollRate)
      ? GOD_SCROLLS[Math.floor(Math.random() * GOD_SCROLLS.length)] : null;

    patch(p => {
      let lv=p.lv, exp=p.exp+e, hp=p.hp, mp=p.mp;
      while (lv<MAX_LV && exp>=expToNext(lv)) { exp-=expToNext(lv); lv++; gained++; }
      if (gained) { const s2=stats({...p,lv},B); hp=s2.hpMax; mp=s2.mpMax; }
      const out = { lv, exp, hp, mp, gold:p.gold+g,
        charm:Math.max(0,p.charm-1),
        killed:{ ...p.killed,
          [foe.map]:{ ...(p.killed?.[foe.map]||{}), [M.id]:((p.killed?.[foe.map]||{})[M.id]||0)+1 } },
        ...((foe.map==='danger' || M.special==='cycle4h') ? { dangerKilled:[...(p.dangerKilled||[]), M.id] } : {}),
        stat:{...p.stat,kills:p.stat.kills+1} };
      if (drop) out.scrolls={...p.scrolls,[drop.id]:(p.scrolls[drop.id]||0)+1};
      if (pot) out.bag={...p.bag,[pot]:(p.bag[pot]||0)+1};
      if (charmDrop) out.bag={...(out.bag||p.bag),exp:((out.bag||p.bag).exp||0)+1};
      if (shardDrop) out.bag={...(out.bag||p.bag),shard:((out.bag||p.bag).shard||0)+1};
      for (const f of foodDrops) out.bag={...(out.bag||p.bag),[f]:((out.bag||p.bag)[f]||0)+1};
      if (gearDrop) out.bagGear=[...(p.bagGear||[]),gearDrop];
      if (ringDrop) out.bagGear=[...(out.bagGear||p.bagGear||[]),ringDrop];
      if (godScrollDrop) out.scrolls={...(out.scrolls||p.scrolls),[godScrollDrop.id]:((out.scrolls||p.scrolls)[godScrollDrop.id]||0)+1};
      const nq=bumpQuests(p,M.id); if(nq) out.quests=nq;
      return out;
    });
    return { g, e, gained, drop, gearDrop, ringDrop, godScrollDrop, pot, charmDrop, shardDrop, foodDrops, decay };
  }

  function win() {
    halt();
    if (isTower) { onWin(); return; }
    const r = grant(1);
    push(`擊敗 ${M.name}！獲得 ${r.e.toLocaleString()} EXP、${r.g.toLocaleString()} 金幣。`,'gold');
    if (r.drop) push(`掉落 ${r.drop.name}！`,'gold');
    if (r.pot) push(`掉落 ${POTIONS.find(x=>x.id===r.pot).name}。`);
    if (r.charmDrop) push('掉落 經驗符！','gold');
    if (r.shardDrop) push('掉落 時光碎片！','gold');
    for (const f of (r.foodDrops||[])) push(`掉落 ${POTIONS.find(x=>x.id===f).name}！`,'gold');
    if (r.gearDrop) push(`掉落裝備：${gearOf(r.gearDrop.gid).name}！`,'gold');
    if (r.ringDrop) push(`掉落戒指：${gearOf(r.ringDrop.gid).name}！`,'gold');
    if (r.godScrollDrop) push(`掉落 ${r.godScrollDrop.name}！`,'gold');
    if (r.decay < 1) push(`等級差過大，經驗只剩 ${Math.round(r.decay*100)}%。`, 'bad');
    if (r.gained) push('▲ 升級！HP 與 MP 已全部回復。','gold');
    setResult({ exp:r.e, gold:r.g, gained:r.gained, drop:r.drop, gearDrop:r.gearDrop,
                ringDrop:r.ringDrop, godScrollDrop:r.godScrollDrop, pot:r.pot,
                charmDrop:r.charmDrop, foodDrops:r.foodDrops, decay:r.decay });
    setOver('win');
  }
  function lose() {
    halt();
    if (isTower) { onLose(); return; }
    patch(p => {
      // 超王死亡不扣經驗，其餘照舊：LV10 以下免除、否則扣 50%
      const pen = (M.noDeathPenalty || p.lv<=10) ? 0 : Math.min(p.exp, Math.floor(expToNext(p.lv)*DEATH_PENALTY));
      return { hp:maxHp(p.lv), exp:p.exp-pen, charm:0,
               stat:{...p.stat,deaths:p.stat.deaths+1} };
    });
    push(M.noDeathPenalty ? '你倒下了。超王不扣經驗，再來一次。'
         : (S.lv>10?'你倒下了。經驗值 −50%。':'你倒下了。（LV.10 以下免除經驗懲罰）'), 'bad');
    if (S.charm>0) push('經驗符效果中斷。','bad');
    setOver('lose');
  }
  function flee() {
    if (isTower) return;
    const rate = fleeRate(S, M);
    if (rate === null) { push(`${M.name}不允許逃跑。`,'bad'); return; }
    halt();
    if (Math.random() * 100 < rate) {
      push(`逃跑成功！（成功率 ${rate}%）`); setOver('flee');
    } else {
      push(`逃跑失敗！（成功率 ${rate}%）視同浪費一回合，${M.name} 攻擊了你。`,'bad');
      setTimeout(foeTurn, 460);
    }
  }

  function useSkill(sk) {
    if (silenceRef.current) { push('你被震盪影響，本回合無法使用技能。', 'bad'); return; }
    const cost = B.freeSkill ? 0 : Math.round(sk.mp*(1+(B.mpCost||0)));
    if (S.mp < cost || cd[sk.id]) return;
    if (sk.once && S[`used_${sk.id}`]) return;
    const maxCast = 1 + (B.doubleSkill||0);
    if (!sk.free && skillUsedThisTurn >= maxCast) { push('本回合已無法再施放技能。','bad'); return; }
    patch(p=>({mp:p.mp-cost}));
    const cdv = Math.max(0, sk.cd-(PK.cdDown||0)-TL.cdDown);
    if (cdv) setCd(c=>({...c,[sk.id]:cdv+1}));
    setMenu('main');

    if (sk.free) {
      strike(sk.fx||'sue'); suedRef.current=true;
      patch({[`used_${sk.id}`]:true});
      push(`${sk.name}！${M.name} 攻擊力下降 30%。`,'gold');
      return;
    }
    halt();
    setSkillUsed(n=>n+1);
    const sMult = 1 + (B.skillDmg||0) + TL.skillDmg
      + (badgeRef.current ? BADGE.dmgUp : 0)
      + (ipoRef.current.turns > 0 ? ipoRef.current.pct : 0);

    if (sk.id==='deal') {
      if (M.kind==='boss'||M.boss) { push('BOSS 不接受談判。','bad'); setTimeout(start,380); return; }
      if (isTower) { push('塔內無法談判離場。','bad'); setTimeout(start,380); return; }
      strike('deal');
      const r = grant(0.5);
      push(`談判成功，取得 ${r.e} EXP、${r.g} 金幣後離場。`,'gold');
      setResult({exp:r.e,gold:r.g,gained:r.gained,deal:true}); setOver('deal'); return;
    }
    if (sk.hits) {
      push(`${sk.name}！連續 ${sk.hits} 段判定。`,'gold');
      multiScale.current = sk.hitMult*sMult; setMulti(sk.hits);
      setTimeout(start,200); return;
    }
    if (sk.buff) { strike('charge'); setInch(sk.buff); push('寸勁蓄勢，下一擊倍率 +0.5。','gold');
      setTimeout(foeTurn,460); return; }
    if (sk.id==='gun') {
      strike('bullet');
      let one = Math.ceil(dmgOut(st.atk,0.8,foeDefNow(),st.pierce+(B.pierce||0))*sMult);
      if (GAP) one = Math.ceil(one*0.5);
      let total=one; push(`第一發命中，造成 ${one} 傷害。`,'gold');
      if (Math.random()<0.5) { total+=one; push(`第二發命中，造成 ${one} 傷害。`,'gold'); }
      else push('第二發打偏了。','bad');
      show('best',total);
      const nhp=dealDamage(total);
      if (nhp<=0) { setTimeout(win,440); return; }
      setTimeout(foeTurn,600); return;
    }
    // ── 二轉特殊效果 ──
    if (sk.costGold) {
      if (S.gold < sk.costGold) { push(`金幣不足（需要 ${sk.costGold.toLocaleString()}）。`,'bad'); setTimeout(start,300); return; }
      patch(p=>({ gold:p.gold - sk.costGold }));
    }
    if (sk.healPct) {
      patch(p=>({ hp:Math.min(st.hpMax, p.hp + Math.round(st.hpMax*sk.healPct)) }));
      push(`${sk.name}，回復 ${Math.round(st.hpMax*sk.healPct)} HP。`,'gold');
      strike(sk.fx||'charge');
      if (sk.free) return;
      setTimeout(foeTurn,460); return;
    }
    if (sk.curHpPct) {
      const d = Math.max(1, Math.round(hp * sk.curHpPct));
      strike('deal'); show('best',d); push(`${sk.name}，造成 ${d} 傷害。`,'gold');
      const nh = dealDamage(d);
      if (nh<=0) { setTimeout(win,440); return; }
      setTimeout(foeTurn,600); return;
    }
    if (sk.immune) { immuneRef.current = sk.immune; strike('object');
      push(`${sk.name}！接下來 ${sk.immune} 回合免疫所有攻擊。`,'gold'); setTimeout(foeTurn,460); return; }
    if (sk.allUp) { ipoRef.current = { turns: sk.turns + 1, pct: sk.allUp }; strike('charge');
      push(`${sk.name}！攻擊、防禦、技能傷害 +${Math.round(sk.allUp*100)}%，持續 ${sk.turns} 回合。`,'gold');
      setTimeout(foeTurn,460); return; }
    if (sk.atkDown) { atkDownRef.current = sk.atkDown; patch({[`used_${sk.id}`]:true}); strike('sue');
      push(`${sk.name}！怪物攻擊力 −${Math.round(sk.atkDown*100)}%。`,'gold'); setTimeout(foeTurn,460); return; }
    if (sk.defDown) {
      defDownRef.current = Math.max(defDownRef.current || 0, sk.defDown);
      push(`${M.name} 的防禦被腐蝕至 ${foeDefNow()}。`,'gold');
    }
    if (sk.goldUp) { goldUpRef.current = Math.max(goldUpRef.current, sk.goldUp); }
    if (sk.freeze && !sk.mult) { frozenRef.current = Math.max(frozenRef.current, sk.freeze); strike(sk.fx||'ice');
      push(`${sk.name}！${M.name} 接下來 ${sk.freeze} 回合無法行動。`,'gold'); setTimeout(foeTurn,460); return; }

    let mv = sk.mult || 1;
    if (sk.burnBonus && burnRef.current.length) mv = sk.burnBonus;
    if (sk.frozenBonus && frozenRef.current) mv = (sk.mult||1) * sk.frozenBonus;
    const PEs = petEffect(S, M.kind==='boss' || !!M.boss);
    let dmg = Math.ceil(dmgOut(st.atk * (1 + (PEs?.dmg || 0)), mv, sk.ignoreDef ? 0 : foeDefNow(), st.pierce+(B.pierce||0))*sMult);
    if (sk.revengePct) dmg += Math.round(takenRef.current * sk.revengePct);
    if (sk.ignoreDef) dmg = Math.round(dmg * 1.15);
    if (sk.selfHp) patch(p=>({ hp:Math.max(1, p.hp - Math.round(st.hpMax*sk.selfHp)) }));
    if (sk.burn) {
      const n = sk.burn.stack || 1;
      for (let i=0;i<n;i++) burnRef.current.push({ turns:sk.burn.turns, pct:sk.burn.pct });
      push(`附加燃燒 ×${n}。`,'gold');
    }
    if (sk.freeze) {
      frozenRef.current = Math.max(frozenRef.current, sk.freeze);
      push(`${M.name} 接下來 ${sk.freeze} 回合無法行動。`,'gold');
    }
    if (sk.cleanse) { gaspRef.current=false; setGasped(false); stunRef.current=false; }
    if (sk.once) patch({[`used_${sk.id}`]:true});
    if (sk.goldUp) push(`本場金幣掉落 +${Math.round(sk.goldUp*100)}%。`,'gold');
    if (GAP) dmg = Math.ceil(dmg*0.5);
    strike(sk.fx||'slash');
    show('best',dmg);
    push(`${sk.name}，造成 ${dmg} 傷害。`,'gold');
    if (sk.id==='ice') { frozenRef.current = Math.max(frozenRef.current, 1); push(`${M.name} 被冰封。`,'gold'); }
    if (sk.id==='meteor') stunRef.current=true;
    if (sk.id==='object'||sk.guard) { blockRef.current=true; push('本回合免疫怪物攻擊。','gold'); }
    const nhp=dealDamage(dmg);
    if (nhp<=0) { setTimeout(win,440); return; }
    setTimeout(foeTurn,600);
  }

  useEffect(() => {
    const key = e => {
      if (e.code==='Space') {
        e.preventDefault();
        if (over) { isTower?null:exit(); return; }
        if (running) doSwing();
      }
      if (e.key==='Escape' && menu!=='main') setMenu('main');
    };
    window.addEventListener('keydown',key);
    return ()=>window.removeEventListener('keydown',key);
  });

  const segs = [['miss',Z.miss/2],['normal',Z.normal/2],['good',Z.good/2],['best',Z.best/2],
    ['center',Z.center],['best',Z.best/2],['good',Z.good/2],['normal',Z.normal/2],['miss',Z.miss/2]];
  const advSkills = S.advJob ? (ADV_JOBS[S.advJob]?.skills || []) : [];
  const jobSkills = [...(S.job && SKILLS[S.job] || []), ...advSkills].filter(s=>S.lv>=s.lv);

  return (
    <>
      {fx && <div className="fx"><img src={fx.img} alt="" /><span className="fx-label serif">{fx.label}</span></div>}
      {inter && (
        <div className="fx interwrap">
          {inter.type === 'rps' ? (
            <div className="interbox">
              <p className="serif intertitle">{M.name} 向你伸出了手</p>
              <div className="rpsrow">
                <div className="rpsside">
                  <span className="rpslabel">你</span>
                  <div className="rpspick">
                    {inter.done
                      ? <img src={RPS.find(r=>r.id===inter.mine)?.img} alt=""
                          onError={e=>{e.target.replaceWith(Object.assign(document.createElement('b'),
                            {textContent:RPS.find(r=>r.id===inter.mine)?.name||'—'}));}} />
                      : <span className="rpsq">？</span>}
                  </div>
                </div>
                <span className="rpsvs serif">VS</span>
                <div className="rpsside">
                  <span className="rpslabel">{M.name}</span>
                  <div className="rpspick">
                    {inter.done
                      ? <img src={inter.foe.img} alt=""
                          onError={e=>{e.target.replaceWith(Object.assign(document.createElement('b'),
                            {textContent:inter.foe.name}));}} />
                      : <span className="rpsq">？</span>}
                  </div>
                </div>
              </div>
              {inter.done ? (
                <p className={`interres serif ${inter.result}`}>
                  {inter.result==='win' ? '你贏了' : inter.result==='draw' ? '平　手' : '你輸了'}
                </p>
              ) : (
                <div className="row" style={{justifyContent:'center'}}>
                  {RPS.map(r => (
                    <button key={r.id} className="btn key rpsbtn" onClick={()=>resolveInter(r.id)}>
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="interbox">
              <p className="serif intertitle">{M.name} 提出了問題</p>
              {!inter.done && (
                <div className="qtimer" style={{width:'100%',marginBottom:10}}>
                  <i style={{ width:`${inter.left/8*100}%`,
                       background: inter.left<=3?'var(--vermilion)':'var(--brass)' }} />
                </div>
              )}
              <p className="quizq" style={{textAlign:'center'}}>{inter.q.q}</p>
              <div className="list">
                {inter.q.o.map((o,i)=>{
                  let cls='quizopt';
                  if (inter.done) {
                    if (i===inter.q.a) cls+=' right';
                    else if (i===inter.mine) cls+=' wrong';
                  }
                  return <button key={i} className={cls} disabled={inter.done}
                    onClick={()=>resolveInter(i)}>{o}</button>;
                })}
              </div>
              {inter.done && (
                <p className={`interres serif ${inter.result}`}>
                  {inter.result==='win' ? '答對了' : '答錯了'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {check && (
        <div key={check.k} className={`checkbar ${check.ok?'ok':'fail'}`}>
          <b>{check.ok ? '檢定通過' : '檢定失敗'}</b>
          <span>需求：{check.need}</span>
        </div>
      )}
      {over==='lose' && !isTower && (
        <div className="fx" style={{flexDirection:'column',gap:20}}>
          <img src="/ui/death.png" alt="" style={{maxWidth:'min(420px,80vw)'}} />
          <p className="serif" style={{fontSize:26,letterSpacing:'.22em',color:'var(--vermilion)'}}>你 倒 下 了</p>
          <p className="muted">{S.lv>10?'經驗值 −50%':'LV.10 以下免除經驗懲罰'}　·　HP 已回復</p>
          <button className="btn key" onClick={exit}>確認重生　空白鍵</button>
        </div>
      )}

      <div className="battle-wrap">
        <div className={`card ${ouch&&Date.now()-ouch<400?'ouch':''}`} key={ouch}>
          <div className="foe">
            <div className="foe-por">
              <img src={M.img} alt="" />
              {hitFx && <span key={hitFx.k} className={`fxlayer fx-${hitFx.type}`} />}
            </div>
            <div>
              <div className="foe-name">{M.name}</div>
              <div className="foe-meta">
                LV.{M.lv}　ATK {foeAtk}{suedRef.current&&' ↓'}　
                {M.def>0 && (
                  <span style={{ color: st.pierce >= foeDefNow() ? 'var(--brass)' : undefined }}>
                    DEF {foeDefNow()}{foeDefNow() < (M.def||0) && ' ↓'}
                    {st.pierce>0 && `（你的穿透 ${st.pierce}）`}　
                  </span>
                )}
                HP {insight>=1||isTower ? `${Math.max(0,hp)} / ${foeHpMax}` : '???'}
                {insight>=2 && !isTower && `　EXP ${M.exp}`}
              </div>
              <div className="foe-hp"><i style={{width:`${Math.max(0,hp/foeHpMax*100)}%`}} /></div>
              {badgeRef.current && (
                <p className="mechwarn" style={{borderColor:'var(--brass)'}}>
                  <b style={{color:'var(--brass)'}}>遠征隊徽章</b>
                  　你的傷害 +{Math.round(BADGE.dmgUp*100)}%　對方傷害 −{Math.round(BADGE.takenDown*100)}%
                </p>
              )}
              {GAP>0 && <p className="gapwarn">等級差 {M.lv-S.lv}　MISS 擴大至 {GAP}%　技能傷害減半</p>}
              {mods.atk>1 && <p className="gapwarn">高風險地圖　怪物攻擊 ×{mods.atk}</p>}
              {M.skill && MOB_SKILLS[M.skill] && (
                <p className="mechwarn">
                  <img className="skicon" src={MOB_SKILLS[M.skill].img} alt=""
                    onError={e=>{e.target.style.display='none';}} />
                  <b>{MOB_SKILLS[M.skill].name}</b>
                  {MOB_SKILLS[M.skill].kind==='passive' && `　每回合 ${Math.round(MOB_SKILLS[M.skill].rate*100)}% 機率`}
                  {MOB_SKILLS[M.skill].kind==='cycle' && `　每 ${MOB_SKILLS[M.skill].every} 回合`}
                  {MOB_SKILLS[M.skill].kind==='always' && '　常駐'}
                  {MOB_SKILLS[M.skill].kind==='cond' && '　條件觸發'}
                  <br />{MOB_SKILLS[M.skill].detail}
                </p>
              )}
              {M.mechanic && (()=>{ const MC=M.mechanic, info=MECHANICS[MC.type];
                const next = MC.every - ((turn) % MC.every);
                return (
                  <p className="mechwarn alert">
                    {info?.img && <img className="skicon" src={info.img} alt=""
                      onError={e=>{e.target.style.display='none';}} />}
                    <b>{info?.name || '檢定'}</b>　每 {MC.every} 回合
                    <span className="cd">　{next} 回合後觸發</span>
                    <br />
                    {MC.type==='dmgCheck'
                      ? `期間須累計造成 ${Math.round(foeHpMax*MC.pct*MC.every).toLocaleString()} 傷害，`
                      : info ? info.fmt(MC).replace(/，否則.*/, '，') : ''}
                    {MC.type==='dmgCheck' && `否則損失 ${Math.round(MC.punishPct*100)}% 當前血量`}
                    {MC.type!=='dmgCheck' && MC.type!=='rps' && `否則損失 ${Math.round(MC.punishPct*100)}% 當前血量`}
                    {MC.type==='rps' && `輸了損失 ${Math.round(MC.punishPct*100)}% 血量`}
                  </p>
                ); })()}
            </div>
          </div>

          <div style={{padding:'18px 0 8px'}}>
            <div className="bar" ref={barRef}>
              {segs.map(([k,w],i)=><div key={i} className={`seg s-${k}`} style={{width:`${w}%`}} />)}
              <div ref={needleRef} className={`needle ${running?'':'stop'}`} />
            </div>
            <div className="ticks"><span>MISS</span><span>普通</span><span>次佳 · 最佳 · 中心</span><span>普通</span><span>MISS</span></div>
            <div className="verdict">
              {verdict && <>
                <span key={verdict.k} className="stamp on" style={{color:COLOR[verdict.kind]}}>{LABEL[verdict.kind]}</span>
                {verdict.dmg>0 && <span key={verdict.k+'d'} className="dmgn on" style={{color:COLOR[verdict.kind]}}>− {verdict.dmg}</span>}
              </>}
            </div>
          </div>

          {over ? (over==='flee' ? <div className="row"><button className="btn key" onClick={exit}>離開　空白鍵</button></div> : null)
          : menu==='skill' ? <>
            <div className="row" style={{marginBottom:8}}>
              {!jobSkills.length && <span className="muted">尚無可用技能。</span>}
              {jobSkills.map(s=>{
                const cost = B.freeSkill?0:Math.round(s.mp*(1+(B.mpCost||0)));
                const sM = 1+(B.skillDmg||0);
                let est = null;
                if (s.mult) est = Math.ceil(dmgOut(st.atk, s.mult)*sM);
                else if (s.hits) est = Math.ceil(dmgOut(st.atk, s.hitMult)*sM)+' ×'+s.hits;
                else if (s.id==='gun') est = Math.ceil(dmgOut(st.atk,0.8)*sM)+'~'+Math.ceil(dmgOut(st.atk,0.8)*sM*2);
                if (est && GAP && typeof est==='number') est = Math.ceil(est*0.5);
                return (
                  <button key={s.id} className="btn skillbtn"
                    disabled={S.mp<cost||!!cd[s.id]||(s.once&&S[`used_${s.id}`])}
                    onClick={()=>useSkill(s)} title={s.desc}>
                    {s.img && <img src={s.img} alt="" />}
                    <span>
                      {s.name}　{cost}MP
                      {est!==null && <b className="skillest">{typeof est==='number'?`~${est}`:`~${est}`}</b>}
                      {cd[s.id]?`　冷卻 ${cd[s.id]-1}`:''}
                    </span>
                  </button>
                );
              })}
            </div>
            <button className="btn" onClick={()=>setMenu('main')}>返回　ESC</button>
          </> : (
            <div className="row">
              <button className="btn key" disabled={!running} onClick={doSwing}>
                {multi!=null?`連段 ${multi}　空白鍵`:'普攻　空白鍵'}
              </button>
              <button className="btn" disabled={!running||!S.job} onClick={()=>setMenu('skill')}>技能</button>
              {!isTower && fleeRate(S,M)!==null && <button className="btn" onClick={flee}>逃跑（{fleeRate(S,M)}%）</button>}
              {!isTower && fleeRate(S,M)===null && <span className="muted" style={{fontSize:12,alignSelf:'center'}}>不允許逃跑</span>}
              {isTower && <span className="muted" style={{alignSelf:'center',fontSize:12}}>
                塔內無法逃跑，打完才能離開
              </span>}
            </div>
          )}

          <div className="log">{log.map(l=><p key={l.k} className={l.c||''}>{l.t}</p>)}</div>
        </div>

        {result && (over==='win'||over==='deal') && (
          <aside className="settle">
            <img src="/ui/win.png" alt="" className="settle-img" />
            <p className="serif settle-title">{result.deal?'談判成立':'戰 鬥 勝 利'}</p>
            <table className="kv"><tbody>
              <tr><td>對手</td><td>{M.name}</td></tr>
              <tr><td>經驗</td><td style={{color:'var(--brass)'}}>+{result.exp.toLocaleString()}
                {result.decay<1 && <span style={{color:'var(--vermilion)',fontSize:11}}>　衰減 {Math.round(result.decay*100)}%</span>}</td></tr>
              <tr><td>金幣</td><td style={{color:'var(--brass)'}}>+{result.gold.toLocaleString()}</td></tr>
            </tbody></table>
            {result.drop && <div className="settle-drop">
              {result.drop.img && <img src={result.drop.img} alt="" />}
              <p>取得 {result.drop.name}</p></div>}
            {result.gearDrop && (()=>{ const g=gearOf(result.gearDrop.gid);
              const q=QUALITY.find(x=>x.id===result.gearDrop.quality);
              return <div className="settle-drop">
                {g.img&&<img src={g.img} alt="" />}
                <p style={{color:q.color}}>{q.name} {g.name}　{result.gearDrop.qv>=0?'+':''}{result.gearDrop.qv}</p>
              </div>; })()}
            {result.ringDrop && (()=>{ const g=gearOf(result.ringDrop.gid);
              const q=QUALITY.find(x=>x.id===result.ringDrop.quality);
              return <div className="settle-drop">
                {g.img&&<img src={g.img} alt="" />}
                <p style={{color:'var(--brass)'}}>{q.name} {g.name}　{result.ringDrop.qv>=0?'+':''}{result.ringDrop.qv}</p>
              </div>; })()}
            {result.godScrollDrop && <div className="settle-drop">
              {result.godScrollDrop.img && <img src={result.godScrollDrop.img} alt="" />}
              <p style={{color:'var(--brass)'}}>取得 {result.godScrollDrop.name}</p></div>}
            {result.charmDrop && <div className="settle-drop">
              <img src="/item/exp.png" alt="" /><p style={{color:'var(--brass)'}}>取得 經驗符</p></div>}
            {(result.foodDrops||[]).map(f => { const F0=POTIONS.find(x=>x.id===f);
              return <div className="settle-drop" key={f}>
                {F0.img && <img src={F0.img} alt="" />}
                <p style={{color:'var(--brass)'}}>取得 {F0.name}</p></div>; })}
            {result.pot && (()=>{ const P0=POTIONS.find(x=>x.id===result.pot);
              return <div className="settle-drop">
                {P0.img&&<img src={P0.img} alt="" />}<p>取得 {P0.name}</p></div>; })()}
            {result.gained>0 && <p className="settle-lv">▲ 升級 +{result.gained}　HP / MP 全滿</p>}
            <button className="btn key" style={{width:'100%',marginTop:14}} onClick={exit}>返回地圖　空白鍵</button>
          </aside>
        )}
      </div>
    </>
  );
}
