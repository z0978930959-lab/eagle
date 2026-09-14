// 牛之谷 · 核心資料表
// 數值公式：一般怪 EXP = 2×(LV+2)^1.2　金幣 = 3×(LV+2)^1.2
// 倍率：精英 ×2.5　稀有 ×3　BOSS ×4

const E = (L, m = 1) => Math.round(0.7 * Math.pow(L + 2, 1.2) * m);
const G = (L, m = 1) => Math.round(1.2 * Math.pow(L + 2, 1.2) * m);
const R = { normal: 1, elite: 2.5, rare: 3, boss: 4 };

import { HELL, YAKUZA, SENGOKU, CHAOS, DANGER, SUPERKING } from './maps2';
import { NOWHERE } from './nowhere';

// ── 地圖 ──────────────────────────────────
export const MAPS = [
  { id:'foshan',  name:'佛山',     lvRange:'LV.1 ~ LV.15',  img:'/map_foshan.png',  open:true,
    desc:'一切開始的地方。' },
  { id:'endgame', name:'終局戰',   lvRange:'LV.15 ~ LV.30', img:'/map_endgame.png', open:true, reqLv:15,
    desc:'標準路線。數值穩定，適合穩紮穩打。' },
  { id:'haunted', name:'鬧鬼宅邸', lvRange:'LV.15 ~ LV.30', img:'/map_haunted.png', open:true, reqLv:15,
    mods:{ atk:1.5, exp:1.3, gold:1.5 },
    desc:'高風險路線。怪物攻擊 ×1.5，但經驗 ×1.3、金幣 ×1.5。' },
  { id:'hell',    name:'地獄',     lvRange:'LV.30 ~ LV.50', img:'/map_hell.png',    open:true, reqLv:30,
    desc:'但丁寫過的地方。怪物密集，經驗豐厚。' },
  { id:'yakuza',  name:'日本黑道', lvRange:'LV.50 ~ LV.60', img:'/map_yak.png',     open:true, reqLv:50,
    desc:'三隻 BOSS 不掉裝備，但金錢驚人。' },
  { id:'sengoku', name:'日本古代', lvRange:'LV.60 ~ LV.70', img:'/map_jp.png',      open:true, reqLv:60,
    desc:'戰國群雄。' },
  { id:'chaos',   name:'亂象之島', lvRange:'LV.70 ~ LV.100', img:'/map_lv70.png',   open:true, reqLv:70,
    desc:'現在的終點。一般怪也會掉裝備了，別漏過。' },
  { id:'danger',  name:'危險境地', lvRange:'無等級限制',    img:'/map_danger.png',  open:true, danger:true,
    desc:'四隻大型 BOSS，每四小時重置。沒有等級限制，但你最好有自知之明。' },
  { id:'hall',    name:'英雄榜',   lvRange:'—',             img:'/map_hall.png',    open:true, hall:true,
    desc:'等級排行榜。超過 2 等才會入榜。' },
  { id:'hotel',   name:'雨夜旅館', lvRange:'不限等級',       img:'/hotel/lobby.png', open:true, hotel:true,
    desc:'限定副本，只能挑戰一次，沒有任何重來的方式。' },
  { id:'nowhere', name:'無處鎮',   lvRange:'LV.100 ~ LV.120', img:'/nowhere/map.png', open:true, reqLv:100,
    desc:'什麼都沒有的地方。除了那隻狗。' },
  { id:'lastcar', name:'末班車',   lvRange:'不限等級',       img:'/lastcar/car.png', open:true, lastcar:true, escape:true,
    desc:'解謎副本，只能通關一次。' },
  { id:'echo',    name:'回聲',     lvRange:'不限等級',       img:'/echo/exterior.png', open:true, echo:true, escape:true,
    desc:'解謎副本，只能通關一次。' },
  { id:'tower',   name:'競技塔',   lvRange:'LV.10 ~',       img:'/map_tower.png',   open:true, reqLv:10, tower:true,
    desc:'武術之塔與天空競技場。每日各 2 次。' },
];

