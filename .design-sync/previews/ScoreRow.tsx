import { BonusRow, ScoreRow } from "yazy-battle-ui";

const card = {
  background: "var(--card)",
  borderRadius: 24,
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  padding: 16,
  width: 360,
};

export const Scorecard = () => (
  <div style={card}>
    <ScoreRow label="一點" status="scored" value={3} />
    <ScoreRow label="五點" status="scored" value={15} />
    <ScoreRow
      best
      label="葫蘆"
      status="open"
      tag={{ text: "目前最多分", title: "現在填入可增加 25 分" }}
      value={25}
    />
    <ScoreRow label="三條" status="open" value={22} />
    <ScoreRow label="YAZY" status="open" value={0} />
    <BonusRow bonus={0} upper={41} />
  </div>
);

export const Statuses = () => (
  <div style={card}>
    <ScoreRow label="小順" status="scored" value={30} />
    <ScoreRow label="大順" status="readonly" value={40} />
    <ScoreRow label="機會" status="open" value={18} />
    <ScoreRow label="四條" status="open" value={0} />
  </div>
);

export const BonusEarned = () => (
  <div style={card}>
    <ScoreRow label="六點" status="scored" value={24} />
    <BonusRow bonus={35} upper={66} />
  </div>
);
