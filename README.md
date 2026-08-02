# YAZY CLUB

一個支援 2–6 人的線上 Yahtzee 風格骰子遊戲。玩家可以建立房間、
用 6 碼代碼邀請朋友、輪流擲骰與計分，完成的對局會保存在 D1。

正式網站：<https://yazy-online.jabir95tsai.workers.dev>

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

## 限流

規則定義在 `wrangler.jsonc` 的 `ratelimits`，實際檢查在 `lib/server.ts`：

| 端點 | 限制 | 鍵 |
| --- | --- | --- |
| `POST /api/rooms` | 每分鐘 10 次 | 來源 IP |
| `POST /api/auth/login`、`/register` | 每分鐘 10 次 | 來源 IP，登入另外再以帳號名計一次 |

登入同時以「IP」與「目標帳號」兩個鍵計算，因此分散式猜密碼即使每個
IP 看起來都很安靜，仍會被擋下。加入房間與遊戲操作皆不受限流影響。

本機開發若沒有這些 binding，檢查會直接放行（限流屬於防濫用機制，
不影響遊戲正確性）。

## 密碼雜湊

PBKDF2-SHA256，成本記錄在雜湊值本身（`<iterations>:<hex>`），所以日後
調高次數不會讓既有密碼失效。

目前是 48,000 次（約 5ms CPU）。OWASP 建議 600,000 次，但本 Worker 跑在
Cloudflare **免費方案**，每次請求上限只有 10ms CPU——600,000 次（約 64ms）
甚至先前的 100,000 次（約 11ms）都會直接超標讓請求失敗。

真正的主要防線是 `AUTH_PEPPER`（Worker secret）：密碼在雜湊前會先用這個
不存在資料庫裡的密鑰做 HMAC，因此單靠資料庫外洩無法破解任何密碼。升級
到付費方案後，把 `lib/auth.ts` 的 `PBKDF2_ITERATIONS` 調高即可，舊密碼
仍可正常登入。

```bash
# 首次設定（或輪替）pepper：
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put AUTH_PEPPER
```

輪替 pepper 會讓所有既有密碼失效，僅適合在沒有使用者時執行。

## 部署與資料保存

```bash
npm run deploy
```

`deploy` 會依序執行 build → 套用 D1 migration → 部署 Worker。migration 這步
是刻意放進去的：先前的部署指令只上傳 Worker，導致程式碼已更新、資料庫卻
還停在舊 schema。

Cloudflare 每天 03:17（台北時間）執行排程清理：

- 刪除已過期、無法再用於登入的工作階段。
- 刪除超過 7 天沒有動靜、且**未完成**的房間（連同其玩家與分數）。房間只有
  在有人打完才會變成 `finished`，否則會永遠留著。

**已完成的對局永遠保留**，帳號歷史戰績即是由此而來。
