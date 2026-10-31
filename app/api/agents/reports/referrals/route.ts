import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { isSameOriginRequest } from "@/lib/agent-application";
import { readSmallJson } from "@/lib/agent-registration";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { previousDailyPeriod, previousMonthlyPeriod } from "@/lib/agents/report-periods";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const message = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
const unavailable = () => message("Referral report snapshots are unavailable.", 503);
type Report = { periodKey: string; periodType: string; startInclusive: Date; endExclusive: Date; registrationCount: bigint; existingApplicationCount: bigint; createdAt: Date };
const serialize = (row: Report) => ({ periodKey: row.periodKey, periodType: row.periodType, startInclusive: row.startInclusive, endExclusive: row.endExclusive, registrationCount: row.registrationCount.toString(), existingApplicationCount: row.existingApplicationCount.toString(), createdAt: row.createdAt });
const labels = { scope: "OWN_REFERRAL_EVIDENCE_SNAPSHOT_ONLY", timezone: "Africa/Nairobi", sales: "NOT_CHECKED", commission: "NOT_CHECKED", delivery: "NOT_AVAILABLE" } as const;

/** Locks the authoritative active account for the transaction; no caller-selected agent id. */
async function activeApplication(tx: typeof prisma, userId: string): Promise<string | null> {
  const rows: Array<{ id: string }> = await tx.$queryRaw`
    SELECT "id" FROM "AgentApplication" WHERE "userId" = ${userId} AND "status" = 'PENDING' AND "agentStatus" = 'ACTIVE' FOR SHARE`;
  return rows.length === 1 ? rows[0].id : null;
}

/** The most recent 100 persisted snapshots for this active agent only. */
export async function GET() {
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED !== "true") return unavailable();
  if (!rateLimitByIdentity(session.userId, { key: "agent-referral-report-read", max: 30, windowMs: 60_000 }).allowed) return message("Rate limit exceeded.", 429);
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const applicationId = await activeApplication(tx, session.userId);
      if (!applicationId) return null;
      return tx.agentReferralReportSnapshot.findMany({ where: { applicationId }, orderBy: [{ endExclusive: "desc" }, { periodKey: "desc" }], take: 101 });
    });
    if (!result) return message("An active agent account is required.", 403);
    return NextResponse.json({ ...labels, items: result.slice(0, 100).map(serialize), truncated: result.length > 100 }, { headers });
  } catch { return unavailable(); }
}

/** Manually capture one last-completed period; not a scheduler or authoritative sales report. */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return message("Request not allowed.", 403);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return message("Invalid request.", 415);
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED !== "true") return unavailable();
  if (!rateLimitByIdentity(session.userId, { key: "agent-referral-report-create", max: 15, windowMs: 60_000 }).allowed) return message("Rate limit exceeded.", 429);
  let body: unknown;
  try { body = await readSmallJson(req); } catch { return message("Invalid request.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("period" in body) || (body.period !== "DAILY" && body.period !== "MONTHLY")) return message("Invalid request.", 400);
  const periodType = body.period;
  const period = periodType === "DAILY" ? previousDailyPeriod(new Date()) : previousMonthlyPeriod(new Date());
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const applicationId = await activeApplication(tx, session.userId);
      if (!applicationId) return null;
      // Insert once per agent/period: counts reflect the data visible at initial capture, not
      // necessarily late-arriving evidence. Concurrent replays never silently rewrite history.
      await tx.$executeRaw`
        INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount")
        SELECT ${applicationId}, ${period.key}, ${periodType}, ${period.startInclusive}, ${period.endExclusive},
          COUNT(*) FILTER (WHERE "source" = 'REGISTRATION'), COUNT(*) FILTER (WHERE "source" = 'EXISTING_ACCOUNT')
        FROM "AgentReferralAttribution"
        WHERE "referrerApplicationId" = ${applicationId} AND "createdAt" >= ${period.startInclusive} AND "createdAt" < ${period.endExclusive}
        ON CONFLICT ("applicationId", "periodKey") DO NOTHING`;
      return tx.agentReferralReportSnapshot.findUniqueOrThrow({ where: { applicationId_periodKey: { applicationId, periodKey: period.key } } });
    });
    if (!result) return message("An active agent account is required.", 403);
    return NextResponse.json({ ...labels, item: serialize(result) }, { headers });
  } catch { return unavailable(); }
}
