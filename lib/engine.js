import { PITCH_TYPES, ZONE_ROWS, ZONE_COLS } from '../data/teams.js';

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

function classifyMatch(guessZone, actualZoneKey) {
  if (actualZoneKey === 'out') return 'chase';
  if (guessZone === actualZoneKey) return 'exact';
  const [gr, gc] = guessZone.split('-').map(Number);
  const [ar, ac] = actualZoneKey.split('-').map(Number);
  if (gr === ar || gc === ac) return 'near';
  return 'far';
}

const BASE_TABLES = {
  exactHeart: { HR: 65, XBH: 25, OUT: 8, FOUL: 2 },
  exactOther: { HR: 28, XBH: 30, OUT: 32, FOUL: 10 },
  nearMatch: { SINGLE: 35, XBH: 15, OUT: 30, FOUL: 15, K: 5 },
  farMatch: { FOUL: 30, OUT: 35, SINGLE: 10, K: 20, XBH: 5 },
  chaseMatch: { K: 40, OUT: 30, FOUL: 20, SINGLE: 10 },
  exactZoneWrongType: { FOUL: 30, OUT: 35, K: 20, SINGLE: 10, XBH: 5 },
  nearWrongType: { K: 35, OUT: 35, FOUL: 20, SINGLE: 10 },
  farWrongType: { K: 55, OUT: 30, FOUL: 15 },
  chaseWrongType: { K: 55, OUT: 30, FOUL: 15 },
  protectInZone: { FOUL: 40, SINGLE: 30, OUT: 25, XBH: 5 },
  protectChaseSwing: { FOUL: 50, OUT: 35, K: 15 },
  hitRunInZone: { SINGLE: 30, FOUL: 25, OUT: 30, K: 10, XBH: 5 },
  hitRunChase: { K: 40, FOUL: 30, OUT: 25, SINGLE: 5 },
};

