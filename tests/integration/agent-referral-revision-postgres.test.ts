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
    await client.agentReferralReportSnapshot.create({ data: {
      applicationId: appA.id, periodKey, periodType: "DAILY", startInclusive, endExclusive,
      registrationCount: BigInt(5000), existingApplicationCount: BigInt(0),
    } });
    await client.agentReferralReportRevision.create({ data: {
      applicationId: appA.id, periodKey, revision: 1, kind: "BASELINE", actorId: ownerA.id,
      registrationCount: BigInt(5000), existingApplicationCount: BigInt(0),
      addedCount: 0, removedCount: 0, changedCount: 0,
    } });
    await client.agentReferralReportMember.createMany({ data: Array.from({ length: 5000 }, (_, index) => ({
      applicationId: appA.id, periodKey, revision: 1,
      eventId: `event-${String(index).padStart(5, "0")}`, source: "REGISTRATION", eventCreatedAt: startInclusive,
    })) });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      if (appA?.id) {
        await client.agentReferralReportMember.deleteMany({ where: { applicationId: appA.id } });
        await client.agentReferralReportRevision.deleteMany({ where: { applicationId: appA.id } });
        await client.agentReferralReportSnapshot.deleteMany({ where: { applicationId: appA.id } });
      }
      await client.agentApplication.deleteMany({ where: { id: { in: [appA?.id, appB?.id].filter(Boolean) } } });
      await client.user.deleteMany({ where: { id: { in: [ownerA?.id, ownerB?.id].filter(Boolean) } } });
    } finally {
      state.userId = "";
      state.client = null;
      await client.$disconnect?.();
    }
  }, 60_000);

  it("returns bounded cursor pages and keeps financial claims explicitly unchecked", async () => {
    state.userId = ownerA.id;
    const first = await request();
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(firstBody).toMatchObject({ scope: "OWN_REFERRAL_EVIDENCE_ONLY", members: expect.any(Array), sales: "NOT_CHECKED", commission: "NOT_CHECKED" });
    expect(firstBody.members).toHaveLength(2500);
    expect(firstBody.members[0].eventId).toBe("event-00000");
    expect(firstBody.members[2499].eventId).toBe("event-02499");
    expect(firstBody.nextCursor).toBe("event-02499");

    const second = await request("&after=event-02499");
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.members).toHaveLength(2500);
    expect(secondBody.members[0].eventId).toBe("event-02500");
    expect(secondBody.members[2499].eventId).toBe("event-04999");
    expect(secondBody.nextCursor).toBeNull();
    expect(secondBody.commission).toBe("NOT_CHECKED");
  });

  it("cannot select another agent or read that agent's revision", async () => {
    state.userId = ownerB.id;
    const foreign = await request();
    expect(foreign.status).toBe(404);
    const selector = await request(`&applicationId=${encodeURIComponent(appA.id)}`);
    expect(selector.status).toBe(400);
  });
});