// ── 怪物 ──────────────────────────────────
// pos 為地圖上的散布座標（百分比），count 為每輪出現數量
export const MONSTERS = [
  // 佛山 LV1-15
  { id:'liao_weak', map:'foshan', name:'廖師傅（虛弱）', lv:1,  hp:13,  atk:2,  img:'/mon/liao_weak.png',  pos:[8,12],  count:36 },
  { id:'liao',      map:'foshan', name:'廖師傅',        lv:3,  hp:18,  atk:5,  img:'/mon/liao.png',       pos:[24,10], count:30 },
  { id:'lin',       map:'foshan', name:'武癡林',        lv:5,  hp:17,  atk:20, img:'/mon/lin.png',        pos:[72,8],  count:36 },
  { id:'dog',       map:'foshan', name:'日本走狗',      lv:7,  hp:30,  atk:19, img:'/mon/dog.png',        pos:[86,26], count:36 },
  { id:'jiapian',   map:'foshan', name:'甲片逆斯',      lv:8,  hp:34,  atk:21, img:'/mon/jiapian.png',    pos:[10,46], count:42 },
  { id:'twister',   map:'foshan', name:'龍捲風',        lv:10, hp:103, atk:28, img:'/mon/twister.png',    pos:[45,42], count:1, kind:'boss', skill:'sneak', dropScroll:0.20 },
  { id:'translator',map:'foshan', name:'翻譯員',        lv:11, hp:52,  atk:26, img:'/mon/translator.png', pos:[30,66], count:36 },
  { id:'tseng',     map:'foshan', name:'曾國城',        lv:12, hp:22,  atk:7,  img:'/mon/tseng.png',      pos:[62,60], count:1,
    kind:'rare', special:'cycle4h', noDrop:true, noDecay:true, expPct:0.07 },
  { id:'jinshan',   map:'foshan', name:'金山找',        lv:13, hp:116, atk:32, img:'/mon/jinshan.png',    pos:[82,70], count:12, kind:'elite', dropScroll:0.10 },
  { id:'hung',      map:'foshan', name:'洪師傅',        lv:15, hp:177, atk:39, img:'/mon/hung.png',       pos:[18,80], count:1, kind:'boss', skill:'gasp', dropScroll:0.30 },

  // 終局戰 LV15-30（標準路線）
  { id:'whip',   map:'endgame', name:'閃電鞭',   lv:15, hp:190, atk:40, img:'/ea/m4.png',    pos:[10,14], count:42 },
  { id:'maw',    map:'endgame', name:'烏木喉',   lv:18, hp:250, atk:48, img:'/ea/m2.png',    pos:[34,12], count:42 },
  { id:'myst',   map:'endgame', name:'神秘客',   lv:21, hp:320, atk:56, img:'/ea/m3.png',    pos:[62,16], count:42 },
  { id:'dorm',   map:'endgame', name:'多瑪母',   lv:24, hp:400, atk:65, img:'/ea/m1.png',    pos:[86,30], count:36 },
  { id:'witch',  map:'endgame', name:'黑化女巫', lv:26, hp:620, atk:78, img:'/ea/elite.png', pos:[16,52], count:12, kind:'elite', dropScroll:0.12 },
  { id:'ultron', map:'endgame', name:'奧創',     lv:27, hp:490, atk:74, img:'/ea/m5.png',    pos:[44,58], count:36 },
  { id:'hela',   map:'endgame', name:'海拉',     lv:30, hp:590, atk:84, img:'/ea/m6.png',    pos:[70,72], count:30 },
  { id:'thanos', map:'endgame', name:'薩諾斯',   lv:30, hp:1770,atk:126,img:'/ea/boss.png',  pos:[38,84], count:1, kind:'boss', skill:'snap', dropGear:0.60, dropScroll:2 },

  // 鬧鬼宅邸 LV15-30（高風險路線）
  { id:'evildoll', map:'haunted', name:'邪惡娃娃', lv:15, hp:190, atk:40, img:'/hh/m1.png',    pos:[12,14], count:42 },
  { id:'voodoo',   map:'haunted', name:'巫毒娃娃', lv:18, hp:250, atk:48, img:'/hh/m2.png',    pos:[38,10], count:42 },
  { id:'clown',    map:'haunted', name:'邪惡小丑', lv:21, hp:320, atk:56, img:'/hh/m5.png',    pos:[66,18], count:42 },
  { id:'ghost',    map:'haunted', name:'幽靈',     lv:24, hp:400, atk:65, img:'/hh/m3.png',    pos:[88,34], count:36 },
  { id:'hellmare', map:'haunted', name:'地獄馬',   lv:26, hp:620, atk:78, img:'/hh/elite.png', pos:[14,54], count:12, kind:'elite', dropScroll:0.12 },
  { id:'glutton',  map:'haunted', name:'貪吃鬼',   lv:27, hp:490, atk:74, img:'/hh/m4.png',    pos:[46,60], count:36 },
  { id:'headless', map:'haunted', name:'無頭騎士', lv:30, hp:590, atk:84, img:'/hh/m6.png',    pos:[74,70], count:30 },
  { id:'niulai',   map:'haunted', name:'牛來（初階）', lv:30, hp:2360, atk:168, img:'/hh/boss.png', pos:[36,86], count:1, kind:'boss', skill:'curse', dropGear:1.0, dropGearBonus:1, dropScroll:3 },
];

// 併入第二批地圖
for (const [arr, map] of [[HELL,'hell'],[YAKUZA,'yakuza'],[SENGOKU,'sengoku'],[CHAOS,'chaos']])
  for (const m of arr) MONSTERS.push({ ...m, map });

// 無處鎮：數值寫死，不套 mk()，也不受新世界倍率影響
for (const m of NOWHERE) MONSTERS.push({ ...m });

// 危險境地的大型 BOSS
for (const b of DANGER) MONSTERS.push({ ...b, map:'danger', count:1, pos:[0,0] });
for (const b of SUPERKING) MONSTERS.push({ ...b, map:'danger', count:1, pos:[0,0] });

// 抽菸的曾國城：英雄榜彩蛋
MONSTERS.push({ id:'tseng_smoke', map:'hall', name:'抽菸的曾國城', lv:1,
  hp:1, atk:0, img:'/mon/tseng_smoke.png', pos:[50,55], count:1,
  kind:'normal', hallRare:0.25, noDrop:true, expPct:0.10, noDecay:true, def:0 });

// ── 新世界倍率（LV100+）────────────────────
// 舊地圖一律排除：亂象之島的 100 等 BOSS 還綁在 chaos3 任務上，套下去會打不動。
// 無處鎮也排除，因為它的數值是寫死的，不需要再乘。
export const NW_LV     = 100;
export const NW_HP_X   = 6;
export const NW_ATK_X  = 1.8;
export const NW_EXP_X  = 20;
export const NW_GOLD_X = 5;
const SKIP_MAPS = ['foshan','hell','yakuza','sengoku','chaos','danger','hall','nowhere'];

