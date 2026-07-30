/* ------------------------------------------------------------------
 * 貼圖共用邏輯（17 撲克／E 卡／密語連線共用）
 *
 * 設計重點：
 *
 * 1) 不設任何次數或間隔限制——雙方可以同時按，也可以連發。
 *
 * 2) 每個座位各有自己的欄位。舊版兩人共用一格，雙方同時按時
 *    先送的那張會被沖掉，看起來就像「按了沒反應」。
 *
 * 3) ★ 計數器掛在 room 上，不是掛在各遊戲的狀態物件（room.ec / room.pk / room.ms）。
 *    BO3 換場時 startGame() 會整個重建那些物件，掛在裡面的 seq 會歸零；
 *    前端是用「seq 是否和上次相同」判斷這是不是同一張貼圖，seq 一歸零就會
 *    和前端記住的舊值撞號，新貼圖被當成舊的直接略過 → 第二場之後按了沒反應。
 *    改掛在 room 上，整個房間生命週期內單調遞增，換場也不會重來。
 *
 * 4) 視野只回傳「還新鮮」的貼圖。這樣重新整理頁面時，不會把幾分鐘前
 *    的舊貼圖又彈出來一次。
 * ------------------------------------------------------------------ */

// 超過這個時間就不再送給前端。前端顯示時間是 2～3 秒，輪詢約 1.6 秒一次，
// 8 秒的餘裕足夠雙方都收到，又不至於讓過期的貼圖復活。
const FRESH_MS = 8000;

/**
 * 記錄一張貼圖。
 * @param {object} room  房間物件（狀態存放處，換場不會被重建）
 * @param {string} seat  座位 'a' | 'b'
 * @param {string} name  貼圖名稱（呼叫端須先用自己的白名單驗過）
 */
export function putSticker(room, seat, name) {
  room.stickers = room.stickers || { a: null, b: null };
  room.stickerSeq = (room.stickerSeq || 0) + 1;
  room.stickers[seat] = { seat, role: seat, name, ts: Date.now(), seq: room.stickerSeq };
}

/** 取出要塞進視野的貼圖（過期的以 null 回傳）。 */
export function stickerView(room) {
  const s = room.stickers || { a: null, b: null };
  const now = Date.now();
  const fresh = (x) => (x && now - x.ts < FRESH_MS ? x : null);
  return { a: fresh(s.a), b: fresh(s.b) };
}
