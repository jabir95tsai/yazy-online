import { BrandMark } from "yazy-battle-ui";

export const Mark = () => (
  <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
    <BrandMark />
    <span style={{ color: "var(--ink-muted)", fontSize: 13 }}>三面等角骰子，杏色系</span>
  </div>
);

export const OnTray = () => (
  <div
    style={{
      background: "var(--tray)",
      borderRadius: 18,
      display: "inline-flex",
      padding: 18,
    }}
  >
    <BrandMark />
  </div>
);
