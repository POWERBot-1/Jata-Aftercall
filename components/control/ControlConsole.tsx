"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Section = { state: "VERIFIED" | "PENDING" | "FAILED" | "UNAVAILABLE"; source: string; asOf: string; data: any; note?: string };
type Overview = { asOf: string; roles: string[]; permissions: string[]; sections: Record<string, Section> };
type Business = { id: string; name: string; slug: string; category: string; status: string; isPublished: boolean; createdAt: string; updatedAt: string };

const LABELS: Record<string, string> = {
  businesses: "Businesses and tenants",
  "subscriptions.read": "Subscriptions",
  "payments.read": "Payments",
  "agents.read": "Agent operations",
  "commissions.read": "Commission ledger evidence",
  communications: "Communications outbox",
  providers: "Provider health",
  system: "Application and database health",
  exceptions: "Operational exceptions",
  audit: "Administrative audit history",
};
const STATE_LABELS: Record<string, string> = { VERIFIED: "Verified source", PENDING: "Pending / review", FAILED: "Failed records present", UNAVAILABLE: "Unavailable" };

async function parseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status}).`);
  return body;
}

export function ControlConsole() {
  const router = useRouter();
  const [mfaStatus, setMfaStatus] = useState<{ enrolled: boolean; verified: boolean; roles: string[] } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessNextCursor, setBusinessNextCursor] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [businessError, setBusinessError] = useState("");
  const [reasonByBusiness, setReasonByBusiness] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const result = await parseJson(await fetch("/api/control/mfa/status", { cache: "no-store" }));
      setMfaStatus(result);
      return result as { enrolled: boolean; verified: boolean; roles: string[] };
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : "MFA status is unavailable.");
      return null;
    }
  }, []);

  const loadControlData = useCallback(async () => {
    setOverviewError("");
    try {
      const result = await parseJson(await fetch("/api/control/overview", { cache: "no-store" }));
      setOverview(result as Overview);
      if (result.sections?.businesses) {
        const businessResult = await parseJson(await fetch("/api/control/businesses", { cache: "no-store" }));
        setBusinesses(businessResult.items || []);
        setBusinessNextCursor(businessResult.nextCursor || null);
      }
      if (result.sections?.audit) {
        const auditResult = await parseJson(await fetch("/api/control/audit", { cache: "no-store" }));
        setAuditEvents(auditResult.items || []);
        setAuditNextCursor(auditResult.nextCursor || null);
      }
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Control data is unavailable.");
    }
  }, []);

  // These effects synchronize with server-authenticated state; all state writes occur after fetch resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (mfaStatus?.verified) void loadControlData(); }, [mfaStatus, loadControlData]);

  async function beginEnrollment() {
    setLoading(true); setMfaError("");
    try {
      const result = await parseJson(await fetch("/api/control/mfa/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
      setSecret(result.secret); setUri(result.uri); setMfaStatus({ enrolled: false, verified: false, roles: mfaStatus?.roles || [] });
    } catch (error) { setMfaError(error instanceof Error ? error.message : "Enrollment could not start."); }
    finally { setLoading(false); }
  }

  async function verifyMfa(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setMfaError("");
    try {
      await parseJson(await fetch("/api/control/mfa/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }));
      setSecret(null); setUri(null); setCode("");
      setMfaStatus((current) => current ? { ...current, enrolled: true, verified: true } : current);
      router.refresh();
    } catch (error) { setMfaError(error instanceof Error ? error.message : "MFA could not be verified."); }
    finally { setLoading(false); }
  }

  async function searchBusinesses(event: React.FormEvent) {
    event.preventDefault(); setBusinessError("");
    try {
      const result = await parseJson(await fetch(`/api/control/businesses?q=${encodeURIComponent(query)}`, { cache: "no-store" }));
      setBusinesses(result.items || []);
      setBusinessNextCursor(result.nextCursor || null);
    } catch (error) { setBusinessError(error instanceof Error ? error.message : "Business search failed."); }
  }

  async function loadMoreBusinesses() {
    if (!businessNextCursor) return;
    setBusinessError("");
    try {
      const result = await parseJson(await fetch(`/api/control/businesses?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(businessNextCursor)}`, { cache: "no-store" }));
      setBusinesses((current) => [...current, ...(result.items || [])]);
      setBusinessNextCursor(result.nextCursor || null);
    } catch (error) { setBusinessError(error instanceof Error ? error.message : "Next business page is unavailable."); }
  }

  async function revokeSessions() {
    const confirmed = window.confirm("Revoke every active session for this account and sign out? This affects all of your devices.");
    if (!confirmed) return;
    setOverviewError("");
    try {
      await parseJson(await fetch("/api/control/session/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "REVOKE_ALL_MY_SESSIONS" }) }));
      router.replace("/control/sign-in");
      router.refresh();
    } catch (error) { setOverviewError(error instanceof Error ? error.message : "Session revocation failed."); }
  }

  async function loadMoreAudit() {
    if (!auditNextCursor) return;
    try {
      const result = await parseJson(await fetch(`/api/control/audit?cursor=${encodeURIComponent(auditNextCursor)}`, { cache: "no-store" }));
      setAuditEvents((current) => [...current, ...(result.items || [])]);
      setAuditNextCursor(result.nextCursor || null);
    } catch (error) { setOverviewError(error instanceof Error ? error.message : "Next audit page is unavailable."); }
  }

  async function changeBusinessStatus(business: Business, status: "SUSPENDED" | "ACTIVE") {
    const action = status === "SUSPENDED" ? "SUSPEND" : "REINSTATE";
    setPendingAction(business.id); setBusinessError("");
    try {
      await parseJson(await fetch("/api/control/businesses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, status, confirmation: action, reason: reasonByBusiness[business.id] || "" }),
      }));
      setReasonByBusiness((value) => ({ ...value, [business.id]: "" }));
      await loadControlData();
    } catch (error) { setBusinessError(error instanceof Error ? error.message : "Business status was not changed."); }
    finally { setPendingAction(null); }
  }

  if (!mfaStatus) return <section className="ws-panel"><h2 className="ws-panel__title">Verifying control access</h2><p className="ws-muted" role="status">{mfaError || "Checking the current session and explicit permission grants…"}</p></section>;

  if (!mfaStatus.verified) return (
    <section className="ws-panel max-w-2xl">
      <p className="ws-kicker">Additional security required</p>
      <h2 className="ws-panel__title">{mfaStatus.enrolled || secret ? "Verify authenticator" : "Enroll an authenticator"}</h2>
      <p className="ws-muted">Active control grants are database-verified. MFA is required before operational data or actions are available. This browser session is re-verified every 15 minutes.</p>
      <p className="ws-tiny">Assigned roles: {mfaStatus.roles.join(", ") || "none"}. Role names do not automatically grant permissions.</p>
      {!mfaStatus.enrolled && !secret ? <button className="ws-btn-amber mt-4" onClick={beginEnrollment} disabled={loading}>{loading ? "Preparing…" : "Start TOTP enrollment"}</button> : null}
      {secret ? <div className="mt-4 rounded-xl border border-[color:var(--ws-border)] p-4" aria-live="polite">
        <p className="font-semibold">Add this account to an authenticator app</p>
        <p className="ws-tiny mt-1">This secret is shown once. Store it only in the authenticator; do not send it to support or paste it into a ticket.</p>
        <code className="mt-3 block break-all rounded bg-[color:var(--ws-canvas)] p-3 text-sm">{secret}</code>
        {uri ? <p className="ws-tiny mt-2">Issuer: JATA AFTERCALL Control · TOTP, SHA1, 6 digits, 30 seconds</p> : null}
      </div> : null}
      {mfaStatus.enrolled || secret ? <form className="mt-4 space-y-3" onSubmit={verifyMfa}>
        <label className="block text-sm font-semibold" htmlFor="control-totp">Six-digit code</label>
        <input id="control-totp" className="w-full rounded-lg border p-3" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
        <button className="ws-btn-amber" type="submit" disabled={loading || code.length !== 6}>{loading ? "Verifying…" : "Verify and continue"}</button>
      </form> : null}
      {mfaError ? <p className="mt-3 text-sm text-red-700" role="alert">{mfaError}</p> : null}
    </section>
  );

  if (!overview && !overviewError) return <section className="ws-panel"><p className="ws-muted" role="status">Loading only the modules granted to this account…</p></section>;
  if (overviewError && !overview) return <section className="ws-panel"><h2 className="ws-panel__title">Control data unavailable</h2><p className="ws-muted" role="alert">{overviewError}</p></section>;

  const sections = overview?.sections || {};
  const permissions = new Set(overview?.permissions || []);
  const nav = Object.keys(sections);
  return (
    <div className="ws-stack">
      <section className="ws-panel">
        <p className="ws-kicker">Verified control access</p>
        <h2 className="ws-panel__title">Operational command centre</h2>
        <p className="ws-muted">Sources are read from the application database at request time. No MRR/ARR estimate, simulated provider status, commission balance, or delivery claim is shown.</p>
        <p className="ws-tiny mt-2">Roles: {overview?.roles.join(", ")} · Data read at {overview?.asOf}</p>
        <nav aria-label="Control modules" className="mt-4 flex flex-wrap gap-2">
          {nav.map((key) => <a key={key} className="ws-btn-outline ws-btn-outline--ink" href={`#${key.replaceAll(".", "-")}`}>{LABELS[key] || key}</a>)}
          <button type="button" className="ws-btn-outline ws-btn-outline--ink" onClick={revokeSessions}>Revoke all my sessions &amp; sign out</button>
        </nav>
      </section>
      {overviewError ? <p role="alert" className="ws-panel text-sm text-red-700">Some data did not load: {overviewError}</p> : null}
      {Object.entries(sections).map(([key, section]) => <section id={key.replaceAll(".", "-")} key={key} className="ws-panel scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="ws-kicker">{section.source}</p><h2 className="ws-panel__title">{LABELS[key] || key}</h2></div>
          <span className="ws-pill" data-tone={section.state === "VERIFIED" ? "live" : "draft"}>{STATE_LABELS[section.state] || section.state}</span>
        </div>
        <p className="ws-tiny mt-1">Observed {section.asOf}</p>
        {section.note ? <p className="ws-muted mt-2">{section.note}</p> : null}
        <SectionContent sectionKey={key} section={section} permissions={permissions} businesses={businesses} query={query} setQuery={setQuery} onSearch={searchBusinesses} onLoadMore={loadMoreBusinesses} hasMore={Boolean(businessNextCursor)} auditEvents={auditEvents} auditNextCursor={auditNextCursor} onLoadMoreAudit={loadMoreAudit} onStatusChange={changeBusinessStatus} reasonByBusiness={reasonByBusiness} setReasonByBusiness={setReasonByBusiness} pendingAction={pendingAction} businessError={businessError} />
      </section>)}
      <p className="ws-tiny">Unavailable data remains unavailable; no inference is made from missing or failed sources.</p>
    </div>
  );
}

