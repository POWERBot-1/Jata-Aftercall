import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadOrderQueue } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { orderTransitions, ORDER_STATUS_LABELS } from "@/lib/erp/storefront";
import { Badge, EmptyState, Kpi, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { storeOrderAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Orders and fulfilment.
 *
 * The counter's queue, built for one hand and a phone: each order is a block, the only buttons are
 * the transitions the engine actually accepts, and confirming is a separate deliberate tap because
 * it is the step that deducts stock.
 */
export default async function OrdersPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const base = workspace.basePath;
  const queue = await loadOrderQueue(businessId);
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;

  const renderOrder = (order: any) => (
    <li key={order.id} className="erp-card">
      <div className="erp-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong className="erp-mono">{order.orderNumber}</strong>
          <div className="erp-small">{order.customerName} · •••{String(order.customerPhone ?? "").slice(-3)}</div>
          <div className="erp-hint">
            {humanise(order.fulfilment)}{order.deliveryAddress ? ` · ${order.deliveryAddress}` : ""} · placed {new Date(order.createdAt).toLocaleString("en-KE")}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <Badge tone={StatusTone(order.status)}>{ORDER_STATUS_LABELS[String(order.status)] ?? humanise(order.status)}</Badge>
          <div className="erp-strong" style={{ marginTop: 4 }}>{formatCentsShort(order.totalCents)}</div>
        </div>
      </div>

      {order.items.length > 0 ? (
        <ul className="erp-list" style={{ marginTop: 8 }}>
          {order.items.map((item: any) => (
            <li key={item.id}>
              <span className="erp-small">{item.quantity} × {item.name}</span>
              <span className="erp-small erp-muted">{formatCentsShort(item.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="erp-hint">The item lines for this order are not readable right now. The total above came from the order record.</p>
      )}

      {order.notes ? <p className="erp-small" style={{ marginTop: 8 }}><strong>Customer note:</strong> {order.notes}</p> : null}

      <div className="erp-actions" style={{ marginTop: 10 }}>
        {String(order.status) === "PENDING" ? (
          <form action={storeOrderAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="orderAction" value="confirm" />
            <button type="submit" className="erp-btn erp-btn-primary erp-btn-sm">Accept and take stock</button>
          </form>
        ) : null}
        {orderTransitions(order.status).length > 0 ? (
          <form action={storeOrderAction} className="erp-actions" style={{ flexWrap: "nowrap" }}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="orderAction" value="advance" />
            <select name="status" className="erp-select" aria-label={`Next status for ${order.orderNumber}`} style={{ minHeight: 34, padding: "6px 8px", minWidth: 150 }}>
              {orderTransitions(order.status).map((status) => (
                <option key={status} value={status}>{ORDER_STATUS_LABELS[status] ?? humanise(status)}</option>
              ))}
            </select>
            <button type="submit" className="erp-btn erp-btn-secondary erp-btn-sm">Move</button>
          </form>
        ) : null}
        <Link href={`/store/order/${order.publicToken}`} className="erp-btn erp-btn-ghost erp-btn-sm" target="_blank" rel="noreferrer">Customer view ↗</Link>
      </div>
    </li>
  );

  return (
    <>
      <PageHead
        title="Orders and fulfilment"
        description="Online orders from your shop link. Accepting an order deducts stock once; a second tap changes nothing."
        actions={<Link href={`${base}/store`} className="erp-btn erp-btn-secondary erp-btn-sm">Shop settings</Link>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-4">
        <Kpi label="New" value={String(queue.counts.pending)} hint="Waiting for you to accept" />
        <Kpi label="Accepted" value={String(queue.counts.accepted)} hint="Stock already deducted" />
        <Kpi label="Ready" value={String(queue.counts.ready)} hint="Waiting for collection or delivery" />
        <Kpi label="Open value" value={formatCentsShort(queue.counts.openValueCents)} hint="Orders not yet fulfilled" />
      </dl>

      {queue.open.length === 0 ? (
        <EmptyState glyph="☰" title="Nothing waiting" action={{ href: `${base}/store`, label: "Open the shop settings" }}>
          When a customer orders from your link, it appears here. Share the link from the store screen.
        </EmptyState>
      ) : (
        <ul className="erp-steps" style={{ listStyle: "none", padding: 0 }}>
          {queue.open.map(renderOrder)}
        </ul>
      )}

      <section className="erp-card">
        <h2>Recently closed</h2>
        <p className="erp-card-sub">Fulfilled, rejected and cancelled orders, newest first. These cannot be moved again.</p>
        {queue.closed.length === 0 ? (
          <p className="erp-muted erp-small">No closed orders yet.</p>
        ) : (
          <ul className="erp-list">
            {queue.closed.map((order: any) => (
              <li key={order.id}>
                <span className="erp-small"><span className="erp-mono">{order.orderNumber}</span> · {order.customerName}</span>
                <span className="erp-small erp-muted">
                  {ORDER_STATUS_LABELS[String(order.status)] ?? humanise(order.status)} · {formatCentsShort(order.totalCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Notice tone="info">
        The shop does not take card or mobile money in this release. Take payment on delivery or collection and record the receipt in Invoices, so the books and the bank agree.
      </Notice>
    </>
  );
}
