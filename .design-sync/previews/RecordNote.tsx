import { RecordNote, StatGrid } from "yazy-battle-ui";

export const UnderStats = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <RecordNote>統計最近 200 場完成對局</RecordNote>
    <StatGrid
      stats={[
        { label: "完成場次", value: 42 },
        { label: "勝場", value: 17 },
        { label: "最高分", value: 312 },
        { label: "平均分", value: 214 },
      ]}
    />
  </section>
);

export const Summary = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <RecordNote>打出過 6 次 YAZY · 對戰 31 場，敗 14，和 1</RecordNote>
  </section>
);
