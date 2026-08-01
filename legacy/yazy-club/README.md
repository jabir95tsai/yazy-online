# YAZY CLUB

一個支援 2–6 人的線上 Yahtzee 風格骰子遊戲。玩家可以建立房間、
用 6 碼代碼邀請朋友、輪流擲骰與計分，完成的對局會保存在 D1。

## 本機執行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

## 驗證

```bash
npm test
npm run build
```

資料表定義位於 `db/schema.ts`，修改後使用 `npm run db:generate`
建立新的 Drizzle migration。
