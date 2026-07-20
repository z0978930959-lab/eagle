// ------------------------------------------------------------------
// CPBL 2026 球隊資料（示意用）
// 球員為 2026 賽季真實名單為主軸，但「能力數值」「部分板凳/牛棚補位球員」
// 是依球風/一般評價換算或補足陣容深度用的遊戲參考值，並非官方精確數據。
// 要調整平衡直接改數字即可（1~99）。
//
// 投手欄位：control 控球、stuff 球威、fav 擅長球路（陣列）、throws 投球手（'R'/'L'）
//   role: 'SP' 先發 / 'RP' 中繼 / 'CL' 終結者
//   foreign: true 表示洋將（僅作情報顯示用，不做名額限制，保持操作單純）
// 打者欄位：power 力量、contact 準度、eye 選球眼、speed 速度、bats 打擊手（'R'/'L'/'S' 左右開弓）
//   legend: true ＝隊史傳奇代打（板凳首位、⭐ 標記），打擊三圍（力量/準度/選球）保證隊上最佳；
//   速度依球員風格設定不追求最高。恰恰、森林王子、鋒哥、高國輝、大師兄、洪總各鎮一隊。
//   9 棒打線＋DH 制（投手不打擊，等同全隊都用指定打擊代打投手棒次）
//
// 左右打對決：打者與投手同邊（同為左/左或右/右）小幅劣勢，
// 異邊（左打對右投、右打對左投，或左右開弓恆為異邊）小幅優勢。
// 這是自動計算的隱藏加成，玩家操作方式不受影響。
// ------------------------------------------------------------------

