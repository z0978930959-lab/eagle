// ── 無處鎮（Nowhere）· LV100–120 新世界 ──────────────
// 路徑：foshan/lib/nowhere.js
//
// 這一階的怪物數值「直接寫死」，不走 maps2.js 的 mk()。
// 原因：mk() 假設 100 等玩家攻擊力 102，但實際單擊已達 2263，差 22 倍，
//       套公式的話普怪只有 352 血，一刀打六隻份。

export const NOWHERE_MAP = 'nowhere';

/* ── 怪物 ────────────────────────────────
   這一階全部不掉裝備（dropGear 一律 0）。
   玩家 LV100 單擊約 900（普通）～2263（中心），平均約 1300，以此回推刀數。 */
export const NOWHERE = [
  { id:'alienchick', name:'外星雞',            lv:100, img:'/nowhere/m100.png', pos:[10,14], count:30,
    hp:5200,  atk:420,  def:60,  exp:4800,   gold:2600 },
  { id:'fred',       name:'弗瑞德',            lv:103, img:'/nowhere/m103.png', pos:[32,10], count:30,
    hp:6100,  atk:470,  def:68,  exp:5400,   gold:2900 },
  { id:'stitchsis',  name:'史蒂奇姐妹花',       lv:106, img:'/nowhere/m106.png', pos:[54,14], count:28,
    hp:7200,  atk:520,  def:76,  exp:6200,   gold:3300 },
  { id:'puddlewitch',name:'水坑魔女',          lv:109, img:'/nowhere/m109.png', pos:[76,10], count:26,
    hp:8500,  atk:580,  def:84,  exp:7100,   gold:3700 },
  { id:'magicpie',   name:'魔幻餡餅',          lv:112, img:'/nowhere/m112.png', pos:[16,44], count:24,
    hp:10000, atk:640,  def:92,  exp:8200,   gold:4200 },
  { id:'duckdoctor', name:'殘酷Q·恐怖鴨博士',  lv:115, img:'/nowhere/m115.png', pos:[40,48], count:22,
    hp:12000, atk:710,  def:100, exp:9500,   gold:4800 },

  { id:'eggplant',   name:'菁英 · 茄子',        lv:110, img:'/nowhere/e110.png', pos:[64,44], count:10, kind:'elite',
    hp:26000, atk:900,  def:130, exp:24000,  gold:14000, dropScroll:0.16, skill:'poison',
    mechanic:{ type:'rps', every:5, punishPct:0.35, warn:'它們開始用聽不懂的語言交談。' } },
  { id:'foxelite',   name:'菁英 · 狐狸',        lv:118, img:'/nowhere/e118.png', pos:[86,50], count:10, kind:'elite',
    hp:38000, atk:1150, def:155, exp:34000,  gold:19000, dropScroll:0.16, skill:'sneak',
    mechanic:{ type:'dmgCheck', every:6, pct:0.030, punishPct:0.45, warn:'牠笑了。你不確定那是不是笑。' } },

  { id:'slabgolem',  name:'石板怪',            lv:120, img:'/nowhere/b120.png', pos:[48,80], count:1, kind:'boss',
    hp:140000, atk:1900, def:190, exp:160000, gold:90000, dropScroll:4,
    mechanic:{ type:'dmgCheck', every:4, pct:0.035, punishPct:0.70, warn:'石板上的字開始重新排列。' } },
];
for (const m of NOWHERE) {
  m.map = NOWHERE_MAP;
  m.kind = m.kind || 'normal';
  m.dropGear = 0;          // 這一階不掉裝備
  m.noGear = true;
}

/* ── 寵物 ────────────────────────────────
   T1–T3：只有固定的機制副效果，沒有任何傷害加成。顏色只是外觀。
   T4  ：唯一有傷害倍率的寵物，數值依顏色浮動，打 BOSS 時減半。 */
