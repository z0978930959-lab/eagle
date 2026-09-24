import { neon } from '@neondatabase/serverless';
import { ppokerPlayerOf, ppokerViewFor, markSeen, checkPpokerAbandonment, forfeitPpokerPlayer } from '@/lib/ppoker';
import { initPpokerSettlements, finalizePpokerPayout } from '@/lib/ppokerSettle';

// ── 夢幻樂園 · 精準預測撲克 · 查詢狀態　路徑：foshan/app/api/ppoker/state/route.js
// POST { code, token } → 前端每 1.5~2 秒輪詢一次。
//
// 跟 E 卡的 state 路由一樣的邏輯：這支「順便」記一下這個座位剛剛還在，也「順便」
// 檢查其他座位是不是已經沉默超過門檻——若是，直接判棄權，不用等對方送下一個動作。
// 一手接一手最多 5 個人，這裡用迴圈把「這一輪偵測到的所有沉默座位」一次處理完，
// 而不是像 E 卡兩人對戰那樣只需要處理一個。

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NOCACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };

function connString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
}
function db() {
  const url = connString();
  if (!url) throw new Error('尚未設定資料庫。');
  return neon(url);
}

export async function POST(req) {
  try {
    const { code, token, spectate } = await req.json();
    if (!code || (!token && !spectate)) return Response.json({ error: '缺少參數' }, { status: 400, headers: NOCACHE });
    const sql = db();
    await initPpokerSettlements(sql);

    // ── 觀戰：純讀取，不需要玩家身分，也不做任何寫入（不記 lastSeen、不判棄權、
    // 不觸發結算）。ppokerViewFor 傳 null token 進去，天生就會回傳「沒有個人資訊」
    // 的安全視角（沒有 myHole、沒有 myTurn），直接沿用即可，不用另外寫一個函式。
    if (spectate && !token) {
      const rows = await sql`SELECT room FROM ppoker_rooms WHERE code = ${code}`;
      if (!rows.length) return Response.json({ error: '房間不存在或已過期。' }, { status: 404, headers: NOCACHE });
      return Response.json({ ok: true, view: ppokerViewFor(rows[0].room, null) }, { headers: NOCACHE });
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const rows = await sql`SELECT room, version FROM ppoker_rooms WHERE code = ${code}`;
      if (!rows.length) return Response.json({ error: '房間不存在或已過期。' }, { status: 404, headers: NOCACHE });
      const room = rows[0].room;

      const idx = ppokerPlayerOf(room, token);
      if (idx === -1) return Response.json({ error: '沒有權限查看這個房間。' }, { status: 403, headers: NOCACHE });

      markSeen(room, token);
      for (let guard = 0; guard < 5; guard++) {
        const silent = checkPpokerAbandonment(room, token);
        if (!silent) break;
        forfeitPpokerPlayer(room, silent, 'timeout');
      }
      await finalizePpokerPayout(sql, code, room);

      const upd = await sql`
        UPDATE ppoker_rooms SET room=${JSON.stringify(room)}, version=version+1, updated_at=NOW()
        WHERE code=${code} AND version=${rows[0].version} RETURNING version`;
      if (upd.length > 0) {
        return Response.json({ ok: true, view: ppokerViewFor(room, token) }, { headers: NOCACHE });
      }
      // 版本衝突：重讀最新狀態再試一次；就算搶輸也沒關係，下一次輪詢（1.5 秒後）還會再檢查。
    }
    const rows = await sql`SELECT room FROM ppoker_rooms WHERE code = ${code}`;
    if (!rows.length) return Response.json({ error: '房間不存在或已過期。' }, { status: 404, headers: NOCACHE });
    const idx = ppokerPlayerOf(rows[0].room, token);
    if (idx === -1) return Response.json({ error: '沒有權限查看這個房間。' }, { status: 403, headers: NOCACHE });
    return Response.json({ ok: true, view: ppokerViewFor(rows[0].room, token) }, { headers: NOCACHE });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: NOCACHE });
  }
}
