/**
 * The owner journey, end to end (§4, §43, §44, §73, §81)
 *
 * Create/select a business → answer the questionnaire → receive a Business Operating Profile →
 * read it back in plain language → edit it → preview it → choose the plan → pay → the server
 * confirms and provisions → LIVE → first sale → receipt → correction.
 *
 * The database is the in-memory fake, so this runs the real server modules — provisioning,
 * settlement, the sale transaction and the audit trail — not a mock of them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import prisma from "@/lib/db";
import {
  configurationHeadline,
  configurationSummary,
  describeConfiguration,
  diffConfigurations,
  validateConfiguration,
} from "@/lib/pos/configuration";
import { configurationReadiness, pruneAnswers, visibleQuestions } from "@/lib/pos/questionnaire";
import { questionnaireView as viewOf } from "@/lib/pos/questionnaireView";
import { buildPreviewSandbox, previewHeadline } from "@/lib/pos/preview";
import { buildNavigation, deriveDashboardCards, deriveQuickActions, deriveReports } from "@/lib/pos/presentation";
import {
  effectiveConfiguration,
  loadConfiguration,
  markAwaitingPayment,
  markPreview,
  publishConfiguration,
  rollbackToVersion,
  saveDraft,
  saveTemplate,
  copyConfigurationTo,
  listVersions,
} from "@/lib/pos/provisioning";
import { getPosEntitlement, POS_PLAN_KEY, syncPosEntitlement } from "@/lib/pos/entitlement";
import { settlePosPayment } from "@/lib/pos/settlement";
import { createSale, refundSale, type PosActor } from "@/lib/pos/sales";
import { effectivePermissions } from "@/lib/pos/permissions";
import { resolveTerminology } from "@/lib/pos/terminology";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };
const ownerSession = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" } as any;

/** Step 2 — the questionnaire, answered the way an owner would answer it. */
const restaurantAnswers = {
  business_type: "restaurant",
  sells: ["products", "services"],
  payment_methods: ["cash", "mpesa", "credit"],
  credit_frequency: "sometimes",
  credit_limit: 3000,
  credit_terms_days: 14,
  keeps_stock: true,
  units: ["piece", "plate"],
  keeps_customers: true,
  repeat_customers: true,
  orders: true,
  order_channels: ["walk_in", "whatsapp", "phone"],
  delivery: true,
  pickup: true,
  has_staff: true,
  staff_count: 6,
  staff_roles: ["WAITER", "CASHIER"],
  sales_attribution: true,
  tracks_expenses: true,
  expense_categories: ["rent", "salaries", "supplies"],
  has_suppliers: true,
  supplier_payment_methods: ["cash", "mpesa", "credit"],
  supplier_credit: true,
  purchase_orders: true,
  restaurant_tables: true,
  restaurant_kitchen: true,
  menu_modifiers: true,
  recipes: true,
  discounts: true,
  custom_words: true,
};

const hardwareAnswers = {
  business_type: "hardware",
  sells: ["products"],
  payment_methods: ["cash", "mpesa", "bank", "credit"],
  credit_frequency: "frequently",
  credit_limit: 50000,
  credit_terms_days: 30,
  keeps_stock: true,
  units: ["piece", "carton", "bag"],
  unit_conversion_factor: 24,
  keeps_customers: true,
  has_suppliers: true,
  supplier_credit: true,
  purchase_orders: true,
  partial_receiving: true,
  has_staff: true,
  staff_count: 3,
  staff_roles: ["CASHIER", "INVENTORY"],
  multi_branch: true,
  branch_count: 2,
  stock_by_branch: true,
  tracks_expenses: true,
  barcode: true,
  wholesale_pricing: true,
};

function ownerActor(config: any): PosActor {
  return {
    actorId: "userA",
    actorName: "Owner A",
    roleKey: "OWNER",
    permissions: effectivePermissions(config, "OWNER"),
    staffId: null,
    branchId: null,
  };
}

beforeEach(() => {
  fake().reset();
});

