import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { getAgentMonthlyCommissionEligibility } from "@/lib/agents/commission-accrual";

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
    const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agentApplication.findUnique({
      where: { userId: session.userId },
      select: { id: true, status: true, agentStatus: true, phoneVerifiedAt: true },
    });
    if (!agent || agent.status !== "PENDING" || agent.agentStatus !== "ACTIVE" || !agent.phoneVerifiedAt) return { kind: "inactive" as const };
    const monthly = await getAgentMonthlyCommissionEligibility(tx, agent.id);
    const rows: Summary[] = await tx.$queryRaw`
      SELECT COUNT(e."id")::text AS "entryCount",
             COALESCE(SUM(CASE WHEN e."entryType" = 'ACCRUAL' THEN e."amountMinor"::numeric ELSE 0 END), 0)::text AS "accrualMinor",
             COALESCE(SUM(CASE WHEN e."entryType" = 'REVERSAL' THEN e."amountMinor"::numeric ELSE 0 END), 0)::text AS "reversalMinor",
             COALESCE(SUM(e."amountMinor"::numeric), 0)::text AS "netMinor"
      FROM "AgentApplication" a
      LEFT JOIN "AgentCommissionLedgerEntry" e ON e."agentApplicationId" = a."id"
      WHERE a."userId" = ${session.userId} AND a."status" = 'PENDING' AND a."agentStatus" = 'ACTIVE'
      GROUP BY a."id"`;
    if (rows.length === 0) return { kind: "missing" as const };
    if (rows.length !== 1) throw new Error("Invalid commission summary");
    const { entryCount, accrualMinor, reversalMinor, netMinor } = rows[0];
    if (!isUnsignedInteger(entryCount) || !isUnsignedInteger(accrualMinor) || !isNonPositiveInteger(reversalMinor) || !isUnsignedInteger(netMinor) || BigInt(accrualMinor) + BigInt(reversalMinor) !== BigInt(netMinor) || (entryCount === "0" && (accrualMinor !== "0" || reversalMinor !== "0" || netMinor !== "0"))) throw new Error("Invalid commission summary");
    return { kind: "ok" as const, entryCount, accrualMinor, reversalMinor, netMinor, monthly };
    }, { isolationLevel: "RepeatableRead" });
    if (result.kind === "inactive" || result.kind === "missing") return message("An active, phone-verified agent account is required.", 403);
    if (result.kind !== "ok") return message("Commission records are temporarily unavailable.", 503);
    const payoutEligibleMinor = result.monthly.eligible ? result.monthly.payableMinor.toString() : "0";
    return NextResponse.json({ scope: "OWN_AGENT_LEDGER", currency: "KES", entryCount: result.entryCount, accrualMinor: result.accrualMinor, reversalMinor: result.reversalMinor, netMinor: result.netMinor, month: result.monthly.month, qualifyingPlanSales: result.monthly.qualifyingPlanSales, minimumMonthlyPlanSales: result.monthly.minimumMonthlyPlanSales, eligibleForPayment: result.monthly.eligible, monthlyAccruedMinor: result.monthly.accruedMinor.toString(), monthlyReversedMinor: result.monthly.reversedMinor.toString(), monthlyNetAccruedMinor: result.monthly.payableMinor.toString(), payoutEligibleMinor, verification: "LOCAL_PROVIDER_VERIFIED_SETTLEMENT_RECORDS", payout: "NOT_AVAILABLE_NO_TRANSFER_EXECUTED" }, { headers });
  } catch { return message("Commission records are temporarily unavailable.", 503); }
}
