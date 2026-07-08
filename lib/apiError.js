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
};

export function errorResponseInfo(err) {
  const code = safeErrorCode(err);
  const spec = STATUS_MAP[code] || { status: 500 };
  return { code, status: spec.status, message: spec.message };
}
