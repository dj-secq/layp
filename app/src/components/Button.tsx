import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";

type Variant = "primary" | "secondary" | "danger" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  small?: boolean;
};

export function Button({ variant = "secondary", small = false, className, type = "button", ...props }: Props) {
  return (
    <button
      type={type}
      className={cx(small ? "press-sm" : "press", `btn-${variant}`, className)}
      {...props}
    />
  );
}
