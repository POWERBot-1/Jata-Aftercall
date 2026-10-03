import { describe, it, expect } from "vitest";
import { deriveAIEntitlement } from "../../lib/ai-entitlement";

/**
 * §49 / §50 — the commercial gate for live AI.
 *
 * Entitlement is derived server side from subscription, entitlement row and verified payment
 * state; a client can never assert it. These cases pin the boundaries that matter commercially:
 * another package must not unlock AI, an expired window must revoke it, and a grace window must
 * keep it while flagging it.
 */

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

describe("AI Front Desk entitlement derivation", () => {
  it("an active INTERACTIVE_BUSINESS subscription does not unlock the AI package", () => {
    const result = deriveAIEntitlement({
      subscription: {
        status: "ACTIVE",
        expiresAt: daysFromNow(30),
        plan: { key: "INTERACTIVE_BUSINESS" },
      } as never,
      paidPayment: { status: "PAID" },
    });

    expect(result.entitled).toBe(false);
    expect(result.status).toBe("NONE");
  });

  it("a paid payment with no subscription and no entitlement row grants nothing", () => {
    const result = deriveAIEntitlement({ paidPayment: { status: "PAID" } });

    expect(result.entitled).toBe(false);
    expect(result.status).toBe("NONE");
  });

  it("an active AI Front Desk subscription inside its window is entitled", () => {
    const result = deriveAIEntitlement({
      subscription: {
        status: "ACTIVE",
        expiresAt: daysFromNow(30),
        plan: { key: "AI_BUSINESS_FRONT_DESK" },
      } as never,
    });

    expect(result.entitled).toBe(true);
    expect(result.status).toBe("ACTIVE");
    expect(result.priceKES).toBe(499);
    expect(result.billingCycleDays).toBe(30);
  });

  it("an expired subscription revokes entitlement and keeps historical access", () => {
    const expiresAt = daysFromNow(-1);
    const result = deriveAIEntitlement({
      subscription: {
        status: "ACTIVE",
        expiresAt,
        plan: { key: "AI_BUSINESS_FRONT_DESK" },
      } as never,
      entitlement: { status: "ACTIVE", expiresAt } as never,
    });

    expect(result.entitled).toBe(false);
    expect(result.status).toBe("EXPIRED");
  });

  it("the grace window keeps access but reports PAST_DUE", () => {
    const result = deriveAIEntitlement({
      subscription: {
        status: "ACTIVE",
        expiresAt: daysFromNow(-1),
        graceUntil: daysFromNow(3),
        plan: { key: "AI_BUSINESS_FRONT_DESK" },
      } as never,
    });

    expect(result.entitled).toBe(true);
    expect(result.status).toBe("PAST_DUE");
  });

  it("a suspended subscription stops live AI", () => {
    const result = deriveAIEntitlement({
      subscription: {
        status: "SUSPENDED",
        expiresAt: daysFromNow(30),
        plan: { key: "AI_BUSINESS_FRONT_DESK" },
      } as never,
    });

    expect(result.entitled).toBe(false);
    expect(result.status).toBe("SUSPENDED");
  });
});
