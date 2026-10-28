import Link from "next/link";
import prisma from "@/lib/db";
import { publicOrderView } from "@/lib/erp/storefront";
import { formatCentsShort } from "@/lib/erp/money";
import { Badge, StatusTone, humanise } from "@/components/erp/ErpBits";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/**
 * Private order tracking.
 *
 * The token is 24 random bytes; guessing one is not practical, and the page deliberately shows only
 * the last three digits of any phone number.
 */
export default async function OrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await prisma.erpStoreOrder.findUnique({ where: { publicToken: token } }).catch(() => null);
  if (!order) {
    return (
      <div className="erp">
        <main className="erp-content" style={{ maxWidth: 560, paddingTop: 48 }}>
          <section className="erp-card">
            <span className="erp-badge" data-tone="warn">Not found</span>
            <h1 style={{ fontSize: "1.3rem", margin: "10px 0 6px" }}>That order link doesn&apos;t work</h1>
            <p className="erp-muted erp-small">The link may have been mistyped or the order was removed. Ask the shop to resend it.</p>
          </section>
        </main>
      </div>
    );
  }
  const [items, business] = await Promise.all([
    prisma.erpStoreOrderItem.findMany({ where: { orderId: order.id } }).catch(() => []),
    prisma.business.findUnique({ where: { id: order.businessId }, select: { name: true, phone: true } }).catch(() => null),
  ]);
  const view = publicOrderView(order, items, business ?? { name: "The shop", phone: null });

  return (
    <div className="erp">
      <main className="erp-content" style={{ maxWidth: 720, paddingTop: 24 }}>
        <section className="erp-card">
          <div className="erp-page-head">
            <div>
              <p className="erp-crumbs">Order {view.orderNumber}</p>
              <h1 style={{ fontSize: "1.4rem", margin: "4px 0" }}>{humanise(view.status)}</h1>
              <p className="erp-muted erp-small">{view.businessName} · placed {formatDateTime(view.placedAt)}</p>
            </div>
            <Badge tone={StatusTone(view.status)}>{humanise(view.fulfilment)}</Badge>
          </div>

          <ul className="erp-list">
            {view.items.map((item: any, index: number) => (
              <li key={index}>
                <span className="erp-small">{item.name} × {item.quantity}</span>
                <span className="erp-small">{formatCentsShort(item.lineTotalCents)}</span>
              </li>
            ))}
            <li><span className="erp-small">Subtotal</span><span className="erp-small">{formatCentsShort(view.subtotalCents)}</span></li>
            {view.deliveryCents > 0 ? <li><span className="erp-small">Delivery</span><span className="erp-small">{formatCentsShort(view.deliveryCents)}</span></li> : null}
            <li><span className="erp-strong">Total</span><span className="erp-strong">{formatCentsShort(view.totalCents)}</span></li>
          </ul>

          <p className="erp-hint">
            Payment is made to the shop on {view.fulfilment === "DELIVERY" ? "delivery" : "collection"}. If the shop has questions they will call the number ending {view.phoneLast3}.
          </p>
          <Link href="/" className="erp-btn erp-btn-secondary erp-btn-sm">Back to JATA</Link>
        </section>
      </main>
    </div>
  );
}
