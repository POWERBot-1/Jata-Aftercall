import { describe, expect, it } from "vitest";
import { deriveAIEntitlement } from "../../lib/ai-entitlement";

/**
 * Production audit 2026-10-04 — plan-substitution / stale-entitlement bypass.
 *
 * A business holds one Subscription row. Paying for AI Business Front Desk (KES 499) writes an
 * AI entitlement row; paying for another plan afterwards replaces the subscription but never
 * touches that row. The old rule let the leftover AI row stand in for the plan check, so live AI
 * stayed on for the whole window of the cheaper plan.
 */

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);
const staleAiRow = { status: "ACTIVE", packageKey: "AI_BUSINESS_FRONT_DESK", expiresAt: daysFromNow(-5) } as never;

describe("AI Front Desk is not unlocked by a leftover AI entitlement row", () => {
  it.each(["MONTHLY", "ANNUAL", "INTERACTIVE_BUSINESS"])(
    "an active %s subscription plus a stale ACTIVE AI row is NOT entitled",
    (planKey) => {
      const future = daysFromNow(20);
      const result = deriveAIEntitlement({
        subscription: { status: "ACTIVE", expiresAt: future, graceUntil: daysFromNow(23), plan: { key: planKey } } as never,
        entitlement: staleAiRow,
        paidPayment: { status: "PAID" },
        planKey,
      });
      expect(result.entitled).toBe(false);
      expect(result.active).toBe(false);
      expect(result.status).toBe("NONE");
    },
  );

  it("the same holds when only the subscription's plan relation names the other product", () => {
    const result = deriveAIEntitlement({
      subscription: { status: "ACTIVE", expiresAt: daysFromNow(20), plan: { key: "MONTHLY" } } as never,
      entitlement: staleAiRow,
      paidPayment: { status: "PAID" },
    });
    expect(result.entitled).toBe(false);
  });

  it("a genuine AI subscription with its AI row is still entitled (no regression)", () => {
    const result = deriveAIEntitlement({
      subscription: { status: "ACTIVE", expiresAt: daysFromNow(20), plan: { key: "AI_BUSINESS_FRONT_DESK" } } as never,
      entitlement: { status: "ACTIVE", packageKey: "AI_BUSINESS_FRONT_DESK", expiresAt: daysFromNow(20) } as never,
      paidPayment: { status: "PAID" },
      planKey: "AI_BUSINESS_FRONT_DESK",
    });
    expect(result.entitled).toBe(true);
    expect(result.status).toBe("ACTIVE");
  });

  it("an entitlement-only business (no subscription row) keeps the documented behaviour", () => {
    const result = deriveAIEntitlement({
      entitlement: { status: "ACTIVE", packageKey: "AI_BUSINESS_FRONT_DESK" } as never,
    });
    expect(result.entitled).toBe(true);
  });
});
