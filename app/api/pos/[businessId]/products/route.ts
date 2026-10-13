import { fromOutcome, handlePosRequest, posOk, queryString, queryInt } from "@/lib/pos/http";
import { logPosAudit } from "@/lib/pos/audit";
import { createProduct, listProducts } from "@/lib/pos/store";
import { unitOptions } from "@/lib/pos/units";
import { bool, sanitizeProductInput } from "@/lib/pos/validation";

/**
 * The catalogue (§13, §24).
 *
 * One table serves every trade: a dish, a bag of cement and a haircut differ by `kind`, unit and
 * which fields the configuration exposes. The screens render the configured fields; the server
 * stores the same shape (§52 — no per-industry code).
 *
 * Adding products is setup work, so it is allowed before the plan is paid (§61: a business can
 * start getting ready immediately). Selling them is not (§44).
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_INVENTORY", fast: true },
    fallback: "We couldn't load your items.",
    handler: async ({ ctx, url }) => {
      const products = await listProducts(businessId, {
        kind: queryString(url, "kind") ?? undefined,
        search: queryString(url, "search") ?? undefined,
        activeOnly: queryString(url, "includeInactive") ? false : true,
        take: Math.min(queryInt(url, "take", 200), 500),
      });
      return posOk({
        products,
        units: unitOptions(ctx.configuration),
        canEdit: ctx.permissions.includes("EDIT_INVENTORY"),
        tracksStock: ctx.configuration.inventory.enabled,
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "EDIT_INVENTORY" },
    fallback: "We couldn't save that item.",
    handler: async ({ ctx, actor, body }) => {
      const input = sanitizeProductInput(body);
      if (!input.name) return fromOutcome({ ok: false, message: "Give the item a name." });
      if (input.saleError) return fromOutcome({ ok: false, message: input.saleError });
      const product = await createProduct(businessId, input);
      await logPosAudit({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_PRODUCT_CREATED",
        targetType: "PRODUCT",
        targetId: product.id,
        metadata: { name: input.name, kind: input.kind, priceKES: input.priceKES, trackInventory: input.trackInventory },
      });
      return fromOutcome({ ok: true, warnings: [] }, { product }, 201);
    },
  });
}
