import type { ReactNode } from "react";

export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  /** A small count bubble after the label (e.g. pending friend requests). */
  badge?: number;
};

/**
 * Two or three equal-width choices on a sunk track. `card` sits at the top of
 * the landing join card; `panel` is the version inside dialogs.
 *
 * @category Actions
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  variant = "panel",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: "card" | "panel";
}) {
  return (
    <div className={variant === "card" ? "card-tabs" : "auth-tabs"}>
      {items.map((item) => (
        <button
          className={item.id === value ? "active" : ""}
          key={item.id}
          onClick={() => onChange(item.id)}
          type="button"
        >
          {item.label}
          {!!item.badge && <b className="tab-badge">{item.badge}</b>}
        </button>
      ))}
    </div>
  );
}