// 自動補上經驗與金幣（依公式，地圖倍率在戰鬥時再套用）
for (const m of MONSTERS) {
  const mult = R[m.kind || 'normal'];
  if (m.def  === undefined)
    m.def = Math.max(0, Math.round(m.lv * (m.kind === 'boss' ? 0.85 : m.kind === 'elite' ? 0.7 : 0.5)));
  if (m.exp  === undefined) m.exp  = E(m.lv, mult);
  if (m.gold === undefined) m.gold = G(m.lv, mult) * (m.goldMult || 1);
  m.kind = m.kind || 'normal';

  if (m.lv >= NW_LV && !SKIP_MAPS.includes(m.map)) {
    m.hp   = Math.round(m.hp   * NW_HP_X);
    m.atk  = Math.round(m.atk  * NW_ATK_X);
    m.exp  = Math.round(m.exp  * NW_EXP_X);
    m.gold = Math.round(m.gold * NW_GOLD_X);
  }
}

// ── 消耗品 ────────────────────────────────
export const POTIONS = [
  { id:'hp_s', name:'小回復藥', price:100, kind:'hp',  val:100,    img:'/item/hp_s.png' },
  { id:'hp_m', name:'中回復藥', price:300, kind:'hp',  val:300,    img:'/item/hp_m.png' },
  { id:'hp_l', name:'大回復藥', price:500, kind:'hp',  val:500,    img:'/item/hp_l.png' },
  { id:'mp',   name:'魔力藥',   price:200, kind:'mp',  val:'full', img:'/item/mp.png' },
  { id:'exp',  name:'經驗符',   price:900, kind:'exp', val:10,     img:'/item/exp.png', noShop:true,
    note:'接下來 10 隻怪經驗 +10%。' },
  { id:'reset',name:'忘卻藥水', price:450, kind:'reset',           img:'/item/reset.png' },
  { id:'dbl',  name:'經驗加倍券', price:0, kind:'dbl', val:300,     img:'/item/dbl.png', noShop:true },
  { id:'megaExp', name:'十倍經驗卷', price:0, kind:'megaExp', img:'/item/megaExp.png', noShop:true,
    note:'使用後經驗 ×10，直到下一次升級才會消耗掉，登出、切分頁都不會中斷。同時只能有一張生效中，' +
         '手上有多張的話，這張的效果結束（升級）之後才能用下一張。只有雨夜旅館的通關獎勵會給。' },
  { id:'shard',name:'時光碎片',   price:50000, kind:'shard', need:5,  img:'/item/shard.png',
    note:'集滿 5 個可立即刷新「所有地圖」的怪物，不必等循環。所有怪物 0.4% 機率掉落（約 250 隻掉 1 個）。' },

  // ── 食物增益（30 分鐘，攻擊力加成，全部可疊加）──
  { id:'heartstop', name:'心跳停止糖', price:200000, kind:'boost', val:150, img:'/item/heartstop.png',
    note:'30 分鐘內攻擊力 +150。可與章魚燒、經驗加倍券、能力樹、裝備等所有增益同時生效，效果直接相加。' +
         '所有怪物 0.5% 機率掉落。重複使用會重新計時，不會延長。' },
  { id:'takoyaki',  name:'章魚燒',     price:50000,  kind:'boost', val:100, img:'/item/takoyaki.png',
    note:'30 分鐘內攻擊力 +100。可與心跳停止糖、經驗加倍券、能力樹、裝備等所有增益同時生效，效果直接相加。' +
         '所有怪物 0.8% 機率掉落。重複使用會重新計時，不會延長。' },

  // ── 遠征隊徽章 ──
  { id:'badge', name:'遠征隊徽章', price:0, kind:'badge', img:'/item/badge.png', noShop:true,
    note:'使用後待命。進入下一場「大型 BOSS」（危險境地）戰鬥時自動消耗：你的傷害 +40%，對方傷害 −20%。' +
         '只對大型 BOSS 生效，一般 BOSS 不會消耗。' },
];

// 全怪物共通掉落（獨立判定，互不影響）。rateBoss 套用在 BOSS／大型BOSS／超王身上。
export const FOOD_DROP = [
  { id:'heartstop', rate:0.005, rateBoss:0.015 },
  { id:'takoyaki',  rate:0.008, rateBoss:0.018 },
];

// ── 裝備 ──────────────────────────────────
export const SLOTS = [
  { id:'weapon', name:'武器' },
  { id:'top',    name:'上衣' },
  { id:'helm',   name:'頭盔' },
  { id:'acc',    name:'飾品' },
  { id:'ring',   name:'戒指' },
];

