/**
 * Owner-selected paid-but-unpublished POS policy. These are in-memory behavioral tests, not
 * PostgreSQL or provider evidence. They drive the real settlement, publication, notification,
 * and reconciliation modules with synthetic payments only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import prisma from "@/lib/db";
import { publishConfiguration, saveDraft } from "@/lib/pos/provisioning";
import { getPosEntitlement, POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { settlePosPayment, type PosSettlementParams } from "@/lib/pos/settlement";
import {
  derivePosPublicationCaseStatus,
  posPublicationDeadline,
  posPublicationNotificationKey,
  reconcilePosPublicationDeadlines,
  resolvePosPublicationCases,
} from "@/lib/pos/publication-policy";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const CONFIRMED = new Date("2026-10-23T05:00:00.000Z");
const DEADLINE = new Date("2026-10-26T05:00:00.000Z");
const INLINE_IMAGE_URL = "data:image/png;base64,iVBORw0KGgo=";
const plan = { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 };
const answers = {
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

beforeEach(() => {
  fake().reset();
  vi.useFakeTimers();
  vi.setSystemTime(CONFIRMED);
});

afterEach(() => {
  vi.useRealTimers();
});

async function configureWithLegacyInlineMedia() {
  await saveDraft({ businessId: "bizA", answers, actorId: "userA", context: { businessName: "Nyumbani Kitchen" } });
  const row = fake().rows("posConfiguration")[0];
  const draft = JSON.parse(row.draftJson);
  draft.business.legacyLogo = INLINE_IMAGE_URL;
  row.draftJson = JSON.stringify(draft);
}

function paymentRow(): PosSettlementParams["payment"] & { createdAt: Date; updatedAt: Date } {
  return {
    id: "pay_policy_1",
    reference: "jata-pos-policy-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49900,
    currency: "KES",
    status: "PENDING",
    createdAt: new Date(CONFIRMED.getTime() - 60_000),
    updatedAt: new Date(CONFIRMED.getTime() - 60_000),
  };
}

async function settleExisting(eventId = "evt_policy_1") {
  const payment = fake().rows("payment")[0] as PosSettlementParams["payment"];
  return prisma.$transaction(async (tx: any) => settlePosPayment(tx, {
    payment,
    plan,
    eventId,
    verification: { paystackId: "ps_policy_1" },
  }));
}

async function settleBlockedPayment() {
  await configureWithLegacyInlineMedia();
  fake().rows("payment").push(paymentRow());
  const result = await settleExisting();
  expect(result.alreadySettled).toBe(false);
}

describe("72-hour deadline arithmetic", () => {
  it("uses the authoritative instant with UTC-independent arithmetic and an inclusive deadline", () => {
    const nairobiConfirmation = new Date("2026-10-23T08:00:00.000+03:00");
    expect(nairobiConfirmation.toISOString()).toBe(CONFIRMED.toISOString());
    expect(posPublicationDeadline(nairobiConfirmation).toISOString()).toBe(DEADLINE.toISOString());

    const row = { status: "OPEN", resolvedAt: null, deadlineAt: DEADLINE };
    expect(derivePosPublicationCaseStatus(row, new Date(DEADLINE.getTime() - 1))).toBe("OPEN");
    expect(derivePosPublicationCaseStatus(row, DEADLINE)).toBe("ESCALATED");
    expect(derivePosPublicationCaseStatus({ ...row, resolvedAt: DEADLINE }, DEADLINE)).toBe("RESOLVED");
  });
});

describe("paid-but-unpublished settlement and notification reconciliation", () => {
  it("preserves payment/entitlement, distinguishes publication, and never duplicates a case or remedy", async () => {
    await settleBlockedPayment();

    expect(fake().rows("payment")[0].status).toBe("PAID");
    expect(fake().rows("posEntitlement")[0].status).toBe("ACTIVE");
    expect(fake().rows("posConfiguration")[0]).toMatchObject({
      status: "PAYMENT_CONFIRMED",
      configurationStatus: "READY",
      publishedVersion: 0,
    });
    expect(fake().rows("posConfigurationVersion")).toHaveLength(0);
    expect((await getPosEntitlement("bizA")).lifecycle).toBe("PAYMENT_CONFIRMED");
    expect((await getPosEntitlement("bizA")).entitled).toBe(true);

    const cases = fake().rows("posPublicationResolution");
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      paymentId: "pay_policy_1",
      paymentReference: "jata-pos-policy-1",
      blockerCode: "INLINE_MEDIA_PERSISTENCE_BLOCKED",
      status: "OPEN",
      remedyStatus: "PENDING_PUBLICATION",
      entitlementStatus: "ACTIVE",
      confirmedAt: CONFIRMED,
      deadlineAt: DEADLINE,
      ownerNotificationQueuedAt: CONFIRMED,
      escalationNotificationScheduledAt: DEADLINE,
      resolvedAt: null,
    });
    expect(cases[0].blockerDetail).not.toContain(INLINE_IMAGE_URL);

    const notifications = fake().rows("paymentNotification");
    expect(notifications).toHaveLength(2);
    expect(notifications.map((row) => row.idempotencyKey).sort()).toEqual([
      posPublicationNotificationKey("pay_policy_1", "ESCALATION"),
      posPublicationNotificationKey("pay_policy_1", "OWNER"),
    ].sort());
    expect(notifications.every((row) => row.status === "PENDING" && row.channel === "POS")).toBe(true);
    expect(notifications.every((row) => !/refund has been initiated$/i.test(row.message))).toBe(true);

    // A different provider event retrying the same paid payment cannot move the deadline or
    // create another entitlement, publication case, notification, or remedy.
    const replay = await settleExisting("evt_policy_replay");
    expect(replay.alreadySettled).toBe(true);
    expect(fake().rows("posPublicationResolution")).toHaveLength(1);
    expect(fake().rows("posEntitlement")).toHaveLength(1);
    expect(fake().rows("paymentNotification")).toHaveLength(2);
    expect(fake().rows("posPublicationResolution")[0].deadlineAt).toEqual(DEADLINE);
  });

  it("delivers only due in-app messages, escalates once at exactly 72 hours, and tracks entitlement", async () => {
    await settleBlockedPayment();
    const beforeDeadline = new Date(DEADLINE.getTime() - 1);
    const early = await reconcilePosPublicationDeadlines({ businessId: "bizA", now: beforeDeadline });
    expect(early.newlyEscalated).toBe(0);
    expect(early.cases[0].status).toBe("OPEN");

    const ownerKey = posPublicationNotificationKey("pay_policy_1", "OWNER");
    const escalationKey = posPublicationNotificationKey("pay_policy_1", "ESCALATION");
    expect(fake().rows("paymentNotification").find((row) => row.idempotencyKey === ownerKey)).toMatchObject({ status: "SENT", sentAt: beforeDeadline });
    const pendingEscalation = fake().rows("paymentNotification").find((row) => row.idempotencyKey === escalationKey);
    expect(pendingEscalation.status).toBe("PENDING");
    expect(pendingEscalation.sentAt).toBeUndefined();

    const due = await reconcilePosPublicationDeadlines({ businessId: "bizA", now: DEADLINE });
    expect(due.newlyEscalated).toBe(1);
    expect(due.cases[0]).toMatchObject({ status: "ESCALATED", remedyStatus: "OWNER_ESCALATED", escalatedAt: DEADLINE });
    expect(fake().rows("paymentNotification").find((row) => row.idempotencyKey === escalationKey)).toMatchObject({ status: "SENT", sentAt: DEADLINE });
    expect(fake().rows("posAuditEvent").filter((row) => row.action === "POS_PUBLICATION_ESCALATED")).toHaveLength(1);
    expect(fake().rows("payment")[0].status).toBe("PAID");
    expect(fake().rows("posEntitlement")[0].status).toBe("ACTIVE");
    expect(fake().rows("refund")).toHaveLength(0);

    fake().rows("posEntitlement")[0].status = "SUSPENDED";
    const later = await reconcilePosPublicationDeadlines({ businessId: "bizA", now: new Date(DEADLINE.getTime() + 60_000) });
    expect(later.newlyEscalated).toBe(0);
    expect(later.cases[0]).toMatchObject({ status: "ESCALATED", entitlementStatus: "SUSPENDED" });
    expect(fake().rows("posAuditEvent").filter((row) => row.action === "POS_PUBLICATION_ESCALATED")).toHaveLength(1);
    expect(fake().rows("paymentNotification")).toHaveLength(2);
  });

  it("resolves a post-deadline retry only after publication succeeds and keeps resolution idempotent", async () => {
    await settleBlockedPayment();
    // Resolve after the deadline without running the due-notification pass first. The pending
    // escalation is obsolete, but its audit reason must not falsely claim an early resolution.
    const publishedAt = new Date(DEADLINE.getTime() + 60_000);
    vi.setSystemTime(publishedAt);

    // A failed attempt leaves the case untouched; the safe retry below is what resolves it.
    await expect(publishConfiguration({ businessId: "bizA", actorId: "userA" })).rejects.toMatchObject({
      code: "inline_media_persistence_disabled",
    });
    expect(fake().rows("posPublicationResolution")[0].status).toBe("OPEN");
    expect(fake().rows("posConfigurationVersion")).toHaveLength(0);

    const configuration = fake().rows("posConfiguration")[0];
    const safeDraft = JSON.parse(configuration.draftJson);
    delete safeDraft.business.legacyLogo;
    configuration.draftJson = JSON.stringify(safeDraft);

    const published = await publishConfiguration({ businessId: "bizA", actorId: "userA" });
    expect(published.ok).toBe(true);
    expect(fake().rows("posConfiguration")[0]).toMatchObject({ status: "LIVE", configurationStatus: "PUBLISHED", publishedVersion: 1 });
    expect(fake().rows("posConfigurationVersion")).toHaveLength(1);
    expect(fake().rows("posPublicationResolution")[0]).toMatchObject({
      status: "RESOLVED",
      remedyStatus: "PUBLISHED",
      resolvedAt: publishedAt,
    });
    expect((await getPosEntitlement("bizA")).lifecycle).toBe("LIVE");

    const resolutionKey = posPublicationNotificationKey("pay_policy_1", "RESOLUTION");
    const resolution = fake().rows("paymentNotification").find((row) => row.idempotencyKey === resolutionKey);
    expect(resolution).toBeTruthy();
    expect(resolution.message).toContain("only after a configuration snapshot was published");
    expect(resolution.scheduledAt).toEqual(publishedAt);

    expect(await resolvePosPublicationCases(prisma, { businessId: "bizA", publishedAt, actorId: "userA" })).toBe(0);
    expect(fake().rows("paymentNotification").filter((row) => row.idempotencyKey === resolutionKey)).toHaveLength(1);
    expect(fake().rows("posAuditEvent").filter((row) => row.action === "POS_PUBLICATION_RESOLVED")).toHaveLength(1);

    const escalationKey = posPublicationNotificationKey("pay_policy_1", "ESCALATION");
    const cancelledEscalation = fake().rows("paymentNotification").find((row) => row.idempotencyKey === escalationKey);
    expect(cancelledEscalation).toMatchObject({
      status: "SKIPPED",
      lastError: "No longer required: publication resolved before pending escalation delivery.",
    });
    expect(cancelledEscalation.sentAt ?? null).toBeNull();
    const reconciled = await reconcilePosPublicationDeadlines({ businessId: "bizA", now: publishedAt });
    expect(reconciled.cases).toHaveLength(0);
    expect(fake().rows("paymentNotification").find((row) => row.idempotencyKey === resolutionKey).status).toBe("SENT");

    // Advancing past the old deadline must not deliver the obsolete escalation or reopen a remedy.
    const afterDeadline = await reconcilePosPublicationDeadlines({ businessId: "bizA", now: new Date(publishedAt.getTime() + 60_000) });
    expect(afterDeadline.cases).toHaveLength(0);
    expect(afterDeadline.newlyEscalated).toBe(0);
    expect(fake().rows("paymentNotification").find((row) => row.idempotencyKey === escalationKey).status).toBe("SKIPPED");
    expect(fake().rows("paymentNotification").find((row) => row.idempotencyKey === escalationKey).sentAt ?? null).toBeNull();
    expect(fake().rows("posAuditEvent").filter((row) => row.action === "POS_PUBLICATION_ESCALATED")).toHaveLength(0);
  });

  it("tracks a missing configuration without inventing publication success", async () => {
    fake().rows("payment").push(paymentRow());
    await settleExisting();
    expect(fake().rows("posPublicationResolution")[0]).toMatchObject({
      blockerCode: "CONFIGURATION_MISSING",
      configurationId: null,
      status: "OPEN",
    });
    expect(fake().rows("posConfigurationVersion")).toHaveLength(0);
    expect((await getPosEntitlement("bizA")).lifecycle).toBe("PAYMENT_CONFIRMED");
    expect((await getPosEntitlement("bizA")).entitled).toBe(true);
  });
});
