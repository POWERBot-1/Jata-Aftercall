/**
 * Reconciliation (§43, §44, §72).
 *
 * GET  — the day's reconciliation: what the POS says was sold, what the providers confirm arrived,
 *        and every difference counted as an explainable exception rather than a shrug.
 * POST — a deliberate manual match of an unmatched payment, attributed and reasoned, which records
 *        the decision but never fabricates a provider confirmation.
 */

import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { dailyReconciliation, listReconciliationExceptions, matchUnmatchedPayment } from "@/lib/payments/reconciliation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_PAYMENTS", fast: true },
    fallback: "We couldn't load your reconciliation.",
    handler: async ({ url }) => {
      const range = dayRange(url.searchParams.get("from"), url.searchParams.get("to"));
      const [daily, exceptions] = await Promise.all([
        dailyReconciliation(businessId, range),
        listReconciliationExceptions(businessId, { limit: 50, includeResolved: url.searchParams.get("resolved") === "1" }),
      ]);
      return posOk({ daily, exceptions });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_RECONCILIATION", fast: true },
    fallback: "We couldn't match that payment.",
    handler: async ({ actor, body }) => {
      const outcome = await matchUnmatchedPayment({
        businessId,
        reconciliationId: typeof body?.reconciliationId === "string" ? body.reconciliationId : "",
        transactionId: typeof body?.transactionId === "string" ? body.transactionId : null,
        actorId: actor.actorId,
        actorName: actor.actorName,
        reason: typeof body?.reason === "string" ? body.reason : "",
      });
      const exceptions = await listReconciliationExceptions(businessId, { limit: 50 });
      return fromOutcome({ ...outcome, warnings: [] }, { exceptions });
    },
  });
}

/** Today by default; a merchant can look at any day they choose. */
function dayRange(from: string | null, to: string | null): { from: Date; to: Date } {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const safeStart = Number.isNaN(start.getTime()) ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : start;
  return { from: safeStart, to: end };
}
