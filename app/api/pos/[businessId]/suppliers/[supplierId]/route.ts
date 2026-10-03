import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { logPosAudit } from "@/lib/pos/audit";
import { buildStatement, PAYABLE, toCreditEntries } from "@/lib/pos/credit";
import { paySupplier } from "@/lib/pos/operations";
import { findSupplier, listCreditEntries, listPurchases, updateSupplier } from "@/lib/pos/store";
import { bool, sanitizeSupplierInput, text, positiveNumber, optionalText } from "@/lib/pos/validation";

/**
 * One supplier (§12, §30). GET is the payables statement; PATCH edits the record; POST pays
 * them down. Paying a supplier is a high-risk action, so it needs its own permission (§36).
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; supplierId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId, supplierId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "VIEW_SUPPLIERS", fast: true },
    fallback: "We couldn't load that supplier.",
    handler: async () => {
      const supplier = await findSupplier(businessId, supplierId);
      if (!supplier) return { status: 404, data: { error: "That supplier was not found." } };
      const [entries, purchases] = await Promise.all([
        listCreditEntries(businessId, { partyType: PAYABLE, partyId: supplierId, take: 200 }),
        listPurchases(businessId, { take: 25 }),
      ]);
      const statement = buildStatement(toCreditEntries(entries, PAYABLE), PAYABLE);
      return posOk({
        supplier,
        statement,
        purchases: purchases.filter((purchase: any) => purchase.supplierId === supplierId),
      });
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { businessId, supplierId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_SUPPLIERS" },
    fallback: "We couldn't save that supplier.",
    handler: async ({ actor, body }) => {
      const existing = await findSupplier(businessId, supplierId);
      if (!existing) return fromOutcome({ ok: false, message: "That supplier was not found.", code: "NOT_FOUND" });
      const input = sanitizeSupplierInput(body);
      if (!input.name) return fromOutcome({ ok: false, message: "Give the supplier a name." });
      await updateSupplier(businessId, supplierId, input);
      await logPosAudit({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_SUPPLIER_CREATED",
        targetType: "SUPPLIER",
        targetId: supplierId,
        before: { name: existing.name, termsDays: existing.termsDays, creditEnabled: existing.creditEnabled },
        after: { name: input.name, termsDays: input.termsDays, creditEnabled: input.creditEnabled },
      });
      return fromOutcome({ ok: true, warnings: [] }, { supplier: await findSupplier(businessId, supplierId) });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId, supplierId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: {},
    fallback: "We couldn't record that payment.",
    handler: async ({ ctx, actor, body }) => {
      if (bool(body, "edit")) {
        return fromOutcome({ ok: false, message: "Use the edit form to change a supplier record." });
      }
      if (!ctx.entitlement.entitled) {
        return fromOutcome({ ok: false, message: ctx.entitlement.reason, code: "PAYMENT_REQUIRED" });
      }
      const outcome = await paySupplier({
        businessId,
        configuration: ctx.configuration,
        actor,
        supplierId,
        amountKES: positiveNumber(body, "amountKES"),
        method: optionalText(body, "method", 32),
        reference: optionalText(body, "reference", 80),
        note: text(body, "note", 500) || null,
      });
      return fromOutcome(outcome, { balanceKES: outcome.balanceKES ?? 0, amountKES: outcome.amountKES ?? 0 });
    },
  });
}