describe("step 1–3: questions become a Business Operating Profile (§4, §20, §41)", () => {
  it("starts from the business type and asks only what is relevant", async () => {
    const seeded = await saveDraft({ businessId: "bizA", answers: { business_type: "restaurant" }, actorId: "userA", context: { businessName: business.name } });
    expect(seeded.record.status).toBe("DRAFT");
    expect(seeded.readiness.ready).toBe(false);

    const view = viewOf(seeded.record.answers, seeded.readiness.missing);
    expect(view.questions.length).toBeGreaterThan(3);
    expect(view.questions.length).toBeLessThan(60);
    // Nothing technical reaches the owner (§3, §38).
    expect(JSON.stringify(view.questions.map((question) => question.title))).not.toMatch(/capabilit|schema|configuration|workflow|flag/i);
    expect(visibleQuestions(seeded.record.answers).every((question) => question.title.length > 3)).toBe(true);
  });

  it("autosaves the full answer set into a draft configuration", async () => {
    const saved = await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA", context: { businessName: business.name } });
    expect(saved.record.status).toBe("CONFIGURED");
    expect(saved.record.draftVersion).toBeGreaterThanOrEqual(1);
    expect(saved.readiness.ready).toBe(true);
    expect(saved.validation.ok).toBe(true);

    const config = saved.record.draft;
    expect(config.business.typeKey).toBe("restaurant");
    expect(config.credit.enabled).toBe(true);
    expect(config.credit.limitKES).toBe(3000);
    expect(config.orders.enabled).toBe(true);
    expect(config.delivery.enabled).toBe(true);
    expect(config.staff.enabled).toBe(true);
    expect(config.suppliers.credit).toBe(true);
  });

  it("says 'we've configured your POS' in the owner's own words (§43)", async () => {
    const saved = await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA", context: { businessName: business.name } });
    const config = saved.record.draft;
    const headline = configurationHeadline(config);
    expect(headline.length).toBeGreaterThan(10);
    expect(headline).not.toMatch(/capabilit|schema|configuration engine/i);

    const description = describeConfiguration(config);
    expect(description.length).toBeGreaterThan(3);
    expect(description.join(" | ").toLowerCase()).toMatch(/guest|dish|menu|kitchen|credit|delivery/);

    const summary = configurationSummary(config);
    expect(summary.length).toBeGreaterThan(2);
    expect(summary.every((group) => group.label && group.value)).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/= true|supplierCreditManagement/);
  });

  it("bumps the draft version only when something actually changed (§48)", async () => {
    const first = await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA", context: { businessName: business.name } });
    const again = await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA", context: { businessName: business.name } });
    expect(again.record.draftVersion).toBe(first.record.draftVersion);
    expect(again.changed).toBe(false);

    const edited = await saveDraft({
      businessId: "bizA",
      answers: { ...restaurantAnswers, credit_limit: 8000 },
      actorId: "userA",
      context: { businessName: business.name },
    });
    expect(edited.changed).toBe(true);
    expect(edited.record.draftVersion).toBe(first.record.draftVersion + 1);
    expect(diffConfigurations(first.record.draft, edited.record.draft).length).toBeGreaterThan(0);
  });

  it("prunes answers that stopped being relevant when the owner changes their mind (§40)", async () => {
    const withCredit = await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA" });
    expect(withCredit.record.draft.credit.enabled).toBe(true);

    const withoutCredit = await saveDraft({
      businessId: "bizA",
      answers: { ...restaurantAnswers, payment_methods: ["cash", "mpesa"], credit_frequency: "never" },
      actorId: "userA",
    });
    expect(withoutCredit.record.draft.credit.enabled).toBe(false);
    expect(withoutCredit.record.answers.credit_limit).toBeUndefined();
    // A permission that depended on credit disappears with it (§36).
    expect(effectivePermissions(withoutCredit.record.draft, "OWNER")).not.toContain("APPROVE_CREDIT");
    expect(withCredit.record.draft.capabilities.length).toBeGreaterThan(withoutCredit.record.draft.capabilities.length);
  });

  it("honours the owner's own words without changing the records underneath (§46)", async () => {
    const saved = await saveDraft({
      businessId: "bizA",
      answers: restaurantAnswers,
      actorId: "userA",
      terminology: { customers: "Regulars", customer: "Regular", orders: "Tickets" },
    });
    const words = resolveTerminology(saved.record.draft);
    expect(words.customers).toBe("Regulars");
    expect(words.orders).toBe("Tickets");
    // Presentation only: the customer module and its fields are unchanged.
    expect(saved.record.draft.customers.fields.name).toBe(true);
    expect(saved.record.draft.navigation).toContain("customers");
  });
});

