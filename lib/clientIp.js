// 取得請求方 IP，儘量避免被 X-Forwarded-For header 偽造繞過 rate limit。
// 優先序：Next 內建 req.ip (Vercel 上可信) > 反向代理注入的 x-real-ip > X-Forwarded-For 最右一個 hop
// XFF 是可被 client 加上第一段的，取最右一個由本方代理實際加上的 hop 比較穩。
export function clientIp(req) {
  if (req?.ip) return req.ip;
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return 'unknown';
}
