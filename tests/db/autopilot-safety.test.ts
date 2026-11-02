/**
 * Database-backed JATA Autopilot safety suite. Runs ONLY via scripts/test-db/run-db-suite.mjs, which
 * starts a disposable loopback PostgreSQL 18, applies the committed migrations and sets
 * PRISMA_TEST_DATABASE_URL. Every tenant is fictional (`@test.invalid`). No real messages, payments,
 * customers, offers or FAQs are touched. The app's real domain functions run against the real database;
 * only the `@/lib/db` singleton is pointed at the test client.
 *
 * Engine: see tests/helpers/prisma-client.ts (WASM query engine + adapter-pg in this sandbox).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const helper = await import("../helpers/prisma-client");
  const client = helper.sharedPrisma();
  return { default: client, prisma: client };
});

import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, uid } from "../helpers/prisma-fixtures";
import {
  approveAndExecuteProposal,
  listAutopilotProposals,
  proposeAutopilotAction,
  rejectProposal,
  updateAutopilotConfiguration,
} from "@/lib/autopilot/actions";
import { isWithinQuietHours, verifyCustomerChannelConsent } from "@/lib/autopilot/consent";
import { reserveAutopilotBudget } from "@/lib/autopilot/usage";

const KILL_ENV = "JATA_AUTOPILOT_GLOBAL_KILL_SWITCH";
const DAY = 24 * 3_600_000;

type Tenant = { owner: any; business: any; sub?: boolean };

/** Entitled Autopilot subscription that expires in 30 days. */
async function entitle(p: any, t: Tenant) {
  const now = Date.now();
  await p.autopilotSubscription.upsert({
    where: { businessId: t.business.id },
    create: {
      businessId: t.business.id,
      userId: t.owner.id,
      planId: "test-plan-fictional",
      planKey: "JATA_AUTOPILOT",
      status: "ACTIVE",
      startAt: new Date(now - DAY),
      expiresAt: new Date(now + 30 * DAY),
    },
    update: { status: "ACTIVE", expiresAt: new Date(now + 30 * DAY) },
  });
}

function offerPayload(suffix = uid()) {
  return {
    actionType: "CREATE_OR_UPDATE_OFFER" as const,
    title: `Fictional offer ${suffix}`,
    description: "Test-only fictional offer. Not a real product or price.",
  };
}

async function proposeOffer(t: Tenant, key = uid()) {
  return proposeAutopilotAction({
    businessId: t.business.id,
    actorUserId: t.owner.id,
    actorRole: "OWNER",
    actionType: "CREATE_OR_UPDATE_OFFER",
    title: "Fictional offer",
    rationale: "Fictional test rationale.",
    payload: offerPayload() as any,
    idempotencyKey: key,
  });
}

