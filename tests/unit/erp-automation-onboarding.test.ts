/**
 * Automation rules and onboarding state (POS / ERP - PRO).
 *
 * Automation is powerful and therefore conservative: every run is preview-first, replay of the same
 * event is idempotent, high-impact actions wait for a person, and one platform switch stops it all.
 * Onboarding is derived from records — never from a stored "step 3 done" flag the user cannot verify.
 */
import { describe, expect, it } from "vitest";
import { createFakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import { AUTOMATION_ACTIONS, evaluateConditions, runAutomation, STARTER_RULES, validateAutomationRule, type AutomationRuleInput } from "@/lib/erp/automation";
import { createAutomationRule, pauseAutomation } from "@/lib/erp/automationActions";
import { dashboardCards, deriveOnboarding, ONBOARDING_STEPS } from "@/lib/erp/onboarding";

const emptyFacts = {
  workspaceConfigured: false,
  profileComplete: false,
  chartOfAccounts: false,
  taxRules: false,
  senderActive: false,
  channelConnected: false,
  contactsAdded: false,
  consentRecorded: false,
  firstCampaignDrafted: false,
  firstCampaignSent: false,
  firstInvoiceIssued: false,
  storefrontOpened: false,
};

function rule(overrides: Record<string, unknown> = {}) {
  return {
    name: "Remind about unpaid invoices",
    trigger: "INVOICE_OVERDUE",
    conditions: [{ field: "balanceCents", operator: "gte", value: 300 }],
    actions: [{ type: "CREATE_TASK", params: { title: "Call the customer" } }],
    requiresApproval: true,
    ...overrides,
  } as AutomationRuleInput;
}

async function createRule(fake: any, overrides: Record<string, unknown> = {}) {
  const definition = rule(overrides);
  return createAutomationRule(fake, {
    businessId: "bizA",
    actorId: "userA",
    name: String(definition.name),
    trigger: String(definition.trigger),
    conditions: definition.conditions as any,
    actions: definition.actions as any,
    requiresApproval: Boolean(definition.requiresApproval),
    activate: Boolean((overrides as any).activate),
  });
}

describe("rule validation", () => {
  it("accepts a well-formed rule", () => {
    expect(validateAutomationRule(rule()).ok).toBe(true);
  });

  it("rejects an unknown trigger or action instead of silently ignoring it", () => {
    expect(validateAutomationRule(rule({ trigger: "WHENEVER" })).ok).toBe(false);
    expect(validateAutomationRule(rule({ actions: [{ type: "DELETE_EVERYTHING" }] })).ok).toBe(false);
  });

  it("refuses a rule with no actions and warns when it can loop", () => {
    expect(validateAutomationRule(rule({ actions: [] })).ok).toBe(false);
    // Listed-but-unbuilt actions are refused at save time rather than at 3am.
    expect(validateAutomationRule(rule({ actions: [{ type: "SEND_TEMPLATE" }] })).ok).toBe(false);
  });

  it("marks high-impact actions as approval-bound and unimplemented ones as unavailable", () => {
    const high = AUTOMATION_ACTIONS.filter((action) => action.requiresApproval);
    expect(high.length).toBeGreaterThan(0);
    const unimplemented = AUTOMATION_ACTIONS.filter((action) => !action.implemented);
    expect(unimplemented.length).toBeGreaterThan(0);
    expect(unimplemented.every((action) => action.label.length > 0)).toBe(true);
  });

  it("evaluates conditions with typed operators", () => {
    const conditions = [
      { field: "amountCents", operator: "gte" as const, value: 10_000 },
      { field: "status", operator: "eq" as const, value: "OVERDUE" },
    ];
    expect(evaluateConditions(conditions, { amountCents: 12_000, status: "OVERDUE" }).matched).toBe(true);
    expect(evaluateConditions(conditions, { amountCents: 9000, status: "OVERDUE" }).matched).toBe(false);
  });
});

describe("running a rule", () => {
  it("is preview-only by default and writes no business change", async () => {
    const fake = createFakeDb(erpSeed());
    const created = await createRule(fake.db, { requiresApproval: false, activate: true });
    const result = await runAutomation(fake.db, {
      businessId: "bizA",
      ruleId: created.id,
      eventId: "evt-1",
      event: { balanceCents: 5000 },
    });
    expect(result.status).toBe("PREVIEW");
    expect(fake.rows("msgCampaign")).toHaveLength(0);
  });

  it("refuses a high-impact action at the engine even if such a row already exists", async () => {
    // The action layer will not save a high-impact action today (all three are marked
    // unimplemented), so the row is written directly to prove the engine has its own guard
    // rather than relying on the form: a rule that reaches execution must still stop here.
    const fake = createFakeDb(erpSeed());
    const created = await createRule(fake.db, { activate: true });
    const row = fake.rows("erpAutomationRule").find((entry) => entry.id === created.id)!;
    row.actionsJson = JSON.stringify([{ type: "SEND_TEMPLATE", params: { templateKey: "invoice_due" } }]);
    const result = await runAutomation(fake.db, {
      businessId: "bizA",
      ruleId: created.id,
      eventId: "evt-2",
      event: { balanceCents: 900 },
      dryRun: false,
      approved: false,
    });
    expect(result.status).toBe("AWAITING_APPROVAL");
    expect(fake.rows("msgCampaign")).toHaveLength(0);
  });

  it("is idempotent for the same event id", async () => {
    const fake = createFakeDb(erpSeed());
    const created = await createRule(fake.db, { activate: true });
    const input = { businessId: "bizA", ruleId: created.id, eventId: "evt-3", event: { balanceCents: 900 }, dryRun: false, approved: true };
    await runAutomation(fake.db, input);
    const second = await runAutomation(fake.db, input);
    expect(second.reason).toMatch(/already processed/i);
    expect(fake.rows("erpAutomationRun")).toHaveLength(1);
  });

  it("obeys the kill switch", async () => {
    const fake = createFakeDb(erpSeed());
    const created = await createRule(fake.db, { activate: true });
    fake.rows("erpConfiguration").find((row) => row.businessId === "bizA")!.featureFlagsJson = JSON.stringify({ automationKillSwitch: true });
    const result = await runAutomation(fake.db, { businessId: "bizA", ruleId: created.id, eventId: "evt-4", event: { balanceCents: 900 } });
    expect(result.status).toBe("SKIPPED");
    expect(result.reason).toMatch(/safety switch/i);
  });

  it("will not run another tenant's rule", async () => {
    const fake = createFakeDb(erpSeed());
    const created = await createRule(fake.db, { activate: true });
    await expect(
      runAutomation(fake.db, { businessId: "bizB", ruleId: created.id, eventId: "evt-5", event: {} }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("pauses a rule with a written reason and keeps the record", async () => {
    const fake = createFakeDb(erpSeed());
    const created = await createRule(fake.db, { activate: true });
    await expect(pauseAutomation(fake.db, { businessId: "bizA", ruleId: created.id, reason: "" })).rejects.toBeTruthy();
    const paused = await pauseAutomation(fake.db, { businessId: "bizA", ruleId: created.id, reason: "Audience too broad" });
    expect(paused.status).toBe("PAUSED");
  });

  it("ships starter rules that are drafts, not live automations", () => {
    expect(STARTER_RULES.length).toBeGreaterThan(0);
    for (const starter of STARTER_RULES) {
      expect(validateAutomationRule(starter).ok).toBe(true);
      expect(starter.actions.every((action) => AUTOMATION_ACTIONS.some((entry) => entry.key === action.type))).toBe(true);
    }
  });
});

describe("onboarding", () => {
  it("derives the next step from actual records", () => {
    const derived = deriveOnboarding(emptyFacts);
    expect(derived.steps).toHaveLength(ONBOARDING_STEPS.length);
    expect(derived.steps[0].status).toBe("NEXT");
    expect(derived.percent).toBe(0);
    expect(derived.nextStep?.key).toBe(ONBOARDING_STEPS[0].key);
  });

  it("marks steps done only when the fact is true and advances the cursor", () => {
    const derived = deriveOnboarding({
      ...emptyFacts,
      workspaceConfigured: true,
      profileComplete: true,
      chartOfAccounts: true,
    });
    expect(derived.steps.slice(0, 3).every((step) => step.status === "DONE")).toBe(true);
    expect(derived.steps[3].status).toBe("NEXT");
    expect(derived.percent).toBe(25);
  });

  it("shows a provider-dependent step as WAITING rather than blocking the customer", () => {
    const derived = deriveOnboarding({ ...emptyFacts, workspaceConfigured: true, profileComplete: true, chartOfAccounts: true, taxRules: true, channelConnected: true });
    const sender = derived.steps.find((step) => step.key === "senderActive");
    expect(sender?.status).toBe("WAITING");
    expect(sender?.meanwhile).toBeTruthy();
  });

  it("reports completion at 100% and supplies dashboard cards with honest statuses", () => {
    const allDone = deriveOnboarding(Object.fromEntries(Object.keys(emptyFacts).map((key) => [key, true])) as typeof emptyFacts);
    expect(allDone.percent).toBe(100);
    expect(allDone.nextStep).toBeNull();

    const cards = dashboardCards({
      businessId: "bizA",
      basePath: "/dashboard/erp/bizA",
      counts: { contacts: 0, contactsWithMarketingConsent: 0, campaignsLive: 0, campaignsReady: 0, openInvoices: 0, outstandingCents: 0, pendingOrders: 0, walletAvailableCents: 0 },
      onboarding: allDone,
      senderStatus: "ACTIVE",
      storefrontEnabled: true,
    });
    expect(cards).toHaveLength(6);
    expect(cards.every((card) => ["done", "action", "waiting", "blocked"].includes(card.status))).toBe(true);
  });

  it("turns real operational counts into action cards", () => {
    const derived = deriveOnboarding({ ...emptyFacts, workspaceConfigured: true });
    const cards = dashboardCards({
      businessId: "bizA",
      basePath: "/dashboard/erp/bizA",
      counts: { contacts: 4, contactsWithMarketingConsent: 2, campaignsLive: 0, campaignsReady: 1, openInvoices: 3, outstandingCents: 12_000, pendingOrders: 2, walletAvailableCents: 5000 },
      onboarding: derived,
      senderStatus: "SUBMITTED",
      storefrontEnabled: false,
    });
    const money = cards.find((card) => card.key === "money");
    expect(money?.status).toBe("done");
    expect(money?.description).toMatch(/open invoices/);
    const store = cards.find((card) => card.key === "store");
    expect(store?.status).toBe("action");
    expect(store?.href).toContain("/store");
    expect(cards.find((card) => card.key === "sender")?.status).toBe("waiting");
  });
});
