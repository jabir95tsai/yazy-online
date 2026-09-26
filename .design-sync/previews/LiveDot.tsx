import { LiveDot } from "yazy-battle-ui";

export const WaitingNote = () => (
  <div className="waiting-note">
    <LiveDot />
    等開桌的人按開始
  </div>
);

export const Connecting = () => (
  <section className="connecting-card" aria-live="polite">
    <LiveDot />
    <p>正在回到 YAZY88 這一桌…</p>
  </section>
);
