import { LobbySeats, Seat } from "yazy-battle-ui";

export const TakenAndOpen = () => (
  <LobbySeats>
    <Seat name="jabir" suffix="（你）" />
    <Seat />
  </LobbySeats>
);

export const Taken = () => (
  <LobbySeats>
    <Seat name="小明" />
  </LobbySeats>
);
