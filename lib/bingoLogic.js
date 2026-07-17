/* ------------------------------------------------------------------
 * 賓果對決（獨立於棒球的第二種遊戲模式）
 *
 * 流程：
 *   choose：雙方各拿到三張隨機 5×5 盤面（1~25 不重複填滿），各選一張；
 *           雙方不能是一模一樣的盤（後選者若撞盤會重抽選項）。
 *   rps　 ：猜拳決定先手，平手就再猜。
 *   play　：輪流「圈選」自己盤上的數字——同一個數字在對方盤上也會
 *           同步被圈選，然後換對方。每次圈選後重新計算雙方連線數
 *           （橫 5＋直 5＋斜 2，共 12 條），達成新連線會廣播。
 *           若某方「再圈一個特定數字就能達成五連線」＝聽牌，會告知
 *           對方目前聽幾張（不透露是哪幾張）。
 *   over　：任一方連線數達 5 即終局；同一手雙方同時達標時比連線數，
 *           一樣多＝平手。
 * ------------------------------------------------------------------ */

const LOG_MAX = 30;

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// 產生一張 1~25 洗牌填滿的 5×5 盤面（長度 25 的陣列，index = row*5+col）
function genBoard() {
  const nums = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    let j;
    if (globalThis.crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      globalThis.crypto.getRandomValues(buf);
      j = buf[0] % (i + 1);
    } else {
      j = Math.floor(Math.random() * (i + 1));
    }
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

function genOptions() {
  const opts = [];
  while (opts.length < 3) {
    const b = genBoard();
    if (!opts.some((o) => boardsEqual(o, b))) opts.push(b);
  }
  return opts;
}

function boardsEqual(a, b) {
  if (!a || !b) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// 12 條連線的格子 index 集合（橫 5、直 5、斜 2）
const LINES = (() => {
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

// 已圈數字集合下，這張盤完成幾條連線
export function countLines(board, calledSet) {
  let n = 0;
  for (const line of LINES) {
    if (line.every((idx) => calledSet.has(board[idx]))) n += 1;
  }
  return n;
}

// 聽牌數：再圈「一個」數字就能讓連線數達到 5 的不同數字有幾個
export function tenpaiCount(board, calledSet) {
  if (countLines(board, calledSet) >= 5) return 0;
  let n = 0;
  for (let num = 1; num <= 25; num++) {
    if (calledSet.has(num)) continue;
    const next = new Set(calledSet);
    next.add(num);
    if (countLines(board, next) >= 5) n += 1;
  }
  return n;
}

function pushLog(b, text) {
  b.log.unshift({ text, ts: Date.now() });
  if (b.log.length > LOG_MAX) b.log.length = LOG_MAX;
}

function freshPlayer() {
  return { options: genOptions(), board: null, rps: null, lines: 0, announced: false };
}

export function createBingoRoom({ code, reveal = false }) {
  return {
    code,
    type: 'bingo',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { away: randomToken(), home: null },
    bingo: {
      // 情報規則（開房者決定）：
      //   reveal=true 　公開情報——即時顯示雙方連線數、對方聽牌自動警示
      //   reveal=false　隱藏情報——連線數終局才揭曉、聽牌只有自己知道（可主動宣告）
      reveal: !!reveal,
      phase: 'choose', // choose | rps | play | over
      players: { away: freshPlayer(), home: null },
      turn: null,
      called: [],
      winner: null, // 'away' | 'home' | 'draw'
      rpsRound: 1,
      drawOffer: null, // 平手提議：{ by, status: 'pending' }（接受＝平局終局）
      rpsText: null, // 最近一次猜拳結果敘述
      log: [],
    },
  };
}

export function joinBingoRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.home = randomToken();
  room.bingo.players.home = freshPlayer();
  room.status = 'playing';
  pushLog(room.bingo, '🎲 雙方入座！各自從三張盤面挑一張吧');
  return room;
}

/* ------------ 選盤 ------------ */
export function actBingoChoose(room, role, payload) {
  const b = room.bingo;
  if (b.phase !== 'choose') throw new Error('WRONG_PHASE');
  const me = b.players[role];
  if (!me) throw new Error('NOT_STARTED');
  if (me.board) throw new Error('ALREADY_CHOSEN');
  const idx = payload?.idx;
  if (![0, 1, 2].includes(idx)) throw new Error('BAD_INPUT');

  const other = b.players[role === 'away' ? 'home' : 'away'];
  const chosen = me.options[idx];
  // 雙方不能用一模一樣的盤：撞盤（機率趨近於零）就幫後選者重抽三張
  if (other?.board && boardsEqual(other.board, chosen)) {
    me.options = genOptions();
    throw new Error('BOARD_CLASH');
  }
  me.board = chosen;
  pushLog(b, `✅ ${role === 'away' ? '客隊' : '主隊'}選好盤面了`);

  if (b.players.away?.board && b.players.home?.board) {
    b.phase = 'rps';
    pushLog(b, '✊ 雙方盤面就緒——猜拳決定先手！');
  }
}

/* ------------ 猜拳 ------------ */
const RPS = ['rock', 'paper', 'scissors'];
const RPS_NAME = { rock: '石頭 ✊', paper: '布 ✋', scissors: '剪刀 ✌️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export function actBingoRps(room, role, payload) {
  const b = room.bingo;
  if (b.phase !== 'rps') throw new Error('WRONG_PHASE');
  const me = b.players[role];
  if (me.rps) throw new Error('ALREADY_PICKED');
  const pick = payload?.pick;
  if (!RPS.includes(pick)) throw new Error('BAD_INPUT');
  me.rps = pick;

  const a = b.players.away.rps;
  const h = b.players.home.rps;
  if (!a || !h) return;

  if (a === h) {
    b.rpsText = `第 ${b.rpsRound} 回合：雙方都出${RPS_NAME[a]}——平手，再來！`;
    pushLog(b, `🤜🤛 ${b.rpsText}`);
    b.players.away.rps = null;
    b.players.home.rps = null;
    b.rpsRound += 1;
    return;
  }
  const winner = BEATS[a] === h ? 'away' : 'home';
  b.rpsText = `客隊出${RPS_NAME[a]}、主隊出${RPS_NAME[h]}——${winner === 'away' ? '客隊' : '主隊'}先攻！`;
  pushLog(b, `🎉 ${b.rpsText}`);
  b.turn = winner;
  b.phase = 'play';
}

/* ------------ 圈選 ------------ */
export function actBingoMark(room, role, payload) {
  const b = room.bingo;
  if (b.phase !== 'play') throw new Error('WRONG_PHASE');
  if (b.turn !== role) throw new Error('NOT_YOUR_TURN');
  const num = payload?.num;
  if (!Number.isInteger(num) || num < 1 || num > 25) throw new Error('BAD_INPUT');
  if (b.called.includes(num)) throw new Error('ALREADY_CALLED');

  b.called.push(num);
  const calledSet = new Set(b.called);
  const who = role === 'away' ? '客隊' : '主隊';
  pushLog(b, `⭕ ${who} 圈選了 ${num}（雙方盤面同步圈選）`);

  // 重新計算雙方連線數；公開模式跨越新門檻就播報，隱藏模式終局才揭曉
  for (const r of ['away', 'home']) {
    const p = b.players[r];
    const lines = countLines(p.board, calledSet);
    if (b.reveal && lines > p.lines) {
      const name = r === 'away' ? '客隊' : '主隊';
      pushLog(b, `🔥 ${name} 達成 ${'一二三四五六七八九十'[Math.min(lines, 10) - 1] || lines} 連線！`);
    }
    p.lines = lines;
  }

  const aL = b.players.away.lines;
  const hL = b.players.home.lines;
  if (aL >= 5 || hL >= 5) {
    b.phase = 'over';
    room.status = 'over';
    b.turn = null;
    if (aL === hL) {
      b.winner = 'draw';
      pushLog(b, `🏁 雙方同時達成 ${aL} 連線——平手！`);
    } else {
      b.winner = aL > hL ? 'away' : 'home';
      pushLog(b, `🏆 ${b.winner === 'away' ? '客隊' : '主隊'} 率先達成五連線，獲勝！`);
    }
    return;
  }

  b.turn = role === 'away' ? 'home' : 'away';
}

/* ------------ 提議平手 ------------ */
// 對戰中任一方可按「平手」：對方大屏幕會播出經典畫面（投降輸一半）並選擇
// 是否接受；接受＝雙方平局終局，拒絕＝比賽繼續。
export function actBingoDrawOffer(room, role) {
  const b = room.bingo;
  if (b.phase !== 'play') throw new Error('WRONG_PHASE');
  if (b.drawOffer && b.drawOffer.status === 'pending') throw new Error('DRAW_PENDING');
  b.drawOffer = { by: role, status: 'pending' };
  pushLog(b, `🤝 ${role === 'away' ? '客隊' : '主隊'} 提議平手：「投降輸一半，大家各退一步？」`);
}

export function actBingoDrawRespond(room, role, payload) {
  const b = room.bingo;
  if (!b.drawOffer || b.drawOffer.status !== 'pending') throw new Error('NO_DRAW');
  if (b.drawOffer.by === role) throw new Error('FORBIDDEN');
  const who = role === 'away' ? '客隊' : '主隊';
  if (payload?.accept) {
    b.drawOffer = null;
    b.phase = 'over';
    room.status = 'over';
    b.turn = null;
    b.winner = 'draw';
    pushLog(b, `🤝 ${who} 點頭同意——雙方握手言和，平局收場！`);
  } else {
    b.drawOffer = null;
    pushLog(b, `😤 ${who} 拒絕平手：「打完再說！」比賽繼續！`);
  }
}

/* ------------ 宣告聽牌（心理戰） ------------ */
// 聽牌是隱藏資訊：只有自己看得到。玩家可「主動」宣告，讓對方知道
// 自己聽牌與聽的張數（施壓／嗆聲用）。宣告後持續生效到終局。
export function actBingoAnnounce(room, role) {
  const b = room.bingo;
  if (b.reveal) throw new Error('REVEAL_MODE');
  if (b.phase !== 'play') throw new Error('WRONG_PHASE');
  const me = b.players[role];
  if (me.announced) throw new Error('ALREADY_ANNOUNCED');
  const n = tenpaiCount(me.board, new Set(b.called));
  if (n <= 0) throw new Error('NOT_TENPAI');
  me.announced = true;
  pushLog(b, `📢 ${role === 'away' ? '客隊' : '主隊'} 高調宣告：「我聽牌了——聽 ${n} 張！」`);
}

/* ------------ 視角過濾 ------------ */
// 對方的「選項」與「盤面」都不給看（盤面佈局是戰略資訊：知道對方佈局
// 就能故意避開對方要的數字）；只給對方的進度（是否已選、連線數、聽牌數）。
export function bingoViewFor(room, role) {
  const b = room.bingo;
  const oppRole = role === 'away' ? 'home' : 'away';
  const me = b.players[role];
  const opp = b.players[oppRole];
  const calledSet = new Set(b.called);

  return {
    type: 'bingo',
    code: room.code,
    status: room.status,
    role,
    phase: b.phase,
    myOptions: b.phase === 'choose' && me && !me.board ? me.options : null,
    myBoard: me?.board || null,
    myChosen: !!me?.board,
    oppJoined: !!opp,
    oppChosen: !!opp?.board,
    myRpsPicked: !!me?.rps,
    oppRpsPicked: !!opp?.rps,
    rpsRound: b.rpsRound,
    rpsText: b.rpsText,
    turn: b.turn,
    called: b.called,
    reveal: !!b.reveal,
    // 連線數：公開模式即時提供；隱藏模式只在終局揭曉（避免從網路回應偷看）
    myLines: (b.reveal || b.phase === 'over') && me?.board ? countLines(me.board, calledSet) : null,
    oppLines: (b.reveal || b.phase === 'over') && opp?.board ? countLines(opp.board, calledSet) : null,
    // 聽牌：自己的隨時看得到；對方的——公開模式自動警示，隱藏模式要對方主動宣告
    myTenpai: b.phase === 'play' && me?.board ? tenpaiCount(me.board, calledSet) : 0,
    myAnnounced: !!me?.announced,
    oppAnnounced: !!opp?.announced,
    oppTenpai:
      b.phase === 'play' && opp?.board && (b.reveal || opp?.announced)
        ? tenpaiCount(opp.board, calledSet)
        : 0,
    drawOffer: b.drawOffer || null,
    winner: b.winner,
    log: b.log,
  };
}
