import { describe, it, expect } from "vitest";
import { deriveMjengoEntitlement, MJENGO_PLAN_KEY, MJENGO_PLAN_PRICE_KES } from "../../lib/mjengo/entitlement";
import { derivePosEntitlement, POS_PLAN_KEY } from "../../lib/pos/entitlement";
import { deriveErpEntitlement, ERP_PLAN_KEY } from "../../lib/erp/entitlement";
import { assertMjengoPricing, PRIVATE_PLAN_KEYS } from "../../lib/pricing";

describe("mjengo: product separation", () => {
  it("BUSINESS_POS does not grant MJENGO_OS", () => {
    const posSub = { status: "ACTIVE", planKey: POS_PLAN_KEY, expiresAt: new Date(Date.now() + 86400000) };
    const mjengo = deriveMjengoEntitlement({ subscription: posSub as any, entitlement: { status: "ACTIVE" }, configured: true });
    expect(mjengo.entitled).toBe(false);
    expect(mjengo.reason).toMatch(/does not include MJENGO OS/i);
  });
  it("MJENGO_OS does not grant BUSINESS_POS", () => {
    const mjengoSub = { status: "ACTIVE", planKey: MJENGO_PLAN_KEY, expiresAt: new Date(Date.now() + 86400000) };
    const pos = derivePosEntitlement({ subscription: mjengoSub as any, entitlement: { status: "ACTIVE" } as any, paidPayment: { status: "PAID" } as any, configurationStatus: "LIVE", publishedVersion: 1 });
    expect(pos.entitled).toBe(false);
  });
  it("MJENGO_OS pricing is KES 2000/30d separately from POS 499", () => {
    expect(MJENGO_PLAN_PRICE_KES).toBe(2000);
    expect(MJENGO_PLAN_KEY).toBe("MJENGO_OS");
    expect(POS_PLAN_KEY).toBe("BUSINESS_POS");
    expect(PRIVATE_PLAN_KEYS).toContain("MJENGO_OS");
    expect(PRIVATE_PLAN_KEYS).toContain("BUSINESS_POS");
    expect(PRIVATE_PLAN_KEYS).toContain(ERP_PLAN_KEY);
    // POS and MJENGO remain distinct
    const mjengoPlan = { key: "MJENGO_OS", priceKES: 2000, durationDays: 30 } as any;
    expect(assertMjengoPricing(mjengoPlan)).toBe(true);
    const posPlanAsMjengo = { key: "BUSINESS_POS", priceKES: 499, durationDays: 30 } as any;
    expect(assertMjengoPricing(posPlanAsMjengo)).toBe(false);
  });
  it("existing POS customer retains access when MJENGO not purchased", () => {
    const posSub = { status: "ACTIVE", planKey: POS_PLAN_KEY, expiresAt: new Date(Date.now() + 86400000), graceUntil: new Date(Date.now() + 86400000 * 3) };
    const pos = derivePosEntitlement({ subscription: posSub as any, entitlement: { status: "ACTIVE" } as any, configurationStatus: "LIVE", publishedVersion: 5, paidPayment: null as any });
    expect(pos.entitled).toBe(true);
    expect(pos.planKey).toBe(POS_PLAN_KEY);
  });
});
