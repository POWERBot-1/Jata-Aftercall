"use client";

/**
 * Renders the REAL RegisterForm and CheckoutForm with fictional data. Their `/api/*` requests are answered by the
 * simulated transport in lib/subscription/fixtures/subscriptionFixture.ts. Unknown `/api/*` requests fail closed.
 * Development only (the page is 404 in production). No payment provider is contacted.
 */
import { useState } from "react";
import RegisterForm from "@/components/RegisterForm";
import CheckoutForm from "@/components/CheckoutForm";
import {
  FIXTURE_CHECKOUT,
  SUBSCRIPTION_FIXTURE_NOTICE,
  type SubscriptionFixtureOutcome,
  isSubscriptionFixtureOutcome,
  simulateSubscriptionApi,
} from "@/lib/subscription/fixtures/subscriptionFixture";

let installed = false;

/** The simulated outcome comes from the page URL at request time (?outcome=…), so it cannot go stale. */
function outcomeFromPage(): SubscriptionFixtureOutcome {
  const value = new URLSearchParams(window.location.search).get("outcome");
  return isSubscriptionFixtureOutcome(value) ? value : "success";
}

/** Installs the fixture transport once, at module load, before any form can send a request. */
function installSubscriptionFixtureTransport() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const outcome = outcomeFromPage();
    (window as unknown as { __jataFixtureRequests?: { method: string; path: string; outcome: string }[] }).__jataFixtureRequests ??= [];
    (window as unknown as { __jataFixtureRequests: { method: string; path: string; outcome: string }[] }).__jataFixtureRequests.push({ method, path: url.pathname, outcome });
    const simulated = await simulateSubscriptionApi({ outcome, method, path: url.pathname, body });
    return (
      simulated ??
      new Response(JSON.stringify({ error: "FICTIONAL FIXTURE: this request is not part of the fixture. Nothing was sent." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );
  };
}

// Install at module load: child forms may issue requests before the parent renders.
installSubscriptionFixtureTransport();

export default function SubscriptionFixtureClient({ outcome }: { outcome: SubscriptionFixtureOutcome }) {
  const [registered, setRegistered] = useState(false);
  return (
    <div className="grid gap-6">
      <p role="note" className="jata-card p-3 text-sm font-semibold">
        {SUBSCRIPTION_FIXTURE_NOTICE}
      </p>
      <p className="text-xs" data-fixture-outcome={outcome}>
        Simulated outcome for the next request: <strong>{outcome}</strong>.
      </p>

      <section aria-labelledby="fx-register-heading" className="grid gap-3">
        <h2 id="fx-register-heading" className="text-lg font-bold">Create your account</h2>
        <RegisterForm onRegistered={() => setRegistered(true)} />
        {registered ? (
          <p role="status" className="jata-state-enter text-sm font-semibold">
            FICTIONAL FIXTURE — simulated account created. Nothing was saved and no real account exists.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="fx-checkout-heading" className="grid gap-3">
        <h2 id="fx-checkout-heading" className="text-lg font-bold">Checkout (simulated)</h2>
        <CheckoutForm
          businessId={FIXTURE_CHECKOUT.businessId}
          planId={FIXTURE_CHECKOUT.planId}
          businessName={FIXTURE_CHECKOUT.businessName}
          planName={FIXTURE_CHECKOUT.planName}
          priceKES={FIXTURE_CHECKOUT.priceKES}
        />
      </section>
    </div>
  );
}
