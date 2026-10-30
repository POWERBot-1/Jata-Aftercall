import { ownsProductImage } from "@/lib/pos/productImage";
import { fromOutcome, handlePosRequest, posFail } from "@/lib/pos/http";
import { containsInlineImageDataUrl, INLINE_MEDIA_PERSISTENCE_CODE, INLINE_MEDIA_PERSISTENCE_MESSAGE } from "@/lib/media/persistence-policy";
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
      if (containsInlineImageDataUrl(body.imageUrl)) {
        if (typeof body.imageUrl === "string" && body.imageUrl === existing.imageUrl) input.imageUrl = undefined;
        else return posFail(INLINE_MEDIA_PERSISTENCE_MESSAGE, 503, INLINE_MEDIA_PERSISTENCE_CODE);
      }
      if (input.imageUrl && input.imageUrl !== existing.imageUrl && !await ownsProductImage(businessId, input.imageUrl)) {
        return posFail("Choose a photo from this business's media library.", 400, "product_image_not_owned");
      }
      try { await updateProduct(businessId, productId, input); }
      catch (error) {
        if (String(error).includes("POS_CATEGORY_INACTIVE")) return posFail("Restore that category before moving an item to it.", 409, "CATEGORY_INACTIVE");
        throw error;
      }
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
