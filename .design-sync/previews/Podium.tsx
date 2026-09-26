import { Button, Podium } from "yazy-battle-ui";

export const ResultsCard = () => (
  <section className="results-card" style={{ margin: 0, width: 520 }}>
    <h1>這局結束了</h1>
    <p>本局勝者是小明。玩得開心就好。</p>
    <Podium
      entries={[
        { id: "a", name: "小明", place: 1, total: 267 },
        { id: "b", name: "jabir", place: 2, total: 231 },
        { id: "c", name: "Mia", place: 3, total: 188, surrendered: true },
      ]}
    />
    <div className="results-actions">
      <Button>再來一桌</Button>
      <Button variant="ghost">看計分卡</Button>
    </div>
  </section>
);

export const Tie = () => (
  <div style={{ width: 460 }}>
    <Podium
      entries={[
        { id: "a", name: "阿凱", place: 1, total: 240 },
        { id: "b", name: "Mia", place: 1, total: 240 },
        { id: "c", name: "jabir", place: 3, total: 205 },
      ]}
    />
  </div>
);
