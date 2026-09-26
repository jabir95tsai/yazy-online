import type { ReactNode } from "react";

export type Stat = {
  label: string;
  value: ReactNode;
  /** A muted "/n" after the value, e.g. wins out of contested games. */
  of?: ReactNode;
};

const VARIANT_CLASS = {
  profile: "profile-stats",
  record: "profile-stats trio",
  history: "history-stats",
} as const;

/**
 * Big-number tiles. `profile` is four across (the profile tab), `record` is
 * three across for a six-tile record, `history` is the five-tile strip on the
 * landing page.
 *
 * @category Stats
 */
export function StatGrid({
  stats,
  variant = "profile",
}: {
  stats: Stat[];
  variant?: keyof typeof VARIANT_CLASS;
}) {
  return (
    <div className={VARIANT_CLASS[variant]}>
      {stats.map((stat) => (
        <article key={stat.label}>
          <strong>
            {stat.value}
            {stat.of !== undefined && <i>/{stat.of}</i>}
          </strong>
          <span>{stat.label}</span>
        </article>
      ))}
    </div>
  );
}
