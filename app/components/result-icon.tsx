const PATHS = {
  win: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />,
  // 骰子只剩一點：這一桌沒擲好。
  loss: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  tie: <path d="M5 9h14M5 15h14" />,
  solo: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0" />,
  manual: <path d="M5 21V4M5 4h12l-2 4 2 4H5" />,
  automatic: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

function Glyph({ name }: { name: keyof typeof PATHS }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>;
}

/** 結果圓圈；角標是投降方式（自己投降，或贏在對手投降）。 */
export function ResultIcon({ outcome, concession, label }: {
  outcome: "win" | "loss" | "tie" | "solo";
  concession?: string | null;
  label: string;
}) {
  return (
    <span className={`result-icon ${outcome}`} role="img" aria-label={label}>
      <Glyph name={outcome} />
      {concession && <span className="result-badge"><Glyph name={concession === "automatic" ? "automatic" : "manual"} /></span>}
    </span>
  );
}
