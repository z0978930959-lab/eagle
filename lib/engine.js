import { GEAR, TREE, MONSTERS, SCROLLS, SLOTS, MAPS, QUALITY, QUALITY_ODDS, MAP_QUALITY_ODDS, MAP_DROP_RATE, MAP_SCROLL_RATE, ITEM_DROP_RATE, CODES } from './data';
import { QUESTS } from './quests';
import { TOWERS, TOWER_LIST, BUFFS, BUFF_ODDS, BUFF_EXCLUDE } from './tower';
import { DANGER_CYCLE_MS } from './maps2';
import { ADV_JOBS, ADV_OF, ADV_LV } from './advance';

// ── 成長曲線 ──────────────────────────────
export const maxHp     = L => 40 + 18 * (L - 1);
export const maxMp     = L => 15 + 5 * (L - 1);
export const baseAtk   = L => 2 + L;
// LV15 前放緩（教學期）→ 主線陡升 → LV70 後再額外加壓（每級再 +1.2%）
// ── 新世界（LV100+）────────────────────────
// 100 等之後是另一個世界：需求、血量、經驗、金幣全部換一個量級。
// 這四個常數就是全部的旋鈕，實測後直接調這裡。
export const NEW_WORLD_LV    = 100;
export const NW_EXP_REQ_X    = 3.5;    // 100 等當下，升級需求的倍率
export const NW_EXP_REQ_GROW = 1.14;   // 之後每一等再乘上去

export const expToNext = L => {
  if (L < 15) return Math.round(22 * Math.pow(L, 1.55));
  const base = 22 * Math.pow(L, 1.95);
  if (L < 70) return Math.round(base);
  const late = base * (1.20 + 0.012 * (L - 70));
  if (L < NEW_WORLD_LV) return Math.round(late);
  return Math.round(late * NW_EXP_REQ_X * Math.pow(NW_EXP_REQ_GROW, L - NEW_WORLD_LV));
};
export const MAX_LV = 120;
export const MULT_CAP = 2.5;
export const CENTER_BLOCK_RATE = 0.60;   // 中心命中讓怪物攻擊落空的機率
export const DEATH_PENALTY = 0.5;      // 死亡損失升級所需的 50%

// ── 判定區（總和 100 格）──────────────────
export const MULT  = { center:2.5, best:2, good:1.5, normal:1, miss:0 };
export const LABEL = { center:'中心', best:'最佳', good:'次佳', normal:'普通', miss:'MISS' };

export function zones(tree, opt = {}) {
  const { gasped = false, forceMiss = 0, centerUp = 0, goodUp = 0, bestUp = 0, noMiss = false } = opt;
  const n2 = tree.a2 || 0, n3 = tree.a3 || 0;
  const a5 = tree.a5 || 0, a6 = tree.a6 || 0;
  const c12 = Math.floor((tree.c12 || 0) * 0.5);
  let best = 6 + n2 + 2 * n3 + bestUp + a5;
  if (noMiss) best = Math.max(2, Math.round(best / 2));
  if (gasped) best = Math.max(2, Math.round(best / 2));

  let z = {
    center: 2 + centerUp + c12,
    best,
    good:   14 + n2 + 2 * n3 + goodUp + a6,
    normal: 48 + 2 * n2 - 4 * n3 - a5 - a6 - c12,
    miss:   Math.max(0, 30 - 4 * n2),
  };
  if (noMiss) { z.normal += z.miss; z.miss = 0; }

  // 正規化到 100 格（順序無關）
  const sum = z.center + z.best + z.good + z.normal + z.miss;
  if (sum !== 100) {
    const diff = 100 - sum;
    z.normal = Math.max(0, z.normal + diff);
  }
  if (!forceMiss) return z;

  // 等級差懲罰：MISS 固定，其餘按比例壓縮
  const rest = 100 - forceMiss;
  const s2 = z.center + z.best + z.good + z.normal;
  const sc = {
    center: Math.max(1, Math.round(z.center / s2 * rest)),
    best:   Math.max(1, Math.round(z.best   / s2 * rest)),
    good:   Math.max(1, Math.round(z.good   / s2 * rest)),
  };
  sc.normal = Math.max(0, rest - sc.center - sc.best - sc.good);
  return { ...sc, miss: 100 - sc.center - sc.best - sc.good - sc.normal };
}

