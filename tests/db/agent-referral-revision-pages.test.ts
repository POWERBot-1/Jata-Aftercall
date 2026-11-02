/**
 * Real PostgreSQL (ADMIN-023 §028): an active agent reads their OWN immutable referral report revisions
 * in bounded keyset pages, and reconciles beyond the former 5,000-member ceiling.
 *
 * Runs ONLY via scripts/test-db/run-db-suite.mjs (disposable loopback PostgreSQL, committed migrations,
 * fictional users). No messages, payments, live agents or customer data are touched.
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
import { GET, POST } from "@/app/api/agents/reports/referrals/reconcile/route";
import { MAX_MEMBERS_PER_REVISION, READ_PAGE_SIZE } from "@/lib/agents/referral-report-bounds";

const DAY = 86_400_000;
const base = Date.UTC(2020, 0, 1, 21, 0, 0); // Nairobi midnight, as stored by the period code
const periodKey = "daily:2020-01-01";
const p = realPrismaConfigured ? sharedPrisma() : null;
const asUser = (userId: string) => { mock.session = { userId, role: "CUSTOMER", email: "x@test.invalid" }; };

/** Creates an active agent with `count` REGISTRATION attributions inside the period, then the snapshot. */
async function seedAgent(count: number) {
  const suffix = uid();
  const user = await p.user.create({ data: { email: `rev-agent-${suffix}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" } });
  const app = await p.agentApplication.create({
    data: { userId: user.id, fullName: "Synthetic Agent", phoneE164: `+2547${suffix.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`, status: "PENDING", agentStatus: "ACTIVE", privacyAcknowledgedAt: new Date() },
  });
  const link = await p.agentReferralLink.create({ data: { referrerApplicationId: app.id, tokenHash: `h-${suffix}`, expiresAt: new Date(base + 365 * DAY) } });
  const CHUNK = 1000;
  for (let offset = 0; offset < count; offset += CHUNK) {
    const slice = Array.from({ length: Math.min(CHUNK, count - offset) }, (_, k) => offset + k);
    await p.user.createMany({ data: slice.map((i) => ({ id: `ru-${suffix}-${i}`, email: `ref-${suffix}-${i}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" })) });
    await p.agentApplication.createMany({ data: slice.map((i) => ({ id: `ra-${suffix}-${i}`, userId: `ru-${suffix}-${i}`, fullName: "Synthetic Referred", phoneE164: `+2548${String(i).padStart(8, "0")}`, status: "PENDING", agentStatus: "INACTIVE", privacyAcknowledgedAt: new Date() })) });
    await p.agentReferralAttribution.createMany({ data: slice.map((i) => ({ id: `att-${suffix}-${i}`, referrerApplicationId: app.id, referredApplicationId: `ra-${suffix}-${i}`, linkId: link.id, consentedAt: new Date(base), source: "REGISTRATION", createdAt: new Date(base + 60_000 + i) })) });
  }
  await p.agentReferralReportSnapshot.create({
    data: { applicationId: app.id, periodKey, periodType: "DAILY", startInclusive: new Date(base), endExclusive: new Date(base + DAY), registrationCount: BigInt(count), existingApplicationCount: BigInt(0) },
  });
  return { user, app, link, suffix };
}

const ORIGIN = "https://agent.test";
const reconcileUrl = (query: string) => `${ORIGIN}/api/agents/reports/referrals/reconcile?${query}`;
const readPage = async (revision: number, after?: string) => {
  const query = new URLSearchParams({ periodKey, revision: String(revision) });
  if (after !== undefined) query.set("after", after);
  const res = await GET(new Request(reconcileUrl(query.toString())));
  return { status: res.status, body: await res.json() };
};
const readAll = async (revision: number) => {
  const ids: string[] = []; const pageSizes: number[] = []; let after: string | undefined; let last: any;
  for (let guard = 0; guard < 1000; guard++) {
    const r = await readPage(revision, after);
    expect(r.status).toBe(200);
    pageSizes.push(r.body.members.length); last = r.body;
    ids.push(...r.body.members.map((m: { eventId: string }) => m.eventId));
    if (!r.body.nextCursor) return { ids, pageSizes, last };
    after = r.body.nextCursor;
  }
  throw new Error("pagination did not terminate");
};
const reconcile = async () => {
  const res = await POST(new Request(reconcileUrl(""), { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, host: "agent.test" }, body: JSON.stringify({ periodKey }) }));
  return { status: res.status, body: await res.json() };
};

describe.skipIf(!realPrismaConfigured)("real PostgreSQL: bounded referral revision pages", () => {
  let previous: Record<string, string | undefined> = {};
  beforeAll(() => {
    previous = { s: process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED, r: process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED };
    process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true";
    process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED = "true";
  });
  afterAll(() => {
    for (const [k, v] of [["AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED", previous.s], ["AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED", previous.r]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("the cap is explicit and larger than the former 5,000 ceiling", () => {
    expect(MAX_MEMBERS_PER_REVISION).toBe(50_000);
    expect(READ_PAGE_SIZE).toBe(500);
  });

  it("accepts a 5,001-member baseline and pages every member exactly once, in event order", async () => {
    const own = await seedAgent(5001);
    const other = await seedAgent(3);
    asUser(own.user.id);
    const { ids, pageSizes, last } = await readAll(1);
    expect(pageSizes.every((n) => n <= READ_PAGE_SIZE)).toBe(true);
    expect(pageSizes).toHaveLength(Math.ceil(5001 / READ_PAGE_SIZE));
    expect(new Set(ids).size).toBe(5001);
    expect(ids.every((id) => id.startsWith(`att-${own.suffix}-`))).toBe(true);
    expect(last.nextCursor).toBeNull();
    expect(last.registrationCount).toBe("5001");
    // Another agent's evidence never appears in this agent's pages, and the other agent sees only their own.
    asUser(other.user.id);
    const theirs = await readAll(1);
    expect(theirs.ids).toHaveLength(3);
    expect(theirs.ids.every((id) => id.startsWith(`att-${other.suffix}-`))).toBe(true);
  });

  it("produces a next-page marker only when more than one page of members remains", async () => {
    const exactly = await seedAgent(READ_PAGE_SIZE);
    asUser(exactly.user.id);
    const one = await readPage(1);
    expect(one.body.members).toHaveLength(READ_PAGE_SIZE);
    expect(one.body.nextCursor).toBeNull();

    const plusOne = await seedAgent(READ_PAGE_SIZE + 1);
    asUser(plusOne.user.id);
    const first = await readPage(1);
    expect(first.body.members).toHaveLength(READ_PAGE_SIZE);
    expect(typeof first.body.nextCursor).toBe("string");
    expect(first.body.nextCursor).toBe(first.body.members[READ_PAGE_SIZE - 1].eventId);
    const second = await readPage(1, first.body.nextCursor);
    expect(second.body.members).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it("replaying a cursor returns the same page, and a forged well-formed cursor cannot widen scope", async () => {
    const own = await seedAgent(READ_PAGE_SIZE + 5);
    asUser(own.user.id);
    const first = await readPage(1);
    const replay = await readPage(1, first.body.nextCursor);
    const again = await readPage(1, first.body.nextCursor);
    expect(replay.body.members).toEqual(again.body.members);
    // An arbitrary but well-formed cursor only filters this agent's own revision.
    const forged = await readPage(1, "zzzz-not-a-real-event");
    expect(forged.status).toBe(200);
    expect(forged.body.members.every((m: { eventId: string }) => m.eventId.startsWith(`att-${own.suffix}-`))).toBe(true);
  });

  it("refuses malformed, duplicated and over-long cursors before reading rows", async () => {
    const own = await seedAgent(2);
    asUser(own.user.id);
    for (const bad of ["has space", "x".repeat(129), "semi;colon", "%00"]) {
      const res = await readPage(1, bad);
      expect(res.status, bad).toBe(400);
    }
    const dup = await GET(new Request(reconcileUrl(`periodKey=${periodKey}&revision=1&after=a&after=b`)));
    expect(dup.status).toBe(400);
    const unknown = await GET(new Request(reconcileUrl(`periodKey=${periodKey}&revision=1&agentId=${own.app.id}`)));
    expect(unknown.status).toBe(400);
  });

  it("reconciles beyond 5,000 members idempotently and keeps the earlier revision immutable", async () => {
    const own = await seedAgent(5001);
    asUser(own.user.id);
    // Add 600 more attributions after the baseline, so the current evidence has 5,601 members.
    const link = await p.agentReferralLink.findFirst({ where: { referrerApplicationId: own.app.id } });
    const extra = 600;
    await p.user.createMany({ data: Array.from({ length: extra }, (_, i) => ({ id: `xu-${own.suffix}-${i}`, email: `xref-${own.suffix}-${i}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" })) });
    await p.agentApplication.createMany({ data: Array.from({ length: extra }, (_, i) => ({ id: `xa-${own.suffix}-${i}`, userId: `xu-${own.suffix}-${i}`, fullName: "Synthetic Referred", phoneE164: `+2549${String(i).padStart(8, "0")}`, status: "PENDING", agentStatus: "INACTIVE", privacyAcknowledgedAt: new Date() })) });
    await p.agentReferralAttribution.createMany({ data: Array.from({ length: extra }, (_, i) => ({ id: `xatt-${own.suffix}-${i}`, referrerApplicationId: own.app.id, referredApplicationId: `xa-${own.suffix}-${i}`, linkId: link.id, consentedAt: new Date(base), source: "REGISTRATION", createdAt: new Date(base + 120_000 + i) })) });

    const first = await reconcile();
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("RECONCILED");
    expect(first.body.revision).toBe(2);
    expect(first.body.added).toBe(extra);
    expect(first.body.removed).toBe(0);

    const again = await reconcile();
    expect(again.body.status).toBe("UNCHANGED");
    expect(again.body.revision).toBe(2);

    const rev2 = await readAll(2);
    expect(rev2.ids).toHaveLength(5001 + extra);
    expect(new Set(rev2.ids).size).toBe(5001 + extra);
    expect(rev2.last.nextCursor).toBeNull();
    const rev1 = await readAll(1);
    expect(rev1.ids).toHaveLength(5001);
    expect(await p.agentReferralReportMember.count({ where: { applicationId: own.app.id, periodKey, revision: 1 } })).toBe(5001);
  });

  it("the write fence seals a revision: members cannot be added outside its creating transaction", async () => {
    const own = await seedAgent(1);
    const members = await p.agentReferralReportMember.findMany({ where: { applicationId: own.app.id, periodKey, revision: 1 }, take: 1 });
    await expect(p.agentReferralReportMember.create({ data: { applicationId: own.app.id, periodKey, revision: 1, eventId: `late-${own.suffix}`, source: "REGISTRATION", eventCreatedAt: new Date(base) } })).rejects.toThrow(/sealed|immutable|fence/i);
    expect(members).toHaveLength(1);
  });

  it("rolls back a partly written reconciliation completely when a later step fails", async () => {
    const own = await seedAgent(3);
    await expect(p.$transaction(async (tx: any) => {
      await tx.agentReferralReportRevision.create({ data: { applicationId: own.app.id, periodKey, revision: 2, kind: "RECONCILED", actorId: own.user.id, registrationCount: BigInt(3), existingApplicationCount: BigInt(0), addedCount: 0, removedCount: 0, changedCount: 0 } });
      throw new Error("simulated failure after revision insert");
    })).rejects.toThrow(/simulated failure/);
    expect(await p.agentReferralReportRevision.count({ where: { applicationId: own.app.id, periodKey, revision: 2 } })).toBe(0);
  });

  it("the database refuses a baseline above the cap before any member is written", async () => {
    const suffix = uid();
    const user = await p.user.create({ data: { email: `cap-${suffix}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" } });
    const app = await p.agentApplication.create({ data: { userId: user.id, fullName: "Synthetic", phoneE164: `+2546${suffix.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`, status: "PENDING", agentStatus: "ACTIVE", privacyAcknowledgedAt: new Date() } });
    const row = (counts: bigint, periodKey: string) => ({ applicationId: app.id, periodKey, periodType: "DAILY", startInclusive: new Date(base), endExclusive: new Date(base + DAY), registrationCount: counts, existingApplicationCount: BigInt(0) });
    // Above the cap: refused by the explicit limit before any count is compared.
    await expect(p.agentReferralReportSnapshot.create({ data: row(BigInt(MAX_MEMBERS_PER_REVISION + 1), "daily:2020-01-01") })).rejects.toThrow(/membership limit/);
    // At the cap: the limit passes, and the honest membership mismatch (no evidence rows) is refused.
    await expect(p.agentReferralReportSnapshot.create({ data: row(BigInt(MAX_MEMBERS_PER_REVISION), "daily:2020-01-01") })).rejects.toThrow(/membership mismatch/);
    expect(await p.agentReferralReportSnapshot.count({ where: { applicationId: app.id } })).toBe(0);
  });

  it("two concurrent reconciliations of the same agent produce exactly one new revision", async () => {
    const own = await seedAgent(5001);
    asUser(own.user.id);
    const link = await p.agentReferralLink.findFirst({ where: { referrerApplicationId: own.app.id } });
    await p.user.create({ data: { id: `cu-${own.suffix}`, email: `cu-${own.suffix}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" } });
    await p.agentApplication.create({ data: { id: `ca-${own.suffix}`, userId: `cu-${own.suffix}`, fullName: "Synthetic Referred", phoneE164: `+2545${own.suffix.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`, status: "PENDING", agentStatus: "INACTIVE", privacyAcknowledgedAt: new Date() } });
    await p.agentReferralAttribution.create({ data: { id: `catt-${own.suffix}`, referrerApplicationId: own.app.id, referredApplicationId: `ca-${own.suffix}`, linkId: link.id, consentedAt: new Date(base), source: "REGISTRATION", createdAt: new Date(base + 999_000) } });
    const [a, b] = await Promise.all([reconcile(), reconcile()]);
    const statuses = [a.status, b.status].sort();
    expect(a.status === 200 || b.status === 200).toBe(true);
    const created = await p.agentReferralReportRevision.count({ where: { applicationId: own.app.id, periodKey, revision: 2 } });
    expect(created).toBe(1);
    expect(statuses.every((s) => [200, 503].includes(s))).toBe(true);
  });
});
