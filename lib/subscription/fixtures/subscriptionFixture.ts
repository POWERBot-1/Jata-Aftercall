/**
 * Subscription and registration FIXTURE — DEVELOPMENT ONLY data and simulated API transport.
 *
 * Everything is FICTIONAL. No request reaches Paystack, no charge is made, no subscription or entitlement is
 * created, and no account is created. Simulated checkout returns a SAME-ORIGIN fixture URL only, never a
 * payment-provider URL. Unknown `/api/*` requests fail closed (404).
 */

export const SUBSCRIPTION_FIXTURE_NOTICE =
  "FICTIONAL FIXTURE — JATA AFTERCALL registration and checkout. Payments are simulated: no money moves, nothing is charged, and no subscription is activated.";

export const SUBSCRIPTION_FIXTURE_OUTCOMES = ["success", "failure", "cancelled"] as const;
export type SubscriptionFixtureOutcome = (typeof SUBSCRIPTION_FIXTURE_OUTCOMES)[number];
export function isSubscriptionFixtureOutcome(value: unknown): value is SubscriptionFixtureOutcome {
  return typeof value === "string" && (SUBSCRIPTION_FIXTURE_OUTCOMES as readonly string[]).includes(value);
}

/** Fixed latency so pending states are visible and deterministic. */
export const SUBSCRIPTION_FIXTURE_LATENCY_MS = 900;

export const FIXTURE_CHECKOUT = {
  businessId: "fixture-subscription-business",
  planId: "fixture-plan-monthly",
  businessName: "Fixture Salon Studio",
  planName: "Fictional monthly plan",
  priceKES: 1500,
};

/** Same-origin fixture result page. The only URL the simulated checkout can return. */
export const FIXTURE_RESULT_PATH = "/dev/subscription-fixture/paystack-simulated";

export function simulatedAuthorizationUrl(outcome: SubscriptionFixtureOutcome): string {
  const ref = `FIXTURE-${outcome.toUpperCase()}-0001`;
  return `${FIXTURE_RESULT_PATH}?outcome=${outcome}&ref=${encodeURIComponent(ref)}`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Simulated transport for registration and checkout. Returns null for any route outside the fixture; the
 * caller must answer those with a fail-closed 404.
 */
export async function simulateSubscriptionApi(input: {
  outcome: SubscriptionFixtureOutcome;
  method: string;
  path: string;
  body: Record<string, unknown>;
}): Promise<Response | null> {
  const { outcome, method, path } = input;

  if (method === "POST" && path === "/api/auth/register") {
    await wait(SUBSCRIPTION_FIXTURE_LATENCY_MS);
    return outcome === "failure"
      ? json(422, { error: "FICTIONAL FIXTURE: simulated registration failure. No account was created." })
      : json(200, { ok: true, simulated: true });
  }

  if (method === "POST" && path === "/api/checkout") {
    await wait(SUBSCRIPTION_FIXTURE_LATENCY_MS);
    if (outcome === "failure") {
      return json(422, { error: "FICTIONAL FIXTURE: simulated checkout failure. No payment was started." });
    }
    // The server would set the amount; the fixture echoes the fictional plan price and a same-origin result URL.
    return json(200, {
      simulated: true,
      payment: { amount: FIXTURE_CHECKOUT.priceKES * 100, currency: "KES" },
      authorization_url: simulatedAuthorizationUrl(outcome === "cancelled" ? "cancelled" : "success"),
    });
  }

  return null;
}

/** The simulated payment-result copy. Never claims a real collection or activation. */
export function simulatedResultCopy(outcome: string | undefined): { title: string; body: string } {
  if (outcome === "cancelled") {
    return {
      title: "SIMULATED: payment cancelled",
      body: "FICTIONAL FIXTURE. The simulated payment was cancelled. No money moved, nothing was charged and no subscription was activated.",
    };
  }
  return {
    title: "SIMULATED: payment result, not verified",
    body: "FICTIONAL FIXTURE. A real subscription is activated only after the server verifies a Paystack payment. This simulated result does not verify anything and activates nothing.",
  };
}
