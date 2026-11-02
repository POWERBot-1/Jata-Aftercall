/**
 * Real PostgreSQL: an active agent's own referral report snapshots are read in keyset pages.
 * Runs ONLY via scripts/test-db/run-db-suite.mjs (disposable loopback PostgreSQL, committed
 * migrations, fictional users). No messages, payments or live agents are touched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ session: null as null | { userId: string; role: string; email: string } }));

vi.mock("@/lib/db", async () => {
  const helper = await import("../helpers/prisma-client");
  const client = helper.sharedPrisma();
  return { default: client, prisma: client };
});
vi.mock("@/lib/auth", () => ({ getSession: async () => mock.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: () => ({ allowed: true }) }));

import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { uid } from "../helpers/prisma-fixtures";
import { GET } from "@/app/api/agents/reports/referrals/route";
import { encodeReportCursor } from "@/lib/agents/referral-report-cursor";

const DAY = 86_400_000;
// Counts are zero because the baseline trigger requires counts to equal real attribution rows in the
// window; this suite proves paging, ordering, tie-breaking and scope. Count integrity is covered by
// tests/prisma/agent-applications-postgres.test.ts.
const base = Date.UTC(2020, 0, 1, 21, 0, 0); // Nairobi midnight, as stored by the period code
const p = realPrismaConfigured ? sharedPrisma() : null;

async function seedAgent(count: number, tieEndExclusive?: number) {
  const suffix = uid();
  const user = await p.user.create({ data: { email: `agent-page-${suffix}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" } });
  const app = await p.agentApplication.create({
    data: {
      userId: user.id, fullName: "Synthetic Agent", phoneE164: `+2547${suffix.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
      status: "PENDING", agentStatus: "ACTIVE", privacyAcknowledgedAt: new Date(),
    },
  });
  const rows = Array.from({ length: count }, (_, i) => {
    const end = new Date(base + (i + 1) * DAY);
    return { applicationId: app.id, periodKey: `daily:${new Date(base + i * DAY).toISOString().slice(0, 10)}`, periodType: "DAILY", startInclusive: new Date(base + i * DAY), endExclusive: end, registrationCount: BigInt(0), existingApplicationCount: BigInt(0) };
  });
  if (tieEndExclusive !== undefined) {
    // A monthly period sharing an endExclusive with a daily one: ordering must still be total.
    rows.push({ applicationId: app.id, periodKey: "monthly:2020-01", periodType: "MONTHLY", startInclusive: new Date(Date.UTC(2019, 11, 31, 21)), endExclusive: new Date(tieEndExclusive), registrationCount: BigInt(0), existingApplicationCount: BigInt(0) });
  }
  await p.agentReferralReportSnapshot.createMany({ data: rows });
  return { user, app, expected: rows.length };
}

const asUser = (userId: string) => { mock.session = { userId, role: "CUSTOMER", email: "x@test.invalid" }; };
const page = async (cursor?: string) => {
  const url = cursor ? `https://agent.test/api/agents/reports/referrals?cursor=${encodeURIComponent(cursor)}` : "https://agent.test/api/agents/reports/referrals";
  const res = await GET(new Request(url));
  return { status: res.status, body: await res.json() };
};

describe.skipIf(!realPrismaConfigured)("real PostgreSQL: own referral report snapshot pagination", () => {
  let previousFlag: string | undefined;
  beforeAll(() => { previousFlag = process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED; process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true"; });
  afterAll(() => { if (previousFlag === undefined) delete process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED; else process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = previousFlag; });

  it("returns every own snapshot exactly once, newest first, across pages, and never another agent's", async () => {
    const other = await seedAgent(3);
    // 105 own rows, plus a monthly row that ties with the daily row ending at base+50 days.
    const own = await seedAgent(105, base + 50 * DAY);
    asUser(own.user.id);

    const first = await page();
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(100);
    expect(first.body.truncated).toBe(true);
    expect(typeof first.body.nextCursor).toBe("string");

    const second = await page(first.body.nextCursor);
    expect(second.status).toBe(200);
    expect(second.body.truncated).toBe(false);
    expect(second.body.nextCursor).toBeNull();

    const all = [...first.body.items, ...second.body.items];
    expect(all).toHaveLength(own.expected);
    expect(new Set(all.map((i: { periodKey: string }) => i.periodKey)).size).toBe(own.expected);
    // Strictly descending by (endExclusive, periodKey): proves no skip, no repeat and a total order.
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i];
      const ordered = a.endExclusive > b.endExclusive || (a.endExclusive === b.endExclusive && a.periodKey > b.periodKey);
      expect(ordered).toBe(true);
    }
    expect(all.some((i: { periodKey: string }) => i.periodKey === "monthly:2020-01")).toBe(true);

    // Cross-tenant: the other agent sees only their own rows; no cursor from their session reveals ours.
    asUser(other.user.id);
    const theirs = await page();
    expect(theirs.body.items).toHaveLength(3);
    expect(JSON.stringify(theirs.body)).not.toContain("monthly:2020-01");
    expect(JSON.stringify(theirs.body)).not.toContain(own.app.id);
  });

  it("refuses malformed or forged cursors with a generic error and no snapshot data", async () => {
    const own = await seedAgent(2);
    asUser(own.user.id);
    const forged = encodeReportCursor({ endExclusive: new Date(base + 9999 * DAY), periodKey: "daily:2099-01-01" });
    for (const raw of ["%%%", "not-a-cursor", "eyJlIjoxfQ"]) {
      const res = await page(raw);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("daily:");
    }
    // A well-formed cursor is only a position; for this agent it simply yields the rows before it.
    const res = await page(forged);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it("denies a session with no active agent application", async () => {
    const user = await p.user.create({ data: { email: `no-agent-${uid()}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" } });
      asUser(user.id);
    expect((await page()).status).toBe(403);
  });
});
