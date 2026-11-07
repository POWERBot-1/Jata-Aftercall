"use client";

/**
 * Instant Order Requests — the customer-facing basket (Business Hub A).
 *
 * Mobile-first and deliberately two-step: choose, then review before sending. Nothing here takes
 * payment or claims a confirmed order — the confirmation screen says so in as many words, and the
 * total is labelled an estimate because the business confirms the final price.
 *
 * The client sends product ids and quantities only. Prices come back from the server, which
 * re-prices every line from the owner's catalogue before it writes anything.
 */

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Minus, Plus, ShoppingBasket, X } from "lucide-react";
import { formatKES } from "@/lib/format";

export type OrderRequestProduct = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceKES: number | null;
  wasPriceKES: number | null;
  stockStatus: string;
  isFeatured: boolean;
};

type Line = { id: string; quantity: number };

type Stage = "choose" | "review" | "sent";

type Sent = { reference: string; status: string; statusHint: string; estimatedTotalKES: number };

function newRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const STOCK_LABEL: Record<string, string> = {
  OUT_OF_STOCK: "Out of stock — ask anyway",
  LOW_STOCK: "Few left",
  PRE_ORDER: "Pre-order",
  DISCONTINUED: "Ask about availability",
  AVAILABLE_ON_REQUEST: "Available on request",
};

