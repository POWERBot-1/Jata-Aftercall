"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatOpeningHours } from "@/lib/openingHours";
import { aiFrontDeskStatusLabel } from "@/lib/statusLabels";

type ProductSummary = {
  id: string;
  name: string;
  description?: string | null;
  /** Price charged now (sale only while its window runs). */
  priceKES?: number | null;
  /** Original price, shown only while a sale is running. */
  wasPriceKES?: number | null;
  stockStatus: string;
  preOrderAllowed?: boolean;
};

type ServiceSummary = {
  id: string;
  title: string;
  description?: string | null;
  priceFrom?: number | null;
};

type DeliveryZone = {
  name: string;
  feeKES: number;
  freeDeliveryAboveKES?: number | null;
};

type CartSummary = {
  lineItems: Array<{
    productId?: string;
    name: string;
    variantDesc?: string;
    quantity: number;
    unitPriceKES: number;
    lineSubtotalKES: number;
  }>;
  subtotalKES: number;
  deliveryFeeKES: number;
  discountKES: number;
  taxKES: number;
  totalKES: number;
  currency: string;
};

type ChatMessage = {
  id: string;
  role: "customer" | "assistant";
  text: string;
  responseType?: "KNOWN" | "UNKNOWN" | "ACTION_REQUIRED";
  source?: string;
  escalatedToHuman?: boolean;
};

/**
 * The customer-facing AI Front Desk.
 *
 * Presentation follows the JATA AFTERCALL homepage — cream paper, ink text, amber accent, soft
 * cards and a serif display line — instead of the generic dark chat template, and it is built for
 * a narrow Android screen first: the conversation is the first thing in the reading order, the
 * composer is a full-width control, and the order summary stacks underneath.
 *
 * The status pill is not the owner's stored switch: `publicationState` is derived on the server
 * (published + entitled + switched on), so a private preview says so plainly and can never be
 * mistaken for a live, paid Front Desk.
 */
