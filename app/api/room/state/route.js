import { NextResponse } from 'next/server';
import { viewFor, roleOf, enforceTimeouts } from '../../../../lib/gameLogic';
import { getRoom, storeReady, withRoomLock, assertCode } from '../../../../lib/store';
import { errorResponseInfo } from '../../../../lib/apiError';

export const dynamic = 'force-dynamic';

// 只提供 POST，避免 token 被寫進 URL/Referer/log
export async function POST(req) {
  if (!storeReady()) {
    return NextResponse.json({ error: 'NO_STORE' }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }
  const { code, token } = body || {};
  try {
    assertCode(code);
  } catch {
    return NextResponse.json({ error: 'BAD_CODE' }, { status: 400 });
  }
  if (typeof token !== 'string') {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 400 });
  }

  try {
    return await withRoomLock(code, async ({ guardedSetRoom }) => {
      const room = await getRoom(code);
      if (!room) return NextResponse.json({ error: 'NOT_FOUND', message: '房間不存在或已過期' }, { status: 404 });
      const role = roleOf(room, token);
      if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
      // 超時強制判定（任一方輪詢就會觸發，斷線方也擋不住比賽前進）
      if (enforceTimeouts(room)) await guardedSetRoom(code, room);
      return NextResponse.json({ view: viewFor(room, role) });
    });
  } catch (e) {
    const info = errorResponseInfo(e);
    return NextResponse.json({ error: info.code, message: info.message }, { status: info.status });
  }
}
