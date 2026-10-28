import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadProcurementCentre } from "@/lib/erp/loaders";
import { Badge, EmptyState, Kpi, Notice, PageHead, humanise } from "@/components/erp/ErpBits";
import {
  createPurchaseOrderAction,
  submitPurchaseOrderAction,
  orderPurchaseOrderAction,
  receivePurchaseOrderAction,
  cancelPurchaseOrderAction,
  recordPurchaseBillAction,
} from "../actions";
import {
  PURCHASE_TAX_RATES_BPS,
  normalizePurchaseOrderStatus,
  PURCHASE_ORDER_STATUS_LABELS,
  canManageProcurement,
} from "@/lib/erp/procurement";
import { hasErpPermission } from "@/lib/erp/access";
import { formatCentsShort } from "@/lib/erp/money";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Procurement: what we decided to buy, whether it was approved, what arrived and what the supplier
 * charged.
 *
 * Deliberately one screen. A purchase order is a chain of four facts that are only true together —
 * decision, authority, delivery, invoice — and splitting them across tabs is how the fourth gets
 * forgotten. Stock is never shown here as a number this product owns: receiving writes the POS
 * stock ledger, and the inventory screen remains the place stock lives.
 */
export default async function ProcurementPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const centre = await loadProcurementCentre(businessId);
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;

  const canBuy = canManageProcurement(workspace.role) && hasErpPermission(workspace.role, "MANAGE_INVENTORY");
  const canPostBill = hasErpPermission(workspace.role, "POST_JOURNAL");

  const renderOrder = (order: any) => {
    const status = normalizePurchaseOrderStatus(order.status);
    const lines = (order.lines ?? []) as any[];
    const outstanding = lines.some((line) => Number(line.receivedQuantity ?? 0) + 0.0005 < Number(line.quantity));
    const tone = status === "CANCELLED" ? "neutral" : status === "RECEIVED" ? "good" : status === "AWAITING_APPROVAL" ? "warn" : status === "PARTIALLY_RECEIVED" ? "warn" : "neutral";
    return (
      <li key={order.id} style={{ display: "grid", gap: 8, padding: "14px 0", borderBottom: "1px solid var(--erp-line)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong className="erp-small">{order.orderNumber}</strong>
          <Badge tone={tone}>{PURCHASE_ORDER_STATUS_LABELS[status]}</Badge>
          <span className="erp-small erp-strong">{order.supplierName}</span>
          <span className="erp-small erp-strong">{formatCentsShort(Number(order.totalCents))}</span>
          {order.expectedAt ? <span className="erp-small erp-muted">Expected {formatDate(order.expectedAt)}</span> : null}
          <span className="erp-small erp-muted">· raised by {order.requestedName ?? "a teammate"} on {formatDate(order.createdAt)}</span>
        </div>

        <ul className="erp-small erp-muted" style={{ margin: 0, paddingLeft: 18 }}>
          {lines.map((line) => (
            <li key={line.id}>
              {line.description} — {line.quantity} × {formatCentsShort(Number(line.unitCostCents))}
              {Number(line.receivedQuantity ?? 0) > 0 ? ` · ${line.receivedQuantity} received` : ""}
            </li>
          ))}
        </ul>

        {order.notes ? <p className="erp-small erp-muted" style={{ margin: 0 }}>{order.notes}</p> : null}
        {status === "CANCELLED" && order.cancelReason ? <p className="erp-small erp-muted" style={{ margin: 0 }}>Cancelled: {order.cancelReason}</p> : null}

        {canBuy && (status === "DRAFT" || status === "AWAITING_APPROVAL") ? (
          <form action={submitPurchaseOrderAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="orderId" value={order.id} />
            <button className="erp-btn erp-btn-primary erp-btn-sm" type="submit">
              {status === "AWAITING_APPROVAL" ? "Submit again (uses an approval if you have one)" : "Submit for approval or approve"}
            </button>
          </form>
        ) : null}

        {canBuy && status === "APPROVED" ? (
          <form action={orderPurchaseOrderAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="orderId" value={order.id} />
            <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Mark as ordered</button>
          </form>
        ) : null}

        {canBuy && (status === "ORDERED" || status === "PARTIALLY_RECEIVED") && outstanding ? (
          <form action={receivePurchaseOrderAction} style={{ display: "grid", gap: 8 }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="requestKey" value={`${order.id}:${(order.receipts ?? []).length}`} />
            <div className="erp-row">
              {lines.filter((line) => Number(line.receivedQuantity ?? 0) + 0.0005 < Number(line.quantity)).map((line) => (
                <div className="erp-field" key={line.id} style={{ flex: "1 1 180px" }}>
                  <label className="erp-label" htmlFor={`qty-${line.id}`}>
                    {line.description} <span className="erp-muted">({Number(line.quantity) - Number(line.receivedQuantity ?? 0)} outstanding)</span>
                  </label>
                  <input id={`qty-${line.id}`} name={`qty:${line.id}`} className="erp-input" inputMode="decimal" placeholder="0" />
                </div>
              ))}
              <div className="erp-field" style={{ flex: "1 1 200px" }}>
                <label className="erp-label" htmlFor={`note-${order.id}`}>Note (optional)</label>
                <input id={`note-${order.id}`} name="note" className="erp-input" maxLength={2000} placeholder="Delivery note 4471" />
              </div>
            </div>
            <button className="erp-btn erp-btn-primary erp-btn-sm" type="submit" style={{ justifySelf: "start" }}>Record what arrived</button>
          </form>
        ) : null}

        {canPostBill && status !== "CANCELLED" && status !== "DRAFT" && status !== "AWAITING_APPROVAL" ? (
          <form action={recordPurchaseBillAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="orderId" value={order.id} />
            <div className="erp-field" style={{ flex: "1 1 140px" }}>
              <label className="erp-label" htmlFor={`bill-${order.id}`}>Supplier invoice no.</label>
              <input id={`bill-${order.id}`} name="billNumber" className="erp-input" required minLength={2} maxLength={80} />
            </div>
            <div className="erp-field" style={{ flex: "1 1 120px" }}>
              <label className="erp-label" htmlFor={`net-${order.id}`}>Net (KES)</label>
              <input id={`net-${order.id}`} name="net" className="erp-input" inputMode="decimal" required />
            </div>
            <div className="erp-field" style={{ flex: "1 1 120px" }}>
              <label className="erp-label" htmlFor={`tax-${order.id}`}>VAT (KES)</label>
              <input id={`tax-${order.id}`} name="tax" className="erp-input" inputMode="decimal" placeholder="0" />
            </div>
            <div className="erp-field" style={{ flex: "1 1 140px" }}>
              <label className="erp-label" htmlFor={`due-${order.id}`}>Due</label>
              <input id={`due-${order.id}`} name="dueAt" type="date" className="erp-input" />
            </div>
            <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Post bill</button>
          </form>
        ) : null}

        {canBuy && status !== "CANCELLED" && status !== "RECEIVED" ? (
          <form action={cancelPurchaseOrderAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="orderId" value={order.id} />
            <input name="reason" className="erp-input erp-input-sm" placeholder="Why cancel?" required minLength={3} maxLength={2000} style={{ width: 200, display: "inline-block", minHeight: 32, padding: "4px 8px" }} />
            <button className="erp-btn erp-btn-secondary erp-btn-sm" type="submit">Cancel order</button>
          </form>
        ) : null}

        {(order.bills ?? []).length > 0 ? (
          <p className="erp-small erp-muted" style={{ margin: 0 }}>
            Bills: {(order.bills as any[]).map((bill) => `${bill.billNumber} ${formatCentsShort(Number(bill.totalCents))}`).join(" · ")}
          </p>
        ) : null}
        {(order.receipts ?? []).length > 0 ? (
          <p className="erp-small erp-muted" style={{ margin: 0 }}>
            Last delivery {formatDate((order.receipts as any[])[0]?.receivedAt)}{(order.receipts as any[])[0]?.note ? ` — ${(order.receipts as any[])[0].note}` : ""}
          </p>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <PageHead
        title="Procurement"
        description="Buy with a paper trail: raise an order, let whoever must approve it approve it, record what actually arrived, then post the supplier's invoice."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-3">
        <Kpi label="Drafts" value={String(centre.summary.draft)} hint="Not submitted yet" />
        <Kpi label="Waiting approval" value={String(centre.summary.awaiting)} hint={centre.summary.awaiting ? "Nothing has been bought" : "Nothing waiting"} />
        <Kpi label="Open orders" value={String(centre.summary.open)} hint={`${centre.summary.received} received`} />
      </dl>

      {canBuy ? (
        <section className="erp-card">
          <h2>Raise a purchase order</h2>
          <p className="erp-card-sub">
            {centre.suppliers.length === 0
              ? "Add a supplier in the POS suppliers screen first — procurement uses the same supplier records."
              : "Above your approval limit this becomes a request; nothing is ordered until somebody decides."}
          </p>
          <form action={createPurchaseOrderAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="requestKey" value={`${businessId}:${centre.orders.length}:${Date.now()}`} />
            <div className="erp-row">
              <div className="erp-field" style={{ flex: "2 1 240px" }}>
                <label className="erp-label" htmlFor="supplierId">Supplier</label>
                <select id="supplierId" name="supplierId" className="erp-input" required defaultValue="">
                  <option value="" disabled>Choose a supplier</option>
                  {centre.suppliers.map((supplier: any) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.termsDays ? ` · ${supplier.termsDays} day terms` : ""}</option>
                  ))}
                </select>
              </div>
              <div className="erp-field" style={{ flex: "1 1 160px" }}>
                <label className="erp-label" htmlFor="expectedAt">Expected</label>
                <input id="expectedAt" name="expectedAt" type="date" className="erp-input" />
              </div>
              <div className="erp-field" style={{ flex: "2 1 220px" }}>
                <label className="erp-label" htmlFor="notes">Notes (optional)</label>
                <input id="notes" name="notes" className="erp-input" maxLength={4000} placeholder="Quote 2281, deliver to the depot" />
              </div>
            </div>

            {[0, 1, 2].map((index) => (
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
                <div className="erp-field" style={{ flex: "1 1 120px" }}>
                  <label className="erp-label" htmlFor={`lineUnitCost-${index}`}>Unit cost (KES)</label>
                  <input id={`lineUnitCost-${index}`} name="lineUnitCost" className="erp-input" inputMode="decimal" placeholder="0" />
                </div>
                <div className="erp-field" style={{ flex: "1 1 120px" }}>
                  <label className="erp-label" htmlFor={`lineTaxRate-${index}`}>VAT</label>
                  <select id={`lineTaxRate-${index}`} name="lineTaxRate" className="erp-input" defaultValue="1600">
                    {PURCHASE_TAX_RATES_BPS.map((rate) => (
                      <option key={rate} value={rate}>{rate === 0 ? "No VAT" : `${rate / 100}%`}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <button className="erp-btn erp-btn-primary" type="submit" disabled={centre.suppliers.length === 0}>Save draft order</button>
          </form>
        </section>
      ) : (
        <Notice tone="info">Your role can see procurement but not raise or receive orders.</Notice>
      )}

      <section className="erp-card">
        <h2>Orders</h2>
        {centre.orders.length === 0 ? (
          <EmptyState glyph="⇄" title="No purchase orders yet">
            <p>Raise one above. Nothing is bought until it is approved and marked ordered, and stock only moves when a delivery is recorded.</p>
          </EmptyState>
        ) : (
          <ul className="erp-list">{centre.orders.map(renderOrder)}</ul>
        )}
      </section>

      <p className="erp-muted erp-small">
        Stock lives in the inventory screen: a delivery recorded here writes the same stock ledger the till reads. Supplier
        records and the catalogue are shared with the POS — this screen never keeps a second copy. Deliveries and bills are
        attributed to {humanise(workspace.role).toLowerCase()} permission <strong>manage inventory</strong> and{" "}
        <strong>post journal</strong> respectively.
      </p>
    </>
  );
}
