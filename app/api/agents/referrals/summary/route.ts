import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { referralLifetimeSeconds } from "@/lib/agents/referral-registration";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Aggregate only the caller's consented applications; never accept an agent ID from a request. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers });
  if (!referralLifetimeSeconds()) return NextResponse.json({ error: "Registration referrals are unavailable." }, { status: 503, headers });
  try {
    // Authorization and aggregation share one statement, so the owner and active status are not
    // determined by the browser or by a stale application lookup. No customer details are read.
    const rows: Array<{ registrationCount: number; existingApplicationCount: number }> = await prisma.$queryRaw`
      SELECT (COUNT(r."id") FILTER (WHERE r."source" = 'REGISTRATION'))::integer AS "registrationCount",
             (COUNT(r."id") FILTER (WHERE r."source" = 'EXISTING_ACCOUNT'))::integer AS "existingApplicationCount"
      FROM "AgentApplication" a
      LEFT JOIN "AgentReferralAttribution" r ON r."referrerApplicationId" = a."id"
      WHERE a."userId" = ${session.userId} AND a."status" = 'PENDING' AND a."agentStatus" = 'ACTIVE'
      GROUP BY a."id"`;
    if (rows.length === 0) return NextResponse.json({ error: "An active agent account is required." }, { status: 403, headers });
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0].registrationCount) || rows[0].registrationCount < 0 || !Number.isSafeInteger(rows[0].existingApplicationCount) || rows[0].existingApplicationCount < 0) throw new Error("Invalid referral count");
    return NextResponse.json({ registrationCount: rows[0].registrationCount, existingApplicationCount: rows[0].existingApplicationCount }, { headers });
  } catch {
    return NextResponse.json({ error: "Referral summary is temporarily unavailable." }, { status: 503, headers });
  }
}
