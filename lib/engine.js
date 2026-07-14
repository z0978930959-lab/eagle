import { PITCH_TYPES, ZONE_ROWS, ZONE_COLS } from '../data/teams.js';

export const PITCH_TYPE_MAP = Object.fromEntries(PITCH_TYPES.map((p) => [p.id, p]));

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ------------------------------------------------------------------
// 連續座標系統：x/y 皆為 0-100 尺度。好球帶佔 zoneMin~zoneMax（沿用
// PitchTargetBoard 原本「內縮 20%」的視覺慣例）；canvasMin/Max 是可
// 拖曳／球路可達的最大延伸範圍，超過會被 clamp。
// ------------------------------------------------------------------
export const FIELD = {
  zoneMin: 20,
  zoneMax: 80,
  canvasMin: -25,
  canvasMax: 125,
};

export function clampCanvas(v) {
  return clamp(v, FIELD.canvasMin, FIELD.canvasMax);
}

export function inZone(x, y) {
  return x >= FIELD.zoneMin && x <= FIELD.zoneMax && y >= FIELD.zoneMin && y <= FIELD.zoneMax;
}

// 依連續座標描述位置（好球帶內分三分位：內角/中路/外角 × 高/中/低；帶外一律壞球區）
export function zoneLabelFromXY(x, y) {
  if (!inZone(x, y)) return '壞球區';
  const span = FIELD.zoneMax - FIELD.zoneMin;
  const third = span / 3;
  const col = Math.min(2, Math.max(0, Math.floor((x - FIELD.zoneMin) / third)));
  const row = Math.min(2, Math.max(0, Math.floor((y - FIELD.zoneMin) / third)));
  if (row === 1 && col === 1) return '紅中';
  return `${ZONE_ROWS[row]}${ZONE_COLS[col] === '中間' ? '中路' : ZONE_COLS[col]}`;
}

// ------------------------------------------------------------------
// 球種等級 S/A/B/C：擅長球依球威分 S/A；非擅長依綜合能力分 B/C。
// 疲勞會讓所有球種掉階（每 6 點疲勞掉 1 階）。
// 等級決定：位移刁鑽度、失投率、被打擊率（陌生球種好打）
// ------------------------------------------------------------------
export const GRADE_ORDER = ['C', 'B', 'A', 'S'];
export const GRADE_PARAMS = {
  S: { drift: 1.35, hang: 0.02, hitFactor: 0.94 },
  A: { drift: 1.2, hang: 0.05, hitFactor: 0.98 },
  B: { drift: 1.0, hang: 0.09, hitFactor: 1.03 },
  C: { drift: 0.85, hang: 0.15, hitFactor: 1.1 }, // 陌生球種：位移平、常失投、被打擊率 +10%
};

export function gradeOf(pitcher, typeId) {
  const isFav = (pitcher.fav || []).includes(typeId);
  let idx;
  if (isFav) idx = pitcher.stuff >= 78 ? 3 : 2; // S 或 A
  else idx = (pitcher.control + pitcher.stuff) / 2 >= 72 ? 1 : 0; // B 或 C
  const drop = Math.floor((pitcher.fatigue || 0) / 6); // 疲勞掉階
  return GRADE_ORDER[Math.max(0, idx - drop)];
}

// ------------------------------------------------------------------
// 落點計算（連續座標版）：等級高位移更刁鑽；等級低有「失投跑進紅中」風險。
// 位移是直接加在任意 targetX/Y 上的向量，天然支援「從好球帶外飄進來」
// 或「從裡面飄出去」，不受格子邊界限制。
// ------------------------------------------------------------------
const DRIFT_BASE = 23; // 位移向量基準量（0-100 尺度），乘上 grade drift 係數決定變化球轉彎幅度
const DRIFT_JITTER = 5;

export function computeActualPosition({ targetX, targetY, pitchTypeId, control, grade = 'B' }) {
  const pitchType = PITCH_TYPE_MAP[pitchTypeId];
  const gp = GRADE_PARAMS[grade] || GRADE_PARAMS.B;

  // 低等級球種：失投跑到紅中的風險
  const hangChance = clamp(gp.hang - (control - 50) / 600, 0.01, 0.2);
  if (Math.random() < hangChance) {
    return { x: 50, y: 50 }; // 失投球，掉進紅中
  }

  const driftChance = clamp((pitchType.drift - (control - 50) / 300) * gp.drift, 0.03, 0.7);

  if (pitchType.breakDir && Math.random() < driftChance) {
    // 位移量：等級越高（S/A 拿手）位移越大、越銳利
    const mag = (DRIFT_BASE + Math.random() * DRIFT_JITTER) * gp.drift;
    let x = targetX;
    let y = targetY;
    if (pitchType.breakDir === 'low') y += mag;
    if (pitchType.breakDir === 'outer') x += mag;
    return { x: clampCanvas(x), y: clampCanvas(y) };
  }

  const wildChance = clamp((50 - control) / 400, 0, 0.12);
  if (Math.random() < wildChance) {
    const angle = Math.random() * Math.PI * 2;
    const jitter = 12 + Math.random() * 10;
    return { x: clampCanvas(targetX + Math.cos(angle) * jitter), y: clampCanvas(targetY + Math.sin(angle) * jitter) };
  }

  return { x: clampCanvas(targetX), y: clampCanvas(targetY) };
}

