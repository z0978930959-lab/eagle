/* ------------------------------------------------------------------
 * 房間聊天室（棒球／賓果／璀璨寶石共用）
 *
 * 訊息存在 room.chat，跟著房間一起過期。刻意做得很輕：
 * 不另開 Redis key、不另設輪詢，前端本來就在輪詢 state，
 * 回應時把 chat 一起帶回去即可。
 * ------------------------------------------------------------------ */

const CHAT_MAX = 60;      // 每房保留最近 60 則
const TEXT_MAX = 200;     // 單則字數上限
const BURST_WINDOW_MS = 10000;
const BURST_MAX = 8;      // 10 秒內同一人最多 8 則，擋洗版

export function pushChat(room, role, rawText) {
  if (typeof rawText !== 'string') throw new Error('BAD_INPUT');

  // 去掉控制字元與前後空白，壓縮過長的連續換行
  const text = rawText
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, TEXT_MAX);
  if (!text) throw new Error('EMPTY_MESSAGE');

  if (!Array.isArray(room.chat)) room.chat = [];

  const now = Date.now();
  const recent = room.chat.filter((m) => m.role === role && now - m.ts < BURST_WINDOW_MS);
  if (recent.length >= BURST_MAX) throw new Error('CHAT_TOO_FAST');

  room.chat.push({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    ts: now,
  });
  if (room.chat.length > CHAT_MAX) room.chat.splice(0, room.chat.length - CHAT_MAX);

  return room.chat;
}

export function chatOf(room) {
  return Array.isArray(room.chat) ? room.chat : [];
}
