// ── 回聲 · 山區中繼電台 ──────────────────────────────
// 路徑：foshan/lib/echo.js
//
// 核心機制：發電機最大負載兩路。四條迴路只能同時開兩條。
// 一次性：取得任何結局後永久鎖定。中途離開保留進度。

export const ECHO_REQ_LV = 0;

export const CIRCUITS = [
  { id:'A', name:'照明', desc:'全站燈光' },
  { id:'B', name:'機房', desc:'盤帶機、發射機' },
  { id:'C', name:'門禁', desc:'資料庫電磁鎖' },
  { id:'D', name:'暖氣', desc:'全站暖氣' },
];
export const MAX_LOAD = 2;

// ── 開場 ────────────────────────────────
export const INTRO = [
  '車開不上來了。最後兩公里你是走的。',
  '推開鐵門，暖氣是開的，燈也亮著。但站裡沒有人。',
  '值班日誌停在三天前。桌上的咖啡結了一層冰。',
  '發射機的指示燈是滅的——這個電台已經停播三天了。',
  '而山下沒有任何人上來查。',
];

// ── 場景 ────────────────────────────────
// img 是函式時，依電力狀態回傳不同的圖
export const SCENES = {
  duty: {
    title:'值班室',
    img: p => p.includes('A') ? '/echo/duty_room.png' : '/echo/duty_room.png',
    text: p => p.includes('D')
      ? ['暖氣還在運轉，室溫勉強能待。窗外是暴雪。']
      : ['暖氣停了。溫度掉得很快，窗玻璃開始結霜。'],
    spots:[
      { id:'desk',    label:'書桌' },
      { id:'logbook', label:'值班日誌' },
      { id:'window',  label:'窗戶' },
      { id:'mirror',  label:'鏡子' },
      { id:'drawer',  label:'抽屜' },
      { id:'radio',   label:'收音機' },
    ],
    exits:[{ to:'hall', label:'走廊' }],
  },
  hall: {
    title:'走廊',
    img: p => p.includes('A') ? '/echo/hall_lit.png' : '/echo/hall_dark.png',
    text: p => p.includes('A')
      ? ['日光燈管在頭頂閃了兩下。牆上掛著配電盤和公佈欄。']
      : ['一片黑。你打開手電筒，光圈掃過牆面——牆上有東西在發光。'],
    spots:[
      { id:'panel',  label:'配電盤' },
      { id:'notice', label:'公佈欄' },
      { id:'glow',   label:'牆面', hideWhen: p => p.includes('A') },
    ],
    exits:[
      { to:'duty',    label:'值班室' },
      { to:'booth',   label:'播音室' },
      { to:'archive', label:'資料庫' },
      { to:'tower',   label:'天線塔底' },
    ],
  },
  booth: {
    title:'播音室',
    img: () => '/echo/booth.png',
    text: p => p.includes('B')
      ? ['ON AIR 的燈亮著，但發射機還沒訊號。隔音牆吸掉了所有聲音。']
      : ['ON AIR 的燈是滅的。安靜到你聽得見自己的耳鳴。'],
    spots:[
      { id:'mic',      label:'麥克風' },
      { id:'playlist', label:'排播單' },
      { id:'turntable',label:'唱盤' },
    ],
    exits:[{ to:'hall', label:'走廊' }, { to:'control', label:'控制室' }],
  },
  control: {
    title:'控制室',
    img: p => p.includes('B') ? '/echo/control_lit.png' : '/echo/control_dark.png',
    text: p => p.includes('B')
      ? ['機櫃上的指示燈一排排亮起來，VU 表的針輕輕抖動。']
      : ['所有指示燈都是滅的。機器像一整面黑色的牆。'],
    spots:[
      { id:'tapemachine', label:'盤帶機' },
      { id:'freq',        label:'頻率轉盤' },
      { id:'chart',       label:'電碼對照表' },
      { id:'floor',       label:'地板' },
    ],
    exits:[{ to:'booth', label:'播音室' }],
  },
  archive: {
    title:'資料庫',
    img: () => '/echo/archive.png',
    text: () => ['金屬層架上排著一箱一箱的盤帶，每一箱的標籤都是空白的。'],
    spots:[
      { id:'tapes',   label:'帶庫' },
      { id:'roster',  label:'值班表' },
      { id:'locker',  label:'鐵櫃' },
    ],
    exits:[{ to:'hall', label:'走廊' }],
    needC:true,
  },
  tower: {
    title:'天線塔底',
    img: () => '/echo/tower_base.png',
    text: () => ['半開放的水泥基座，雪從缺口灌進來，在地上積了一層。'],
    spots:[
      { id:'junction', label:'接線盒' },
      { id:'mainsw',   label:'總開關' },
    ],
    exits:[{ to:'hall', label:'走廊' }],
  },
};