export const TEAMS = [
  {
    id: 'brothers',
    name: '中信兄弟',
    short: '兄弟',
    color: '#f7b500',
    pitchers: [
      { name: '羅戈', role: 'SP', control: 72, stuff: 80, fav: ['fastball', 'slider'], throws: 'R', foreign: true },
      { name: '呂彥青', role: 'RP', control: 70, stuff: 72, fav: ['change'], throws: 'L' },
      { name: '王凱程', role: 'RP', control: 68, stuff: 74, fav: ['slider'], throws: 'R' },
      { name: '李振昌', role: 'CL', control: 66, stuff: 84, fav: ['fastball', 'fork'], throws: 'R' },
    ],
    batters: [
      { name: '王威晨', pos: '三壘', power: 55, contact: 74, eye: 70, speed: 76, bats: 'L' },
      { name: '陳俊秀', pos: '一壘', power: 70, contact: 72, eye: 68, speed: 40, bats: 'R' },
      { name: '宋晟睿', pos: '外野', power: 66, contact: 72, eye: 64, speed: 74, bats: 'R' },
      { name: '曾頌恩', pos: '指定打擊', power: 70, contact: 64, eye: 58, speed: 56, bats: 'R' },
      { name: '詹子賢', pos: '外野', power: 72, contact: 62, eye: 60, speed: 48, bats: 'R' },
      { name: '江坤宇', pos: '游擊', power: 58, contact: 78, eye: 74, speed: 72, bats: 'R' },
      { name: '高宇杰', pos: '捕手', power: 62, contact: 68, eye: 64, speed: 42, bats: 'R' },
      { name: '岳東華', pos: '二壘', power: 60, contact: 72, eye: 68, speed: 70, bats: 'R' },
      { name: '許庭綸', pos: '外野', power: 50, contact: 66, eye: 60, speed: 76, bats: 'L' },
    ],
    bench: [
      { name: '⭐彭政閔', pos: '傳奇‧一壘', power: 80, contact: 88, eye: 88, speed: 56, bats: 'R', legend: true },
      { name: '許基宏', pos: '一壘', power: 74, contact: 66, eye: 68, speed: 38, bats: 'R' },
      { name: '張志豪', pos: '外野', power: 60, contact: 70, eye: 66, speed: 64, bats: 'L' },
    ],
  },
  {
    id: 'lions',
    name: '統一7-ELEVEn獅',
    short: '統一獅',
    color: '#f5821f',
    pitchers: [
      { name: '布雷克', role: 'SP', control: 76, stuff: 82, fav: ['fastball', 'curve'], throws: 'R', foreign: true },
      { name: '王振瑋', role: 'RP', control: 70, stuff: 70, fav: ['change'], throws: 'L' },
      { name: '邱浩鈞', role: 'RP', control: 70, stuff: 68, fav: ['slider'], throws: 'R' },
      { name: '陳韻文', role: 'CL', control: 64, stuff: 82, fav: ['fastball', 'slider'], throws: 'R' },
    ],
    batters: [
      { name: '林佳緯', pos: '外野', power: 54, contact: 72, eye: 66, speed: 78, bats: 'L' },
      { name: '邱智呈', pos: '外野', power: 54, contact: 76, eye: 68, speed: 70, bats: 'L' },
      { name: '陳傑憲', pos: '外野', power: 72, contact: 82, eye: 76, speed: 70, bats: 'L' },
      { name: '蘇智傑', pos: '指定打擊', power: 72, contact: 66, eye: 60, speed: 56, bats: 'L' },
      { name: '陳鏞基', pos: '一壘', power: 72, contact: 68, eye: 66, speed: 36, bats: 'R' },
      { name: '陳聖平', pos: '游擊', power: 60, contact: 74, eye: 68, speed: 68, bats: 'R' },
      { name: '潘傑楷', pos: '三壘', power: 58, contact: 70, eye: 66, speed: 64, bats: 'L' },
      { name: '陳重羽', pos: '捕手', power: 56, contact: 64, eye: 62, speed: 44, bats: 'R' },
      { name: '許哲晏', pos: '二壘', power: 50, contact: 70, eye: 64, speed: 66, bats: 'R' },
    ],
    bench: [
      { name: '⭐張泰山', pos: '傳奇‧三壘', power: 88, contact: 84, eye: 78, speed: 46, bats: 'R', legend: true },
      { name: '林泓弦', pos: '內野', power: 56, contact: 74, eye: 70, speed: 68, bats: 'R' },
      { name: '朱迦恩', pos: '外野', power: 58, contact: 66, eye: 60, speed: 72, bats: 'L' },
    ],
  },
  {
    id: 'monkeys',
    name: '樂天桃猿',
    short: '桃猿',
    color: '#7a1f2b',
    pitchers: [
      { name: '威能帝', role: 'SP', control: 70, stuff: 78, fav: ['fastball', 'change'], throws: 'R', foreign: true },
      { name: '林子崴', role: 'RP', control: 68, stuff: 72, fav: ['slider'], throws: 'L' },
      { name: '陳柏豪', role: 'RP', control: 64, stuff: 72, fav: ['fork'], throws: 'R' },
      { name: '陳冠宇', role: 'CL', control: 70, stuff: 78, fav: ['fastball', 'slider'], throws: 'L' },
    ],
    batters: [
      { name: '林立', pos: '外野', power: 76, contact: 74, eye: 68, speed: 72, bats: 'R' },
      { name: '陳晨威', pos: '外野', power: 60, contact: 68, eye: 62, speed: 84, bats: 'L' },
      { name: '道威聖', pos: '外野', power: 74, contact: 70, eye: 64, speed: 66, bats: 'L', foreign: true },
      { name: '林泓育', pos: '指定打擊', power: 66, contact: 68, eye: 64, speed: 34, bats: 'R' },
      { name: '林子偉', pos: '二壘', power: 62, contact: 76, eye: 74, speed: 76, bats: 'L' },
      { name: '李勛傑', pos: '一壘', power: 78, contact: 62, eye: 58, speed: 50, bats: 'R' },
      { name: '劉子杰', pos: '三壘', power: 54, contact: 70, eye: 68, speed: 62, bats: 'R' },
      { name: '宋嘉翔', pos: '捕手', power: 54, contact: 60, eye: 58, speed: 48, bats: 'R' },
      { name: '馬傑森', pos: '游擊', power: 62, contact: 64, eye: 58, speed: 64, bats: 'R' },
    ],
    bench: [
      { name: '⭐陳金鋒', pos: '傳奇‧外野', power: 92, contact: 82, eye: 80, speed: 56, bats: 'R', legend: true },
      { name: '林政華', pos: '外野', power: 52, contact: 66, eye: 60, speed: 70, bats: 'R' },
      { name: '梁家榮', pos: '內野', power: 62, contact: 68, eye: 62, speed: 54, bats: 'R' },
    ],
  },
  {
    id: 'guardians',
    name: '富邦悍將',
    short: '悍將',
    color: '#4a90d9',
    pitchers: [
      { name: '李東洺', role: 'SP', control: 78, stuff: 74, fav: ['fastball', 'fork'], throws: 'R' },
      { name: '張奕', role: 'RP', control: 70, stuff: 76, fav: ['fastball', 'slider'], throws: 'R' },
      { name: '廖任磊', role: 'RP', control: 62, stuff: 76, fav: ['fastball'], throws: 'R' },
      { name: '曾峻岳', role: 'CL', control: 66, stuff: 86, fav: ['fastball', 'slider'], throws: 'R' },
    ],
    batters: [
      { name: '池恩齊', pos: '外野', power: 48, contact: 70, eye: 64, speed: 80, bats: 'L' },
      { name: '林澤彬', pos: '游擊', power: 52, contact: 70, eye: 66, speed: 68, bats: 'R' },
      { name: '張育成', pos: '三壘', power: 80, contact: 68, eye: 66, speed: 58, bats: 'R' },
      { name: '范國宸', pos: '一壘', power: 66, contact: 72, eye: 68, speed: 48, bats: 'L' },
      { name: '申皓瑋', pos: '外野', power: 64, contact: 66, eye: 60, speed: 70, bats: 'R' },
      { name: '林岱安', pos: '捕手', power: 54, contact: 70, eye: 66, speed: 46, bats: 'R' },
      { name: '王念好', pos: '指定打擊', power: 56, contact: 70, eye: 66, speed: 62, bats: 'R' },
      { name: '王苡丞', pos: '外野', power: 54, contact: 66, eye: 60, speed: 68, bats: 'R' },
      { name: '董子恩', pos: '二壘', power: 52, contact: 70, eye: 64, speed: 72, bats: 'L' },
    ],
    bench: [
      { name: '⭐高國輝', pos: '傳奇‧外野', power: 90, contact: 76, eye: 72, speed: 54, bats: 'L', legend: true },
      { name: '蔡佳諺', pos: '外野', power: 50, contact: 66, eye: 60, speed: 74, bats: 'L' },
      { name: '林書逸', pos: '內野', power: 52, contact: 68, eye: 64, speed: 66, bats: 'L' },
    ],
  },
  {
    id: 'dragons',
    name: '味全龍',
    short: '味全龍',
    color: '#c8102e',
    pitchers: [
      { name: '魔神龍', role: 'SP', control: 68, stuff: 80, fav: ['fastball', 'fork'], throws: 'R', foreign: true },
      { name: '陳冠偉', role: 'RP', control: 66, stuff: 76, fav: ['fastball', 'slider'], throws: 'R' },
      { name: '林子昱', role: 'RP', control: 70, stuff: 68, fav: ['change'], throws: 'R' },
      { name: '林凱威', role: 'CL', control: 68, stuff: 82, fav: ['fastball', 'slider'], throws: 'R' },
    ],
    batters: [
      { name: '郭天信', pos: '外野', power: 60, contact: 74, eye: 70, speed: 82, bats: 'L' },
      { name: '劉基鴻', pos: '三壘', power: 62, contact: 78, eye: 70, speed: 60, bats: 'R' },
      { name: '張政禹', pos: '游擊', power: 48, contact: 70, eye: 66, speed: 74, bats: 'L' },
      { name: '吉力吉撈．鞏冠', pos: '捕手', power: 74, contact: 70, eye: 64, speed: 40, bats: 'R' },
      { name: '李凱威', pos: '二壘', power: 50, contact: 78, eye: 72, speed: 78, bats: 'L' },
      { name: '劉俊緯', pos: '內野', power: 52, contact: 68, eye: 64, speed: 72, bats: 'R' },
      { name: '陳子豪', pos: '外野', power: 74, contact: 68, eye: 64, speed: 56, bats: 'L' },
      { name: '蔣少宏', pos: '捕手', power: 56, contact: 64, eye: 60, speed: 46, bats: 'R' },
      { name: '張祐嘉', pos: '外野', power: 52, contact: 68, eye: 64, speed: 70, bats: 'L' },
    ],
    bench: [
      { name: '⭐林智勝', pos: '傳奇‧內野', power: 90, contact: 80, eye: 74, speed: 50, bats: 'R', legend: true },
      { name: '王順和', pos: '外野', power: 54, contact: 68, eye: 62, speed: 66, bats: 'R' },
      { name: '曾聖安', pos: '外野', power: 56, contact: 66, eye: 60, speed: 72, bats: 'L' },
    ],
  },
  {
    id: 'hawks',
    name: '台鋼雄鷹',
    short: '雄鷹',
    color: '#00a19a',
    pitchers: [
      { name: '坎南', role: 'SP', control: 74, stuff: 78, fav: ['fastball', 'change'], throws: 'R', foreign: true },
      { name: '施子謙', role: 'RP', control: 72, stuff: 68, fav: ['slider'], throws: 'R' },
      { name: '韋宏亮', role: 'RP', control: 62, stuff: 74, fav: ['fastball'], throws: 'R' },
      { name: '林詩翔', role: 'CL', control: 64, stuff: 80, fav: ['fastball', 'fork'], throws: 'R' },
    ],
    batters: [
      { name: '曾子祐', pos: '游擊', power: 60, contact: 80, eye: 70, speed: 72, bats: 'R' },
      { name: '王博玄', pos: '外野', power: 54, contact: 70, eye: 64, speed: 80, bats: 'R' },
      { name: '吳念庭', pos: '三壘', power: 64, contact: 76, eye: 70, speed: 58, bats: 'L' },
      { name: '魔鷹', pos: '指定打擊', power: 86, contact: 64, eye: 58, speed: 48, bats: 'R', foreign: true },
      { name: '王柏融', pos: '外野', power: 74, contact: 76, eye: 70, speed: 50, bats: 'L' },
      { name: '陳文杰', pos: '外野', power: 58, contact: 74, eye: 66, speed: 74, bats: 'R' },
      { name: '郭阜林', pos: '一壘', power: 66, contact: 62, eye: 56, speed: 48, bats: 'R' },
      { name: '陳世嘉', pos: '捕手', power: 52, contact: 62, eye: 58, speed: 44, bats: 'R' },
      { name: '林家鋐', pos: '二壘', power: 46, contact: 64, eye: 60, speed: 74, bats: 'R' },
    ],
    bench: [
      { name: '⭐洪一中', pos: '傳奇‧捕手', power: 88, contact: 82, eye: 74, speed: 40, bats: 'R', legend: true },
      { name: '曾昱磬', pos: '內野', power: 52, contact: 64, eye: 58, speed: 72, bats: 'R' },
      { name: '紀慶然', pos: '外野', power: 56, contact: 66, eye: 60, speed: 68, bats: 'L' },
    ],
  },
];

