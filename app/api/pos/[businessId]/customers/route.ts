import { fromOutcome, handlePosRequest, posOk, queryString, queryInt } from "@/lib/pos/http";
import { logPosAudit } from "@/lib/pos/audit";
import { createCustomer, listCustomers } from "@/lib/pos/store";
import { bool, sanitizeCustomerInput } from "@/lib/pos/validation";

/**
 * Customers (§14, §46, §69).
 *
 * Whatever the configuration calls them — guests, clients, patients, vehicle owners — this is
 * the same record with the same fields. Only the words on screen change.
 *
 * Credit limits are set here but enforced by the credit engine at the moment of sale (§30): a
 * browser cannot declare a customer within their limit.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_CUSTOMERS", fast: true },
    fallback: "We couldn't load your customers.",
    handler: async ({ ctx, url }) => posOk({
      customers: await listCustomers(businessId, {
        search: queryString(url, "search") ?? undefined,
        creditOnly: Boolean(queryString(url, "credit")),
        take: Math.min(queryInt(url, "take", 100), 500),
      }),
      word: ctx.terminology.customer,
      plural: ctx.terminology.customers,
      creditEnabled: ctx.configuration.credit.enabled,
      fields: ctx.configuration.customers.fields,
      assetLabel: ctx.terminology.customer,
    }),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "MANAGE_CUSTOMERS" },
    fallback: "We couldn't save that customer.",
    handler: async ({ ctx, actor, body }) => {
      const input = sanitizeCustomerInput(body);
      if (!input.name) return fromOutcome({ ok: false, message: `Give the ${ctx.terminology.customer.toLowerCase()} a name.` });
      if (input.creditEnabled && !ctx.configuration.credit.enabled) {
        return fromOutcome({ ok: false, message: "Credit is switched off for this business. Turn it on in your setup first.", code: "CREDIT_DISABLED" });
      }
      if (input.creditEnabled && !ctx.permissions.includes("APPROVE_CREDIT")) {
        return fromOutcome({ ok: false, message: "You don't have permission to open a credit account.", code: "NOT_ALLOWED" });
      }
      const customer = await createCustomer(businessId, input);
      await logPosAudit({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_CUSTOMER_CREATED",
        targetType: "CUSTOMER",
        targetId: customer.id,
        metadata: { name: input.name, creditEnabled: input.creditEnabled, creditLimitKES: input.creditLimitKES },
      });
      return fromOutcome({ ok: true, warnings: [] }, { customer }, 201);
    },
  });
}
