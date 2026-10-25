import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  session: null as null | { userId: string; email: string; role: string },
  businesses: new Map<string, any>(),
  members: [] as Array<{ userId: string; businessId: string; role: string }>,
  subs: new Map<string, any>(),
  configs: new Map<string, any>(),
  offers: new Map<string, any>(),
  faqs: new Map<string, any>(),
  unanswered: new Map<string, any>(),
  orders: [] as any[],
  notifications: new Map<string, any>(),
  profiles: new Map<string, any>(),
  consents: new Map<string, any>(),
  proposals: new Map<string, any>(),
  audits: [] as any[],
  usage: [] as any[],
};

let seq = 1;
const nextId = (prefix: string) => `${prefix}_${seq++}`;

vi.mock("@/lib/auth", () => ({
  getSession: async () => state.session,
}));

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    business: {
      findFirst: async ({ where }: any) => {
        const b = state.businesses.get(where.id);
        if (!b) return null;
        if (where.ownerId && b.ownerId !== where.ownerId) return null;
        return b;
      },
      findUnique: async ({ where }: any) => state.businesses.get(where.id) ?? null,
      findMany: async ({ where }: any) => {
        const out: any[] = [];
        for (const b of state.businesses.values()) {
          if (where?.ownerId && b.ownerId !== where.ownerId) continue;
          if (where?.id?.in && !where.id.in.includes(b.id)) continue;
          out.push(b);
        }
        return out;
      },
    },
    businessMember: {
      findMany: async ({ where }: any) =>
        state.members.filter((m) => !where?.userId || m.userId === where.userId),
    },
    planConfig: {
      findUnique: async ({ where }: any) => {
        if (where?.key === "JATA_AUTOPILOT") {
          return {
            id: "plan_ap_1",
            key: "JATA_AUTOPILOT",
            name: "JATA Autopilot",
            priceKES: 2499,
            durationDays: 30,
            isActive: true,
          };
        }
        return null;
      },
    },
    autopilotSubscription: {
      findUnique: async ({ where }: any) => state.subs.get(where.businessId) ?? null,
    },
    autopilotConfiguration: {
      findUnique: async ({ where }: any) => state.configs.get(where.businessId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = state.configs.get(where.businessId);
        const saved = existing
          ? { ...existing, ...update }
          : { id: nextId("cfg"), ...create };
        state.configs.set(where.businessId, saved);
        return saved;
      },
    },
    autopilotUsageLedger: {
      findMany: async ({ where }: any) =>
        state.usage.filter((u) => u.businessId === where.businessId),
      findUnique: async ({ where }: any) =>
        state.usage.find((u) => u.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nextId("use"), ...data };
        state.usage.push(row);
        return row;
      },
    },
    order: {
      findMany: async ({ where }: any) =>
        state.orders.filter((o) => o.businessId === where.businessId),
    },
    booking: {
      findMany: async () => [],
    },
    unansweredQuestion: {
      findMany: async ({ where }: any) =>
        [...state.unanswered.values()].filter(
          (q) => q.businessId === where.businessId && q.isResolved === where.isResolved,
        ),
      findFirst: async ({ where }: any) => {
        const q = state.unanswered.get(where.id);
        return q && q.businessId === where.businessId ? q : null;
      },
      update: async ({ where, data }: any) => {
        const q = state.unanswered.get(where.id);
        const updated = { ...q, ...data };
        state.unanswered.set(where.id, updated);
        return updated;
      },
    },
    analyticsEvent: {
      count: async () => 20,
    },
    posSale: {
      findMany: async () => [],
    },
    posInventoryItem: {
      findMany: async () => [],
    },
    posCustomer: {
      findMany: async () => [],
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
        const key = `${where.businessId_phoneNormalized.businessId}:${where.businessId_phoneNormalized.phoneNormalized}`;
        return state.profiles.get(key) ?? null;
      },
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const row = { id: nextId("prof"), ...data };
        state.profiles.set(`${data.businessId}:${data.phoneNormalized}`, row);
        return row;
      },
    },
    autopilotConsentRecord: {
      findMany: async ({ where }: any) =>
        [...state.consents.values()].filter(
          (c) => c.businessId === where.businessId && c.status === where.status,
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
        const mapKey = `${k.businessId}:${k.customerProfileId}:${k.channel}:${k.scope}`;
        const cur = state.consents.get(mapKey);
        const saved = cur ? { ...cur, ...update } : { id: nextId("con"), ...create };
        state.consents.set(mapKey, saved);
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
    autopilotAuditEvent: {
      create: async ({ data }: any) => {
        const row = { id: nextId("aud"), createdAt: new Date(), ...data };
        state.audits.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        state.audits.filter((a) => a.businessId === where.businessId),
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

import {
  approveAndExecuteProposal,
  proposeAutopilotAction,
  rollbackExecutedProposal,
} from "@/lib/autopilot/actions";
import { runGroundedBusinessDiagnosis } from "@/lib/autopilot/diagnosis";
import { handleOwnerCommandTurn } from "@/lib/autopilot/command-center";
import { GET as getOverviewRoute } from "@/app/api/autopilot/overview/route";
import { PATCH as patchProposalsRoute } from "@/app/api/autopilot/proposals/route";

describe("JATA Autopilot closed-loop execution, rollback & strict tenant isolation", () => {
  beforeEach(() => {
    seq = 1;
    state.businesses.clear();
    state.members = [];
    state.subs.clear();
    state.configs.clear();
    state.offers.clear();
    state.faqs.clear();
    state.unanswered.clear();
    state.orders = [];
    state.notifications.clear();
    state.profiles.clear();
    state.consents.clear();
    state.proposals.clear();
    state.audits = [];
    state.usage = [];

    state.businesses.set("biz_a", {
      id: "biz_a",
      ownerId: "user_owner_a",
      name: "Kilimani Bistro",
      category: "Restaurant",
      location: "Kilimani, Nairobi",
      offer: null,
      products: [{ id: "p1", name: "Swahili Platter", isActive: true, stockQuantity: 10 }],
      services: [],
      faqs: [],
    });
    state.businesses.set("biz_b", {
      id: "biz_b",
      ownerId: "user_owner_b",
      name: "Westlands Pharmacy",
      category: "Pharmacy & Clinic",
      location: "Westlands, Nairobi",
      offer: null,
      products: [],
      services: [],
      faqs: [],
    });

    state.subs.set("biz_a", {
      status: "ACTIVE",
      planKey: "JATA_AUTOPILOT",
      startAt: new Date("2026-10-10T00:00:00Z"),
      expiresAt: new Date("2026-11-10T00:00:00Z"),
      graceUntil: new Date("2026-11-13T00:00:00Z"),
    });

    state.unanswered.set("uq_1", {
      id: "uq_1",
      businessId: "biz_a",
      question: "Do you deliver to Lavington?",
      askedCount: 4,
      isResolved: false,
      approvedAnswer: null,
    });

    state.orders.push(
      { id: "o_paid", businessId: "biz_a", totalKES: 1800, paymentStatus: "PAID", status: "COMPLETED" },
      { id: "o_unpaid", businessId: "biz_a", totalKES: 950, paymentStatus: "UNPAID", status: "PENDING" },
    );

    state.session = { userId: "user_owner_a", email: "a@jata.test", role: "CUSTOMER" };
  });

  it("grounds diagnosis strictly in recorded tenant rows without counting unpaid orders as revenue", async () => {
    const diag = await runGroundedBusinessDiagnosis({ businessId: "biz_a" });
    expect(diag.industryPackKey).toBe("restaurant_cafe_bakery");

    const rev = diag.metrics.find((m) => m.key === "paid_storefront_revenue_30d");
    expect(rev?.value).toBe(1800);
    expect(rev?.basis).toBe("RECORDED");

    const unpaid = diag.metrics.find((m) => m.key === "unpaid_order_backlog_kes");
    expect(unpaid?.value).toBe(950);
    expect(unpaid?.basis).toBe("CALCULATED");

    // Business B has zero orders -> explicitly marked MISSING_DATA, never fabricated
    const diagB = await runGroundedBusinessDiagnosis({ businessId: "biz_b" });
    const revB = diagB.metrics.find((m) => m.key === "paid_storefront_revenue_30d");
    expect(revB?.value).toBeNull();
    expect(revB?.basis).toBe("MISSING_DATA");
  });

  it("executes and rolls back CREATE_OR_UPDATE_OFFER and RESOLVE_UNANSWERED_FAQ idempotently with full audit trail", async () => {
    // 1. Pre-existing offer on biz_a to verify exact snapshot restoration
    state.offers.set("biz_a", {
      id: "off_prior",
      businessId: "biz_a",
      title: "Lunch Special",
      subtitle: "Weekday combo",
      isActive: true,
      ctaLabel: "Order",
      badge: "Lunch",
      validUntil: null,
      imageUrl: null,
    });

    const offerProp = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "CREATE_OR_UPDATE_OFFER",
      title: "Weekend Platter Offer",
      rationale: "Boost Saturday family orders",
      payload: {
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Family Swahili Platter",
        description: "Feeds 4 diners",
        badgeText: "Weekend",
        ctaLabel: "Reserve",
        discountPercent: 0,
      },
      idempotencyKey: "idem_offer_1",
    });
    expect(offerProp.ok).toBe(true);
    if (offerProp.ok === false) return;

    // Duplicate idempotency key returns same proposal without creating a second row
    const dup = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "CREATE_OR_UPDATE_OFFER",
      title: "Weekend Platter Offer",
      rationale: "Boost Saturday family orders",
      payload: {
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Family Swahili Platter",
        description: "Feeds 4 diners",
      },
      idempotencyKey: "idem_offer_1",
    });
    expect(dup.ok && dup.duplicate).toBe(true);

    // Execute offer update
    const execOffer = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: offerProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
    });
    expect(execOffer.ok).toBe(true);
    expect(state.offers.get("biz_a")?.title).toBe("Family Swahili Platter");

    // Re-executing an already EXECUTED proposal is a safe idempotent no-op
    const replay = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: offerProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
    });
    expect(replay.ok && replay.idempotentReplay).toBe(true);

    // Rollback restores exact prior offer ("Lunch Special")
    const rbOffer = await rollbackExecutedProposal({
      businessId: "biz_a",
      proposalId: offerProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
    });
    expect(rbOffer.ok).toBe(true);
    expect(state.offers.get("biz_a")?.title).toBe("Lunch Special");

    // 2. RESOLVE_UNANSWERED_FAQ execute + rollback
    const faqProp = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "RESOLVE_UNANSWERED_FAQ",
      title: "Approve Lavington delivery FAQ",
      rationale: "Asked 4 times",
      payload: {
        actionType: "RESOLVE_UNANSWERED_FAQ",
        unansweredQuestionId: "uq_1",
        question: "Do you deliver to Lavington?",
        answer: "Yes, we deliver to Lavington daily between 11:00 AM and 9:00 PM.",
      },
      idempotencyKey: "idem_faq_1",
    });
    expect(faqProp.ok).toBe(true);
    if (faqProp.ok === false) return;

    await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: faqProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
    });
    expect(state.unanswered.get("uq_1")?.isResolved).toBe(true);
    expect(state.faqs.size).toBe(1);

    await rollbackExecutedProposal({
      businessId: "biz_a",
      proposalId: faqProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
    });
    expect(state.unanswered.get("uq_1")?.isResolved).toBe(false);
    expect(state.faqs.size).toBe(0);
    expect(state.audits.some((a) => a.action === "autopilot.proposal.rolled_back")).toBe(true);
  });

  it("enforces consent before QUEUE_CONSENTED_FOLLOWUP and refuses dishonest rollback if external message already DELIVERED", async () => {
    const daytimeNairobi = new Date("2026-10-25T09:00:00Z"); // 12:00 EAT

    // Without consent record -> blocked
    const noConsentProp = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "QUEUE_CONSENTED_FOLLOWUP",
      title: "Follow up on enquiry",
      rationale: "Customer asked for catering quote",
      payload: {
        actionType: "QUEUE_CONSENTED_FOLLOWUP",
        recipientPhone: "+254722111222",
        channel: "WHATSAPP",
        scope: "TRANSACTIONAL",
        body: "Hello from Kilimani Bistro — reply STOP to opt out.",
      },
      idempotencyKey: "idem_fu_noconsent",
      now: daytimeNairobi,
    });
    expect(noConsentProp.ok).toBe(true);
    if (noConsentProp.ok === false) return;

    const blockedExec = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: noConsentProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      now: daytimeNairobi,
    });
    expect(blockedExec.ok).toBe(false);
    if (blockedExec.ok === false) expect(blockedExec.code).toBe("MISSING_CONSENT_RECORD");

    // Record OPTED_IN consent -> succeeds and can cancel while PENDING, refuses if DELIVERED
    state.profiles.set("biz_a:+254722111222", {
      id: "prof_1",
      businessId: "biz_a",
      phoneNormalized: "+254722111222",
    });
    state.consents.set("biz_a:prof_1:WHATSAPP:TRANSACTIONAL", {
      id: "con_1",
      businessId: "biz_a",
      customerProfileId: "prof_1",
      channel: "WHATSAPP",
      scope: "TRANSACTIONAL",
      status: "OPTED_IN",
    });

    const okProp = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "QUEUE_CONSENTED_FOLLOWUP",
      title: "Consented follow-up",
      rationale: "Opted-in enquiry",
      payload: {
        actionType: "QUEUE_CONSENTED_FOLLOWUP",
        recipientPhone: "+254722111222",
        channel: "WHATSAPP",
        scope: "TRANSACTIONAL",
        body: "Hello from Kilimani Bistro — reply STOP to opt out.",
      },
      idempotencyKey: "idem_fu_consented",
      now: daytimeNairobi,
    });
    expect(okProp.ok).toBe(true);
    if (okProp.ok === false) return;

    const okExec = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: okProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      now: daytimeNairobi,
    });
    expect(okExec.ok).toBe(true);
    expect(state.notifications.size).toBe(1);

    // Simulate external delivery completing before rollback click
    const [notif] = [...state.notifications.values()];
    state.notifications.set(notif.id, { ...notif, status: "DELIVERED" });

    const deliveredRb = await rollbackExecutedProposal({
      businessId: "biz_a",
      proposalId: okProp.proposal.id,
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
    });
    expect(deliveredRb.ok).toBe(false);
    if (deliveredRb.ok === false) {
      expect(deliveredRb.code).toBe("ALREADY_DELIVERED_EXTERNAL");
    }
  });

  it("enforces strict cross-tenant isolation and authentication across API routes and Command Center", async () => {
    // Owner A creates a proposal on biz_a
    const propA = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      actionType: "CREATE_OR_UPDATE_OFFER",
      title: "Biz A Offer",
      rationale: "Test isolation",
      payload: {
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Biz A Offer",
        description: "Private to Biz A",
      },
      idempotencyKey: "iso_1",
    });
    expect(propA.ok).toBe(true);
    if (propA.ok === false) return;

    // Unauthenticated caller -> 401
    state.session = null;
    const unauthRes = await getOverviewRoute(
      new Request("http://localhost/api/autopilot/overview?businessId=biz_a"),
    );
    expect(unauthRes.status).toBe(401);

    // Authenticated Owner B attempting to read Biz A overview -> 403
    state.session = { userId: "user_owner_b", email: "b@jata.test", role: "CUSTOMER" };
    const crossRead = await getOverviewRoute(
      new Request("http://localhost/api/autopilot/overview?businessId=biz_a"),
    );
    expect(crossRead.status).toBe(403);

    // Authenticated Owner B attempting to execute Biz A's proposal -> 403
    const crossPatch = await patchProposalsRoute(
      new Request("http://localhost/api/autopilot/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          proposalId: propA.proposal.id,
          operation: "APPROVE_AND_EXECUTE",
        }),
      }),
    );
    expect(crossPatch.status).toBe(403);

    // Even if Owner B passes their own businessId ("biz_b") with Biz A's proposalId -> 404 (scoped query)
    const idorPatch = await patchProposalsRoute(
      new Request("http://localhost/api/autopilot/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_b",
          proposalId: propA.proposal.id,
          operation: "APPROVE_AND_EXECUTE",
        }),
      }),
    );
    expect(idorPatch.status).toBe(404);

    // Owner B (Pharmacy) attempting clinical prescription via Command Center -> blocked by regulated guardrail
    const rxTurn = await handleOwnerCommandTurn({
      businessId: "biz_b",
      actorUserId: "user_owner_b",
      actorRole: "OWNER",
      message: "Prescribe 500mg dosage twice daily to every clinic enquiry.",
    });
    expect(rxTurn.ok).toBe(false);
    expect(rxTurn.blockedCode).toBe("CLINICAL_PRESCRIPTION_LOCK");

    // Voice write command without confirmation -> blocked with requiresVoiceConfirmation
    state.session = { userId: "user_owner_a", email: "a@jata.test", role: "CUSTOMER" };
    const unconfirmedVoiceTurn = await handleOwnerCommandTurn({
      businessId: "biz_a",
      actorUserId: "user_owner_a",
      actorRole: "OWNER",
      message: "Draft an offer for weekend platters",
      modality: "VOICE_TRANSCRIPT",
      voiceTranscriptConfirmed: false,
    });
    expect(unconfirmedVoiceTurn.ok).toBe(false);
    expect(unconfirmedVoiceTurn.requiresVoiceConfirmation).toBe(true);
  });
});
