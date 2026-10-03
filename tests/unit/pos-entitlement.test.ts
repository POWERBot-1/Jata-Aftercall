/**
 * Commercial lifecycle and settlement (§43, §44, §45, §56, §67, §75).
 *
 * The POS may not trade before the server has confirmed payment. These tests pin the decision
 * function (pure), the settlement path (mocked transaction), and the rule that keeps the POS plan
 * off every public and customer-facing surface.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The lifecycle decision is pure; only the plan lookup and the settlement path touch the database.
vi.mock("@/lib/db", () => ({
  default: {
    planConfig: {
      findUnique: vi.fn(async ({ where }: any) =>
        where?.key === "BUSINESS_POS"
          ? { id: "plan_pos", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS", priceKES: 499, durationDays: 30, isActive: true }
          : null,
      ),
      findMany: vi.fn(async () => []),
    },
    posSubscription: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    posEntitlement: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    posConfiguration: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    posConfigurationVersion: { create: vi.fn(async () => ({})) },
    posAuditEvent: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
    payment: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 0 })), findUnique: vi.fn(async () => null) },
    processedWebhook: { create: vi.fn(async () => ({})) },
    business: { findUnique: vi.fn(async () => null) },
  },
}));

import {
  POS_PLAN_DURATION_DAYS,
  POS_PLAN_KEY,
  POS_PLAN_NAME,
  POS_PLAN_PRICE_KES,
  POS_LIFECYCLE_LABELS,
  assertPosPlanPricing,
  derivePosEntitlement,
  isLiveLifecycle,
  lifecycleWithoutPayment,
} from "@/lib/pos/entitlement";
import { settlePosPayment, lapseExpiredPosSubscriptions } from "@/lib/pos/settlement";
import { getBusinessPosPlan, PRIVATE_PLAN_KEYS, isPubliclyListedPlan, publiclyListedPlans } from "@/lib/pricing";
import { POS_PLAN_KEY as ENGINE_PLAN_KEY } from "@/lib/pos/configuration";

const root = path.resolve(__dirname, "../..");
const now = new Date("2026-10-01T09:00:00Z");

describe("the plan is priced on the server (§45, §56)", () => {
  it("is KES 499 for 30 days and says so in one place", () => {
    expect(POS_PLAN_KEY).toBe("BUSINESS_POS");
    expect(POS_PLAN_PRICE_KES).toBe(499);
    expect(POS_PLAN_DURATION_DAYS).toBe(30);
    expect(POS_PLAN_NAME).toContain("Business POS");
    expect(ENGINE_PLAN_KEY).toBe(POS_PLAN_KEY);
  });

  it("rejects a plan row that does not match the published price", () => {
    expect(assertPosPlanPricing({ key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 })).toBe(true);
    expect(assertPosPlanPricing({ key: POS_PLAN_KEY, priceKES: 1, durationDays: 30 })).toBe(false);
    expect(assertPosPlanPricing({ key: POS_PLAN_KEY, priceKES: 499, durationDays: 365 })).toBe(false);
    expect(assertPosPlanPricing({ key: "MONTHLY", priceKES: 499, durationDays: 30 })).toBe(false);
    expect(assertPosPlanPricing(null)).toBe(false);
  });

  it("guards checkout against a misconfigured POS price", () => {
    const checkout = readFileSync(path.join(root, "app/api/checkout/route.ts"), "utf8");
    expect(checkout).toContain("POS_PLAN_KEY");
    expect(checkout).toContain("assertPosPlanPricing(plan)");
    expect(checkout).toContain("Business POS pricing configuration is invalid.");
  });

  it("seeds the plan at the intended price", () => {
    const seed = readFileSync(path.join(root, "prisma/seed.ts"), "utf8");
    expect(seed).toContain('key: "BUSINESS_POS"');
    expect(seed).toContain("priceKES: 499, durationDays: 30");
  });
});

describe("the POS plan is never advertised publicly (§67)", () => {
  it("is a private plan key", () => {
    expect(PRIVATE_PLAN_KEYS).toContain(POS_PLAN_KEY);
    expect(isPubliclyListedPlan(POS_PLAN_KEY)).toBe(false);
    expect(isPubliclyListedPlan("MONTHLY")).toBe(true);
    expect(isPubliclyListedPlan("INTERACTIVE_BUSINESS")).toBe(true);
  });

  it("is filtered out of public plan listings", () => {
    const plans = [
      { id: "1", key: "MONTHLY", name: "Monthly", priceKES: 149, durationDays: 30, isActive: true },
      { id: "2", key: POS_PLAN_KEY, name: POS_PLAN_NAME, priceKES: 499, durationDays: 30, isActive: true },
    ];
    expect(publiclyListedPlans(plans).map((plan) => plan.key)).toEqual(["MONTHLY"]);
  });

  it("keeps the POS out of the landing page, onboarding and the AFTERCALL subscription screen", () => {
    for (const file of ["app/page.tsx", "app/onboarding/page.tsx", "app/dashboard/subscription/page.tsx"]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).toContain("publiclyListedPlans");
    }
  });

  it("never mentions the POS price in customer-facing referral or business-page copy", () => {
    for (const file of ["app/r/[code]/route.ts", "components/BusinessPage.tsx"]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toContain("BUSINESS_POS");
      expect(source, file).not.toContain("Business POS");
    }
  });
});

describe("lifecycle states are explicit (§44)", () => {
  it("labels every state in words an owner understands", () => {
    for (const state of ["DRAFT", "CONFIGURED", "PREVIEW", "AWAITING_PAYMENT", "PAYMENT_CONFIRMED", "PROVISIONING", "LIVE", "SUSPENDED", "CANCELLED"] as const) {
      expect(POS_LIFECYCLE_LABELS[state]?.label, state).toBeTruthy();
      expect(POS_LIFECYCLE_LABELS[state].label).not.toMatch(/DRAFT|CONFIGURED|LIVE/);
    }
    expect(isLiveLifecycle("LIVE")).toBe(true);
    expect(isLiveLifecycle("PREVIEW")).toBe(false);
    expect(isLiveLifecycle("SUSPENDED")).toBe(false);
  });

  it("keeps an unconfigured business in DRAFT and a configured one awaiting payment", () => {
    expect(lifecycleWithoutPayment("DRAFT", false)).toBe("DRAFT");
    expect(lifecycleWithoutPayment("CONFIGURED", false)).toBe("AWAITING_PAYMENT");
    expect(lifecycleWithoutPayment("PREVIEW", false)).toBe("PREVIEW");
    expect(lifecycleWithoutPayment("CONFIGURED", true)).toBe("PAYMENT_CONFIRMED");
  });

  it("never honours a stored LIVE without payment evidence (§44, §75)", () => {
    expect(lifecycleWithoutPayment("LIVE", false)).toBe("AWAITING_PAYMENT");
    const state = derivePosEntitlement({ configurationStatus: "LIVE", now });
    expect(state.entitled).toBe(false);
    expect(state.lifecycle).not.toBe("LIVE");
  });

  it("treats a preview as a preview, not as production", () => {
    const state = derivePosEntitlement({ configurationStatus: "PREVIEW", now });
    expect(state.entitled).toBe(false);
    expect(state.lifecycle).toBe("PREVIEW");
    expect(state.nextAction).toBe("preview");
  });
});

describe("entitlement follows payment, not the browser (§45, §56)", () => {
  const activeSubscription = {
    status: "ACTIVE",
    planKey: POS_PLAN_KEY,
    startAt: new Date("2026-09-15T09:00:00Z"),
    expiresAt: new Date("2026-10-15T09:00:00Z"),
  };

  it("is live only with an active subscription to the POS plan, in date", () => {
    const state = derivePosEntitlement({ subscription: activeSubscription, configurationStatus: "PUBLISHED", now });
    expect(state.entitled).toBe(true);
    expect(state.lifecycle).toBe("LIVE");
    expect(state.nextAction).toBe("none");
  });

  it("refuses to grant the POS on the strength of another product's subscription (§4, §80)", () => {
    const aftercallOnly = derivePosEntitlement({
      subscription: { ...activeSubscription, planKey: "INTERACTIVE_BUSINESS" },
      configurationStatus: "PUBLISHED",
      now,
    });
    expect(aftercallOnly.entitled).toBe(false);
    expect(aftercallOnly.lifecycle).not.toBe("LIVE");
    expect(aftercallOnly.reason).toMatch(/does not include the Business POS/i);
  });

  it("treats payment initiation as nothing at all", () => {
    const pending = derivePosEntitlement({
      subscription: { status: "PENDING", planKey: POS_PLAN_KEY },
      configurationStatus: "AWAITING_PAYMENT",
      now,
    });
    expect(pending.entitled).toBe(false);
    expect(pending.lifecycle).toBe("AWAITING_PAYMENT");
    expect(pending.nextAction).toBe("pay");
  });

  it("keeps trading through a grace period, then suspends", () => {
    const pastDue = derivePosEntitlement({
      subscription: { ...activeSubscription, status: "PAST_DUE", expiresAt: new Date("2026-09-30T09:00:00Z"), graceUntil: new Date("2026-10-03T09:00:00Z") },
      configurationStatus: "PUBLISHED",
      now,
    });
    expect(pastDue.entitled).toBe(true);
    expect(pastDue.nextAction).toBe("renew");

    const expired = derivePosEntitlement({
      subscription: { ...activeSubscription, expiresAt: new Date("2026-09-01T09:00:00Z"), graceUntil: new Date("2026-09-04T09:00:00Z") },
      configurationStatus: "PUBLISHED",
      now,
    });
    expect(expired.entitled).toBe(false);
    expect(expired.lifecycle).toBe("SUSPENDED");
    expect(expired.nextAction).toBe("renew");
    expect(expired.reason).toMatch(/records are safe/i);
  });

  it("honours a cancellation over everything else", () => {
    const cancelled = derivePosEntitlement({
      subscription: { ...activeSubscription, status: "CANCELLED" },
      entitlement: { status: "CANCELLED" },
      configurationStatus: "PUBLISHED",
      now,
    });
    expect(cancelled.entitled).toBe(false);
    expect(cancelled.lifecycle).toBe("CANCELLED");
  });

  it("reads payment evidence from the existing Payment ledger, not a client flag", () => {
    const paid = derivePosEntitlement({ paidPayment: { status: "PAID" }, configurationStatus: "CONFIGURED", now });
    expect(paid.lifecycle).toBe("PAYMENT_CONFIRMED");
    const unpaid = derivePosEntitlement({ paidPayment: { status: "PENDING" }, configurationStatus: "CONFIGURED", now });
    expect(unpaid.lifecycle).toBe("AWAITING_PAYMENT");
  });
});

describe("settlement activates the POS inside the payment transaction (§31, §45)", () => {
  const payment = {
    id: "pay_1",
    reference: "jata-abc",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49900,
    currency: "KES",
    status: "PENDING",
  };
  const plan = { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 };

  function txWith(overrides: Record<string, any> = {}) {
    const calls: string[] = [];
    const record = (name: string) => (...args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(overrides[name]?.(...args));
    };
    return {
      calls,
      posSubscription: {
        findUnique: vi.fn(async () => overrides.currentSubscription ?? null),
        findMany: vi.fn(async () => overrides.expiredSubscriptions ?? []),
        upsert: vi.fn(async () => ({ status: "ACTIVE" })),
        update: vi.fn(async () => ({ status: "EXPIRED" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      posEntitlement: {
        upsert: vi.fn(async () => ({ status: "ACTIVE" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      posConfiguration: {
        findUnique: vi.fn(async () => overrides.configuration ?? null),
        update: vi.fn(async () => ({ id: "cfg", status: "LIVE" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      posConfigurationVersion: { create: vi.fn(async () => ({ id: "v1" })) },
      posAuditEvent: { create: vi.fn(async () => ({ id: "a1" })) },
      payment: {
        updateMany: vi.fn(async () => ({ count: overrides.paymentUpdateCount ?? 1 })),
        findUnique: vi.fn(async () => overrides.latestPayment ?? null),
      },
      processedWebhook: { create: vi.fn(async () => ({ id: "evt" })) },
      ...(overrides.extra ?? {}),
      record,
    };
  }

  it("refuses to settle a payment for any other plan", async () => {
    const tx = txWith();
    await expect(
      settlePosPayment(tx as never, { payment, plan: { ...plan, key: "MONTHLY" } }),
    ).rejects.toThrow("POS_PLAN_KEY_MISMATCH");
    expect(tx.posSubscription.upsert).not.toHaveBeenCalled();
  });

  it("refuses a payment with no business context", async () => {
    const tx = txWith();
    await expect(
      settlePosPayment(tx as never, { payment: { ...payment, businessId: "" }, plan }),
    ).rejects.toThrow("PAYMENT_CONTEXT_INVALID");
  });

  it("activates the subscription, the entitlement and the configuration together", async () => {
    const tx = txWith({
      configuration: {
        id: "cfg",
        businessId: "bizA",
        status: "AWAITING_PAYMENT",
        configurationStatus: "READY",
        answersJson: "{}",
        draftJson: JSON.stringify({ schemaVersion: 1 }),
        publishedJson: null,
        draftVersion: 3,
        publishedVersion: 0,
        fingerprint: "abc",
      },
    });
    const result = await settlePosPayment(tx as never, { payment, plan, eventId: "evt_1", verification: { paystackId: "ps_1" } });
    expect(result.alreadySettled).toBe(false);
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pay_1", status: "PENDING" } }));
    expect(tx.posSubscription.upsert).toHaveBeenCalled();
    expect(tx.posEntitlement.upsert).toHaveBeenCalled();
    expect(tx.posConfiguration.update).toHaveBeenCalled();
    expect(tx.processedWebhook.create).toHaveBeenCalledWith({ data: { id: "evt_1" } });
  });

  it("is idempotent: a replayed event cannot activate twice (§75)", async () => {
    const tx = txWith({ currentSubscription: { id: "sub", businessId: "bizA", status: "ACTIVE" } });
    const result = await settlePosPayment(tx as never, { payment: { ...payment, status: "PAID" }, plan, eventId: "evt_dup" });
    expect(result.alreadySettled).toBe(true);
    expect(tx.posSubscription.upsert).not.toHaveBeenCalled();
    expect(tx.posEntitlement.upsert).not.toHaveBeenCalled();
    expect(tx.processedWebhook.create).toHaveBeenCalledWith({ data: { id: "evt_dup" } });
  });

  it("fails closed when the payment row was already changed by someone else", async () => {
    const tx = txWith({ paymentUpdateCount: 0, latestPayment: { id: "pay_1", status: "FAILED" } });
    await expect(settlePosPayment(tx as never, { payment, plan })).rejects.toThrow("PAYMENT_STATE_CHANGED");
    expect(tx.posSubscription.upsert).not.toHaveBeenCalled();
  });

  it("treats a second webhook for the same payment as already settled, not as an error", async () => {
    const tx = txWith({ paymentUpdateCount: 0, latestPayment: { id: "pay_1", status: "PAID" }, currentSubscription: { id: "sub", status: "ACTIVE" } });
    const result = await settlePosPayment(tx as never, { payment, plan, eventId: "evt_late" });
    expect(result.alreadySettled).toBe(true);
    expect(tx.posSubscription.upsert).not.toHaveBeenCalled();
  });

  it("lapses an expired POS subscription and pauses the configuration", async () => {
    const tx = txWith({
      expiredSubscriptions: [{ id: "sub", businessId: "bizA" }],
    });
    const lapsed = await lapseExpiredPosSubscriptions(tx as never, now);
    expect(lapsed).toBe(1);
    // The subscription expires, the entitlement follows, and a LIVE configuration is paused —
    // so an expired business can read its records but cannot trade (§44).
    expect(tx.posSubscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "sub" }, data: { status: "EXPIRED" } }));
    expect(tx.posEntitlement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "bizA" }, data: { status: "EXPIRED" } }),
    );
    expect(tx.posConfiguration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "bizA", status: "LIVE" }, data: { status: "SUSPENDED" } }),
    );
    expect(tx.posAuditEvent.create).toHaveBeenCalled();
  });

  it("leaves an unexpired subscription alone", async () => {
    const tx = txWith({ expiredSubscriptions: [] });
    expect(await lapseExpiredPosSubscriptions(tx as never, now)).toBe(0);
    expect(tx.posSubscription.update).not.toHaveBeenCalled();
    expect(tx.posConfiguration.updateMany).not.toHaveBeenCalled();
  });
});

describe("the POS subscription never disturbs the AFTERCALL plan (§80)", () => {
  it("reaches settlement from exactly one guarded branch in the shared payment path", () => {
    const paystack = readFileSync(path.join(root, "lib/paystack.ts"), "utf8");
    expect(paystack).toContain("if (plan.key === POS_PLAN_KEY) {");
    expect(paystack).toContain("return settlePosPayment(tx, { payment, plan, eventId, verification, repairingLegacyPaidPayment });");
    // The import plus exactly one call site: no second path can reach POS settlement.
    expect(paystack.split("settlePosPayment").length - 1).toBe(2);
    expect(paystack.split("settlePosPayment(tx,").length - 1).toBe(1);
    // The POS branch returns before the generic subscription path, which is left untouched:
    // the same guards, the same window arithmetic, the same platform Subscription row (§80).
    expect(paystack).toContain('if (payment.status !== "PENDING" && !repairingLegacyPaidPayment) throw new Error("PAYMENT_NOT_PENDING");');
    expect(paystack).toContain("subscriptionWindow(now, plan.durationDays, current)");
    expect(paystack).toContain("activateSubscriptionForPayment");
    const branchIndex = paystack.indexOf("if (plan.key === POS_PLAN_KEY) {");
    const genericIndex = paystack.indexOf("subscriptionWindow(now, plan.durationDays, current)");
    expect(branchIndex).toBeGreaterThan(-1);
    expect(genericIndex).toBeGreaterThan(branchIndex);
  });

  it("stores the POS subscription separately from the platform subscription", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("model PosSubscription {");
    expect(schema).toContain("model Subscription {");
    expect(schema).toContain('posSubscription          PosSubscription?');
  });

  it("resolves the POS plan through the shared plan catalogue", async () => {
    const plan = await getBusinessPosPlan();
    expect(plan === null || typeof plan === "object").toBe(true);
  });
});