// ── 道具 ────────────────────────────────
export const ITEMS = {
  torch:     { name:'手電筒', img:'/echo/item_torch.png', view:'老式橡膠外殼手電筒。電池蓋是開的，裡面空的。' },
  torchOn:   { name:'手電筒', img:'/echo/item_torch.png', view:'裝好電池了，光很暗但夠用。' },
  battery:   { name:'電池',   img:'/echo/item_battery.png', view:'兩顆舊的一號電池，其中一顆的正極有點鏽。' },
  key:       { name:'鐵櫃鑰匙', img:'/echo/item_key.png', view:'一把扁平的鋼製櫃鎖鑰匙，沒有標籤。' },
  connector: { name:'N-型接頭', img:'/echo/item_connector.png', view:'黃銅色的同軸接頭，螺紋還很完整。' },
  tape:      { name:'無標籤盤帶', img:'/echo/item_tape.png', view:'七吋盤帶，標籤是空白的。帶子有點鬆。' },
  manual:    { name:'維修手冊', img:'/echo/manual_fixed.png', view:'拼好的維修手冊。有一條步驟被藍筆劃掉重寫了。' },
};

// ── 一次性 ──────────────────────────────
// ── 排播單（推導播帶順序用）──────────────
export const RUNDOWN = [
  { t:'22:00', s:'台呼' },
  { t:'22:05', s:'夜間音樂' },
  { t:'01:30', s:'氣象通報' },
  { t:'02:55', s:'測試訊號' },
  { t:'03:00', s:'例行回報' },
];

export const TAPES = [
  { id:'call', name:'台呼' },
  { id:'test', name:'測試訊號' },
  { id:'form', name:'例行回報範本' },
];
export const TAPE_ORDER = ['call','test','form'];

// 播錯時的儀表回饋（不說答案，只說機器怎麼反應）
export const TAPE_FAIL = {
  first:'VU 表的針彈到底就卡住了。發射機沒有認這捲帶。',
  mid:'針抖了兩下就掉回零。順序不對，機器不吃。',
};

// ── 掃頻 ────────────────────────────────
// 訊號在 [SIG_LO, SIG_HI] 之間；玩家只看得到強度條
export const SIG_LO = 62, SIG_HI = 66;

// ── 摩斯訊號（避開對照表上錯誤的 J L P Y）──
export const MORSE_WORD = 'ECHO';
export const MORSE_TRACE = [
  ['·'],
  ['—','·','—','·'],
  ['·','·','·','·'],
  ['—','—','—'],
];

// ── 鐵櫃第二層：四格字母轉盤 ──────────────
export const DIAL_LEN = 4;

// ── 前值機員的檔案 ──────────────────────
export const FILE_LINES = [
  '人事資料卡。照片被撕掉了，只剩四個圖釘孔。',
  '姓名欄空白。職務：夜間值機員。',
  '到職日期那一欄，被人用原子筆反覆描過，紙都破了。',
  '底下的備註寫著：本站呼號 ECHO。單人值勤。無輪替。',
];

// ── 鏡中藏字（程式渲染，不出圖）──────────
export const MIRROR_HIDDEN = [
  '前面那些是寫給總台看的。',
  '我已經寫了一千零四十三次。',
  '每次回報完，天就亮，然後又是這一夜。',
  '別讓它活過今晚。',
];

// ── 03:00 ───────────────────────────────
export const VOICE_LINES = [
  '「……有人在嗎。」',
  '「這裡是中繼站。呼號 ECHO。」',
  '「總台在等回報了。三點整。」',
  '「範本在帶庫裡。唸完就好，很快。」',
];
export const VOICE_PROBE = [
  '「你看過窗戶了嗎。」',
  '「那個數字，你算過是多久嗎。」',
  '「饋線不是斷的。是我剪的。」',
  '「……我剪了很多次。每一次天亮，它又是好的。」',
  '「所以我後來就不剪了。我照著唸。唸完就能睡。」',
  '「你自己決定。」',
];

export const LOCK_ON_EXIT = false;

export const ENDINGS = {
  shift: { name:'接班', reward:2, img:'/echo/ending_shift.png', lines:[
    '你照著範本唸完回報。總台回了一聲確認，很短，像是早就知道你會說什麼。',
    '發射機的燈穩定亮著。暴雪停了，窗外開始亮。',
    '你在值班室的床上醒來。',
    '日誌停在三天前。桌上的咖啡結了一層冰。',
    '無線電裡有雜訊。偶爾，雜訊中間會有人說話。',
    '現在那個聲音是你的。',
  ]},
  descent: { name:'下山', reward:2, img:'/echo/ending_descent.png', lines:[
    '你沒有回報。你推開鐵門走進雪裡。',
    '走了四個小時，天亮的時候，你看見山下的燈。',
    '你回頭。',
    '山上那座塔的紅燈還亮著。',
    '它還在等人接班。總台派上來的下一個人，明天就會推開那扇門。',
  ]},
  silence: { name:'靜默', reward:5, best:true, img:'/echo/ending_silence.png', lines:[
    '你雙手握住那支紅色的閘刀，往下拉。',
    '塔頂的紅燈熄了。無線電的雜訊斷在一半。',
    '整座山安靜下來。',
    '「……謝謝。」',
    '那是他最後說的話。',
    '天亮後，總台的紀錄上，這個站點被標記為永久失效。',
    '不會再有人被派上來了。',
  ]},
};

export const INITIAL = {
  cleared:false, locked:false, ending:null,
  scene:'intro', sub:null, held:null,
  power:['A','D'],
  bag:[], notes:[], flags:{},
};