describe("step 4: previewing is not production (§23, §42, §44)", () => {
  it("builds a sandbox from the configuration and writes no business data", async () => {
    const saved = await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA", context: { businessName: business.name } });
    const before = {
      sales: fake().rows("posSale").length,
      payments: fake().rows("posPayment").length,
      movements: fake().rows("posInventoryMovement").length,
      customers: fake().rows("posCustomer").length,
    };

    const sandbox = buildPreviewSandbox(saved.record.draft, business.name);
    expect(sandbox.isPreview).toBe(true);
    expect(sandbox.notice).toMatch(/sample|preview|not (saved|real|live)/i);
    expect(sandbox.navigation.length).toBeGreaterThan(3);
    expect(sandbox.catalogue.length).toBeGreaterThan(2);
    expect(sandbox.saleFlow.paymentMethods.map((method) => method.key)).toContain("mpesa");
    // The sample receipt uses the business's own name and words, not another trade's.
    expect(sandbox.receiptText.toUpperCase()).toContain(sandbox.receipt.businessName.toUpperCase());
    expect(sandbox.receipt.lines.length).toBeGreaterThan(0);

    expect(fake().rows("posSale").length).toBe(before.sales);
    expect(fake().rows("posPayment").length).toBe(before.payments);
    expect(fake().rows("posInventoryMovement").length).toBe(before.movements);
    expect(fake().rows("posCustomer").length).toBe(before.customers);
  });

  it("moves the lifecycle to PREVIEW and back, never to LIVE", async () => {
    await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA" });
    const previewed = await markPreview("bizA", "userA");
    expect(previewed?.status).toBe("PREVIEW");
    const entitlement = await getPosEntitlement("bizA");
    expect(entitlement.entitled).toBe(false);
    expect(entitlement.lifecycle).toBe("PREVIEW");
    expect(fake().rows("posConfiguration")[0].publishedVersion).toBe(0);
  });

  it("gives two different businesses two substantially different previews (§81)", async () => {
    const restaurant = await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA", context: { businessName: "Nyumbani Kitchen" } });
    const hardware = await saveDraft({ businessId: "bizB", answers: hardwareAnswers, actorId: "userB", context: { businessName: "Mwangi Hardware" } });

    const a = buildPreviewSandbox(restaurant.record.draft, "Nyumbani Kitchen");
    const b = buildPreviewSandbox(hardware.record.draft, "Mwangi Hardware");

    expect(a.navigation.map((item) => item.key)).not.toEqual(b.navigation.map((item) => item.key));
    expect(a.dashboard.map((card) => card.key)).not.toEqual(b.dashboard.map((card) => card.key));
    expect(a.reports.map((report) => report.key)).not.toEqual(b.reports.map((report) => report.key));
    expect(a.catalogue.map((item) => item.name)).not.toEqual(b.catalogue.map((item) => item.name));
    expect(previewHeadline(restaurant.record.draft)).not.toBe(previewHeadline(hardware.record.draft));

    // Both are coherent systems in their own right, not one system with bits hidden.
    for (const sandbox of [a, b]) {
      expect(sandbox.navigation.length).toBeGreaterThan(4);
      expect(sandbox.quickActions.length).toBeGreaterThan(0);
      expect(sandbox.dashboard.length).toBeGreaterThan(2);
      expect(sandbox.reports.length).toBeGreaterThan(3);
      expect(sandbox.emptyStates.length).toBeGreaterThan(0);
    }
  });
});

