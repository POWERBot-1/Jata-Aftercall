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
const referredApplicationIds = Array.from({ length: 5000 }, (_, index) => `ref-app-${stamp}-${index}`);
const referredUserIds = Array.from({ length: 5000 }, (_, index) => `ref-user-${stamp}-${index}`);

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
    // Use a realistic 5,000-member synthetic referral set so both cursor pages are
    // exercised against the database-generated immutable baseline.
    await client.user.createMany({ data: referredUserIds.map((id, index) => ({
      id, email: `ref-revision-member-${index}-${stamp}@example.test`, passwordHash: "not-a-login", role: "CUSTOMER",
    })) });
    await client.agentApplication.createMany({ data: referredApplicationIds.map((id, index) => ({
      id, userId: referredUserIds[index], fullName: `Synthetic Referred Member ${index}`,
      phoneE164: `+2547${String(index).padStart(8, "0")}`,
      privacyAcknowledgedAt: startInclusive, status: "PENDING", agentStatus: "INACTIVE",
    })) });
    await client.agentReferralAttribution.createMany({ data: referredApplicationIds.map((referredApplicationId, index) => ({
      id: `event-${String(index).padStart(5, "0")}`,
      referrerApplicationId: appA.id, referredApplicationId, linkId: link.id,
      consentedAt: startInclusive, source: "REGISTRATION", createdAt: startInclusive,
    })) });

    // The snapshot trigger creates the immutable baseline revision and its members from
    // the actual consented attribution rows. The fixture must not fabricate count-only evidence.
    await client.agentReferralReportSnapshot.create({ data: {
      applicationId: appA.id, periodKey, periodType: "DAILY", startInclusive, endExclusive,
      registrationCount: BigInt(5000), existingApplicationCount: BigInt(0),
    } });
  }, 60_000);

  afterAll(async () => {
    // This suite runs only against a disposable CI/test database that is discarded after
    // the job. Referral report snapshots, revisions and members are deliberately immutable;
    // attempting to delete the synthetic baseline would violate the production write fence.
    // Retain the isolated fixture and close the connection.
    state.userId = "";
    state.client = null;
    await client?.$disconnect?.();
  }, 60_000);

  it("returns two bounded cursor pages from the database-generated baseline", async () => {
    state.userId = ownerA.id;
    const first = await request();
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(firstBody).toMatchObject({
      scope: "OWN_REFERRAL_EVIDENCE_ONLY", members: expect.any(Array),
      sales: "NOT_CHECKED", commission: "NOT_CHECKED",
    });
    expect(firstBody.members).toHaveLength(2500);
    expect(firstBody.members[0].eventId).toBe("event-00000");
    expect(firstBody.members[2499].eventId).toBe("event-02499");
    expect(firstBody.members.every((member: any) => member.source === "REGISTRATION")).toBe(true);
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
