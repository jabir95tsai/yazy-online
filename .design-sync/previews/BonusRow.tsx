import { BonusRow } from "yazy-battle-ui";

const card = { background: "var(--card)", borderRadius: 24, padding: 16, width: 360 };

export const InProgress = () => (
  <div style={card}>
    <BonusRow bonus={0} upper={41} />
  </div>
);

export const Earned = () => (
  <div style={card}>
    <BonusRow bonus={35} upper={68} />
  </div>
);
