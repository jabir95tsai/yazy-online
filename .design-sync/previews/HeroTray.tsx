import { HeroTray, StillDie } from "yazy-battle-ui";

export const Landing = () => (
  <div style={{ display: "inline-block" }}>
    <HeroTray>
      <StillDie value={4} />
      <StillDie value={6} />
      <StillDie value={1} />
    </HeroTray>
  </div>
);
