import { Button } from "yazy-battle-ui";

const stack = { display: "flex", flexDirection: "column" as const, gap: 12, width: 320 };

export const Primary = () => (
  <div style={stack}>
    <Button>開一桌</Button>
    <Button disabled>再等一個人</Button>
  </div>
);

export const PrimaryWithGhost = () => (
  <div className="results-actions" style={{ width: 420 }}>
    <Button>再來一桌</Button>
    <Button variant="ghost">看計分卡</Button>
  </div>
);

export const TextAction = () => (
  <div style={stack}>
    <Button>儲存個人資料</Button>
    <Button variant="text">登出</Button>
  </div>
);

export const Toggle = () => (
  <div style={{ display: "flex", gap: 10 }}>
    <Button aria-pressed variant="toggle">落地音效開</Button>
    <Button variant="toggle">投降</Button>
  </div>
);

export const Roll = () => (
  <div style={stack}>
    <Button variant="roll">擲骰</Button>
    <Button disabled variant="roll">骰子還在滾…</Button>
  </div>
);
