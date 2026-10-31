import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/agent-application";
import prisma from "@/lib/db";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { readSandboxTransaction } from "@/lib/agents/paystack-sandbox-diagnostics";
import { reconcileCommissionSnapshots, type CommissionEntrySnapshot } from "@/lib/agents/commission-reconciliation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });
type Payment = { id: string; reference: string; status: string; currency: string; amount: number };
type Entry = { id: string; paymentId: string; agentApplicationId: string; currency: string; entryType: string; amountMinor: bigint; originalEntryId: string | null; sourceEventId: string };

/** Read-only sandbox comparison, not proof of entitlement, production payment or refund. */
export async function POST(req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  if (!isSameOriginRequest(req)) return error("Request not allowed.", 403);
  const session = await getSession();
  if (!session) return error("Sign in required.", 401);
  if (session.role !== "ADMIN") return error("Access denied.", 403);
  if (process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED !== "true" || process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED !== "true" || !/^sk_test_[A-Za-z0-9]+$/.test(process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET || "")) return error("Sandbox diagnostics are unavailable.", 503);
  if (!rateLimitByIdentity(session.userId, { key: "agent-commission-sandbox-diagnostics", max: 10, windowMs: 60_000 }).allowed) return error("Rate limit exceeded.", 429);
  const { paymentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(paymentId)) return error("Invalid request.", 400);
  const roleAndPayment = async (tx: typeof prisma) => {
    const actors: Array<{ role: string }> = await tx.$queryRaw`SELECT "role" FROM "User" WHERE "id" = ${session.userId} FOR SHARE`;
    if (actors.length !== 1 || actors[0].role !== "ADMIN") return { kind: "forbidden" as const };
    const payment: Payment | null = await tx.payment.findUnique({ where: { id: paymentId }, select: { id: true, reference: true, status: true, currency: true, amount: true } });
    return payment ? { kind: "found" as const, payment } : { kind: "not_found" as const };
  };
  try {
    // The external call is intentionally outside the transaction and database role lock.
    const first = await prisma.$transaction(roleAndPayment, { isolationLevel: "RepeatableRead" });
    if (first.kind === "forbidden") return error("Access denied.", 403);
    if (first.kind === "not_found") return error("Payment not found.", 404);
    const provider = await readSandboxTransaction(first.payment.reference);
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const current = await roleAndPayment(tx);
      if (current.kind !== "found") return current;
      const payment = current.payment;
      if (payment.reference !== first.payment.reference) return { kind: "changed" as const };
      if (!Number.isSafeInteger(payment.amount)) throw new Error("Invalid payment amount");
      const rows: Entry[] = await tx.agentCommissionLedgerEntry.findMany({ where: { paymentId }, select: { id: true, paymentId: true, agentApplicationId: true, currency: true, entryType: true, amountMinor: true, originalEntryId: true, sourceEventId: true }, orderBy: { id: "asc" }, take: 501 });
      if (rows.length > 500) return { kind: "too_large" as const };
      const entries: CommissionEntrySnapshot[] = rows.map((row) => ({ id: row.id, paymentId: row.paymentId, agentId: row.agentApplicationId, currency: row.currency, kind: row.entryType as CommissionEntrySnapshot["kind"], amountMinor: row.amountMinor, reversesEntryId: row.originalEntryId, sourceEventId: row.sourceEventId }));
      const issues = reconcileCommissionSnapshots([{ paymentId: payment.id, reference: payment.reference, localStatus: payment.status, localCurrency: payment.currency, localAmountMinor: BigInt(payment.amount), verifiedProvider: provider }], entries);
      const counts: Record<string, number> = {};
      for (const issue of issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
      return { kind: "ok" as const, entryCount: rows.length, issueCounts: counts };
    }, { isolationLevel: "RepeatableRead" });
    if (result.kind === "forbidden") return error("Access denied.", 403);
    if (result.kind === "not_found") return error("Payment not found.", 404);
    if (result.kind === "changed") return error("Payment changed; retry the diagnostic.", 409);
    if (result.kind === "too_large") return error("Too many entries for a complete diagnostic.", 409);
    return NextResponse.json({ scope: "SANDBOX_SINGLE_PAYMENT_ONLY", providerVerification: "SANDBOX_RESPONSE_RECEIVED", eligibility: "NOT_CHECKED", refundVerification: "NOT_CHECKED", entryCount: result.entryCount, issueCounts: result.issueCounts }, { headers });
  } catch { return error("Sandbox diagnostics are temporarily unavailable.", 503); }
}