export function OrderRequestPanel({
  slug,
  businessName,
  products,
}: {
  slug: string;
  businessName: string;
  products: OrderRequestProduct[];
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [stage, setStage] = useState<Stage>("choose");
  const [customerName, setCustomerName] = useState("");
  const [contactMethod, setContactMethod] = useState<"WHATSAPP" | "PHONE" | "EMAIL" | "IN_PERSON">("WHATSAPP");
  const [contactValue, setContactValue] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — never shown, never filled by a human
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const requestKey = useRef<string>(newRequestKey());

  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const selected = lines
    .map((line) => ({ product: byId.get(line.id), quantity: line.quantity }))
    .filter((entry): entry is { product: OrderRequestProduct; quantity: number } => Boolean(entry.product));

  const estimatedTotal = selected.reduce(
    (total, entry) => total + (entry.product.priceKES ?? 0) * entry.quantity,
    0,
  );
  const itemCount = selected.reduce((total, entry) => total + entry.quantity, 0);

  function setQuantity(id: string, quantity: number) {
    setLines((current) => {
      const next = Math.max(0, Math.min(99, quantity));
      const without = current.filter((line) => line.id !== id);
      return next === 0 ? without : [...without, { id, quantity: next }];
    });
  }

  function reset() {
    setLines([]);
    setStage("choose");
    setMessage("");
    setSent(null);
    setError(null);
    requestKey.current = newRequestKey();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/public/order-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          requestKey: requestKey.current,
          website,
          customerName,
          contactMethod,
          contactValue,
          message,
          items: selected.map((entry) => ({ productId: entry.product.id, quantity: entry.quantity })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The typed details stay on screen: an error must never cost the customer their basket.
        setError(data.error || "We couldn't send your request. Please try again.");
        return;
      }
      setSent({
        reference: data.reference,
        status: data.status || "NEW",
        statusHint: data.statusHint || "The business will contact you to confirm.",
        estimatedTotalKES: data.estimatedTotalKES ?? estimatedTotal,
      });
      setStage("sent");
      requestKey.current = newRequestKey();
    } catch {
      setError("We couldn't reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (products.length === 0) return null;

  if (stage === "sent" && sent) {
    return (
      <section id="order" className="jata-card" aria-labelledby="order-request-sent">
        <h2 id="order-request-sent" className="jata-section-title flex items-center gap-2">
          <CheckCircle2 size={18} aria-hidden="true" className="text-emerald-600" />
          Request sent
        </h2>
        <p className="mt-2 text-sm" role="status">
          Thank you. {businessName} has your request and will contact you to confirm availability and price.
        </p>
        <dl className="jata-stat-grid mt-4">
          <div className="jata-stat">
            <dt>Reference</dt>
            <dd className="text-base font-bold tracking-tight">{sent.reference}</dd>
          </div>
          <div className="jata-stat">
            <dt>Status</dt>
            <dd className="text-base font-bold">{sent.status}</dd>
          </div>
          <div className="jata-stat">
            <dt>Estimated total</dt>
            <dd className="text-base font-bold">{formatKES(sent.estimatedTotalKES)}</dd>
          </div>
        </dl>
        <p className="jata-hint mt-3">
          {sent.statusHint} This is an order request, not a payment: nothing has been charged and the order is not
          confirmed until {businessName} confirms it with you.
        </p>
        <button type="button" className="jata-btn jata-btn-secondary mt-4" onClick={reset}>
          Start another request
        </button>
      </section>
    );
  }

  return (
    <section id="order" className="jata-card" aria-labelledby="order-request-title">
      <h2 id="order-request-title" className="jata-section-title flex items-center gap-2">
        <ShoppingBasket size={18} aria-hidden="true" />
        Request an order
      </h2>
      <p className="jata-hint mt-1">
        Choose what you need and {businessName} will confirm availability and price with you. No payment is taken on
        this page.
      </p>

      {stage === "choose" ? (
        <>
          <ul className="mt-4 space-y-2">
            {products.map((product) => {
              const line = lines.find((entry) => entry.id === product.id);
              const quantity = line?.quantity ?? 0;
              return (
                <li
                  key={product.id}
                  className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-2"
                >
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-xs font-bold text-zinc-500"
                    >
                      {product.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{product.name}</p>
                    {product.description ? (
                      <p className="line-clamp-2 text-xs text-zinc-600">{product.description}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs font-semibold">
                      {product.priceKES === null ? (
                        <span className="text-zinc-600">Price on request</span>
                      ) : (
                        <>
                          {formatKES(product.priceKES)}
                          {product.wasPriceKES ? (
                            <span className="ml-1 font-normal text-zinc-500 line-through">
                              {formatKES(product.wasPriceKES)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </p>
                    {STOCK_LABEL[product.stockStatus] ? (
                      <p className="mt-0.5 text-[11px] font-medium text-amber-700">{STOCK_LABEL[product.stockStatus]}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Quantity of ${product.name}`}>
                    <button
                      type="button"
                      className="jata-icon-btn"
                      aria-label={`Remove one ${product.name}`}
                      onClick={() => setQuantity(product.id, quantity - 1)}
                      disabled={quantity === 0}
                    >
                      <Minus size={16} aria-hidden="true" />
                    </button>
                    <span className="w-7 text-center text-sm font-bold tabular-nums" aria-live="polite">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      className="jata-icon-btn"
                      aria-label={`Add one ${product.name}`}
                      onClick={() => setQuantity(product.id, quantity + 1)}
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold" aria-live="polite">
              {itemCount === 0 ? "Nothing selected yet" : `${itemCount} item${itemCount === 1 ? "" : "s"} · est. ${formatKES(estimatedTotal)}`}
            </p>
            <button
              type="button"
              className="jata-btn jata-btn-primary"
              disabled={itemCount === 0}
              onClick={() => setStage("review")}
            >
              Review request
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Your request</p>
            <ul className="mt-2 space-y-1">
              {selected.map((entry) => (
                <li key={entry.product.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {entry.product.name} <span className="text-zinc-600">× {entry.quantity}</span>
                  </span>
                  <span className="shrink-0 font-semibold">
                    {formatKES((entry.product.priceKES ?? 0) * entry.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2 text-sm font-bold">
              <span>Estimated total</span>
              <span>{formatKES(estimatedTotal)}</span>
            </p>
            <p className="jata-hint mt-1">An estimate only — {businessName} confirms the final price with you.</p>
          </div>

          <div className="jata-field">
            <label className="jata-label" htmlFor="order-customer-name">
              Your name
            </label>
            <input
              id="order-customer-name"
              className="jata-input"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              maxLength={80}
              autoComplete="name"
              required
              placeholder="e.g. Jane Wanjiku"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="order-contact-method">
                How should they reach you?
              </label>
              <select
                id="order-contact-method"
                className="jata-input"
                value={contactMethod}
                onChange={(event) => setContactMethod(event.target.value as typeof contactMethod)}
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="PHONE">Phone call</option>
                <option value="EMAIL">Email</option>
                <option value="IN_PERSON">In person</option>
              </select>
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="order-contact-value">
                {contactMethod === "EMAIL" ? "Your email" : contactMethod === "IN_PERSON" ? "Where to find you" : "Your phone number"}
              </label>
              <input
                id="order-contact-value"
                className="jata-input"
                value={contactValue}
                onChange={(event) => setContactValue(event.target.value)}
                maxLength={60}
                inputMode={contactMethod === "EMAIL" ? "email" : contactMethod === "IN_PERSON" ? "text" : "tel"}
                autoComplete={contactMethod === "EMAIL" ? "email" : "tel"}
                required
                placeholder={contactMethod === "IN_PERSON" ? "e.g. shop counter, Tom Mboya St" : "0712 345 678"}
              />
            </div>
          </div>

          <div className="jata-field">
            <label className="jata-label" htmlFor="order-message">
              Anything else? <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="order-message"
              className="jata-input min-h-20"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              placeholder="Delivery area, size, colour, preferred time…"
            />
          </div>

          {/* Honeypot: hidden from people (and from screen readers), irresistible to bots. */}
          <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
            <label htmlFor="order-website">Website</label>
            <input
              id="order-website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>

          {error ? (
            <p className="jata-error text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="jata-btn jata-btn-primary" disabled={busy}>
              {busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : null}
              {busy ? "Sending…" : "Send request"}
            </button>
            <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setStage("choose")} disabled={busy}>
              Back to products
            </button>
            <button type="button" className="jata-btn jata-btn-ghost" onClick={reset} disabled={busy}>
              <X size={15} aria-hidden="true" /> Clear
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default OrderRequestPanel;
