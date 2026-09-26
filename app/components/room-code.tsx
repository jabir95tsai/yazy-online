/**
 * A table's six-character code with a copy-invite button. `pill` is the
 * compact version in the in-game header; `display` is the big one on the
 * waiting screen.
 *
 * @category Table
 */
export function RoomCode({
  code,
  copied = false,
  onCopy,
  variant = "pill",
}: {
  code: string;
  copied?: boolean;
  onCopy?: () => void;
  variant?: "pill" | "display";
}) {
  return (
    <div className={variant === "pill" ? "room-pill" : "code-display"}>
      <strong>{code}</strong>
      <button onClick={onCopy}>
        {copied ? "已複製" : variant === "pill" ? "邀請" : "複製邀請"}
      </button>
    </div>
  );
}
