import { StatGrid } from "yazy-battle-ui";

export const Profile = () => (
  <section className="account-panel" style={{ width: 420 }}>
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

export const Record = () => (
  <section className="account-panel" style={{ width: 420 }}>
    <StatGrid
      stats={[
        { label: "完成場次", value: 42 },
        { label: "勝率", value: "41%" },
        { label: "勝場", value: 17, of: 31 },
        { label: "最高分", value: 312 },
        { label: "平均分", value: 214 },
        { label: "YAZY 率", value: "14%" },
      ]}
      variant="record"
    />
  </section>
);

export const History = () => (
  <div className="history-section" style={{ width: 640 }}>
    <StatGrid
      stats={[
        { label: "場次", value: 42 },
        { label: "勝率", value: "41%" },
        { label: "最高分", value: 312 },
        { label: "平均分", value: 214 },
        { label: "YAZY 率", value: "14%" },
      ]}
      variant="history"
    />
  </div>
);