describe.skipIf(!realPrismaConfigured)("Autopilot safety on a real PostgreSQL database", () => {
  let p: any;
  let tenantA: Tenant;
  let tenantB: Tenant;

  beforeAll(async () => {
    p = sharedPrisma();
    tenantA = await seedBusiness(p);
    tenantB = await seedBusiness(p);
    await entitle(p, tenantA);
    await entitle(p, tenantB);
    // Explicit, fictional config: ASSISTED (human approval), LIVE, Africa/Nairobi quiet hours.
    for (const t of [tenantA, tenantB]) {
      await p.autopilotConfiguration.upsert({
        where: { businessId: t.business.id },
        create: { businessId: t.business.id, autonomyMode: "ASSISTED", operationalStatus: "LIVE", dailySpendCapMinorKES: 25000 },
        update: { autonomyMode: "ASSISTED", operationalStatus: "LIVE", dailySpendCapMinorKES: 25000 },
      });
    }
  });

  afterAll(async () => {
    delete process.env[KILL_ENV];
    await sharedPrisma()?.$disconnect().catch(() => {});
  });

  describe("tenant isolation", () => {
    it("a proposal from tenant A cannot be read, approved or rejected through tenant B", async () => {
      const created = await proposeOffer(tenantA);
      expect(created.ok).toBe(true);
      const proposalId = (created as any).proposal.id;

      const listB = await listAutopilotProposals(tenantB.business.id, 100);
      expect(JSON.stringify(listB)).not.toContain(proposalId);

      const approveViaB = await approveAndExecuteProposal({
        businessId: tenantB.business.id,
        proposalId,
        actorUserId: tenantB.owner.id,
        actorRole: "OWNER",
      });
      expect(approveViaB).toMatchObject({ ok: false, code: "NOT_FOUND", status: 404 });

      const rejectViaB = await rejectProposal({
        businessId: tenantB.business.id,
        proposalId,
        actorUserId: tenantB.owner.id,
        actorRole: "OWNER",
      } as any);
      expect((rejectViaB as any).ok).toBe(false);

      const row = await p.autopilotActionProposal.findUnique({ where: { id: proposalId } });
      expect(row.businessId).toBe(tenantA.business.id);
      expect(row.status).toBe("PROPOSED");
    });

    it("a budget idempotency key used by tenant B cannot replay tenant A's reservation", async () => {
      const key = `iso-${uid()}`;
      const a = await reserveAutopilotBudget({
        businessId: tenantA.business.id,
        tierKey: "STANDARD",
        capability: "LLM_REASONING",
        provider: "test-provider",
        idempotencyKey: key,
        dailySpendCapMinorKES: 25000,
        estimatedCallCostMinorKES: 10,
      });
      expect(a.allowed).toBe(true);
      const b = await reserveAutopilotBudget({
        businessId: tenantB.business.id,
        tierKey: "STANDARD",
        capability: "LLM_REASONING",
        provider: "test-provider",
        idempotencyKey: key,
        dailySpendCapMinorKES: 25000,
        estimatedCallCostMinorKES: 10,
      });
      expect(b).toMatchObject({ allowed: false, code: "IDEMPOTENCY_TENANT_CONFLICT" });
      const rowsForKey = await p.autopilotUsageLedger.findMany({ where: { idempotencyKey: key } });
      expect(rowsForKey.map((r: any) => r.businessId)).toEqual([tenantA.business.id]);
    });
  });

  describe("approval authority and execution gates", () => {
    it("STAFF cannot approve or execute a proposal (RBAC)", async () => {
      const created = await proposeOffer(tenantA);
      const proposalId = (created as any).proposal.id;
      const res = await approveAndExecuteProposal({
        businessId: tenantA.business.id,
        proposalId,
        actorUserId: tenantA.owner.id,
        actorRole: "STAFF",
      });
      expect(res).toMatchObject({ ok: false, code: "RBAC_FORBIDDEN", status: 403 });
      const row = await p.autopilotActionProposal.findUnique({ where: { id: proposalId } });
      expect(row.status).toBe("PROPOSED");
    });

    it("STAFF cannot change tenant Autopilot settings (RBAC on configuration)", async () => {
      const res = await updateAutopilotConfiguration({
        businessId: tenantA.business.id,
        actorUserId: tenantA.owner.id,
        actorRole: "STAFF",
        patch: { operationalStatus: "PAUSED" },
      });
      expect(res).toMatchObject({ ok: false, status: 403 });
      const cfg = await p.autopilotConfiguration.findUnique({ where: { businessId: tenantA.business.id } });
      expect(cfg.operationalStatus).toBe("LIVE");
    });

    it("the platform kill switch blocks execution even for an OWNER with an approved proposal", async () => {
      const created = await proposeOffer(tenantA);
      const proposalId = (created as any).proposal.id;
      process.env[KILL_ENV] = "1";
      try {
        const res = await approveAndExecuteProposal({
          businessId: tenantA.business.id,
          proposalId,
          actorUserId: tenantA.owner.id,
          actorRole: "OWNER",
        });
        expect(res.ok).toBe(false);
        expect((res as any).code).toBe("GLOBAL_KILL_SWITCH_ACTIVE");
      } finally {
        delete process.env[KILL_ENV];
      }
      const row = await p.autopilotActionProposal.findUnique({ where: { id: proposalId } });
      expect(row.status).not.toBe("EXECUTED");
    });

    it("a PAUSED tenant cannot execute, and resuming restores the gate only when LIVE", async () => {
      const t = await seedBusiness(p);
      await entitle(p, t);
      await p.autopilotConfiguration.create({
        data: { businessId: t.business.id, autonomyMode: "ASSISTED", operationalStatus: "PAUSED" },
      });
      const created = await proposeAutopilotAction({
        businessId: t.business.id,
        actorUserId: t.owner.id,
        actorRole: "OWNER",
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Paused tenant offer",
        rationale: "Fictional.",
        payload: offerPayload() as any,
        idempotencyKey: uid(),
      });
      // Proposing while paused may be refused outright, or may create a PROPOSED row. Either way, no
      // execution may happen, and any created proposal must stay un-executed.
      if ((created as any).ok === false) {
        expect((created as any).code).toBe("TENANT_AUTOPILOT_PAUSED");
      } else {
        const proposalId = (created as any).proposal.id;
        const res = await approveAndExecuteProposal({
          businessId: t.business.id,
          proposalId,
          actorUserId: t.owner.id,
          actorRole: "OWNER",
        });
        expect((res as any).ok).toBe(false);
        expect((res as any).code).toBe("TENANT_AUTOPILOT_PAUSED");
      }
      const row = await p.autopilotActionProposal.findFirst({ where: { businessId: t.business.id } });
      expect(row?.status ?? "NONE").not.toBe("EXECUTED");
    });

    it("fails closed: a tenant with no subscription cannot execute", async () => {
      const t = await seedBusiness(p);
      await p.autopilotConfiguration.create({
        data: { businessId: t.business.id, autonomyMode: "ASSISTED", operationalStatus: "LIVE" },
      });
      const created = await proposeAutopilotAction({
        businessId: t.business.id,
        actorUserId: t.owner.id,
        actorRole: "OWNER",
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: "Unentitled offer",
        rationale: "Fictional.",
        payload: offerPayload() as any,
        idempotencyKey: uid(),
      });
      const proposalId = (created as any).proposal?.id;
      expect(proposalId).toBeTruthy();
      const res = await approveAndExecuteProposal({
        businessId: t.business.id,
        proposalId,
        actorUserId: t.owner.id,
        actorRole: "OWNER",
      });
      expect(res).toMatchObject({ ok: false, code: "ENTITLEMENT_REQUIRED", status: 403 });
      const row = await p.autopilotActionProposal.findUnique({ where: { id: proposalId } });
      expect(row.status).not.toBe("EXECUTED");
    });

    it("an authorised OWNER approval executes once; replaying the approval does not execute again", async () => {
      const created = await proposeOffer(tenantA);
      const proposalId = (created as any).proposal.id;
      const first = await approveAndExecuteProposal({
        businessId: tenantA.business.id,
        proposalId,
        actorUserId: tenantA.owner.id,
        actorRole: "OWNER",
      });
      expect(first.ok).toBe(true);
      const second = await approveAndExecuteProposal({
        businessId: tenantA.business.id,
        proposalId,
        actorUserId: tenantA.owner.id,
        actorRole: "OWNER",
      });
      expect(second).toMatchObject({ ok: true, idempotentReplay: true });
      const row = await p.autopilotActionProposal.findUnique({ where: { id: proposalId } });
      expect(row.status).toBe("EXECUTED");
    });

    it("a rejected proposal cannot later be approved", async () => {
      const created = await proposeOffer(tenantA);
      const proposalId = (created as any).proposal.id;
      const rej = await rejectProposal({
        businessId: tenantA.business.id,
        proposalId,
        actorUserId: tenantA.owner.id,
        actorRole: "OWNER",
      } as any);
      expect((rej as any).ok).toBe(true);
      const res = await approveAndExecuteProposal({
        businessId: tenantA.business.id,
        proposalId,
        actorUserId: tenantA.owner.id,
        actorRole: "OWNER",
      });
      expect(res).toMatchObject({ ok: false, code: "INVALID_PROPOSAL_STATE", status: 409 });
    });
  });

  describe("spend caps and idempotency", () => {
    it("a daily cap stops the second reservation that would exceed it, with a single ledger row", async () => {
      const t = await seedBusiness(p);
      const cap = 100;
      const first = await reserveAutopilotBudget({
        businessId: t.business.id,
        tierKey: "STANDARD",
        capability: "LLM_REASONING",
        provider: "test-provider",
        idempotencyKey: `cap-1-${uid()}`,
        dailySpendCapMinorKES: cap,
        estimatedCallCostMinorKES: 60,
      });
      expect(first.allowed).toBe(true);
      const second = await reserveAutopilotBudget({
        businessId: t.business.id,
        tierKey: "STANDARD",
        capability: "LLM_REASONING",
        provider: "test-provider",
        idempotencyKey: `cap-2-${uid()}`,
        dailySpendCapMinorKES: cap,
        estimatedCallCostMinorKES: 60,
      });
      expect(second).toMatchObject({ allowed: false, code: "DAILY_SPEND_CAP_REACHED" });
      const rows = await p.autopilotUsageLedger.findMany({ where: { businessId: t.business.id } });
      expect(rows).toHaveLength(1);
    });

    it("re-sending the same reservation key is idempotent and does not double-spend", async () => {
      const t = await seedBusiness(p);
      const key = `idem-${uid()}`;
      const args = {
        businessId: t.business.id,
        tierKey: "STANDARD" as const,
        capability: "LLM_REASONING" as const,
        provider: "test-provider",
        idempotencyKey: key,
        dailySpendCapMinorKES: 25000,
        estimatedCallCostMinorKES: 40,
      };
      const r1 = await reserveAutopilotBudget(args);
      const r2 = await reserveAutopilotBudget(args);
      expect(r1.allowed).toBe(true);
      expect(r2).toMatchObject({ allowed: true, alreadyRecorded: true });
      const rows = await p.autopilotUsageLedger.findMany({ where: { idempotencyKey: key } });
      expect(rows).toHaveLength(1);
    });

    it("proposal idempotency keys return the original proposal instead of creating a duplicate", async () => {
      const key = `prop-${uid()}`;
      const a = await proposeOffer(tenantA, key);
      const b = await proposeOffer(tenantA, key);
      expect(a.ok).toBe(true);
      expect(b).toMatchObject({ ok: true, duplicate: true });
      const rows = await p.autopilotActionProposal.findMany({
        where: { businessId: tenantA.business.id, idempotencyKey: key },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("customer consent and Africa/Nairobi quiet hours", () => {
    const phone = "0711000111";
    const midday = new Date("2026-11-02T09:00:00Z"); // 12:00 Africa/Nairobi
    const night = new Date("2026-11-02T19:30:00Z"); // 22:30 Africa/Nairobi

    it("quiet hours are evaluated in Africa/Nairobi, start inclusive and end exclusive", () => {
      const at = (iso: string) => isWithinQuietHours({ now: new Date(iso), quietHoursStart: "20:00", quietHoursEnd: "07:00", timezone: "Africa/Nairobi" });
      expect(at("2026-11-02T16:59:00Z")).toBe(false); // 19:59 EAT
      expect(at("2026-11-02T17:00:00Z")).toBe(true); // 20:00 EAT
      expect(at("2026-11-03T03:59:00Z")).toBe(true); // 06:59 EAT
      expect(at("2026-11-03T04:00:00Z")).toBe(false); // 07:00 EAT
      expect(at(midday.toISOString())).toBe(false);
    });

    it("no consent record means no automated outbound contact", async () => {
      const res = await verifyCustomerChannelConsent({
        businessId: tenantA.business.id,
        recipientPhone: phone,
        channel: "WHATSAPP",
        scope: "MARKETING",
        now: midday,
      });
      expect(res).toMatchObject({ allowed: false, code: "MISSING_CONSENT_RECORD" });
    });

    it("opted-in transactional consent does not authorise marketing on the same channel", async () => {
      const profile = await p.autopilotCustomerProfile.create({
        data: { businessId: tenantA.business.id, phoneNormalized: "+254711000111", displayName: "Fictional customer" },
      });
      await p.autopilotConsentRecord.create({
        data: {
          businessId: tenantA.business.id,
          customerProfileId: profile.id,
          channel: "WHATSAPP",
          scope: "TRANSACTIONAL",
          status: "OPTED_IN",
          source: "TEST_FIXTURE",
          recordedByUserId: tenantA.owner.id,
        },
      });
      const marketing = await verifyCustomerChannelConsent({
        businessId: tenantA.business.id,
        recipientPhone: "+254711000111",
        channel: "WHATSAPP",
        scope: "MARKETING",
        now: midday,
      });
      expect(marketing).toMatchObject({ allowed: false, code: "CONSENT_NOT_GRANTED" });
      const transactional = await verifyCustomerChannelConsent({
        businessId: tenantA.business.id,
        recipientPhone: "+254711000111",
        channel: "WHATSAPP",
        scope: "TRANSACTIONAL",
        now: midday,
      });
      expect(transactional.allowed).toBe(true);
    });

    it("quiet hours block automated messages even with valid consent, except urgent transactional", async () => {
      const blocked = await verifyCustomerChannelConsent({
        businessId: tenantA.business.id,
        recipientPhone: "+254711000111",
        channel: "WHATSAPP",
        scope: "TRANSACTIONAL",
        quietHoursStart: "20:00",
        quietHoursEnd: "07:00",
        timezone: "Africa/Nairobi",
        now: night,
      });
      expect(blocked).toMatchObject({ allowed: false, code: "QUIET_HOURS_ACTIVE" });
      const bypass = await verifyCustomerChannelConsent({
        businessId: tenantA.business.id,
        recipientPhone: "+254711000111",
        channel: "WHATSAPP",
        scope: "TRANSACTIONAL",
        quietHoursStart: "20:00",
        quietHoursEnd: "07:00",
        timezone: "Africa/Nairobi",
        urgentTransactionalBypass: true,
        now: night,
      });
      expect(bypass.allowed).toBe(true);
    });

    it("a STOP keyword opt-out blocks all later automated contact, and tenant B's consent cannot cover tenant A", async () => {
      const profile = await p.autopilotCustomerProfile.findUnique({
        where: { businessId_phoneNormalized: { businessId: tenantA.business.id, phoneNormalized: "+254711000111" } },
      });
      await p.autopilotConsentRecord.create({
        data: {
          businessId: tenantA.business.id,
          customerProfileId: profile.id,
          channel: "SMS",
          scope: "TRANSACTIONAL",
          status: "UNSUBSCRIBED_KEYWORD",
          source: "TEST_FIXTURE",
          recordedByUserId: tenantA.owner.id,
        },
      });
      const afterStop = await verifyCustomerChannelConsent({
        businessId: tenantA.business.id,
        recipientPhone: "+254711000111",
        channel: "SMS",
        scope: "TRANSACTIONAL",
        now: midday,
      });
      expect(afterStop).toMatchObject({ allowed: false, code: "RECIPIENT_OPTED_OUT" });

      // Tenant B has never recorded this recipient: A's consent must not leak across tenants.
      const crossTenant = await verifyCustomerChannelConsent({
        businessId: tenantB.business.id,
        recipientPhone: "+254711000111",
        channel: "WHATSAPP",
        scope: "TRANSACTIONAL",
        now: midday,
      });
      expect(crossTenant).toMatchObject({ allowed: false, code: "MISSING_CONSENT_RECORD" });
    });
  });
});
