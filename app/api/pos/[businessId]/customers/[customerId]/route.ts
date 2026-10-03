import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { logPosAudit } from "@/lib/pos/audit";
import { buildStatement, RECEIVABLE, toCreditEntries } from "@/lib/pos/credit";
import { recordRepayment } from "@/lib/pos/sales";
import { addCustomerAsset, findCustomer, listCreditEntries, listSales, updateCustomer } from "@/lib/pos/store";
import { bool, sanitizeAssetInput, sanitizeCustomerInput, sanitizeRepayment } from "@/lib/pos/validation";

/**
 * One customer (§14, §30, §46).
 *
 * GET returns the record with its own history and statement — always scoped to this business, so
 * a guessed id from another tenant simply does not exist here (§75). POST records a repayment or
 * adds an asset (a vehicle, a unit, a pet — one generic record, whatever the trade calls it).
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; customerId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId, customerId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "VIEW_CUSTOMERS", fast: true },
    fallback: "We couldn't load that customer.",
    handler: async ({ ctx }) => {
      const customer = await findCustomer(businessId, customerId);
      if (!customer) return { status: 404, data: { error: "That customer was not found." } };
      const [entries, sales] = await Promise.all([
        listCreditEntries(businessId, { partyType: RECEIVABLE, partyId: customerId, take: 200 }),
        listSales(businessId, { customerId, take: 50 }),
      ]);
      const statement = buildStatement(toCreditEntries(entries, RECEIVABLE), RECEIVABLE);
      return posOk({
        customer,
        assets: customer.assets ?? [],
        statement,
        recentSales: sales.map((sale: any) => ({
          id: sale.id,
          receiptNumber: sale.receiptNumber,
          createdAt: sale.createdAt,
          totalKES: sale.totalKES,
          balanceKES: sale.balanceKES,
          status: sale.status,
        })),
        canRecordRepayment: ctx.permissions.includes("RECORD_REPAYMENT"),
        canApproveCredit: ctx.permissions.includes("APPROVE_CREDIT"),
        word: ctx.terminology.customer,
      });
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { businessId, customerId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_CUSTOMERS" },
    fallback: "We couldn't save that customer.",
    handler: async ({ ctx, actor, body }) => {
      const existing = await findCustomer(businessId, customerId);
      if (!existing) return fromOutcome({ ok: false, message: "That customer was not found.", code: "NOT_FOUND" });

      const input = sanitizeCustomerInput(body);
      // Opening or raising a credit limit is a credit decision, not an edit (§30, §36).
      const openingCredit = input.creditEnabled && !existing.creditEnabled;
      const raisingLimit = input.creditLimitKES > Number(existing.creditLimitKES ?? 0);
      if ((openingCredit || raisingLimit) && !ctx.permissions.includes("APPROVE_CREDIT")) {
        return fromOutcome({ ok: false, message: "You don't have permission to change credit limits.", code: "NOT_ALLOWED" });
      }
      if (openingCredit && !ctx.configuration.credit.enabled) {
        return fromOutcome({ ok: false, message: "Credit is switched off for this business.", code: "CREDIT_DISABLED" });
      }

      await updateCustomer(businessId, customerId, input);
      await logPosAudit({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_CUSTOMER_UPDATED",
        targetType: "CUSTOMER",
        targetId: customerId,
        before: { name: existing.name, phone: existing.phone, creditEnabled: existing.creditEnabled, creditLimitKES: existing.creditLimitKES },
        after: { name: input.name, phone: input.phone, creditEnabled: input.creditEnabled, creditLimitKES: input.creditLimitKES },
      });
      return fromOutcome({ ok: true, warnings: [] }, { customer: await findCustomer(businessId, customerId) });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId, customerId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: {},
    fallback: "We couldn't save that.",
    handler: async ({ ctx, actor, body }) => {
      const customer = await findCustomer(businessId, customerId);
      if (!customer) return fromOutcome({ ok: false, message: "That customer was not found.", code: "NOT_FOUND" });

      if (bool(body, "asset") || body.asset) {
        const asset = sanitizeAssetInput(body.asset && typeof body.asset === "object" ? (body.asset as Record<string, unknown>) : body);
        if (!asset.name) return fromOutcome({ ok: false, message: "Give it a name." });
        const created = await addCustomerAsset(businessId, customerId, asset);
        return fromOutcome({ ok: true, warnings: [] }, { asset: created }, 201);
      }

      // A repayment moves money, so it needs a live subscription (§44).
      if (!ctx.entitlement.entitled) {
        return fromOutcome({ ok: false, message: ctx.entitlement.reason, code: "PAYMENT_REQUIRED" });
      }
      const repayment = sanitizeRepayment(body);
      const outcome = await recordRepayment({
        businessId,
        configuration: ctx.configuration,
        actor,
        customerId,
        amountKES: repayment.amountKES,
        method: repayment.method,
        reference: repayment.reference,
        note: repayment.note,
      });
      return fromOutcome(outcome, { balanceKES: outcome.balanceKES ?? 0, amountKES: outcome.amountKES ?? 0 });
    },
  });
}
