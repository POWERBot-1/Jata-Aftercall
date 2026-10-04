"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatOpeningHours } from "@/lib/openingHours";

type ProductSummary = {
  id: string;
  name: string;
  description?: string | null;
  basePriceKES?: number | null;
  variantPriceKES?: number | null;
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

export default function AIFrontDeskCustomerClient({
  business,
  products,
  services,
  deliveryZones,
  greetingMessage,
  suggestedActions,
  operationalStatus,
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

  return (
    <main id="main" className="min-h-screen bg-slate-950 text-slate-100">
      {previewMode && (
        <div className="bg-amber-500/20 border-b border-amber-400/40 px-4 py-2 text-center text-xs font-medium text-amber-200">
          PREVIEW MODE — Isolated sandbox. No real customer charges, orders, or live owner notifications are sent.
        </div>
      )}

      <div className="mx-auto max-w-4xl px-4 py-6">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                AI Front Desk • {operationalStatus}
              </span>
              <span className="text-xs text-slate-300">{business.category}</span>
            </div>
            <h1 className="mt-1 text-xl font-bold text-white">{business.name}</h1>
            <p className="text-xs text-slate-300">
              {business.location ? `${business.location} • ` : ""}
              {business.openingHours
                ? `Hours: ${formatOpeningHours(business.openingHours).map((row) => (row.label ? `${row.label} ${row.value}` : row.value)).join(" · ") || "Ask about products, prices, delivery & orders"}`
                : "Ask about products, prices, delivery & orders"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowQr((prev) => !prev)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
            >
              {showQr ? "Hide QR" : "Share / QR"}
            </button>
            <Link
              href={`/b/${business.slug}`}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
            >
              Business Page
            </Link>
          </div>
        </header>

        {showQr && (
          <section className="mt-4 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row">
            <div>
              <h2 className="text-sm font-semibold text-white">Shareable AI Front Desk Link & QR</h2>
              <p className="mt-1 text-xs text-slate-300">
                Scan or share this link on counters, packaging, receipts, or social bios:
              </p>
              <code className="mt-2 inline-block rounded bg-slate-950 px-2.5 py-1 text-xs text-emerald-300">
                {shareUrl}
              </code>
            </div>
            <div
              className="rounded-xl bg-white p-2"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          </section>
        )}

        {/* Suggested Action Chips (§26) */}
        <section className="mt-4 flex flex-wrap gap-2" aria-label="Suggested actions">
          {suggestedActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => sendMessage(action)}
              disabled={sending}
              className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {action}
            </button>
          ))}
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {/* Conversation Stream */}
          <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900 lg:col-span-2">
            <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "460px" }}>
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.role === "customer"
                        ? "bg-emerald-600 text-white"
                        : "border border-slate-800 bg-slate-950 text-slate-100"
                    }`}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                    {m.role === "assistant" && m.responseType && (
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-300">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">
                          {m.responseType}
                        </span>
                        {m.escalatedToHuman && (
                          <span className="text-amber-300">Human Handoff Ready</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Message Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex gap-2 border-t border-slate-800 p-3"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about prices, stock, delivery, or type your order (English / Kiswahili)..."
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </form>
          </section>

          {/* Conversational Cart & Verified Catalogue Sidebar */}
          <aside className="space-y-4">
            {/* Conversational Cart (§27) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold text-white">Conversational Order Summary</h2>
              {pauseAllOrdering ? (
                <p className="mt-2 text-xs text-amber-300">
                  Ordering is temporarily paused by the business. You can still ask questions or request a human callback.
                </p>
              ) : cart && cart.lineItems.length > 0 ? (
                <div className="mt-3 space-y-2 text-xs">
                  {cart.lineItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-slate-200">
                      <span>
                        {item.quantity} × {item.name}
                      </span>
                      <span className="font-semibold">KES {item.lineSubtotalKES}</span>
                    </div>
                  ))}
                  <div className="border-t border-slate-800 pt-2 flex justify-between text-slate-300">
                    <span>Subtotal</span>
                    <span>KES {cart.subtotalKES}</span>
                  </div>
                  <div className="flex justify-between font-bold text-emerald-300 text-sm">
                    <span>Total</span>
                    <span>KES {cart.totalKES}</span>
                  </div>

                  <div className="pt-2 space-y-2">
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Your name"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                    />
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="Phone (e.g. 0712345678)"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                    />
                    {deliveryZones.length > 0 && (
                      <select
                        value={selectedZone}
                        onChange={(e) => setSelectedZone(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                      >
                        {deliveryZones.map((z) => (
                          <option key={z.name} value={z.name}>
                            {z.name} (+KES {z.feeKES})
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={handleConfirmOrder}
                      disabled={sending}
                      className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      Confirm Order
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-300">
                  Say e.g. &ldquo;I want two {products[0]?.name || "items"}&rdquo; in chat to build your order automatically.
                </p>
              )}

              {orderNotice && (
                <p className="mt-2 rounded-lg bg-slate-950 p-2 text-xs text-emerald-300">
                  {orderNotice}
                </p>
              )}
            </div>

            {/* Verified Catalogue Quick List */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold text-white">Verified Catalogue</h2>
              <div className="mt-2 space-y-2 text-xs">
                {products.slice(0, 6).map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 border-b border-slate-800/70 pb-1.5">
                    <div>
                      <p className="font-medium text-slate-100">{p.name}</p>
                      <span className="text-[11px] text-slate-300">{p.stockStatus}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => sendMessage(`How much is ${p.name}?`)}
                      className="rounded bg-slate-800 px-2 py-1 font-semibold text-emerald-300 hover:bg-slate-700"
                    >
                      KES {p.basePriceKES ?? p.variantPriceKES ?? 0}
                    </button>
                  </div>
                ))}
                {services.slice(0, 4).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 border-b border-slate-800/70 pb-1.5">
                    <span className="font-medium text-slate-100">{s.title}</span>
                    <span className="text-emerald-300">KES {s.priceFrom ?? 0}</span>
                  </div>
                ))}
                {products.length === 0 && services.length === 0 && (
                  <p className="text-slate-300">Ask our front desk for current offerings.</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
