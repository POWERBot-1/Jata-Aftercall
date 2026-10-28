import type { ReactNode } from "react";
import { cn } from "@/lib/ui";

/**
 * Metric tile.
 *
 * `reversed` exists because the markup order matters to assistive technology: the value must be
 * announced before its label. The CSS keeps the visual order label-then-value, so sighted and
 * non-sighted customers read the same pairing.
 */
export function Metric({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("jata-metric", className)}>
      <dt className="jata-metric__label">{label}</dt>
      <dd className="jata-metric__value">{value}</dd>
      {hint ? <dd className="jata-metric__hint">{hint}</dd> : null}
    </div>
  );
}

/** Grid wrapper: 2 columns on phones, 4 from tablet up. */
export function MetricGrid({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <dl className={cn("jata-metric-grid", className)} aria-label={label}>
      {children}
    </dl>
  );
}
