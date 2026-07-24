// 已知業務錯誤代碼白名單。未列出的錯誤一律回傳 INTERNAL，避免下游 lib 的 stack / 連線字串外流。
const SAFE_CODES = new Set([
  'NO_STORE',
  'BAD_INPUT',
  'BAD_CODE',
  'BAD_TEAM',
  'BAD_ACTION',
  'CODE_POOL_BUSY',
  'NOT_FOUND',
  'ROOM_FULL',
  'TEAM_TAKEN',
  'FORBIDDEN',
  'NOT_STARTED',
  'WRONG_PHASE',
  'NOT_YOUR_TURN',
  'INVALID',
  'ALREADY_READY',
  'NO_CHALLENGE',
  'NOT_CHALLENGEABLE',
  'ROOM_BUSY',
  'RATE_LIMITED',
  'LOCK_LOST',
  'NO_RUNNER',
  'PICKOFF_LIMIT',
  // 璀璨寶石
  'GAME_OVER',
  'COIN_PENDING',
  'ALREADY_PICKED',
  'CANNOT_AFFORD',
  'RESERVE_FULL',
  'NOT_ENOUGH_GEMS',
  'BAD_TAKE',
  'NO_CARD',
  'WRONG_MODE',
  // 聊天室
  'CHAT_TOO_FAST',
  'EMPTY_MESSAGE',
]);

export function safeErrorCode(err) {
  const msg = typeof err === 'string' ? err : err?.message;
  return SAFE_CODES.has(msg) ? msg : 'INTERNAL';
}

// 依錯誤碼分派 HTTP 狀態與使用者訊息。避免所有例外都被裹上「另一個動作」文案並回 409。
const STATUS_MAP = {
  ROOM_BUSY: { status: 409, message: '房間正在處理另一個動作，請再試一次' },
  LOCK_LOST: { status: 409, message: '房間狀態有更新，請再試一次' },
  NO_STORE: { status: 500, message: '資料庫尚未設定或連線失敗' },
  BAD_CODE: { status: 400, message: '房號格式錯誤' },
  BAD_INPUT: { status: 400 },
  RATE_LIMITED: { status: 429, message: '操作過於頻繁，請稍候再試' },
  INTERNAL: { status: 500, message: '伺服器內部錯誤' },
  // 共用的流程類錯誤：屬於「狀態不對」而非伺服器故障，應回 409/403/404
  NOT_FOUND: { status: 404, message: '找不到這個房號' },
  FORBIDDEN: { status: 403, message: '沒有這個房間的權限' },
  ROOM_FULL: { status: 409, message: '房間已滿' },
  NOT_STARTED: { status: 409, message: '對局尚未開始' },
  WRONG_PHASE: { status: 409, message: '目前不能做這個動作' },
  NOT_YOUR_TURN: { status: 409, message: '還沒輪到你' },
  BAD_ACTION: { status: 400, message: '不支援的動作' },
  CODE_POOL_BUSY: { status: 503, message: '房號暫時擁擠，請再試一次' },
  // 璀璨寶石：都是玩家可以自行修正的狀況，回 409 並附上白話說明
  GAME_OVER: { status: 409, message: '這局已經結束了' },
  COIN_PENDING: { status: 409, message: '還在猜金幣，尚未開始' },
  ALREADY_PICKED: { status: 409, message: '你已經押過了，不能更改' },
  CANNOT_AFFORD: { status: 409, message: '寶石不足，買不起這張' },
  RESERVE_FULL: { status: 409, message: '保留卡已有 3 張' },
  NOT_ENOUGH_GEMS: { status: 409, message: '寶石庫存不足' },
  BAD_TAKE: { status: 409, message: '這樣拿不符合規則' },
  NO_CARD: { status: 409, message: '這個位置已經沒有卡了' },
  WRONG_MODE: { status: 409, message: '房號對應的是別種遊戲' },
  CHAT_TOO_FAST: { status: 429, message: '發言太快，稍等一下' },
  EMPTY_MESSAGE: { status: 400, message: '訊息不能是空白' },
};

export function errorResponseInfo(err) {
  const code = safeErrorCode(err);
  const spec = STATUS_MAP[code] || { status: 500 };
  return { code, status: spec.status, message: spec.message };
}