export const GEAR = [
  // 階 I · LV1 · 商店
  { id:'woodblade', name:'木刀',     slot:'weapon', tier:1, reqLv:1,  price:280,  atk:2,  def:0,  slots:3, pierce:0, source:'shop', img:'/item/woodblade.png' },
  { id:'cloth',     name:'布衣',     slot:'top',    tier:1, reqLv:1,  price:240,  atk:0,  def:2,  slots:3, source:'shop', img:'/item/cloth.png' },
  { id:'scarf',     name:'頭巾',     slot:'helm',   tier:1, reqLv:1,  price:160,  atk:0,  def:1,  slots:3, source:'shop', img:'/item/scarf.png' },
  { id:'wrist',     name:'護腕',     slot:'acc',    tier:1, reqLv:1,  price:200,  atk:1,  def:1,  slots:3, pierce:0, source:'shop', img:'/item/wrist.png' },

  // 階 II · LV10 · 商店
  { id:'blade',     name:'刀',       slot:'weapon', tier:2, reqLv:10, price:1480, atk:6,  def:0,  slots:3, pierce:1, source:'shop', img:'/item/blade.png' },
  { id:'dummy',     name:'詠春木樁', slot:'top',    tier:2, reqLv:10, price:1300, atk:2,  def:4,  slots:3, source:'shop', img:'/item/dummy.png' },
  { id:'cap',       name:'皮帽',     slot:'helm',   tier:2, reqLv:10, price:880,  atk:0,  def:3,  slots:3, source:'shop', img:'/item/cap.png' },
  { id:'jade',      name:'玉珮',     slot:'acc',    tier:2, reqLv:10, price:1060, atk:3,  def:2,  slots:3, pierce:1, source:'shop', img:'/item/jade.png' },

  // 階 III · LV20 · 商店
  { id:'shield',    name:'刀盾',     slot:'weapon', tier:3, reqLv:20, price:3050, atk:13, def:2,  slots:3, pierce:3, source:'shop', img:'/item/shield.png' },
  { id:'angel',     name:'守護天使', slot:'top',    tier:3, reqLv:20, price:2680, atk:4,  def:10, slots:3, source:'shop', img:'/item/angel.png' },
  { id:'ironhelm',  name:'鐵盔',     slot:'helm',   tier:3, reqLv:20, price:1830, atk:0,  def:7,  slots:3, source:'shop', img:'/item/ironhelm.png' },
  { id:'goldchain', name:'金鍊',     slot:'acc',    tier:3, reqLv:20, price:2200, atk:7,  def:3,  slots:3, pierce:2, source:'shop', img:'/item/goldchain.png' },

  // 階 III 稀有 · LV20 · 塔
  { id:'wcblade',    name:'詠春樁刀', slot:'weapon', tier:3, reqLv:20, atk:21, def:3,  slots:5, pierce:5, source:'tower', perk:'centerUp',  img:'/item/wcblade.png' },
  { id:'softarmor',  name:'護體軟甲', slot:'top',    tier:3, reqLv:20, atk:6,  def:16, slots:5, source:'tower', perk:'guard',     img:'/item/softarmor.png' },
  { id:'dragonhelm', name:'龍紋盔',   slot:'helm',   tier:3, reqLv:20, atk:3,  def:12, slots:5, source:'tower', perk:'mpRegen',   img:'/item/dragonhelm.png' },
  { id:'bloodjade',  name:'血玉扳指', slot:'acc',    tier:3, reqLv:20, atk:8,  def:5,  slots:5, pierce:3, source:'tower', perk:'greed',     img:'/item/bloodjade.png' },

  // 任務獎勵 · LV30 稀有飾品
  { id:'stark', name:'史塔克集團', slot:'acc', tier:4, reqLv:30, atk:12, def:6, slots:5, pierce:4, source:'quest', perk:'greed', img:'/item/stark.png' },

  // 階 IV · LV35 · 塔
  { id:'endless',   name:'無盡之刃', slot:'weapon', tier:4, reqLv:35, atk:38, def:0,  slots:5, pierce:9, source:'tower', perk:'critUp',  img:'/item/endless.png' },
  { id:'silkarmor', name:'金絲軟甲', slot:'top',    tier:4, reqLv:35, atk:10, def:28, slots:5, source:'tower', perk:'guard',   img:'/item/silkarmor.png' },
  { id:'crown',     name:'鎮山冠',   slot:'helm',   tier:4, reqLv:35, atk:5,  def:20, slots:5, source:'tower', perk:'cdDown',  img:'/item/crown.png' },
  { id:'qilin',     name:'麒麟玉',   slot:'acc',    tier:4, reqLv:35, atk:14, def:8,  slots:5, pierce:6, source:'tower', perk:'mpRegen', img:'/item/qilin.png' },

  // 階 V · LV50 · 塔
  { id:'maple',    name:'楓之劍', slot:'weapon', tier:5, reqLv:50, atk:45, def:20, slots:5, pierce:13, source:'tower', perk:'centerUp', img:'/item/maple.png' },
  { id:'godarmor', name:'金鐘罩', slot:'top',    tier:5, reqLv:50, atk:16, def:40, slots:5, source:'tower', perk:'guard',    img:'/item/godarmor.png' },
  { id:'skyhelm',  name:'凌雲冠', slot:'helm',   tier:5, reqLv:50, atk:9,  def:28, slots:5, source:'tower', perk:'cdDown',   img:'/item/skyhelm.png' },
  { id:'phoenix',  name:'鳳凰佩', slot:'acc',    tier:5, reqLv:50, atk:22, def:14, slots:5, pierce:9, source:'tower', perk:'critUp',   img:'/item/phoenix.png' },

  // 階 VI · LV60 · 塔／地圖掉落
  { id:'muramasa', name:'村正',     slot:'weapon', tier:6, reqLv:60, atk:62, def:0,  slots:5, pierce:17, source:'tower', perk:'critUp',   img:'/item/muramasa.png' },
  { id:'gusoku',   name:'當世具足', slot:'top',    tier:6, reqLv:60, atk:22, def:54, slots:5, source:'tower', perk:'guard',    img:'/item/gusoku.png' },
  { id:'kabuto',   name:'鐵兜',     slot:'helm',   tier:6, reqLv:60, atk:12, def:40, slots:5, source:'tower', perk:'cdDown',   img:'/item/kabuto.png' },
  { id:'magatama', name:'勾玉',     slot:'acc',    tier:6, reqLv:60, atk:30, def:18, slots:5, pierce:11, source:'tower', perk:'mpRegen',  img:'/item/magatama.png' },

  // 階 VII · LV70 · 三神器
  { id:'kusanagi', name:'天叢雲劍',   slot:'weapon', tier:7, reqLv:70, atk:82, def:12, slots:5, pierce:24, source:'tower', perk:'centerUp', img:'/item/kusanagi.png' },
  { id:'ooyoroi',  name:'大鎧',       slot:'top',    tier:7, reqLv:70, atk:28, def:72, slots:5, source:'tower', perk:'guard',    img:'/item/ooyoroi.png' },
  { id:'onimen',   name:'鬼面兜',     slot:'helm',   tier:7, reqLv:70, atk:18, def:52, slots:5, source:'tower', perk:'critUp',   img:'/item/onimen.png' },
  { id:'yasakani', name:'八尺瓊勾玉', slot:'acc',    tier:7, reqLv:70, atk:40, def:24, slots:5, pierce:15, source:'tower', perk:'greed',    img:'/item/yasakani.png' },

  // 階 VIII～X · 任務「任選一」專屬（白字固定值，不走一般卷軸強化）
  { id:'exposer',    name:'檢舉魂',     slot:'weapon', tier:8, reqLv:70,  atk:96,  def:0,   slots:5, pierce:28, source:'quest', perk:'centerUp', img:'/item/exposer.png' },
  { id:'wingrobe',   name:'側翼戰袍',   slot:'top',    tier:8, reqLv:70,  atk:6,   def:84,  slots:5, source:'quest', perk:'guard',    img:'/item/wingrobe.png' },
  { id:'trollhelm',  name:'網軍頭盔',   slot:'helm',   tier:8, reqLv:70,  atk:4,   def:60,  slots:5, source:'quest', perk:'cdDown',   img:'/item/trollhelm.png' },
  { id:'cogwar',     name:'認知作戰徽', slot:'acc',    tier:8, reqLv:70,  atk:46,  def:10,  slots:5, pierce:18, source:'quest', perk:'greed', img:'/item/cogwar.png' },

  { id:'throatcut',  name:'割喉刀',     slot:'weapon', tier:9, reqLv:85,  atk:118, def:0,   slots:5, pierce:34, source:'quest', perk:'centerUp', img:'/item/throatcut.png' },
  { id:'demoarmor',  name:'民主聖鎧',   slot:'top',    tier:9, reqLv:85,  atk:8,   def:102, slots:5, source:'quest', perk:'guard',    img:'/item/demoarmor.png' },
  { id:'awakenhat',  name:'覺醒帽',     slot:'helm',   tier:9, reqLv:85,  atk:5,   def:74,  slots:5, source:'quest', perk:'cdDown',   img:'/item/awakenhat.png' },
  { id:'wingmedal',  name:'側翼勳章',   slot:'acc',    tier:9, reqLv:85,  atk:56,  def:14,  slots:5, pierce:22, source:'quest', perk:'greed', img:'/item/wingmedal.png' },

  { id:'godmaker',   name:'造神杖',     slot:'weapon', tier:10, reqLv:100, atk:145, def:0,   slots:5, pierce:42, source:'quest', perk:'centerUp', img:'/item/godmaker.png' },
  { id:'tabletrobe', name:'神主牌戰袍', slot:'top',    tier:10, reqLv:100, atk:10,  def:126, slots:5, source:'quest', perk:'guard',    img:'/item/tabletrobe.png' },
  { id:'chosencrown',name:'天選頭冠',   slot:'helm',   tier:10, reqLv:100, atk:6,   def:92,  slots:5, source:'quest', perk:'cdDown',   img:'/item/chosencrown.png' },
  { id:'petbadge',   name:'護航徽章',   slot:'acc',    tier:10, reqLv:100, atk:70,  def:18,  slots:5, pierce:28, source:'quest', perk:'greed', img:'/item/petbadge.png' },

  // 戒指：超王專屬掉落，主打持續回血，其他部位目前沒人管這塊
  { id:'ring70', name:'黃金戒指', slot:'ring', tier:8,  reqLv:70, atk:20, def:10, hp:220, slots:5, pierce:8,  source:'superking', perk:'vitality', img:'/item/ring70.png' },
  { id:'ring90', name:'奇幻戒指', slot:'ring', tier:9,  reqLv:90, atk:28, def:14, hp:320, slots:5, pierce:12, source:'superking', perk:'vitality', img:'/item/ring90.png' },

  // 傳說中的逸品：只能用買的，絕對不能出現在任何掉落池
  { id:'dream', name:'夢幻逸品', slot:'weapon', tier:7, reqLv:1, price:23000000, atk:1000, def:0, slots:5, pierce:99, source:'shop', noDrop:true,
    img:'/item/dream.png', note:'傳說中的逸品。看看就好。' },
];

