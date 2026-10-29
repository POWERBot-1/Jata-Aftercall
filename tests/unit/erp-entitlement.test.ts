/**
 * POS / ERP - PRO plan and access control.
 *
 * The product is sold at KES 3,000/month separately from BUSINESS_POS (KES 499). These tests pin
 * that separation, the grace window, and the role/approval matrix so a later screen cannot quietly
 * widen access.
 */
import { describe, expect, it } from "vitest";
import {
  assertErpPlanPricing,
  deriveErpEntitlement,
  ERP_GRACE_DAYS,
  ERP_PLAN_DURATION_DAYS,
  ERP_PLAN_PRICE_KES,
  erpFeatureEnabled,
} from "@/lib/erp/entitlement";
import {
  approvalDecision,
  ERP_APPROVAL_LIMITS_CENTS,
  ERP_PERMISSIONS,
  erpPermissionsFor,
  hasErpPermission,
  normalizeErpRole,
} from "@/lib/erp/access";

const now = new Date("2026-10-27T09:00:00Z");

describe("plan pricing", () => {
  it("is KES 3,000 for 30 days with a 3-day grace period", () => {
    expect(ERP_PLAN_PRICE_KES).toBe(3000);
    expect(ERP_PLAN_DURATION_DAYS).toBe(30);
    expect(ERP_GRACE_DAYS).toBe(3);
  });

  it("accepts only the exact server-side plan row", () => {
    expect(assertErpPlanPricing({ key: "ERP_PRO", priceKES: 3000, durationDays: 30 })).toBe(true);
    expect(assertErpPlanPricing({ key: "ERP_PRO", priceKES: 499, durationDays: 30 })).toBe(false);
    expect(assertErpPlanPricing({ key: "BUSINESS_POS", priceKES: 499, durationDays: 30 })).toBe(false);
    expect(assertErpPlanPricing(null)).toBe(false);
  });
});

describe("feature switch", () => {
  it("is off in production unless explicitly enabled", () => {
    expect(erpFeatureEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(erpFeatureEnabled({ NODE_ENV: "production", ERP_PRO_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("always lets an explicit kill switch win", () => {
    expect(erpFeatureEnabled({ NODE_ENV: "development", ERP_PRO_DISABLED: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(erpFeatureEnabled({ NODE_ENV: "development", ERP_PRO_ENABLED: "true", ERP_PRO_DISABLED: "true" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("entitlement", () => {
  it("starts in setup with nothing entitled", () => {
    const state = deriveErpEntitlement({ now });
    expect(state.entitled).toBe(false);
    expect(state.lifecycle).toBe("SETUP");
    expect(state.nextAction).toBe("setup");
    expect(state.priceKES).toBe(3000);
  });

  it("a paid payment alone does not grant access until the subscription is written", () => {
    const state = deriveErpEntitlement({ now, paidPayment: { status: "PAID", planKey: "ERP_PRO" } });
    expect(state.entitled).toBe(false);
    expect(state.lifecycle).toBe("AWAITING_PAYMENT");
  });

  it("grants access on an active subscription and reports the end date", () => {
    const state = deriveErpEntitlement({
      now,
      subscription: { status: "ACTIVE", planKey: "ERP_PRO", expiresAt: new Date("2026-11-26T09:00:00Z") },
    });
    expect(state.entitled).toBe(true);
    expect(state.status).toBe("ACTIVE");
    expect(state.expiresAt?.toISOString()).toBe("2026-11-26T09:00:00.000Z");
  });

  it("allows a labelled grace window after expiry and then stops", () => {
    const inGrace = deriveErpEntitlement({
      now,
      subscription: {
        status: "ACTIVE",
        planKey: "ERP_PRO",
        expiresAt: new Date("2026-10-26T09:00:00Z"),
        graceUntil: new Date("2026-10-29T09:00:00Z"),
      },
    });
    expect(inGrace.entitled).toBe(true);
    expect(inGrace.inGrace).toBe(true);
    expect(inGrace.nextAction).toBe("renew");

    const expired = deriveErpEntitlement({
      now,
      subscription: {
        status: "ACTIVE",
        planKey: "ERP_PRO",
        expiresAt: new Date("2026-10-20T09:00:00Z"),
        graceUntil: new Date("2026-10-23T09:00:00Z"),
      },
    });
    expect(expired.entitled).toBe(false);
    expect(expired.lifecycle).toBe("EXPIRED");
  });

  it("never lets a BUSINESS_POS subscription unlock ERP PRO", () => {
    const state = deriveErpEntitlement({
      now,
      subscription: { status: "ACTIVE", planKey: "BUSINESS_POS", expiresAt: new Date("2026-12-01T00:00:00Z") },
    });
    expect(state.entitled).toBe(false);
  });

  it("treats a suspended workspace as unavailable", () => {
    const state = deriveErpEntitlement({ now, subscription: { status: "SUSPENDED", planKey: "ERP_PRO" } });
    expect(state.entitled).toBe(false);
    expect(state.lifecycle).toBe("SUSPENDED");
  });
});

describe("roles and approvals", () => {
  it("gives an owner every permission and a viewer read-only ones", () => {
    expect(erpPermissionsFor("OWNER")).toHaveLength(ERP_PERMISSIONS.length);
    expect(hasErpPermission("VIEWER", "VIEW_INVOICES")).toBe(true);
    expect(hasErpPermission("VIEWER", "POST_JOURNAL")).toBe(false);
    expect(hasErpPermission("VIEWER", "MANAGE_USERS")).toBe(false);
  });

  it("keeps staff away from journals, closing periods and billing", () => {
    expect(hasErpPermission("STAFF", "MANAGE_INVOICES")).toBe(true);
    expect(hasErpPermission("STAFF", "POST_JOURNAL")).toBe(false);
    expect(hasErpPermission("STAFF", "CLOSE_PERIOD")).toBe(false);
    expect(hasErpPermission("STAFF", "MANAGE_BILLING")).toBe(false);
  });

  it("normalises unknown roles down to the least privilege", () => {
    expect(normalizeErpRole("FINANCE_MANAGER")).toBe("FINANCE");
    expect(normalizeErpRole("owner")).toBe("OWNER");
    expect(normalizeErpRole("SUPERUSER")).toBe("VIEWER");
    expect(normalizeErpRole(null)).toBe("VIEWER");
  });

  it("caps approvals by role", () => {
    expect(ERP_APPROVAL_LIMITS_CENTS.MANAGER).toBe(1_000_000);
    expect(approvalDecision({ role: "MANAGER", amountCents: 900_000 }).allowed).toBe(true);
    expect(approvalDecision({ role: "MANAGER", amountCents: 1_000_001 }).allowed).toBe(false);
    expect(approvalDecision({ role: "STAFF", amountCents: 1 }).allowed).toBe(false);
    expect(approvalDecision({ role: "OWNER", amountCents: 99_000_000 }).allowed).toBe(true);
  });

  it("refuses self-approval when separation of duties is requested", () => {
    const decision = approvalDecision({ role: "OWNER", amountCents: 1000, initiatorId: "u1", approverId: "u1", separationOfDuties: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/own/i);
  });
});
