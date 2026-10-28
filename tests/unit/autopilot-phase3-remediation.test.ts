/**
 * JATA Autopilot — Stage C Phase 3 Defect Remediation Regression Suite
 *
 * Covers:
 * - F13: Fail-closed DB budget reservation & usage verification across paid
 *        providers, proposal execution, outbound dispatch, and ingestion;
 *        strictly isolated zero-cost read-only `jata-local` preview fallback.
 * - F9:  5 MB (`MAX_INGEST_BYTES`) API-boundary enforcement (`413 FILE_TOO_LARGE`),
 *        elimination of synthetic zero-byte hashes, verified real-byte SHA-256,
 *        unverified metadata-only handling, size mismatch, empty & malformed inputs.
 * - F10: Canonical `batchRecipientCount` alignment across payload validation,
 *        policy evaluation, proposal creation, and pre-execution checks (`NaN`,
 *        `Infinity`, fractions, `0`, negatives, oversized, `recipientCount` &
 *        unknown-field smuggling, and valid boundaries).
 */

import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: {
    userId: "user_owner_p3",
    email: "owner-p3@example.com",
    role: "USER",
  } as {
    userId: string;
    email: string;
    role: string;
  } | null,
  dbLedgerOutage: false,
  dbIngestWriteOutage: false,
  providerMode: "jata-local" as "jata-local" | "openai",
  paidLlmCalls: 0,
  usageRows: [] as any[],
  ingestRows: [] as any[],
  proposals: new Map<string, any>(),
  configs: new Map<string, any>(),
  entitlements: new Map<string, any>(),
  offers: new Map<string, any>(),
  notifications: new Map<string, any>(),
  audits: [] as any[],
}));

let idSeq = 1;
const nextId = (prefix: string) => `${prefix}_${idSeq++}`;

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimitByIdentity: vi.fn(() => ({ allowed: true, remaining: 99, retryAfterSeconds: 0 })),
}));

vi.mock("@/lib/ai/registry", () => ({
  resolveProvider: vi.fn(() => {
    if (state.providerMode === "openai") {
      return {
        key: "openai",
        generateText: vi.fn(async () => {
          state.paidLlmCalls += 1;
          return { texts: ["Paid OpenAI executive brief."] };
        }),
      };
    }
    return {
      key: "jata-local",
      generateText: vi.fn(async () => ({ texts: ["Local brief."] })),
    };
  }),
}));

