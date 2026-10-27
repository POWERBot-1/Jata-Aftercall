"use client";

/**
 * Customer-facing basket.
 *
 * The displayed price is the price the server sent with the catalogue, but the order total is
 * always the one the server recomputes. If they differ the customer is told, not silently charged.
 */

import { useMemo, useState } from "react";

type Product = {
  ref: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  priceCents: number;
  listPriceCents: number;
  onSale: boolean;
  imageUrl: string | null;
  availability: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "MADE_TO_ORDER";
};

type Settings = {
  allowDelivery: boolean;
  allowPickup: boolean;
  deliveryFeeCents: number;
  minimumOrderCents: number;
  deliveryAreas: string[];
  headline: string;
  about: string;
};

type Props = {
  slug: string;
  businessName: string;
  location: string | null;
  products: Product[];
  categories: string[];
  settings: Settings;
  acceptance: { open: boolean; reason: string };
};

const money = (cents: number) => `KES ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function StoreCart({ slug, businessName, location, products, categories, settings, acceptance }: Props) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState<string>("");
  const [fulfilment, setFulfilment] = useState<"PICKUP" | "DELIVERY">(settings.allowPickup ? "PICKUP" : "DELIVERY");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [trap, setTrap] = useState("");
  const [idempotencyKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}`));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ orderNumber: string; totalCents: number; token: string; adjustment: boolean } | null>(null);

  const visible = category ? products.filter((product) => product.category === category) : products;
  const lines = useMemo(() => Object.entries(cart).map(([ref, quantity]) => ({ product: products.find((product) => product.ref === ref)!, quantity })).filter((line) => Boolean(line.product)), [cart, products]);
  const subtotal = lines.reduce((total, line) => total + line.product.priceCents * line.quantity, 0);
  const delivery = fulfilment === "DELIVERY" ? settings.deliveryFeeCents : 0;
  const total = subtotal + delivery;

  function setQuantity(ref: string, quantity: number) {
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[ref];
      else next[ref] = Math.min(99, quantity);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/store/${encodeURIComponent(slug)}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          customerPhone: phone,
          fulfilment,
          deliveryAddress: fulfilment === "DELIVERY" ? address : null,
          notes: notes || null,
          items: lines.map((line) => ({ ref: line.product.ref, quantity: line.quantity })),
          idempotencyKey,
          company: trap,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "We couldn't place that order. Please try again.");
        return;
      }
      setPlaced({ orderNumber: data.orderNumber, totalCents: data.totalCents, token: data.token, adjustment: data.totalCents !== total });
      setCart({});
    } catch {
      setError("We couldn't reach the shop. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    return (
      <section className="erp-card" aria-live="polite">
        <span className="erp-badge" data-tone="good">Order placed</span>
        <h1 style={{ margin: "10px 0 4px", fontSize: "1.5rem" }}>Thank you{name ? `, ${name.split(" ")[0]}` : ""}.</h1>
        <p className="erp-muted">
          Order <strong>{placed.orderNumber}</strong> was sent to {businessName}. The shop confirms it and checks stock before you pay.
        </p>
        <p className="erp-strong">Total on the shop&apos;s records: {money(placed.totalCents)}</p>
        {placed.adjustment ? (
          <p className="erp-hint">
            The total differs from what your basket showed. Prices are recomputed by the shop on the server, and their figure is the one that applies.
          </p>
        ) : null}
        <p className="erp-hint">Keep this link to check the order status — it is private to you and does not show your phone number.</p>
        <a className="erp-btn erp-btn-primary" href={`/store/order/${placed.token}`}>Track this order</a>
      </section>
    );
  }

  return (
    <>
      <header className="erp-hero" style={{ marginBottom: 16 }}>
        <span className="erp-hero-chip">{location ?? "Kenya"} · order direct</span>
        <h1>{settings.headline || businessName}</h1>
        <p>{settings.about || `Order from ${businessName}. You pay on collection or delivery.`}</p>
        <p style={{ marginTop: 6, fontSize: "0.82rem", color: "#c8cfbc" }}>{acceptance.open ? acceptance.reason : `${acceptance.reason} You can still browse prices.`}</p>
      </header>

      {!acceptance.open ? <div className="erp-notice" data-tone="warn"><div>Orders are paused right now. The shop will accept orders when it reopens.</div></div> : null}

      {categories.length > 0 ? (
        <div className="erp-actions" style={{ marginBottom: 12 }}>
          <button type="button" className={category === "" ? "erp-btn erp-btn-sm erp-btn-dark" : "erp-btn erp-btn-sm erp-btn-secondary"} onClick={() => setCategory("")}>All</button>
          {categories.map((entry) => (
            <button key={entry} type="button" className={category === entry ? "erp-btn erp-btn-sm erp-btn-dark" : "erp-btn erp-btn-sm erp-btn-secondary"} onClick={() => setCategory(entry)}>{entry}</button>
          ))}
        </div>
      ) : null}

      <div className="erp-grid erp-split">
        <section className="erp-card">
          <h2>Available today</h2>
          {visible.length === 0 ? (
            <p className="erp-hint">Nothing is available right now. Check back later.</p>
          ) : (
            <ul className="erp-list">
              {visible.map((product) => (
                <li key={product.ref}>
                  <div>
                    <div className="erp-strong">{product.name}</div>
                    <div className="erp-muted erp-small">
                      {money(product.priceCents)} · per {product.unit}
                      {product.onSale ? ` (was ${money(product.listPriceCents)})` : ""}
                    </div>
                    {product.description ? <div className="erp-muted erp-small">{product.description.slice(0, 110)}</div> : null}
                    {product.availability === "LOW_STOCK" ? <span className="erp-badge" data-tone="warn">Low stock</span> : null}
                  </div>
                  <div className="erp-actions" style={{ flexWrap: "nowrap" }}>
                    <button type="button" className="erp-btn erp-btn-sm erp-btn-secondary" onClick={() => setQuantity(product.ref, (cart[product.ref] ?? 0) - 1)} aria-label={`Remove one ${product.name}`}>−</button>
                    <span className="erp-small erp-strong" style={{ minWidth: 22, textAlign: "center" }}>{cart[product.ref] ?? 0}</span>
                    <button type="button" className="erp-btn erp-btn-sm erp-btn-primary" onClick={() => setQuantity(product.ref, (cart[product.ref] ?? 0) + 1)} aria-label={`Add one ${product.name}`}>+</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="erp-card">
          <h2>Your order</h2>
          {lines.length === 0 ? (
            <p className="erp-hint">Your basket is empty. Add something from the list.</p>
          ) : (
            <ul className="erp-list">
              {lines.map((line) => (
                <li key={line.product.ref}>
                  <span className="erp-small">{line.product.name} × {line.quantity}</span>
                  <span className="erp-small erp-strong">{money(line.product.priceCents * line.quantity)}</span>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={submit} style={{ marginTop: 12 }}>
            <div className="erp-field">
              <label className="erp-label" htmlFor="store-name">Your name</label>
              <input id="store-name" className="erp-input" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} autoComplete="name" />
            </div>
            <div className="erp-field">
              <label className="erp-label" htmlFor="store-phone">Phone</label>
              <input id="store-phone" className="erp-input" value={phone} onChange={(event) => setPhone(event.target.value)} required inputMode="tel" autoComplete="tel" placeholder="07XXXXXXXX" />
              <p className="erp-hint">The shop calls this number to confirm. It is not shown on the public page.</p>
            </div>

            <div className="erp-field">
              <span className="erp-label">How would you like it?</span>
              <div className="erp-actions">
                {settings.allowPickup ? (
                  <button type="button" className={fulfilment === "PICKUP" ? "erp-btn erp-btn-sm erp-btn-primary" : "erp-btn erp-btn-sm erp-btn-secondary"} onClick={() => setFulfilment("PICKUP")} aria-pressed={fulfilment === "PICKUP"}>Collect</button>
                ) : null}
                {settings.allowDelivery ? (
                  <button type="button" className={fulfilment === "DELIVERY" ? "erp-btn erp-btn-sm erp-btn-primary" : "erp-btn erp-btn-sm erp-btn-secondary"} onClick={() => setFulfilment("DELIVERY")} aria-pressed={fulfilment === "DELIVERY"}>Deliver</button>
                ) : null}
              </div>
            </div>

            {fulfilment === "DELIVERY" ? (
              <div className="erp-field">
                <label className="erp-label" htmlFor="store-address">Delivery address</label>
                <textarea id="store-address" className="erp-textarea" value={address} onChange={(event) => setAddress(event.target.value)} required minLength={5} />
                {settings.deliveryAreas.length > 0 ? <p className="erp-hint">We deliver to: {settings.deliveryAreas.join(", ")}.</p> : null}
              </div>
            ) : null}

            <div className="erp-field">
              <label className="erp-label" htmlFor="store-notes">Anything we should know?</label>
              <input id="store-notes" className="erp-input" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={200} />
            </div>

            <div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
              <label htmlFor="company">Company</label>
              <input id="company" tabIndex={-1} autoComplete="off" value={trap} onChange={(event) => setTrap(event.target.value)} />
            </div>

            <ul className="erp-list">
              <li><span className="erp-small">Subtotal</span><span className="erp-small">{money(subtotal)}</span></li>
              {fulfilment === "DELIVERY" ? <li><span className="erp-small">Delivery</span><span className="erp-small">{money(delivery)}</span></li> : null}
              <li><span className="erp-strong">Total to pay the shop</span><span className="erp-strong">{money(total)}</span></li>
            </ul>
            {settings.minimumOrderCents > 0 && subtotal < settings.minimumOrderCents ? (
              <p className="erp-hint">Minimum order is {money(settings.minimumOrderCents)}.</p>
            ) : null}

            {error ? <p role="alert" className="erp-hint" style={{ color: "var(--erp-danger)" }}>{error}</p> : null}

            <button type="submit" className="erp-btn erp-btn-primary erp-btn-wide" disabled={busy || lines.length === 0 || !acceptance.open}>
              {busy ? "Sending…" : "Place order"}
            </button>
            <p className="erp-hint">No payment is taken on this page. You pay {fulfilment === "DELIVERY" ? "on delivery" : "on collection"}.</p>
          </form>
        </section>
      </div>
    </>
  );
}
