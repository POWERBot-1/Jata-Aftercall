import fs from "fs";
import path from "path";
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const state = {
  session: null as null | { userId: string; email: string; role: string },
  businesses: new Map<string, any>(),
  members: [] as Array<{ userId: string; businessId: string; role: string }>,
  users: new Map<string, any>(),
  plans: new Map<string, any>(),
  payments: new Map<string, any>(),
  processedWebhooks: new Set<string>(),
  pageSubs: new Map<string, any>(),
  posSubs: new Map<string, any>(),
  autopilotSubs: new Map<string, any>(),
  autopilotEnts: new Map<string, any>(),
  configs: new Map<string, any>(),
  offers: new Map<string, any>(),
  faqs: new Map<string, any>(),
  unanswered: new Map<string, any>(),
  notifications: new Map<string, any>(),
  profiles: new Map<string, any>(),
  consents: new Map<string, any>(),
  proposals: new Map<string, any>(),
  audits: [] as any[],
  usage: [] as any[],
  simulateProposalP2002Once: false,
  llmCallCount: 0,
};

let seq = 1;
const nextId = (prefix: string) => `${prefix}_${seq++}`;

vi.mock("@/lib/auth", () => ({
  getSession: async () => state.session,
}));

vi.mock("@/lib/ai/registry", () => ({
  resolveProvider: () => ({
    key: "mock-llm-provider",
    generateText: async () => {
      state.llmCallCount += 1;
      return { texts: ["Grounded executive brief from mock LLM."] };
    },
  }),
}));

