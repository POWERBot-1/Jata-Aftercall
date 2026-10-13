import type { ReactNode } from "react";
import { cn, toneAttrs } from "@/lib/ui";

/**
 * Status pill — the only way the platform shows a state (business, payment, subscription,
 * POS transaction, publish status). The tone comes from `lib/statusLabels` so a raw enum value
 * can never reach a customer, and colour is never the sole carrier of meaning: the label text
 * is always present and readable on its own.
 */
export function StatusPill({
  children,
  tone = "neutral",
  icon,
  className,
}: {
  children: ReactNode;
  tone?: string | null;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("jata-pill", className)} {...toneAttrs(tone)}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

export default StatusPill;
