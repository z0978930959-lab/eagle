// ------------------------------------------------------------------
// CPBL 2026 球隊資料（示意用）
// 球員為 2026 賽季真實名單，但「能力數值」是依球風/一般評價換算的
// 遊戲參考值，並非官方精確數據。要調整平衡直接改數字即可（1~99）。
//
// 投手欄位：control 控球、stuff 球威、fav 擅長球路（陣列）
//   role: 'SP' 先發 / 'RP' 中繼 / 'CL' 終結者
// 打者欄位：power 力量、contact 準度、eye 選球眼、speed 速度
// ------------------------------------------------------------------

export const TEAMS = [
  {
    id: 'brothers',
    name: '中信兄弟',
    short: '兄弟',
    color: '#f7b500',
    pitchers: [
      { name: '羅戈', role: 'SP', control: 72, stuff: 80, fav: ['fastball', 'slider'] },
      { name: '呂彥青', role: 'RP', control: 70, stuff: 72, fav: ['change'] },
      { name: '李振昌', role: 'CL', control: 66, stuff: 84, fav: ['fastball', 'fork'] },
    ],
    batters: [
      { name: '江坤宇', pos: '游擊', power: 58, contact: 78, eye: 74, speed: 72 },
      { name: '王威晨', pos: '三壘', power: 55, contact: 74, eye: 70, speed: 76 },
      { name: '岳東華', pos: '二壘', power: 60, contact: 70, eye: 66, speed: 70 },
      { name: '許基宏', pos: '一壘', power: 68, contact: 66, eye: 68, speed: 40 },
      { name: '高宇杰', pos: '捕手', power: 62, contact: 68, eye: 64, speed: 42 },
      { name: '張志豪', pos: '外野', power: 60, contact: 72, eye: 68, speed: 66 },
      { name: '宋晟睿', pos: '外野', power: 64, contact: 70, eye: 62, speed: 74 },
    ],
    bench: [
      { name: '詹子賢', pos: '外野', power: 72, contact: 62, eye: 60, speed: 48 },
      { name: '陳文杰', pos: '內野', power: 50, contact: 74, eye: 68, speed: 78 },
    ],
  },
  {
    id: 'lions',
    name: '統一7-ELEVEn獅',
    short: '統一獅',
    color: '#f5821f',
    pitchers: [
      { name: '布雷克', role: 'SP', control: 76, stuff: 82, fav: ['fastball', 'curve'] },
      { name: '髙塩將樹', role: 'RP', control: 72, stuff: 70, fav: ['slider'] },
      { name: '陳韻文', role: 'CL', control: 64, stuff: 82, fav: ['fastball', 'slider'] },
    ],
    batters: [
      { name: '陳傑憲', pos: '外野', power: 72, contact: 82, eye: 76, speed: 70 },
      { name: '林泓弦', pos: '游擊', power: 56, contact: 74, eye: 70, speed: 68 },
      { name: '陳鏞基', pos: '指定打擊', power: 74, contact: 68, eye: 66, speed: 38 },
      { name: '高國麟', pos: '一壘', power: 66, contact: 70, eye: 64, speed: 44 },
      { name: '林安可', pos: '捕手', power: 68, contact: 66, eye: 62, speed: 50 },
      { name: '陳聖平', pos: '三壘', power: 58, contact: 72, eye: 66, speed: 66 },
      { name: '蘇智傑', pos: '外野', power: 70, contact: 64, eye: 58, speed: 56 },
    ],
    bench: [
      { name: '林岱安', pos: '捕手', power: 54, contact: 70, eye: 66, speed: 46 },
      { name: '郭阜林', pos: '內野', power: 68, contact: 60, eye: 56, speed: 50 },
    ],
  },
  {
    id: 'monkeys',
    name: '樂天桃猿',
    short: '桃猿',
    color: '#7a1f2b',
    pitchers: [
      { name: '威能帝', role: 'SP', control: 70, stuff: 78, fav: ['fastball', 'change'] },
      { name: '陳克羿', role: 'RP', control: 72, stuff: 70, fav: ['slider'] },
      { name: '朱承洋', role: 'CL', control: 62, stuff: 80, fav: ['fastball', 'fork'] },
    ],
    batters: [
      { name: '林立', pos: '外野', power: 76, contact: 74, eye: 68, speed: 72 },
      { name: '林子偉', pos: '游擊', power: 62, contact: 76, eye: 74, speed: 76 },
      { name: '成晉', pos: '外野', power: 58, contact: 78, eye: 70, speed: 74 },
      { name: '馬傑森', pos: '一壘', power: 70, contact: 62, eye: 58, speed: 62 },
      { name: '林泓育', pos: '捕手', power: 66, contact: 66, eye: 64, speed: 34 },
      { name: '陳晨威', pos: '外野', power: 60, contact: 68, eye: 62, speed: 84 },
      { name: '林承飛', pos: '三壘', power: 54, contact: 70, eye: 66, speed: 64 },
    ],
    bench: [
      { name: '梁家榮', pos: '內野', power: 62, contact: 68, eye: 62, speed: 54 },
      { name: '何品室融', pos: '外野', power: 52, contact: 72, eye: 66, speed: 80 },
    ],
  },
  {
    id: 'guardians',
    name: '富邦悍將',
    short: '悍將',
    color: '#4a90d9',
    pitchers: [
      { name: '李東洺', role: 'SP', control: 74, stuff: 76, fav: ['fastball', 'fork'] },
      { name: '張奕', role: 'RP', control: 70, stuff: 76, fav: ['fastball', 'slider'] },
      { name: '曾峻岳', role: 'CL', control: 66, stuff: 86, fav: ['fastball', 'slider'] },
    ],
    batters: [
      { name: '張育成', pos: '指定打擊', power: 80, contact: 68, eye: 66, speed: 58 },
      { name: '范國宸', pos: '一壘', power: 66, contact: 72, eye: 68, speed: 48 },
      { name: '戴培峰', pos: '捕手', power: 60, contact: 68, eye: 64, speed: 52 },
      { name: '王念好', pos: '三壘', power: 56, contact: 70, eye: 66, speed: 62 },
      { name: '林哲瑄', pos: '外野', power: 58, contact: 74, eye: 72, speed: 68 },
      { name: '江少慶', pos: '外野', power: 62, contact: 66, eye: 60, speed: 60 },
      { name: '李凱威', pos: '二壘', power: 50, contact: 76, eye: 70, speed: 78 },
    ],
    bench: [
      { name: '董子恩', pos: '內野', power: 52, contact: 70, eye: 64, speed: 72 },
      { name: '申皓瑋', pos: '外野', power: 64, contact: 64, eye: 58, speed: 70 },
    ],
  },
  {
    id: 'dragons',
    name: '味全龍',
    short: '味全龍',
    color: '#c8102e',
    pitchers: [
      { name: '魔神龍', role: 'SP', control: 68, stuff: 80, fav: ['fastball', 'fork'] },
      { name: '蔣銲', role: 'RP', control: 70, stuff: 72, fav: ['curve'] },
      { name: '呂偉晟', role: 'CL', control: 64, stuff: 78, fav: ['slider'] },
    ],
    batters: [
      { name: '朱育賢', pos: '一壘', power: 78, contact: 66, eye: 62, speed: 36 },
      { name: '陳子豪', pos: '指定打擊', power: 74, contact: 68, eye: 64, speed: 56 },
      { name: '吉力吉撈．鞏冠', pos: '外野', power: 70, contact: 70, eye: 66, speed: 54 },
      { name: '郭天信', pos: '外野', power: 60, contact: 74, eye: 70, speed: 82 },
      { name: '岳政華', pos: '外野', power: 56, contact: 72, eye: 68, speed: 70 },
      { name: '林祐樂', pos: '游擊', power: 54, contact: 70, eye: 66, speed: 62 },
      { name: '嚴宏鈞', pos: '捕手', power: 58, contact: 64, eye: 60, speed: 48 },
    ],
    bench: [
      { name: '劉基鴻', pos: '內野', power: 64, contact: 64, eye: 60, speed: 58 },
      { name: '張政禹', pos: '內野', power: 48, contact: 70, eye: 66, speed: 74 },
    ],
  },
  {
    id: 'hawks',
    name: '台鋼雄鷹',
    short: '雄鷹',
    color: '#00a19a',
    pitchers: [
      { name: '坎南', role: 'SP', control: 72, stuff: 76, fav: ['fastball', 'change'] },
      { name: '櫻井周斗', role: 'RP', control: 68, stuff: 74, fav: ['slider'] },
      { name: '林詩翔', role: 'CL', control: 64, stuff: 80, fav: ['fastball', 'fork'] },
    ],
    batters: [
      { name: '魔鷹', pos: '外野', power: 84, contact: 62, eye: 58, speed: 52 },
      { name: '王柏融', pos: '指定打擊', power: 74, contact: 76, eye: 70, speed: 50 },
      { name: '吳念庭', pos: '三壘', power: 62, contact: 72, eye: 68, speed: 60 },
      { name: '王政順', pos: '一壘', power: 60, contact: 68, eye: 64, speed: 56 },
      { name: '陳文杰', pos: '外野', power: 58, contact: 70, eye: 66, speed: 72 },
      { name: '王博玄', pos: '二壘', power: 54, contact: 68, eye: 64, speed: 66 },
      { name: '張仁碩', pos: '游擊', power: 52, contact: 70, eye: 66, speed: 68 },
    ],
    bench: [
      { name: '曾子祐', pos: '內野', power: 54, contact: 70, eye: 64, speed: 70 },
      { name: '顏郁軒', pos: '內野', power: 58, contact: 66, eye: 60, speed: 60 },
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
];

// 3x3 好球帶（橫: 內/中/外，直: 高/中/低）
export const ZONE_COLS = ['內角', '中間', '外角'];
export const ZONE_ROWS = ['高', '中', '低'];

export function zoneId(row, col) {
  return `${row}-${col}`;
}

export function zoneLabel(row, col) {
  if (row === 1 && col === 1) return '紅中';
  return `${ZONE_ROWS[row]}${ZONE_COLS[col] === '中間' ? '中路' : ZONE_COLS[col]}`;
}
