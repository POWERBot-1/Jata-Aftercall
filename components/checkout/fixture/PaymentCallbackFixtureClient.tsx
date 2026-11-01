"use client";

/**
 * Renders the REAL checkout callback UI (PaymentCallbackClient) with simulated verification responses.
 * Development only; the page is 404 in production. The notice is shown on screen. Other /api requests fail closed.
 */
import { PAYMENT_CALLBACK_FIXTURE_NOTICE, isPaymentCallbackOutcome, simulatePaymentCallbackApi, type PaymentCallbackOutcome } from "@/lib/checkout/fixtures/paymentCallbackFixture";
import PaymentCallbackClient from "@/components/checkout/PaymentCallbackClient";

declare global {
  interface Window { __jataFixtureRequests?: { method: string; path: string; outcome: string }[] }
}

let installed = false;

/** Outcome is read from the page URL at request time. Installed at module load so it runs before the first request. */
function installPaymentCallbackFixtureTransport() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    const value = new URLSearchParams(window.location.search).get("outcome");
    const outcome: PaymentCallbackOutcome = isPaymentCallbackOutcome(value) ? value : "paid";
    const method = (init?.method ?? "GET").toUpperCase();
    (window.__jataFixtureRequests ??= []).push({ method, path: url.pathname, outcome });
    const simulated = await simulatePaymentCallbackApi({ outcome, method, path: url.pathname });
    return simulated ?? new Response(JSON.stringify({ error: "FICTIONAL FIXTURE: request not part of this fixture. Nothing was sent." }), { status: 404, headers: { "Content-Type": "application/json" } });
  };
}

installPaymentCallbackFixtureTransport();

export default function PaymentCallbackFixtureClient() {
  return (
    <div className="grid gap-4">
      <p role="note" className="jata-card p-3 text-sm font-semibold">{PAYMENT_CALLBACK_FIXTURE_NOTICE}</p>
      <PaymentCallbackClient />
    </div>
  );
}