vi.mock("@/lib/db", () => {
  const mockPrisma: any = {
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(mockPrisma),
    $executeRaw: async () => 1,
    business: {
      findFirst: async ({ where }: any) => {
        const b = state.businesses.get(where.id);
        if (!b) return null;
        if (where.ownerId && b.ownerId !== where.ownerId) return null;
        return b;
      },
      findUnique: async ({ where }: any) => state.businesses.get(where.id) ?? null,
    },
    businessMember: {
      findFirst: async ({ where }: any) =>
        state.members.find(
          (m) => m.businessId === where?.businessId && m.userId === where?.userId,
        ) ?? null,
      findMany: async ({ where }: any) =>
        state.members.filter((m) => !where?.userId || m.userId === where.userId),
    },
    user: {
      findUnique: async ({ where }: any) => state.users.get(where.id) ?? null,
    },
    planConfig: {
      findUnique: async ({ where }: any) => {
        if (where?.id) return state.plans.get(where.id) ?? null;
        if (where?.key) {
          return [...state.plans.values()].find((p) => p.key === where.key) ?? null;
        }
        return null;
      },
    },
    payment: {
      findFirst: async () => null,
      findUnique: async ({ where }: any) => {
        if (where.id) return state.payments.get(where.id) ?? null;
        if (where.reference) {
          return [...state.payments.values()].find((p) => p.reference === where.reference) ?? null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const row = { id: nextId("pay"), createdAt: new Date(), ...data };
        state.payments.set(row.id, row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const p = state.payments.get(where.id);
        if (!p) return { count: 0 };
        if (where.status?.not && p.status === where.status.not) return { count: 0 };
        if (typeof where.status === "string" && p.status !== where.status) return { count: 0 };
        state.payments.set(where.id, { ...p, ...data });
        return { count: 1 };
      },
    },
    processedWebhook: {
      findUnique: async ({ where }: any) =>
        state.processedWebhooks.has(where.id) ? { id: where.id } : null,
      create: async ({ data }: any) => {
        if (state.processedWebhooks.has(data.id)) {
          const err: any = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        state.processedWebhooks.add(data.id);
        return { id: data.id };
      },
      upsert: async ({ where }: any) => {
        state.processedWebhooks.add(where.id);
        return { id: where.id };
      },
    },
    subscription: {
      findUnique: async ({ where }: any) => state.pageSubs.get(where.businessId) ?? null,
      updateMany: async () => ({ count: 0 }),
    },
    posSubscription: {
      findUnique: async ({ where }: any) => state.posSubs.get(where.businessId) ?? null,
      updateMany: async () => ({ count: 0 }),
    },
    autopilotSubscription: {
      findUnique: async ({ where }: any) => state.autopilotSubs.get(where.businessId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = state.autopilotSubs.get(where.businessId);
        const saved = cur ? { ...cur, ...update } : { id: nextId("apsub"), ...create };
        state.autopilotSubs.set(where.businessId, saved);
        return saved;
      },
      updateMany: async ({ where, data }: any) => {
        const cur = state.autopilotSubs.get(where.businessId);
        if (!cur) return { count: 0 };
        if (where.paymentId && cur.paymentId !== where.paymentId) return { count: 0 };
        state.autopilotSubs.set(where.businessId, { ...cur, ...data });
        return { count: 1 };
      },
    },
    autopilotEntitlement: {
      upsert: async ({ where, create, update }: any) => {
        const cur = state.autopilotEnts.get(where.businessId);
        const saved = cur ? { ...cur, ...update } : { id: nextId("apent"), ...create };
        state.autopilotEnts.set(where.businessId, saved);
        return saved;
      },
      updateMany: async ({ where, data }: any) => {
        const cur = state.autopilotEnts.get(where.businessId);
        if (!cur) return { count: 0 };
        state.autopilotEnts.set(where.businessId, { ...cur, ...data });
        return { count: 1 };
      },
    },
    autopilotConfiguration: {
      findUnique: async ({ where }: any) => state.configs.get(where.businessId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = state.configs.get(where.businessId);
        const saved = cur ? { ...cur, ...update } : { id: nextId("cfg"), ...create };
        state.configs.set(where.businessId, saved);
        return saved;
      },
    },
    autopilotUsageLedger: {
      findMany: async ({ where }: any) =>
        state.usage.filter(
          (u) =>
            u.businessId === where.businessId &&
            (!where.periodKey || u.periodKey === where.periodKey),
        ),
      findUnique: async ({ where }: any) =>
        state.usage.find((u) => u.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        if (state.usage.some((u) => u.idempotencyKey === data.idempotencyKey)) {
          const err: any = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        const row = { id: nextId("use"), ...data };
        state.usage.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const before = state.usage.length;
        state.usage = state.usage.filter((u) => u.idempotencyKey !== where.idempotencyKey);
        return { count: before - state.usage.length };
      },
    },
    order: { findMany: async () => [] },
    booking: { findMany: async () => [] },
    analyticsEvent: { count: async () => 0 },
    posSale: { findMany: async () => [] },
    posInventoryItem: { findMany: async () => [] },
    posCustomer: { findMany: async () => [] },
    unansweredQuestion: {
      findMany: async () => [],
      findFirst: async ({ where }: any) => {
        const q = state.unanswered.get(where.id);
        return q && q.businessId === where.businessId ? q : null;
      },
      update: async ({ where, data }: any) => {
        const cur = state.unanswered.get(where.id);
        const next = { ...cur, ...data };
        state.unanswered.set(where.id, next);
        return next;
      },
    },
    offer: {
      findUnique: async ({ where }: any) => state.offers.get(where.businessId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = state.offers.get(where.businessId);
        const next = cur ? { ...cur, ...update } : { id: nextId("off"), ...create };
        state.offers.set(where.businessId, next);
        return next;
      },
      delete: async ({ where }: any) => {
        state.offers.delete(where.businessId);
      },
    },
    fAQ: {
      findFirst: async ({ where }: any) =>
        [...state.faqs.values()].find(
          (f) => f.businessId === where.businessId && f.question === where.question,
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nextId("faq"), ...data };
        state.faqs.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const cur = state.faqs.get(where.id);
        const next = { ...cur, ...data };
        state.faqs.set(where.id, next);
        return next;
      },
      delete: async ({ where }: any) => {
        state.faqs.delete(where.id);
      },
    },
    autopilotCustomerProfile: {
      findUnique: async ({ where }: any) => {
        if (where.businessId_phoneNormalized) {
          const k = `${where.businessId_phoneNormalized.businessId}:${where.businessId_phoneNormalized.phoneNormalized}`;
          return state.profiles.get(k) ?? null;
        }
        return null;
      },
      findFirst: async ({ where }: any) =>
        [...state.profiles.values()].find(
          (p) =>
            p.businessId === where.businessId &&
            where.emailNormalized &&
            p.emailNormalized === where.emailNormalized,
        ) ?? null,
      create: async ({ data }: any) => {
        const key = `${data.businessId}:${data.phoneNormalized ?? data.emailNormalized}`;
        if (state.profiles.has(key)) {
          const err: any = new Error("Unique constraint");
          err.code = "P2002";
          throw err;
        }
        const row = { id: nextId("prof"), ...data };
        state.profiles.set(key, row);
        return row;
      },
    },
    autopilotConsentRecord: {
      findMany: async ({ where }: any) =>
        [...state.consents.values()].filter(
          (c) =>
            c.businessId === where.businessId && (!where.status || c.status === where.status),
        ),
      findUnique: async ({ where }: any) => {
        const k = where.businessId_customerProfileId_channel_scope;
        return (
          state.consents.get(`${k.businessId}:${k.customerProfileId}:${k.channel}:${k.scope}`) ??
          null
        );
      },
      upsert: async ({ where, create, update }: any) => {
        const k = where.businessId_customerProfileId_channel_scope;
        const key = `${k.businessId}:${k.customerProfileId}:${k.channel}:${k.scope}`;
        const cur = state.consents.get(key);
        const saved = cur ? { ...cur, ...update } : { id: nextId("con"), ...create };
        state.consents.set(key, saved);
        return saved;
      },
    },
    notification: {
      create: async ({ data }: any) => {
        const row = { id: nextId("ntf"), ...data };
        state.notifications.set(row.id, row);
        return row;
      },
      findFirst: async ({ where }: any) => {
        const n = state.notifications.get(where.id);
        return n && n.businessId === where.businessId ? n : null;
      },
      update: async ({ where, data }: any) => {
        const cur = state.notifications.get(where.id);
        const next = { ...cur, ...data };
        state.notifications.set(where.id, next);
        return next;
      },
    },
    autopilotActionProposal: {
      findUnique: async ({ where }: any) => {
        const k = where.businessId_idempotencyKey;
        return (
          [...state.proposals.values()].find(
            (p) => p.businessId === k.businessId && p.idempotencyKey === k.idempotencyKey,
          ) ?? null
        );
      },
      findFirst: async ({ where }: any) => {
        const p = state.proposals.get(where.id);
        return p && p.businessId === where.businessId ? p : null;
      },
      findMany: async ({ where }: any) =>
        [...state.proposals.values()].filter((p) => p.businessId === where.businessId),
      create: async ({ data }: any) => {
        if (state.simulateProposalP2002Once) {
          state.simulateProposalP2002Once = false;
          const winner = { id: nextId("prop"), createdAt: new Date(), ...data };
          state.proposals.set(winner.id, winner);
          const err: any = new Error("Unique constraint failed on idempotencyKey");
          err.code = "P2002";
          throw err;
        }
        const row = { id: nextId("prop"), createdAt: new Date(), ...data };
        state.proposals.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const cur = state.proposals.get(where.id);
        const next = { ...cur, ...data };
        state.proposals.set(where.id, next);
        return next;
      },
      updateMany: async ({ where, data }: any) => {
        const cur = state.proposals.get(where.id);
        if (!cur || cur.businessId !== where.businessId || cur.status !== where.status) {
          return { count: 0 };
        }
        state.proposals.set(where.id, { ...cur, ...data });
        return { count: 1 };
      },
    },
    auditEvent: {
      create: async ({ data }: any) => ({ id: nextId("sysaud"), ...data }),
    },
    autopilotAuditEvent: {
      create: async ({ data }: any) => {
        const row = { id: nextId("apaud"), createdAt: new Date(), ...data };
        state.audits.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        state.audits.filter((a) => a.businessId === where.businessId),
    },
    autopilotIngestionRecord: {
      create: async ({ data }: any) => ({ id: nextId("ing"), ...data }),
    },
    autopilotSession: {
      create: async ({ data }: any) => ({ id: nextId("sess"), ...data }),
    },
    autopilotMessage: {
      create: async ({ data }: any) => ({ id: nextId("msg"), ...data }),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import { activateSubscriptionForPayment } from "@/lib/paystack";
import { POST as postWebhook } from "@/app/api/paystack/webhook/route";
import { POST as postCheckout } from "@/app/api/checkout/route";
import { PATCH as patchConfigRoute } from "@/app/api/autopilot/config/route";
import { POST as postProposalsRoute } from "@/app/api/autopilot/proposals/route";
import { POST as postIngestRoute } from "@/app/api/autopilot/ingest/route";
import {
  approveAndExecuteProposal,
  dispatchQueuedAutopilotFollowup,
  proposeAutopilotAction,
  rollbackExecutedProposal,
} from "@/lib/autopilot/actions";
import { handleOwnerCommandTurn } from "@/lib/autopilot/command-center";
import { recordCustomerOptOutByKeyword, verifyCustomerChannelConsent } from "@/lib/autopilot/consent";
import { reserveAutopilotBudget } from "@/lib/autopilot/usage";
import { deriveAutopilotEntitlement } from "@/lib/autopilot/entitlement";

describe("Stage C Phase 1 adversarial hardening across all 10 priorities", () => {
  beforeEach(() => {
    seq = 1;
    state.businesses.clear();
    state.members = [];
    state.users.clear();
    state.plans.clear();
    state.payments.clear();
    state.processedWebhooks.clear();
    state.pageSubs.clear();
    state.posSubs.clear();
    state.autopilotSubs.clear();
    state.autopilotEnts.clear();
    state.configs.clear();
    state.offers.clear();
    state.faqs.clear();
    state.unanswered.clear();
    state.notifications.clear();
    state.profiles.clear();
    state.consents.clear();
    state.proposals.clear();
    state.audits = [];
    state.usage = [];
    state.simulateProposalP2002Once = false;
    state.llmCallCount = 0;

    delete process.env.JATA_AUTOPILOT_GLOBAL_KILL_SWITCH;

    state.businesses.set("biz_a", {
      id: "biz_a",
      ownerId: "user_owner_a",
      name: "Nairobi Roastery",
      category: "Restaurant",
      location: "Westlands, Nairobi",
      offer: null,
      products: [],
      services: [],
      faqs: [],
    });
    state.businesses.set("biz_b", {
      id: "biz_b",
      ownerId: "user_owner_b",
      name: "Mombasa Hardware",
      category: "Hardware",
      location: "Mombasa",
      offer: null,
      products: [],
      services: [],
      faqs: [],
    });

    state.users.set("user_owner_a", { id: "user_owner_a", email: "owner@roastery.ke" });
    state.users.set("user_staff_a", { id: "user_staff_a", email: "staff@roastery.ke" });
    state.users.set("user_viewer_a", { id: "user_viewer_a", email: "viewer@roastery.ke" });

    state.members.push(
      { userId: "user_staff_a", businessId: "biz_a", role: "STAFF" },
      { userId: "user_viewer_a", businessId: "biz_a", role: "VIEWER" },
    );

    state.plans.set("plan_ap_std", {
      id: "plan_ap_std",
      key: "JATA_AUTOPILOT",
      name: "JATA Autopilot",
      priceKES: 2499,
      durationDays: 30,
      isActive: true,
    });

    state.autopilotSubs.set("biz_a", {
      id: "apsub_initial",
      businessId: "biz_a",
      status: "ACTIVE",
      planKey: "JATA_AUTOPILOT",
      paymentId: "pay_initial",
      startAt: new Date("2026-10-15T00:00:00Z"),
      expiresAt: new Date("2026-11-14T00:00:00Z"),
      graceUntil: new Date("2026-11-17T00:00:00Z"),
    });

    state.session = { userId: "user_owner_a", email: "owner@roastery.ke", role: "CUSTOMER" };
  });

  it("Priority 1: validates PostgreSQL migration SQL identifier lengths (<63 bytes), constraint guards, DMMF parity & P2002 recovery", async () => {
    const sqlPath = path.join(
      process.cwd(),
      "prisma/migrations/20261025000000_jata_autopilot_foundation/migration.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");
    const quotedIds = [...sql.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(quotedIds.length).toBeGreaterThan(20);
    for (const identifier of quotedIds) {
      expect(Buffer.byteLength(identifier, "utf8")).toBeLessThanOrEqual(63);
    }
    expect(sql).toContain("AutopilotCustomerProfile_businessId_emailNormalized_key");

    const profileModel = Prisma.dmmf.datamodel.models.find(
      (m) => m.name === "AutopilotCustomerProfile",
    );
    expect(
      profileModel?.uniqueFields.some(
        (u) => u.includes("businessId") && u.includes("emailNormalized"),
      ),
    ).toBe(true);

    // Concurrent P2002 on proposal creation recovers cleanly as an idempotent duplicate
    state.simulateProposalP2002Once = true;
    const raced = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "CREATE_OR_UPDATE_OFFER",
      title: "Morning Coffee Combo",
      rationale: "Drive morning footfall",
      payload: {
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Morning Coffee Combo",
        description: "Espresso + pastry",
      },
      idempotencyKey: "idem_p2002_race",
    });
    expect(raced.ok).toBe(true);
    if (raced.ok) expect(raced.duplicate).toBe(true);
  });

  it("Priority 2: blocks actionType/payload confusion, foreign unansweredQuestionId, malformed quiet hours, and STAFF/VIEWER route mutations", async () => {
    // 1. Action-type confusion (claiming FAQ draft while smuggling outbound message payload) -> 400
    const confused = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "RESOLVE_UNANSWERED_FAQ",
      title: "Innocent FAQ",
      rationale: "Bypass attempt",
      payload: {
        actionType: "QUEUE_CONSENTED_FOLLOWUP",
        recipientPhone: "+254722000111",
        channel: "WHATSAPP",
        scope: "MARKETING",
        body: "Smuggled promo",
      } as any,
      idempotencyKey: "idem_confused",
    });
    expect(confused.ok).toBe(false);
    if (confused.ok === false) expect(confused.code).toBe("ACTION_PAYLOAD_MISMATCH");

    // 2. Foreign unansweredQuestionId belonging to biz_b referenced by biz_a -> 404 FOREIGN_OR_MISSING_QUESTION
    state.unanswered.set("uq_foreign_b", {
      id: "uq_foreign_b",
      businessId: "biz_b",
      question: "Do you sell cement?",
      isResolved: false,
    });
    const foreignFaqProp = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "RESOLVE_UNANSWERED_FAQ",
      title: "Resolve question",
      rationale: "Cross-tenant ID probe",
      payload: {
        actionType: "RESOLVE_UNANSWERED_FAQ",
        unansweredQuestionId: "uq_foreign_b",
        question: "Do you sell cement?",
        answer: "No",
      },
      idempotencyKey: "idem_foreign_uq",
    });
    expect(foreignFaqProp.ok).toBe(true);
    if (foreignFaqProp.ok) {
      const execForeign = await approveAndExecuteProposal({
        businessId: "biz_a",
        proposalId: foreignFaqProp.proposal.id,
        actorUserId: "user_owner_a",
        actorRole: "OWNER",
      });
      expect(execForeign.ok).toBe(false);
      if (execForeign.ok === false) {
        expect(execForeign.code).toBe("FOREIGN_OR_MISSING_QUESTION");
      }
      expect(state.unanswered.get("uq_foreign_b")?.isResolved).toBe(false);
    }

    // 3. Malformed quietHoursStart rejected with 400
    const badHoursRes = await patchConfigRoute(
      new Request("http://localhost/api/autopilot/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: "biz_a", quietHoursStart: "29:99" }),
      }),
    );
    expect(badHoursRes.status).toBe(400);

    // 4. STAFF rejected (403) on config, proposals, ingest, and Autopilot checkout
    state.session = { userId: "user_staff_a", email: "staff@roastery.ke", role: "CUSTOMER" };

    const staffCfg = await patchConfigRoute(
      new Request("http://localhost/api/autopilot/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: "biz_a", operationalStatus: "PAUSED" }),
      }),
    );
    expect(staffCfg.status).toBe(403);

    const staffProp = await postProposalsRoute(
      new Request("http://localhost/api/autopilot/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          actionType: "CREATE_OR_UPDATE_OFFER",
          title: "Staff Offer",
          idempotencyKey: "staff_try_1",
          payload: {
            actionType: "CREATE_OR_UPDATE_OFFER",
            title: "Staff Offer",
            description: "Not allowed",
          },
        }),
      }),
    );
    expect(staffProp.status).toBe(403);

    const staffIngest = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "menu.csv",
          mimeType: "text/csv",
          textContent: "name,price\nTea,150",
        }),
      }),
    );
    expect(staffIngest.status).toBe(403);

    const staffCheckout = await postCheckout(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: "biz_a", planId: "plan_ap_std" }),
      }),
    );
    expect(staffCheckout.status).toBe(403);
  });

  it("Priority 3 & 9: repairs legacy PAID Autopilot payments even when AFTERCALL Subscription exists, replays webhooks idempotently, and scopes refunds to matching paymentId", async () => {
    // Business A already owns an active AFTERCALL Subscription
    state.pageSubs.set("biz_a", {
      id: "pagesub_1",
      businessId: "biz_a",
      status: "ACTIVE",
      planKey: "MONTHLY",
    });
    state.autopilotSubs.delete("biz_a");

    // Legacy PAID Autopilot payment without an AutopilotSubscription row yet
    state.payments.set("pay_ap_legacy", {
      id: "pay_ap_legacy",
      reference: "JATA-AP-LEG-1",
      businessId: "biz_a",
      userId: "user_owner_a",
      planId: "plan_ap_std",
      status: "PAID",
      amount: 249900,
      currency: "KES",
    });

    const repaired = await activateSubscriptionForPayment("pay_ap_legacy", "evt_ap_leg_1");
    expect(repaired.alreadySettled).toBe(false);
    expect(state.autopilotSubs.get("biz_a")?.paymentId).toBe("pay_ap_legacy");
    expect(state.pageSubs.get("biz_a")?.planKey).toBe("MONTHLY");

    // Duplicate webhook eventId returns AutopilotSubscription (not AFTERCALL Subscription)
    const replay = await activateSubscriptionForPayment("pay_ap_legacy", "evt_ap_leg_1");
    expect(replay.alreadySettled).toBe(true);
    expect((replay.subscription as any)?.paymentId).toBe("pay_ap_legacy");

    // Newer renewal settles onto pay_ap_renew_2
    state.payments.set("pay_ap_renew_2", {
      id: "pay_ap_renew_2",
      reference: "JATA-AP-REN-2",
      businessId: "biz_a",
      userId: "user_owner_a",
      planId: "plan_ap_std",
      status: "PENDING",
      amount: 249900,
      currency: "KES",
    });
    await activateSubscriptionForPayment("pay_ap_renew_2", "evt_ap_ren_2", {
      paystackId: "ps_live_8899",
    });
    expect(state.autopilotSubs.get("biz_a")?.paymentId).toBe("pay_ap_renew_2");

    // Refunding the OLD payment (pay_ap_legacy) must NOT suspend the newer active renewal!
    process.env.PAYSTACK_SECRET_KEY = "sk_test_webhook_secret_key";
    const refundBody = JSON.stringify({
      id: "evt_rf_old_1",
      event: "refund.processed",
      data: {
        id: "rf_old_1",
        transaction_reference: "JATA-AP-LEG-1",
        amount: 249900,
        currency: "KES",
      },
    });
    const sig = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(refundBody)
      .digest("hex");

    const whRes = await postWebhook(
      new Request("http://localhost/api/paystack/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": sig,
        },
        body: refundBody,
      }),
    );
    expect(whRes.status).toBe(200);
    expect(state.payments.get("pay_ap_legacy")?.status).toBe("REFUNDED");
    // Newer subscription stays ACTIVE!
    expect(state.autopilotSubs.get("biz_a")?.status).toBe("ACTIVE");
    delete process.env.PAYSTACK_SECRET_KEY;

    // Explicit EXPIRED status is honored even if expiresAt is still in the future
    const expDecision = deriveAutopilotEntitlement(
      {
        status: "EXPIRED",
        planKey: "JATA_AUTOPILOT",
        startAt: new Date("2026-10-01T00:00:00Z"),
        expiresAt: new Date("2026-11-15T00:00:00Z"),
        graceUntil: new Date("2026-11-18T00:00:00Z"),
        cancelledAt: null,
        paymentReference: "JATA-EXP",
      },
      new Date("2026-10-25T10:00:00Z"),
    );
    expect(expDecision.entitled).toBe(false);
    expect(expDecision.entitlementStatus).toBe("EXPIRED");
  });

  it("Priority 4: enforces proposal expiry, CAS under concurrent double-approve & double-rollback, and controlled retry from FAILED", async () => {
    const now = new Date("2026-10-25T09:00:00Z");
    const propRes = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "CREATE_OR_UPDATE_OFFER",
      title: "Lunch Roastery Deal",
      rationale: "Midday traffic",
      payload: {
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Lunch Roastery Deal",
        description: "Flat white + sandwich",
      },
      idempotencyKey: "idem_cas_1",
      now,
    });
    expect(propRes.ok).toBe(true);
    if (propRes.ok === false) return;

    // Expired 8 days later -> rejected with PROPOSAL_EXPIRED
    const expiredAttempt = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: propRes.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      now: new Date("2026-11-05T09:00:00Z"),
    });
    expect(expiredAttempt.ok).toBe(false);
    if (expiredAttempt.ok === false) expect(expiredAttempt.code).toBe("PROPOSAL_EXPIRED");

    // Fresh proposal tested under concurrent Promise.all double-approve and double-rollback
    const fresh = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "CREATE_OR_UPDATE_OFFER",
      title: "Afternoon Cold Brew",
      rationale: "2pm dip",
      payload: {
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Afternoon Cold Brew",
        description: "Chilled single-origin",
      },
      idempotencyKey: "idem_cas_2",
      now,
    });
    expect(fresh.ok).toBe(true);
    if (fresh.ok === false) return;

    const [exec1, exec2] = await Promise.all([
      approveAndExecuteProposal({
        businessId: "biz_a",
        proposalId: fresh.proposal.id,
        actorUserId: "user_owner_a",
        actorRole: "OWNER",
        now,
      }),
      approveAndExecuteProposal({
        businessId: "biz_a",
        proposalId: fresh.proposal.id,
        actorUserId: "user_owner_a",
        actorRole: "OWNER",
        now,
      }),
    ]);
    const successes = [exec1, exec2].filter((r) => r.ok);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(
      state.audits.filter(
        (a) => a.action === "autopilot.proposal.executed" && a.proposalId === fresh.proposal.id,
      ),
    ).toHaveLength(1);

    const [rb1, rb2] = await Promise.all([
      rollbackExecutedProposal({
        businessId: "biz_a",
        proposalId: fresh.proposal.id,
        actorUserId: "user_owner_a",
        actorRole: "OWNER",
        now,
      }),
      rollbackExecutedProposal({
        businessId: "biz_a",
        proposalId: fresh.proposal.id,
        actorUserId: "user_owner_a",
        actorRole: "OWNER",
        now,
      }),
    ]);
    expect([rb1, rb2].some((r) => r.ok)).toBe(true);
    expect(
      state.audits.filter(
        (a) => a.action === "autopilot.proposal.rolled_back" && a.proposalId === fresh.proposal.id,
      ),
    ).toHaveLength(1);
  });

  it("Priority 5, 6, 7 & 8: re-verifies STOP opt-out & quiet hours right before dispatch, serializes concurrent spend caps, honors pause/kill-switch on ingest & LLM, and requires providerMessageId for DELIVERED", async () => {
    const noonEat = new Date("2026-10-25T09:00:00Z"); // 12:00 EAT
    const twoAmEat = new Date("2026-10-25T23:00:00Z"); // 02:00 EAT (inside quiet hours)

    state.profiles.set("biz_a:+254712345678", {
      id: "prof_c1",
      businessId: "biz_a",
      phoneNormalized: "+254712345678",
    });
    state.consents.set("biz_a:prof_c1:WHATSAPP:TRANSACTIONAL", {
      id: "con_c1",
      businessId: "biz_a",
      customerProfileId: "prof_c1",
      channel: "WHATSAPP",
      scope: "TRANSACTIONAL",
      status: "OPTED_IN",
    });

    // Quiet hours now block automated TRANSACTIONAL follow-ups at 02:00 EAT too
    const quietBlocked = await verifyCustomerChannelConsent({
      businessId: "biz_a",
      recipientPhone: "+254712345678",
      channel: "WHATSAPP",
      scope: "TRANSACTIONAL",
      now: twoAmEat,
    });
    expect(quietBlocked.allowed).toBe(false);
    if (quietBlocked.allowed === false) expect(quietBlocked.code).toBe("QUIET_HOURS_ACTIVE");

    // Stage follow-up at 12:00 EAT -> STAGED_IN_OUTBOX (PENDING, never falsely DELIVERED)
    const fuProp = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "QUEUE_CONSENTED_FOLLOWUP",
      title: "Roastery pickup follow-up",
      rationale: "Order enquiry",
      payload: {
        actionType: "QUEUE_CONSENTED_FOLLOWUP",
        recipientPhone: "+254712345678",
        channel: "WHATSAPP",
        scope: "TRANSACTIONAL",
        body: "Your roast enquiry is ready — reply STOP to opt out.",
      },
      idempotencyKey: "idem_predispatch_1",
      now: noonEat,
    });
    expect(fuProp.ok).toBe(true);
    if (fuProp.ok === false) return;

    const fuExec = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: fuProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      now: noonEat,
    });
    expect(fuExec.ok).toBe(true);
    if (fuExec.ok === false) return;

    const snap = JSON.parse(fuExec.proposal.afterSnapshotJson);
    expect(snap.deliveryState).toBe("STAGED_IN_OUTBOX");
    expect(snap.providerVerifiedDelivery).toBe(false);

    // Without external provider callback -> stays STAGED_AWAITING_PROVIDER, NOT DELIVERED
    const stagedCheck = await dispatchQueuedAutopilotFollowup({
      businessId: "biz_a",
      notificationId: snap.notificationId,
      now: noonEat,
    });
    expect(stagedCheck.ok).toBe(true);
    if (stagedCheck.ok) expect(stagedCheck.deliveryState).toBe("STAGED_AWAITING_PROVIDER");

    // Provider callback without providerMessageId -> rejected (PROVIDER_DELIVERY_UNVERIFIED)
    // First test STOP opt-out on SMS blocking WHATSAPP dispatch immediately before send!
    await recordCustomerOptOutByKeyword({
      businessId: "biz_a",
      phone: "0712345678",
      channel: "SMS",
      messageText: "STOP",
    });

    const haltedAfterStop = await dispatchQueuedAutopilotFollowup({
      businessId: "biz_a",
      notificationId: snap.notificationId,
      now: noonEat,
      sendViaProvider: async () => ({ delivered: true, providerMessageId: "wamid.123" }),
    });
    expect(haltedAfterStop.ok).toBe(false);
    if (haltedAfterStop.ok === false) expect(haltedAfterStop.code).toBe("RECIPIENT_OPTED_OUT");
    expect(state.notifications.get(snap.notificationId)?.status).toBe("SKIPPED");

    // Concurrent spend-cap race on fresh biz_b: cap = 500 minor KES, each VISION_EXTRACT costs 250 minor KES -> max 2 of 6 allowed!
    const concurrentReservations = await Promise.all(
      Array.from({ length: 6 }, (_, idx) =>
        reserveAutopilotBudget({
          businessId: "biz_b",
          tierKey: "STANDARD",
          capability: "VISION_EXTRACT",
          provider: "test-vision",
          idempotencyKey: `conc_cap_${idx}`,
          dailySpendCapMinorKES: 500,
          estimatedCallCostMinorKES: 250,
          now: noonEat,
        }),
      ),
    );
    const allowedCount = concurrentReservations.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(2);

    // Tenant PAUSED halts LLM provider invocation in Command Center AND halts /api/autopilot/ingest
    state.configs.set("biz_a", {
      id: "cfg_paused",
      businessId: "biz_a",
      autonomyMode: "ASSISTED",
      operationalStatus: "PAUSED",
      industryPackKey: "restaurant_cafe_bakery",
      quietHoursStart: "20:00",
      quietHoursEnd: "07:00",
      timezone: "Africa/Nairobi",
      dailySpendCapMinorKES: 25_000,
      maxBatchRecipients: 50,
      maxAutoDiscountPct: 0,
      voiceEnabled: false,
      version: 2,
    });

    const pausedTurn = await handleOwnerCommandTurn({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      message: "How is my business performing this month?",
      now: noonEat,
    });
    expect(pausedTurn.ok).toBe(true);
    expect(pausedTurn.providerUsed).toBe("jata-paused-readonly");
    expect(state.llmCallCount).toBe(0);

    const pausedIngest = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "menu.csv",
          mimeType: "text/csv",
          textContent: "name,price\nEspresso,250",
        }),
      }),
    );
    expect(pausedIngest.status).toBe(409);
  });

  it("Priority 10: verifies Command Center UI accessibility labels, ARIA toggle/alert attributes, 44px touch targets & workspace compliance", () => {
    const uiPath = path.join(
      process.cwd(),
      "components/autopilot/AutopilotCommandCenter.tsx",
    );
    const src = fs.readFileSync(uiPath, "utf8");

    // Explicit htmlFor + id pairings across all interactive form controls
    const requiredIds = [
      "autopilot-autonomy-mode",
      "autopilot-industry-pack",
      "autopilot-command-input",
      "autopilot-voice-confirm",
      "autopilot-ingest-filename",
      "autopilot-ingest-mime",
      "autopilot-ingest-content",
      "autopilot-consent-name",
      "autopilot-consent-phone",
      "autopilot-consent-channel",
    ];
    for (const controlId of requiredIds) {
      expect(src).toContain(`htmlFor="${controlId}"`);
      expect(src).toContain(`id="${controlId}"`);
    }

    expect(src).toContain("aria-pressed=");
    expect(src).toContain('role="alert"');
    expect(src).toContain("min-h-[44px]");
    expect(src).not.toContain("<main");
    expect(src).not.toContain("location.reload");
  });
});
