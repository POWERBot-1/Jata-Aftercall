"use client";

/**
 * Order confirmation (§27, §42)
 *
 * Payment state is explicit and separate from fulfilment: a customer always knows whether
 * money has moved, and an unpaid order is never presented as a completed sale.
 */

import { ResumePaymentButton } from "./ResumePaymentButton";
import Link from "next/link";
import { formatKES } from "@/lib/format";
import { getWhatsAppUrl, normalizeKePhone } from "@/lib/phone";

export function OrderStatusPanel({
  slug,
  reference,
  paid,
  stage,
  totalKES,
  fulfilment,
  confirmationLabel,
  items,
  subtotalKES,
  deliveryFeeKES,
  whatsapp,
  phone,
  businessName,
}: {
  slug: string;
  reference: string;
  paid: boolean;
  stage: string;
  status?: string;
  totalKES: number;
  fulfilment: string | null;
  confirmationLabel: string;
  items: Array<{ name: string; quantity: number; unitPriceKES: number; variantDesc?: string | null }>;
  subtotalKES: number;
  deliveryFeeKES: number;
  whatsapp: string | null;
  phone: string | null;
  businessName: string;
}) {
  const wa = normalizeKePhone(whatsapp);

  return (
    <div className="eb-card" style={{ padding: "clamp(1.25rem, 4vw, 2rem)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ fontSize: "1.75rem" }}>{paid ? "🎉" : "⏳"}</span>
        <div>
          <h1 className="eb-h2" style={{ marginBottom: "0.2rem" }}>{paid ? confirmationLabel : "Waiting for payment"}</h1>
          <p className="eb-muted" style={{ margin: 0 }}>
            {paid
              ? `${businessName} has received your order and will update you as it progresses.`
              : "Your order has been sent. We are waiting for the payment to be confirmed."}
          </p>
        </div>
      </div>

      <dl style={{ display: "grid", gap: "0.5rem", marginTop: "1.75rem" }}>
        <div className="eb-totals__row"><dt>Reference</dt><dd style={{ margin: 0 }}>{reference}</dd></div>
        <div className="eb-totals__row">
          <dt>Payment</dt>
          <dd style={{ margin: 0, fontWeight: 700 }}>{paid ? "Paid ✓" : "Unpaid"}</dd>
        </div>
        <div className="eb-totals__row">
          <dt>Status</dt>
          <dd style={{ margin: 0 }}>{stage.charAt(0) + stage.slice(1).toLowerCase()}</dd>
        </div>
        {fulfilment ? (
          <div className="eb-totals__row">
            <dt>Fulfilment</dt>
            <dd style={{ margin: 0 }}>{fulfilment === "DELIVERY" ? "Delivery" : "Pickup"}</dd>
          </div>
        ) : null}
      </dl>

      <ul style={{ listStyle: "none", margin: "1.75rem 0 0", padding: 0 }}>
        {items.map((item, index) => (
          <li key={index} className="eb-row">
            <div className="eb-row__main">
              <p style={{ margin: 0, fontWeight: 600 }}>{item.name} × {item.quantity}</p>
              {item.variantDesc ? <p className="eb-card__meta" style={{ margin: 0 }}>{item.variantDesc}</p> : null}
            </div>
            <div className="eb-row__side">{formatKES(item.unitPriceKES * item.quantity)}</div>
          </li>
        ))}
      </ul>

      <div className="eb-totals" style={{ marginTop: "1.25rem" }}>
        <div className="eb-totals__row"><span>Subtotal</span><span>{formatKES(subtotalKES)}</span></div>
        {deliveryFeeKES ? <div className="eb-totals__row"><span>Delivery</span><span>{formatKES(deliveryFeeKES)}</span></div> : null}
        <div className="eb-totals__row eb-totals__row--total"><span>Total</span><span>{formatKES(totalKES)}</span></div>
      </div>

      {!paid ? (
        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          {status === "PENDING_PAYMENT" ? <ResumePaymentButton slug={slug} reference={reference} /> : null}
          <Link href={`/b/${slug}/order/${reference}?verify=1`} className="eb-btn eb-btn--outline">
            Check payment status
          </Link>
          {wa ? (
            <a
              className="eb-btn eb-btn--outline"
              href={getWhatsAppUrl(wa, `Hi ${businessName}, I have placed order ${reference} and I am checking on payment.`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Message {businessName}
            </a>
          ) : phone ? (
            <a className="eb-btn eb-btn--outline" href={`tel:${phone.replace(/\s/g, "")}`}>Call {businessName}</a>
          ) : null}
        </div>
      ) : (
        <p className="eb-muted" style={{ marginTop: "1.5rem" }}>
          Questions about this order? {wa ? "Message the business on WhatsApp" : "Call the business"} and quote {reference}.
        </p>
      )}
    </div>
  );
}