function SectionContent({ sectionKey, section, permissions, businesses, query, setQuery, onSearch, onLoadMore, hasMore, auditEvents, auditNextCursor, onLoadMoreAudit, onStatusChange, reasonByBusiness, setReasonByBusiness, pendingAction, businessError }: any) {
  const data = section.data;
  if (!data) return <p className="ws-muted mt-3">No authoritative result is available.</p>;
  if (sectionKey === "businesses") return <>
    <div className="ws-stats mt-4"><Metric label="Businesses in scope" value={data.total} /><Metric label="Published" value={data.published} /><Metric label="Suspended" value={data.suspended} /></div>
    {permissions.has("businesses.read") ? <form className="ws-search mt-4" role="search" onSubmit={onSearch}><label htmlFor="control-business-search" className="sr-only">Search business name or slug</label><input id="control-business-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search business name or slug" /><button type="submit" className="ws-btn-amber">Search</button></form> : null}
    {businessError ? <p role="alert" className="mt-2 text-sm text-red-700">{businessError}</p> : null}
    <div className="mt-4 space-y-3">{businesses.length ? businesses.map((business: Business) => <article key={business.id} className="rounded-xl border border-[color:var(--ws-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{business.name}</h3><p className="ws-tiny">{business.category} · {business.slug} · {business.id}</p></div><span className="ws-pill" data-tone={business.status === "ACTIVE" ? "live" : "draft"}>{business.status}{business.isPublished ? " · published" : " · unpublished"}</span></div>
      {business.status !== "SUSPENDED" && permissions.has("businesses.suspend") ? <BusinessAction business={business} status="SUSPENDED" label="Suspend" reason={reasonByBusiness[business.id] || ""} setReason={(value: string) => setReasonByBusiness((current: any) => ({ ...current, [business.id]: value }))} submit={() => onStatusChange(business, "SUSPENDED")} pending={pendingAction === business.id} /> : null}
      {business.status === "SUSPENDED" && permissions.has("businesses.reinstate") ? <BusinessAction business={business} status="ACTIVE" label="Reinstate" reason={reasonByBusiness[business.id] || ""} setReason={(value: string) => setReasonByBusiness((current: any) => ({ ...current, [business.id]: value }))} submit={() => onStatusChange(business, "ACTIVE")} pending={pendingAction === business.id} /> : null}
    </article>) : <p className="ws-muted">No matching business records in this permission scope.</p>}</div>
    {hasMore ? <button type="button" className="ws-btn-outline ws-btn-outline--ink mt-3" onClick={onLoadMore}>Load next page</button> : null}
  </>;
  if (sectionKey === "subscriptions.read" || sectionKey === "payments.read") return <>
    <p className="mt-3 text-3xl font-semibold">{data.total}</p><p className="ws-tiny">Authoritative record count</p>
    <div className="mt-3 flex flex-wrap gap-2">{data.byStatus.map((row: any) => <span key={row.status} className="ws-pill" data-tone={row.status === "FAILED" ? "draft" : "live"}>{row.status}: {row.count}</span>)}</div>
    {sectionKey === "payments.read" ? <p className="ws-tiny mt-3">No amount total is presented here; payment records alone do not establish reconciliation or commission eligibility.</p> : null}
  </>;
  if (sectionKey === "agents.read") return <><div className="ws-stats mt-4"><Metric label="Applications" value={data.total} /><Metric label="Consented registration attributions" value={data.consentedRegistrationAttributions} /><Metric label="Activation" value="Not inferred" /></div><Breakdown label="Application status" rows={data.byStatus} /><Breakdown label="Agent status" rows={data.byAgentStatus} /></>;
  if (sectionKey === "commissions.read") return <><p className="mt-3 text-3xl font-semibold">{data.total}</p><Breakdown label="Stored ledger entry types" rows={data.byEntryType.map((row: any) => ({ status: row.entryType, count: row.count }))} /><p className="ws-muted mt-3">No earning, payable amount, payout eligibility or policy is inferred from these immutable storage rows.</p></>;
  if (sectionKey === "communications") return <Breakdown label="Outbox states (not delivery receipts)" rows={data.byState.map((row: any) => ({ status: row.state, count: row.count }))} />;
  if (sectionKey === "system") return <div className="mt-3 flex gap-2"><span className="ws-pill" data-tone="live">Application {data.application}</span><span className="ws-pill" data-tone="live">Database {data.database}</span><span className="ws-tiny">{data.observedAt}</span></div>;
  if (sectionKey === "exceptions") return <div className="ws-stats mt-4"><Metric label="Failed/refunded payment records" value={data.failedOrRefundedPaymentRecords} /><Metric label="Pending agent applications" value={data.pendingAgentApplications} /><Metric label="Failed/unknown notification rows" value={data.failedOrUnknownNotificationRows} /></div>;
  if (sectionKey === "audit") return <div className="mt-4 space-y-2">{auditEvents.length ? auditEvents.map((row: any) => <article key={row.id} className="rounded-lg border border-[color:var(--ws-border)] p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{row.action}</strong><span className="ws-pill" data-tone={row.outcome === "SUCCESS" ? "live" : "draft"}>{row.outcome}</span></div><p className="ws-tiny mt-1">{row.actorRole} · {row.actorId} · {row.targetType}{row.targetId ? `/${row.targetId}` : ""} · {new Date(row.createdAt).toLocaleString()}</p>{row.reason ? <p className="ws-muted mt-1">Reason: {row.reason}</p> : null}</article>) : <p className="ws-muted">No control audit events are in this permission scope.</p>}{auditNextCursor ? <button type="button" className="ws-btn-outline ws-btn-outline--ink" onClick={onLoadMoreAudit}>Load next audit page</button> : null}</div>;
  if (sectionKey === "providers") return <p className="ws-muted mt-3">{section.note}</p>;
  return <pre className="mt-3 overflow-auto rounded-lg bg-[color:var(--ws-canvas)] p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="ws-stat"><span className="ws-stat__label">{label}</span><strong className="ws-stat__value">{value}</strong></div>; }
function Breakdown({ label, rows }: { label: string; rows: Array<{ status: string; count: number }> }) { return <div className="mt-4"><p className="ws-tiny">{label}</p><div className="mt-2 flex flex-wrap gap-2">{rows.length ? rows.map((row) => <span key={row.status} className="ws-pill" data-tone={row.status === "FAILED" || row.status === "UNKNOWN" ? "draft" : "live"}>{row.status}: {row.count}</span>) : <span className="ws-muted">No records</span>}</div></div>; }
function BusinessAction({ business, status, label, reason, setReason, submit, pending }: { business: Business; status: "SUSPENDED" | "ACTIVE"; label: string; reason: string; setReason: (value: string) => void; submit: () => void; pending: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return <div className="mt-3 border-t pt-3">
    {!confirm ? <button type="button" className="ws-btn-outline ws-btn-outline--ink" onClick={() => setConfirm(true)}>{label}</button> : <div className="space-y-2">
      <label className="block text-sm font-semibold" htmlFor={`reason-${business.id}`}>Operational reason</label>
      <textarea id={`reason-${business.id}`} className="w-full rounded-lg border p-3" minLength={12} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      <p className="ws-tiny">This changes the authoritative Business status and records an immutable audit event. No other field is changed.</p>
      <div className="flex gap-2"><button type="button" disabled={pending || reason.trim().length < 12} className="ws-btn-amber" onClick={submit}>{pending ? "Saving…" : `Confirm ${label.toLowerCase()}`}</button><button type="button" className="ws-btn-outline ws-btn-outline--ink" onClick={() => setConfirm(false)}>Cancel</button></div>
    </div>}
  </div>;
}
