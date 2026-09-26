import { RoomCode } from "yazy-battle-ui";

export const Pill = () => (
  <div style={{ display: "flex", gap: 12 }}>
    <RoomCode code="YAZY88" />
    <RoomCode code="YAZY88" copied />
  </div>
);

export const Display = () => (
  <div style={{ width: 400 }}>
    <RoomCode code="K7M2QX" variant="display" />
  </div>
);
