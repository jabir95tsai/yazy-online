import { TurnCountdown } from "yazy-battle-ui";

/* The clock stays silent until the deadline has passed, so these use a past one. */
const expired = "2020-01-01T00:00:00.000Z";

export const SomeoneElseTimedOut = () => (
  <div style={{ width: 480 }}>
    <TurnCountdown
      busy={false}
      currentPlayerName="小明"
      isMyTurn={false}
      onSkip={() => {}}
      turnDeadline={expired}
    />
  </div>
);

export const YouTimedOut = () => (
  <div style={{ width: 480 }}>
    <TurnCountdown
      busy={false}
      currentPlayerName="你"
      isMyTurn
      onSkip={() => {}}
      turnDeadline={expired}
    />
  </div>
);
