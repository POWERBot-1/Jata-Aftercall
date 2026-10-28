/**
 * Plan, roles and compliance claims (POS / ERP - PRO).
 *
 * The product's public promise is KES 3,000/month on a plan distinct from BUSINESS_POS, with role
 * separation and no unearned compliance claim. These tests pin those three promises.
 */
import { describe, expect, it } from "vitest";
import {
  assertErpPlanPricing,
  deriveErpEntitlement,
  ERP_GRACE_DAYS,
  ERP_PLAN_DURATION_DAYS,
  ERP_PLAN_KEY,
  ERP_PLAN_PRICE_KES,
  erpFeatureEnabled,
} from "@/lib/erp/entitlement";
import { approvalDecision, ERP_APPROVAL_LIMITS_CENTS, ERP_PERMISSIONS, erpPermissionsFor, hasErpPermission, normalizeErpRole } from "@/lib/erp/access";
import { assertAuthoritativeAcceptance, complianceCentreSummary, etimsReadiness, TAX_RULE_REGISTRY_VERSION } from "@/lib/erp/compliance";
import { INDUSTRY_PACKS, industryPack } from "@/lib/erp/industryPacks";
import { ERP_MODULES, listImplementedModules, navigationFor } from "@/lib/erp/navigation";
import { existsSync } from "node:fs";
import path from "node:path";

