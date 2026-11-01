/**
 * Payment-callback FIXTURE: DEVELOPMENT ONLY, FICTIONAL responses for the real checkout callback UI.
 *
 * These are not Paystack or server results. They let the real PaymentCallbackClient show each state
 * for visual and accessibility testing. No charge, subscription, entitlement or database row is created
 * or changed, and no provider is contacted. Only /api/paystack/verify is answered; everything else fails closed.
 */

export const PAYMENT_CALLBACK_FIXTURE_NOTICE =
  "FICTIONAL FIXTURE — simulated verification response. No payment was made, nothing was charged, and no subscription was activated or changed.";

export const PAYMENT_CALLBACK_OUTCOMES = [
  "paid",
  "activating",
  "processing",
  "cancelled",
  "expired",
  "failed",
  "refunded",
  "signin",
  "error",
] as const;
export type PaymentCallbackOutcome = (typeof PAYMENT_CALLBACK_OUTCOMES)[number];

export function isPaymentCallbackOutcome(value: unknown): value is PaymentCallbackOutcome {
  return typeof value === "string" && (PAYMENT_CALLBACK_OUTCOMES as readonly string[]).includes(value);
}

export const FIXTURE_CALLBACK_REFERENCE = "FIXTURE-CALLBACK-0001";
export const FIXTURE_VERIFY_LATENCY_MS = 700;

/** Simulated /api/paystack/verify response body and HTTP status for an outcome. */
export function simulatedVerifyResponse(outcome: PaymentCallbackOutcome): { status: number; body: Record<string, unknown> } {
  switch (outcome) {
    case "paid":
      return { status: 200, body: { status: "PAID", subscriptionStatus: "ACTIVE", simulated: true } };
    case "activating":
      return { status: 200, body: { status: "PAID", subscriptionStatus: "PENDING", simulated: true } };
    case "processing":
      return { status: 200, body: { status: "PENDING", message: "FICTIONAL FIXTURE: simulated processing.", simulated: true } };
    case "cancelled":
      return { status: 200, body: { status: "CANCELLED", simulated: true } };
    case "expired":
      return { status: 200, body: { status: "EXPIRED", simulated: true } };
    case "failed":
      return { status: 200, body: { status: "FAILED", error: "FICTIONAL FIXTURE: simulated verification failure. No payment was taken.", simulated: true } };
    case "refunded":
      return { status: 200, body: { status: "REFUNDED", simulated: true } };
    case "signin":
      return { status: 401, body: { error: "FICTIONAL FIXTURE: simulated sign-in requirement." } };
    case "error":
      return { status: 503, body: { error: "FICTIONAL FIXTURE: simulated verification outage. Nothing was changed." } };
  }
}

export async function simulatePaymentCallbackApi(input: { outcome: PaymentCallbackOutcome; method: string; path: string }): Promise<Response | null> {
  if (input.method !== "GET" || input.path !== "/api/paystack/verify") return null;
  await new Promise((resolve) => setTimeout(resolve, FIXTURE_VERIFY_LATENCY_MS));
  const simulated = simulatedVerifyResponse(input.outcome);
  return new Response(JSON.stringify(simulated.body), { status: simulated.status, headers: { "Content-Type": "application/json" } });
}
