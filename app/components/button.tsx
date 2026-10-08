import type { ButtonHTMLAttributes } from "react";

const VARIANT_CLASS = {
  primary: "primary-action",
  ghost: "ghost-action",
  soft: "soft-action",
  text: "text-action",
  toggle: "feedback-toggle",
  roll: "roll-button",
} as const;

/**
 * The app's buttons. `primary` is the one apricot pill per screen (full
 * width); `ghost` is its quiet grey partner; `soft` is the small apricot-tint pill
 * for inline actions (copy invite, skip turn, resume); `text` is a bare link-weight
 * action; `toggle` is a small muted text button for settings and minor
 * in-game choices (pair with `aria-pressed` when it switches something);
 * `roll` is the dice-tray throw button.
 *
 * @category Actions
 */
export function Button({
  variant = "primary",
  type = "button",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANT_CLASS;
}) {
  return (
    <button
      className={className ? `${VARIANT_CLASS[variant]} ${className}` : VARIANT_CLASS[variant]}
      type={type}
      {...props}
    />
  );
}
