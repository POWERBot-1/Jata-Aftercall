import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const state = vi.hoisted(() => ({ userId: "", client: null as any }));
vi.mock("@/lib/auth", () => ({ getSession: async () => state.userId ? { userId: state.userId } : null }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: () => ({ allowed: true }) }));
vi.mock("@/lib/db", () => ({
  default: new Proxy({}, {
    get: (_target, property) => {
      const client = state.client;
      const value = client?.[property as keyof typeof client];
      return typeof value === "function" ? value.bind(client) : value;
    },
  }),
}));

import { GET } from "@/app/api/agents/reports/referrals/reconcile/route";

const enabled = realPrismaConfigured;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const periodKey = "daily:2026-01-01";
const startInclusive = new Date("2026-01-01T00:00:00.000Z");
const endExclusive = new Date("2026-01-02T00:00:00.000Z");
let client: any;
let ownerA: any;
let ownerB: any;
let appA: any;
let appB: any;
let linkId: string | undefined;
const referredApplicationIds: string[] = [];
const referredUserIds: string[] = [];

function request(query = "") {
  return GET(new Request(`https://agent.test/api/agents/reports/referrals/reconcile?periodKey=${encodeURIComponent(periodKey)}&revision=1${query}`));
}

describe.skipIf(!enabled)("agent referral revision pagination against real PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    state.client = client;
    process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true";
    process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED = "true";
    ownerA = await client.user.create({ data: { email: `ref-revision-a-${stamp}@example.test`, passwordHash: "not-a-login", role: "CUSTOMER" } });
    ownerB = await client.user.create({ data: { email: `ref-revision-b-${stamp}@example.test`, passwordHash: "not-a-login", role: "CUSTOMER" } });
    const applicationData = (userId: string, suffix: string) => ({
      userId, fullName: `Synthetic Agent ${suffix}`, phoneE164: `+254700${suffix === "A" ? "000001" : "000002"}`,
      privacyAcknowledgedAt: new Date(), status: "PENDING", agentStatus: "ACTIVE",
    });
    appA = await client.agentApplication.create({ data: applicationData(ownerA.id, "A") });
    appB = await client.agentApplication.create({ data: applicationData(ownerB.id, "B") });

    const link = await client.agentReferralLink.create({ data: {
      referrerApplicationId: appA.id, tokenHash: `ref-revision-link-${stamp}`, expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    } });
    linkId = link.id;
    const referredUsers = await Promise.all([0, 1].map((index) => client.user.create({
      data: { email: `ref-revision-member-${index}-${stamp}@example.test`, passwordHash: "not-a-login", role: "CUSTOMER" },
    })));
    referredUserIds.push(...referredUsers.map((user: any) => user.id));
    const referredApps = await Promise.all(referredUsers.map((user: any, index: number) => client.agentApplication.create({
      data: {
        userId: user.id, fullName: `Synthetic Referred Member ${index}`, phoneE164: `+25470000000${index + 3}`,
        privacyAcknowledgedAt: startInclusive, status: "PENDING", agentStatus: "INACTIVE",
      },
    })));
    referredApplicationIds.push(...referredApps.map((application: any) => application.id));
    await client.agentReferralAttribution.createMany({ data: referredApps.map((application: any) => ({
      referrerApplicationId: appA.id, referredApplicationId: application.id, linkId: link.id,
      consentedAt: startInclusive, source: "REGISTRATION", createdAt: startInclusive,
    })) });

    // The snapshot trigger creates the immutable baseline revision and its members from
    // the actual consented attribution rows. The fixture must not fabricate count-only evidence.
    await client.agentReferralReportSnapshot.create({ data: {
      applicationId: appA.id, periodKey, periodType: "DAILY", startInclusive, endExclusive,
      registrationCount: BigInt(2), existingApplicationCount: BigInt(0),
    } });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      if (appA?.id) {
        await client.agentReferralAttribution.deleteMany({ where: { referrerApplicationId: appA.id } });
        await client.agentReferralReportMember.deleteMany({ where: { applicationId: appA.id } });
        await client.agentReferralReportRevision.deleteMany({ where: { applicationId: appA.id } });
        await client.agentReferralReportSnapshot.deleteMany({ where: { applicationId: appA.id } });
      }
      if (linkId) await client.agentReferralLink.deleteMany({ where: { id: linkId } });
      await client.agentApplication.deleteMany({ where: { id: { in: [appA?.id, appB?.id, ...referredApplicationIds].filter(Boolean) } } });
      await client.user.deleteMany({ where: { id: { in: [ownerA?.id, ownerB?.id, ...referredUserIds].filter(Boolean) } } });
    } finally {
      state.userId = "";
      state.client = null;
      await client.$disconnect?.();
    }
  }, 60_000);

  it("reads the database-generated baseline from real attribution evidence", async () => {
    state.userId = ownerA.id;
    const response = await request();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toMatchObject({
      scope: "OWN_REFERRAL_EVIDENCE_ONLY", members: expect.any(Array),
      sales: "NOT_CHECKED", commission: "NOT_CHECKED",
    });
    expect(body.members).toHaveLength(2);
    expect(body.members.every((member: any) => member.source === "REGISTRATION")).toBe(true);
    expect(body.nextCursor).toBeNull();
  });

  it("cannot select another agent or read that agent's revision", async () => {
    state.userId = ownerB.id;
    const foreign = await request();
    expect(foreign.status).toBe(404);
    const selector = await request(`&applicationId=${encodeURIComponent(appA.id)}`);
    expect(selector.status).toBe(400);
  });
});
