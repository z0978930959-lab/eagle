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

const ROOM_TTL_SECONDS = 3 * 60 * 60; // 3 小時後房間自動消失

export function storeReady() {
  return !!redis;
}

export async function getRoom(code) {
  if (!redis) throw new Error('NO_STORE');
  return await redis.get(`room:${code}`);
}

export async function setRoom(code, data) {
  if (!redis) throw new Error('NO_STORE');
  await redis.set(`room:${code}`, data, { ex: ROOM_TTL_SECONDS });
}

export async function roomExists(code) {
  if (!redis) throw new Error('NO_STORE');
  return (await redis.exists(`room:${code}`)) === 1;
}