vi.mock("@/lib/db", () => {
  const makeBiz = (id: string) =>
    id === "biz_a" || id === "biz_b"
      ? {
          id,
          ownerId: "user_owner_p3",
          name: "Savannah Roasters",
          category: "Restaurant",
          city: "Nairobi",
          location: "Westlands, Nairobi",
          whatsappNumber: "+254712345678",
          mpesaPaybill: "400200",
          mpesaTill: null,
          paymentConfirmed: true,
          members: [],
          products: [],
          services: [{ id: "svc_1", name: "Espresso", price: 250 }],
          faqs: [{ id: "faq_1", question: "Hours?", approvedAnswer: "8am-8pm", isActive: true }],
          offer: state.offers.get(id) ?? null,
          aiSettings: { tone: "friendly" },
          hours: [{ day: "Monday", open: "08:00", close: "20:00", isClosed: false }],
        }
      : null;

  const mockDb: any = {
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: any) => {
      if (state.dbLedgerOutage) {
        throw new Error("Simulated PostgreSQL connection outage during budget transaction");
      }
      return fn(mockDb);
    }),
    business: {
      findFirst: async ({ where }: any) => {
        const b = makeBiz(where.id);
        if (!b) return null;
        if (where.ownerId && b.ownerId !== where.ownerId) return null;
        return b;
      },
      findUnique: async ({ where }: any) => makeBiz(where.id),
    },
    businessMember: {
      findFirst: async () => null,
      findMany: async () => [],
      findUnique: async () => null,
    },
    subscription: { findUnique: async () => null },
    posSubscription: { findUnique: async () => null },
    autopilotSubscription: {
      findUnique: async ({ where }: any) =>
        state.entitlements.get(where.businessId) ?? {
          id: `sub_${where.businessId}`,
          businessId: where.businessId,
          planKey: "JATA_AUTOPILOT_PRO",
          status: "ACTIVE",
          startAt: new Date("2026-10-01T00:00:00Z"),
          expiresAt: new Date("2026-11-01T00:00:00Z"),
          graceUntil: new Date("2026-11-04T00:00:00Z"),
        },
    },
    autopilotEntitlement: {
      findUnique: async () => null,
      upsert: async ({ create }: any) => ({ id: nextId("ent"), ...create }),
    },
    autopilotConfiguration: {
      findUnique: async ({ where }: any) =>
        state.configs.get(where.businessId) ?? {
          id: `cfg_${where.businessId}`,
          businessId: where.businessId,
          autonomyMode: "ASSISTED",
          operationalStatus: "LIVE",
          industryPackKey: "restaurant_cafe_bakery",
          quietHoursStart: "20:00",
          quietHoursEnd: "07:00",
          timezone: "Africa/Nairobi",
          dailySpendCapMinorKES: 25_000,
          maxBatchRecipients: 50,
          maxAutoDiscountPct: 0,
          voiceEnabled: false,
          version: 1,
        },
      upsert: async ({ where, create, update }: any) => {
        const cur = state.configs.get(where.businessId);
        const saved = cur ? { ...cur, ...update } : { id: nextId("cfg"), ...create };
        state.configs.set(where.businessId, saved);
        return saved;
      },
    },
    autopilotUsageLedger: {
      findMany: async ({ where }: any) => {
        if (state.dbLedgerOutage) {
          throw new Error("Simulated PostgreSQL outage on autopilotUsageLedger.findMany");
        }
        return state.usageRows.filter(
          (u) =>
            u.businessId === where.businessId &&
            (!where.periodKey || u.periodKey === where.periodKey),
        );
      },
      findUnique: async ({ where }: any) => {
        if (state.dbLedgerOutage) {
          throw new Error("Simulated PostgreSQL outage on autopilotUsageLedger.findUnique");
        }
        return state.usageRows.find((u) => u.idempotencyKey === where.idempotencyKey) ?? null;
      },
      create: async ({ data }: any) => {
        if (state.dbLedgerOutage) {
          throw new Error("Simulated PostgreSQL outage on autopilotUsageLedger.create");
        }
        if (state.usageRows.some((u) => u.idempotencyKey === data.idempotencyKey)) {
          const err: any = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        const row = { id: nextId("led"), ...data };
        state.usageRows.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const before = state.usageRows.length;
        state.usageRows = state.usageRows.filter(
          (u) =>
            !(
              u.idempotencyKey === where.idempotencyKey &&
              (!where.businessId || u.businessId === where.businessId)
            ),
        );
        return { count: before - state.usageRows.length };
      },
    },
    autopilotIngestionRecord: {
      create: async ({ data }: any) => {
        if (state.dbIngestWriteOutage) {
          throw new Error("Simulated PostgreSQL outage on autopilotIngestionRecord.create");
        }
        const row = { id: nextId("ing"), createdAt: new Date(), ...data };
        state.ingestRows.push(row);
        return row;
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
    offer: {
      findUnique: async ({ where }: any) => state.offers.get(where.businessId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = state.offers.get(where.businessId);
        const next = cur ? { ...cur, ...update } : { id: nextId("off"), ...create };
        state.offers.set(where.businessId, next);
        return next;
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
    autopilotCustomerProfile: {
      findUnique: async () => ({
        id: "prof_1",
        businessId: "biz_a",
        phoneNormalized: "+254722111222",
      }),
      findFirst: async () => null,
    },
    autopilotConsentRecord: {
      findUnique: async () => ({
        id: "con_1",
        businessId: "biz_a",
        customerProfileId: "prof_1",
        channel: "WHATSAPP",
        scope: "TRANSACTIONAL",
        status: "OPTED_IN",
      }),
      findMany: async () => [],
    },
    order: { findMany: async () => [] },
    booking: { findMany: async () => [] },
    analyticsEvent: { count: async () => 0 },
    posSale: { findMany: async () => [] },
    posInventoryItem: { findMany: async () => [] },
    posCustomer: { findMany: async () => [] },
    unansweredQuestion: { findMany: async () => [] },
    autopilotSession: {
      create: async ({ data }: any) => ({ id: nextId("sess"), ...data }),
      findFirst: async () => null,
    },
    autopilotMessage: {
      create: async ({ data }: any) => ({ id: nextId("msg"), ...data }),
    },
    autopilotAuditEvent: {
      create: async ({ data }: any) => {
        const row = { id: nextId("aud"), ...data };
        state.audits.push(row);
        return row;
      },
      findMany: async () => state.audits,
    },
    auditEvent: {
      create: async ({ data }: any) => ({ id: nextId("sysaud"), ...data }),
    },
  };
  return { default: mockDb, prisma: mockDb };
});

import {
  evaluateAutopilotBudget,
  reserveAutopilotBudget,
} from "@/lib/autopilot/usage";
import { handleOwnerCommandTurn } from "@/lib/autopilot/command-center";
import {
  approveAndExecuteProposal,
  dispatchQueuedAutopilotFollowup,
  proposeAutopilotAction,
  validateAutopilotActionPayload,
} from "@/lib/autopilot/actions";
import { evaluateAutopilotActionPolicy } from "@/lib/autopilot/policy";
import {
  MAX_INGEST_BYTES,
  UNVERIFIED_METADATA_SENTINEL,
} from "@/lib/autopilot/security";
import { POST as postCommandRoute } from "@/app/api/autopilot/command/route";
import { POST as postIngestRoute } from "@/app/api/autopilot/ingest/route";
import { POST as postProposalsRoute } from "@/app/api/autopilot/proposals/route";

describe("F13 Remediation — Fail-Closed Budget Reservation & Usage Verification", () => {
  beforeEach(() => {
    idSeq = 1;
    state.session = { userId: "user_owner_p3", email: "owner-p3@example.com", role: "USER" };
    state.dbLedgerOutage = false;
    state.dbIngestWriteOutage = false;
    state.providerMode = "jata-local";
    state.paidLlmCalls = 0;
    state.usageRows = [];
    state.ingestRows = [];
    state.proposals.clear();
    state.configs.clear();
    state.entitlements.clear();
    state.offers.clear();
    state.notifications.clear();
    state.audits = [];
  });

  it("fails closed on DB outage for paid providers and default callers, allowing fallback strictly for explicit zero-cost jata-local previews", async () => {
    state.dbLedgerOutage = true;

    const paidReservation = await reserveAutopilotBudget({
      businessId: "biz_a",
      tierKey: "PRO",
      capability: "LLM_REASONING",
      provider: "openai",
      idempotencyKey: "outage_paid_1",
    });
    expect(paidReservation.allowed).toBe(false);
    if (paidReservation.allowed === false) {
      expect(paidReservation.code).toBe("BUDGET_VERIFICATION_UNAVAILABLE");
      expect(paidReservation.summary.verificationAvailable).toBe(false);
    }

    // Even if a caller passes allowZeroCostReadOnlyPreviewFallback: true, paid providers STILL fail closed
    const spoofedPaidFallback = await reserveAutopilotBudget({
      businessId: "biz_a",
      tierKey: "PRO",
      capability: "LLM_REASONING",
      provider: "openai",
      idempotencyKey: "outage_paid_2",
      allowZeroCostReadOnlyPreviewFallback: true,
    });
    expect(spoofedPaidFallback.allowed).toBe(false);
    if (spoofedPaidFallback.allowed === false) {
      expect(spoofedPaidFallback.code).toBe("BUDGET_VERIFICATION_UNAVAILABLE");
    }

    // Default jata-local without explicit preview flag ALSO fails closed
    const defaultLocal = await reserveAutopilotBudget({
      businessId: "biz_a",
      tierKey: "PRO",
      capability: "WORKFLOW_STEP",
      provider: "jata-local",
      idempotencyKey: "outage_local_mutating",
    });
    expect(defaultLocal.allowed).toBe(false);

    // evaluateAutopilotBudget also fails closed on DB outage unless zero-cost preview flag + jata-local
    const evalOutage = await evaluateAutopilotBudget({
      businessId: "biz_a",
      tierKey: "PRO",
      capability: "VISION_EXTRACT",
      provider: "openai",
    });
    expect(evalOutage.allowed).toBe(false);
    if (evalOutage.allowed === false) {
      expect(evalOutage.code).toBe("BUDGET_VERIFICATION_UNAVAILABLE");
    }

    // Explicit read-only zero-cost jata-local preview is allowed without external side effects
    const zeroCostPreview = await reserveAutopilotBudget({
      businessId: "biz_a",
      tierKey: "PREVIEW",
      capability: "LLM_REASONING",
      provider: "jata-local",
      idempotencyKey: "outage_preview_ok",
      allowZeroCostReadOnlyPreviewFallback: true,
    });
    expect(zeroCostPreview.allowed).toBe(true);
    if (zeroCostPreview.allowed) {
      expect(zeroCostPreview.zeroCostPreviewFallback).toBe(true);
    }
  });

  it("blocks paid LLM command turns with HTTP 503 during DB outages while permitting zero-cost read-only jata-local diagnosis previews", async () => {
    state.dbLedgerOutage = true;
    state.providerMode = "openai";

    const paidRouteRes = await postCommandRoute(
      new Request("http://localhost/api/autopilot/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          message: "Summarize our operational health today.",
        }),
      }),
    );
    expect(paidRouteRes.status).toBe(503);
    const paidBody = await paidRouteRes.json();
    expect(paidBody.blockedCode).toBe("BUDGET_VERIFICATION_UNAVAILABLE");
    expect(state.paidLlmCalls).toBe(0);

    // Switch to zero-cost deterministic jata-local for a pure read-only preview question -> allowed
    state.providerMode = "jata-local";
    const freePreviewTurn = await handleOwnerCommandTurn({
      businessId: "biz_a",
      actorUserId: "user_owner_p3",
      actorRole: "OWNER",
      message: "What is our grounded diagnosis right now?",
    });
    expect(freePreviewTurn.ok).toBe(true);
    expect(freePreviewTurn.providerUsed).toBe("jata-local");
    expect(state.paidLlmCalls).toBe(0);
    expect(state.proposals.size).toBe(0);

    // Even on jata-local, a command that creates a proposal is NOT read-only -> fails closed on DB budget outage
    const mutatingLocalTurn = await handleOwnerCommandTurn({
      businessId: "biz_a",
      actorUserId: "user_owner_p3",
      actorRole: "OWNER",
      message: "Create an offer: Espresso Happy Hour",
    });
    expect(mutatingLocalTurn.ok).toBe(false);
    expect(mutatingLocalTurn.blockedCode).toBe("BUDGET_VERIFICATION_UNAVAILABLE");
  });

  it("fails closed on proposal execution, outbound provider dispatch, and ingestion when DB budget accounting is unavailable", async () => {
    const now = new Date("2026-10-25T09:00:00Z"); // 12:00 EAT
    const prop = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_p3",
      actorRole: "OWNER",
      actionType: "CREATE_OR_UPDATE_OFFER",
      title: "Roastery Bundle",
      rationale: "Boost morning ticket size",
      payload: {
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Roastery Bundle",
        description: "Pour-over + croissant",
      },
      idempotencyKey: "prop_f13_exec",
      now,
    });
    expect(prop.ok).toBe(true);
    if (prop.ok === false) return;

    // Simulate DB outage right before execution -> fails closed with 503, zero offer mutations, proposal stays PROPOSED
    state.dbLedgerOutage = true;
    const execAttempt = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: prop.proposal.id,
      actorUserId: "user_owner_p3",
      actorRole: "OWNER",
      now,
    });
    expect(execAttempt.ok).toBe(false);
    if (execAttempt.ok === false) {
      expect(execAttempt.code).toBe("BUDGET_VERIFICATION_UNAVAILABLE");
      expect(execAttempt.status).toBe(503);
    }
    expect(state.offers.size).toBe(0);
    expect(state.proposals.get(prop.proposal.id)?.status).toBe("PROPOSED");

    // Outbound provider dispatch also refuses to call external gateway during DB budget outage
    state.notifications.set("ntf_staged_1", {
      id: "ntf_staged_1",
      businessId: "biz_a",
      channel: "WHATSAPP",
      recipientNumber: "+254722111222",
      status: "PENDING",
      referenceId: "prop_staged_1",
    });
    const sendSpy = vi.fn(async () => ({ delivered: true, providerMessageId: "wamid.123" }));
    const dispatchRes = await dispatchQueuedAutopilotFollowup({
      businessId: "biz_a",
      notificationId: "ntf_staged_1",
      sendViaProvider: sendSpy,
      now,
    });
    expect(dispatchRes.ok).toBe(false);
    if (dispatchRes.ok === false) {
      expect(dispatchRes.code).toBe("BUDGET_VERIFICATION_UNAVAILABLE");
    }
    expect(sendSpy).not.toHaveBeenCalled();

    // Ingestion route fails closed with 503 on DB budget outage
    const ingestOutageRes = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "menu.csv",
          mimeType: "text/csv",
          textContent: "item,price\nLatte,320",
        }),
      }),
    );
    expect(ingestOutageRes.status).toBe(503);
    const ingestOutageJson = await ingestOutageRes.json();
    expect(ingestOutageJson.code).toBe("BUDGET_VERIFICATION_UNAVAILABLE");
  });

  it("prevents cross-tenant idempotency key collision and releases budget when ingest persistence fails", async () => {
    const first = await reserveAutopilotBudget({
      businessId: "biz_a",
      tierKey: "PRO",
      capability: "VISION_EXTRACT",
      provider: "jata-multimodal-guard",
      idempotencyKey: "shared_idem_key",
    });
    expect(first.allowed).toBe(true);

    const crossTenantReplay = await reserveAutopilotBudget({
      businessId: "biz_b",
      tierKey: "PRO",
      capability: "VISION_EXTRACT",
      provider: "jata-multimodal-guard",
      idempotencyKey: "shared_idem_key",
    });
    expect(crossTenantReplay.allowed).toBe(false);
    if (crossTenantReplay.allowed === false) {
      expect(crossTenantReplay.code).toBe("IDEMPOTENCY_TENANT_CONFLICT");
    }

    // If ingestion record persistence throws after budget reservation, reservation is released and 503 returned
    state.dbIngestWriteOutage = true;
    const beforeLedgerLen = state.usageRows.length;
    const failedPersistRes = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "catalogue.csv",
          mimeType: "text/csv",
          textContent: "sku,price\nBEAN-1,1200",
        }),
      }),
    );
    expect(failedPersistRes.status).toBe(503);
    expect(state.usageRows.length).toBe(beforeLedgerLen);
  });
});

