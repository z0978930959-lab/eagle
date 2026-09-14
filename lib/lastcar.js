// ── 末班車 · 23:47 ── 密室逃脫副本資料檔
// 路徑：foshan/lib/lastcar.js
//
// 【核心設定】
// 三年前 11/03，23:47 的末班車在北町－安樂區間隧道追撞，車沒有抵達終點站。
// 系統紀錄上這班車「行程未完成」，而末班車規則是未完成即返回起站重新發車。
// 主角當晚睡著坐過站，事故時仍在車上。他的車票沒被回收 = 行程沒結束。
// 要離開，必須手動把這班車開到安樂，讓行程完成。

export const LASTCAR_REQ_LV = 0;   // 0 等即可進入

// 一次性規則：取得任何結局後永久鎖定，不可再進入。
// 中途離開會保留進度，下次從斷點接回（避免玩家卡住就永久失敗）。
// 若要改成「一離開就鎖」，把下面改成 true。
export const LOCK_ON_EXIT = false;

export const INTRO_LINES = [
  '你是被冷醒的。',
  '車廂的空調開得太強，日光燈白得刺眼。你揉了揉脖子，才發現整節車廂只剩你一個人。',
  '窗外是隧道。黑的。',
  '你低頭看手錶——沒有電了。指針停在快接近午夜的位置。',
  '你想起來了：你在末班車上睡著了。',
  '你坐過站了。',
];

// ── 答案 ────────────────────────────────
export const LOCKER_CODE = '372';   // 車票：第3車 7排 2號
export const CAB_CODE    = '2347';  // 末班車發車時刻 23:47
export const TRUE_STATION = '安樂';
export const STATIONS = ['中央','河堤','舊市場','文昌','圓環','水源','北町','安樂'];

// ── 場景 ────────────────────────────────
// 線索圖（圖沒載入也不影響通關，關鍵數字同時進自動筆記）
export const CLUE_IMG = {
  ticket:    '/lastcar/clue_ticket.png',
  timetable: '/lastcar/clue_timetable.png',
  routemap:  '/lastcar/clue_routemap.png',
  log:       '/lastcar/clue_log.png',
};

export const SCENES = {
  seat: { img:'/lastcar/seat.png', title:'座位',
    text:['你坐著的位置旁邊，掉了一張車票。'] },
  car:  { img:'/lastcar/car.png', title:'車廂',
    text:['末班車還在跑。廣播沒有響，車也沒有慢下來的意思。','窗外的隧道一直沒有結束。'] },
  cab:  { img:'/lastcar/cab.png', title:'駕駛室',
    text:['沒有人。','駕駛座是空的，椅背上掛著一件外套。','儀表板上，速度是穩定的。下一站顯示欄——是空白的。'] },
};

// ── 熱點（兩把鎖一開始就看得見）──────────
export const CAR_HOTSPOTS = [
  { id:'locker',    label:'遺失物櫃',     desc:'車廂角落的鐵櫃。門上是三位數的轉盤鎖。標籤寫著：遺失物置物櫃／編號規則：車廂－排－座' },
  { id:'keypad',    label:'駕駛室門',     desc:'通往駕駛室的門。旁邊是四位數字鍵盤，紅燈亮著。' },
  { id:'routemap',  label:'路線圖燈箱',   desc:'車門上方的燈箱路線圖。' },
  { id:'timetable', label:'時刻表',       desc:'牆上貼著今晚的發車時刻表，邊角捲起來了。' },
  { id:'window',    label:'車窗',         desc:'玻璃上映著整節車廂。' },
  { id:'handle',    label:'緊急開門把手', desc:'紅色的把手，上面寫著「非緊急時請勿使用」。' },
];

export const CAB_HOTSPOTS = [
  { id:'log',    label:'行車紀錄',   desc:'儀表板側邊的小螢幕，還亮著。' },
  { id:'panel',  label:'插座蓋板',   desc:'儀表板下方有一片金屬蓋板，鎖著。上面印著「維修用電源」。' },
  { id:'dial',   label:'目的地轉盤', desc:'一個機械式的轉盤，上面刻著這條線的所有站名。指針停在中間，沒有指向任何一站。' },
  { id:'jacket', label:'外套',       desc:'一件站務員的外套。' },
];

