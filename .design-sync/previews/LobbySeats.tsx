import { LobbySeats, RoomCode, Seat } from "yazy-battle-ui";

export const WaitingRoom = () => (
  <section className="waiting-card" style={{ width: 560 }}>
    <h1>桌子開好了</h1>
    <p>把代碼給朋友，人到了再開始就好。</p>
    <RoomCode code="YAZY88" variant="display" />
    <LobbySeats>
      <Seat name="jabir" suffix="（你）" />
      <Seat name="小明" />
      <Seat name="Mia" />
      <Seat />
    </LobbySeats>
  </section>
);

export const JustOpened = () => (
  <LobbySeats>
    <Seat name="jabir" suffix="（你）" />
    <Seat />
  </LobbySeats>
);
