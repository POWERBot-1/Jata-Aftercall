import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { logPosAudit } from "@/lib/pos/audit";
import { createSupplier, listSuppliers } from "@/lib/pos/store";
import { sanitizeSupplierInput } from "@/lib/pos/validation";

/**
 * Suppliers (§12, §30).
 *
 * What a business owes a supplier is a separate ledger from what a customer owes the business.
 * Both live in `PosCreditEntry`, kept apart by `partyType`, so a supplier balance can never
 * absorb a customer sale or appear in a debtor's ageing report.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "VIEW_SUPPLIERS", fast: true },
    fallback: "We couldn't load your suppliers.",
    handler: async ({ ctx }) => posOk({
      suppliers: await listSuppliers(businessId, {}),
      word: ctx.terminology.supplier,
      plural: ctx.terminology.suppliers,
      creditEnabled: ctx.configuration.suppliers.credit,
      purchaseOrders: ctx.configuration.suppliers.purchaseOrders,
      partialReceiving: ctx.configuration.suppliers.partialReceiving,
      termsDays: ctx.configuration.suppliers.termsDays,
    }),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_SUPPLIERS" },
    fallback: "We couldn't save that supplier.",
    handler: async ({ ctx, actor, body }) => {
      const input = sanitizeSupplierInput(body);
      if (!input.name) return fromOutcome({ ok: false, message: `Give the ${ctx.terminology.supplier.toLowerCase()} a name.` });
      if (input.creditEnabled && !ctx.configuration.suppliers.credit) {
        return fromOutcome({ ok: false, message: "Supplier credit is switched off for this business.", code: "SUPPLIER_CREDIT_DISABLED" });
      }
      const supplier = await createSupplier(businessId, input);
      await logPosAudit({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_SUPPLIER_CREATED",
        targetType: "SUPPLIER",
        targetId: supplier.id,
        metadata: { name: input.name, creditEnabled: input.creditEnabled, termsDays: input.termsDays },
      });
      return fromOutcome({ ok: true, warnings: [] }, { supplier }, 201);
    },
  });
}
