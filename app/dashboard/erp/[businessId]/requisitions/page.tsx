import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadRequisitionCentre } from "@/lib/erp/loaders";
import { Badge, EmptyState, Kpi, Notice, PageHead, humanise } from "@/components/erp/ErpBits";
import {
  createRequisitionAction,
  submitRequisitionAction,
  decideRequisitionAction,
  convertRequisitionAction,
  cancelRequisitionAction,
} from "../actions";
import {
  REQUISITION_TAX_RATES_BPS,
  REQUISITION_PRIORITY_LABELS,
  REQUISITION_STATUS_LABELS,
  canRaiseRequisition,
  canDecideRequisition,
  normalizeRequisitionPriority,
  normalizeRequisitionStatus,
} from "@/lib/erp/requisitions";
import { formatCentsShort } from "@/lib/erp/money";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Requisitions: who asked to buy what, and who said yes.
 *
 * The screen exists because "approved" and "ordered" are different facts and a business that only
 * keeps purchase orders cannot answer either question afterwards. A request that is rejected keeps
 * its row and its reason; an approved one becomes an order through one button, and a submitted one
 * somebody amends goes back to draft rather than being approved as it used to read.
 */
export default async function RequisitionsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const centre = await loadRequisitionCentre(businessId);
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;

  const canRaise = canRaiseRequisition(workspace.role);
  const canDecide = canDecideRequisition(workspace.role);

  const renderRequest = (request: any) => {
    const status = normalizeRequisitionStatus(request.status);
    const priority = normalizeRequisitionPriority(request.priority);
    const lines = (request.lines ?? []) as any[];
    const isMine = String(request.requestedBy) === String(workspace.session?.userId ?? "");
    const tone = status === "REJECTED" || status === "CANCELLED" ? "neutral" : status === "APPROVED" || status === "CONVERTED" ? "good" : status === "SUBMITTED" ? "warn" : "neutral";
    // Separation of duties, shown where it applies rather than explained after the fact.
    const mayDecideThis = canDecide && status === "SUBMITTED" && !isMine;
    return (
      <li key={request.id} style={{ display: "grid", gap: 8, padding: "14px 0", borderBottom: "1px solid var(--erp-line)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong className="erp-small">{request.requisitionNumber}</strong>
          <Badge tone={tone}>{REQUISITION_STATUS_LABELS[status]}</Badge>
          <span className="erp-small erp-strong">{request.title}</span>
          <span className="erp-small erp-strong">{formatCentsShort(Number(request.estimatedTotalCents))}</span>
          {priority !== "NORMAL" ? <Badge tone={priority === "URGENT" ? "warn" : "neutral"}>{REQUISITION_PRIORITY_LABELS[priority]}</Badge> : null}
          {request.department ? <span className="erp-small erp-muted">{request.department}</span> : null}
          <span className="erp-small erp-muted">
            · asked by {isMine ? "you" : request.requestedName ?? "a teammate"} on {formatDate(request.createdAt)}
          </span>
          {request.neededBy ? <span className="erp-small erp-muted">· needed by {formatDate(request.neededBy)}</span> : null}
        </div>

        <ul className="erp-small erp-muted" style={{ margin: 0, paddingLeft: 18 }}>
          {lines.map((line) => (
            <li key={line.id}>
              {line.description} — {line.quantity} × {formatCentsShort(Number(line.estimatedUnitCostCents))}
              {Number(line.taxRateBps) > 0 ? ` + ${Number(line.taxRateBps) / 100}% VAT` : ""}
            </li>
          ))}
        </ul>

        {request.justification ? <p className="erp-small erp-muted" style={{ margin: 0 }}>{request.justification}</p> : null}
        {request.supplierName ? <p className="erp-small erp-muted" style={{ margin: 0 }}>Suggested supplier: {request.supplierName}</p> : null}
        {request.decisionNote ? (
          <p className="erp-small erp-muted" style={{ margin: 0 }}>
            {status === "REJECTED" ? "Rejected" : "Decided"} by {request.decidedName ?? "a manager"}: {request.decisionNote}
          </p>
        ) : null}
        {request.purchaseOrderId ? <p className="erp-small erp-muted" style={{ margin: 0 }}>Became a purchase order — see Procurement.</p> : null}
        {status === "CANCELLED" && request.cancelReason ? <p className="erp-small erp-muted" style={{ margin: 0 }}>Cancelled: {request.cancelReason}</p> : null}

        {canRaise && isMine && status === "DRAFT" ? (
          <form action={submitRequisitionAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="requisitionId" value={request.id} />
            <button className="erp-btn erp-btn-primary erp-btn-sm" type="submit">Send for a decision</button>
          </form>
        ) : null}

        {mayDecideThis ? (
          <div style={{ display: "grid", gap: 8 }}>
            <form action={decideRequisitionAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="requisitionId" value={request.id} />
              <input type="hidden" name="decision" value="APPROVE" />
              <input name="note" className="erp-input erp-input-sm" maxLength={2000} placeholder="Note (optional)" style={{ width: 220, display: "inline-block", minHeight: 32, padding: "4px 8px" }} />
              <button className="erp-btn erp-btn-primary erp-btn-sm" type="submit">Approve</button>
            </form>
            <form action={decideRequisitionAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="requisitionId" value={request.id} />
              <input type="hidden" name="decision" value="REJECT" />
              <input name="note" className="erp-input erp-input-sm" required minLength={3} maxLength={2000} placeholder="Why reject it?" style={{ width: 220, display: "inline-block", minHeight: 32, padding: "4px 8px" }} />
              <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Reject</button>
            </form>
          </div>
        ) : null}

        {canRaise && status === "APPROVED" ? (
          <form action={convertRequisitionAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="requisitionId" value={request.id} />
            <button className="erp-btn erp-btn-primary erp-btn-sm" type="submit">
              {request.supplierId ? "Turn into a purchase order" : "Name a supplier first — order needs one"}
            </button>
          </form>
        ) : null}

        {canRaise && (status === "DRAFT" || status === "SUBMITTED" || status === "APPROVED") ? (
          <form action={cancelRequisitionAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="requisitionId" value={request.id} />
            <input name="reason" className="erp-input erp-input-sm" required minLength={3} maxLength={2000} placeholder="Why cancel?" style={{ width: 200, display: "inline-block", minHeight: 32, padding: "4px 8px" }} />
            <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Cancel request</button>
          </form>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <PageHead
        title="Requisitions"
        description="Ask to buy something, let somebody with authority decide, and keep the answer. An approved request becomes a purchase order — nothing is bought from this screen."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-3">
        <Kpi label="Drafts" value={String(centre.summary.draft)} hint="Not submitted yet" />
        <Kpi label="Waiting decision" value={String(centre.summary.submitted)} hint={centre.summary.submitted ? "Nobody has approved these" : "Nothing waiting"} />
        <Kpi label="Approved" value={String(centre.summary.approved)} hint={`${centre.summary.converted} turned into orders`} />
      </dl>

      {canRaise ? (
        <section className="erp-card">
          <h2>Raise a request</h2>
          <p className="erp-card-sub">
            {centre.suppliers.length === 0
              ? "No suppliers yet — you can still raise the request and name a supplier before it becomes an order."
              : "A request is a draft until you send it for a decision. You cannot approve your own."}
          </p>
          <form action={createRequisitionAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="requestKey" value={`${businessId}:${centre.requests.length}:${Date.now()}`} />
            <div className="erp-row">
              <div className="erp-field" style={{ flex: "2 1 260px" }}>
                <label className="erp-label" htmlFor="title">What do you need?</label>
                <input id="title" name="title" className="erp-input" required minLength={3} maxLength={160} placeholder="Bulk cement for the Kajiado site" />
              </div>
              <div className="erp-field" style={{ flex: "1 1 140px" }}>
                <label className="erp-label" htmlFor="department">Department</label>
                <input id="department" name="department" className="erp-input" maxLength={80} placeholder="Operations" />
              </div>
              <div className="erp-field" style={{ flex: "1 1 140px" }}>
                <label className="erp-label" htmlFor="priority">Priority</label>
                <select id="priority" name="priority" className="erp-input" defaultValue="NORMAL">
                  {(["LOW", "NORMAL", "HIGH", "URGENT"] as const).map((priority) => (
                    <option key={priority} value={priority}>{REQUISITION_PRIORITY_LABELS[priority]}</option>
                  ))}
                </select>
              </div>
              <div className="erp-field" style={{ flex: "1 1 150px" }}>
                <label className="erp-label" htmlFor="neededBy">Needed by</label>
                <input id="neededBy" name="neededBy" type="date" className="erp-input" />
              </div>
            </div>

            <div className="erp-row">
              <div className="erp-field" style={{ flex: "2 1 240px" }}>
                <label className="erp-label" htmlFor="supplierId">Suggested supplier</label>
                <select id="supplierId" name="supplierId" className="erp-input" defaultValue="">
                  <option value="">Decide later</option>
                  {centre.suppliers.map((supplier: any) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </div>
              <div className="erp-field" style={{ flex: "3 1 320px" }}>
                <label className="erp-label" htmlFor="justification">Why (optional)</label>
                <input id="justification" name="justification" className="erp-input" maxLength={2000} placeholder="Stock is below the reorder level for the fourth week" />
              </div>
            </div>

            {[0, 1].map((index) => (
              <div className="erp-row" key={index}>
                <div className="erp-field" style={{ flex: "2 1 220px" }}>
                  <label className="erp-label" htmlFor={`lineDescription-${index}`}>Line {index + 1}{index === 0 ? "" : " (optional)"}</label>
                  <input id={`lineDescription-${index}`} name="lineDescription" className="erp-input" placeholder="40 bags of cement" />
                </div>
                <div className="erp-field" style={{ flex: "1 1 180px" }}>
                  <label className="erp-label" htmlFor={`lineProduct-${index}`}>Stocked product</label>
                  <select id={`lineProduct-${index}`} name="lineProduct" className="erp-input" defaultValue="">
                    <option value="">Not a stocked item</option>
                    {centre.products.map((product: any) => (
                      <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="erp-field" style={{ flex: "1 1 100px" }}>
                  <label className="erp-label" htmlFor={`lineQuantity-${index}`}>Qty</label>
                  <input id={`lineQuantity-${index}`} name="lineQuantity" className="erp-input" inputMode="decimal" placeholder="0" />
                </div>
                <div className="erp-field" style={{ flex: "1 1 130px" }}>
                  <label className="erp-label" htmlFor={`lineUnitCost-${index}`}>Est. unit (KES)</label>
                  <input id={`lineUnitCost-${index}`} name="lineUnitCost" className="erp-input" inputMode="decimal" placeholder="0" />
                </div>
                <div className="erp-field" style={{ flex: "1 1 120px" }}>
                  <label className="erp-label" htmlFor={`lineTaxRate-${index}`}>VAT</label>
                  <select id={`lineTaxRate-${index}`} name="lineTaxRate" className="erp-input" defaultValue="1600">
                    {REQUISITION_TAX_RATES_BPS.map((rate) => (
                      <option key={rate} value={rate}>{rate === 0 ? "No VAT" : `${rate / 100}%`}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <button className="erp-btn erp-btn-primary" type="submit">Save draft request</button>
          </form>
        </section>
      ) : (
        <Notice tone="info">Your role can read requests but not raise them.</Notice>
      )}

      <section className="erp-card">
        <h2>Requests</h2>
        {centre.requests.length === 0 ? (
          <EmptyState glyph="⇢" title="Nothing requested yet">
            <p>Ask for what you need above. Nothing is bought until a request is approved and turned into a purchase order.</p>
          </EmptyState>
        ) : (
          <ul className="erp-list">{centre.requests.map(renderRequest)}</ul>
        )}
      </section>

      <p className="erp-muted erp-small">
        Approving needs the {humanise(workspace.role).toLowerCase()} role to hold <strong>approve spend</strong>, and never the
        requester — a request cannot be approved by the person who raised it. Raising needs <strong>manage inventory</strong>.
        Every submit, amendment, approval, rejection, cancellation and conversion is written to the audit trail with both
        versions of the record.
      </p>
    </>
  );
}
