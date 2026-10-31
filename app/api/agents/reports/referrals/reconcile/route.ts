import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { isSameOriginRequest } from "@/lib/agent-application";
import { readSmallJson } from "@/lib/agent-registration";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { inspectReferralEvidenceDrift } from "@/lib/agents/referral-report-drift";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const message = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
const unavailable = () => message("Report reconciliation is unavailable.", 503);
const MAX_MEMBERS = 5000;
type Member = { eventId: string; source: string; eventCreatedAt: Date };

/** Manual, own-agent reconciliation of referral evidence only. No payment or delivery claims. */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return message("Request not allowed.", 403);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return message("Invalid request.", 415);
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED !== "true" || process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED !== "true") return unavailable();
  if (!rateLimitByIdentity(session.userId, { key: "agent-referral-report-reconcile", max: 15, windowMs: 60_000 }).allowed) return message("Rate limit exceeded.", 429);
  let body: unknown;
  try { body = await readSmallJson(req); } catch { return message("Invalid request.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("periodKey" in body) || typeof body.periodKey !== "string" || !/^(?:daily:\d{4}-\d{2}-\d{2}|monthly:\d{4}-\d{2})$/.test(body.periodKey)) return message("Invalid request.", 400);
  const periodKey = body.periodKey;
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const applications: Array<{ id: string }> = await tx.$queryRaw`SELECT "id" FROM "AgentApplication" WHERE "userId" = ${session.userId} AND "status" = 'PENDING' AND "agentStatus" = 'ACTIVE' FOR SHARE`;
      if (applications.length !== 1) return { kind: "forbidden" as const };
      const applicationId = applications[0].id;
      const snapshots: Array<{ startInclusive: Date; endExclusive: Date }> = await tx.$queryRaw`SELECT "startInclusive", "endExclusive" FROM "AgentReferralReportSnapshot" WHERE "applicationId" = ${applicationId} AND "periodKey" = ${periodKey} FOR UPDATE`;
      if (snapshots.length !== 1) return { kind: "missing" as const };
      const prior = await tx.agentReferralReportRevision.findFirst({ where: { applicationId, periodKey }, orderBy: { revision: "desc" }, include: { members: { orderBy: { eventId: "asc" }, take: MAX_MEMBERS + 1 } } });
      // A count-only legacy snapshot cannot be reconstructed from present data without inventing history.
      if (!prior) return { kind: "legacy" as const };
      if (prior.members.length > MAX_MEMBERS) return { kind: "too_large" as const };
      const snapshot = snapshots[0];
      const current = await tx.agentReferralAttribution.findMany({ where: { referrerApplicationId: applicationId, source: { in: ["REGISTRATION", "EXISTING_ACCOUNT"] }, createdAt: { gte: snapshot.startInclusive, lt: snapshot.endExclusive } }, select: { id: true, source: true, createdAt: true }, orderBy: { id: "asc" }, take: MAX_MEMBERS + 1 });
      if (current.length > MAX_MEMBERS) return { kind: "too_large" as const };
      const before = new Map<string, Member>(prior.members.map((item: Member) => [item.eventId, item]));
      let added = 0; let changed = 0;
      for (const item of current) {
        const old = before.get(item.id);
        if (!old) added++;
        else { if (old.source !== item.source || old.eventCreatedAt.getTime() !== item.createdAt.getTime()) changed++; before.delete(item.id); }
      }
      const removed = before.size;
      if (added === 0 && removed === 0 && changed === 0) return { kind: "ok" as const, status: "UNCHANGED", revision: prior.revision, registrationCount: prior.registrationCount.toString(), existingApplicationCount: prior.existingApplicationCount.toString(), added, removed, changed };
      const registrationCount = BigInt(current.filter((item: { source: string }) => item.source === "REGISTRATION").length);
      const existingApplicationCount = BigInt(current.length) - registrationCount;
      const revision = prior.revision + 1;
      await tx.agentReferralReportRevision.create({ data: { applicationId, periodKey, revision, kind: "RECONCILED", actorId: session.userId, registrationCount, existingApplicationCount, addedCount: added, removedCount: removed, changedCount: changed, members: { createMany: { data: current.map((item: { id: string; source: string; createdAt: Date }) => ({ eventId: item.id, source: item.source, eventCreatedAt: item.createdAt })) } } } });
      await tx.auditEvent.create({ data: { actorId: session.userId, action: "AGENT_REFERRAL_REPORT_RECONCILED", targetType: "AGENT_REPORT", targetId: applicationId, metadata: JSON.stringify({ periodKey, revision, added, removed, changed }) } });
      return { kind: "ok" as const, status: "RECONCILED", revision, registrationCount: registrationCount.toString(), existingApplicationCount: existingApplicationCount.toString(), added, removed, changed };
    });
    if (result.kind === "forbidden") return message("An active agent account is required.", 403);
    if (result.kind === "missing") return message("Report not found.", 404);
    if (result.kind === "legacy") return message("Original report membership was not retained; manual review is required.", 409);
    if (result.kind === "too_large") return message("Report exceeds the reconciliation limit; manual review is required.", 409);
    const { kind: _kind, ...response } = result;
    return NextResponse.json({ scope: "OWN_REFERRAL_EVIDENCE_ONLY", periodKey, sales: "NOT_CHECKED", commission: "NOT_CHECKED", ...response }, { headers });
  } catch { return unavailable(); }
}

