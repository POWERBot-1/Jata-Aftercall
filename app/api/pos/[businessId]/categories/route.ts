import prisma from "@/lib/db";
import { logPosAuditInTransaction } from "@/lib/pos/audit";
import { handlePosRequest, posFail, posOk } from "@/lib/pos/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: Context) {
  const { businessId } = await context.params;
  return handlePosRequest({ businessId, request, options: { permission: "VIEW_INVENTORY", fast: true }, handler: async () => {
    const categories = await prisma.posCategory.findMany({ where: { businessId }, orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true, _count: { select: { products: true } }, image: { select: { imageUrl: true } } } });
    return posOk({ categories });
  } });
}

export async function POST(request: Request, context: Context) {
  const { businessId } = await context.params;
  return handlePosRequest({ businessId, request, options: { permission: "EDIT_INVENTORY" }, fallback: "We couldn't change that category.", handler: async ({ body, actor }) => {
    const action = typeof body.action === "string" ? body.action : "";
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!["create", "rename", "deactivate", "restore", "delete"].includes(action)) return posFail("Choose a category action.");
    if ((action === "create" || action === "rename") && (!name || name.length > 80)) return posFail("Use a category name of 1 to 80 characters.");
    if (action !== "create" && !id) return posFail("Choose a category.");
    try {
      return await prisma.$transaction(async (tx: any) => {
        const existing = action === "create" ? null : await tx.posCategory.findFirst({ where: { businessId, id } });
        if (action !== "create" && !existing) return posFail("That category was not found.", 404, "CATEGORY_NOT_FOUND");
        if (action === "delete") {
          const [products, image] = await Promise.all([
            tx.posProduct.count({ where: { businessId, category: existing.name } }),
            tx.posCategoryImage.count({ where: { businessId, category: existing.name } }),
          ]);
          if (products || image) return posFail("Move every item, including archived items, and remove the category photo before deleting this category.", 409, "CATEGORY_IN_USE");
          await tx.posCategory.deleteMany({ where: { businessId, id } });
        } else if (action === "create") {
          const category = await tx.posCategory.create({ data: { businessId, name } });
          await logPosAuditInTransaction(tx, { businessId, actorId: actor.actorId, actorName: actor.actorName, action: "POS_CATEGORY_CREATED", targetType: "CATEGORY", targetId: category.id, after: { name } });
          return posOk({ category }, 201);
        } else {
          await tx.posCategory.updateMany({ where: { businessId, id }, data: action === "rename" ? { name } : { isActive: action === "restore" } });
        }
        await logPosAuditInTransaction(tx, { businessId, actorId: actor.actorId, actorName: actor.actorName, action: `POS_CATEGORY_${action.toUpperCase()}`, targetType: "CATEGORY", targetId: id,
          before: { name: existing.name, isActive: existing.isActive }, after: action === "rename" ? { name } : action === "delete" ? null : { isActive: action === "restore" } });
        return posOk({ ok: true });
      });
    } catch (error: any) {
      if (error?.code === "P2002") return posFail("A category with that name already exists.", 409, "CATEGORY_EXISTS");
      if (error?.code === "P2003") return posFail("This category is still in use. Move its items and remove its photo first.", 409, "CATEGORY_IN_USE");
      throw error;
    }
  } });
}