// ── 道具（圖必須長得像用途）──────────────
export const ITEMS = {
  ticket: { name:'車票',     img:'/lastcar/item_ticket.png',
    view:'一張皺掉的單程票。發車時間被打票機打糊了，只看得出前面是 23 點。票根還在——沒有被回收過。' },
  key:    { name:'維修鑰匙', img:'/lastcar/item_key.png',
    view:'一把很小的黃銅鑰匙，上面刻著「維修蓋板　MAINT」。' },
  manual: { name:'站務手冊', img:'/lastcar/item_manual.png',
    view:'一本磨損的深藍色薄手冊，共三頁。' },
  phone:  { name:'手機',     img:'/lastcar/item_phone.png',
    view:'螢幕全黑。按了半天沒反應，完全沒電。' },
};

// ── 線索內容（關鍵數字用文字渲染，不要燒進 PNG）──
export const TICKET = { depart:'2 3 : ▓ ▓', car:3, row:7, seat:2, to:'安樂',
  note:'（發車時間被打票機打糊了，只看得出前面是 23 點）' };

export const TIMETABLE = [
  { time:'23:05', last:false },
  { time:'23:19', last:false },
  { time:'23:33', last:false },
  { time:'23:47', last:true  },
];

export const ROUTEMAP_NOTE =
  '有人用原子筆，在「安樂」上面畫了一個圈。筆跡很用力，圈了好幾遍，紙都快破了。';
export const ROUTEMAP_NOTE2 =
  '你盯著那個圈看了很久。那個筆跡……你認得。';   // 已看過手機後才顯示

export const MANUAL_PAGES = [
  { n:1, title:'夜間行車作業手冊',
    text:'末班車由駕駛室手動設定終點站。班次抵達所設定之終點站後，該次行程始告完成。' },
  { n:2, title:'駕駛室門禁',
    text:'密碼為該班次之發車時刻，四位數字，不含冒號。例：22:10 發車之班次，密碼為 2210。' },
  { n:3, title:'未完成行程之處理',
    text:'班次若因故未抵達所設定之終點站，該次行程視為未完成。未完成之班次將自動返回起站重新發車，車上乘客之車票不予回收，直至該次行程完成為止。' },
];

// 駕駛室行車紀錄：補上事故因果的關鍵物證
export const LOG_SCREEN = {
  rows: [
    { t:'11/03　23:47', s:'發車　　中央 → 安樂' },
    { t:'11/04　00:12', s:'北町－安樂 區間　異常停止' },
  ],
  status: '本次行程　　尚未完成',
  after: '螢幕右下角有一行小字：本紀錄自事件發生後未再更新。',
};

export const JACKET_TEXT = [
  '一件站務員的外套，還掛在椅背上。',
  '胸前的名牌被撕掉了，只剩下兩個釘孔。',
  '口袋裡是空的。',
];

export const WINDOW_TEXT = [
  '玻璃上映著整節車廂——空著的座位、拉環、日光燈。',
  '你數了一遍，映出來的座位一張不少。',
  '只是你剛剛坐的那一張，上面沒有人。',
];
export const WINDOW_AGAIN = '你不想再看第二次了。';

export const LOCKER_OPEN_TEXT = [
  '喀。櫃門彈開了。',
  '裡面有：一支沒電的手機、一把小鑰匙、一本站務手冊。',
  '手機的殼——跟你身上那支的殼，一模一樣。',
];

export const PHONE_ON = {
  clock:'23:47',
  from:'媽',
  msg:'到安樂站傳個訊息給我，我在出口等你。',
  date:'11 月 3 日',
  note:'（螢幕上的日期，是三年前的今天。）',
  after:'你摸了摸自己的口袋。那個形狀還在，但你拿不出來。',
};

