import { fromOutcome, handlePosRequest, posOk, queryString, queryInt } from "@/lib/pos/http";
import { MOVEMENT_REASONS, manualReasons, stockAlerts } from "@/lib/pos/inventory";
import { adjustStock, recordStockCount, transferStock } from "@/lib/pos/operations";
import { listBranches, listMovements, listProducts, lowStock, stockLevels, stockWithProducts } from "@/lib/pos/store";
import { sanitizeAdjustmentInput, sanitizeCountInput, sanitizeRange, sanitizeTransferInput, text } from "@/lib/pos/validation";

/**
 * Stock (§16, §33).
 *
 * GET shows what is on hand, what needs attention and the movement history. POST records an
 * adjustment, a transfer between locations or a stock count. Every one of them writes a
 * movement with a reason and an actor — the on-hand number is never edited directly, so the
 * ledger always explains itself.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_INVENTORY", fast: true },
    fallback: "We couldn't load your stock.",
    handler: async ({ ctx, url }) => {
      const range = sanitizeRange({ from: queryString(url, "from") ?? undefined, to: queryString(url, "to") ?? undefined }, 7);
      const [items, movements, branches, products] = await Promise.all([
        stockWithProducts(businessId),
        listMovements(businessId, { range: { from: range.from, to: range.to }, take: Math.min(queryInt(url, "take", 100), 500) }),
        ctx.configuration.branches.enabled ? listBranches(businessId) : Promise.resolve([]),
        listProducts(businessId, { take: 500 }),
      ]);
      const alerts = stockAlerts(
        items.map((item: any) => ({
          productId: item.productId,
          name: item.product?.name ?? "Item",
          quantity: Number(item.quantity ?? 0),
          reorderLevel: Number(item.product?.reorderLevel ?? 0),
          unitKey: item.product?.unitKey,
        })),
      );
      return posOk({
        stock: items.map((item: any) => ({
          id: item.id,
          productId: item.productId,
          name: item.product?.name ?? "Item",
          unitKey: item.product?.unitKey ?? "piece",
          quantity: Number(item.quantity ?? 0),
          reorderLevel: Number(item.product?.reorderLevel ?? 0),
          branchId: item.branchId,
        })),
        movements: movements.map((movement: any) => ({
          id: movement.id,
          when: movement.createdAt,
          item: movement.product?.name ?? "Item",
          reason: movement.reason,
          delta: movement.delta,
          note: movement.note,
          branchId: movement.branchId,
        })),
        alerts,
        lowStock: await lowStock(businessId),
        branches,
        products: products.map((product: any) => ({ id: product.id, name: product.name, unitKey: product.unitKey })),
        reasons: manualReasons(ctx.configuration),
        allReasons: MOVEMENT_REASONS,
        locations: ctx.configuration.inventory.locations,
        transfers: ctx.configuration.inventory.transfers,
        counts: ctx.configuration.inventory.stockCounts,
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    // Moving stock is trading activity: it needs a live subscription (§44).
    options: { requireLive: true },
    fallback: "We couldn't save that stock change.",
    handler: async ({ ctx, actor, body }) => {
      const action = text(body, "action", 20).toLowerCase();

      if (action === "transfer") {
        const input = sanitizeTransferInput(body);
        const outcome = await transferStock({
          businessId,
          configuration: ctx.configuration,
          actor,
          productId: input.productId,
          quantity: input.quantity,
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          note: input.note,
        });
        return fromOutcome(outcome, { movements: outcome.movements ?? [] });
      }

      if (action === "count") {
        const input = sanitizeCountInput(body);
        const outcome = await recordStockCount({
          businessId,
          configuration: ctx.configuration,
          actor,
          productId: input.productId,
          counted: input.counted,
          branchId: input.branchId,
          note: input.note,
        });
        return fromOutcome(outcome, { quantity: outcome.quantity ?? 0, difference: outcome.difference ?? 0 });
      }

      const outcome = await adjustStock({
        businessId,
        configuration: ctx.configuration,
        actor,
        input: sanitizeAdjustmentInput(body),
      });
      return fromOutcome(outcome, { quantity: outcome.quantity ?? 0 });
    },
  });
}
