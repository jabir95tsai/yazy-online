import { PlayerChip } from "yazy-battle-ui";

export const Strip = () => (
  <div className="players-strip" style={{ width: 560 }}>
    <PlayerChip active detail="128" name="jabir" suffix="（你）" />
    <PlayerChip detail="142" name="小明" />
    <PlayerChip detail="96 · 已投降" name="Mia" />
  </div>
);

export const Active = () => (
  <div className="players-strip" style={{ width: 280 }}>
    <PlayerChip active detail="211" name="阿凱" />
  </div>
);
