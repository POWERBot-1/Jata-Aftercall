import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Small presentational pieces shared by the ERP screens.
 *
 * They are deliberately plain: a badge, a notice, a definition figure, an empty state. Nothing here
 * invents data — every value arrives from a loader that read the database.
 */

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "lime"; children: ReactNode }) {
  return <span className="erp-badge" data-tone={tone === "neutral" ? undefined : tone}>{children}</span>;
}

export function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  children: ReactNode;
  action?: { href: string; label: string } | null;
}) {
  return (
    <div className="erp-notice" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <div>{children}</div>
      {action ? <Link href={action.href}>{action.label}</Link> : null}
    </div>
  );
}

export function PageHead({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="erp-page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="erp-actions">{actions}</div> : null}
    </header>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="erp-kpi">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function EmptyState({ glyph = "◌", title, children, action }: { glyph?: string; title: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="erp-empty">
      <span className="glyph" aria-hidden="true">{glyph}</span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <Link href={action.href} className="erp-btn erp-btn-primary erp-btn-sm">{action.label}</Link> : null}
    </div>
  );
}

export function StatusTone(status: string): "neutral" | "good" | "warn" | "bad" | "lime" {
  const value = String(status ?? "").toUpperCase();
  if (["ACTIVE", "DELIVERED", "ACCEPTED", "COMPLETED", "PAID", "POSTED", "EXECUTED", "DONE", "OPEN", "READY", "READY_FOR_REVIEW"].includes(value)) return "good";
  if (["APPROVED", "DISPATCHING", "SENDING", "QUEUED", "SCHEDULED", "SUBMITTED", "UNDER_REVIEW", "PARTIALLY_PAID", "PARTIALLY_COMPLETED", "PREVIEW", "AWAITING_RECONCILIATION", "INFORMATION_REQUIRED"].includes(value)) return "warn";
  if (["FAILED", "REJECTED", "BLOCKED", "SUSPENDED", "CANCELLED", "VOIDED", "OVERDUE", "EXPIRED", "UNKNOWN", "PAST_DUE"].includes(value)) return "bad";
  if (["DRAFT", "NOT_STARTED", "NOT_CONNECTED", "NONE", "PAUSED"].includes(value)) return "neutral";
  return "neutral";
}

export function humanise(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <li>
      <span className="erp-muted erp-small">{label}</span>
      <span className={mono ? "erp-mono" : "erp-small erp-strong"}>{value}</span>
    </li>
  );
}
