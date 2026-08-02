# YAZY CLUB

一個支援 2–6 人的線上 Yahtzee 風格骰子遊戲。玩家可以建立房間、
用 6 碼代碼邀請朋友、輪流擲骰與計分，完成的對局會保存在 D1。

正式網站：<https://yazy-online.jabir95tsai.workers.dev>

舊網址 `yazy-friends.jabir95tsai.workers.dev` 仍保留運作（有進行中的對局），
但不再更新，僅供既有玩家過渡使用。

## 本機執行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

## 驗證

```bash
npm test
npm run lint
npm run build
```

資料表定義位於 `db/schema.ts`，修改後使用 `npm run db:generate`
建立新的 Drizzle migration。

## 目錄結構

主程式位於專案根目錄，直接部署為 `yazy-online` Worker。

D1 資料庫的 Cloudflare 註冊名稱仍是 `yazy-friends-db`——D1 資料庫
無法改名（沒有對應的 CLI 或 API），因此 `wrangler.jsonc` 與
`vite.config.ts` 裡的 `database_name` 保持不變；實際綁定用的是
`database_id`，不受影響。

`legacy/yazy-club/` 是已停用的舊版 Worker，僅作保存與查閱之用，
不會被建置、部署、lint 或 CI 檢查。請勿在其中新增功能。

## 限流

`POST /api/rooms` 透過 Cloudflare Workers Rate Limiting binding
限制每個 IP 每分鐘最多建立 10 間房，超過回傳 `429`。
規則定義在 `wrangler.jsonc` 的 `ratelimits`，實際檢查在
`lib/server.ts` 的 `withinRoomCreateLimit()`。

本機開發若沒有這個 binding，檢查會直接放行（限流屬於防濫用機制，
不影響遊戲正確性）。加入房間與遊戲操作皆不受限流影響。

## 部署與資料保存

```bash
npm run deploy
```

Cloudflare 每天 03:17（台北時間）會刪除已過期、無法再用於登入的工作階段。
房間、玩家與分數不會自動刪除，完成的對局可供登入玩家查看歷史戰績。