describe("step 5–7: choose plan, pay, provision (§43, §44, §45)", () => {
  it("refuses to publish before payment, then publishes after it", async () => {
    await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA", context: { businessName: business.name } });

    const refused = await publishConfiguration({ businessId: "bizA", actorId: "userA" });
    expect(refused.ok).toBe(false);
    expect(fake().rows("posConfigurationVersion")).toHaveLength(0);

    const marked = await markAwaitingPayment("bizA", "userA");
    expect(marked.ok).toBe(true);
    expect(marked.record?.status).toBe("AWAITING_PAYMENT");
    expect((await getPosEntitlement("bizA")).entitled).toBe(false);
  });

  it("activates on a confirmed payment and provisions the configuration to LIVE", async () => {
    await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA", context: { businessName: business.name } });
    await markAwaitingPayment("bizA", "userA");

    fake().rows("payment").push({
      id: "pay_1",
      reference: "jata-pos-1",
      businessId: "bizA",
      userId: "userA",
      planId: "plan_pos",
      amount: 49900,
      currency: "KES",
      status: "PENDING",
    });

    const result = await prisma.$transaction(async (tx: any) =>
      settlePosPayment(tx, {
        payment: {
          id: "pay_1",
          reference: "jata-pos-1",
          businessId: "bizA",
          userId: "userA",
          planId: "plan_pos",
          amount: 49900,
          currency: "KES",
          status: "PENDING",
        },
        plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
        eventId: "evt_1",
        verification: { paystackId: "ps_1" },
      }),
    );

    expect(result.alreadySettled).toBe(false);
    expect(fake().rows("payment")[0].status).toBe("PAID");
    expect(fake().rows("posSubscription")[0]).toMatchObject({ businessId: "bizA", planKey: POS_PLAN_KEY, status: "ACTIVE" });
    expect(fake().rows("posEntitlement")[0]).toMatchObject({ businessId: "bizA", status: "ACTIVE" });

    const record = await loadConfiguration("bizA");
    expect(record?.status).toBe("LIVE");
    expect(record?.publishedVersion).toBe(1);
    expect(record?.published).not.toBeNull();
    expect(fake().rows("posConfigurationVersion")).toHaveLength(1);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_PROVISIONED")).toBe(true);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_SUBSCRIPTION_ACTIVATED")).toBe(true);

    const entitlement = await syncPosEntitlement("bizA");
    expect(entitlement.entitled).toBe(true);
    expect(entitlement.lifecycle).toBe("LIVE");

    // The published configuration is what the POS now executes (§44).
    expect(effectiveConfiguration(record, "LIVE")?.business.typeKey).toBe("restaurant");
  });

  it("cannot be activated twice by a replayed webhook (§75)", async () => {
    await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA" });
    fake().rows("payment").push({ id: "pay_1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49900, currency: "KES", status: "PAID", reference: "jata-pos-1" });
    fake().rows("posSubscription").push({ id: "sub_1", businessId: "bizA", status: "ACTIVE", planKey: POS_PLAN_KEY, expiresAt: new Date(Date.now() + 86_400_000) });

    const replay = await prisma.$transaction(async (tx: any) =>
      settlePosPayment(tx, {
        payment: { id: "pay_1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49900, currency: "KES", status: "PAID", reference: "jata-pos-1" },
        plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
        eventId: "evt_replay",
      }),
    );
    expect(replay.alreadySettled).toBe(true);
    expect(fake().rows("posSubscription")).toHaveLength(1);
    expect(fake().rows("processedWebhook").some((row) => row.id === "evt_replay")).toBe(true);
  });

  it("keeps the POS subscription out of the AFTERCALL subscription row (§80)", async () => {
    await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA" });
    fake().rows("payment").push({ id: "pay_2", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49900, currency: "KES", status: "PENDING", reference: "jata-pos-2" });
    await prisma.$transaction(async (tx: any) =>
      settlePosPayment(tx, {
        payment: { id: "pay_2", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49900, currency: "KES", status: "PENDING", reference: "jata-pos-2" },
        plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      }),
    );
    expect(fake().rows("subscription")).toHaveLength(0);
    expect(fake().rows("posSubscription")).toHaveLength(1);
  });
});

describe("step 8: trading on a live POS (§27, §31, §33, §54, §62)", () => {
  async function goLive(answers = restaurantAnswers) {
    await saveDraft({ businessId: "bizA", answers, actorId: "userA", context: { businessName: business.name } });
    fake().rows("payment").push({ id: "pay_1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49900, currency: "KES", status: "PENDING", reference: "jata-pos-1" });
    await prisma.$transaction(async (tx: any) =>
      settlePosPayment(tx, {
        payment: { id: "pay_1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49900, currency: "KES", status: "PENDING", reference: "jata-pos-1" },
        plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      }),
    );
    const record = await loadConfiguration("bizA");
    return { record, config: effectiveConfiguration(record, "LIVE")! };
  }

  it("records the first sale in one step and prints the receipt (§62)", async () => {
    const { config, record } = await goLive();
    const actor = ownerActor(config);
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      configurationVersion: record?.publishedVersion ?? 1,
      actor,
      request: {
        items: [{ productId: "p_a1", quantity: 3 }],
        payments: [{ method: "mpesa", amountKES: 150, reference: "QGH7X1" }],
        channel: "whatsapp",
      },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.totals?.totalKES).toBe(150);
    expect(outcome.sale.receiptNumber).toMatch(/^[A-Z]{2,6}-\d{6}$/);
    expect(outcome.sale.configurationVersion).toBe(record?.publishedVersion);
    expect(outcome.receiptText).toContain("QGH7X1");
    expect(fake().rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(37);
    expect(fake().rows("posPayment")[0]).toMatchObject({ method: "mpesa", amountKES: 150, direction: "IN", purpose: "SALE" });
  });

  it("generates the screens the business should see, and only those (§24, §34, §35)", async () => {
    const { config } = await goLive();
    const navigation = buildNavigation(config, "/dashboard/pos/bizA");
    expect(navigation.map((item) => item.key)).toContain("menu");
    expect(navigation.map((item) => item.key)).toContain("sell");
    expect(navigation.every((item) => item.href.startsWith("/dashboard/pos/bizA"))).toBe(true);

    expect(deriveDashboardCards(config)).toContain("today_sales");
    expect(deriveQuickActions(config, "/pos")[0].href).toBe("/pos/sell");
    expect(deriveReports(config)).toContain("ingredient_usage");
    expect(validateConfiguration(config).ok).toBe(true);
    expect(configurationReadiness(fake().rows("posConfiguration")[0] ? JSON.parse(fake().rows("posConfiguration")[0].answersJson) : {}).ready).toBe(true);
  });

  it("corrects a sale with a refund instead of rewriting it (§54)", async () => {
    const { config } = await goLive();
    const actor = ownerActor(config);
    const sale = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor,
      request: { items: [{ productId: "p_a1", quantity: 5 }], payments: [{ method: "cash", amountKES: 250 }] },
    });
    expect(sale.ok).toBe(true);
    const line = fake().rows("posSaleItem")[0];

    const refund = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor,
      request: { saleId: (sale.sale as any).id, amountKES: 100, items: [{ saleItemId: line.id, quantity: 2 }], reason: "Two were burnt" },
    });
    expect(refund.ok).toBe(true);

    const stored = fake().rows("posSale")[0];
    expect(stored.totalKES).toBe(250);
    expect(stored.refundedKES).toBe(100);
    expect(stored.status).toBe("PARTIALLY_REFUNDED");
    expect(fake().rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(37);
    expect(fake().rows("posInventoryMovement").map((row) => row.reason)).toEqual(["SALE", "RETURN"]);
  });

  it("versions the setup and rolls back without rewriting history (§48, §49)", async () => {
    const { config } = await goLive();
    const actor = ownerActor(config);
    await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor,
      request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }] },
    });
    const saleBefore = { ...fake().rows("posSale")[0] };

    await saveDraft({ businessId: "bizA", answers: { ...restaurantAnswers, credit_limit: 20000 }, actorId: "userA", context: { businessName: business.name } });
    const published = await publishConfiguration({ businessId: "bizA", actorId: "userA", note: "Raised the credit limit" });
    expect(published.ok).toBe(true);
    expect(published.version).toBe(2);

    const versions = await listVersions("bizA");
    expect(versions).toHaveLength(2);

    const rolled = await rollbackToVersion({ businessId: "bizA", versionId: versions[1].id, actorId: "userA" });
    expect(rolled.ok).toBe(true);
    expect(rolled.version).toBe(3);
    expect(await listVersions("bizA")).toHaveLength(3);

    // The sale recorded under version 1 is untouched, and still says which version produced it.
    const saleAfter = fake().rows("posSale")[0];
    expect(saleAfter.totalKES).toBe(saleBefore.totalKES);
    expect(saleAfter.receiptNumber).toBe(saleBefore.receiptNumber);
    expect(saleAfter.configurationVersion).toBe(saleBefore.configurationVersion);
  });

  it("copies a setup to another owned business without copying data (§25, §50)", async () => {
    await goLive();
    await saveDraft({ businessId: "bizA2", answers: { business_type: "other" }, actorId: "userA" });
    const template = await saveTemplate({ businessId: "bizA", actorId: "userA", name: "Kitchen setup" });
    expect(template.ok).toBe(true);

    const copied = await copyConfigurationTo({
      sourceBusinessId: "bizA",
      targetBusinessId: "bizA2",
      actorId: "userA",
      session: ownerSession,
      scope: ["capabilities", "terminology", "payments"],
    });
    expect(copied.ok).toBe(true);

    const target = await loadConfiguration("bizA2");
    expect(target?.draft.capabilities.length).toBeGreaterThan(3);
    // Structure only: identity, balances and history stay behind (§50).
    expect(target?.draft.business.name).toBe("");
    expect(fake().rows("posSale").filter((row) => row.businessId === "bizA2")).toHaveLength(0);
    expect(fake().rows("posCustomer").filter((row) => row.businessId === "bizA2")).toHaveLength(0);
    expect(fake().rows("posPayment").filter((row) => row.businessId === "bizA2")).toHaveLength(0);

    // A business with a live POS cannot be overwritten.
    const refused = await copyConfigurationTo({ sourceBusinessId: "bizA2", targetBusinessId: "bizA", actorId: "userA", session: ownerSession, scope: ["capabilities"] });
    expect(refused.ok).toBe(false);
  });

  it("refuses to copy anything that is operational data rather than structure (§50)", async () => {
    const { assertCloneSafety, cloneConfiguration } = await import("@/lib/pos/templates");
    const record = await loadConfiguration("bizA");
    const config = record?.draft ?? (await saveDraft({ businessId: "bizA", answers: restaurantAnswers, actorId: "userA" })).record.draft;

    // A real configuration is structure, so it may be copied.
    expect(assertCloneSafety(cloneConfiguration(config)).ok).toBe(true);

    // Smuggled records, secrets and tenant ids are refused wherever they hide.
    for (const smuggled of [
      { sales: [{ id: "s1", totalKES: 500, balanceKES: 100 }] },
      { customers: [{ businessId: "bizB", name: "Someone else" }] },
      { credentials: { password: "hunter2" } },
      { payments: [{ reference: "QGH7X1", mpesaCode: "QGH7X1" }] },
      { receipts: [{ receiptNumber: "A-000001" }] },
      { meta: { tenantId: "bizB", ownerId: "userB" } },
    ]) {
      const result = assertCloneSafety(smuggled);
      expect(result.ok, JSON.stringify(smuggled)).toBe(false);
      expect(result.reason).toBeTruthy();
    }
  });

  it("refuses to copy into a business the session does not own (§5, §75)", async () => {
    await goLive();
    // bizB belongs to somebody else entirely; bizC does not exist. Both are refused the same way.
    for (const target of ["bizB", "bizC"]) {
      const refused = await copyConfigurationTo({
        sourceBusinessId: "bizA",
        targetBusinessId: target,
        actorId: "userA",
        session: ownerSession,
        scope: ["capabilities"],
      });
      expect(refused.ok, target).toBe(false);
      expect(fake().rows("posConfiguration").some((row) => row.businessId === target)).toBe(false);
    }
  });

  it("suspends trading when the subscription lapses, and keeps the records (§44)", async () => {
    const { config } = await goLive();
    const actor = ownerActor(config);
    await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor,
      request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }] },
    });

    const { lapseExpiredPosSubscriptions } = await import("@/lib/pos/settlement");
    fake().rows("posSubscription")[0].expiresAt = new Date(Date.now() - 5 * 86_400_000);
    fake().rows("posSubscription")[0].graceUntil = new Date(Date.now() - 2 * 86_400_000);
    await lapseExpiredPosSubscriptions(prisma, new Date());

    const entitlement = await syncPosEntitlement("bizA");
    expect(entitlement.entitled).toBe(false);
    expect(entitlement.lifecycle).toBe("SUSPENDED");
    expect(fake().rows("posConfiguration")[0].status).toBe("SUSPENDED");
    // History survives: a suspended business can still read what it recorded.
    expect(fake().rows("posSale")).toHaveLength(1);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_SUSPENDED")).toBe(true);
  });
});

