import { HeroTray, StillDie } from "yazy-battle-ui";

export const Trio = () => (
  <div style={{ display: "inline-block" }}>
    <HeroTray>
      <StillDie value={4} />
      <StillDie value={6} />
      <StillDie value={1} />
    </HeroTray>
  </div>
);

export const YazyHand = () => (
  <div style={{ display: "inline-block" }}>
    <HeroTray>
      <StillDie value={5} />
      <StillDie value={5} />
      <StillDie value={5} />
      <StillDie value={5} />
      <StillDie value={5} />
    </HeroTray>
  </div>
);
