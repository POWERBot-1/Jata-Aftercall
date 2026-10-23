/**
 * Real Prisma + PostgreSQL coverage for Option B. No Paystack/network call is made; provider
 * evidence is synthetic. Runs only against PRISMA_TEST_DATABASE_URL after the full migrations.
 * The engine label (native CI or documented WASM adapter) is reported by the shared helper.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prismaEngineLabel, realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, uid } from "../helpers/prisma-fixtures";

vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));

import { settlePosPayment } from "@/lib/pos/settlement";
import { publishConfiguration, saveDraft } from "@/lib/pos/provisioning";
import {
  posPublicationNotificationKey,
  reconcilePosPublicationDeadlines,
  resolvePosPublicationCases,
} from "@/lib/pos/publication-policy";

const p = realPrismaConfigured ? sharedPrisma() : (null as any);
const INLINE_PLACEHOLDER = "SYNTHETIC_LEGACY_IMAGE_PLACEHOLDER";
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

async function posPlan() {
  return p.planConfig.upsert({
    where: { key: "BUSINESS_POS" },
    update: { priceKES: 499, durationDays: 30, isActive: true },
    create: { key: "BUSINESS_POS", name: "Business POS (synthetic test)", priceKES: 499, durationDays: 30 },
  });
}

async function seedBlockedConfiguration() {
  const { owner, business } = await seedBusiness(p);
  await saveDraft({ businessId: business.id, answers, actorId: owner.id, context: { businessName: business.name } });
  const configuration = await p.posConfiguration.findUnique({ where: { businessId: business.id } });
  const draft = JSON.parse(configuration.draftJson);
  draft.business.legacyLogo = INLINE_PLACEHOLDER;
  await p.posConfiguration.update({ where: { id: configuration.id }, data: { draftJson: JSON.stringify(draft) } });
  // Construct a legacy value only inside this disposable test DB. Splitting the scheme keeps the
  // application's raw-argument inline-media guard intact; this is not an application write path.
  await p.$executeRaw`
    UPDATE "PosConfiguration"
    SET "draftJson" = REPLACE("draftJson", ${INLINE_PLACEHOLDER}, 'data:' || 'image/png;base64,iVBORw0KGgo=')
    WHERE "id" = ${configuration.id}
  `;
  return { owner, business, configuration };
}

async function createPayment(business: any, owner: any, plan: any, status = "PENDING") {
  return p.payment.create({
    data: {
      reference: `JATA-POS-${uid()}`,
      businessId: business.id,
      userId: owner.id,
      planId: plan.id,
      amount: 49900,
      currency: "KES",
      status,
      purpose: "SUBSCRIPTION",
    },
  });
}

async function settle(payment: any, plan: any, suffix = uid()) {
  return p.$transaction((tx: any) => settlePosPayment(tx, {
    payment,
    plan,
    eventId: `evt_${suffix}`,
    verification: { paystackId: `ps_${suffix}` },
  }));
}

describe.skipIf(!realPrismaConfigured)(`real Prisma: POS publication policy (${prismaEngineLabel})`, () => {
  beforeAll(async () => { await posPlan(); });
  afterAll(async () => { if (p) await p.$disconnect(); });

  it("keeps concurrent settlement to one case/entitlement and escalates once at the exact deadline", async () => {
    const plan = await posPlan();
    const { owner, business } = await seedBlockedConfiguration();
    const payment = await createPayment(business, owner, plan);

    const results = await Promise.allSettled([settle(payment, plan, `${uid()}_a`), settle(payment, plan, `${uid()}_b`)]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const values = results.map((result: any) => result.value);
    expect(values.filter((value) => !value.alreadySettled)).toHaveLength(1);
    expect(values.filter((value) => value.alreadySettled)).toHaveLength(1);

    expect((await p.payment.findUnique({ where: { id: payment.id } })).status).toBe("PAID");
    expect(await p.posEntitlement.count({ where: { businessId: business.id, status: "ACTIVE" } })).toBe(1);
    expect(await p.posPublicationResolution.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await p.paymentNotification.count({ where: { businessId: business.id } })).toBe(2);
    expect(await p.posConfigurationVersion.count({ where: { businessId: business.id } })).toBe(0);
    expect(await p.posConfiguration.findUnique({ where: { businessId: business.id } })).toMatchObject({
      status: "PAYMENT_CONFIRMED",
      configurationStatus: "READY",
      publishedVersion: 0,
    });

    const resolution = await p.posPublicationResolution.findUnique({ where: { paymentId: payment.id } });
    expect(resolution.deadlineAt.getTime() - resolution.confirmedAt.getTime()).toBe(72 * 60 * 60 * 1000);
    const early = await reconcilePosPublicationDeadlines({ businessId: business.id, now: new Date(resolution.deadlineAt.getTime() - 1) });
    expect(early.newlyEscalated).toBe(0);
    expect(early.cases[0].status).toBe("OPEN");
    expect(await p.paymentNotification.findUnique({ where: { idempotencyKey: posPublicationNotificationKey(payment.id, "OWNER") } })).toMatchObject({ status: "SENT" });
    expect(await p.paymentNotification.findUnique({ where: { idempotencyKey: posPublicationNotificationKey(payment.id, "ESCALATION") } })).toMatchObject({ status: "PENDING", sentAt: null });

    const due = await reconcilePosPublicationDeadlines({ businessId: business.id, now: resolution.deadlineAt });
    expect(due.newlyEscalated).toBe(1);
    expect(due.cases[0]).toMatchObject({ status: "ESCALATED", remedyStatus: "OWNER_ESCALATED" });
    expect(await p.paymentNotification.findUnique({ where: { idempotencyKey: posPublicationNotificationKey(payment.id, "ESCALATION") } })).toMatchObject({ status: "SENT", sentAt: resolution.deadlineAt });
    expect(await p.posAuditEvent.count({ where: { businessId: business.id, action: "POS_PUBLICATION_ESCALATED" } })).toBe(1);

    const repeated = await reconcilePosPublicationDeadlines({ businessId: business.id, now: new Date(resolution.deadlineAt.getTime() + 1000) });
    expect(repeated.newlyEscalated).toBe(0);
    expect(await p.paymentNotification.count({ where: { businessId: business.id } })).toBe(2);
    expect(await p.posAuditEvent.count({ where: { businessId: business.id, action: "POS_PUBLICATION_ESCALATED" } })).toBe(1);
    expect((await p.payment.findUnique({ where: { id: payment.id } })).status).toBe("PAID");
    expect((await p.posEntitlement.findUnique({ where: { businessId: business.id } })).status).toBe("ACTIVE");
  });

  it("leaves a failed publish open, then resolves once after a safe snapshot and not on replay", async () => {
    const plan = await posPlan();
    const { owner, business, configuration } = await seedBlockedConfiguration();
    const payment = await createPayment(business, owner, plan);
    await settle(payment, plan);

    await expect(publishConfiguration({ businessId: business.id, actorId: owner.id })).rejects.toMatchObject({ code: "inline_media_persistence_disabled" });
    expect((await p.posPublicationResolution.findUnique({ where: { paymentId: payment.id } })).status).toBe("OPEN");

    const current = await p.posConfiguration.findUnique({ where: { id: configuration.id } });
    const safeDraft = JSON.parse(current.draftJson);
    delete safeDraft.business.legacyLogo;
    await p.posConfiguration.update({ where: { id: current.id }, data: { draftJson: JSON.stringify(safeDraft) } });
    const published = await publishConfiguration({ businessId: business.id, actorId: owner.id });
    expect(published.ok).toBe(true);

    expect(await p.posConfiguration.findUnique({ where: { businessId: business.id } })).toMatchObject({ status: "LIVE", configurationStatus: "PUBLISHED", publishedVersion: 1 });
    expect(await p.posConfigurationVersion.count({ where: { businessId: business.id } })).toBe(1);
    const resolvedCase = await p.posPublicationResolution.findUnique({ where: { paymentId: payment.id } });
    expect(resolvedCase).toMatchObject({ status: "RESOLVED", remedyStatus: "PUBLISHED" });
    expect(resolvedCase.resolvedAt).toBeTruthy();
    const resolutionKey = posPublicationNotificationKey(payment.id, "RESOLUTION");
    expect(await p.paymentNotification.count({ where: { idempotencyKey: resolutionKey } })).toBe(1);
    expect(await resolvePosPublicationCases(p, { businessId: business.id, publishedAt: resolvedCase.resolvedAt, actorId: owner.id })).toBe(0);
    expect(await p.paymentNotification.count({ where: { idempotencyKey: resolutionKey } })).toBe(1);
    expect(await p.posAuditEvent.count({ where: { businessId: business.id, action: "POS_PUBLICATION_RESOLVED" } })).toBe(1);

    const escalationKey = posPublicationNotificationKey(payment.id, "ESCALATION");
    expect(await p.paymentNotification.findUnique({ where: { idempotencyKey: escalationKey } })).toMatchObject({ status: "SKIPPED", sentAt: null });
    const afterDeadline = await reconcilePosPublicationDeadlines({ businessId: business.id, now: resolvedCase.deadlineAt });
    expect(afterDeadline.cases).toHaveLength(0);
    expect(afterDeadline.newlyEscalated).toBe(0);
    expect(await p.paymentNotification.findUnique({ where: { idempotencyKey: escalationKey } })).toMatchObject({ status: "SKIPPED", sentAt: null });
    expect(await p.posAuditEvent.count({ where: { businessId: business.id, action: "POS_PUBLICATION_ESCALATED" } })).toBe(0);
  });

  it("rolls back an escalation when its audit write fails, then retries it once", async () => {
    const plan = await posPlan();
    const { owner, business } = await seedBlockedConfiguration();
    const payment = await createPayment(business, owner, plan);
    await settle(payment, plan);
    const resolution = await p.posPublicationResolution.findUnique({ where: { paymentId: payment.id } });
    expect(resolution.id).toMatch(/^[a-z0-9]+$/);
    const suffix = resolution.id;
    const fn = `jata_pos_policy_fault_${suffix}`;
    const trigger = `jata_pos_policy_trg_${suffix}`;
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "${fn}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected POS publication audit fault'; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "PosAuditEvent"`);
    await p.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "PosAuditEvent" FOR EACH ROW WHEN (NEW.action = 'POS_PUBLICATION_ESCALATED' AND NEW."targetId" = '${suffix}') EXECUTE FUNCTION "${fn}"()`);
    try {
      await expect(reconcilePosPublicationDeadlines({ businessId: business.id, now: resolution.deadlineAt })).rejects.toThrow(/injected POS publication audit fault/);
      expect(await p.posPublicationResolution.findUnique({ where: { id: resolution.id } })).toMatchObject({ status: "OPEN", remedyStatus: "PENDING_PUBLICATION", escalatedAt: null });
      expect(await p.posAuditEvent.count({ where: { targetId: resolution.id, action: "POS_PUBLICATION_ESCALATED" } })).toBe(0);
      expect(await p.paymentNotification.findUnique({ where: { idempotencyKey: posPublicationNotificationKey(payment.id, "ESCALATION") } })).toMatchObject({ status: "PENDING", sentAt: null });
    } finally {
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "PosAuditEvent"`);
      await p.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }

    const retry = await reconcilePosPublicationDeadlines({ businessId: business.id, now: resolution.deadlineAt });
    expect(retry.newlyEscalated).toBe(1);
    expect(await p.posPublicationResolution.findUnique({ where: { id: resolution.id } })).toMatchObject({ status: "ESCALATED", remedyStatus: "OWNER_ESCALATED", escalatedAt: resolution.deadlineAt });
    expect(await p.posAuditEvent.count({ where: { targetId: resolution.id, action: "POS_PUBLICATION_ESCALATED" } })).toBe(1);
    expect((await reconcilePosPublicationDeadlines({ businessId: business.id, now: resolution.deadlineAt })).newlyEscalated).toBe(0);
    expect(await p.posAuditEvent.count({ where: { targetId: resolution.id, action: "POS_PUBLICATION_ESCALATED" } })).toBe(1);
  });

  it("fails legacy PAID repair without paid_at, then uses only verified provider time", async () => {
    const plan = await posPlan();
    const { owner, business } = await seedBusiness(p);
    const payment = await createPayment(business, owner, plan, "PAID");

    await expect(p.$transaction((tx: any) => settlePosPayment(tx, {
      payment,
      plan,
      repairingLegacyPaidPayment: true,
      verification: { paystackId: "ps_legacy_without_time" },
    }))).rejects.toThrow("LEGACY_PAYMENT_CONFIRMATION_TIME_REQUIRED");
    expect(await p.posSubscription.count({ where: { businessId: business.id } })).toBe(0);
    expect(await p.posPublicationResolution.count({ where: { paymentId: payment.id } })).toBe(0);

    await p.$transaction((tx: any) => settlePosPayment(tx, {
      payment,
      plan,
      repairingLegacyPaidPayment: true,
      verification: { providerConfirmedAt: "2026-10-20T08:00:00.000+03:00" },
    }));
    const resolution = await p.posPublicationResolution.findUnique({ where: { paymentId: payment.id } });
    expect(resolution).toMatchObject({ blockerCode: "CONFIGURATION_MISSING", status: "OPEN" });
    expect(resolution.confirmedAt.toISOString()).toBe("2026-10-20T05:00:00.000Z");
    expect(resolution.deadlineAt.toISOString()).toBe("2026-10-23T05:00:00.000Z");
    expect(resolution.confirmedAt.getTime()).not.toBe(payment.updatedAt.getTime());
  });
});
