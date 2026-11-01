import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { interpretVerifyResponse } from "@/lib/checkoutStatus";
import {
  PAYMENT_CALLBACK_OUTCOMES,
  isPaymentCallbackOutcome,
  simulatedVerifyResponse,
  simulatePaymentCallbackApi,
} from "@/lib/checkout/fixtures/paymentCallbackFixture";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("server-authoritative status mapping", () => {
  it("only PAID with an ACTIVE subscription is shown as confirmed", () => {
    expect(interpretVerifyResponse(200, { status: "PAID", subscriptionStatus: "ACTIVE" }).state).toBe("paid");
    expect(interpretVerifyResponse(200, { status: "PAID", subscriptionStatus: "PENDING" }).state).toBe("activating");
    expect(interpretVerifyResponse(200, { status: "PAID" }).state).toBe("activating");
  });

  it("a refund is its own state, not success and not a generic failure", () => {
    const view = interpretVerifyResponse(200, { status: "REFUNDED" });
    expect(view.state).toBe("refunded");
    expect(view.poll).toBe(false);
    expect(view.message).toMatch(/refunded/i);
    expect(view.message).toMatch(/not been activated/i);
  });

  it("FAILED still maps to failed, and pending stays pending with polling", () => {
    expect(interpretVerifyResponse(200, { status: "FAILED" }).state).toBe("failed");
    const pending = interpretVerifyResponse(200, { status: "PENDING" });
    expect(pending.state).toBe("processing");
    expect(pending.poll).toBe(true);
  });

  it("a browser return alone (no server response) is never confirmed", () => {
    expect(interpretVerifyResponse(500, {}).state).toBe("error");
    expect(interpretVerifyResponse(500, {}).state).not.toBe("paid");
  });
});

describe("payment callback fixture safety", () => {
  it("every fixture page 404s in production", () => {
    expect(read("app/dev/payment-callback-fixture/page.tsx")).toMatch(/if \(process\.env\.NODE_ENV === "production"\) notFound\(\)/);
  });

  it("fixture code never references a provider host, secret, DB, or external URL", () => {
    for (const rel of [
      "lib/checkout/fixtures/paymentCallbackFixture.ts",
      "components/checkout/fixture/PaymentCallbackFixtureClient.tsx",
      "app/dev/payment-callback-fixture/page.tsx",
    ]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/paystack\.co|https?:\/\//i);
      expect(src, rel).not.toMatch(/process\.env\.(?!NODE_ENV)/);
      expect(src, rel).not.toMatch(/@\/lib\/db|prisma|@\/lib\/paystack/i);
    }
  });

  it("only a fictional paid outcome carries ACTIVE, and the activating outcome never does", () => {
    expect(simulatedVerifyResponse("paid").body).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE", simulated: true });
    expect(simulatedVerifyResponse("activating").body.subscriptionStatus).toBe("PENDING");
    for (const outcome of PAYMENT_CALLBACK_OUTCOMES.filter((o) => o !== "paid")) {
      expect(simulatedVerifyResponse(outcome).body.subscriptionStatus, outcome).not.toBe("ACTIVE");
    }
  });

  it("every fixture response is labelled simulated or is an error", () => {
    for (const outcome of PAYMENT_CALLBACK_OUTCOMES) {
      const { status, body } = simulatedVerifyResponse(outcome);
      const labelled = body.simulated === true || (typeof body.error === "string" && body.error.startsWith("FICTIONAL FIXTURE"));
      expect(labelled, outcome).toBe(true);
      expect(status).toBeGreaterThanOrEqual(200);
    }
  });

  it("the fixture answers only the verify route and fails closed for anything else", async () => {
    expect(await simulatePaymentCallbackApi({ outcome: "paid", method: "POST", path: "/api/paystack/verify" })).toBeNull();
    expect(await simulatePaymentCallbackApi({ outcome: "paid", method: "GET", path: "/api/checkout" })).toBeNull();
    expect(await simulatePaymentCallbackApi({ outcome: "paid", method: "GET", path: "/api/paystack/webhook" })).toBeNull();
  });

  it("outcome validation rejects unknown values", () => {
    expect(isPaymentCallbackOutcome("paid")).toBe(true);
    expect(isPaymentCallbackOutcome("success-for-real")).toBe(false);
  });
});

describe("motion wiring on real components", () => {
  it("the callback status block re-enters on each state change and has a reduced-motion-safe progress bar", () => {
    const src = read("components/checkout/PaymentCallbackClient.tsx");
    expect(src).toMatch(/<div key=\{view\.state\} className="jata-state-enter">/);
    expect(src).toContain("jata-publish-progress__bar");
    expect(src).toMatch(/aria-hidden="true"><div className="jata-publish-progress__bar"/);
  });

  it("the real callback route still delegates to the shared client and does not change verification", () => {
    expect(read("app/checkout/callback/page.tsx")).toMatch(/export \{ default \} from "@\/components\/checkout\/PaymentCallbackClient"/);
    expect(read("components/checkout/PaymentCallbackClient.tsx")).toContain("/api/paystack/verify?");
    expect(read("components/checkout/PaymentCallbackClient.tsx")).not.toMatch(/subscriptionStatus: "ACTIVE"|setView\(\{ state: "paid"/);
  });

  it("CheckoutForm keeps its duplicate-submit guard and announces failures with role=alert", () => {
    const src = read("components/CheckoutForm.tsx");
    expect(src).toContain("if (inFlight.current || loading) return;");
    expect(src).toContain("inFlight.current = true;");
    expect(src).toContain("if (!redirecting) { setLoading(false); inFlight.current = false; }");
    expect(src).toContain('disabled={loading} aria-busy={loading}');
    expect(src).toContain('role="alert"');
    expect(src).toContain("window.location.assign(data.authorization_url)");
  });

  it("RegisterForm locks submission in the same task and releases the lock in finally", () => {
    const src = read("components/RegisterForm.tsx");
    expect(src).toContain("if (inFlight.current) return;");
    expect(src).toMatch(/finally \{\s*setLoading\(false\);\s*inFlight\.current = false;/);
  });

  it("the progress bar holds still under reduced motion", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.jata-publish-progress__bar \{ animation: none; width: 100%; opacity: 0\.45; \}/);
  });
});
