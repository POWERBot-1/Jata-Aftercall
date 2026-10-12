import { fromOutcome, handlePosRequest } from "@/lib/pos/http";
import { logPosAudit } from "@/lib/pos/audit";
import { findProduct, setProductActive, updateProduct } from "@/lib/pos/store";
import { bool, sanitizeProductInput } from "@/lib/pos/validation";

/**
 * Editing one item (§13, §54).
 *
 * The lookup is compound (`businessId` + `productId`), so an id from another business matches
 * nothing at all — the route answers "not found" instead of changing someone else's catalogue
 * (§75). Changing a price never rewrites past sales: they keep the price they were sold at.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; productId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { businessId, productId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "EDIT_INVENTORY" },
    fallback: "We couldn't save that item.",
    handler: async ({ actor, body }) => {
      const existing = await findProduct(businessId, productId);
      if (!existing) return fromOutcome({ ok: false, message: "That item was not found.", code: "NOT_FOUND" });

      if (bool(body, "archive") || bool(body, "restore")) {
        await setProductActive(businessId, productId, bool(body, "restore"));
        await logPosAudit({
          businessId,
          actorId: actor.actorId,
          actorName: actor.actorName,
          action: "POS_PRODUCT_UPDATED",
          targetType: "PRODUCT",
          targetId: productId,
          before: { isActive: existing.isActive },
          after: { isActive: bool(body, "restore") },
        });
        return fromOutcome({ ok: true, warnings: [] }, { productId, isActive: bool(body, "restore") });
      }

      const input = sanitizeProductInput(body);
      if (!input.name) return fromOutcome({ ok: false, message: "Give the item a name." });
      if (input.saleError) return fromOutcome({ ok: false, message: input.saleError });
      await updateProduct(businessId, productId, input);
      await logPosAudit({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: input.priceKES !== existing.priceKES ? "POS_PRICE_CHANGED" : "POS_PRODUCT_UPDATED",
        targetType: "PRODUCT",
        targetId: productId,
        before: { name: existing.name, priceKES: existing.priceKES, unitKey: existing.unitKey },
        after: { name: input.name, priceKES: input.priceKES, unitKey: input.unitKey },
      });
      return fromOutcome({ ok: true, warnings: [] }, { product: await findProduct(businessId, productId) });
    },
  });
}
