import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui";

/**
 * Admin console presentation.
 *
 * Server-safe primitives (no hooks) that put the console on the same art direction as the owner
 * workspace: an editorial page head, calm panels, a real search field, and dense-but-readable
 * record cards instead of a wall of one-line paragraphs. Nothing here queries or mutates data —
 * every page keeps its own Prisma reads, guards and actions.
 */

export function AdminPage({
  kicker,
  title,
  meta,
  action,
  children,
}: {
  kicker?: string;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ws-stack">
      <header className="ws-page-head">
        <div>
          {kicker ? <p className="ws-kicker">{kicker}</p> : null}
          <h1 className="ws-page-title">{title}</h1>
          {meta ? <p className="ws-page-sub">{meta}</p> : null}
        </div>
        {action ? <div className="ws-page-actions">{action}</div> : null}
      </header>
      {children}
    </div>
  );
}

/** A search that submits on Enter and keeps the current query visible. */
export function AdminSearch({
  action,
  name = "q",
  defaultValue,
  placeholder,
  label,
}: {
  action: string;
  name?: string;
  defaultValue?: string;
  placeholder: string;
  label: string;
}) {
  return (
    <form action={action} className="ws-search" role="search">
      <label className="sr-only" htmlFor="admin-search">
        {label}
      </label>
      <input id="admin-search" name={name} defaultValue={defaultValue} placeholder={placeholder} type="search" autoComplete="off" />
      <button type="submit" className="ws-btn-amber">Search</button>
    </form>
  );
}

/** One record. `title` is the identity, `facts` are label/value pairs, `actions` stay at the end. */
export function AdminRecord({
  title,
  subtitle,
  facts,
  actions,
  tone,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  facts?: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
  tone?: "live" | "draft";
}) {
  return (
    <article className="ws-record">
      <div className="ws-record__head">
        <div className="min-w-0">
          <h2 className="ws-record__title">{title}</h2>
          {subtitle ? <p className="ws-record__sub">{subtitle}</p> : null}
        </div>
        {tone ? (
          <span className="ws-pill" data-tone={tone}>
            {tone === "live" ? "Live" : "Draft"}
          </span>
        ) : null}
      </div>
      {facts?.length ? (
        <dl className="ws-record__facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions ? <div className="ws-record__actions">{actions}</div> : null}
    </article>
  );
}

/** A scrollable table skin: the header stays put and the page never scrolls sideways. */
export function AdminTable({ head, children, caption }: { head: ReactNode; children: ReactNode; caption?: string }) {
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * A compact status chip for the console tables.
 *
 * It maps stored payment/subscription states onto tokens, so "PAID" reads green and "PENDING"
 * reads amber in both product themes instead of a light-only utility colour.
 */
export function AdminStatus({ value }: { value: string }) {
  const status = String(value || "").toUpperCase();
  const tone =
    ["PAID", "ACTIVE", "LIVE", "PUBLISHED"].includes(status) ? "success"
      : ["PENDING", "EXPIRING", "PAST_DUE", "TRIAL"].includes(status) ? "warning"
        : ["FAILED", "EXPIRED", "SUSPENDED", "CANCELLED", "REFUNDED"].includes(status) ? "danger"
          : "neutral";
  return <span className="ws-status" data-tone={tone}>{status || "—"}</span>;
}

export function AdminLinkButton({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  return (
    <Link href={href} className={cn("ws-btn-outline", "ws-btn-outline--ink")} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </Link>
  );
}
