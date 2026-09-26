# YAZY CLUB

一個人數不限的線上 Yahtzee 風格骰子遊戲。玩家可以建立房間、
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
npm run typecheck
npm run build
```

資料表定義位於 `db/schema.ts`，修改後使用 `npm run db:generate`
建立新的 Drizzle migration。

`tests/browser-regression.mjs` 另外驗證本機 Worker/D1 完整對局、帳號戰績、
鎖骰失敗與重試、跨分頁鎖骰同步、延遲輪詢、對話框焦點及手機排版。
先啟動本機伺服器，再於已提供 Playwright 與 Chrome 的環境執行：

```bash
node tests/browser-regression.mjs
```

預設測試位址為 `http://localhost:3100`，可用 `TEST_ORIGIN` 指定其他本機連接埠。
`PLAYWRIGHT_MODULE` 可指定外部 Playwright 的 `index.mjs` 絕對路徑。
測試會建立本機測試帳號與對局，拒絕對正式網址執行，截圖寫入忽略的 `outputs/`。

帳號統計與好友對戰紀錄採最近 200 場已完成對局，列表顯示最近 20 場。
首頁背景更新只查詢房間邀請；開啟帳號面板時重新讀取好友戰績。
大量 ID 查詢透過單一 JSON 參數及 SQLite `json_each`，避免超過 D1 的參數上限。

## 目錄結構

主程式位於專案根目錄，直接部署為 `yazy-online` Worker。

D1 資料庫的 Cloudflare 註冊名稱仍是 `yazy-friends-db`——D1 資料庫
無法改名（沒有對應的 CLI 或 API），因此 `wrangler.jsonc` 與
`vite.config.ts` 裡的 `database_name` 保持不變；實際綁定用的是
`database_id`，不受影響。

## 好友

登入後可以在帳號面板的「好友」分頁用帳號互加好友：送出邀請、對方接受才成立，
兩邊都可以隨時移除。好友清單順便顯示對方完成過幾場、和你同桌過幾場。

`friendships` 一組帳號只有一列，鍵是 `pair_key`（兩個 id 排序後接起來）。沒有這個
鍵，A→B 和 B→A 會各存一列，兩列對「誰在等誰」的說法就會打架。拒絕、取消、移除
都是刪掉那一列，所以之後還可以重新邀請。

開好桌之後，等待畫面會列出好友，一鍵就能把人叫過來；被邀的人回到首頁會看到
「好友找你上桌」，直接按進去即可入座。邀請只能由**已經坐在那桌的人**發出，也只能
發給好友——否則光是知道房間代碼就能洗版別人的首頁。

邀請只在房間還是 `waiting` 時有效：讀取時就會濾掉，實際的列由排程清理刪除
（已完成的房間永遠保留，不然那些邀請會一直躺著）。被邀的人真的入座後，該筆邀請
也會立刻刪除。

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
- 刪除指向「已經開打或已結束」房間的好友邀請。
- 刪除超過 7 天沒有動靜、且**未完成**的房間（連同其玩家與分數）。房間只有
  在有人打完才會變成 `finished`，否則會永遠留著。

**已完成的對局永遠保留**，帳號歷史戰績即是由此而來。

## 投降與挑戰紀錄

- 進行中的玩家可按「投降」並確認；不必等自己的回合。投降後保留已得分數、未填格保持空白，並跳過其後續回合。
- 每次計分、逾時計分或手動投降後，伺服器以剩餘格子的理論最高分（含仍可取得的 35 分加成）判定是否自動投降。只有最高分嚴格低於其他未投降玩家的現有分數才觸發；仍能追平者繼續。已填滿的計分卡保留正常結果。
- 最後一位未投降玩家可按「立即結算」，或繼續擲骰填滿 13 格挑戰紀錄。投降玩家可留在房間觀看；單人延續仍適用原本的 90 秒回合規則。
- 勝負、名次與對戰統計優先考慮投降狀態，投降者不會因分數較高而獲勝；多位投降者並列在未投降者之後。最高分與平均分仍使用實際所得分數。
- 上線前需套用 `drizzle/0006_surrender.sql`；舊玩家的 `surrender_reason` 預設為 `NULL`，不影響既有完成對局。
- 本機端到端驗證：啟動開發伺服器後執行 `node tests/surrender-regression.mjs`。可用 `PLAYWRIGHT_MODULE` 指定 Playwright；預設只連 `http://localhost:3100`。測試會建立合成對局，並在本機 D1 為該合成對局建立分數情境。