export const PITCH_TYPES = [
  { id: 'fastball', name: '直球', tag: '快速直球', drift: 0.10, breakDir: null },
  { id: 'slider', name: '滑球', tag: '橫向位移', drift: 0.24, breakDir: 'outer' },
  { id: 'curve', name: '曲球', tag: '大幅落差', drift: 0.28, breakDir: 'low' },
  { id: 'fork', name: '指叉球', tag: '低角度墜落', drift: 0.34, breakDir: 'low' },
  { id: 'change', name: '變速球', tag: '節奏欺敵', drift: 0.20, breakDir: 'low' },
];

export const ROLE_NAMES = { SP: '先發', RP: '中繼', CL: '終結者' };

export const SHIFTS = [
  { id: 'normal', name: '正常佈陣', desc: '無修正' },
  { id: 'infield_in', name: '內野趨前', desc: '封鎖三壘跑者回壘得分，但安打率略升' },
  { id: 'pull', name: '拉打佈陣', desc: '剋制強拉猜球的大棒，但保護打法容易鑽空檔' },
  { id: 'dp', name: '雙殺佈陣', desc: '一壘有人時滾地球更容易做成雙殺，但安打與長打略增' },
];

// 打者「猜方位」用的四個 2×2 象限（範圍廣但擊球掌握度降低）
export const QUADS = [
  { id: 'hi_in', name: '內角偏高', cells: ['0-0', '0-1', '1-0', '1-1'] },
  { id: 'hi_out', name: '外角偏高', cells: ['0-1', '0-2', '1-1', '1-2'] },
  { id: 'lo_in', name: '內角偏低', cells: ['1-0', '1-1', '2-0', '2-1'] },
  { id: 'lo_out', name: '外角偏低', cells: ['1-1', '1-2', '2-1', '2-2'] },
];