// ------------------------------------------------------------------
// 飛行路徑（給前端動畫重播用）：每種球路比照真實軌跡建模——
//   直球　：直線、飛行時間最短（幾乎一閃而逝）
//   滑球　：前段如直球進壘，中後段向外「橫移」滑開
//   曲球　：出手即看得出大弧線，先浮起再大幅墜落（球速最慢）
//   指叉球：軌跡與直球幾乎重疊（球速也接近），進壘前才突然下墜
//   變速球：前段完全像直球（欺敵），球速偏慢、末段沉下去
// 等級越高（S/A 拿手）位移越大、飛行時間隨球威縮短（更急更快）。
// tunnel = 位移發動前球「看起來要去」的假進壘點；breakT = 位移發動時間點（0~1）。
// ------------------------------------------------------------------
export function buildFlightPath({ targetX, targetY, actualX, actualY, pitchTypeId, grade = 'B', effStuff = 50 }) {
  const gp = GRADE_PARAMS[grade] || GRADE_PARAMS.B;
  const startX = 50;
  const startY = -12;
  const st = effStuff - 50;
  const base = { startX, startY, endX: actualX, endY: actualY, pitchTypeId };

  switch (pitchTypeId) {
    case 'slider': {
      // 橫向位移：假裝進壘點在偏內側，中段開始往外滑
      const mag = 15 * gp.drift;
      return {
        ...base,
        motion: 'tunnel',
        ease: 'smooth',
        tunnelX: clamp(actualX - mag, FIELD.canvasMin, FIELD.canvasMax),
        tunnelY: actualY - 2,
        breakT: 0.52,
        durationMs: Math.round(clamp(560 - st * 2, 480, 650)),
      };
    }
    case 'curve': {
      // 大弧線：出手就看得出來，先浮高再重重砸下（最慢、看得最久）
      const hump = 26 * gp.drift;
      return {
        ...base,
        motion: 'arc',
        controlX: (startX + actualX) / 2,
        controlY: Math.min(startY, actualY) / 2 - hump,
        durationMs: Math.round(clamp(790 - st * 2.5, 690, 890)),
      };
    }
    case 'fork': {
      // 指叉球：直到最後一刻都像直球，進壘前急墜（球速接近直球）
      const drop = 20 * gp.drift;
      return {
        ...base,
        motion: 'tunnel',
        ease: 'drop',
        tunnelX: actualX,
        tunnelY: clamp(actualY - drop, FIELD.canvasMin, FIELD.canvasMax),
        breakT: 0.64,
        durationMs: Math.round(clamp(480 - st * 1.8, 400, 560)),
      };
    }
    case 'change': {
      // 變速球：前段完全是直球的樣子，靠「比直球慢」與末段下沉騙揮空
      const drop = 13 * gp.drift;
      return {
        ...base,
        motion: 'tunnel',
        ease: 'drop',
        tunnelX: actualX,
        tunnelY: clamp(actualY - drop, FIELD.canvasMin, FIELD.canvasMax),
        breakT: 0.7,
        durationMs: Math.round(clamp(550 - st * 2, 470, 630)),
      };
    }
    default: {
      // 直球：直線＋最快（比照真實反應時間，一閃而逝）
      return {
        ...base,
        motion: 'straight',
        durationMs: Math.round(clamp(400 - st * 1.5, 320, 470)),
        isFastball: true,
      };
    }
  }
}

// 依 t（0~1）取球在飛行路徑上的位置（前後端共用，動畫與判定看到同一條軌跡）
export function flightPointAt(path, t) {
  const tt = clamp(t, 0, 1);
  if (path.motion === 'arc') {
    const mt = 1 - tt;
    return {
      x: mt * mt * path.startX + 2 * mt * tt * path.controlX + tt * tt * path.endX,
      y: mt * mt * path.startY + 2 * mt * tt * path.controlY + tt * tt * path.endY,
    };
  }
  if (path.motion === 'tunnel') {
    // 前段：直直朝假進壘點（tunnel）飛；breakT 之後位移量逐漸疊加到真實進壘點
    const bx = path.startX + (path.tunnelX - path.startX) * tt;
    const by = path.startY + (path.tunnelY - path.startY) * tt;
    if (tt <= path.breakT) return { x: bx, y: by };
    const u = (tt - path.breakT) / (1 - path.breakT);
    // drop＝越掉越快（重力感）；smooth＝滑順橫移
    const k = path.ease === 'drop' ? u * u : u * u * (3 - 2 * u);
    return { x: bx + (path.endX - path.tunnelX) * k, y: by + (path.endY - path.tunnelY) * k };
  }
  // straight / 相容舊資料（有 controlX 的舊貝茲）
  if (path.controlX != null && path.motion == null) {
    const mt = 1 - tt;
    return {
      x: mt * mt * path.startX + 2 * mt * tt * path.controlX + tt * tt * path.endX,
      y: mt * mt * path.startY + 2 * mt * tt * path.controlY + tt * tt * path.endY,
    };
  }
  return {
    x: path.startX + (path.endX - path.startX) * tt,
    y: path.startY + (path.endY - path.startY) * tt,
  };
}

// ------------------------------------------------------------------
// 揮棒時機窗（依球速決定，前後端共用）：
//   perfect＝完美窗；contact＝勉強咬中窗；超出 contact＝不論位置一律揮空。
//   直球飛行時間短 → 窗也窄；強力打擊窗再縮 15%；觸擊窗放寬（碰到就好）。
// ------------------------------------------------------------------
export function swingWindowsOf(flightMs, mode = 'normal') {
  const dur = flightMs || 500;
  let perfect = clamp(dur * 0.12, 42, 85);
  if (mode === 'power') perfect *= 0.85;
  if (mode === 'bunt') perfect *= 1.8;
  const contact = perfect * 2.6;
  return { perfect: Math.round(perfect), contact: Math.round(contact) };
}

