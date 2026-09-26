import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Avatar } from "./avatar";

/**
 * A person in a list: avatar, name, one muted detail line, and whatever goes
 * on the right (`children`) — a `FriendActions` group, a single
 * `FriendAction`, or a `HeadToHead`.
 *
 * @category Friends
 */
export function FriendRow({
  name,
  detail,
  children,
}: {
  name: string;
  detail: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="friend-row">
      <Avatar name={name} />
      <div className="friend-copy">
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      {children}
    </article>
  );
}

/**
 * Groups two or more `FriendAction`s at the end of a `FriendRow`.
 *
 * @category Friends
 */
export function FriendActions({ children }: { children: ReactNode }) {
  return <div className="friend-actions">{children}</div>;
}

const TONE_CLASS = {
  accept: "friend-yes",
  decline: "friend-no",
  invite: "friend-invite",
} as const;

/**
 * The small pill on a `FriendRow`. `accept` and `invite` are apricot;
 * `decline` (also used for remove / cancel) is grey.
 *
 * @category Friends
 */
export function FriendAction({
  tone,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone: keyof typeof TONE_CLASS }) {
  return <button className={TONE_CLASS[tone]} type={type} {...props} />;
}

/**
 * Head-to-head record: n 勝 n 敗 (n 和 only when there were ties).
 *
 * @category Friends
 */
export function HeadToHead({
  wins,
  losses,
  ties = 0,
}: {
  wins: number;
  losses: number;
  ties?: number;
}) {
  return (
    <div className="versus-record">
      <b>{wins}</b>勝
      <b>{losses}</b>敗
      {ties > 0 && (
        <>
          <b>{ties}</b>和
        </>
      )}
    </div>
  );
}