// 3x3 好球帶（橫: 內/中/外，直: 高/中/低）
export const ZONE_COLS = ['內角', '中間', '外角'];
export const ZONE_ROWS = ['高', '中', '低'];

export function zoneId(row, col) {
  return `${row}-${col}`;
}

// 判斷一組 3x3 好球帶格子是否為「邊相鄰相連」的單一連通塊
// 4-connectivity BFS：每個格子與上下左右鄰居才算相連（對角不算）
export function isCellsContiguous(cells) {
  if (!Array.isArray(cells) || cells.length <= 1) return true;
  const set = new Set(cells);
  const start = cells[0];
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const [r, c] = queue.shift().split('-').map(Number);
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nk = `${r + dr}-${c + dc}`;
      if (set.has(nk) && !visited.has(nk)) {
        visited.add(nk);
        queue.push(nk);
      }
    }
  }
  return visited.size === cells.length;
}

export function zoneLabel(row, col) {
  if (row === 1 && col === 1) return '紅中';
  return `${ZONE_ROWS[row]}${ZONE_COLS[col] === '中間' ? '中路' : ZONE_COLS[col]}`;
}

export function batsLabel(bats) {
  if (bats === 'L') return '左打';
  if (bats === 'S') return '左右開弓';
  return '右打';
}

export function throwsLabel(throwsHand) {
  return throwsHand === 'L' ? '左投' : '右投';
}