describe("F9 Remediation — Binary Ingestion Integrity, 5 MB Boundary & Verified SHA-256", () => {
  const SYNTHETIC_64_ZERO_SHA256 = crypto
    .createHash("sha256")
    .update(Buffer.alloc(64, 0))
    .digest("hex");

  beforeEach(() => {
    idSeq = 1;
    state.session = { userId: "user_owner_p3", email: "owner-p3@example.com", role: "USER" };
    state.dbLedgerOutage = false;
    state.dbIngestWriteOutage = false;
    state.usageRows = [];
    state.ingestRows = [];
    state.audits = [];
  });

  it("accepts exact 5 MB (5,242,880 bytes) binary payload with verified real SHA-256 and rejects 5,242,881 bytes with HTTP 413 before budget reservation", async () => {
    expect(MAX_INGEST_BYTES).toBe(5 * 1024 * 1024);

    const exactBuf = Buffer.alloc(MAX_INGEST_BYTES);
    for (let i = 0; i < exactBuf.length; i += 4096) {
      exactBuf[i] = (i / 4096) & 0xff;
    }
    const expectedExactSha = crypto.createHash("sha256").update(exactBuf).digest("hex");

    const exactRes = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "exact-5mb.pdf",
          mimeType: "application/pdf",
          contentBase64: exactBuf.toString("base64"),
          byteSize: MAX_INGEST_BYTES,
        }),
      }),
    );
    expect(exactRes.status).toBe(200);
    const exactJson = await exactRes.json();
    expect(exactJson.record.byteSize).toBe(MAX_INGEST_BYTES);
    expect(exactJson.record.sha256Hash).toBe(expectedExactSha);
    expect(exactJson.record.sha256Verified).toBe(true);
    expect(exactJson.record.digestStatus).toBe("VERIFIED_SHA256");
    expect(state.usageRows).toHaveLength(1);

    // 1 byte over MAX_INGEST_BYTES (5,242,881 bytes) -> HTTP 413 FILE_TOO_LARGE and ZERO new budget reservations
    const overBuf = Buffer.alloc(MAX_INGEST_BYTES + 1, 0x41);
    const overRes = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "over-5mb-by-1.pdf",
          mimeType: "application/pdf",
          contentBase64: overBuf.toString("base64"),
        }),
      }),
    );
    expect(overRes.status).toBe(413);
    const overJson = await overRes.json();
    expect(overJson.code).toBe("FILE_TOO_LARGE");
    expect(state.usageRows).toHaveLength(1); // unchanged!

    // Over-limit textContent (5,242,881 UTF-8 bytes) -> HTTP 413 before budget reservation
    const overTextRes = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "over-5mb.txt",
          mimeType: "text/plain",
          textContent: "x".repeat(MAX_INGEST_BYTES + 1),
        }),
      }),
    );
    expect(overTextRes.status).toBe(413);
    expect((await overTextRes.json()).code).toBe("FILE_TOO_LARGE");
    expect(state.usageRows).toHaveLength(1);
  });

  it("closes the 5–10 MB declared byteSize clamp bypass and oversized Content-Length envelopes with HTTP 413", async () => {
    for (const bypassSize of [5_242_881, 6_000_000, 8_500_000, 10_485_760, 25_000_000]) {
      const res = await postIngestRoute(
        new Request("http://localhost/api/autopilot/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId: "biz_a",
            fileName: "large-scan.png",
            mimeType: "image/png",
            byteSize: bypassSize,
            metadataOnly: true,
          }),
        }),
      );
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.code).toBe("FILE_TOO_LARGE");
    }

    // Oversized Content-Length header rejected immediately with 413 before reading body
    const header413 = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "15000000",
        },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "tiny.txt",
          mimeType: "text/plain",
          textContent: "hello",
        }),
      }),
    );
    expect(header413.status).toBe(413);
    expect((await header413.json()).code).toBe("FILE_TOO_LARGE");
    expect(state.usageRows).toHaveLength(0);
  });

  it("rejects missing bytes without metadataOnly, never fabricates zero-byte SHA-256 digests, and marks metadataOnly explicitly unverified", async () => {
    // Missing bytes (no textContent, no contentBase64, metadataOnly omitted) -> 400 MISSING_ARTIFACT_BYTES
    const missingBytesRes = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "scan.png",
          mimeType: "image/png",
          byteSize: 2048,
        }),
      }),
    );
    expect(missingBytesRes.status).toBe(400);
    expect((await missingBytesRes.json()).code).toBe("MISSING_ARTIFACT_BYTES");
    expect(state.ingestRows).toHaveLength(0);
    expect(state.usageRows).toHaveLength(0);

    // Explicit metadataOnly: true -> sha256Hash is null (absent), sha256Verified is false, DB sentinel is UNVERIFIED_METADATA_ONLY
    const metaOnlyRes = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "external-catalogue.pdf",
          mimeType: "application/pdf",
          byteSize: 4096,
          metadataOnly: true,
        }),
      }),
    );
    expect(metaOnlyRes.status).toBe(200);
    const metaJson = await metaOnlyRes.json();
    expect(metaJson.record.sha256Hash).toBeNull();
    expect(metaJson.record.sha256Verified).toBe(false);
    expect(metaJson.record.digestStatus).toBe("UNVERIFIED_NO_BYTES");
    expect(state.ingestRows[0].sha256Hash).toBe(UNVERIFIED_METADATA_SENTINEL);
    expect(state.ingestRows[0].sha256Hash).not.toBe(SYNTHETIC_64_ZERO_SHA256);
  });

  it("computes real SHA-256 over multipart binary uploads and rejects empty text, size mismatches, and malformed requests", async () => {
    // Multipart binary upload with real PNG header bytes
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef,
    ]);
    const expectedPngSha = crypto.createHash("sha256").update(pngBytes).digest("hex");
    const form = new FormData();
    form.set("businessId", "biz_a");
    form.set("byteSize", String(pngBytes.length));
    form.set(
      "file",
      new File([pngBytes], "menu-photo.png", { type: "image/png" }),
    );
    const multipartRes = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        body: form,
      }),
    );
    expect(multipartRes.status).toBe(200);
    const mpJson = await multipartRes.json();
    expect(mpJson.record.sha256Hash).toBe(expectedPngSha);
    expect(mpJson.record.sha256Hash).not.toBe(SYNTHETIC_64_ZERO_SHA256);
    expect(mpJson.record.sha256Verified).toBe(true);
    expect(mpJson.record.byteSize).toBe(pngBytes.length);

    // Empty text & whitespace-only text -> 400 EMPTY_ARTIFACT
    for (const emptyText of ["", "   \n\t  "]) {
      const res = await postIngestRoute(
        new Request("http://localhost/api/autopilot/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId: "biz_a",
            fileName: "empty.txt",
            mimeType: "text/plain",
            textContent: emptyText,
          }),
        }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("EMPTY_ARTIFACT");
    }

    // Declared vs actual size mismatch on text and binary -> 400 BYTE_SIZE_MISMATCH
    const mismatchText = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "prices.csv",
          mimeType: "text/csv",
          textContent: "item,price\nTea,150",
          byteSize: 999,
        }),
      }),
    );
    expect(mismatchText.status).toBe(400);
    expect((await mismatchText.json()).code).toBe("BYTE_SIZE_MISMATCH");

    const mismatchBin = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "photo.png",
          mimeType: "image/png",
          contentBase64: pngBytes.toString("base64"),
          byteSize: pngBytes.length + 5,
        }),
      }),
    );
    expect(mismatchBin.status).toBe(400);
    expect((await mismatchBin.json()).code).toBe("BYTE_SIZE_MISMATCH");

    // Malformed requests: bad JSON, JSON array, unknown key, invalid byteSize, bad base64, dual payload, inline data URL
    const badJson = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{broken-json",
      }),
    );
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).code).toBe("MALFORMED_INGEST_REQUEST");

    const arrayJson = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "[1,2,3]",
      }),
    );
    expect(arrayJson.status).toBe(400);
    expect((await arrayJson.json()).code).toBe("MALFORMED_INGEST_REQUEST");

    const unknownField = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "a.txt",
          textContent: "hello",
          unexpectedKey: 123,
        }),
      }),
    );
    expect(unknownField.status).toBe(400);
    expect((await unknownField.json()).code).toBe("MALFORMED_INGEST_REQUEST");

    for (const invalidSize of [-1, 1.5, "100", null]) {
      const badSize = await postIngestRoute(
        new Request("http://localhost/api/autopilot/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId: "biz_a",
            fileName: "a.txt",
            textContent: "hello",
            byteSize: invalidSize,
          }),
        }),
      );
      expect(badSize.status).toBe(400);
      expect((await badSize.json()).code).toBe("INVALID_BYTE_SIZE");
    }

    const badB64 = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "a.png",
          mimeType: "image/png",
          contentBase64: "%%%not-valid-base64%%%",
        }),
      }),
    );
    expect(badB64.status).toBe(400);
    expect((await badB64.json()).code).toBe("MALFORMED_BASE64_CONTENT");

    const dualPayload = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "a.txt",
          mimeType: "text/plain",
          textContent: "hello",
          contentBase64: Buffer.from("hello").toString("base64"),
        }),
      }),
    );
    expect(dualPayload.status).toBe(400);
    expect((await dualPayload.json()).code).toBe("AMBIGUOUS_INGEST_CONTENT");

    const inlineDataUrl = await postIngestRoute(
      new Request("http://localhost/api/autopilot/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          fileName: "a.png",
          mimeType: "image/png",
          contentBase64: "data:image/png;base64,iVBORw0KGgo=",
        }),
      }),
    );
    expect(inlineDataUrl.status).toBe(400);
    expect((await inlineDataUrl.json()).code).toBe("INLINE_IMAGE_DATA_FORBIDDEN");
  });
});

