import { ErrorBanner } from "yazy-battle-ui";

export const Connection = () => (
  <div style={{ width: 560 }}>
    <ErrorBanner>連線有點不穩，正在重新接上這一桌…</ErrorBanner>
  </div>
);

export const RoomGone = () => (
  <div style={{ width: 560 }}>
    <ErrorBanner>找不到這一桌，可能已經收掉了。</ErrorBanner>
  </div>
);
