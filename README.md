# 中職夜戰｜文字棒球對決

本機雙人輪流操作的逐球猜球心理戰棒球遊戲。使用 Next.js 14 + Tailwind CSS 打造，可直接部署到 Vercel。

## 遊戲規則

- 每一球由**投手**先選擇球種（直球／滑球／曲球／指叉球／變速球）和目標落點（3×3 好球帶：內角／中間／外角 × 高／中／低），也可以選擇故意投壞球引誘出棒。
- **打者**接著選擇策略：
  - **鎖定猜球**：同時猜「球種＋位置」。猜中紅中直球會有高機率長打（甚至全壘打）；猜錯球種、尤其被會位移的指叉球／曲球騙到，容易揮棒落空或打成軟弱滾地球。
  - **保護打法**：不猜球種，只求把球打進場內，被三振機率大幅降低，但長打機率也低。
  - **看球**：完全不揮棒，交給裁判判好壞球。
- 遊戲支援 **1 局制** 或 **3 局制**，投手會隨局數增加而「疲勞」（控球與球威略為下降）。
- 為了本機雙人的公平性，每次選擇之間都有「交接畫面」，提醒對方先不要看螢幕。

### 球隊與球員資料

`data/teams.js` 內建 2026 賽季中職六隊真實球員名單（先發投手＋主力打者），但**能力數值（力量／準度／選球眼／控球／球威）是依球風與一般評價換算的遊戲參考值，並非官方精確數據**。如果你查到更新、更準確的數據，直接改這個檔案裡的數字即可，範圍建議維持在 1～99。

## 本機開發

```bash
npm install
npm run dev
```

開啟 http://localhost:3000

## 部署到 Vercel

### 方法一：透過 Vercel 網站（最簡單）

1. 把這個資料夾上傳成一個 GitHub repo（可以用 GitHub Desktop，或見下方指令）。
2. 到 https://vercel.com/new，選擇「Import Git Repository」，選你剛建立的 repo。
3. Framework 會自動偵測為 Next.js，不需要改任何設定，直接按 **Deploy**。
4. 部署完成後會拿到一個 `*.vercel.app` 網址，跟朋友分享即可開始對戰。

建立 GitHub repo 的指令參考：

```bash
git init
git add .
git commit -m "init"
gh repo create cpbl-text-baseball --public --source=. --push
# 沒有安裝 gh 的話，改成手動到 github.com 建一個空 repo，
# 再依照畫面指示 git remote add origin ... && git push -u origin main
```

### 方法二：用 Vercel CLI（不用先建 GitHub repo）

```bash
npm install -g vercel
vercel login
vercel        # 依照提示操作，第一次會建立專案
vercel --prod # 正式部署
```

兩種方法都不需要任何額外的環境變數或資料庫設定，整個遊戲狀態都在瀏覽器端（單一裝置雙人輪流），開箱即用。