describe("F10 Remediation — Canonical batchRecipientCount Validation & Pre-Execution Cap Enforcement", () => {
  const baseFollowup = {
    actionType: "QUEUE_CONSENTED_FOLLOWUP" as const,
    recipientPhone: "+254722111222",
    channel: "WHATSAPP" as const,
    scope: "TRANSACTIONAL" as const,
    body: "Your Savannah Roasters order is ready for pickup.",
  };

  beforeEach(() => {
    idSeq = 1;
    state.session = { userId: "user_owner_p3", email: "owner-p3@example.com", role: "USER" };
    state.dbLedgerOutage = false;
    state.usageRows = [];
    state.proposals.clear();
    state.configs.clear();
    state.notifications.clear();
    state.audits = [];
  });

  it("rejects NaN, Infinity, fractions, 0, negatives, oversized counts, recipientCount, and unknown fields across both validator and policy engine", () => {
    const invalidNumbers: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
      -50,
      1.5,
      0.1,
      "10",
      null,
      {},
    ];

    for (const badVal of invalidNumbers) {
      const valRes = validateAutopilotActionPayload(
        "QUEUE_CONSENTED_FOLLOWUP",
        { ...baseFollowup, batchRecipientCount: badVal },
        { maxBatchRecipients: 50 },
      );
      expect(valRes.ok).toBe(false);
      if (valRes.ok === false) {
        expect(valRes.code).toBe("INVALID_BATCH_RECIPIENT_COUNT");
      }

      const polRes = evaluateAutopilotActionPolicy({
        phase: "PROPOSE",
        actorRole: "OWNER",
        entitled: true,
        autonomyMode: "ASSISTED",
        operationalStatus: "LIVE",
        industryPackKey: "restaurant_cafe_bakery",
        actionType: "QUEUE_CONSENTED_FOLLOWUP",
        riskCategory: "MEDIUM_RISK_REVERSIBLE",
        payload: { ...baseFollowup, batchRecipientCount: badVal as any },
        maxBatchRecipients: 50,
        env: {},
      });
      expect(polRes.allowed).toBe(false);
      if (polRes.allowed === false) {
        expect(polRes.code).toBe("INVALID_BATCH_RECIPIENT_COUNT");
      }
    }

    // Legacy/mismatched recipientCount field (alone or paired with batchRecipientCount: 1) -> MISMATCHED_RECIPIENT_COUNT_FIELD
    for (const mismatched of [
      { ...baseFollowup, recipientCount: 5 },
      { ...baseFollowup, batchRecipientCount: 1, recipientCount: 500 },
    ]) {
      const v = validateAutopilotActionPayload("QUEUE_CONSENTED_FOLLOWUP", mismatched, {
        maxBatchRecipients: 50,
      });
      expect(v.ok).toBe(false);
      if (v.ok === false) {
        expect(v.code).toBe("MISMATCHED_RECIPIENT_COUNT_FIELD");
      }

      const p = evaluateAutopilotActionPolicy({
        phase: "PROPOSE",
        actorRole: "OWNER",
        entitled: true,
        autonomyMode: "ASSISTED",
        operationalStatus: "LIVE",
        industryPackKey: "restaurant_cafe_bakery",
        actionType: "QUEUE_CONSENTED_FOLLOWUP",
        riskCategory: "MEDIUM_RISK_REVERSIBLE",
        payload: mismatched as any,
        maxBatchRecipients: 50,
        env: {},
      });
      expect(p.allowed).toBe(false);
      if (p.allowed === false) {
        expect(p.code).toBe("MISMATCHED_RECIPIENT_COUNT_FIELD");
      }
    }

    // Unknown recipient-count aliases rejected
    for (const alias of ["recipients", "batchSize", "recipientTotal", "count"]) {
      const aliasRes = validateAutopilotActionPayload(
        "QUEUE_CONSENTED_FOLLOWUP",
        { ...baseFollowup, [alias]: 500 },
        { maxBatchRecipients: 50 },
      );
      expect(aliasRes.ok).toBe(false);
      if (aliasRes.ok === false) {
        expect(aliasRes.code).toBe("UNKNOWN_FOLLOWUP_PAYLOAD_FIELD");
      }
    }

    // Oversized value (51 > 50) rejected
    const overCap = validateAutopilotActionPayload(
      "QUEUE_CONSENTED_FOLLOWUP",
      { ...baseFollowup, batchRecipientCount: 51 },
      { maxBatchRecipients: 50 },
    );
    expect(overCap.ok).toBe(false);
    if (overCap.ok === false) {
      expect(overCap.code).toBe("BATCH_RECIPIENT_CAP_EXCEEDED");
    }

    // Valid boundaries: omitted (-> 1), 1, and exact maxBatchRecipients (50)
    const omittedOk = validateAutopilotActionPayload("QUEUE_CONSENTED_FOLLOWUP", baseFollowup, {
      maxBatchRecipients: 50,
    });
    expect(omittedOk.ok).toBe(true);
    if (omittedOk.ok && omittedOk.payload.actionType === "QUEUE_CONSENTED_FOLLOWUP") {
      expect(omittedOk.payload.batchRecipientCount).toBe(1);
    }

    const minOk = validateAutopilotActionPayload(
      "QUEUE_CONSENTED_FOLLOWUP",
      { ...baseFollowup, batchRecipientCount: 1 },
      { maxBatchRecipients: 50 },
    );
    expect(minOk.ok).toBe(true);

    const exactCapOk = validateAutopilotActionPayload(
      "QUEUE_CONSENTED_FOLLOWUP",
      { ...baseFollowup, batchRecipientCount: 50 },
      { maxBatchRecipients: 50 },
    );
    expect(exactCapOk.ok).toBe(true);
  });

  it("enforces batchRecipientCount cap at API proposal boundary AND re-validates before approval and execution", async () => {
    const now = new Date("2026-10-25T09:00:00Z"); // 12:00 EAT

    // API proposal route rejects recipientCount smuggling with 400
    const smuggledRoute = await postProposalsRoute(
      new Request("http://localhost/api/autopilot/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          actionType: "QUEUE_CONSENTED_FOLLOWUP",
          title: "Smuggled recipientCount",
          rationale: "Test F10",
          idempotencyKey: "f10_smuggle_1",
          payload: { ...baseFollowup, recipientCount: 250 },
        }),
      }),
    );
    expect(smuggledRoute.status).toBe(400);
    expect((await smuggledRoute.json()).code).toBe("MISMATCHED_RECIPIENT_COUNT_FIELD");

    // API proposal route rejects batchRecipientCount > maxBatchRecipients (51 > 50) with 409
    const oversizedRoute = await postProposalsRoute(
      new Request("http://localhost/api/autopilot/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: "biz_a",
          actionType: "QUEUE_CONSENTED_FOLLOWUP",
          title: "Oversized followup",
          rationale: "Test F10",
          idempotencyKey: "f10_oversize_1",
          payload: { ...baseFollowup, batchRecipientCount: 51 },
        }),
      }),
    );
    expect(oversizedRoute.status).toBe(409);
    expect((await oversizedRoute.json()).code).toBe("BATCH_RECIPIENT_CAP_EXCEEDED");

    // Create valid proposal at batchRecipientCount = 25 when maxBatchRecipients = 50
    const created = await proposeAutopilotAction({
      businessId: "biz_a",
      actorUserId: "user_owner_p3",
      actorRole: "OWNER",
      actionType: "QUEUE_CONSENTED_FOLLOWUP",
      title: "Valid 25-recipient batch",
      rationale: "Order pickup updates",
      payload: { ...baseFollowup, batchRecipientCount: 25 },
      idempotencyKey: "f10_pre_exec_cap",
      now,
    });
    expect(created.ok).toBe(true);
    if (created.ok === false) return;

    // Owner lowers tenant maxBatchRecipients from 50 -> 10 BEFORE approving proposal
    state.configs.set("biz_a", {
      id: "cfg_biz_a",
      businessId: "biz_a",
      autonomyMode: "ASSISTED",
      operationalStatus: "LIVE",
      industryPackKey: "restaurant_cafe_bakery",
      quietHoursStart: "20:00",
      quietHoursEnd: "07:00",
      timezone: "Africa/Nairobi",
      dailySpendCapMinorKES: 25_000,
      maxBatchRecipients: 10,
      maxAutoDiscountPct: 0,
      voiceEnabled: false,
      version: 2,
    });

    // Execution re-validates against lowered maxBatchRecipients BEFORE CAS approval, budget reservation, or notification creation
    const blockedExec = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: created.proposal.id,
      actorUserId: "user_owner_p3",
      actorRole: "OWNER",
      now,
    });
    expect(blockedExec.ok).toBe(false);
    if (blockedExec.ok === false) {
      expect(blockedExec.code).toBe("BATCH_RECIPIENT_CAP_EXCEEDED");
      expect(blockedExec.status).toBe(409);
    }
    expect(state.proposals.get(created.proposal.id)?.status).toBe("PROPOSED");
    expect(state.usageRows).toHaveLength(0);
    expect(state.notifications.size).toBe(0);

    // Raising maxBatchRecipients to 25 (exact boundary) allows approval & execution cleanly
    state.configs.set("biz_a", {
      ...state.configs.get("biz_a"),
      maxBatchRecipients: 25,
    });
    const allowedExec = await approveAndExecuteProposal({
      businessId: "biz_a",
      proposalId: created.proposal.id,
      actorUserId: "user_owner_p3",
      actorRole: "OWNER",
      now,
    });
    expect(allowedExec.ok).toBe(true);
    expect(state.notifications.size).toBe(1);
    expect(state.usageRows).toHaveLength(1);
  });
});
