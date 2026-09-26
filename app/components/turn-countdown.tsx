"use client";
import { useEffect, useState } from "react";

/**
 * The turn clock, shown only once it has actually run out.
 *
 * The server still expires a turn after 90s so a table isn't held hostage by
 * someone who closed the tab, but a visible countdown is the one thing this
 * design does not want on screen. So the clock ticks in here and stays silent
 * until the deadline passes, at which point the others are offered the skip.
 *
 * Owns its own 1s tick locally instead of lifting it into `Home` state, so the
 * tick does not re-render the score panel, player strip and dice tray along
 * with it — those don't depend on the clock, and re-rendering them every second
 * competed with the roll animation for main-thread time.
 *
 * The caller keys this on `turnDeadline` so a new turn remounts it and
 * `now` starts fresh from the lazy `useState` initializer, rather than this
 * component reading `Date.now()` mid-render to reset an existing clock —
 * that would make render impure.
 *
 * @category Feedback
 */
export function TurnCountdown({
  turnDeadline,
  isMyTurn,
  currentPlayerName,
  busy,
  onSkip,
}: {
  turnDeadline: string;
  isMyTurn: boolean;
  currentPlayerName: string;
  busy: boolean;
  onSkip: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (Date.parse(turnDeadline) > now) return null;

  return (
    <div className="turn-timeout">
      <span>
        {isMyTurn
          ? "你離開有點久了，別人可以先跳過你"
          : `${currentPlayerName}好像離開了`}
      </span>
      {!isMyTurn && (
        <button disabled={busy} onClick={onSkip} type="button">
          跳過這個回合
        </button>
      )}
    </div>
  );
}
