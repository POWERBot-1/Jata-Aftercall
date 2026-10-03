import { fromOutcome, handlePosRequest, posOk, queryString } from "@/lib/pos/http";
import { createPurchase } from "@/lib/pos/operations";
import { listPurchases, listSuppliers } from "@/lib/pos/store";
import { sanitizePurchaseInput } from "@/lib/pos/validation";

/**
 * Purchasing (§12, §33).
 *
 * A purchase order records what was ordered; receiving it writes the stock movements. Supplier
 * credit goes on the payables ledger, kept separate from what customers owe (§30).
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_SUPPLIERS", fast: true },
    fallback: "We couldn't load your purchases.",
    handler: async ({ ctx, url }) => posOk({
      purchases: await listPurchases(businessId, { status: queryString(url, "status") ?? undefined, take: 50 }),
      suppliers: await listSuppliers(businessId, {}),
      purchaseOrders: ctx.configuration.suppliers.purchaseOrders,
      partialReceiving: ctx.configuration.suppliers.partialReceiving,
      supplierCredit: ctx.configuration.suppliers.credit,
      word: ctx.terminology.supplier,
    }),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "CREATE_PURCHASE", requireLive: true },
    fallback: "We couldn't save that purchase.",
    handler: async ({ ctx, actor, body }) => {
      const outcome = await createPurchase({
        businessId,
        configuration: ctx.configuration,
        actor,
        ...sanitizePurchaseInput(body),
      });
      return fromOutcome(outcome, { purchase: outcome.purchase ?? null }, 201);
    },
  });
}