export const PERKS = {
  centerUp: { name:'中心區 +1 格' },
  guard:    { name:'每回合首次受傷 −20%' },
  mpRegen:  { name:'MISS 回復 5 MP' },
  greed:    { name:'金幣掉落 +25%' },
  critUp:   { name:'中心傷害 +15%' },
  cdDown:   { name:'技能冷卻 −1 回合' },
  vitality: { name:'每回合開始回復 3% 最大 HP' },
};

// ── 裝備品質（塔掉落）──────────────────────
export const QUALITY = [
  { id:'gray',   name:'灰',   color:'#8f8a7d', min:-2, max:0 },
  { id:'white',  name:'白',   color:'#e9e4d7', min:-1, max:1 },
  { id:'blue',   name:'藍',   color:'#5b8fd4', min:1,  max:2 },
  { id:'orange', name:'橘',   color:'#d98b3a', min:2,  max:3 },
  { id:'red',    name:'紅',   color:'#b5372f', min:3,  max:4 },
  { id:'rainbow',name:'彩',   color:'#c8a24a', min:5,  max:5 },
];

// 依樓層加權的品質機率（塔專用）
export const QUALITY_ODDS = [
  { upTo:5,   w:[46,33,15,5,0.9,0.1] },
  { upTo:10,  w:[36,32,21,8,2.5,0.5] },
  { upTo:999, w:[26,30,26,13,4,1] },
];

