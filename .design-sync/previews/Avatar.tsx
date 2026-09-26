import { Avatar } from "yazy-battle-ui";

const row = { alignItems: "center", display: "flex", gap: 12 };

export const Initials = () => (
  <div style={row}>
    <Avatar name="小明" />
    <Avatar name="Mia" />
    <Avatar name="jabir" />
    <Avatar name="阿凱" />
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Avatar name="小明" size="lg" />
    <Avatar name="小明" />
  </div>
);

export const EmptySeatMark = () => (
  <div style={row}>
    <Avatar aria-hidden="true">＋</Avatar>
  </div>
);