// 出棒時機 → 0~100 分；超出 contact 窗回傳 null（＝完全揮空）
export function swingTimingScore(deltaMs, windows) {
  if (deltaMs == null || !Number.isFinite(deltaMs)) return null;
  const ad = Math.abs(deltaMs);
  if (ad > windows.contact) return null;
  if (ad <= windows.perfect) return Math.round(100 - (ad / windows.perfect) * 15);
  return Math.round(85 - ((ad - windows.perfect) / (windows.contact - windows.perfect)) * 60);
}

// 揮擊命中分級（連續座標版）：球棒最終位置 vs 實際進壘點的距離
//  exact 甜蜜點全中 / near 有效接觸範圍內 / far 完全揮偏 / chase 追打壞球區（不論多準都是最差級）
export const SWEET_RADIUS = 8;
export const CONTACT_RADIUS = 19;
export const POWER_SWEET_RADIUS = 5;
export const POWER_CONTACT_RADIUS = 13;

export function classifySwingGeo({ actualX, actualY, batX, batY, powerMode = false }) {
  if (!inZone(actualX, actualY)) {
    return { tier: 'chase', groundBias: 0, contactQuality: 0 };
  }
  if (batX == null || batY == null) {
    return { tier: 'far', groundBias: 0, contactQuality: 0 };
  }
  const sweetR = powerMode ? POWER_SWEET_RADIUS : SWEET_RADIUS;
  const contactR = powerMode ? POWER_CONTACT_RADIUS : CONTACT_RADIUS;
  const dx = batX - actualX;
  const dy = batY - actualY;
  const dist = Math.hypot(dx, dy);
  const tier = dist <= sweetR ? 'exact' : dist <= contactR ? 'near' : 'far';
  const contactQuality = clamp(100 - (dist / contactR) * 100, 0, 100);
  // groundBias：正值＝球棒偏上緣（batY < actualY，切到球的上緣）→ 滾地傾向；負值＝偏下緣 → 飛球傾向
  const groundBias = clamp(-dy / contactR, -1, 1);
  return { tier, groundBias, contactQuality };
}

const BASE_TABLES = {
  // 一般打擊（normal）：均衡
  swingExact: { HR: 18, XBH: 26, SINGLE: 26, OUT: 22, FOUL: 7, K: 1 },
  swingNear: { SINGLE: 26, XBH: 12, FOUL: 24, OUT: 28, K: 10 },
  swingFar: { FOUL: 32, OUT: 30, K: 26, SINGLE: 10, XBH: 2 },
  swingChase: { K: 42, FOUL: 28, OUT: 22, SINGLE: 8 },
  // 強力打擊（power）：全中大獎、打偏大賠
  powExact: { HR: 34, XBH: 24, SINGLE: 10, OUT: 22, K: 8, FOUL: 2 },
  powNear: { XBH: 12, HR: 8, SINGLE: 12, OUT: 30, K: 24, FOUL: 14 },
  powFar: { K: 40, OUT: 28, FOUL: 24, SINGLE: 6, XBH: 2 },
  powChase: { K: 52, FOUL: 24, OUT: 20, SINGLE: 4 },
};

function pickSwingTable(mode, matchClass) {
  const T = BASE_TABLES;
  const grid = {
    normal: { exact: T.swingExact, near: T.swingNear, far: T.swingFar, chase: T.swingChase },
    power: { exact: T.powExact, near: T.powNear, far: T.powFar, chase: T.powChase },
  };
  return grid[mode]?.[matchClass] || T.swingFar;
}

function applyStatAdjustments(weights, { power = 50, contact = 50, stuff = 50, eye = 50 }) {
  const w = { ...weights };
  const powerFactor = (power - 50) / 50;
  const contactFactor = (contact - 50) / 50;
  const stuffFactor = (stuff - 50) / 50;
  const eyeFactor = (eye - 50) / 50;

  const bump = (key, factor) => {
    if (w[key] != null) w[key] = Math.max(0, w[key] * (1 + factor));
  };

  bump('HR', powerFactor * 0.5);
  bump('XBH', powerFactor * 0.35);
  bump('K', -contactFactor * 0.35);
  bump('FOUL', contactFactor * 0.15);
  bump('SINGLE', contactFactor * 0.15);
  bump('HR', -stuffFactor * 0.25);
  bump('XBH', -stuffFactor * 0.2);
  bump('SINGLE', -stuffFactor * 0.15);
  bump('K', stuffFactor * 0.2);
  bump('OUT', stuffFactor * 0.1);
  bump('FOUL', eyeFactor * 0.1);
  bump('K', -eyeFactor * 0.1);

  return w;
}

// 佈陣修正（新制：拉打佈陣賭的是「強力打擊」）
function applyShift(weights, shift, batterMode) {
  const w = { ...weights };
  const scale = (key, f) => {
    if (w[key] != null) w[key] = Math.max(0, w[key] * f);
  };
  if (shift === 'infield_in') {
    scale('SINGLE', 1.3);
    scale('XBH', 1.1);
  } else if (shift === 'dp') {
    // 中線補位讓開，安打與長打略增（換取雙殺機率，見 applyOutcome）
    scale('SINGLE', 1.15);
    scale('XBH', 1.1);
  } else if (shift === 'pull') {
    if (batterMode === 'power') {
      // 拉打佈陣剋強力打擊：拉擊方向早已站滿人
      scale('OUT', 1.25);
      scale('HR', 0.9);
      scale('XBH', 0.85);
      scale('SINGLE', 0.7);
    } else if (batterMode === 'normal') {
      // 一般打擊順勢推打反方向，鑽拉打佈陣的空檔
      scale('SINGLE', 1.3);
      scale('OUT', 0.85);
    }
  }
  return w;
}

