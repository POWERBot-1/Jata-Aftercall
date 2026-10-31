import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const message = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

type Summary = { entryCount: string; accrualMinor: string; reversalMinor: string; netMinor: string };
const isUnsignedInteger = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,99})$/.test(value);
const isNonPositiveInteger = (value: unknown): value is string => typeof value === "string" && /^(0|-[1-9]\d{0,99})$/.test(value);

/**
 * Storage totals for the authenticated active account only, NOT verified commission or a
 * payable balance. Attribution, provider settlement, financial policy and payouts are absent.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (process.env.AGENT_COMMISSION_SUMMARY_ENABLED !== "true") return message("Commission records are unavailable.", 503);
  try {
    // Authorization and aggregation occur in one statement and accept no agent identifier from
    // the caller. Numeric aggregation and text transport avoid bigint/JSON precision loss.
    const rows: Summary[] = await prisma.$queryRaw`
      SELECT COUNT(e."id")::text AS "entryCount",
             COALESCE(SUM(CASE WHEN e."entryType" = 'ACCRUAL' THEN e."amountMinor"::numeric ELSE 0 END), 0)::text AS "accrualMinor",
             COALESCE(SUM(CASE WHEN e."entryType" = 'REVERSAL' THEN e."amountMinor"::numeric ELSE 0 END), 0)::text AS "reversalMinor",
             COALESCE(SUM(e."amountMinor"::numeric), 0)::text AS "netMinor"
      FROM "AgentApplication" a
      LEFT JOIN "AgentCommissionLedgerEntry" e ON e."agentApplicationId" = a."id"
      WHERE a."userId" = ${session.userId} AND a."status" = 'PENDING' AND a."agentStatus" = 'ACTIVE'
      GROUP BY a."id"`;
    if (rows.length === 0) return message("An active agent account is required.", 403);
    if (rows.length !== 1) throw new Error("Invalid commission summary");
    const { entryCount, accrualMinor, reversalMinor, netMinor } = rows[0];
    if (!isUnsignedInteger(entryCount) || !isUnsignedInteger(accrualMinor) || !isNonPositiveInteger(reversalMinor) || !isUnsignedInteger(netMinor) || BigInt(accrualMinor) + BigInt(reversalMinor) !== BigInt(netMinor)) throw new Error("Invalid commission summary");
    return NextResponse.json({ scope: "OWN_LEDGER_STORAGE_ONLY", currency: "KES", entryCount, accrualMinor, reversalMinor, netMinor, verification: "NOT_CHECKED", entitlement: "NOT_DETERMINED", payout: "NOT_AVAILABLE" }, { headers });
  } catch { return message("Commission records are temporarily unavailable.", 503); }
}
