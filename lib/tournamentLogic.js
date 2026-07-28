/* ------------------------------------------------------------------
 * 綜合比賽．賽事外殼
 *
 * 隨機排序 賓果 / E卡 / 17撲克 三場，先贏兩場者奪冠（2:0 提前結束）。
 * 每一場實際對局在各自遊戲的獨立房進行；此外殼只負責賽程、比分、過場。
 *
 * 勝負回報採「雙方一致」：兩人都回報同一位勝者才計分，避免單方誤按。
 * ------------------------------------------------------------------ */

const GAMES = ['bingo', 'ecard', 'poker'];
const WIN_NEED = 2;

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function randInt(n) {
  if (globalThis.crypto?.getRandomValues) {
    const b = new Uint32Array(1);
    globalThis.crypto.getRandomValues(b);
    return b[0] % n;
  }
  return Math.floor(Math.random() * n);
}
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createTournamentRoom({ code }) {
  return {
    code,
    type: 'tournament',
    status: 'waiting',
    createdAt: Date.now(),
    tokens: { a: randomToken(), b: null },
    chat: [],
    tn: {
      schedule: shuffle(GAMES), // 隨機三場順序
      currentIndex: 0,
      wins: { a: 0, b: 0 },
      results: [null, null, null], // 每場勝者
      champion: null,
      matchStage: 'intro', // intro | playing
      subRoom: null, // 這一場的子遊戲房號（由玩家填入或共用）
      reports: { a: null, b: null }, // 本場雙方回報的勝者
    },
  };
}

export function tournamentRoleOf(room, token) {
  if (!token) return null;
  if (room.tokens.a === token) return 'a';
  if (room.tokens.b && room.tokens.b === token) return 'b';
  return null;
}

export function joinTournamentRoom(room) {
  if (room.status !== 'waiting') throw new Error('ROOM_FULL');
  room.tokens.b = randomToken();
  room.status = 'playing';
  return { seat: 'b', token: room.tokens.b };
}

// 從過場進入該場對局
export function tournamentAdvance(room, role) {
  const tn = room.tn;
  if (tn.champion) throw new Error('SERIES_OVER');
  if (tn.matchStage === 'intro') {
    tn.matchStage = 'playing';
  }
}

// 設定這一場的子房號（供對方加入用）
export function tournamentSetSubRoom(room, role, subRoom) {
  const tn = room.tn;
  if (typeof subRoom === 'string' && /^\d{4}$/.test(subRoom)) {
    tn.subRoom = subRoom;
  }
}

// 回報本場勝者；雙方一致才計分並推進
export function tournamentReport(room, role, winner) {
  const tn = room.tn;
  if (tn.champion) throw new Error('SERIES_OVER');
  if (winner !== 'a' && winner !== 'b') throw new Error('BAD_INPUT');
  tn.reports[role] = winner;

  // 雙方都回報且一致 → 計分
  if (tn.reports.a && tn.reports.b) {
    if (tn.reports.a === tn.reports.b) {
      const w = tn.reports.a;
      tn.results[tn.currentIndex] = w;
      tn.wins[w] += 1;
      tn.reports = { a: null, b: null };
      tn.subRoom = null;

      if (tn.wins[w] >= WIN_NEED) {
        tn.champion = w; // 2:0 或 2:1 奪冠
      } else {
        tn.currentIndex += 1;
        tn.matchStage = 'intro';
      }
    } else {
      // 回報不一致 → 清空重報
      tn.reports = { a: null, b: null };
      throw new Error('REPORT_MISMATCH');
    }
  }
}

export function tournamentViewFor(room, role) {
  const tn = room.tn;
  const opp = role === 'a' ? 'b' : 'a';
  return {
    type: 'tournament',
    code: room.code,
    status: room.status,
    role,
    oppJoined: !!room.tokens.b,
    schedule: tn.schedule.slice(),
    currentIndex: tn.currentIndex,
    wins: { ...tn.wins },
    results: tn.results.slice(),
    champion: tn.champion,
    matchStage: tn.matchStage,
    subRoom: tn.subRoom,
    myReport: tn.reports[role],
    oppReported: !!tn.reports[opp],
    winNeed: WIN_NEED,
  };
}