// 地圖怪物掉裝備的品質機率，依怪物種類分四張表（灰/白/藍/橘/紅/彩）
export const MAP_QUALITY_ODDS = {
  normal:  [30, 40, 20, 10, 0, 0],
  elite:   [25, 40, 20, 10, 5, 0],
  boss:    [25, 40, 15, 10, 5, 5],
  bigboss: [10, 30, 25, 20, 10, 5],
  ring:    [25, 40, 15, 10, 5, 5],   // 戒指專用（超王掉落）
};

// 掉落機率（不是品質，是「會不會掉」）：全部除地獄、塔、超王
export const MAP_DROP_RATE = {
  normal: 0.005, elite: 0.03, boss: 0.05, bigboss: 0.10,
};
// 卷軸：一般卷軸（不含神王卷軸），一樣除地獄、塔、超王
export const MAP_SCROLL_RATE = {
  normal: 0.01, elite: 0.03, boss: 0.10, bigboss: 0.20,
};
// 基本道具：經驗符／時光碎片／HP-MP藥水，除地獄、塔（心跳停止糖/章魚燒另見 FOOD_DROP）
export const ITEM_DROP_RATE = {
  charm:     { normal:0.0015, boss:0.006 },
  shard:     { normal:0.004, boss:0.008 },
  potion:    { normal:0.10, boss:0.30 },
};

// ── 卷軸：加成 = ceil(裝備基礎值 × 係數) ──────
const SC_TIER = [
  { t:1, label:'初級', gearTier:[1,2] },
  { t:2, label:'中級', gearTier:[3,4] },
  { t:3, label:'高級', gearTier:[5,6,7] },
];
const SC_RATE = [
  { k:0, rate:1.0, tag:'100%', ratio:0.08, img:'/item/sc100.png' },
  { k:1, rate:0.6, tag:'60%',  ratio:0.16, img:'/item/sc60.png' },
  { k:2, rate:0.3, tag:'30%',  ratio:0.32, img:'/item/sc30.png' },
  { k:3, rate:0.5, tag:'賭鬼', ratio:0.26, img:'/item/scG.png', destroy:true },
];
const SC_STAT = {
  atk:    { name:'攻擊', slots:['weapon','acc'] },
  def:    { name:'防禦', slots:['top','helm','acc'] },
  hp:     { name:'生命', slots:['top','helm'], hpScale:4 },
  pierce: { name:'穿透', slots:['weapon','acc'], pScale:0.5 },
};

// 卷軸屬性的顯示名稱
export const STAT_NAME = { atk:'攻擊', def:'防禦', hp:'生命', pierce:'穿透', dmgPct:'總傷害輸出' };

// 神王卷軸：超王專屬掉落，只能用在武器，跟一般攻擊/穿透卷軸共用武器的衝捲次數上限。
// 成功率越低、效果越大；失敗只是浪費一次衝捲次數，不會摔裝備。
export const GOD_SCROLLS = [
  { id:'god_low',  name:'神王卷軸・下', stat:'dmgPct', rate:0.50, fixedVal:0.03,
    slots:['weapon'], gearTier:[1,2,3,4,5,6,7,8,9,10], destroy:false, img:'/item/scroll_god.png' },
  { id:'god_mid',  name:'神王卷軸・中', stat:'dmgPct', rate:0.30, fixedVal:0.06,
    slots:['weapon'], gearTier:[1,2,3,4,5,6,7,8,9,10], destroy:false, img:'/item/scroll_god.png' },
  { id:'god_high', name:'神王卷軸・上', stat:'dmgPct', rate:0.10, fixedVal:0.20,
    slots:['weapon'], gearTier:[1,2,3,4,5,6,7,8,9,10], destroy:false, img:'/item/scroll_god.png' },
];

export const SCROLLS = SC_TIER.flatMap(t =>
  Object.entries(SC_STAT).flatMap(([stat, si]) =>
    SC_RATE.map(r => ({
      id: `${stat}${t.t}_${r.k}`,
      name: `${t.label}${si.name}卷軸 ${r.tag}`,
      rate: r.rate,
      stat,
      ratio: r.ratio * (si.hpScale || si.pScale || 1),
      minVal: stat === 'hp' ? 4 : 1,
      tier: t.t,
      gearTier: t.gearTier,
      slots: si.slots,
      destroy: r.destroy || false,
      img: r.img,
    }))
  )
);

// ── 職業與技能 ────────────────────────────
export const JOBS = {
  mage:    { name:'法師',   desc:'跳過指針，穩定輸出。技能必中，適合想輕鬆玩的人。',
             adv:['火毒師','冰雷師'] },
  martial: { name:'武術師', desc:'技能同樣要打指針，變異最大。手速好的人上限最高。',
             adv:['詠春宗師','鐵砂掌'] },
  lin:     { name:'林董',   desc:'控制與離場。技能耗 MP，MP 只能買，有錢就有火力。',
             adv:['董事長','大律師'] },
};

