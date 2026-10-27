import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadStore } from "@/lib/erp/loaders";
import { formatCentsShort } from "@/lib/erp/money";
import { Badge, EmptyState, Kpi, Notice, PageHead, StatusTone, humanise } from "@/components/erp/ErpBits";
import { storefrontUrl, orderTransitions, ORDER_STATUS_LABELS } from "@/lib/erp/storefront";
import { saveStorefrontAction, storeOrderAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Online store.
 *
 * The shop is a public page at /store/{slug}. Prices shown there are recomputed from the catalogue
 * on every order, so a stale browser tab cannot buy at yesterday's price. Stock is deducted only
 * when the business confirms the order.
 */
export default async function StorePage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const data = await loadStore(businessId);
  const base = workspace.basePath;
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const settings = data.settings;
  const slug = data.configuration?.storefrontSlug ?? workspace.business.slug;
  const publicUrl = storefrontUrl(process.env.PUBLIC_BASE_URL ?? "", String(slug));
  const pendingOrders = data.orders.filter((order: any) => ["PENDING", "CONFIRMED", "READY"].includes(String(order.status)));

  return (
    <>
      <PageHead
        title="Online store"
        description="A public ordering page with your own catalogue. Customers pay you directly; this workspace takes no money on your behalf."
        actions={
          settings.enabled && slug ? (
            <Link href={`/store/${slug}`} className="erp-btn erp-btn-secondary erp-btn-sm" target="_blank" rel="noreferrer">Open shop ↗</Link>
          ) : (
            <Badge tone="warn">Shop closed</Badge>
          )
        }
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-4">
        <Kpi label="Shop status" value={settings.enabled ? "Open" : "Closed"} hint={settings.enabled ? "Customers can order" : "Nobody can place an order"} />
        <Kpi label="Products visible" value={String(data.productCount)} hint="From your POS catalogue" />
        <Kpi label="Orders waiting" value={String(pendingOrders.length)} hint={`${data.orders.length} orders in total`} />
        <Kpi label="Stock checked" value="On confirmation" hint="Not at order time — see the note" />
      </dl>

      <section className="erp-grid erp-split">
        <div className="erp-card">
          <h2>Shop settings</h2>
          <form action={saveStorefrontAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <div className="erp-field">
              <label className="erp-label" htmlFor="slug">Shop address</label>
              <div className="erp-actions" style={{ flexWrap: "nowrap" }}>
                <span className="erp-muted erp-small">/store/</span>
                <input id="slug" name="slug" className="erp-input" defaultValue={slug ?? ""} pattern="[a-z0-9-]{3,60}" />
              </div>
              <p className="erp-hint">{publicUrl}</p>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="headline">Headline</label>
              <input id="headline" name="headline" className="erp-input" defaultValue={settings.headline ?? ""} maxLength={120} placeholder="Fresh produce, delivered in Nairobi" />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="about">About your shop</label>
              <textarea id="about" name="about" className="erp-textarea" defaultValue={settings.about ?? ""} maxLength={400} />
            </div>
            <div className="erp-row">
              <div className="erp-field">
                <label className="erp-label" htmlFor="deliveryFee">Delivery fee (KES)</label>
                <input id="deliveryFee" name="deliveryFee" className="erp-input" inputMode="decimal" defaultValue={String((settings.deliveryFeeCents ?? 0) / 100)} />
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="minimumOrder">Minimum order (KES)</label>
                <input id="minimumOrder" name="minimumOrder" className="erp-input" inputMode="decimal" defaultValue={String((settings.minimumOrderCents ?? 0) / 100)} />
              </div>
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="deliveryAreas">Delivery areas (comma separated)</label>
              <input id="deliveryAreas" name="deliveryAreas" className="erp-input" defaultValue={(settings.deliveryAreas ?? []).join(", ")} placeholder="Nairobi CBD, Westlands, Kilimani" />
              <p className="erp-hint">An address outside these areas is refused at checkout, before an order exists.</p>
            </div>
            <div className="erp-row">
              <div className="erp-field">
                <label className="erp-label" htmlFor="openHour">Opens (hour, 0–23)</label>
                <input id="openHour" name="openHour" type="number" min="0" max="23" className="erp-input" defaultValue={settings.openHour ?? 8} />
              </div>
              <div className="erp-field">
                <label className="erp-label" htmlFor="closeHour">Closes (hour, 1–24)</label>
                <input id="closeHour" name="closeHour" type="number" min="1" max="24" className="erp-input" defaultValue={settings.closeHour ?? 20} />
              </div>
            </div>
            <label className="erp-check"><input type="checkbox" name="allowDelivery" value="on" defaultChecked={settings.allowDelivery !== false} /><span>Offer delivery</span></label>
            <label className="erp-check"><input type="checkbox" name="allowPickup" value="on" defaultChecked={settings.allowPickup !== false} /><span>Offer collection</span></label>
            <label className="erp-check"><input type="checkbox" name="enabled" value="on" defaultChecked={settings.enabled} /><span>Open the shop to customers</span></label>
            <button type="submit" className="erp-btn erp-btn-primary">Save shop settings</button>
            <p className="erp-hint">Products without a price or that are switched off in the POS never appear here.</p>
          </form>
        </div>

        <div className="erp-card">
          <h2>How ordering works</h2>
          <ul className="erp-list">
            <li><span>1. Customer orders</span><span className="erp-muted erp-small" style={{ maxWidth: "40ch", textAlign: "right" }}>Prices are recomputed on the server from your catalogue. A tampered cart cannot change the total.</span></li>
            <li><span>2. You confirm</span><span className="erp-muted erp-small" style={{ maxWidth: "40ch", textAlign: "right" }}>Stock is checked and deducted in one transaction at confirmation, not at order time.</span></li>
            <li><span>3. Fulfil</span><span className="erp-muted erp-small" style={{ maxWidth: "40ch", textAlign: "right" }}>Move the order through preparing, ready, delivered or cancelled.</span></li>
          </ul>
          <Notice tone="info">
            The store does not take card or mobile money payments in this release. Customers pay you directly on delivery or collection, and you record the receipt in Invoices.
          </Notice>
          {!process.env.STOREFRONT_REF_SECRET ? (
            <Notice tone="warn">
              STOREFRONT_REF_SECRET is not configured on this deployment, so the shop cannot be opened. Product links are signed with it; without it, a customer could guess a product id.
            </Notice>
          ) : null}
        </div>
      </section>

      <section className="erp-card">
        <h2>Orders</h2>
        <p className="erp-card-sub">Newest first. Confirming deducts stock once; sending the same request again does nothing.</p>
        {data.orders.length === 0 ? (
          <EmptyState glyph="◉" title="No orders yet">{settings.enabled ? "Share your shop link and the first order will appear here." : "Open the shop to start taking orders."}</EmptyState>
        ) : (
          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead>
                <tr><th>Order</th><th>Customer</th><th>Fulfilment</th><th>Status</th><th className="num">Total</th><th>Placed</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.orders.map((order: any) => (
                  <tr key={order.id}>
                    <td className="erp-mono">{order.orderNumber}</td>
                    <td>{order.customerName}<div className="erp-muted erp-small">•••{String(order.customerPhone ?? "").slice(-3)}</div></td>
                    <td className="erp-small">{humanise(order.fulfilment)}</td>
                    <td><Badge tone={StatusTone(order.status)}>{ORDER_STATUS_LABELS[String(order.status)] ?? humanise(order.status)}</Badge></td>
                    <td className="num">{formatCentsShort(order.totalCents)}</td>
                    <td className="erp-small">{new Date(order.createdAt).toLocaleString("en-KE")}</td>
                    <td>
                      <div className="erp-actions">
                        {order.status === "PENDING" ? (
                          <form action={storeOrderAction}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="hidden" name="orderAction" value="confirm" />
                            <button type="submit" className="erp-btn erp-btn-sm erp-btn-primary">Confirm</button>
                          </form>
                        ) : null}
                        {orderTransitions(order.status).length > 0 ? (
                          <form action={storeOrderAction} className="erp-actions" style={{ flexWrap: "nowrap" }}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="hidden" name="orderAction" value="advance" />
                            <select name="status" className="erp-select" aria-label={`Next status for ${order.orderNumber}`} style={{ minHeight: 34, padding: "6px 8px" }}>
                              {orderTransitions(order.status).map((status) => (
                                <option key={status} value={status}>{ORDER_STATUS_LABELS[status] ?? humanise(status)}</option>
                              ))}
                            </select>
                            <button type="submit" className="erp-btn erp-btn-sm erp-btn-secondary">Update</button>
                          </form>
                        ) : (
                          <span className="erp-muted erp-small">Final</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="erp-hint">Cancelling a confirmed order does not silently return stock. Record the return in the POS so the movement is traceable.</p>
      </section>
    </>
  );
}
