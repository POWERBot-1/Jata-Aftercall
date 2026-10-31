import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { reportScheduleStart } from "@/lib/agents/referral-report-scheduler";
import { runReferralReportBatch } from "@/lib/agents/referral-report-scheduler-run";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });

/** Disabled internal scheduler hook. No cron registration, provider call or report delivery. */
export async function GET(req: Request) {
  if (process.env.AGENT_REFERRAL_REPORT_SCHEDULER_ENABLED !== "true" || process.env.AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED !== "true") return error("Scheduler unavailable.", 503);
  const secret = process.env.AGENT_REFERRAL_REPORT_SCHEDULER_SECRET;
  const start = reportScheduleStart(process.env.AGENT_REFERRAL_REPORT_SCHEDULE_START_DAY);
  if (!secret || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 512 || !start || start > new Date()) return error("Scheduler unavailable.", 503);
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(req.headers.get("authorization") || "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return error("Access denied.", 401);
  try {
    // Independent transactions prevent a failure in one period type from claiming it completed.
    // Each invocation advances at most one bounded page per type, making missed runs resumable.
    const now = new Date();
    const daily = await runReferralReportBatch(prisma, "DAILY", start, now);
    const monthly = await runReferralReportBatch(prisma, "MONTHLY", start, now);
    return NextResponse.json({ daily, monthly, delivery: "NOT_AVAILABLE", scope: "REFERRAL_EVIDENCE_ONLY" }, { headers });
  } catch { return error("Scheduler unavailable.", 503); }
}