// 擅長球路被猜中時，傷害略降（球質好，即使被抓到也不容易扛出去）
function applyFavNerf(weights) {
  const w = { ...weights };
  if (w.HR != null) {
    const cut = w.HR * 0.25;
    w.HR -= cut;
    w.XBH = (w.XBH || 0) + cut * 0.6;
    w.OUT = (w.OUT || 0) + cut * 0.4;
  }
  return w;
}

// 左右打對決：異邊（左打對右投／右打對左投，左右開弓恆為異邊）小幅優勢；同邊小幅劣勢
// 純數值加成，不需要玩家額外操作
function platoonFactor(bats, throwsHand) {
  if (!bats || !throwsHand) return 1;
  const favorable = bats === 'S' || bats !== throwsHand;
  return favorable ? 1.06 : 0.94;
}

// ------------------------------------------------------------------
// 揮棒時機（動作層）：打者端時機小遊戲送回 0~100 分，55 為中性樞紐
// 完美時機放大長打、壓低揮空；太早/太晚則勉強碰到＝界外滿天飛、三振變多
// null＝未使用（看球、超時自動不揮棒）
// ------------------------------------------------------------------
export function timingLabelOf(timing) {
  if (timing == null) return null;
  if (timing >= 90) return '完美';
  if (timing >= 70) return '不錯';
  if (timing >= 40) return '普通';
  return '沒跟上';
}

function applyTiming(weights, timing) {
  if (timing == null) return weights;
  const t = clamp((timing - 55) / 45, -1, 1); // 100 → +1，10 → -1
  const w = { ...weights };
  const scale = (key, f) => {
    if (w[key] != null) w[key] = Math.max(0, w[key] * (1 + f));
  };
  scale('HR', t * 0.5);
  scale('XBH', t * 0.35);
  scale('SINGLE', t * 0.15);
  scale('K', -t * 0.35);
  scale('OUT', -t * 0.12);
  if (t < 0) scale('FOUL', -t * 0.3); // 時機差：更多勉強碰到的界外
  return w;
}