export function judge(pos, z) {
  const d = Math.abs(pos - 50);
  let e = z.center / 2;  if (d <= e) return 'center';
  e += z.best / 2;       if (d <= e) return 'best';
  e += z.good / 2;       if (d <= e) return 'good';
  e += z.normal / 2;     if (d <= e) return 'normal';
  return 'miss';
}

export const BASE_PERIOD = 700;
export const period = (tree, bonus = 0) =>
  Math.round(BASE_PERIOD * (1 + 0.05 * (tree.a1 || 0) + 0.10 * (tree.a4 || 0)
             + 0.03 * (tree.a7 || 0) + bonus));

export function needlePos(elapsed, p) {
  const ph = (elapsed % p) / p;
  return ph < 0.5 ? ph * 200 : (1 - ph) * 200;
}

// 等級差懲罰
export function gapMiss(playerLv, foeLv) {
  const d = foeLv - playerLv;
  if (d < 4) return 0;
  if (d === 4) return 50;
  if (d === 5) return 70;
  if (d === 6) return 80;
  return 90;
}

// ── 食物增益（心跳停止糖 / 章魚燒）────────
// 全部採「加法」疊加，彼此之間、與其他任何增益之間都不衝突
export const BOOST_MS = 30 * 60 * 1000;              // 30 分鐘
export const BOOSTS = {
  heartstop: { name:'心跳停止糖', atk:150 },
  takoyaki:  { name:'章魚燒',     atk:100 },
};
export const boostLeft = (S, id) => Math.max(0, (S.boost?.[id] || 0) - Date.now());
export const boostOn   = (S, id) => boostLeft(S, id) > 0;
export const boostAtk  = S =>
  Object.keys(BOOSTS).reduce((a, id) => a + (boostOn(S, id) ? BOOSTS[id].atk : 0), 0);

// ── 遠征隊徽章 ────────────────────────────
// 進入大型 BOSS 戰時自動消耗一枚
export const BADGE = { dmgUp: 0.40, takenDown: 0.20 };

// ── 裝備與數值 ────────────────────────────
export const gearOf = id => GEAR.find(g => g.id === id) || null;

// 玩家持有的裝備實例：{ uid, gid, quality, up:{atk,def,hp,used} }
export function instStats(inst) {
  const g = gearOf(inst.gid);
  if (!g) return { atk:0, def:0, hp:0 };
  const q = QUALITY.find(x => x.id === inst.quality);
  const bonus = q ? inst.qv : 0;
  return {
    atk: Math.max(0, g.atk + bonus + (inst.up?.atk || 0)),
    def: Math.max(0, g.def + (g.def > 0 ? bonus : 0) + (inst.up?.def || 0)),
    hp:  (g.hp || 0) + (inst.up?.hp || 0),
    pierce: Math.max(0, (g.pierce || 0) + (inst.up?.pierce || 0)),
  };
}

export function perksOf(S) {
  const out = {};
  for (const sl of SLOTS) {
    const inst = findInst(S, S.equip?.[sl.id]);
    const g = inst && gearOf(inst.gid);
    if (g?.perk) out[g.perk] = (out[g.perk] || 0) + 1;
  }
  return out;
}

export const findInst = (S, uid) => (S.bagGear || []).find(x => x.uid === uid) || null;

// ── 逃跑成功率 ────────────────────────────
// 大型 BOSS、超王完全不能逃跑（回傳 null）。其餘依怪物等級抓基準值，
// 玩家等級高於/低於怪物可微調（最多 ±10%），BOSS 再扣 15%、菁英扣 10%。
const FLEE_PTS = [[10,100], [15,85], [30,70], [50,60], [70,50], [90,40]];
export function fleeRate(S, M) {
  if (M.big || M.superKing) return null;
  const mlv = M.lv;
  let base;
  if (mlv <= 10) base = 100;
  else if (mlv >= 90) base = Math.max(20, 40 - 0.5 * (mlv - 90));
  else {
    let i = 0;
    while (i < FLEE_PTS.length - 1 && mlv > FLEE_PTS[i + 1][0]) i++;
    const [x0, y0] = FLEE_PTS[i], [x1, y1] = FLEE_PTS[i + 1];
    base = y0 + (y1 - y0) * (mlv - x0) / (x1 - x0);
  }
  const adj = Math.max(-10, Math.min(10, S.lv - mlv));
  let pen = 0;
  if (M.kind === 'boss') pen = 15;
  else if (M.kind === 'elite') pen = 10;
  return Math.round(Math.max(5, Math.min(100, base + adj - pen)));
}

