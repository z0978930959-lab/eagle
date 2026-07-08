/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 產出自帶 minimal node_modules 的獨立包，可直接複製到伺服器 node server.js 跑
  output: 'standalone',
};

module.exports = nextConfig;