export const SKILLS = {
  mage: [
    { id:'fire',   lv:10, name:'火球術',   mp:18, mult:1.30, cd:0, fx:'fire',   img:'/skill/fire.png',   desc:'必中，造成 130% 傷害' },
    { id:'ice',    lv:15, name:'冰封',     mp:26, mult:1.00, cd:2, fx:'ice',    img:'/skill/ice.png',    desc:'必中 100% 傷害，怪物下回合無法行動' },
    { id:'chain',  lv:20, name:'連鎖閃電', mp:34, mult:1.50, cd:1, fx:'fire',   img:'/skill/chain.png',  desc:'必中，造成 150% 傷害' },
    { id:'meteor', lv:25, name:'隕石術',   mp:48, mult:2.20, cd:3, fx:'meteor', img:'/skill/meteor.png', desc:'必中 220% 傷害，你下回合無法行動' },
  ],
  martial: [
    { id:'combo3', lv:10, name:'連環拳',   mp:16, hits:3, hitMult:0.50, cd:0, fx:'slash',  img:'/skill/combo3.png', desc:'連續 3 段判定，每段 50% 傷害' },
    { id:'inch',   lv:15, name:'寸勁',     mp:24, buff:0.5, cd:2, fx:'charge', img:'/skill/inch.png',   desc:'下一次普攻倍率 +0.5（總上限 2.5）' },
    { id:'iron',   lv:20, name:'鐵布衫',   mp:32, mult:0.80, guard:0.6, cd:2, fx:'object', img:'/skill/iron.png',   desc:'必中 80% 傷害，本回合受傷 −60%' },
    { id:'combo5', lv:25, name:'詠春連打', mp:46, hits:5, hitMult:0.42, cd:0, fx:'slash',  img:'/skill/combo5.png', desc:'連續 5 段判定，每段 42% 傷害' },
  ],
  lin: [
    { id:'gun',    lv:10, name:'林董有槍阿', mp:18, cd:0, fx:'bullet', img:'/skill/gun.png',    desc:'兩發子彈各 80% 傷害，第一發必中、第二發 50% 命中' },
    { id:'object', lv:15, name:'我反對',     mp:26, mult:1.10, cd:2, fx:'object', img:'/skill/object.png', desc:'必中 110% 傷害，免疫本回合怪物全部攻擊' },
    { id:'sue',    lv:20, name:'我要告你',   mp:34, cd:0, free:true, once:true, fx:'sue', img:'/skill/sue.png', desc:'不消耗回合。本場戰鬥怪物攻擊力 −30%，限一次' },
    { id:'deal',   lv:25, name:'談判',       mp:46, cd:0, fx:'deal', img:'/skill/deal.png',   desc:'結束戰鬥，獲得 50% 經驗與金幣（BOSS 無效）' },
  ],
};

// ── 能力樹 · 共 300 點 ────────────────────
// LV70 可得 207 點，只能點滿約 69%，必須取捨
export const TREE = {
  a: [
    { id:'a1', name:'擺動速度減緩', max:10, desc:'每級指針週期 +5%' },
    { id:'a2', name:'MISS 區縮減',  max:5,  desc:'每級 MISS −4 格（下限 10 格）', need:['a1',3] },
    { id:'a3', name:'佳區擴張',     max:5,  desc:'每級次佳／最佳各 +2 格', need:['a2',3] },
    { id:'a4', name:'擺動大幅減緩', max:3,  desc:'每級指針週期 +10%', need:['a3',5] },
    { id:'a5', name:'致命精準',     max:10, desc:'每級最佳區 +1 格，取自普通區', need:['a3',3] },
    { id:'a6', name:'手感精練',     max:10, desc:'每級次佳區 +1 格，取自普通區', need:['a2',5] },
    { id:'a7', name:'極限專注',     max:7,  desc:'每級指針週期 +3%', need:['a4',3] },
  ],
  b: [
    { id:'b1', name:'掉落金幣提升', max:10, desc:'每級金幣 +10%' },
    { id:'b2', name:'怪物經驗提升', max:10, desc:'每級經驗 +3%' },
    { id:'b3', name:'攻擊力提升',   max:20, desc:'每級 ATK +1' },
    { id:'b4', name:'防禦提升',     max:20, desc:'每級 DEF +2' },
    { id:'b5', name:'體魄',         max:20, desc:'每級最大 HP +15', need:['b4',5] },
    { id:'b6', name:'內力',         max:10, desc:'每級最大 MP +5', need:['b3',5] },
  ],
  c: [
    { id:'c1',  name:'汲取',   max:5,  desc:'最佳／中心判定時 EXP +1' },
    { id:'c2',  name:'洞察',   max:2,  desc:'解鎖怪物 HP → 解鎖完整資訊', need:['c1',3] },
    { id:'c3',  name:'藥師',   max:5,  desc:'每級回復藥效果 +10%', need:['c2',2] },
    { id:'c4',  name:'連擊',   max:1,  desc:'連續 2 次最佳以上 → 下一擊必定最佳', need:['c3',2] },
    { id:'c5',  name:'不屈',   max:1,  desc:'70% 機率抵擋致命傷害，每場戰鬥一次', need:['c4',1] },
    { id:'c6',  name:'吸血',   max:10, desc:'每級造成傷害的 1% 回復 HP', need:['c1',3] },
    { id:'c7',  name:'反擊',   max:5,  desc:'每級 MISS 時 8% 機率反擊半傷', need:['c6',3] },
    { id:'c8',  name:'破甲',   max:10, desc:'每級物理穿透 +1（直接削減怪物防禦）', need:['c2',2] },
    { id:'c10', name:'魔力汲取', max:5, desc:'每級中心判定回復 3% 最大 MP', need:['c3',3] },
    { id:'c11', name:'速咒',   max:3,  desc:'每級所有技能冷卻 −1 回合', need:['c10',3] },
    { id:'c12', name:'幸運',   max:3,  desc:'每級中心區判定 +0.5 格', need:['c5',1] },
    { id:'c13', name:'續戰',   max:10, desc:'每級戰鬥開始回復 2% 最大 HP', need:['c6',5] },
  ],
  d: [
    { id:'d1',  name:'巨人殺手', max:15, desc:'每級對 BOSS 傷害 +2%', need:['b3',10] },
    { id:'d2',  name:'韌性',     max:15, desc:'每級受到傷害 −1%', need:['b4',10] },
    { id:'d3',  name:'貪婪',     max:10, desc:'每級掉落機率 +2%', need:['b1',5] },
    { id:'d5',  name:'技法精通', max:15, desc:'每級技能傷害 +2%', need:['b6',5] },
    { id:'d6',  name:'爆發',     max:10, desc:'每級中心傷害 +3%', need:['c12',2] },
    { id:'d7',  name:'迅捷',     max:5,  desc:'每級戰鬥前 3 回合指針週期 +6%', need:['a7',3] },
    { id:'d9',  name:'天命',     max:3,  desc:'每級不屈觸發率 +10%', need:['c5',1] },
    { id:'d10', name:'終焉',     max:1,  desc:'怪物 HP 低於 20% 時，你的傷害翻倍', need:['d1',10] },
    { id:'d11', name:'蓄勢',     max:5,  desc:'每級戰鬥首擊傷害 +20%', need:['d5',5] },
    { id:'d12', name:'不滅',     max:1,  desc:'HP 低於 30% 時防禦 +50%', need:['d2',10] },
    { id:'d13', name:'冷血',     max:10, desc:'每級 MISS 後下一擊傷害 +4%', need:['c7',3] },
    { id:'d14', name:'豐收',     max:10, desc:'每級擊殺後 2% 機率額外掉落', need:['d3',5] },
  ],
  // 第五區 · 終章：全部要靠第四區的頂端節點才點得到，設計上就是 LV70+ 才會摸到的東西。
  // 5 個節點加總剛好 57 點，補上「點滿全樹只要 300 點、但 LV120 能拿 357 點」的落差，
  // 讓頂級玩家的點數剛好用完，不會浪費。
  e: [
    { id:'e1', name:'淬鍊',     max:12, desc:'每級技能傷害 +2%（疊加技法精通）',       need:['d5',10] },
    { id:'e2', name:'不朽',     max:10, desc:'每級受到傷害 −1%（疊加韌性）',           need:['d12',1] },
    { id:'e3', name:'崩壞',     max:15, desc:'每級對 BOSS 傷害 +2%（疊加巨人殺手）',   need:['d10',1] },
    { id:'e4', name:'天賦覺醒', max:10, desc:'每級不屈觸發率 +5%（疊加天命）',         need:['d9',3] },
    { id:'e5', name:'極限',     max:10, desc:'每級戰鬥首擊傷害 +10%（疊加蓄勢）',      need:['d11',5] },
  ],
};