export default function AIFrontDeskCustomerClient({
  business,
  products,
  services,
  deliveryZones,
  greetingMessage,
  suggestedActions,
  operationalStatus,
  publicationState = "LIVE",
  pauseAllOrdering,
  qrSvg,
  shareUrl,
  previewMode = false,
}: {
  business: {
    id: string;
    slug: string;
    name: string;
    category: string;
    description: string;
    location?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    openingHours?: string | null;
  };
  products: ProductSummary[];
  services: ServiceSummary[];
  deliveryZones: DeliveryZone[];
  greetingMessage: string;
  suggestedActions: string[];
  operationalStatus: "LIVE" | "PAUSED" | "MAINTENANCE";
  /** Server-derived lifecycle: DRAFT | PREVIEW | LIVE | PAUSED | MAINTENANCE | SUSPENDED. */
  publicationState?: "DRAFT" | "PREVIEW" | "LIVE" | "PAUSED" | "MAINTENANCE" | "SUSPENDED";
  pauseAllOrdering: boolean;
  qrSvg: string;
  shareUrl: string;
  previewMode?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: greetingMessage,
      responseType: "KNOWN",
    },
  ]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [selectedZone, setSelectedZone] = useState<string>(deliveryZones[0]?.name || "");
  const [sending, setSending] = useState(false);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  async function sendMessage(textToSend?: string) {
    const text = (textToSend ?? input).trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "customer",
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput("");
    setSending(true);
    setOrderNotice(null);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: business.id,
          message: text,
          conversationId,
          channel: "web_chat",
          preview: previewMode,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
        }),
      });
      const data = await res.json();
      if (data.conversationId) {
        setConversationId(data.conversationId);
      }
      if (data.cartSummary) {
        setCart(data.cartSummary);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: data.reply || "I don't have that information yet. Let me connect you with the business.",
          responseType: data.responseType || "UNKNOWN",
          source: data.source,
          escalatedToHuman: Boolean(data.escalatedToHuman),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "assistant",
          text: "I don't have that information yet. Let me connect you with the business.",
          responseType: "UNKNOWN",
          escalatedToHuman: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmOrder() {
    if (!cart || cart.lineItems.length === 0) return;
    if (!customerName.trim() || !customerPhone.trim()) {
      setOrderNotice("Please enter your name and phone number to confirm your order.");
      return;
    }
    setSending(true);
    setOrderNotice(null);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: business.id,
          message: `Confirm order for ${customerName} (${customerPhone})${selectedZone ? ` to ${selectedZone}` : ""}`,
          conversationId,
          channel: "web_chat",
          preview: previewMode,
          customerName,
          customerPhone,
        }),
      });
      const data = await res.json();
      setOrderNotice(
        data.reply ||
          (previewMode
            ? "Preview Mode: Order simulated safely (no live order or payment created)."
            : "Order request recorded. Complete payment verification to confirm your order."),
      );
    } catch {
      setOrderNotice("Could not submit order right now. Please try again or contact the business directly.");
    } finally {
      setSending(false);
    }
  }

  const status = aiFrontDeskStatusLabel(publicationState);
  const hoursLine =
    business.openingHours
      ? formatOpeningHours(business.openingHours)
          .map((row) => (row.label ? `${row.label} ${row.value}` : row.value))
          .join(" · ")
      : "";
  const whatsappHref = business.whatsapp
    ? `https://wa.me/${business.whatsapp.replace(/\D/g, "").replace(/^0/, "254")}`
    : null;

  return (
    <main id="main" className="jata-page min-h-screen">
      {previewMode && (
        <div className="border-b border-[color:var(--jata-accent)]/30 bg-[color:var(--jata-accent)]/10 px-4 py-2 text-center text-xs font-semibold text-[color:var(--jata-accent)]">
          Private preview — only you can see this. Nothing is charged, no live order is placed, and
          no customer notification is sent.
        </div>
      )}

      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5 sm:px-6">
        {/* Identity + honest status */}
        <header className="overflow-hidden rounded-[1.6rem] border border-[color:var(--jata-line)] bg-[color:var(--jata-card)] shadow-[var(--jata-shadow)]">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em]"
                  style={{
                    borderColor:
                      status.tone === "success"
                        ? "rgba(4,120,87,0.28)"
                        : status.tone === "error"
                          ? "rgba(185,28,28,0.28)"
                          : "var(--jata-line)",
                    color:
                      status.tone === "success"
                        ? "var(--jata-live)"
                        : status.tone === "error"
                          ? "var(--jata-danger)"
                          : "var(--jata-accent)",
                    background: "transparent",
                  }}
                >
                  <span aria-hidden="true">●</span>
                  AI Front Desk · {status.label}
                </span>
                <span className="rounded-full bg-[color:var(--jata-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[color:var(--jata-muted)]">
                  {business.category}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{business.name}</h1>
              <p className="mt-1 text-sm text-[color:var(--jata-muted)]">
                {business.location ? `${business.location}` : "Ask about products, prices, delivery and orders"}
                {hoursLine ? ` · ${hoursLine}` : ""}
              </p>
              {business.description ? (
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-[color:var(--jata-muted)]">
                  {business.description}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {whatsappHref ? (
                <a href={whatsappHref} className="jata-btn jata-btn-secondary jata-btn-sm" rel="noopener noreferrer">
                  WhatsApp
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => setShowQr((prev) => !prev)}
                aria-expanded={showQr}
                className="jata-btn jata-btn-secondary jata-btn-sm"
              >
                {showQr ? "Hide QR" : "Share / QR"}
              </button>
              <Link href={`/b/${business.slug}`} className="jata-btn jata-btn-ghost jata-btn-sm">
                Business page
              </Link>
            </div>
          </div>

          {showQr && (
            <section className="flex flex-col items-center justify-between gap-4 border-t border-[color:var(--jata-line)] bg-[color:var(--jata-soft)] p-4 sm:flex-row sm:px-6">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Shareable AI Front Desk link</h2>
                <p className="mt-1 text-xs text-[color:var(--jata-muted)]">
                  Print this on counters, packaging, receipts or your social bios so customers can
                  reach your front desk directly.
                </p>
                <code className="mt-2 inline-block max-w-full break-all rounded-lg bg-[color:var(--jata-card)] px-2.5 py-1 text-xs text-[color:var(--jata-accent)]">
                  {shareUrl}
                </code>
              </div>
              <div className="rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            </section>
          )}
        </header>

        {/* Suggested questions, phrased from this business's own catalogue */}
        <section className="mt-4" aria-label="Suggested questions">
          <p className="jata-kicker">Try asking</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestedActions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => sendMessage(action)}
                disabled={sending}
                className="min-h-11 rounded-full border border-[color:var(--jata-line)] bg-[color:var(--jata-card)] px-3.5 text-xs font-semibold text-[color:var(--jata-ink)] transition hover:border-[color:var(--jata-accent)] hover:text-[color:var(--jata-accent)] disabled:opacity-50"
              >
                {action}
              </button>
            ))}
          </div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {/* The conversation comes first in the reading order on a phone. */}
          <section
            className="flex flex-col overflow-hidden rounded-[1.4rem] border border-[color:var(--jata-line)] bg-[color:var(--jata-card)] shadow-[var(--jata-shadow)] lg:col-span-2"
            aria-label="Conversation"
          >
            <div className="flex items-center justify-between border-b border-[color:var(--jata-line)] px-4 py-3">
              <h2 className="text-sm font-semibold">Conversation</h2>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--jata-muted)]">
                Answers from saved business data
              </span>
            </div>

            <div
              className="flex-1 space-y-3 overflow-y-auto p-4"
              style={{ maxHeight: "460px" }}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Conversation with the front desk"
            >
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.role === "customer"
                        ? "bg-[color:var(--jata-ink)] text-[color:var(--jata-card)]"
                        : "border border-[color:var(--jata-line)] bg-[color:var(--jata-soft)] text-[color:var(--jata-ink)]"
                    }`}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                    {m.role === "assistant" && m.escalatedToHuman && (
                      <p className="mt-1.5 text-[11px] font-semibold text-[color:var(--jata-accent)]">
                        A person from {business.name} will follow up.
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <p role="status" className="text-xs text-[color:var(--jata-muted)]">
                  Checking the business records…
                </p>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex gap-2 border-t border-[color:var(--jata-line)] p-3"
            >
              <label htmlFor="ai-front-desk-message" className="sr-only">
                Your question
              </label>
              <input
                id="ai-front-desk-message"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about prices, stock, delivery, or place an order…"
                className="jata-input flex-1"
                autoComplete="off"
              />
              <button type="submit" disabled={sending || !input.trim()} className="jata-btn jata-btn-primary">
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
          </section>

          <aside className="space-y-4">
            <div className="rounded-[1.4rem] border border-[color:var(--jata-line)] bg-[color:var(--jata-card)] p-4 shadow-[var(--jata-shadow)]">
              <h2 className="text-sm font-semibold">Your order</h2>
              {pauseAllOrdering ? (
                <p className="mt-2 text-xs leading-relaxed text-[color:var(--jata-muted)]">
                  Ordering is paused by the business right now. You can still ask questions or ask
                  for a person to call you back.
                </p>
              ) : cart && cart.lineItems.length > 0 ? (
                <div className="mt-3 space-y-2 text-xs">
                  {cart.lineItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="text-[color:var(--jata-ink)]">
                        {item.quantity} × {item.name}
                      </span>
                      <span className="font-semibold tabular-nums">KES {item.lineSubtotalKES}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-[color:var(--jata-line)] pt-2 text-[color:var(--jata-muted)]">
                    <span>Subtotal</span>
                    <span className="tabular-nums">KES {cart.subtotalKES}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">KES {cart.totalKES}</span>
                  </div>

                  <div className="space-y-2 pt-2">
                    <label htmlFor="ai-order-name" className="sr-only">
                      Your name
                    </label>
                    <input
                      id="ai-order-name"
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Your name"
                      className="jata-input w-full"
                      autoComplete="name"
                    />
                    <label htmlFor="ai-order-phone" className="sr-only">
                      Your phone number
                    </label>
                    <input
                      id="ai-order-phone"
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="Phone (e.g. 0712345678)"
                      className="jata-input w-full"
                      autoComplete="tel"
                    />
                    {deliveryZones.length > 0 && (
                      <div>
                        <label htmlFor="ai-order-zone" className="jata-label">
                          Delivery area
                        </label>
                        <select
                          id="ai-order-zone"
                          value={selectedZone}
                          onChange={(e) => setSelectedZone(e.target.value)}
                          className="jata-input w-full"
                        >
                          {deliveryZones.map((z) => (
                            <option key={z.name} value={z.name}>
                              {z.name} (+KES {z.feeKES})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleConfirmOrder}
                      disabled={sending}
                      className="jata-btn jata-btn-primary jata-btn-block"
                    >
                      Confirm order
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-[color:var(--jata-muted)]">
                  Say e.g. &ldquo;I want two {products[0]?.name || "items"}&rdquo; in the conversation and
                  your order is built automatically.
                </p>
              )}

              {orderNotice && (
                <p role="status" className="mt-2 rounded-lg bg-[color:var(--jata-soft)] p-2 text-xs leading-relaxed">
                  {orderNotice}
                </p>
              )}
            </div>

            <div className="rounded-[1.4rem] border border-[color:var(--jata-line)] bg-[color:var(--jata-card)] p-4 shadow-[var(--jata-shadow)]">
              <h2 className="text-sm font-semibold">From the catalogue</h2>
              <div className="mt-2 space-y-2 text-xs">
                {products.slice(0, 6).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 border-b border-[color:var(--jata-line)] pb-1.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <span className="text-[11px] text-[color:var(--jata-muted)]">
                        {p.stockStatus.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => sendMessage(`How much is ${p.name}?`)}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-[color:var(--jata-soft)] px-3 font-semibold text-[color:var(--jata-ink)] hover:text-[color:var(--jata-accent)]"
                    >
                      {p.priceKES != null ? (
                        <>
                          KES {p.priceKES}
                          {p.wasPriceKES != null ? (
                            <span className="ml-1 text-[10px] text-[color:var(--jata-muted)] line-through">
                              KES {p.wasPriceKES}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "Price on request"
                      )}
                    </button>
                  </div>
                ))}
                {services.slice(0, 4).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 border-b border-[color:var(--jata-line)] pb-1.5 last:border-b-0"
                  >
                    <span className="truncate font-medium">{s.title}</span>
                    <span className="shrink-0 text-[color:var(--jata-accent)]">
                      {s.priceFrom != null ? `From KES ${s.priceFrom}` : "Ask for a quote"}
                    </span>
                  </div>
                ))}
                {products.length === 0 && services.length === 0 && (
                  <p className="text-[color:var(--jata-muted)]">Ask the front desk what is available today.</p>
                )}
              </div>
            </div>
          </aside>
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-[color:var(--jata-muted)]">
          Answers use only what {business.name} saved — products, prices, delivery zones, opening hours and
          policies. When something is not on file, you are handed to a person. Operated by JATA
          AFTERCALL. Status: {status.label}
          {operationalStatus === "PAUSED" ? " (temporarily paused)" : ""}
          {operationalStatus === "MAINTENANCE" ? " (maintenance)" : ""}.
        </p>
      </div>
    </main>
  );
}
