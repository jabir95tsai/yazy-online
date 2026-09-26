import type { ReactNode } from "react";

/**
 * A pulsing apricot dot: something is live or on its way.
 *
 * @category Feedback
 */
export function LiveDot() {
  return <span className="live-dot" />;
}

/**
 * An inline error inside a form or panel, apricot wash.
 *
 * @category Feedback
 */
export function FormError({ children }: { children: ReactNode }) {
  return <p className="form-error">{children}</p>;
}

/**
 * A page-level error strip under the header.
 *
 * @category Feedback
 */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return <div className="error-banner">{children}</div>;
}

/**
 * A small muted footnote under a heading, e.g. how stats are counted.
 *
 * @category Feedback
 */
export function RecordNote({ children }: { children: ReactNode }) {
  return <p className="record-note">{children}</p>;
}
