import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { reconcileCommissionSnapshots, type CommissionEntrySnapshot } from "@/lib/agents/commission-reconciliation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const MAX_ENTRIES = 500;
const message = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

type LocalPayment = { id: string; reference: string; status: string; currency: string; amount: number };
type LocalEntry = { id: string; paymentId: string; agentApplicationId: string; currency: string; entryType: string; amountMinor: bigint; originalEntryId: string | null; sourceEventId: string };

/**
 * One-payment, admin-only local diagnostics. This is not authoritative reconciliation: no
 * provider is contacted, no refund is verified, no policy or attribution is evaluated, and
 * cross-payment duplicates are outside this bounded snapshot. There are no ledger writes.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (session.role !== "ADMIN") return message("Access denied.", 403);
  if (process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED !== "true") return message("Commission diagnostics are unavailable.", 503);
  const limit = rateLimitByIdentity(session.userId, { key: "agent-commission-diagnostics", max: 30, windowMs: 60_000 });
  if (!limit.allowed) return message("Rate limit exceeded.", 429);
  const { paymentId } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(paymentId)) return message("Invalid request.", 400);
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      // Lock the authoritative role until the read finishes; a stale session is insufficient.
      const actors: Array<{ role: string }> = await tx.$queryRaw`SELECT "role" FROM "User" WHERE "id" = ${session.userId} FOR SHARE`;
      if (actors.length !== 1 || actors[0].role !== "ADMIN") return { kind: "forbidden" as const };
      const payment: LocalPayment | null = await tx.payment.findUnique({ where: { id: paymentId }, select: { id: true, reference: true, status: true, currency: true, amount: true } });
      if (!payment) return { kind: "not_found" as const };
      const rows: LocalEntry[] = await tx.agentCommissionLedgerEntry.findMany({ where: { paymentId }, select: { id: true, paymentId: true, agentApplicationId: true, currency: true, entryType: true, amountMinor: true, originalEntryId: true, sourceEventId: true }, orderBy: { id: "asc" }, take: MAX_ENTRIES + 1 });
      // Never interpret a truncated set as a complete ledger, particularly for reversal totals.
      if (rows.length > MAX_ENTRIES) return { kind: "too_large" as const };
      if (!Number.isSafeInteger(payment.amount)) throw new Error("Invalid payment amount");
      const entries: CommissionEntrySnapshot[] = rows.map((row) => ({ id: row.id, paymentId: row.paymentId, agentId: row.agentApplicationId, currency: row.currency, kind: row.entryType as CommissionEntrySnapshot["kind"], amountMinor: row.amountMinor, reversesEntryId: row.originalEntryId, sourceEventId: row.sourceEventId }));
      const issues = reconcileCommissionSnapshots([{ paymentId: payment.id, reference: payment.reference, localStatus: payment.status, localCurrency: payment.currency, localAmountMinor: BigInt(payment.amount), verifiedProvider: null }], entries);
      const counts: Record<string, number> = {};
      for (const issue of issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
      return { kind: "ok" as const, entryCount: rows.length, issueCounts: counts };
    }, { isolationLevel: "RepeatableRead" });
    if (result.kind === "forbidden") return message("Access denied.", 403);
    if (result.kind === "not_found") return message("Payment not found.", 404);
    if (result.kind === "too_large") return message("Too many entries for a complete diagnostic.", 409);
    return NextResponse.json({ scope: "LOCAL_SINGLE_PAYMENT_ONLY", providerVerification: "NOT_CHECKED", eligibility: "NOT_CHECKED", refundVerification: "NOT_CHECKED", entryCount: result.entryCount, issueCounts: result.issueCounts }, { headers });
  } catch {
    return message("Commission diagnostics are temporarily unavailable.", 503);
  }
}