export const PETS = {
  eggplantHero: { id:'eggplantHero', tier:1, name:'茄子英雄',   img:'/nowhere/pet_eggplant.png',
    desc:'每回合開始回復 2% 最大 HP', eff:{ regenPct:0.02 } },
  slabHero:     { id:'slabHero',     tier:2, name:'石板英雄',   img:'/nowhere/pet_slab.png',
    desc:'受到傷害 −8%；每場戰鬥首次致命傷必定抵擋', eff:{ dr:0.08, guard:1 } },
  murielHero:   { id:'murielHero',   tier:3, name:'茉莉兒英雄', img:'/nowhere/pet_muriel.png',
    desc:'中心判定 +1.5 格；回復藥效果 +25%', eff:{ centerUp:1.5, potion:0.25 } },
  babyHero:     { id:'babyHero',     tier:4, name:'寶貝英雄',   img:'/nowhere/pet_baby.png',
    desc:'上列三項各取一半；前三次中心判定追加一次同等傷害；傷害加成依顏色（對 BOSS 減半）',
    eff:{ regenPct:0.01, dr:0.04, guard:1, centerUp:0.75, potion:0.125, centerEcho:3 }, dmgPet:true },
};
export const PET_LIST = Object.values(PETS);
export const petOf = id => PETS[id];

/* ── 色階：灰 < 白 < 藍 < 橘 < 紅 < 彩 ────
   dmg 只對 T4 寶貝英雄生效；T1–T3 拿到什麼顏色都不影響數值。 */
export const COLORS = [
  { id:'gray',   name:'灰', hex:'#8d8d8d', rate:0.400, dmg:[0.03, 0.06] },
  { id:'white',  name:'白', hex:'#e6e3dc', rate:0.250, dmg:[0.07, 0.11] },
  { id:'blue',   name:'藍', hex:'#5b9bd5', rate:0.170, dmg:[0.12, 0.16] },
  { id:'orange', name:'橘', hex:'#e08a3c', rate:0.110, dmg:[0.17, 0.21] },
  { id:'red',    name:'紅', hex:'#d0453f', rate:0.055, dmg:[0.22, 0.26] },
  { id:'rainbow',name:'彩', hex:'#b06fd0', rate:0.015, dmg:[0.27, 0.30] },
];
export const colorOf = id => COLORS.find(c => c.id === id) || COLORS[0];
export const COLOR_ORDER = COLORS.map(c => c.id);
export const colorRank = id => COLOR_ORDER.indexOf(id);

/* 保底：累積兌換 20 次都沒出紅或彩，第 21 次保底彩色。
   沒有保底的話，彩色 1.5% 平均要做 67 天，運氣差的人會直接棄坑。 */
export const PITY_N = 20;
export const PITY_COLORS = ['red', 'rainbow'];

export function rollColor(minRank = 0) {
  const pool = COLORS.filter((_, i) => i >= minRank);
  const total = pool.reduce((s, c) => s + c.rate, 0);
  let r = Math.random() * total;
  for (const c of pool) { r -= c.rate; if (r <= 0) return c.id; }
  return pool[pool.length - 1].id;
}

/* 產生一隻寵物實例。T4 才會帶 dmg。 */
export function makePet(petId, colorId) {
  const p = PETS[petId];
  const c = colorOf(colorId);
  const inst = { uid: `${petId}_${Date.now().toString(36)}_${Math.floor(Math.random()*1e4)}`,
                 pid: petId, color: c.id };
  if (p.dmgPet) {
    const [lo, hi] = c.dmg;
    inst.dmg = Math.round((lo + Math.random() * (hi - lo)) * 1000) / 1000;
  }
  return inst;
}

/* 兌換：T1+T2+T3 各一 → 隨機顏色的寶貝英雄。含保底。 */
export function exchangeBaby(S) {
  const pity = S.petPity || 0;
  const forced = pity >= PITY_N;
  const color = forced ? 'rainbow' : rollColor();
  const hit = PITY_COLORS.includes(color);
  return { inst: makePet('babyHero', color), nextPity: (forced || hit) ? 0 : pity + 1, forced };
}

/* 裝備中的寵物效果。isBoss 時 T4 的傷害加成減半。 */
export function petEffect(S, isBoss = false) {
  const uid = S.petEquip;
  const inst = (S.pets || []).find(p => p.uid === uid);
  if (!inst) return null;
  const p = PETS[inst.pid];
  if (!p) return null;
  const dmg = inst.dmg ? (isBoss ? inst.dmg / 2 : inst.dmg) : 0;
  return { ...p.eff, dmg, inst, def: p };
}

export const petLabel = inst => {
  const p = PETS[inst.pid], c = colorOf(inst.color);
  return `${c.name}·${p.name}${inst.dmg ? `　傷害 +${(inst.dmg*100).toFixed(1)}%` : ''}`;
};
