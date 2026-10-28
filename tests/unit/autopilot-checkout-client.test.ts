/**
 * JATA Autopilot activation — client-side contract.
 *
 * The owner reported three activation buttons (KES 2,499 / 6,999 / 19,999) that "appear
 * inactive". One of the reproduced causes was client-side: when the plan row id was missing the
 * click returned before any request was sent, and every failure path (auth, provider, config)
 * only wrote a banner at the top of a very long page. These tests pin the repaired behaviour:
 * a click always produces either a validated redirect or a visible, specific notice.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVATION_BAD_LINK,
  ACTIVATION_FALLBACK_ERROR,
  ACTIVATION_NETWORK_ERROR,
  beginAutopilotActivation,
  resolveCheckoutUrl,
  safeStatusPath,
} from "@/lib/autopilot/checkoutClient";

const BASE = "https://jata-aftercall.vercel.app";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => jsonResponse(status, body)) as unknown as typeof fetch;
}

describe("activation request", () => {
  it("posts the allowlisted plan key (never a price) and returns the provider URL", async () => {
    const fetchImpl = fetchReturning(200, {
      authorization_url: "https://checkout.paystack.com/abc123",
      reference: "jata-ref",
    });
    const outcome = await beginAutopilotActivation({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT_PRO",
      fetchImpl,
      baseUrl: BASE,
    });

    expect(outcome).toEqual({ kind: "redirect", url: "https://checkout.paystack.com/abc123" });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/checkout");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT_PRO",
    });
  });

  it("reports a network failure instead of resetting silently", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const outcome = await beginAutopilotActivation({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT",
      fetchImpl,
      baseUrl: BASE,
    });
    expect(outcome).toEqual({
      kind: "notice",
      notice: { tone: "error", text: ACTIVATION_NETWORK_ERROR },
    });
  });

  it("sends an expired session to sign-in with a visible link", async () => {
    const outcome = await beginAutopilotActivation({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT",
      fetchImpl: fetchReturning(401, { code: "SIGN_IN_REQUIRED", error: "Please sign in to continue." }),
      baseUrl: BASE,
    });
    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.notice.text).toBe("Please sign in to continue.");
    expect(outcome.notice.action).toEqual({ href: "/login", label: "Sign in" });
    expect(outcome.notice.code).toBe("SIGN_IN_REQUIRED");
  });

  it("explains a payment already in progress and links to its status", async () => {
    const outcome = await beginAutopilotActivation({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT",
      fetchImpl: fetchReturning(409, {
        code: "CHECKOUT_IN_PROGRESS",
        error: "A payment for this plan is already in progress. Check its status before starting another.",
        reference: "jata-existing",
        statusUrl: "/checkout/callback?reference=jata-existing",
      }),
      baseUrl: BASE,
    });
    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.notice.action).toEqual({
      href: "/checkout/callback?reference=jata-existing",
      label: "Check the existing payment",
    });
  });

  it("surfaces missing configuration and unavailable payments verbatim", async () => {
    const notConfigured = await beginAutopilotActivation({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT",
      fetchImpl: fetchReturning(503, {
        code: "PLAN_NOT_CONFIGURED",
        error: "JATA Autopilot plans are not configured in this deployment yet.",
      }),
      baseUrl: BASE,
    });
    expect(notConfigured).toMatchObject({
      kind: "notice",
      notice: { code: "PLAN_NOT_CONFIGURED", text: "JATA Autopilot plans are not configured in this deployment yet." },
    });

    const unavailable = await beginAutopilotActivation({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT",
      fetchImpl: fetchReturning(503, {
        code: "PAYMENTS_UNAVAILABLE",
        error: "Online payments are temporarily unavailable. Please try again later.",
      }),
      baseUrl: BASE,
    });
    expect(unavailable).toMatchObject({ kind: "notice", notice: { code: "PAYMENTS_UNAVAILABLE" } });
  });

  it("keeps the provider's refusal message for a 502 and never claims success", async () => {
    const outcome = await beginAutopilotActivation({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT",
      fetchImpl: fetchReturning(502, {
        code: "PROVIDER_ERROR",
        error: "Paystack could not start this payment. Please try again.",
      }),
      baseUrl: BASE,
    });
    expect(outcome).toEqual({
      kind: "notice",
      notice: {
        tone: "error",
        text: "Paystack could not start this payment. Please try again.",
        code: "PROVIDER_ERROR",
      },
    });
  });

  it("refuses an unusable or hostile checkout URL", async () => {
    for (const authorization_url of [
      undefined,
      "",
      "javascript:alert(1)",
      "https://checkout.paystack.com.evil.test/abc",
      "https://evil.test/checkout.paystack.com",
      "/dashboard",
    ]) {
      const outcome = await beginAutopilotActivation({
        businessId: "biz_a",
        planKey: "JATA_AUTOPILOT",
        fetchImpl: fetchReturning(200, { authorization_url }),
        baseUrl: BASE,
      });
      expect(outcome).toEqual({
        kind: "notice",
        notice: { tone: "error", text: ACTIVATION_BAD_LINK, code: "CHECKOUT_LINK_INVALID" },
      });
    }
  });

  it("falls back to an honest message when an error body is not JSON", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>gateway error</html>", { status: 500 }),
    ) as unknown as typeof fetch;
    const outcome = await beginAutopilotActivation({
      businessId: "biz_a",
      planKey: "JATA_AUTOPILOT",
      fetchImpl,
      baseUrl: BASE,
    });
    expect(outcome).toEqual({
      kind: "notice",
      notice: { tone: "error", text: ACTIVATION_FALLBACK_ERROR },
    });
  });
});

describe("checkout URL and status-link validation", () => {
  it("accepts only Paystack's own https host or the local test checkout", () => {
    expect(resolveCheckoutUrl("https://checkout.paystack.com/x", BASE)).toBe("https://checkout.paystack.com/x");
    expect(resolveCheckoutUrl("/checkout/mock?reference=jata-1", BASE)).toBe(`${BASE}/checkout/mock?reference=jata-1`);
    expect(resolveCheckoutUrl("http://checkout.paystack.com/x", BASE)).toBeNull();
    expect(resolveCheckoutUrl("https://paystack.com/x", BASE)).toBeNull();
    expect(resolveCheckoutUrl("/checkout/callback?reference=jata-1", BASE)).toBeNull();
    expect(resolveCheckoutUrl("//evil.test/checkout/mock", BASE)).toBeNull();
  });

  it("accepts only the server's own callback status path", () => {
    expect(safeStatusPath("/checkout/callback?reference=jata-1")).toBe("/checkout/callback?reference=jata-1");
    expect(safeStatusPath("https://evil.test/checkout/callback?reference=jata-1")).toBeNull();
    expect(safeStatusPath("/checkout/callback?reference=jata-1\nSet-Cookie: x")).toBeNull();
    expect(safeStatusPath(undefined)).toBeNull();
  });
});