export function stats(S, buffs = {}) {
  let ga = 0, gd = 0, gh = 0, gp = 0;
  const weaponInst = findInst(S, S.equip?.weapon);
  const weaponDmgPct = weaponInst?.up?.dmgPct || 0;   // 神王卷軸：總傷害輸出加成，只有武器能帶
  for (const sl of SLOTS) {
    const inst = findInst(S, S.equip?.[sl.id]);
    if (!inst) continue;
    const s = instStats(inst);
    ga += s.atk; gd += s.def; gh += s.hp; gp += s.pierce;
  }
  const hpMax = Math.round((maxHp(S.lv) + gh + 15 * (S.tree.b5 || 0)) * (1 + (buffs.hpMax || 0)));
  const mpMax = Math.round((maxMp(S.lv) + 5 * (S.tree.b6 || 0)) * (1 + (buffs.mpMax || 0)));
  return {
    atk: Math.round((baseAtk(S.lv) + ga + (S.tree.b3 || 0) + boostAtk(S)) * (1 + (buffs.dmg || 0) + weaponDmgPct)),
    def: gd + 2 * (S.tree.b4 || 0) + (buffs.def || 0),
    pierce: gp + (S.tree.c8 || 0) + (buffs.pierce || 0),
    hpMax, mpMax, gearAtk: ga, gearDef: gd, gearPierce: gp,
  };
}

// 防禦採遞減公式，堆再多也不會免疫
export const dmgIn = (foeAtk, def, extra = 0) =>
  Math.max(1, Math.round(foeAtk * (1 - def / (def + 80)) * (1 + extra)));
// 扣減制：傷害 = 攻擊 − max(0, 怪物防禦 − 物理穿透)
// 穿透先削減防禦，削到 0 為止；若傷害不足以破防則完全無效
export const dmgOut = (atk, mult, foeDef = 0, pierce = 0) => {
  const eff = Math.max(0, foeDef - pierce);
  return Math.max(0, Math.ceil(atk * mult) - eff);
};

export const goldGain = (base, tree, extra = 0) =>
  Math.ceil(base * (1 + 0.10 * (tree.b1 || 0) + extra));
// 經驗衰減：只在「高於怪物 15 級以上」時生效
// 打高等怪不罰經驗，難度已由 MISS 擴大與技能減傷體現
export function expDecay(playerLv, foeLv, noDecay = false) {
  if (noDecay || playerLv < 15) return 1;
  const d = playerLv - foeLv;
  if (d <= 15) return 1;
  return Math.max(0.05, 1 / (1 + 0.35 * Math.pow(d - 15, 1.3)));
}

export const expGain = (base, tree, charm, extra = 0, dbl = false, decay = 1, mega = false) =>
  Math.ceil(base * decay * (1 + 0.03 * (tree.b2 || 0) + extra) * (charm > 0 ? 1.1 : 1) * (dbl ? 2 : 1) * (mega ? 10 : 1));
export const potionHeal = (val, tree) => Math.ceil(val * (1 + 0.10 * (tree.c3 || 0)));

// 十倍經驗卷：生效中看「啟用當下的等級」跟「目前等級」比對，一旦升級（目前等級 > 啟用當下）就自動視為消耗掉，
// 不需要額外的計時器或在升級當下手動清掉，天然不怕漏處理。
export const megaExpActive = S => !!S.megaExpActive && S.lv <= (S.megaExpLv ?? -1);

// ── 卷軸 ──────────────────────────────────
export function scrollValue(sc, inst) {
  if (sc.stat === 'dmgPct') return sc.fixedVal;
  const g = gearOf(inst.gid);
  const base = sc.stat === 'hp' ? 20 : (g[sc.stat] || 0);
  return Math.max(sc.minVal, Math.ceil(base * sc.ratio));
}

export function scrollFits(sc, inst) {
  if (!inst) return { ok:false, why:'沒有裝備這個部位' };
  const g = gearOf(inst.gid);
  if (!sc.slots.includes(g.slot)) return { ok:false, why:`${sc.name}不能用於${g.name}` };
  if (!sc.gearTier.includes(g.tier)) return { ok:false, why:'裝備階級不符' };
  const cap = inst.maxSlots ?? g.slots;
  if ((inst.up?.used || 0) >= cap) return { ok:false, why:'衝捲次數已用盡' };
  return { ok:true };
}

