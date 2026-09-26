import type { ReactNode } from "react";
import { Avatar } from "./avatar";

/**
 * A player in the in-game strip under the tray: avatar, name, and a small
 * detail line (their running total). `active` marks whose turn it is.
 *
 * @category Players
 */
export function PlayerChip({
  name,
  suffix,
  detail,
  active = false,
}: {
  name: string;
  /** Appended to the name as-is, e.g. "（你）". */
  suffix?: string;
  detail: ReactNode;
  active?: boolean;
}) {
  return (
    <article className={`player-chip ${active ? "active" : ""}`}>
      <Avatar name={name} />
      <span className="player-copy">
        {name}
        {suffix}
        <small>{detail}</small>
      </span>
    </article>
  );
}

/**
 * A seat on the waiting screen. Without `name` it's the dashed empty seat
 * ("還有位子").
 *
 * @category Table
 */
export function Seat({ name, suffix }: { name?: string; suffix?: string }) {
  if (!name) {
    return (
      <div className="seat empty">
        <Avatar aria-hidden="true">＋</Avatar>
        <span>還有位子</span>
      </div>
    );
  }
  return (
    <div className="seat">
      <Avatar name={name} />
      <span>
        {name}
        {suffix}
      </span>
    </div>
  );
}

/**
 * A row of `Seat`s.
 *
 * @category Table
 */
export function LobbySeats({ children }: { children: ReactNode }) {
  return <div className="lobby-seats">{children}</div>;
}

export type PodiumEntry = {
  id: string;
  name: string;
  /** 1-based; ties share a place. Place 1 gets the apricot treatment. */
  place: number;
  total: number;
  surrendered?: boolean;
};

/**
 * Final standings on the results card, best first.
 *
 * @category Players
 */
export function Podium({ entries }: { entries: PodiumEntry[] }) {
  return (
    <ol className="podium">
      {entries.map((entry) => (
        <li className={`podium-place place-${entry.place}`} key={entry.id}>
          <span className="rank">{entry.place}</span>
          <Avatar name={entry.name} />
          <strong>{entry.name}{entry.surrendered ? "（投降）" : ""}</strong>
          <b>{entry.total}</b>
        </li>
      ))}
    </ol>
  );
}
