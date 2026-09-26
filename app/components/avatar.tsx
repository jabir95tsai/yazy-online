import type { HTMLAttributes, ReactNode } from "react";

/**
 * A round chip with someone's initial. Pass `name` for the initial, or
 * `children` for anything else (the ＋ on an empty seat). `size="lg"` is the
 * profile-header version.
 *
 * @category Players
 */
export function Avatar({
  name,
  size = "md",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  name?: string;
  size?: "md" | "lg";
  children?: ReactNode;
}) {
  return (
    <span className={size === "lg" ? "profile-avatar" : "avatar"} {...props}>
      {children ?? name?.slice(0, 1).toUpperCase()}
    </span>
  );
}