// ── 能力樹 ────────────────────────────────
export const apTotal = lv => 3 * (lv - 1);
export const apSpent = tree => Object.values(tree).reduce((s, v) => s + v, 0);
export const apLeft  = S => apTotal(S.lv) - apSpent(S.tree);
export function nodeOpen(node, tree) {
  if (!node.need) return true;
  return (tree[node.need[0]] || 0) >= node.need[1];
}

// ── 天賦的戰鬥效果 ────────────────────────
export function talents(tree = {}) {
  return {
    lifesteal: 0.01 * (tree.c6 || 0),
    counter:   0.08 * (tree.c7 || 0),
    pierce:    1 * (tree.c8 || 0),      // 每級 +1 物理穿透
    mpDrain:   0.03 * (tree.c10 || 0),
    cdDown:    tree.c11 || 0,
    startHeal: 0.02 * (tree.c13 || 0),
    bossDmg:   0.02 * (tree.d1 || 0) + 0.02 * (tree.e3 || 0),
    taken:    -0.01 * (tree.d2 || 0) - 0.01 * (tree.e2 || 0),
    dropUp:    0.02 * (tree.d3 || 0),
    skillDmg:  0.02 * (tree.d5 || 0) + 0.02 * (tree.e1 || 0),
    critDmg:   0.03 * (tree.d6 || 0),
    fastStart: 0.06 * (tree.d7 || 0),
    tenacity:  0.10 * (tree.d9 || 0) + 0.05 * (tree.e4 || 0),
    execute:   (tree.d10 || 0) > 0,
    firstHit:  0.20 * (tree.d11 || 0) + 0.10 * (tree.e5 || 0),
    lastStand: (tree.d12 || 0) > 0,
    coldBlood: 0.04 * (tree.d13 || 0),
    harvest:   0.02 * (tree.d14 || 0),
  };
}

// ── 亂數與地圖循環 ────────────────────────
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const CYCLE_MS = 40 * 60 * 1000;
export const cycleId  = () => Math.floor(Date.now() / CYCLE_MS);
export const msToReset = () => CYCLE_MS - (Date.now() % CYCLE_MS);
export const dayId = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);

// 每種怪只放一個節點，帶剩餘數量；位置沿用資料表座標，不再重疊
export function spawnList(cid, mapId, extra = 0) {
  const rand = rng(cid + extra * 7919 + mapId.length * 131);
  const out = [];
  for (const m of MONSTERS.filter(x => x.map === mapId)) {
    if (m.special) continue;   // 走專屬四小時循環的怪（曾國城），不在一般輪替裡出現
    if (m.rare && rand() > m.rare) continue;
    out.push({ key: m.id, id: m.id, total: m.count, x: m.pos[0], y: m.pos[1] });
  }
  return out;
}

// 該種怪還剩幾隻（killed 存的是 'id:n' 的累計擊殺數）
export function leftOf(S, mapId, id, total) {
  const k = (S.killed?.[mapId] || {})[id] || 0;
  return Math.max(0, total - k);
}

// ── 掉落 ──────────────────────────────────
// hi = 是否套用「BOSS／大型BOSS／超王」的提升機率
export const POTION_DROP_RATE = hi => hi ? ITEM_DROP_RATE.potion.boss : ITEM_DROP_RATE.potion.normal;
export function rollPotion(lv, hi = false) {
  if (Math.random() >= POTION_DROP_RATE(hi)) return null;
  const w = lv < 10  ? { hp_s:78, hp_m:20, hp_l:0,  mp:2 }
          : lv < 20  ? { hp_s:46, hp_m:38, hp_l:6,  mp:10 }
          : lv < 30  ? { hp_s:18, hp_m:46, hp_l:22, mp:14 }
          :            { hp_s:6,  hp_m:36, hp_l:40, mp:18 };
  const tot = Object.values(w).reduce((a,b)=>a+b,0);
  let r = Math.random() * tot;
  for (const [id, v] of Object.entries(w)) { r -= v; if (r <= 0) return id; }
  return 'hp_s';
}

// 經驗符／時光碎片：一般 vs BOSS／大型BOSS／超王
export const rollCharm = hi => Math.random() < (hi ? ITEM_DROP_RATE.charm.boss : ITEM_DROP_RATE.charm.normal);
export const rollShard = hi => Math.random() < (hi ? ITEM_DROP_RATE.shard.boss : ITEM_DROP_RATE.shard.normal);
export const SHARD_NEED = 5;