export const TREE_ZONES = {
  a: { name:'第一區 · 判定手感', desc:'改變指針速度與判定區寬度。' },
  b: { name:'第二區 · 基礎數值', desc:'攻擊、防禦、生命、經濟。' },
  c: { name:'第三區 · 戰鬥機制', desc:'吸血、破甲、資源回復等實用效果。' },
  d: { name:'第四區 · 專精', desc:'高階節點，需要前置投資，效果最強。' },
  e: { name:'第五區 · 終章', desc:'LV70 之後才摸得到，全部堆疊在第四區的效果上。' },
};


// ── 兌換碼 ────────────────────────────────
export const CODES = {
  // 經驗加倍券系列，每個帳號各限一次
  VIP666:           { bag:{ dbl:1 }, msg:'獲得經驗加倍券 ×1。' },
  VIP777:           { bag:{ dbl:1 }, msg:'獲得經驗加倍券 ×1。' },
  VIPP:             { bag:{ dbl:1 }, msg:'獲得經驗加倍券 ×1。' },
  '白豬萬歲':        { bag:{ dbl:1 }, msg:'獲得經驗加倍券 ×1。' },
  '洪師傅':          { bag:{ dbl:1 }, msg:'獲得經驗加倍券 ×1。' },
  '跟家人吃飯重要':   { bag:{ dbl:1 }, msg:'獲得經驗加倍券 ×1。' },
  '勝利':            { bag:{ dbl:1 }, msg:'獲得經驗加倍券 ×1。' },
  '已失敗':          { bag:{ dbl:1 }, msg:'獲得經驗加倍券 ×1。' },

  EJ99:   { gold:99,      msg:'獲得 99 金幣。' },
  '2330': { gold:1000000, setLv:30, msg:'等級直升 30，獲得 1,000,000 金幣。' },
  TEST:   { resetTower:true, repeat:true, msg:'競技塔次數已重置。' },
  作弊:   { gold:50000000, setLv:70, msg:'等級直升 70，獲得 50,000,000 金幣。' },
  '忠實玩家-陳實忠': { bag:{ shard:2 }, msg:'獲得時光碎片 ×2。感謝你的支持。' },
};

// ── 活動兌換碼 · 30 組 ────────────────────
// A 組 HS**** → 心跳停止糖 ×2　B 組 TK**** → 章魚燒 ×2　C 組 EX**** → 遠征隊徽章 ×1
// 每組每個帳號限用一次
const GIFT_CODES = {
  heartstop2: {
    codes:['HS9RAU','HS63VL','HSLXM9','HSGPMK','HSENMK',
           'HSWQNP','HSXHEX','HS4TA7','HS4DVQ','HS9PX9'],
    def:{ bag:{ heartstop:2 }, msg:'獲得心跳停止糖 ×2。' },
  },
  takoyaki2: {
    codes:['TKADR4','TKAXVV','TKDUPR','TKNYK9','TKK3QH',
           'TKLELF','TKEPR9','TKDAQF','TKK6QP','TKKK6X'],
    def:{ bag:{ takoyaki:2 }, msg:'獲得章魚燒 ×2。' },
  },
  badge1: {
    codes:['EXFPJV','EXYHLU','EXYRLL','EX4MRK','EXXDHL',
           'EXLY43','EXT63C','EXU97M','EXPYYL','EXXJWX'],
    def:{ bag:{ badge:1 }, msg:'獲得遠征隊徽章 ×1。' },
  },
};
for (const g of Object.values(GIFT_CODES))
  for (const c of g.codes) CODES[c] = { ...g.def };
