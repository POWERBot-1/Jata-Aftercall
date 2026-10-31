import prisma from "@/lib/db";
import { containsInlineImageDataUrl, INLINE_MEDIA_PERSISTENCE_CODE, INLINE_MEDIA_PERSISTENCE_MESSAGE } from "@/lib/media/persistence-policy";
import { ownsProductImage } from "@/lib/pos/productImage";
import { handlePosRequest, posFail, posOk } from "@/lib/pos/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: Context) {
  const { businessId } = await context.params;
  return handlePosRequest({ businessId, request, options: { permission: "VIEW_INVENTORY", fast: true }, fallback: "We couldn't load category photos.",
    handler: async () => posOk({ images: await prisma.posCategoryImage.findMany({ where: { businessId }, select: { category: true, imageUrl: true } }) }) });
}

export async function POST(request: Request, context: Context) {
  const { businessId } = await context.params;
  return handlePosRequest({ businessId, request, options: { permission: "EDIT_INVENTORY" }, fallback: "We couldn't save that category photo.",
    handler: async ({ body }) => {
      const category = typeof body.category === "string" ? body.category.trim() : "";
      if (!category || category.length > 80) return posFail("Choose a valid category.");
      if (containsInlineImageDataUrl(body.imageUrl)) return posFail(INLINE_MEDIA_PERSISTENCE_MESSAGE, 503, INLINE_MEDIA_PERSISTENCE_CODE);
      if (body.imageUrl === null) {
        await prisma.posCategoryImage.deleteMany({ where: { businessId, category } });
        return posOk({ ok: true });
      }
      if (typeof body.imageUrl !== "string" || body.imageUrl.length > 2000 || !await ownsProductImage(businessId, body.imageUrl)) {
        return posFail("Choose a photo from this business's media library.", 400, "category_image_not_owned");
      }
      const categoryRecord = await prisma.posCategory.findFirst({ where: { businessId, name: category }, select: { id: true } });
      if (!categoryRecord) return posFail("That category was not found.", 404, "category_not_found");
      const image = await prisma.posCategoryImage.upsert({
        where: { businessId_category: { businessId, category } },
        create: { businessId, category, imageUrl: body.imageUrl },
        update: { imageUrl: body.imageUrl },
        select: { category: true, imageUrl: true },
      });
      return posOk({ ok: true, image });
    } });
}
