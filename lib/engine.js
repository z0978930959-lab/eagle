import { PITCH_TYPES, ZONE_ROWS, ZONE_COLS, QUADS } from '../data/teams.js';

export const PITCH_TYPE_MAP = Object.fromEntries(PITCH_TYPES.map((p) => [p.id, p]));

export function zoneLabelOf(key) {
  if (key === 'out') return '壞球區';
  const [r, c] = key.split('-').map(Number);
  if (r === 1 && c === 1) return '紅中';
  return `${ZONE_ROWS[r]}${ZONE_COLS[c]}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ------------------------------------------------------------------
// 落點計算：擅長球路位移更刁鑽；非擅長球路有「失投跑進紅中」風險
// ------------------------------------------------------------------
export function computeActualZone(target, pitchTypeId, control, isFav) {
  const pitchType = PITCH_TYPE_MAP[pitchTypeId];
  if (target === 'waste') return 'out';

  const [r0, c0] = target.split('-').map(Number);

  // 非擅長球路：失投跑到紅中附近的風險
  if (!isFav) {
    const hangChance = clamp(0.10 - (control - 50) / 500, 0.04, 0.16);
    if (Math.random() < hangChance) {
      return '1-1'; // 失投球，掉進紅中
    }
  }

  const favBonus = isFav ? 1.25 : 1.0;
  const driftChance = clamp((pitchType.drift - (control - 50) / 300) * favBonus, 0.03, 0.7);

  if (pitchType.breakDir && Math.random() < driftChance) {
    let r = r0;
    let c = c0;
    if (pitchType.breakDir === 'low') r += 1;
    if (pitchType.breakDir === 'outer') c += 1;
    if (r > 2 || c > 2) return 'out';
    return `${r}-${c}`;
  }

  const wildChance = clamp((50 - control) / 400, 0, 0.12);
  if (Math.random() < wildChance) {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const [dr, dc] = dirs[Math.floor(Math.random() * dirs.length)];
    const r = r0 + dr;
    const c = c0 + dc;
    if (r < 0 || r > 2 || c < 0 || c > 2) return 'out';
    return `${r}-${c}`;
  }

  return target;
}

const QUAD_MAP = Object.fromEntries(QUADS.map((q) => [q.id, q]));

// 位置猜法分級：
//  cell 單選 → exact（全中）/ near（同排同列沾邊）/ far / chase
//  cell 多選（2~3 相連格）→ 命中選中格 = quad 級獎勵；沒中但同排同列 = near；否則 far
//  quad 猜法 → quad（落在方位內）/ far / chase
function classifyMatch(guessZoneKind, guessZone, actualZoneKey) {
  if (actualZoneKey === 'out') return 'chase';
  if (guessZoneKind === 'quad') {
    const q = QUAD_MAP[guessZone];
    return q && q.cells.includes(actualZoneKey) ? 'quad' : 'far';
  }
  // cell 模式：guessZone 可以是字串（單選）或陣列（多選）
  const cells = Array.isArray(guessZone) ? guessZone : [guessZone];
  const [ar, ac] = actualZoneKey.split('-').map(Number);
  if (cells.length === 1) {
    if (cells[0] === actualZoneKey) return 'exact';
    const [gr, gc] = cells[0].split('-').map(Number);
    if (gr === ar || gc === ac) return 'near';
    return 'far';
  }
  // 多選：命中其中一格 → 方位級（比單選 exact 弱、比 quad 預設稍強因為玩家自訂範圍）
  if (cells.includes(actualZoneKey)) return 'quad';
  // 沒中但有任一格與實際落點同排或同列 → near
  const near = cells.some((cell) => {
    const [gr, gc] = cell.split('-').map(Number);
    return gr === ar || gc === ac;
  });
  return near ? 'near' : 'far';
}

// 球種猜法分級：
//  species：猜「直球」且投直球，或指定變化球種類且命中 → 最高獎勵
//  cat    ：猜「變化球」不指定（或指定錯種類）但方向對 → 中等
//  miss   ：直球/變化球都猜反 → 懲罰
function classifyType(guessCat, guessSpecies, pitchTypeId) {
  const isFastball = pitchTypeId === 'fastball';
  if (guessCat === 'fastball') return isFastball ? 'species' : 'miss';
  // 猜變化球
  if (isFastball) return 'miss';
  if (guessSpecies) return guessSpecies === pitchTypeId ? 'species' : 'cat';
  return 'cat';
}

const BASE_TABLES = {
  // 種類全中（species）
  exactHeart: { HR: 70, XBH: 20, OUT: 8, FOUL: 2 },          // 種類＋單格全中且紅中 → 極高機率全壘打
  exactOther: { HR: 55, XBH: 25, OUT: 15, FOUL: 5 },          // 種類＋單格全中 → 極高機率全壘打
  quadMatch: { HR: 38, XBH: 24, SINGLE: 10, OUT: 20, FOUL: 8 }, // 種類中＋方位命中 → 大概率全壘打（範圍廣，掌握度降）
  nearMatch: { SINGLE: 35, XBH: 15, OUT: 30, FOUL: 15, K: 5 },
  farMatch: { FOUL: 30, OUT: 35, SINGLE: 10, K: 20, XBH: 5 },
  chaseMatch: { K: 40, OUT: 30, FOUL: 20, SINGLE: 10 },
  // 只中方向（cat：猜變化球但沒指定/指定錯種類）
  catExact: { HR: 16, XBH: 25, SINGLE: 20, OUT: 27, FOUL: 10, K: 2 },
  catQuad: { HR: 9, XBH: 17, SINGLE: 22, OUT: 32, FOUL: 15, K: 5 },
  catNear: { SINGLE: 25, XBH: 10, OUT: 35, FOUL: 20, K: 10 },
  catFar: { FOUL: 25, OUT: 35, SINGLE: 10, K: 25, XBH: 5 },
  catChase: { K: 45, OUT: 28, FOUL: 17, SINGLE: 10 },
  // 直球/變化球猜反（miss）
  exactZoneWrongType: { FOUL: 30, OUT: 35, K: 20, SINGLE: 10, XBH: 5 },
  quadWrongType: { K: 30, OUT: 35, FOUL: 20, SINGLE: 13, XBH: 2 },
  nearWrongType: { K: 35, OUT: 35, FOUL: 20, SINGLE: 10 },
  farWrongType: { K: 55, OUT: 30, FOUL: 15 },
  chaseWrongType: { K: 55, OUT: 30, FOUL: 15 },
  protectInZone: { FOUL: 40, SINGLE: 30, OUT: 25, XBH: 5 },
  protectChaseSwing: { FOUL: 50, OUT: 35, K: 15 },
  hitRunInZone: { SINGLE: 30, FOUL: 25, OUT: 30, K: 10, XBH: 5 },
  hitRunChase: { K: 40, FOUL: 30, OUT: 25, SINGLE: 5 },
};

function pickTable(typeLevel, matchClass) {
  const T = BASE_TABLES;
  const grid = {
    species: { exact: T.exactOther, quad: T.quadMatch, near: T.nearMatch, far: T.farMatch, chase: T.chaseMatch },
    cat: { exact: T.catExact, quad: T.catQuad, near: T.catNear, far: T.catFar, chase: T.catChase },
    miss: { exact: T.exactZoneWrongType, quad: T.quadWrongType, near: T.nearWrongType, far: T.farWrongType, chase: T.chaseWrongType },
  };
  return grid[typeLevel]?.[matchClass] || T.farWrongType;
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

// 佈陣修正
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
    if (batterMode === 'lock') {
      scale('OUT', 1.3);
      scale('SINGLE', 0.6);
      scale('HR', 0.9);
      scale('XBH', 0.85);
    } else if (batterMode === 'protect' || batterMode === 'hitrun') {
      // 保護打法反方向推打鑽空檔
      scale('SINGLE', 1.5);
      scale('OUT', 0.8);
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
// 主判定：投球 + 打者反應 → 結果 kind
// batterMode: 'lock' | 'protect' | 'take' | 'bunt' | 'hitrun'
// ------------------------------------------------------------------
export function resolvePitch({
  pitcherZoneTarget,
  pitcherPitchTypeId,
  pitcherStats, // { control, stuff, isFav }
  shift = 'normal',
  batterMode,
  batterGuessCat, // 'fastball' | 'breaking'
  batterGuessSpecies, // 變化球種類（可為 null＝不指定）
  batterGuessZoneKind = 'cell', // 'cell' | 'quad'
  batterGuessZone,
  batterStats,
  strikes = 0,
  forceHung = false, // 投手超時：強制紅中失投
  timing = null, // 揮棒時機分數 0~100（null＝不適用）
}) {
  const isFav = pitcherStats.isFav;
  const actualZoneKey = forceHung
    ? '1-1'
    : computeActualZone(pitcherZoneTarget, pitcherPitchTypeId, pitcherStats.control, isFav);
  const pitchType = PITCH_TYPE_MAP[pitcherPitchTypeId];

  // 觸身球（死球）：瞄內角或壞球區時，控球越差機率越高（疲勞的投手更容易砸到人）
  if (!forceHung) {
    const aimingInside = pitcherZoneTarget === 'waste' || pitcherZoneTarget.split('-')[1] === '0';
    if (aimingInside) {
      const hbpChance = clamp(0.035 - (pitcherStats.control - 50) / 600, 0.008, 0.06);
      if (Math.random() < hbpChance) {
        return {
          kind: 'HBP',
          actualZoneKey: 'out',
          actualZoneLabel: '觸身',
          pitchTypeName: pitchType.name,
          inZone: false,
          hung: false,
        };
      }
    }
  }

  const inZone = actualZoneKey !== 'out';
  // 失投球視為非擅長球的懲罰：跑進紅中的球好打
  const hung = forceHung || (!isFav && actualZoneKey === '1-1' && pitcherZoneTarget !== '1-1');

  // 左右打對決：只微調力量與準度，選球眼／速度不受影響（觸擊、看球邏輯不變）
  const pf = platoonFactor(batterStats.bats, pitcherStats.throws);
  const batterEff = { ...batterStats, power: (batterStats.power ?? 50) * pf, contact: (batterStats.contact ?? 50) * pf };

  let kind;

  if (batterMode === 'take') {
    kind = inZone ? 'CALLED_STRIKE' : 'BALL';
  } else if (batterMode === 'bunt') {
    if (!inZone) {
      // 壞球：依選球眼決定是否收棒
      const pullBack = clamp(0.5 + (batterStats.eye - 50) / 180, 0.3, 0.85);
      if (Math.random() < pullBack) {
        kind = 'BALL';
      } else {
        // 追打壞球觸擊，品質差
        const roll = Math.random();
        if (roll < 0.5) kind = strikes >= 2 ? 'BUNT_K' : 'FOUL';
        else if (roll < 0.85) kind = 'BUNT_OUT_NO_ADV';
        else kind = 'BUNT_SAC';
      }
    } else {
      let skill = clamp(0.6 + (batterStats.contact - 50) / 250, 0.4, 0.8);
      if (timing != null) skill = clamp(skill + (timing - 55) / 300, 0.25, 0.9); // 時機影響觸擊品質
      const roll = Math.random();
      if (roll < skill) kind = 'BUNT_SAC';
      else if (roll < skill + 0.1) kind = 'BUNT_HIT';
      else if (roll < skill + 0.25) kind = strikes >= 2 ? 'BUNT_K' : 'FOUL';
      else kind = 'BUNT_OUT_NO_ADV';
    }
  } else if (batterMode === 'protect' || batterMode === 'hitrun') {
    const tables = batterMode === 'hitrun'
      ? { inZone: BASE_TABLES.hitRunInZone, chase: BASE_TABLES.hitRunChase }
      : { inZone: BASE_TABLES.protectInZone, chase: BASE_TABLES.protectChaseSwing };
    if (!inZone) {
      // 打帶跑必須出棒保護跑者，收棒機率低
      const takeChance = batterMode === 'hitrun'
        ? 0.15
        : clamp(0.55 + (batterStats.eye - 50) / 200, 0.25, 0.85);
      if (Math.random() < takeChance) {
        kind = 'BALL';
      } else {
        let w = applyStatAdjustments(tables.chase, { ...batterEff, stuff: pitcherStats.stuff });
        w = applyShift(w, shift, batterMode);
        w = applyTiming(w, timing);
        kind = weightedPick(w);
      }
    } else {
      let w = applyStatAdjustments(tables.inZone, { ...batterEff, stuff: pitcherStats.stuff });
      w = applyShift(w, shift, batterMode);
      if (hung) {
        w.SINGLE = (w.SINGLE || 0) * 1.4;
        w.XBH = (w.XBH || 0) + 5;
      }
      w = applyTiming(w, timing);
      kind = weightedPick(w);
    }
  } else {
    // lock：猜直球/變化球（可再指定變化球種類）＋ 猜單格或方位
    const typeLevel = classifyType(batterGuessCat, batterGuessSpecies, pitcherPitchTypeId);
    const matchClass = classifyMatch(batterGuessZoneKind, batterGuessZone, actualZoneKey);

    let table;
    if (typeLevel === 'species' && matchClass === 'exact' && actualZoneKey === '1-1') {
      table = BASE_TABLES.exactHeart;
    } else {
      table = pickTable(typeLevel, matchClass);
    }

    let w = applyStatAdjustments(table, { ...batterEff, stuff: pitcherStats.stuff });
    if (isFav && typeLevel === 'species' && (matchClass === 'exact' || matchClass === 'quad' || matchClass === 'near')) {
      w = applyFavNerf(w);
    }
    if (hung && matchClass !== 'chase') {
      // 失投紅中球：即使沒完全猜中也變好打
      w.HR = (w.HR || 0) + 8;
      w.XBH = (w.XBH || 0) + 10;
      w.K = Math.max(0, (w.K || 0) * 0.6);
    }
    w = applyShift(w, shift, batterMode);
    w = applyTiming(w, timing);
    kind = weightedPick(w);
  }

  return {
    kind,
    actualZoneKey,
    actualZoneLabel: zoneLabelOf(actualZoneKey),
    pitchTypeName: pitchType.name,
    inZone,
    hung,
  };
}

// 盜壘判定（球沒被打進場內時觸發）
// 整體約 60%：base 0.60 + 速度修正；投手投壞球區（有防跑意識）-0.15
export function resolveSteal({ runnerSpeed = 50, wastePitch = false, hitAndRun = false, swingMiss = false, heldClose = 0 }) {
  if (hitAndRun && swingMiss) {
    // 打帶跑揮空，跑者暴露在外，幾乎必死
    return Math.random() < 0.2;
  }
  let p = 0.60 + (runnerSpeed - 50) / 250;
  if (wastePitch) p -= 0.15;
  if (hitAndRun) p += 0.1; // 提前起跑
  p -= 0.12 * heldClose; // 剛被牽制回壘：離壘小、起跑晚，最多疊兩次 -24%
  return Math.random() < clamp(p, 0.1, 0.92);
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

      const grounder = Math.random() < 0.6;
      const pos = pick(INFIELD);
      const dir = pick(OUTFIELD);

      if (grounder) {
        s.log = `${pos}方向滾地球出局`;
        s.narration = [`打成滾地球，竄向${pos}方向！`, `${pos}手快步上前接球，順勢長傳一壘——`, '刺殺！打者出局'];
      } else {
        s.log = `${dir}飛球出局`;
        s.narration = [`球被打向${dir}，有點高度……`, `${dir}手退了兩步、站好位置——`, '穩穩收進手套，接殺出局'];
      }

      // 雙殺判定：一壘有人、不滿三出局、滾地球
      if (grounder && s.bases.first && s.outs < 3) {
        let dpChance = 0.4;
        if (shift === 'dp') dpChance = 0.62; // 雙殺佈陣：內野站位守雙殺
        if (mode === 'hitrun') dpChance = 0.05; // 打帶跑跑者已起跑，難以雙殺
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
          break;
        } else if (mode === 'hitrun') {
          // 打帶跑成功破壞雙殺，跑者推進
          s.bases.second = s.bases.second || s.bases.first;
          if (s.bases.second === s.bases.first) s.bases.first = null;
          s.log += '（打帶跑發動，跑者提前起跑上二壘，破壞雙殺）';
          s.narration.push('但跑者早已提前起跑，輕鬆站上二壘——打帶跑破壞了雙殺！');
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
      const style = pick(['strong', 'soft', 'gap']);
      const firstLine =
        style === 'strong' ? `扎實的平飛球，強勁地穿越內野防線，落進${dir}前草皮！`
        : style === 'soft' ? `打得不算扎實……小飛球晃晃悠悠，落在內野手與${dir}手之間的三不管地帶！`
        : `滾地球找到洞了！從野手之間鑽出去，滾進${dir}！`;
      scoreRunner('third');
      scoreRunner('second');
      if (mode === 'hitrun' && s.bases.first) {
        // 打帶跑：一壘跑者多推進一個壘
        s.bases.third = s.bases.first;
        s.bases.first = null;
        s.log = '一壘安打（打帶跑發動，跑者一口氣上三壘！）';
        s.narration = [firstLine, `${dir}手上前處理回傳——但打帶跑的跑者早就過了二壘！`, '跑者頭也不回，一路衝上三壘！漂亮的戰術執行'];
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
          if (mode === 'hitrun') {
            scoreRunner('first'); // 打帶跑跑者直接回本壘
          } else {
            s.bases.third = s.bases.first;
          }
          s.bases.first = null;
        }
        s.bases.second = batterName;
        const hr = mode === 'hitrun' && s.runsThisPlay > 0;
        s.log = hr ? '二壘安打！（打帶跑，跑者狂奔回本壘）' : '二壘安打！';
        s.narration = [
          `強勁的平飛球切進${dir}防區的空檔！`,
          `球一路滾向全壘打牆，${dir}手追到牆邊才撿到球——`,
          hr ? '打帶跑的跑者一路狂奔踩過本壘得分！打者輕鬆站上二壘，二壘安打！' : `打者頭也不回衝上二壘！站立式進壘，二壘安打！${s.runsThisPlay > 0 ? '跑者回來得分！' : ''}`,
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