/** Inspect one stored revision and its opaque evidence identifiers, never another agent's report. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED !== "true" || process.env.AGENT_REFERRAL_REPORT_RECONCILIATION_ENABLED !== "true") return unavailable();
  if (!rateLimitByIdentity(session.userId, { key: "agent-referral-report-revision-read", max: 30, windowMs: 60_000 }).allowed) return message("Rate limit exceeded.", 429);
  const query = new URL(req.url).searchParams;
  const periodKey = query.get("periodKey"); const revisionText = query.get("revision");
  const after = query.get("after");
  // A cursor is an opaque retained event id, never an application or tenant selector.
  if ([...query.keys()].some((key) => !["periodKey", "revision", "after"].includes(key)) ||
      query.getAll("periodKey").length !== 1 || query.getAll("revision").length !== 1 || query.getAll("after").length > 1 ||
      (after !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(after)) ||
      !periodKey || !/^(?:daily:\d{4}-\d{2}-\d{2}|monthly:\d{4}-\d{2})$/.test(periodKey) || !revisionText || !/^[1-9]\d{0,8}$/.test(revisionText)) return message("Invalid request.", 400);
  const revision = Number(revisionText);
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const applications: Array<{ id: string }> = await tx.$queryRaw`SELECT "id" FROM "AgentApplication" WHERE "userId" = ${session.userId} AND "status" = 'PENDING' AND "agentStatus" = 'ACTIVE' FOR SHARE`;
      if (applications.length !== 1) return { kind: "forbidden" as const };
      const report = await tx.agentReferralReportRevision.findUnique({ where: { applicationId_periodKey_revision: { applicationId: applications[0].id, periodKey, revision } }, include: { members: { ...(after ? { where: { eventId: { gt: after } } } : {}), orderBy: { eventId: "asc" }, take: MAX_MEMBERS + 1 } } });
      if (!report) return { kind: "missing" as const };
      // A historical revision can differ from current evidence even when its own data is intact.
      // Inspection is bounded by database timeouts and never silently changes the revision.
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
      const evidenceStatus = await inspectReferralEvidenceDrift(tx, applications[0].id, periodKey, revision);
      return { kind: "ok" as const, report, evidenceStatus };
    });
    if (result.kind === "forbidden") return message("An active agent account is required.", 403);
    if (result.kind === "missing") return message("Report revision not found.", 404);
    const row = result.report;
    const page = row.members.slice(0, MAX_MEMBERS);
    const nextCursor = row.members.length > MAX_MEMBERS ? page[page.length - 1].eventId : null;
    return NextResponse.json({ scope: "OWN_REFERRAL_EVIDENCE_ONLY", periodKey, revision: row.revision, kind: row.kind, createdAt: row.createdAt, registrationCount: row.registrationCount.toString(), existingApplicationCount: row.existingApplicationCount.toString(), added: row.addedCount, removed: row.removedCount, changed: row.changedCount, evidenceStatus: result.evidenceStatus, nextCursor, members: page.map((member: Member) => ({ eventId: member.eventId, source: member.source, eventCreatedAt: member.eventCreatedAt })), sales: "NOT_CHECKED", commission: "NOT_CHECKED" }, { headers });
  } catch { return unavailable(); }
}
