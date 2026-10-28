import type { ReactNode } from "react";
import { cn } from "@/lib/ui";

/**
 * Surface primitives.
 *
 * These replace ad-hoc `rounded-xl border bg-white p-4` strings so every screen in the
 * platform shares one radius, one border colour, one elevation and one padding rhythm.
 * Server-safe: no state, no effects, no refs.
 */

export function Card({
  children,
  className,
  interactive = false,
  raised = false,
  muted = false,
  as: Tag = "section",
  labelledBy,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  raised?: boolean;
  muted?: boolean;
  as?: "section" | "article" | "div" | "li";
  labelledBy?: string;
  ariaLabel?: string;
}) {
  return (
    <Tag
      className={cn(
        "jata-surface",
        raised && "jata-surface--raised",
        muted && "jata-surface--muted",
        interactive && "jata-surface--interactive",
        className,
      )}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
    >
      {children}
    </Tag>
  );
}

export function CardHead({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("jata-surface__head", className)}>{children}</div>;
}

export function CardTitle({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={cn("jata-surface__title", className)}>
      {children}
    </h2>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("jata-surface__body", className)}>{children}</div>;
}

export function CardFoot({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("jata-surface__foot", className)}>{children}</div>;
}

/** A page-level section heading with an optional right-aligned meta slot. */
export function SectionHeading({
  title,
  meta,
  action,
  id,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("jata-section-head", className)}>
      <h2 id={id} className="jata-section-head__title">
        {title}
      </h2>
      {meta ? <p className="jata-section-head__meta">{meta}</p> : null}
      {action}
    </div>
  );
}
