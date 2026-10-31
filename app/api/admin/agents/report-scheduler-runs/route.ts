import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { rateLimitByIdentity } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const message = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

/** Bounded, admin-only diagnostic; it cannot change a cursor, retry or start a job. */
export async function GET() {
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (session.role !== "ADMIN") return message("Access denied.", 403);
  if (process.env.AGENT_REFERRAL_REPORT_OPERATIONS_ENABLED !== "true") return message("Scheduler history is unavailable.", 503);
  if (!rateLimitByIdentity(session.userId, { key: "agent-report-scheduler-runs", max: 30, windowMs: 60_000 }).allowed) return message("Rate limit exceeded.", 429);
  try {
    const rows = await prisma.$transaction(async (tx: typeof prisma) => {
      const actors: Array<{ role: string }> = await tx.$queryRaw`SELECT "role" FROM "User" WHERE "id" = ${session.userId} FOR SHARE`;
      if (actors.length !== 1 || actors[0].role !== "ADMIN") return null;
      return tx.agentReferralReportScheduleRun.findMany({ select: { id: true, periodType: true, status: true, periodKey: true, result: true, processed: true, failureCode: true, startedAt: true, finishedAt: true }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 101 });
    });
    if (!rows) return message("Access denied.", 403);
    return NextResponse.json({ scope: "REFERRAL_SCHEDULER_RUNS_ONLY", items: rows.slice(0, 100), truncated: rows.length > 100, delivery: "NOT_AVAILABLE" }, { headers });
  } catch { return message("Scheduler history is unavailable.", 503); }
}