function pickTable(typeMatch, matchClass) {
  if (typeMatch) {
    if (matchClass === 'near') return BASE_TABLES.nearMatch;
    if (matchClass === 'far') return BASE_TABLES.farMatch;
    if (matchClass === 'chase') return BASE_TABLES.chaseMatch;
  } else {
    if (matchClass === 'exact') return BASE_TABLES.exactZoneWrongType;
    if (matchClass === 'near') return BASE_TABLES.nearWrongType;
    if (matchClass === 'far') return BASE_TABLES.farWrongType;
    if (matchClass === 'chase') return BASE_TABLES.chaseWrongType;
  }
  return BASE_TABLES.farWrongType;
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
  batterGuessTypeId,
  batterGuessZone,
  batterStats,
  strikes = 0,
}) {
  const isFav = pitcherStats.isFav;
  const actualZoneKey = computeActualZone(pitcherZoneTarget, pitcherPitchTypeId, pitcherStats.control, isFav);
  const pitchType = PITCH_TYPE_MAP[pitcherPitchTypeId];
  const inZone = actualZoneKey !== 'out';
  // 失投球視為非擅長球的懲罰：跑進紅中的球好打
  const hung = !isFav && actualZoneKey === '1-1' && pitcherZoneTarget !== '1-1';

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
      const skill = clamp(0.6 + (batterStats.contact - 50) / 250, 0.4, 0.8);
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
        let w = applyStatAdjustments(tables.chase, { ...batterStats, stuff: pitcherStats.stuff });
        w = applyShift(w, shift, batterMode);
        kind = weightedPick(w);
      }
    } else {
      let w = applyStatAdjustments(tables.inZone, { ...batterStats, stuff: pitcherStats.stuff });
      w = applyShift(w, shift, batterMode);
      if (hung) {
        w.SINGLE = (w.SINGLE || 0) * 1.4;
        w.XBH = (w.XBH || 0) + 5;
      }
      kind = weightedPick(w);
    }
  } else {
    // lock
    const typeMatch = batterGuessTypeId === pitcherPitchTypeId;
    const matchClass = classifyMatch(batterGuessZone, actualZoneKey);

    let table;
    if (typeMatch && matchClass === 'exact') {
      table = actualZoneKey === '1-1' ? BASE_TABLES.exactHeart : BASE_TABLES.exactOther;
    } else {
      table = pickTable(typeMatch, matchClass);
    }

    let w = applyStatAdjustments(table, { ...batterStats, stuff: pitcherStats.stuff });
    if (isFav && typeMatch && (matchClass === 'exact' || matchClass === 'near')) {
      w = applyFavNerf(w);
    }
    if (hung && matchClass !== 'chase') {
      // 失投紅中球：即使沒完全猜中也變好打
      w.HR = (w.HR || 0) + 8;
      w.XBH = (w.XBH || 0) + 10;
      w.K = Math.max(0, (w.K || 0) * 0.6);
    }
    w = applyShift(w, shift, batterMode);
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
export function resolveSteal({ runnerSpeed = 50, wastePitch = false, hitAndRun = false, swingMiss = false }) {
  if (hitAndRun && swingMiss) {
    // 打帶跑揮空，跑者暴露在外，幾乎必死
    return Math.random() < 0.2;
  }
  let p = 0.60 + (runnerSpeed - 50) / 250;
  if (wastePitch) p -= 0.15;
  if (hitAndRun) p += 0.1; // 提前起跑
  return Math.random() < clamp(p, 0.1, 0.92);
}

const OUT_FLAVORS = ['游擊滾地球出局', '二壘方向滾地球出局', '中外野高飛球出局', '一壘附近軟弱飛球出局', '三壘滾地球出局', '投手前軟弱滾地球出局'];
const GROUNDER_FLAVORS = ['游擊滾地球', '二壘方向滾地球', '三壘滾地球'];

export function flavorFor(kind) {
  if (kind === 'OUT') return OUT_FLAVORS[Math.floor(Math.random() * OUT_FLAVORS.length)];
  return null;
}

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
        if (s.bases.first && s.bases.second && s.bases.third) s.runsThisPlay += 1;
        if (s.bases.second && s.bases.first) s.bases.third = s.bases.third || s.bases.second;
        if (s.bases.first) s.bases.second = s.bases.second || s.bases.first;
        s.bases.first = batterName;
        s.balls = 0;
        s.strikes = 0;
        s.log = '四壞球保送';
        s.paEnded = true;
      } else {
        s.log = `壞球（${s.balls}壞）`;
      }
      break;
    }
    case 'CALLED_STRIKE':
    case 'K': {
      s.strikes += 1;
      if (s.strikes >= 3) {
        s.outs += 1;
        s.log = kind === 'K' ? '三振（揮棒落空）' : '三振（看著好球）';
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
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    case 'BUNT_OUT_NO_ADV': {
      s.outs += 1;
      s.log = '觸擊太強，投手快速處理，跑者無法推進';
      // 小機率點成雙殺（衝太前的跑者被抓）
      if (s.bases.first && s.outs < 3 && Math.random() < 0.12) {
        s.outs += 1;
        s.bases.first = null;
        s.log = '觸擊點成小飛球，一壘跑者回不去，雙殺！';
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
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    case 'OUT': {
      s.outs += 1;
      s.log = flavorFor('OUT');
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;

      const grounder = Math.random() < 0.6;

      // 雙殺判定：一壘有人、不滿三出局、滾地球
      if (grounder && s.bases.first && s.outs < 3) {
        let dpChance = 0.4;
        if (mode === 'hitrun') dpChance = 0.05; // 打帶跑跑者已起跑，難以雙殺
        const runnerSpeedAdj = ((opts.runnerOnFirstSpeed ?? 50) - 50) / 400;
        dpChance -= runnerSpeedAdj;
        if (Math.random() < clamp(dpChance, 0.02, 0.6)) {
          s.outs += 1;
          s.bases.first = null;
          s.log = `${GROUNDER_FLAVORS[Math.floor(Math.random() * GROUNDER_FLAVORS.length)]}，6-4-3 雙殺打！`;
          s.doublePlay = true;
          break;
        } else if (mode === 'hitrun') {
          // 打帶跑成功破壞雙殺，跑者推進
          s.bases.second = s.bases.second || s.bases.first;
          if (s.bases.second === s.bases.first) s.bases.first = null;
          s.log += '（打帶跑發動，跑者提前起跑上二壘，破壞雙殺）';
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
        } else if (shift === 'infield_in' && grounder) {
          s.log += '（內野趨前守住，三壘跑者不敢跑）';
        }
      }
      break;
    }
    case 'SINGLE': {
      scoreRunner('third');
      scoreRunner('second');
      if (mode === 'hitrun' && s.bases.first) {
        // 打帶跑：一壘跑者多推進一個壘
        s.bases.third = s.bases.first;
        s.bases.first = null;
        s.log = '一壘安打（打帶跑發動，跑者一口氣上三壘！）';
      } else {
        s.bases.second = s.bases.first;
        s.bases.first = null;
        s.log = '一壘安打';
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
      scoreRunner('third');
      scoreRunner('second');
      if (isTriple) {
        scoreRunner('first');
        s.bases.third = batterName;
        s.log = '三壘安打！';
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
        s.log = mode === 'hitrun' && s.runsThisPlay > 0 ? '二壘安打！（打帶跑，跑者狂奔回本壘）' : '二壘安打！';
      }
      s.balls = 0;
      s.strikes = 0;
      s.paEnded = true;
      s.ballInPlay = true;
      break;
    }
    case 'HR': {
      scoreRunner('first');
      scoreRunner('second');
      scoreRunner('third');
      s.runsThisPlay += 1;
      s.bases = { first: null, second: null, third: null };
      s.balls = 0;
      s.strikes = 0;
      s.log = '全壘打！！';
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
    s.outs += 1;
    s.log = `${runnerName} 盜${baseName}失敗，被觸殺出局`;
  }
  return s;
}