// ── 自動筆記：看過就記，玩家永遠不用抄 ──
export const NOTES = {
  ticket:    '車票：第 3 車 / 7 排 / 2 號 / 往 安樂 / 發車 23:▓▓（票根未被回收）',
  locker:    '遺失物櫃：編號規則 = 車廂－排－座',
  timetable: '時刻表：23:05 / 23:19 / 23:33 / 23:47（末班）',
  manual1:   '手冊 p.1：抵達所設定之終點站後，行程才算完成',
  manual2:   '手冊 p.2：駕駛室密碼 = 該班次發車時刻，四位數',
  manual3:   '手冊 p.3：行程未完成 → 返回起站重新發車，車票不回收',
  routemap:  '路線圖：「安樂」被人用力圈了好幾遍',
  log:       '行車紀錄：11/03 23:47 發車往安樂，00:12 於北町－安樂區間異常停止。本次行程尚未完成',
  phone:     '手機訊息（三年前 11/03）：到安樂站傳訊息給我，我在出口等你',
};

// ── 分級錯誤回饋（上一版只有「沒有反應」，這是最大殺手）──
export function checkCode(input, answer) {
  if (input === answer) return { ok:true, msg:'' };
  const sameSet = [...input].sort().join('') === [...answer].sort().join('');
  if (sameSet) return { ok:false, msg:'數字都對，但順序不對。' };
  const hit = [...input].filter((c,i) => c === answer[i]).length;
  if (hit >= answer.length - 1) return { ok:false, msg:'差一個數字。' };
  if (hit >= 1) return { ok:false, msg:'有數字是對的，但不夠。' };
  return { ok:false, msg:'完全沒有反應。方向可能錯了。' };
}

// ── 結局 ────────────────────────────────
export const ENDINGS = {
  1: { name:'到站', reward:5, best:true, img:'/lastcar/ending_home.png', lines:[
    '指針卡進「安樂」。儀表板上的紅字跳了一下，換成了新的一行：本次行程　已完成。',
    '車開始慢下來。窗外的黑褪成灰，然後是月台的燈。',
    '門開了。',
    '出口那裡站著一個人，撐著傘。三年了，她每天都來，每天都站到最後一班車開走。',
    '她往車廂裡看了很久。好像沒看到什麼，又好像看到了。',
    '你走下車。',
    '票根從你手裡滑出去，落在月台上。這一次，有人會把它收走。',
  ]},
  2: { name:'再一班', reward:2, img:'/lastcar/ending_loop.png', lines:[
    '指針卡進去了。車確實慢了下來，門也開了。',
    '但月台是空的，燈牌上寫的是「中央」。',
    '儀表板的紅字沒有變：本次行程　尚未完成。',
    '門關上，車又開了起來。窗外還是隧道。',
    '你回到座位上坐下。手裡的車票還在，票根一次也沒被撕過。',
    '你從口袋裡摸出一支原子筆，走到車門前，在路線圖的「安樂」上面用力圈了一個圈。',
    '圈了好幾遍，深到紙都快破了。',
    '這樣下一次的你，也許會看見。',
  ]},
  3: { name:'隧道', reward:2, img:'/lastcar/ending_tunnel.png', lines:[
    '把手比想像中好拉。',
    '門在時速七十公里下打開了，風灌進來，把你的車票捲走了。',
    '隧道的牆壁在旁邊高速掠過。你認得這一段——北町到安樂之間。',
    '三年前，車就是停在這裡的。',
    '你跳了下去。',
    '這班車再也不會抵達終點了。它會一直開下去，而你留在這一段隧道裡，',
    '每天晚上聽它從頭頂上開過去，一次，又一次。',
  ]},
};

export const INITIAL = {
  cleared:false, locked:false, ending:null,
  scene:'intro', sub:null, held:null,
  bag:[], notes:[], manualPage:1, hintStage:{},
  flags:{ stood:false, lockerOpen:false, cabOpen:false,
          panelOpen:false, phoneOn:false, sawWindow:false, sawLog:false },
};
