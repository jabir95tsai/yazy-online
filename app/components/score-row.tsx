import type { ReactNode } from "react";

/**
 * One scorecard line. `scored` is a filled category (value locked in);
 * `readonly` shows a preview you can't take right now; `open` is a button that
 * fills the category. `best` highlights the recommended open row, and `tag`
 * puts a small apricot label beside the category name.
 *
 * @category Scorecard
 */
export function ScoreRow({
  label,
  value,
  hint,
  status,
  best = false,
  tag,
  disabled,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  status: "scored" | "readonly" | "open";
  best?: boolean;
  tag?: { text: string; title?: string };
  disabled?: boolean;
  onClick?: () => void;
}) {
  const name = (
    <span>
      {label}
      {tag && (
        <span className="best-tag" title={tag.title}>
          {tag.text}
        </span>
      )}
    </span>
  );

  if (status !== "open") {
    return (
      <div aria-label={hint} className={`score-row ${status}`}>
        {name}
        <b>{value}</b>
      </div>
    );
  }
  return (
    <button
      aria-label={hint}
      className={`score-row ${value === 0 ? "zero" : ""} ${best ? "best" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {name}
      <b>{value}</b>
    </button>
  );
}

/**
 * The upper-section progress line under the scorecard: n / 63 toward +35.
 *
 * @category Scorecard
 */
export function BonusRow({ upper, bonus }: { upper: number; bonus: number }) {
  return (
    <div className="bonus-row">
      <span>
        {bonus ? "上半部加成 +35 到手了" : `上半部再 ${63 - upper} 分就有 +35`}
      </span>
      <strong>{upper} / 63</strong>
    </div>
  );
}
