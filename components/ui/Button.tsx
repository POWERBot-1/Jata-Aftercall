"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

/**
 * The platform's button.
 *
 * Every variant carries the shared states required by the design system: hover, focus-visible
 * (from `.jata-btn:focus-visible`), pressed (`:active`), disabled and loading. A loading button
 * stays visible, keeps its label, sets `aria-busy` and cannot be pressed twice — that is what
 * stops a double subscription charge or a double POS sale from an impatient double-tap.
 */
export function Button({
  href,
  children,
  variant = "primary",
  size = "md",
  block = false,
  type = "button",
  disabled,
  loading = false,
  icon,
  iconAfter,
  onClick,
  className = "",
  ariaLabel,
  title,
}: {
  href?: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
  title?: string;
}) {
  const isDisabled = Boolean(disabled) || loading;
  const cls = cn("jata-btn", `jata-btn-${variant}`, size === "sm" && "jata-btn-sm", block && "jata-btn-block", className);

  const content = (
    <>
      {loading ? (
        <span className="jata-spinner" aria-hidden="true">
          ◌
        </span>
      ) : icon ? (
        <span aria-hidden="true" className="inline-flex items-center">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
      {iconAfter && !loading ? (
        <span aria-hidden="true" className="inline-flex items-center">
          {iconAfter}
        </span>
      ) : null}
    </>
  );

  if (href && !isDisabled) {
    return (
      <Link href={href} className={cls} aria-label={ariaLabel} title={title}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={cls}
      disabled={isDisabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      title={title}
    >
      {content}
    </button>
  );
}

export default Button;
