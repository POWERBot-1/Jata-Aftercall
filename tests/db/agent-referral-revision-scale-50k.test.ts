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

/**
 * MANUAL SCALE EVIDENCE (ADMIN-023 §028 rehearsal). Not part of the CI DB suite, which lists its files explicitly.
 * Run only with JATA_SCALE_50K=1, via scripts/test-db/run-db-suite.mjs on a disposable loopback PostgreSQL:
 *   JATA_SCALE_50K=1 JATA_SCALE_REPORT=docs/agents/evidence/migration-20261127/scale-50k-timing.json \
 *     node scripts/test-db/run-db-suite.mjs tests/db/agent-referral-revision-scale-50k.test.ts
 * Times the real route handlers and real drift check at the 50,000-member cap. Synthetic data only.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const RUN = process.env.JATA_SCALE_50K === "1" && realPrismaConfigured;
const timings: Record<string, number | string> = {};
const timed = async <T,>(label: string, fn: () => Promise<T>) => { const t = Date.now(); const out = await fn(); timings[label] = Date.now() - t; return out; };

describe.skipIf(!RUN)("manual scale: 50,000-member revision at the cap", () => {
  beforeAll(() => {
    process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED = "true";
    process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED = "true";
  }, 900_000);
  afterAll(() => {
    if (process.env.JATA_SCALE_REPORT) {
      mkdirSync(dirname(process.env.JATA_SCALE_REPORT), { recursive: true });
      writeFileSync(process.env.JATA_SCALE_REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), cap: MAX_MEMBERS_PER_REVISION, readPageSize: READ_PAGE_SIZE, timingsMs: timings }, null, 2) + "\n");
    }
  }, 120_000);

  it("reads all 50,000 members in bounded pages, each exactly once", async () => {
    const { app, suffix } = await timed("seed50000Ms", () => seedAgent(MAX_MEMBERS_PER_REVISION));
    asUser(app.userId);
    const pageSizes: number[] = []; let after: string | undefined; const ids = new Set<string>(); let total = 0; let maxPageMs = 0;
    for (let guard = 0; guard < 400; guard++) {
      const t = Date.now();
      const r = await readPage(1, after);
      maxPageMs = Math.max(maxPageMs, Date.now() - t);
      expect(r.status).toBe(200);
      expect(r.body.members.length).toBeLessThanOrEqual(READ_PAGE_SIZE);
      pageSizes.push(r.body.members.length);
      for (const m of r.body.members as Array<{ eventId: string }>) { expect(ids.has(m.eventId)).toBe(false); ids.add(m.eventId); total++; }
      if (!r.body.nextCursor) break;
      after = r.body.nextCursor;
    }
    timings.walkPages = pageSizes.length; timings.maxPageMs = maxPageMs;
    expect(total).toBe(MAX_MEMBERS_PER_REVISION);
    expect(pageSizes.length).toBe(MAX_MEMBERS_PER_REVISION / READ_PAGE_SIZE);
    void suffix;
  }, 900_000);

  it("reconcile at 50,000 unchanged is read-only and fits the statement budget; 50,001 is refused with no new revision", async () => {
    const { app } = await seedAgent(MAX_MEMBERS_PER_REVISION);
    asUser(app.userId);
    const unchanged = await timed("reconcileUnchangedMs", () => reconcile());
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.status).toBe("UNCHANGED");
    // Add one in-window attribution: current membership becomes 50,001.
    const extra = await p.user.create({ data: { email: `extra-${uid()}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" } });
    const extraApp = await p.agentApplication.create({ data: { userId: extra.id, fullName: "Synthetic Referred", phoneE164: `+2549${String(Date.now()).slice(-8)}`, status: "PENDING", agentStatus: "INACTIVE", privacyAcknowledgedAt: new Date() } });
    const link = await p.agentReferralLink.findFirstOrThrow({ where: { referrerApplicationId: app.id } });
    await p.agentReferralAttribution.create({ data: { referrerApplicationId: app.id, referredApplicationId: extraApp.id, linkId: link.id, consentedAt: new Date(base), source: "REGISTRATION", createdAt: new Date(base + 60_000 + 50_000) } as any });
    const over = await timed("reconcileOver50000Ms", () => reconcile());
    expect(over.status).toBe(409);
    const revisions = await p.agentReferralReportRevision.count({ where: { applicationId: app.id, periodKey } });
    expect(revisions).toBe(1);
  }, 900_000);

  it("reconcile at the cap writes 50,000 members as a new revision, and the earlier revision stays readable", async () => {
    const { app } = await seedAgent(MAX_MEMBERS_PER_REVISION - 1);
    asUser(app.userId);
    const extra = await p.user.create({ data: { email: `extra2-${uid()}@test.invalid`, passwordHash: "synthetic", role: "CUSTOMER" } });
    const extraApp = await p.agentApplication.create({ data: { userId: extra.id, fullName: "Synthetic Referred", phoneE164: `+2546${String(Date.now()).slice(-8)}`, status: "PENDING", agentStatus: "INACTIVE", privacyAcknowledgedAt: new Date() } });
    const link = await p.agentReferralLink.findFirstOrThrow({ where: { referrerApplicationId: app.id } });
    await p.agentReferralAttribution.create({ data: { referrerApplicationId: app.id, referredApplicationId: extraApp.id, linkId: link.id, consentedAt: new Date(base), source: "REGISTRATION", createdAt: new Date(base + 60_000 + 50_000) } as any });
    const written = await timed("reconcileWrite50000Ms", () => reconcile());
    expect(written.status).toBe(200);
    expect(written.body.status).toBe("RECONCILED");
    expect(written.body.revision).toBe(2);
    const first = await readPage(1);
    expect(first.status).toBe(200);
    expect(first.body.members.length).toBeLessThanOrEqual(READ_PAGE_SIZE);
    const second = await timed("readRevision2FirstPageMs", () => readPage(2));
    expect(second.status).toBe(200);
  }, 900_000);
});