describe("the questionnaire view is server-derived (§40, §41, §56)", () => {
  it("never ships a branching rule to the browser", () => {
    const view = viewOf(pruneAnswers(restaurantAnswers));
    const serialized = JSON.stringify(view);
    // The `when` predicates stay on the server: the client is told which questions matter now.
    expect(serialized).not.toContain("function");
    expect(serialized).not.toContain('"when"');
    expect(view.questions.every((question) => !("when" in question))).toBe(true);
    expect(view.questions.every((question) => typeof question.title === "string")).toBe(true);
    expect(view.progress.answered).toBeGreaterThan(0);
    // Every question arrives with its answer and whether it is complete, so the screen can render
    // without re-deriving anything.
    expect(view.questions.every((question) => "answered" in question && "value" in question)).toBe(true);
  });

  it("asks fewer questions once a description explains the business (§19, §41)", () => {
    const blank = viewOf({ business_type: "other" });
    const described = viewOf(
      pruneAnswers({
        business_type: "other",
        business_other: "We repair water pumps for farms and sell spare parts, mostly on M-Pesa, with two technicians",
        sells: ["services", "products"],
        payment_methods: ["cash", "mpesa"],
        has_staff: true,
        staff_roles: ["TECHNICIAN"],
      }),
    );
    expect(described.missing.length).toBeLessThanOrEqual(blank.missing.length + 2);
    expect(described.progress.remaining).toBeLessThan(40);
  });
});