// 卷軸掉落：屬性採加權（穿透較稀有），成功率分四檔
export const SCROLL_STAT_ODDS = [
  ['atk',    30],
  ['def',    30],
  ['hp',     28],
  ['pierce', 12],   // 穿透卷軸
];
export function rollScroll(tier = 1) {
  const r = Math.random();
  const k = r < 0.40 ? 0 : r < 0.70 ? 1 : r < 0.90 ? 2 : 3;
  const tot = SCROLL_STAT_ODDS.reduce((a, x) => a + x[1], 0);
  let n = Math.random() * tot, stat = 'atk';
  for (const [id, w] of SCROLL_STAT_ODDS) { n -= w; if (n <= 0) { stat = id; break; } }
  return SCROLLS.find(s => s.id === `${stat}${tier}_${k}`) || SCROLLS[0];
}

export function rollQuality(floor, bonus = 0) {
  const row = QUALITY_ODDS.find(r => floor <= r.upTo) || QUALITY_ODDS[QUALITY_ODDS.length - 1];
  const total = row.w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total, idx = 0;
  for (let i = 0; i < row.w.length; i++) { r -= row.w[i]; if (r <= 0) { idx = i; break; } }
  idx = Math.min(QUALITY.length - 1, idx + bonus);
  const q = QUALITY[idx];
  return { quality: q.id, qv: q.min + Math.floor(Math.random() * (q.max - q.min + 1)) };
}

export function rollQualityFromTable(w, bonus = 0) {
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total, idx = 0;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { idx = i; break; } }
  idx = Math.min(QUALITY.length - 1, idx + bonus);
  const q = QUALITY[idx];
  return { quality: q.id, qv: q.min + Math.floor(Math.random() * (q.max - q.min + 1)) };
}
// 地圖怪物掉裝備的品質：kind 直接傳 normal/elite/boss/bigboss/ring
export function rollQualityByKind(kind = 'normal', bonus = 0) {
  return rollQualityFromTable(MAP_QUALITY_ODDS[kind] || MAP_QUALITY_ODDS.normal, bonus);
}

// 怪物的「掉落種類」：大型BOSS 優先於一般 kind 分類
export const dropKind = M => M.big ? 'bigboss' : (M.kind || 'normal');
// 是否套用「BOSS／大型BOSS／超王」等級的基本道具機率
export const isElevated = M => M.kind === 'boss' || !!M.big || !!M.superKing;

// 依怪物等級挑「他這個等級」的裝備：找 reqLv ≤ 怪物等級 裡最高的一階，只從該階隨機挑一件
// 排除 source:'quest'（階 VIII/IX/X 任務任選一專屬，不從野怪隨機掉）
export function gearForLevel(lv) {
  const pool = GEAR.filter(g => !g.noDrop && g.source !== 'quest' && g.source !== 'superking' && g.reqLv <= lv);
  if (!pool.length) return GEAR.find(g => !g.noDrop && g.source !== 'quest' && g.source !== 'superking');
  const topTier = Math.max(...pool.map(g => g.tier));
  const atTier = pool.filter(g => g.tier === topTier);
  return atTier[Math.floor(Math.random() * atTier.length)];
}

