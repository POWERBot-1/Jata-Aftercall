import type { ReactNode } from "react";
import { cn, type Tone } from "@/lib/ui";

/**
 * The states every customer-facing surface must be able to show: loading, empty, error and
 * offline. They are shared components so a new screen cannot invent its own version, and each
 * one is announced correctly (`role="status"` for progress, `role="alert"` for a failure).
 */

/** Empty state: a dashed block with a title, one explanation and up to two actions. */
export function EmptyState({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("jata-empty", className)}>
      <p className="jata-empty__title">{title}</p>
      {children ? <p className="jata-empty__text">{children}</p> : null}
      {actions ? <div className="jata-empty__actions">{actions}</div> : null}
    </div>
  );
}

/** Inline alert. `tone` maps to the shared semantic palette; the icon slot is decorative. */
export function Alert({
  tone = "neutral",
  title,
  children,
  action,
  className,
  live = false,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  live?: boolean;
}) {
  const role = live ? (tone === "danger" ? "alert" : "status") : undefined;
  return (
    <div className={cn("jata-alert", className)} data-tone={tone} role={role}>
      <div className="min-w-0">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </div>
  );
}

/** Skeleton primitives. `aria-hidden` because the live region announces loading instead. */
export function Skeleton({ className, variant = "text" }: { className?: string; variant?: "text" | "title" | "tile" | "block" }) {
  return <div aria-hidden="true" className={cn("jata-skeleton", variant !== "block" && `jata-skeleton--${variant}`, className)} />;
}

/** A short, honest "still working" region with a screen-reader announcement. */
export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <Skeleton variant="title" />
      <div className="jata-metric-grid">
        <Skeleton variant="tile" />
        <Skeleton variant="tile" />
        <Skeleton variant="tile" />
        <Skeleton variant="tile" />
      </div>
      <Skeleton variant="block" className="h-32" />
    </div>
  );
}

/** Offline / degraded-connection badge. Never blocks a transaction, only informs. */
export function OfflineBadge({ children = "You are offline. Changes will be saved when you reconnect." }: { children?: ReactNode }) {
  return (
    <p className="jata-offline" role="status">
      <span aria-hidden="true">●</span>
      {children}
    </p>
  );
}
