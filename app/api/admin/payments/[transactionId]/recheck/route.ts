import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { recheckPaymentForOperator } from "@/lib/payments/orchestrator";

/**
 * JATA internal: ask the provider for the current truth about one payment (§102).
 *
 * Admin-only, and safe by construction: nothing here replays stored provider data. The adapter
 * queries the provider, and only the provider's own answer can change the payment — so an operator
 * cannot make money appear, and cannot make a failed payment paid (§41, §120).
 */

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ transactionId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const { transactionId } = await context.params;
  const id = typeof transactionId === "string" ? transactionId.trim() : "";
  if (!id) return NextResponse.json({ error: "Payment id required." }, { status: 400 });

  const outcome = await recheckPaymentForOperator({ transactionId: id });
  if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: 404 });

  await logAudit({
    actorId: session.userId,
    action: "PAYMENT_RECHECKED_BY_OPERATOR",
    targetType: "PAYMENT_TRANSACTION",
    targetId: id,
    metadata: { status: outcome.status, checked: outcome.checked },
  }).catch(() => null);

  return NextResponse.json({ ok: true, checked: outcome.checked, status: outcome.status, message: outcome.message });
}
