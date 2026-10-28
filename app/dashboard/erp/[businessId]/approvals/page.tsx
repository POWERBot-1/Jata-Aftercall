import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadApprovalCentre } from "@/lib/erp/loaders";
import { Badge, EmptyState, Kpi, Notice, PageHead, humanise } from "@/components/erp/ErpBits";
import { decideApprovalAction, requestApprovalAction, withdrawApprovalAction } from "../actions";
import { approvalLimitFor, APPROVAL_KINDS, APPROVAL_KIND_LABELS, normalizeApprovalKind } from "@/lib/erp/approvals";
import { formatCentsShort } from "@/lib/erp/money";
import { formatDate } from "@/lib/format";
import { ERP_ROLES } from "@/lib/erp/access";

export const dynamic = "force-dynamic";

/**
 * Approvals.
 *
 * A request somebody raised and, if the viewer may decide it, the two buttons that finish it. Whether
 * a button is shown is a convenience: the server action re-derives authority from the role, the
 * amount and the per-tenant threshold on every call, so a crafted POST is refused in the same place a
 * legitimate click is accepted.
 */
export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const viewer = { userId: workspace.session.userId, role: workspace.role };
  const centre = await loadApprovalCentre(businessId, viewer);
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const limitCents = approvalLimitFor(workspace.role);
  const unlimited = limitCents >= Number.MAX_SAFE_INTEGER;
  const approverRoles = ERP_ROLES.filter((role) => role !== "VIEWER");

  const row = (request: any) => {
    const kind = normalizeApprovalKind(request.kind);
    const waiting = request.status === "PENDING";
    const mineToDecide = Boolean(request.canDecide);
    return (
      <li key={request.id} style={{ display: "grid", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--erp-line)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong className="erp-small">{request.title}</strong>
          <Badge tone={request.status === "APPROVED" ? "good" : request.status === "REJECTED" ? "bad" : request.status === "WITHDRAWN" ? "neutral" : "warn"}>
            {humanise(request.status)}
          </Badge>
          <span className="erp-small erp-muted">{APPROVAL_KIND_LABELS[kind]}</span>
          {Number(request.amountCents) > 0 ? <span className="erp-small erp-strong">{formatCentsShort(Number(request.amountCents))}</span> : null}
          <span className="erp-small erp-muted">· asked by {request.requestedName ?? "a teammate"} on {formatDate(request.createdAt)}</span>
        </div>
        {request.detail ? <p className="erp-small erp-muted" style={{ margin: 0 }}>{request.detail}</p> : null}
        {request.href ? <p className="erp-small" style={{ margin: 0 }}><a className="erp-strong" href={String(request.href)}>Open the record this is about →</a></p> : null}
        {!waiting ? (
          <p className="erp-small erp-muted" style={{ margin: 0 }}>
            {humanise(request.status)} by {request.decidedName ?? "a teammate"}
            {request.decidedAt ? ` on ${formatDate(request.decidedAt)}` : ""}
            {request.decisionNote ? ` — “${request.decisionNote}”` : ""}
          </p>
        ) : null}
        {waiting && mineToDecide ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <form action={decideApprovalAction} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="decision" value="APPROVE" />
              <input name="note" className="erp-input erp-input-sm" placeholder="Note (optional)" maxLength={4000} style={{ width: 180, display: "inline-block", minHeight: 32, padding: "4px 8px" }} />
              <button className="erp-btn erp-btn-primary erp-btn-sm" type="submit">Approve</button>
            </form>
            <form action={decideApprovalAction} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="decision" value="REJECT" />
              <input name="note" className="erp-input erp-input-sm" placeholder="Why reject?" required minLength={3} maxLength={4000} style={{ width: 180, display: "inline-block", minHeight: 32, padding: "4px 8px" }} />
              <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Reject</button>
            </form>
          </div>
        ) : null}
        {waiting && !mineToDecide && request.requestedBy === viewer.userId ? (
          <form action={withdrawApprovalAction} style={{ display: "inline" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="requestId" value={request.id} />
            <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Withdraw</button>
          </form>
        ) : null}
        {waiting && !mineToDecide && request.requestedBy !== viewer.userId ? (
          <p className="erp-small erp-muted" style={{ margin: 0 }}>Waiting for a {humanise(request.approverRole)} decision.</p>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <PageHead
        title="Approvals"
        description="Ask before you spend. Every decision is recorded with who decided, when and why — and nobody can approve their own request."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-3">
        <Kpi label="Waiting" value={String(centre.summary.pending)} hint={centre.scope === "mine" ? "Yours to answer or decide" : "Whole business"} />
        <Kpi label="Approved" value={String(centre.summary.approved)} hint="All time" />
        <Kpi label="Rejected" value={String(centre.summary.rejected)} hint="All time" />
      </dl>

      <section className="erp-card">
        <h2>Ask for approval</h2>
        <p className="erp-card-sub">
          {centre.canApprove
            ? unlimited
              ? "Your role can decide any amount. You still cannot approve your own request."
              : `Your role can decide up to ${formatCentsShort(limitCents)}. Anything above that needs an owner.`
            : "You can ask; somebody with approval authority decides. You cannot approve your own request."}
        </p>
        <form action={requestApprovalAction}>
          <input type="hidden" name="businessId" value={businessId} />
          <div className="erp-row">
            <div className="erp-field" style={{ flex: "2 1 260px" }}>
              <label className="erp-label" htmlFor="title">What do you need approved?</label>
              <input id="title" name="title" className="erp-input" required minLength={3} maxLength={160} placeholder="Buy 40 bags of cement for the MGAS order" />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="kind">Type</label>
              <select id="kind" name="kind" className="erp-input" defaultValue="SPEND">
                {APPROVAL_KINDS.map((kind) => <option key={kind} value={kind}>{APPROVAL_KIND_LABELS[kind]}</option>)}
              </select>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="amount">Amount (KES)</label>
              <input id="amount" name="amount" className="erp-input" inputMode="decimal" placeholder="Leave blank if there is no amount" />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="approverRole">Who decides</label>
              <select id="approverRole" name="approverRole" className="erp-input" defaultValue="OWNER">
                {approverRoles.map((role) => <option key={role} value={role}>{humanise(role)}</option>)}
              </select>
            </div>
          </div>
          <div className="erp-field">
            <label className="erp-label" htmlFor="detail">Detail (optional)</label>
            <input id="detail" name="detail" className="erp-input" maxLength={4000} placeholder="Supplier, quote reference, delivery date" />
          </div>
          <button className="erp-btn erp-btn-primary" type="submit">Send for approval</button>
        </form>
      </section>

      <section className="erp-card">
        <h2>Waiting</h2>
        {centre.pending.length === 0 ? (
          <EmptyState glyph="◈" title="Nothing is waiting">
            <p>Requests appear here while they wait for a decision. {centre.scope === "mine" ? "You are only shown requests you raised or were addressed to." : ""}</p>
          </EmptyState>
        ) : (
          <ul className="erp-list">{centre.pending.map(row)}</ul>
        )}
      </section>

      <section className="erp-card">
        <h2>Decided</h2>
        {centre.decided.length === 0 ? (
          <p className="erp-muted erp-small">No decisions yet. Once somebody approves or rejects a request it stays here with the reason.</p>
        ) : (
          <ul className="erp-list">{centre.decided.slice(0, 25).map(row)}</ul>
        )}
      </section>

      <p className="erp-footer">
        {centre.scope === "mine"
          ? "You are shown the requests you raised or that name you. Finance roles see the whole queue."
          : "Finance roles see the whole queue; everybody else sees only their own requests."}
      </p>
    </>
  );
}
