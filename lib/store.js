import { Redis } from '@upstash/redis';

// 相容兩種環境變數命名：
// - Vercel Marketplace (Upstash for Redis)：KV_REST_API_URL / KV_REST_API_TOKEN
// - Upstash 官網直接建立：UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let redis = null;
if (url && token) {
  redis = new Redis({ url, token });
}

// 房間 TTL：剛建立時（尚未加入對手）採較短 TTL，避免惡意灌房把號碼池占滿；
// 一旦真的開打（setRoom 被呼叫），再拉長到 3 小時。
const WAITING_TTL_SECONDS = 30 * 60; // 空房 30 分鐘沒人加入就消失
const ROOM_TTL_SECONDS = 3 * 60 * 60;
// lock TTL 拉長到 10s：Upstash 冷啟 + 跨區 round-trip 可能吃到數秒，避免 lock 過期後原持有者用舊快照回寫覆蓋別人的更新
const LOCK_TTL_MS = 10000;
const LOCK_RETRY_MS = 80;
const LOCK_RETRIES = 30;

const CODE_RE = /^\d{4}$/;

export function assertCode(code) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) {
    throw new Error('BAD_CODE');
  }
}

export function storeReady() {
  return !!redis;
}

export async function getRoom(code) {
  assertCode(code);
  if (!redis) throw new Error('NO_STORE');
  return await redis.get(`room:${code}`);
}

export async function setRoom(code, data) {
  assertCode(code);
  if (!redis) throw new Error('NO_STORE');
  await redis.set(`room:${code}`, data, { ex: ROOM_TTL_SECONDS });
}

export async function createRoomIfAbsent(code, data) {
  assertCode(code);
  if (!redis) throw new Error('NO_STORE');
  const result = await redis.set(`room:${code}`, data, { ex: WAITING_TTL_SECONDS, nx: true });
  return result === 'OK' || result === true;
}

export async function roomExists(code) {
  assertCode(code);
  if (!redis) throw new Error('NO_STORE');
  return (await redis.exists(`room:${code}`)) === 1;
}

// 簡易 IP-based rate limit（token bucket by fixed window）
// 用 pipeline 讓 INCR + EXPIRE 一起送，避免第一次 INCR 之後行程掛掉導致 key 永不過期
export async function rateLimit(bucket, key, max, windowSeconds) {
  if (!redis) return { ok: true, remaining: max };
  const rlKey = `rl:${bucket}:${key}`;
  const pipe = redis.pipeline();
  pipe.incr(rlKey);
  pipe.expire(rlKey, windowSeconds, 'NX'); // 只在沒有 TTL 時才設，避免每次呼叫都刷新視窗
  const [n] = await pipe.exec();
  const count = typeof n === 'number' ? n : Number(n) || 0;
  return { ok: count <= max, remaining: Math.max(0, max - count) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function withRoomLock(code, fn) {
  assertCode(code);
  if (!redis) throw new Error('NO_STORE');
  const key = `room:${code}:lock`;
  const token = lockToken();

  for (let i = 0; i < LOCK_RETRIES; i++) {
    const acquired = await redis.set(key, token, { nx: true, px: LOCK_TTL_MS });
    if (acquired === 'OK' || acquired === true) {
      try {
        // 給 fn 一個受保護的 setRoom：寫入前檢查 lock 仍在本次持有中，否則拋 LOCK_LOST
        // 這是為了避免 lock TTL 到期後別人拿到 lock 又寫過 room，本次持有者不小心用舊資料覆蓋
        const guardedSetRoom = async (dataCode, data) => {
          const current = await redis.get(key);
          if (current !== token) throw new Error('LOCK_LOST');
          await setRoom(dataCode, data);
        };
        return await fn({ lockToken: token, guardedSetRoom });
      } finally {
        if ((await redis.get(key)) === token) await redis.del(key);
      }
    }
    await sleep(LOCK_RETRY_MS);
  }

  throw new Error('ROOM_BUSY');
}
