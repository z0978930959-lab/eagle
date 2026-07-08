# 中職夜戰｜文字棒球對決 部署說明

## 內容
Next.js 14 standalone 打包後的自帶 minimal node_modules bundle。

```
dist/
├── .next/              # 靜態資源（chunks / css / prerendered）
├── node_modules/       # 精簡版依賴
├── server.js           # 啟動入口
├── package.json
├── start.bat           # Windows 啟動腳本
├── start.sh            # Linux/Mac 啟動腳本
├── .env.example        # 環境變數範本
└── DEPLOY.md
```

## 執行需求
- Node.js **18 或以上**
- 一個可訪問的 **Upstash Redis**（REST 端點）
- 對外開放的 port（預設 3000）

## 快速啟動

1. 於 [Upstash Console](https://console.upstash.com/) 建立一個 Redis Database。
2. 複製本目錄的 `.env.example` 為 `.env`，填入：
   ```
   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=xxxxx
   PORT=3000
   HOSTNAME=0.0.0.0
   ```
3. 啟動：
   - Windows：雙擊 `start.bat`
   - Linux/Mac：`chmod +x start.sh && ./start.sh`
4. 打開瀏覽器連 `http://伺服器IP:3000`。

## 上線注意事項
- 若無 Upstash Redis，網站可打開但按下建房會出現 `NO_STORE` 錯誤。
- 若部署到反向代理後方（Nginx、IIS、Cloudflare），請確保會傳 `x-forwarded-for` 或 `x-real-ip`，否則所有 IP 都被記為 `unknown`，rate limit 會共用。
- 建議搭配 systemd / PM2 / Windows Service 常駐。
- 更新方式：整個 dist 覆蓋、重啟 Node 進程即可。

## PM2 常駐範例
```bash
pm2 start server.js --name baseball-game
pm2 save
```

## Windows Task Scheduler 常駐範例
- Trigger: At startup
- Action: `cmd /c C:\path\to\dist\start.bat`
- Run whether user is logged on or not

## 若要修改連線資訊或 port
編輯 `.env`（**不是** `.env.example`）然後重啟。

## 版本
build 於 `next build --output=standalone`，Next.js 14.2.35。
