/**
 * The die-and-wordmark in the header. Same three-face isometric die as the
 * roll tray, drawn plain (no shared defs/ids) since it's the only instance
 * mounted at a time across the three header variants.
 *
 * @category Brand
 */
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 104 120"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="51.96,0 103.92,30 51.96,60 0,30" fill="#e8a06a" />
      <polygon points="51.96,60 103.92,30 103.92,90 51.96,120" fill="#d4864b" />
      <polygon points="0,30 51.96,60 51.96,120 0,90" fill="#b96e37" />
      <g fill="#fffdf9">
        <g transform="matrix(51.96,30,-51.96,30,51.96,0)">
          <circle cx="0.28" cy="0.28" r="0.105" />
          <circle cx="0.72" cy="0.28" r="0.105" />
          <circle cx="0.5" cy="0.5" r="0.105" />
          <circle cx="0.28" cy="0.72" r="0.105" />
          <circle cx="0.72" cy="0.72" r="0.105" />
        </g>
        <g opacity="0.92" transform="matrix(51.96,30,0,60,0,30)">
          <circle cx="0.5" cy="0.5" r="0.105" />
        </g>
        <g opacity="0.92" transform="matrix(51.96,-30,0,60,51.96,60)">
          <circle cx="0.28" cy="0.28" r="0.105" />
          <circle cx="0.5" cy="0.5" r="0.105" />
          <circle cx="0.72" cy="0.72" r="0.105" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The header lockup: `BrandMark` plus the "yazy" wordmark. With `onClick` it
 * is a button (the in-game header uses it to leave the table); without, a
 * plain block.
 *
 * @category Brand
 */
export function Brand({
  onClick,
  "aria-label": ariaLabel,
}: {
  onClick?: () => void;
  "aria-label"?: string;
}) {
  const content = (
    <>
      <BrandMark />
      <span>yazy</span>
    </>
  );
  return onClick ? (
    <button className="brand" onClick={onClick} aria-label={ariaLabel}>
      {content}
    </button>
  ) : (
    <div className="brand">{content}</div>
  );
}