export function makeInst(gid, quality = 'white', qv = 0, maxSlots = null) {
  const g = gearOf(gid);
  return { uid: `${gid}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
           gid, quality, qv, maxSlots: maxSlots ?? (g?.slots ?? 3), up:{ atk:0, def:0, hp:0, used:0 } };
}

// ── 任務 ──────────────────────────────────
export function questState(S, q) {
  const rec = S.quests?.[q.id];
  if (!rec) return S.lv >= q.reqLv ? 'open' : 'locked';
  if (rec.done) return 'done';
  return q.goals.every(g => (rec.prog?.[g.id] || 0) >= g.n) ? 'ready' : 'active';
}

export function bumpQuests(S, monsterId) {
  const q2 = { ...(S.quests || {}) };
  let touched = false;
  for (const q of QUESTS) {
    const rec = q2[q.id];
    if (!rec || rec.done) continue;
    const goal = q.goals.find(g => g.id === monsterId);
    if (!goal) continue;
    const cur = rec.prog?.[monsterId] || 0;
    if (cur >= goal.n) continue;
    q2[q.id] = { ...rec, prog: { ...rec.prog, [monsterId]: cur + 1 } };
    touched = true;
  }
  return touched ? q2 : null;
}

// ── 塔 ────────────────────────────────────
export { TOWERS, TOWER_LIST, BUFFS, ADV_JOBS, ADV_OF, ADV_LV, DANGER_CYCLE_MS };
export { MAP_DROP_RATE, MAP_SCROLL_RATE, ITEM_DROP_RATE };
export { drawWeakBuffs } from './tower';

export function towerRunsLeft(S, tid) {
  const T = TOWERS[tid];
  if (!T) return 0;
  const d = dayId();
  const rec = S.towerRuns?.[tid];
  if (!rec || rec.day !== d) return T.dailyRuns;
  return Math.max(0, T.dailyRuns - (rec.n || 0));
}

// 超王：每天限 2 次，跟塔的 towerRuns 是完全獨立的欄位，
// 答題重置、道具重置等現有的重置手段都只碰 towerRuns，摸不到這裡。
export const SUPERKING_DAILY = 2;
export function superKingLeft(S, id) {
  const d = dayId();
  const rec = S.superking?.[id];
  if (!rec || rec.day !== d) return SUPERKING_DAILY;
  return Math.max(0, SUPERKING_DAILY - (rec.n || 0));
}
// 進入戰鬥當下就記一次嘗試（不論輸贏），回傳要 patch 進存檔的物件
export function useSuperKingAttempt(S, id) {
  const d = dayId();
  const rec = S.superking?.[id];
  const n = (rec && rec.day === d) ? (rec.n || 0) + 1 : 1;
  return { superking: { ...(S.superking || {}), [id]: { day:d, n } } };
}

export function towerFloorFoe(tid, floor, seed) {
  const T = TOWERS[tid];
  const cfg = T.floors.find(f => f.f === floor);
  if (!cfg) return null;
  if (cfg.boss) return { ...cfg.boss, lv:cfg.lv, hp:cfg.hp, atk:cfg.atk, boss:true, kind:'boss', cfg };
  const rand = rng(seed + floor * 7717);
  const mob = T.mobs[Math.floor(rand() * T.mobs.length)];
  return { ...mob, lv:cfg.lv, hp:cfg.hp, atk:cfg.atk, boss:false, kind:'normal', cfg };
}

const _E = (L, m = 1) => Math.round(0.7 * Math.pow(L + 2, 1.2) * m);
const _G = (L, m = 1) => Math.round(1.2 * Math.pow(L + 2, 1.2) * m);
export const towerReward = (tid, f) => {
  const cfg = TOWERS[tid].floors.find(x => x.f === f);
  const m = (cfg.mult || 1) * 3;
  return { exp:_E(cfg.lv, m), gold:_G(cfg.lv, m) };
};

// ── 危險境地：每四小時重置 ──────────────
export const dangerCycle  = () => Math.floor(Date.now() / DANGER_CYCLE_MS);
export const msToDanger   = () => DANGER_CYCLE_MS - (Date.now() % DANGER_CYCLE_MS);

// ── 每日登入獎勵 ──────────────────────────
// 每日首次登入：經驗加倍券、心跳停止糖、章魚燒、遠征隊徽章 各一
export const DAILY_GIFT = { dbl:1, heartstop:1, takoyaki:1, badge:1 };
export function dailyBonus(S) {
  const d = dayId();
  if (S.lastLogin === d) return null;
  const bag = { ...S.bag };
  for (const [k, v] of Object.entries(DAILY_GIFT)) bag[k] = (bag[k] || 0) + v;
  return { lastLogin:d, bag };
}
export const DBL_MS = 5 * 60 * 1000;
export const dblLeft = S => Math.max(0, (S.dblUntil || 0) - Date.now());
export const dblActive = S => dblLeft(S) > 0;

// 抽增益：排除已持有的傳說、以及會變廢牌的選項
export function drawBuffs(S, floor, owned, count = 2) {
  const row = BUFF_ODDS.find(r => floor <= r.upTo) || BUFF_ODDS[BUFF_ODDS.length - 1];
  const dead = new Set();
  for (const id of owned) for (const x of (BUFF_EXCLUDE[id] || [])) dead.add(x);
  const hasLegend = owned.some(id => BUFFS.find(b => b.id === id)?.tier === 3);

  const pool = BUFFS.filter(b => {
    if (dead.has(b.id)) return false;
    if (b.tier === 3 && (hasLegend || owned.includes(b.id))) return false;
    return true;
  });

  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    let r = Math.random() * 100, tier = 1;
    for (let t = 0; t < 3; t++) { r -= row.w[t]; if (r <= 0) { tier = t + 1; break; } }
    let cand = pool.filter(b => b.tier === tier && !out.includes(b));
    if (!cand.length) cand = pool.filter(b => !out.includes(b));
    if (!cand.length) break;
    out.push(cand[Math.floor(Math.random() * cand.length)]);
  }
  return out;
}

// 增益效果加總（全部加法）
export function sumBuffs(ids) {
  const acc = {};
  for (const id of ids) {
    const b = BUFFS.find(x => x.id === id);
    if (!b) continue;
    for (const [k, v] of Object.entries(b.eff)) acc[k] = (acc[k] || 0) + v;
  }
  return acc;
}

// ── 兌換碼 ────────────────────────────────
export function redeem(S, raw) {
  const raw2 = String(raw || '').trim();
  // 英數碼不分大小寫，中文碼原樣比對
  const code = CODES[raw2] ? raw2 : raw2.toUpperCase();
  if (!code) return { ok:false, msg:'請輸入兌換碼' };
  const def = CODES[code];
  if (!def) return { ok:false, msg:'查無此兌換碼' };
  if (!def.repeat && (S.codes || []).includes(code)) return { ok:false, msg:'此兌換碼已使用過' };
  return { ok:true, code, def, msg:def.msg };
}

// ── 初始存檔 ──────────────────────────────
// 預設帳號：首次以這些 ID 登入時套用初始設定
export const PRESETS = {
  '牛來': { lv: 20, gold: 10000 },
};

export function newSave(playerId) {
  const preset = PRESETS[String(playerId).trim()] || null;
  const base = {
    v: 2,
    playerId,
    lv: 1, exp: 0, gold: 20,
    hp: maxHp(1), mp: maxMp(1),
    job: null,
    tree: {},
    equip: { weapon:null, top:null, helm:null, acc:null },
    bagGear: [],
    bag: { hp_s: 2 },
    scrolls: {},
    charm: 0,
    cycle: cycleId(),
    killed: {},              // { mapId: [key,...] }
    quests: {},
    codes: [],
    quiz: [],                // 已作答的題號
    quizVersion: '',         // 對應的題庫版本，題庫換版時用來判斷要不要清空 quiz
    quizLeft: 50,
    towerRuns: {},           // { wushu:{day,n}, sky:{day,n} }
    superking: {},           // { bear70:{day,n}, lion90:{day,n} } — 每天限 2 次，不受任何重置影響
    towerBest: {},           // { wushu:12, sky:8 }
    advJob: null,            // 二轉分支
    lastLogin: 0,
    dblUntil: 0,             // 經驗加倍券到期時間
    megaExpActive: false, megaExpLv: 0,   // 十倍經驗卷：生效中就是 true，升級後自動視為消耗
    hotel: {},               // 雨夜旅館：{ started, done, ending, scene, flags } 一旦 started 就永久鎖定
    boost: {},               // { heartstop: 到期時間, takoyaki: 到期時間 }
    badgeArmed: 0,           // 已啟用、等待下一隻大型 BOSS 的遠征隊徽章數
    dangerCycle: 0,
    dangerKilled: [],
    hideQuests: [],          // 任務隱藏清單
    stat: { kills:0, deaths:0, center:0, best:0, good:0, normal:0, miss:0 },
    createdAt: Date.now(),
  };
  if (preset) {
    Object.assign(base, preset);
    base.hp = maxHp(base.lv);
    base.mp = maxMp(base.lv);
  }
  return base;
}

export const mapOf = id => MAPS.find(m => m.id === id);

// 每日重置任務：已完成的隔天可再接，e3（鋼鐵人）永久保留
export const PERMANENT_QUESTS = ['e3'];
export function resetDailyQuests(S) {
  const d = dayId();
  const q = S.quests || {};
  let touched = false;
  const out = {};
  for (const [id, rec] of Object.entries(q)) {
    if (rec.done && !PERMANENT_QUESTS.includes(id) && rec.doneDay !== d) { touched = true; continue; }
    out[id] = rec;
  }
  return touched ? out : null;
}