describe("plan", () => {
  it("is priced at KES 3,000 for 30 days with a 3-day grace window", () => {
    expect(ERP_PLAN_KEY).toBe("ERP_PRO");
    expect(ERP_PLAN_PRICE_KES).toBe(3000);
    expect(ERP_PLAN_DURATION_DAYS).toBe(30);
    expect(ERP_GRACE_DAYS).toBe(3);
  });

  it("asserts the server-side price instead of trusting a client amount", () => {
    expect(assertErpPlanPricing({ key: "ERP_PRO", priceKES: 3000, durationDays: 30 })).toBe(true);
    expect(assertErpPlanPricing({ key: "ERP_PRO", priceKES: 2500, durationDays: 30 })).toBe(false);
    expect(assertErpPlanPricing({ key: "BUSINESS_POS", priceKES: 3000, durationDays: 30 })).toBe(false);
    expect(assertErpPlanPricing(null)).toBe(false);
  });

  it("can be switched off for a deployment, and production is off by default", () => {
    expect(erpFeatureEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(erpFeatureEnabled({ NODE_ENV: "production", ERP_PRO_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(erpFeatureEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(erpFeatureEnabled({ NODE_ENV: "development", ERP_PRO_DISABLED: "true" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("entitlement", () => {
  const now = new Date("2026-10-27T09:00:00Z");

  it("is not entitled without a subscription", () => {
    const state = deriveErpEntitlement({ now });
    expect(state.entitled).toBe(false);
    expect(state.lifecycle).toBe("SETUP");
    expect(state.nextAction).toBe("setup");
  });

  it("is not entitled by payment alone until the subscription is written", () => {
    const state = deriveErpEntitlement({ now, paidPayment: { status: "PAID", planKey: "ERP_PRO" } });
    expect(state.entitled).toBe(false);
    expect(state.lifecycle).toBe("AWAITING_PAYMENT");
  });

  it("is entitled while an active subscription has not expired", () => {
    const state = deriveErpEntitlement({
      now,
      subscription: { status: "ACTIVE", planKey: "ERP_PRO", expiresAt: new Date("2026-11-26T09:00:00Z") },
    });
    expect(state.entitled).toBe(true);
    expect(state.status).toBe("ACTIVE");
  });

  it("allows a labelled grace window after expiry, then stops", () => {
    const inGrace = deriveErpEntitlement({
      now,
      subscription: { status: "ACTIVE", planKey: "ERP_PRO", expiresAt: new Date("2026-10-26T09:00:00Z"), graceUntil: new Date("2026-10-30T09:00:00Z") },
    });
    expect(inGrace.entitled).toBe(true);
    expect(inGrace.inGrace).toBe(true);
    expect(inGrace.nextAction).toBe("renew");

    const after = deriveErpEntitlement({
      now,
      subscription: { status: "ACTIVE", planKey: "ERP_PRO", expiresAt: new Date("2026-10-20T09:00:00Z"), graceUntil: new Date("2026-10-23T09:00:00Z") },
    });
    expect(after.entitled).toBe(false);
    expect(after.lifecycle).toBe("EXPIRED");
  });

  it("does not grant access on another plan's subscription", () => {
    const state = deriveErpEntitlement({ now, subscription: { status: "ACTIVE", planKey: "BUSINESS_POS", expiresAt: new Date("2026-11-26T09:00:00Z") } });
    expect(state.entitled).toBe(false);
    expect(state.reason).toMatch(/does not include/i);
  });

  it("treats a suspended or cancelled workspace as not entitled", () => {
    expect(deriveErpEntitlement({ now, subscription: { status: "SUSPENDED", planKey: "ERP_PRO" } }).entitled).toBe(false);
    expect(deriveErpEntitlement({ now, subscription: { status: "CANCELLED", planKey: "ERP_PRO" } }).status).toBe("CANCELLED");
  });
});

describe("roles", () => {
  it("gives an owner every permission and a viewer only read access", () => {
    expect(erpPermissionsFor("OWNER")).toHaveLength(ERP_PERMISSIONS.length);
    expect(hasErpPermission("VIEWER", "WORKSPACE_READ")).toBe(true);
    expect(hasErpPermission("VIEWER", "POST_JOURNAL")).toBe(false);
    expect(hasErpPermission("VIEWER", "MANAGE_USERS")).toBe(false);
  });

  it("keeps staff-level roles away from finance administration", () => {
    expect(hasErpPermission("STAFF", "MANAGE_INVOICES")).toBe(true);
    expect(hasErpPermission("STAFF", "CLOSE_PERIOD")).toBe(false);
    expect(hasErpPermission("STAFF", "MANAGE_BILLING")).toBe(false);
    expect(hasErpPermission("FINANCE", "CLOSE_PERIOD")).toBe(true);
    expect(hasErpPermission("FINANCE", "MANAGE_USERS")).toBe(false);
  });

  it("normalises unknown roles down to the least privileged role", () => {
    expect(normalizeErpRole("owner")).toBe("OWNER");
    expect(normalizeErpRole("ACCOUNTANT")).toBe("FINANCE");
    expect(normalizeErpRole("SUPERUSER")).toBe("VIEWER");
    expect(normalizeErpRole(null)).toBe("VIEWER");
  });

  it("enforces approval limits in cents", () => {
    expect(ERP_APPROVAL_LIMITS_CENTS.MANAGER).toBe(1_000_000);
    expect(approvalDecision({ role: "MANAGER", amountCents: 900_000 }).allowed).toBe(true);
    expect(approvalDecision({ role: "MANAGER", amountCents: 1_500_000 }).allowed).toBe(false);
    expect(approvalDecision({ role: "STAFF", amountCents: 1 }).allowed).toBe(false);
    expect(approvalDecision({ role: "OWNER", amountCents: 50_000_000 }).allowed).toBe(true);
  });

  it("blocks a person from approving their own request when separation of duties is on", () => {
    const decision = approvalDecision({ role: "OWNER", amountCents: 1000, initiatorId: "userA", approverId: "userA", separationOfDuties: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/own request/i);
    expect(approvalDecision({ role: "OWNER", amountCents: 1000, initiatorId: "userA", approverId: "userB", separationOfDuties: true }).allowed).toBe(true);
  });
});

describe("compliance claims", () => {
  it("says what is missing instead of claiming eTIMS readiness", () => {
    const readiness = etimsReadiness(null);
    expect(readiness.invoiceSubmissionEnabled).toBe(false);
    expect(readiness.status).not.toBe("VERIFIED");
    const byKey = Object.fromEntries(readiness.checks.map((check) => [check.key, check.status]));
    expect(byKey.taxpayer_identity).toBe("FAIL");
    expect(byKey.integration_certification).toBe("NOT TESTED");
    expect(byKey.kra_onboarding).toBe("BLOCKED");
  });

  it("marks system-to-system certification as blocked, not done", () => {
    const readiness = etimsReadiness({ kraPin: "P051234567X", taxpayerName: "Nyumbani Kitchen", vatRegistered: true, etimsSolution: "OSCU", etimsStatus: "ONBOARDED" });
    const certification = readiness.checks.find((check) => check.key === "integration_certification");
    expect(certification?.status).toBe("BLOCKED");
    expect(readiness.invoiceSubmissionEnabled).toBe(false);
  });

  it("refuses to call an invoice accepted without an authoritative control number", () => {
    expect(assertAuthoritativeAcceptance({ status: "ACCEPTED", controlNumber: null, responseSource: "KRA_ETIMS" }).ok).toBe(false);
    expect(assertAuthoritativeAcceptance({ status: "ACCEPTED", controlNumber: "C01-123", responseSource: "MOCK" }).ok).toBe(false);
    expect(assertAuthoritativeAcceptance({ status: "ACCEPTED", controlNumber: "C01-123", responseSource: "KRA_ETIMS" }).ok).toBe(true);
  });

  it("reports counts supplied by the caller and never invents them", () => {
    const summary = complianceCentreSummary({
      role: "OWNER",
      profile: { kraPin: "P051234567X", taxpayerName: "Nyumbani", vatRegistered: true, etimsSolution: "LITE", etimsStatus: "ONBOARDED" },
      taxRules: [
        { key: "VAT_STANDARD", verified: false },
        { key: "VAT_ZERO", verified: true },
      ],
      counts: { awaitingSubmission: 3, accepted: 0, rejected: 1, uncertain: 2 },
    });
    expect(summary.taxRuleCount).toBe(2);
    expect(summary.verifiedTaxRuleCount).toBe(1);
    expect(summary.invoicesAwaitingSubmission).toBe(3);
    expect(summary.submissionEnabled).toBe(false);
    expect(summary.registryVersion).toBe(TAX_RULE_REGISTRY_VERSION);

    const empty = complianceCentreSummary({ role: "OWNER", profile: null, taxRules: [] });
    expect(empty.acceptedInvoices).toBe(0);
    expect(empty.rejectedInvoices).toBe(0);
  });
});

describe("industry packs and navigation", () => {
  it("ships 20 packs and states each one's maturity honestly", () => {
    expect(INDUSTRY_PACKS).toHaveLength(20);
    expect(industryPack("retail").status).toBe("TESTED");
    expect(industryPack("pharmacy").status).toBe("BLOCKED");
    expect(industryPack("unknown-pack").key).toBe("retail");
  });

  it("lists only READY modules as implemented", () => {
    const ready = listImplementedModules();
    expect(ready.every((module) => module.status === "READY")).toBe(true);
    expect(ready.map((module) => module.key)).toContain("messaging");
    expect(ready.map((module) => module.key)).toContain("accounting");
    expect(ERP_MODULES.some((module) => module.status === "PLANNED")).toBe(true);
  });

  it("filters the sidebar by role and returns the planned roadmap separately", () => {
    const owner = navigationFor({ businessId: "bizA", role: "OWNER", packKey: "retail" });
    const viewer = navigationFor({ businessId: "bizA", role: "VIEWER", packKey: "retail" });

    expect(owner.groups.length).toBeGreaterThan(0);
    expect(owner.bottom.map((item) => item.key)).toContain("home");
    expect(viewer.groups.flatMap((group) => group.items).map((item) => item.key)).not.toContain("accounting");
    expect(owner.planned.length).toBeGreaterThan(0);
  });

  it("marks the active module and builds tenant-scoped hrefs", () => {
    const nav = navigationFor({ businessId: "bizA", role: "OWNER", packKey: "retail", activeKey: "messaging" });
    const messaging = nav.primary.find((item) => item.key === "messaging");
    expect(messaging?.active).toBe(true);
    expect(messaging?.href).toBe("/dashboard/erp/bizA/messaging");
  });

  // E14: a READY module whose page exists but which no navigation group lists is reachable only by
  // typing its URL. tasks, notifications, approvals, requisitions and procurement were in exactly
  // that state — absent from CORE_MODULES and from every group — so the sidebar never linked them,
  // and the two page checks above are the evidence that the pages themselves worked. This asserts
  // the general property (page on disk ⇒ linked in navigation) for every industry pack, so a future
  // module inherits it instead of repeating the mistake.
  it("links every READY module that actually has a page, for every pack", () => {
    const erpRoot = path.join(process.cwd(), "app/dashboard/erp/[businessId]");
    const pageModules = ERP_MODULES.filter((module) => {
      const segment = module.path.replace(/^\//, "");
      if (!segment) return false; // `home` is the workspace root, reached from `primary`
      return existsSync(path.join(erpRoot, segment, "page.tsx"));
    });
    expect(pageModules.length).toBeGreaterThan(10);
    // Derived from the real pack list: hard-coding keys here once silently tested the retail fallback
    // twenty times because unknown keys resolve to it.
    const packKeys = INDUSTRY_PACKS.map((pack) => pack.key);
    expect(packKeys.length).toBeGreaterThan(10);
    for (const packKey of packKeys) {
      const nav = navigationFor({ businessId: "bizA", role: "OWNER", packKey });
      const linked = new Set([...nav.primary, ...nav.groups.flatMap((group) => group.items), ...nav.bottom].map((item) => item.key));
      const unlinked = pageModules.map((module) => module.key).filter((key) => !linked.has(key));
      expect(unlinked, `pack ${packKey} has pages nobody can reach`).toEqual([]);
    }
  });

  it("hides modules the deployment switched off", () => {
    const nav = navigationFor({ businessId: "bizA", role: "OWNER", packKey: "retail", disabledKeys: ["messaging", "store"] });
    expect(nav.primary.map((item) => item.key)).not.toContain("messaging");
    expect(nav.primary.map((item) => item.key)).not.toContain("store");
  });
});
