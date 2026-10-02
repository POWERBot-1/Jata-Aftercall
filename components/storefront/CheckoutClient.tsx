"use client";

/**
 * Checkout (§25, §26, §52)
 *
 * Three short steps: who you are, how you want it, how you pay. No account is required and
 * nothing is charged from the browser — the server prices the basket and starts the payment.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCart } from "./CartProvider";
import { trackEvent } from "./Track";
import { formatKES } from "@/lib/format";

type Step = 1 | 2 | 3;

export function CheckoutClient({
  slug,
  businessId,
  businessName,
  deliveryEnabled,
  pickupEnabled,
  deliveryFeeKES,
  deliveryNote,
  minOrderKES,
  cartNoun,
}: {
  slug: string;
  businessId: string;
  businessName: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFeeKES: number;
  deliveryNote?: string | null;
  minOrderKES: number;
  cartNoun: string;
}) {
  const cart = useCart();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fulfilment, setFulfilment] = useState<"PICKUP" | "DELIVERY">(deliveryEnabled ? "DELIVERY" : "PICKUP");
  const [location, setLocation] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subtotal = cart.subtotalKES;
  const delivery = fulfilment === "DELIVERY" ? deliveryFeeKES : 0;
  const estimate = subtotal + delivery;

  const validation = useMemo(() => {
    if (step === 1) {
      if (name.trim().length < 2) return "Enter your name so the business knows who to expect.";
      if (phone.replace(/\D/g, "").length < 9) return "Enter a valid phone number.";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address, or leave it blank.";
      return null;
    }
    if (step === 2 && fulfilment === "DELIVERY" && location.trim().length < 3) {
      return "Add a delivery location so the business knows where to bring your order.";
    }
    return null;
  }, [step, name, phone, email, fulfilment, location]);

  async function placeOrder() {
    setError(null);
    setBusy(true);
    trackEvent(businessId, "CHECKOUT_STARTED");
    try {
      const response = await fetch("/api/storefront/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          items: cart.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            addOnIds: (line.addOns || []).map((addOn) => addOn.id),
            notes: line.notes,
          })),
          fulfilment,
          customer: { name: name.trim(), phone: phone.trim(), email: email.trim() },
          location: fulfilment === "DELIVERY" ? location.trim() : null,
          instructions: fulfilment === "DELIVERY" ? instructions.trim() : null,
          notes: notes.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.orderReference) {
        setError(data.error || "We couldn’t place that order. Please try again.");
        return;
      }
      if (data.unavailable?.length) {
        // Server removed items that could not be fulfilled; the customer sees why.
        setError(data.unavailable.map((entry: { reason: string }) => entry.reason).join(" "));
      }
      if (data.authorizationUrl) {
        cart.clear();
        window.location.href = data.authorizationUrl;
        return;
      }
      // No payment gateway configured (demo): the order exists and is awaiting payment.
      cart.clear();
      window.location.href = `/b/${slug}/order/${data.orderReference}`;
    } catch {
      setError("We couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (cart.lines.length === 0) {
    return (
      <div className="eb-empty">
        <h3 className="eb-h3">Your {cartNoun.toLowerCase()} is empty</h3>
        <p>Add something you like, then come back to check out.</p>
        <div style={{ marginTop: "1rem" }}>
          <Link href={`/b/${slug}/shop`} className="eb-btn">
            Browse
          </Link>
        </div>
      </div>
    );
  }

  const belowMinimum = minOrderKES > 0 && subtotal < minOrderKES;

  return (
    <div className="eb-grid" style={{ gridTemplateColumns: "1fr", gap: "2rem" }} >
      <div style={{ display: "grid", gap: "1.5rem" }}>
        <ol className="eb-steps" aria-label="Checkout steps">
          {[1, 2, 3].map((value) => (
            <li key={value} aria-current={step === value ? "step" : undefined} className={step >= value ? "is-active" : ""}>
              <span>{value}</span>
              {value === 1 ? "Your details" : value === 2 ? "Pickup or delivery" : "Payment"}
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <div>
            <div className="eb-field">
              <label className="eb-label" htmlFor="co-name">Name</label>
              <input id="co-name" className="eb-input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            </div>
            <div className="eb-field">
              <label className="eb-label" htmlFor="co-phone">Phone</label>
              <input id="co-phone" className="eb-input" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" required />
            </div>
            <div className="eb-field">
              <label className="eb-label" htmlFor="co-email">Email (optional)</label>
              <input id="co-email" className="eb-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="eb-label">How would you like to receive it?</legend>
              <div className="eb-chip-row">
                {pickupEnabled ? (
                  <button type="button" className={`eb-chip ${fulfilment === "PICKUP" ? "eb-chip--active" : ""}`} aria-pressed={fulfilment === "PICKUP"} onClick={() => setFulfilment("PICKUP")}>
                    Pickup
                  </button>
                ) : null}
                {deliveryEnabled ? (
                  <button type="button" className={`eb-chip ${fulfilment === "DELIVERY" ? "eb-chip--active" : ""}`} aria-pressed={fulfilment === "DELIVERY"} onClick={() => setFulfilment("DELIVERY")}>
                    Delivery{deliveryFeeKES ? ` · ${formatKES(deliveryFeeKES)}` : ""}
                  </button>
                ) : null}
              </div>
            </fieldset>

            {fulfilment === "DELIVERY" ? (
              <>
                <div className="eb-field" style={{ marginTop: "1rem" }}>
                  <label className="eb-label" htmlFor="co-location">Delivery location</label>
                  <input id="co-location" className="eb-input" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Estate, street, landmark" required />
                </div>
                <div className="eb-field">
                  <label className="eb-label" htmlFor="co-instructions">Delivery instructions (optional)</label>
                  <textarea id="co-instructions" className="eb-textarea" value={instructions} onChange={(event) => setInstructions(event.target.value)} />
                </div>
                {deliveryNote ? <p className="eb-muted">{deliveryNote}</p> : null}
              </>
            ) : null}

            <div className="eb-field" style={{ marginTop: "1rem" }}>
              <label className="eb-label" htmlFor="co-notes">Anything else the business should know?</label>
              <textarea id="co-notes" className="eb-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <h2 className="eb-h3">Pay securely</h2>
            <p className="eb-muted">
              You will be taken to Paystack to pay with M-Pesa or card. {businessName} receives your order as soon as payment is confirmed.
            </p>
            <div className="eb-totals" style={{ marginTop: "1.25rem" }}>
              <div className="eb-totals__row"><span>Subtotal</span><span>{formatKES(subtotal)}</span></div>
              {delivery ? <div className="eb-totals__row"><span>Delivery</span><span>{formatKES(delivery)}</span></div> : null}
              <div className="eb-totals__row eb-totals__row--total"><span>Total</span><span>{formatKES(estimate)}</span></div>
            </div>
            <p className="eb-muted">The final total is confirmed by the business’s own prices when you pay.</p>
          </div>
        ) : null}

        {error ? <p className="eb-error" role="alert">{error}</p> : null}

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {step > 1 ? (
            <button type="button" className="eb-btn eb-btn--outline" onClick={() => setStep((value) => (value === 3 ? 2 : 1))}>
              Back
            </button>
          ) : (
            <Link href={`/b/${slug}/shop`} className="eb-btn eb-btn--outline">Keep browsing</Link>
          )}
          {step < 3 ? (
            <button type="button" className="eb-btn" disabled={Boolean(validation)} onClick={() => setStep((value) => (value === 1 ? 2 : 3))}>
              Continue
            </button>
          ) : (
            <button type="button" className="eb-btn" disabled={busy || belowMinimum} onClick={placeOrder}>
              {busy ? "Starting payment…" : `Pay ${formatKES(estimate)}`}
            </button>
          )}
        </div>
        {validation && step < 3 ? <p className="eb-muted">{validation}</p> : null}
        {belowMinimum ? <p className="eb-error">This business has a minimum order of {formatKES(minOrderKES)}.</p> : null}
      </div>

      <aside className="eb-card" style={{ padding: "1.25rem", alignSelf: "start" }}>
        <h2 className="eb-h3" style={{ marginBottom: "0.75rem" }}>{cartNoun}</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {cart.lines.map((line) => (
            <li key={line.key} className="eb-row">
              <div className="eb-row__main">
                <p style={{ margin: 0, fontWeight: 600 }}>{line.name} × {line.quantity}</p>
                {line.variantLabel ? <p className="eb-card__meta" style={{ margin: 0 }}>{line.variantLabel}</p> : null}
              </div>
              <div className="eb-row__side">
                <span>{formatKES((line.unitPriceKES + (line.addOns || []).reduce((total, addOn) => total + addOn.priceKES, 0)) * line.quantity)}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="eb-totals" style={{ marginTop: "1rem" }}>
          <div className="eb-totals__row"><span>Subtotal</span><span>{formatKES(subtotal)}</span></div>
          {fulfilment === "DELIVERY" ? <div className="eb-totals__row"><span>Delivery</span><span>{formatKES(delivery)}</span></div> : null}
          <div className="eb-totals__row eb-totals__row--total"><span>Estimated total</span><span>{formatKES(estimate)}</span></div>
        </div>
      </aside>
    </div>
  );
}