function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([, v]) => v > 0);
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  let roll = Math.random() * sum;
  for (const [k, v] of entries) {
    roll -= v;
    if (roll <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

// ------------------------------------------------------------------
// 主判定：實際落點已在投球提交時算好（打者端需要動畫重播）
// batterMode: 'take' | 'normal' | 'power' | 'bunt'
// batX/batY: 球到位當下球棒的連續座標（null＝沒出棒／看球）
// ------------------------------------------------------------------
export function resolvePitch({
  actualX,
  actualY,
  hung = false,
  pitcherPitchTypeId,
  grade = 'B',
  pitcherStats, // { control, stuff, throws }
  shift = 'normal',
  batterMode,
  batX = null,
  batY = null,
  swingDeltaMs = null, // 放開（揮棒）時刻 − 球到位時刻（ms；負＝太早、正＝太晚；null＝相容舊資料視為時機中性）
  flightMs = null, // 這一球的飛行時間（決定時機窗寬窄）
  batterStats,
  strikes = 0,
}) {
  const pitchType = PITCH_TYPE_MAP[pitcherPitchTypeId];
  const gp = GRADE_PARAMS[grade] || GRADE_PARAMS.B;
  const withinZone = inZone(actualX, actualY);

  // 左右打對決：只微調力量與準度，選球眼／速度不受影響
  const pf = platoonFactor(batterStats.bats, pitcherStats.throws);
  const batterEff = { ...batterStats, power: (batterStats.power ?? 50) * pf, contact: (batterStats.contact ?? 50) * pf };

  let kind;
  let groundBias = 0;
  let contactQuality = null;

  if (batterMode === 'take') {
    kind = withinZone ? 'CALLED_STRIKE' : 'BALL';
  } else if (batterMode === 'bunt') {
    // 觸擊：球棒-球距離＋出棒時機（窗較寬，碰到就好）合成觸擊品質
    const geo = classifySwingGeo({ actualX, actualY, batX, batY, powerMode: false });
    const buntWin = swingWindowsOf(flightMs, 'bunt');
    const buntTiming = swingDeltaMs != null ? swingTimingScore(swingDeltaMs, buntWin) : 60;
    if (batX != null && buntTiming == null) {
      // 出棒時機完全沒對上：短棒揮空＝好球（兩好球後觸擊揮空一樣三振）
      return {
        kind: strikes >= 2 ? 'BUNT_K' : 'K',
        actualX,
        actualY,
        actualZoneLabel: zoneLabelFromXY(actualX, actualY),
        pitchTypeName: PITCH_TYPE_MAP[pitcherPitchTypeId].name,
        inZone: withinZone,
        hung,
        groundBias: 0,
        contactQuality: 0,
        swingDeltaMs,
      };
    }
    contactQuality = Math.round(geo.contactQuality * (0.5 + 0.5 * ((buntTiming ?? 60) / 100)));
    if (!withinZone) {
      // 壞球：依選球眼決定是否收棒
      const pullBack = clamp(0.5 + (batterStats.eye - 50) / 180, 0.3, 0.85);
      if (Math.random() < pullBack) {
        kind = 'BALL';
      } else {
        const roll = Math.random();
        if (roll < 0.5) kind = strikes >= 2 ? 'BUNT_K' : 'FOUL';
        else if (roll < 0.85) kind = 'BUNT_OUT_NO_ADV';
        else kind = 'BUNT_SAC';
      }
    } else {
      let skill = clamp(0.6 + (batterStats.contact - 50) / 250, 0.4, 0.8);
      if (batX != null) skill = clamp(skill + (contactQuality - 55) / 300, 0.25, 0.9); // 觸擊品質（距離衍生）
      const roll = Math.random();
      if (roll < skill) kind = 'BUNT_SAC';
      else if (roll < skill + 0.1) kind = 'BUNT_HIT';
      else if (roll < skill + 0.25) kind = strikes >= 2 ? 'BUNT_K' : 'FOUL';
      else kind = 'BUNT_OUT_NO_ADV';
    }
  } else {
    // normal / power：即時反應揮擊
    if (batX == null || batY == null) {
      // 反應窗內沒出棒
      if (withinZone) {
        kind = 'CALLED_STRIKE'; // 站著看好球
      } else {
        // 壞球：選球眼決定會不會忍不住揮出去（半揮棒被抓）
        const hold = clamp(0.55 + (batterStats.eye - 50) / 150, 0.3, 0.9);
        kind = Math.random() < hold ? 'BALL' : 'K';
      }
    } else {
      // 出棒時機：先過時機窗——超出 contact 窗＝球棒到位時球早過了／還沒到，不論瞄多準都是揮空
      const windows = swingWindowsOf(flightMs, batterMode);
      const timingScore = swingDeltaMs != null ? swingTimingScore(swingDeltaMs, windows) : 60;
      if (timingScore == null) {
        return {
          kind: 'K',
          actualX,
          actualY,
          actualZoneLabel: zoneLabelFromXY(actualX, actualY),
          pitchTypeName: PITCH_TYPE_MAP[pitcherPitchTypeId].name,
          inZone: withinZone,
          hung,
          groundBias: 0,
          contactQuality: 0,
          swingDeltaMs,
        };
      }

      const geo = classifySwingGeo({ actualX, actualY, batX, batY, powerMode: batterMode === 'power' });
      let matchClass = geo.tier;
      // 時機勉強（<45 分）：即使位置對了也只是擦到——命中層級降一級
      if (timingScore < 45) {
        if (matchClass === 'exact') matchClass = 'near';
        else if (matchClass === 'near') matchClass = 'far';
      }
      groundBias = geo.groundBias;
      // 最終擊球品質＝位置品質 ×（0.4 + 0.6×時機分）——兩者都要好才算真的咬中
      contactQuality = Math.round(geo.contactQuality * (0.4 + 0.6 * (timingScore / 100)));
      const table = pickSwingTable(batterMode, matchClass);
      let w = applyStatAdjustments(table, { ...batterEff, stuff: pitcherStats.stuff });

      // 球種等級：S/A 級即使被咬中傷害也較低；B/C 級陌生球種被打擊率提升
      const hf = gp.hitFactor;
      for (const key of ['HR', 'XBH', 'SINGLE']) {
        if (w[key] != null) w[key] = Math.max(0, w[key] * hf);
      }
      if ((grade === 'S' || grade === 'A') && (matchClass === 'exact' || matchClass === 'near')) {
        w = applyFavNerf(w);
      }
      if (hung && matchClass !== 'chase') {
        // 失投紅中球：即使沒完全咬中也變好打
        w.HR = (w.HR || 0) + 8;
        w.XBH = (w.XBH || 0) + 10;
        w.K = Math.max(0, (w.K || 0) * 0.6);
      }
      w = applyShift(w, shift, batterMode);
      w = applyTiming(w, contactQuality);
      kind = weightedPick(w);
    }
  }

  return {
    kind,
    actualX,
    actualY,
    actualZoneLabel: zoneLabelFromXY(actualX, actualY),
    pitchTypeName: pitchType.name,
    inZone: withinZone,
    hung,
    groundBias,
    contactQuality,
    swingDeltaMs,
  };
}

// 盜壘判定（前置宣告制：跑者在投球前已起跑）
// fastball: 直球球速快，捕手阻殺快 -12%
// breakingWhiff: 打者揮空且是變化球，捕手接球位置差 +18%
// heldClose: 被牽制回壘次數，-12%/次
// doubleSteal: 雙盜壘以前位跑者為判定基準，整體 -5%
export function resolveSteal({
  runnerSpeed = 50,
  wastePitch = false,
  fastball = false,
  breakingWhiff = false,
  heldClose = 0,
  doubleSteal = false,
}) {
  let p = 0.60 + (runnerSpeed - 50) / 250;
  if (wastePitch) p -= 0.15;
  if (fastball) p -= 0.12; // 直球到捕手手套快，阻殺威脅大
  if (breakingWhiff) p += 0.18; // 變化球揮空：球在土裡彈，大大增加成功率
  p -= 0.12 * heldClose; // 剛被牽制回壘：離壘小、起跑晚
  if (doubleSteal) p -= 0.05;
  return Math.random() < clamp(p, 0.08, 0.95);
}

const OUTFIELD = ['左外野', '中外野', '右外野'];
const INFIELD = ['游擊', '二壘', '三壘', '一壘'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ------------------------------------------------------------------
// 結算：把 kind 套用到局面
// opts: { shift, mode ('hitrun' 影響雙殺率), stealAttempt, runnerSpeed }
// ------------------------------------------------------------------
export function applyOutcome(situation, kind, batterName, opts = {}) {
  const { shift = 'normal', mode = 'lock' } = opts;
  const s = {
    balls: situation.balls,
    strikes: situation.strikes,
    outs: situation.outs,
    bases: { ...situation.bases },
    runsThisPlay: 0,
    log: '',
    paEnded: false,
    ballInPlay: false,
    closePlay: false, // 千鈞一髮的時間差判決（唯一可挑戰的類型）
    outType: null, // 'ground' | 'fly'
  };

  const scoreRunner = (base) => {
    if (s.bases[base]) {
      s.runsThisPlay += 1;
      s.bases[base] = null;
    }
  };

  const advanceAll = () => {
    if (s.bases.third) scoreRunner('third');
    if (s.bases.second) {
      s.bases.third = s.bases.second;
      s.bases.second = null;
    }
    if (s.bases.first) {
      s.bases.second = s.bases.first;
      s.bases.first = null;
    }
  };

  switch (kind) {
    case 'BALL': {
      s.balls += 1;
      if (s.balls >= 4) {
        // 強迫進壘：只有被擠到的跑者才推進
        if (s.bases.first) {
          if (s.bases.second) {
            if (s.bases.third) s.runsThisPlay += 1;
            s.bases.third = s.bases.second;
          }
          s.bases.second = s.bases.first;
        }
        s.bases.first = batterName;
        s.balls = 0;
        s.strikes = 0;
        s.log = '四壞球保送';
        s.narration = ['這球又偏出了好球帶，打者完全不為所動', '主審手一比——四壞球！', '打者卸下護具，慢跑上一壘'];
        s.paEnded = true;
        s.walked = true;
      } else {
        s.log = `壞球（${s.balls}壞）`;
      }
      break;
    }
    case 'HBP': {
      // 觸身球＝死球，同保送的強迫進壘
      if (s.bases.first) {
        if (s.bases.second) {
          if (s.bases.third) s.runsThisPlay += 1;
          s.bases.third = s.bases.second;
        }
        s.bases.second = s.bases.first;
      }
      s.bases.first = batterName;
      s.balls = 0;
      s.strikes = 0;
      s.log = '觸身球保送';
      s.narration = [
        '這球出手就偏了，直直朝打者身上竄——',
        '打者閃避不及——砰！球結結實實打中身體',
        '主審立刻指向一壘：觸身球，保送上壘（打者揉著手臂慢慢走向一壘）',
      ];
      s.paEnded = true;
      break;
    }
    case 'CALLED_STRIKE':
    case 'K': {
      s.strikes += 1;
      if (s.strikes >= 3) {
        s.outs += 1;
        s.log = kind === 'K' ? '三振（揮棒落空）' : '三振（看著好球）';
        s.narration = kind === 'K'
          ? ['投手出手——', '打者大棒一揮……揮空！', '三振出局！捕手興奮握拳']
          : ['這球直取好球帶邊角，打者棒子扛在肩上——', '主審毫不猶豫，右手用力一揮！', '見逃三振！打者搖著頭走回休息區'];
        s.balls = 0;
        s.strikes = 0;
        s.strikeout = true;
        s.paEnded = true;
        s.swingMiss = kind === 'K';
      } else {
        s.log = kind === 'K' ? `揮棒落空（${s.strikes}好）` : `好球（${s.strikes}好，站著不動）`;
        s.swingMiss = kind === 'K';
      }
      break;
    }
    case 'FOUL': {
      if (s.strikes < 2) s.strikes += 1;
      s.log = '界外球';
      s.foul = true;
      break;
    }
    case 'BUNT_K': {
      s.outs += 1;
      s.log = '兩好球後觸擊出界，三振出局！';
      s.narration = ['兩好球，打者竟然還是擺出短棒——', '球碰到棒子，滾出邊線外……界外！', '兩好球後觸擊出界，依規則直接三振出局！'];
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      s.strikeout = true; // 觸擊三振也計入奪三振/被三振
      break;
    }
    case 'BUNT_OUT_NO_ADV': {
      s.closePlay = Math.random() < 0.4;
      s.outs += 1;
      s.log = '觸擊太強，投手快速處理，跑者無法推進';
      s.narration = ['短棒一擺——但點得太用力！', '球直接滾回投手正面，投手撿起來從容傳一壘', '打者出局，跑者只能退回原壘包，這次觸擊沒有達成任務'];
      // 小機率點成雙殺（衝太前的跑者被抓）
      if (s.bases.first && s.outs < 3 && Math.random() < 0.12) {
        s.outs += 1;
        s.bases.first = null;
        s.log = '觸擊點成小飛球，一壘跑者回不去，雙殺！';
        s.doublePlay = true;
      }
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    case 'BUNT_SAC': {
      s.outs += 1;
      advanceAll();
      s.log = `犧牲觸擊成功，跑者推進${s.runsThisPlay > 0 ? '，三壘跑者回本壘得分！' : ''}`;
      s.narration = ['短棒輕輕一碰，球沿著邊線緩緩滾動——', '守備只能選擇傳一壘刺殺打者', `任務達成！跑者順利推進${s.runsThisPlay > 0 ? '，三壘跑者回本壘得分！' : '，漂亮的犧牲觸擊'}`];
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    case 'BUNT_HIT': {
      s.closePlay = Math.random() < 0.5; // 觸擊內野安打半數是 close play
      advanceAll();
      s.bases.first = batterName;
      s.log = '完美觸擊！內野安打，全員安全上壘';
      s.narration = ['完美的觸擊！球停在三壘線邊，不快不慢——', '三壘手衝上來徒手抓球、失去平衡中勉強傳向一壘——', '來不及！打者快腿踩過一壘，內野安打！全員安全上壘'];
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    case 'OUT': {
      s.outs += 1;
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;

      // groundBias：來自打者揮擊時球棒相對球的上下位置（切到上緣＝滾地傾向，下緣＝飛球傾向）
      const groundBias = opts.groundBias || 0;
      const grounderProb = clamp(0.6 + groundBias * 0.25, 0.15, 0.9);
      const grounder = Math.random() < grounderProb;
      const pos = pick(INFIELD);
      const dir = pick(OUTFIELD);
      s.outType = grounder ? 'ground' : 'fly';

      if (grounder) {
        // 滾地刺殺是時間差判決：約 3 成是「差一點」的 close play，可挑戰
        s.closePlay = Math.random() < 0.3;
        s.log = `${pos}方向滾地球出局${s.closePlay ? '（好接近的判決！）' : ''}`;
        s.narration = s.closePlay
          ? [`打成滾地球，竄向${pos}方向！`, `${pos}手快步上前接球，順勢長傳一壘——打者全力狂奔！`, '好近！！一壘審遲疑半秒後握拳——出局！打者不敢置信地回頭看壘包']
          : [`打成滾地球，竄向${pos}方向！`, `${pos}手快步上前接球，順勢長傳一壘——`, '刺殺！打者出局'];
      } else {
        // 外野接殺：球在空中被接走，沒有時間差可言，不可挑戰
        s.closePlay = false;
        s.log = `${dir}飛球出局`;
        s.narration = [`球被打向${dir}，有點高度……`, `${dir}手退了兩步、站好位置——`, '穩穩收進手套，接殺出局'];
      }

      // 雙殺判定：一壘有人、不滿三出局、滾地球
      if (grounder && s.bases.first && s.outs < 3) {
        let dpChance = 0.4;
        if (shift === 'dp') dpChance = 0.62; // 雙殺佈陣：內野站位守雙殺
        if (opts.runnersGoing) dpChance = 0.05; // 跑者已提前起跑，難以雙殺
        const runnerSpeedAdj = ((opts.runnerOnFirstSpeed ?? 50) - 50) / 400;
        dpChance -= runnerSpeedAdj;
        if (Math.random() < clamp(dpChance, 0.02, 0.75)) {
          s.outs += 1;
          s.bases.first = null;
          s.log = `${pos}方向滾地球，6-4-3 雙殺打！${shift === 'dp' ? '（雙殺佈陣奏效）' : ''}`;
          s.narration = [
            `滾地球直奔${pos}！${shift === 'dp' ? '內野早已站好雙殺站位——' : ''}`,
            `${pos}手接球後迅速撥傳二壘封殺跑者、二壘手跳過滑壘、轉身火速傳向一壘——`,
            '一壘審握拳！雙殺守備完成，教科書等級的 6-4-3！',
          ];
          s.doublePlay = true;
          s.closePlay = false;
          break;
        } else if (opts.runnersGoing) {
          // 打帶跑成功破壞雙殺，跑者推進
          s.bases.second = s.bases.second || s.bases.first;
          if (s.bases.second === s.bases.first) s.bases.first = null;
          s.log += '（跑者提前起跑上二壘，破壞雙殺）';
          s.narration.push('但一壘跑者早已提前起跑，輕鬆站上二壘——起跑破壞了雙殺！');
        }
      }

      // 犧牲飛球/滾地：三壘跑者回本壘
      if (s.bases.third && s.outs < 3) {
        let sacChance = 0.35;
        if (shift === 'infield_in' && grounder) sacChance = 0.08; // 內野趨前封鎖本壘
        if (!grounder) sacChance = 0.45; // 外野飛球較容易回壘
        if (Math.random() < sacChance) {
          s.runsThisPlay += 1;
          s.bases.third = null;
          s.log += grounder ? '（三壘跑者趁滾地回本壘得分）' : '（高飛犧牲打，三壘跑者回本壘得分）';
          s.narration.push(grounder ? '三壘跑者趁守備處理球的空檔衝回本壘——得分！' : '三壘跑者補位起跑，輕鬆踩過本壘——高飛犧牲打換 1 分！');
        } else if (shift === 'infield_in' && grounder) {
          s.log += '（內野趨前守住，三壘跑者不敢跑）';
          s.narration.push('內野趨前守備奏效，三壘跑者被釘在壘包上不敢動');
        }
      }
      break;
    }
    case 'SINGLE': {
      const dir = pick(OUTFIELD);
      const style = pick(['strong', 'soft', 'gap', 'infield']);
      // 內野安打是時間差判決 → close play 可挑戰；外野落地安打不可
      s.closePlay = style === 'infield';
      const firstLine =
        style === 'strong' ? `扎實的平飛球，強勁地穿越內野防線，落進${dir}前草皮！`
        : style === 'soft' ? `打得不算扎實……小飛球晃晃悠悠，落在內野手與${dir}手之間的三不管地帶！`
        : style === 'infield' ? '打成內野深處的滾地球——游擊手反手撈到，重心不穩中跳傳一壘！'
        : `滾地球找到洞了！從野手之間鑽出去，滾進${dir}！`;
      scoreRunner('third');
      scoreRunner('second');
      if (opts.runnersGoing && s.bases.first) {
        // 跑者提前起跑：一壘跑者多推進一個壘
        s.bases.third = s.bases.first;
        s.bases.first = null;
        s.log = style === 'infield' ? '內野安打（千鈞一髮！）——起跑的跑者一口氣上三壘！' : '一壘安打（跑者提前起跑，一口氣上三壘！）';
        s.narration = [firstLine, style === 'infield' ? '好近！！壘審雙手一攤：安全上壘！' : `${dir}手上前處理回傳——但起跑的跑者早就過了二壘！`, '跑者頭也不回，一路衝上三壘！盜壘啟動變成完美的打帶跑'];
      } else if (style === 'infield') {
        s.bases.second = s.bases.first;
        s.bases.first = null;
        s.log = '內野安打（千鈞一髮的判決！）';
        s.narration = [firstLine, '球與人幾乎同時到一壘——', '壘審雙手一攤：安全上壘！守備方不敢置信地攤手抗議'];
      } else {
        s.bases.second = s.bases.first;
        s.bases.first = null;
        s.log = '一壘安打';
        s.narration = [firstLine, `${dir}手迅速上前撿球回傳內野`, `打者安全站上一壘，一壘安打${s.runsThisPlay > 0 ? '——跑者回來得分！' : ''}`];
      }
      s.bases.first = batterName;
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    case 'XBH': {
      const isTriple = Math.random() < 0.2;
      const dir = pick(OUTFIELD);
      scoreRunner('third');
      scoreRunner('second');
      if (isTriple) {
        scoreRunner('first');
        s.bases.third = batterName;
        s.log = '三壘安打！';
        s.narration = [
          `擊出！球又高又遠，直奔${dir}深處——`,
          `${dir}手全力回追、追到定位，最後一刻跳起——沒接到！球打在全壘打牆上彈開！`,
          '打者過一壘、過二壘，教練猛力揮手——滑進三壘！三壘安打！',
        ];
      } else {
        if (s.bases.first) {
          if (opts.runnersGoing) {
            scoreRunner('first'); // 提前起跑的跑者直接回本壘
          } else {
            s.bases.third = s.bases.first;
          }
          s.bases.first = null;
        }
        s.bases.second = batterName;
        const hr = opts.runnersGoing && s.runsThisPlay > 0;
        s.log = hr ? '二壘安打！（跑者提前起跑狂奔回本壘）' : '二壘安打！';
        s.narration = [
          `強勁的平飛球切進${dir}防區的空檔！`,
          `球一路滾向全壘打牆，${dir}手追到牆邊才撿到球——`,
          hr ? '提前起跑的跑者一路狂奔踩過本壘得分！打者輕鬆站上二壘，二壘安打！' : `打者頭也不回衝上二壘！站立式進壘，二壘安打！${s.runsThisPlay > 0 ? '跑者回來得分！' : ''}`,
        ];
      }
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    case 'HR': {
      const dir = pick(OUTFIELD);
      const before = (s.bases.first ? 1 : 0) + (s.bases.second ? 1 : 0) + (s.bases.third ? 1 : 0);
      scoreRunner('first');
      scoreRunner('second');
      scoreRunner('third');
      s.runsThisPlay += 1;
      s.bases = { first: null, second: null, third: null };
      s.balls = 0;
      s.strikes = 0;
      s.log = '全壘打！！';
      s.narration = [
        '擊出的瞬間，全場觀眾同時站了起來——',
        `球又高又遠，直奔${dir}最深處！${dir}手退到警戒區、貼上全壘打牆……只能抬頭目送……`,
        before === 3 ? '飛出去了！！滿貫全壘打！！四分砲清空壘包，全場陷入瘋狂！！' : `再見了！！球消失在全壘打牆外！${before > 0 ? `${before + 1} 分全壘打！` : '陽春全壘打！'}打者慢慢繞壘，享受這一刻`,
      ];
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    default:
      break;
  }

  return s;
}

// 盜壘結算（在 applyOutcome 之後、球未進場內時呼叫）
export function applyStealResult(state, success, fromBase, runnerName) {
  const s = { bases: { ...state.bases }, outs: state.outs, log: '' };
  const toBase = fromBase === 'first' ? 'second' : 'third';
  const baseName = fromBase === 'first' ? '二壘' : '三壘';
  if (success) {
    s.bases[toBase] = runnerName;
    s.bases[fromBase] = null;
    s.log = `${runnerName} 盜${baseName}成功！`;
  } else {
    s.bases[fromBase] = null;
    s.outs = Math.min(3, s.outs + 1);
    s.log = `${runnerName} 盜${baseName}失敗，被觸殺出局`;
  }
  return s;
}

// 雙盜壘結算：一二壘跑者同時起跑（捕手只能選一個傳，鎖定前位跑者）
// 成功：二三壘有人；失敗：前位跑者在三壘被觸殺，後位跑者上二壘（多一出局、二壘有人）
export function applyDoubleStealResult(state, success, leadName, trailName) {
  const s = { bases: { ...state.bases }, outs: state.outs, log: '' };
  if (success) {
    s.bases.third = leadName;
    s.bases.second = trailName;
    s.bases.first = null;
    s.log = `雙盜壘成功！${leadName} 上三壘、${trailName} 上二壘`;
  } else {
    s.bases.third = null;
    s.bases.second = trailName;
    s.bases.first = null;
    s.outs = Math.min(3, s.outs + 1);
    s.log = `雙盜壘失敗！捕手火速傳三壘，${leadName} 被觸殺出局（${trailName} 上二壘）`;
  }
  return s;
}
