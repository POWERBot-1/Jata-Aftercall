import { manualReasons } from "@/lib/pos/inventory";
import { listBranches, listMovements, listProducts, stockWithProducts } from "@/lib/pos/store";
import { sanitizeRange } from "@/lib/pos/validation";
import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { InventoryClient } from "@/components/pos/InventoryClient";
import { PosRefusal } from "@/components/pos/PosRefusal";

/**
 * Stock (§16, §33). What is on hand, what needs attention, and the ledger of every change with
 * the reason it happened. A business that does not track stock never reaches this screen — the
 * navigation is generated, so the module simply is not there.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ from?: string; to?: string }> };

export default async function PosInventoryPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  // Stock is the inventory module's read (§13) — the page answers like the stock API.
  const gate = await loadPosPageWorkspace(businessId, "VIEW_INVENTORY");
  if (!gate.workspace) return <PosRefusal message={gate.refusal} basePath={gate.basePath} />;
  const workspace = gate.workspace;
  const configuration = workspace.configuration;
  const range = sanitizeRange({ from: query.from, to: query.to }, 14);

  const [items, movements, branches, products] = await Promise.all([
    stockWithProducts(businessId),
    listMovements(businessId, { range: { from: range.from, to: range.to }, take: 150 }),
    configuration.branches.enabled ? listBranches(businessId) : Promise.resolve([]),
    listProducts(businessId, { take: 400 }),
  ]);

  return (
    <div className="space-y-3">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{workspace.terminology.inventory}</p>
          <h2 className="text-xl font-bold">{workspace.terminology.stock}</h2>
          <p className="pos-note">
            {configuration.inventory.locations
              ? `Tracked per ${workspace.terminology.branch.toLowerCase()}, and every change has a reason.`
              : "Every change has a reason, so the number always explains itself."}
          </p>
        </div>
      </div>

      <InventoryClient
        businessId={businessId}
        basePath={workspace.basePath}
        stock={(items as any[])
          .filter((item) => !workspace.branchId || !item.branchId || item.branchId === workspace.branchId)
          .map((item) => ({
            id: item.id,
            productId: item.productId,
            name: item.product?.name ?? "Item",
            unitKey: item.product?.unitKey ?? "piece",
            quantity: Number(item.quantity ?? 0),
            reorderLevel: Number(item.product?.reorderLevel ?? 0),
            branchId: item.branchId ?? null,
          }))}
        movements={(movements as any[]).map((movement) => ({
          id: movement.id,
          when: movement.createdAt,
          item: movement.product?.name ?? "Item",
          reason: movement.reason,
          delta: Number(movement.delta ?? 0),
          note: movement.note ?? null,
        }))}
        branches={(branches as any[]).map((branch) => ({ id: branch.id, name: branch.name }))}
        products={(products as any[]).map((product) => ({ id: product.id, name: product.name, unitKey: product.unitKey ?? "piece" }))}
        reasons={manualReasons(configuration).map((reason) => ({ key: reason.key, label: reason.label }))}
        canAdjust={workspace.permissions.includes("ADJUST_STOCK")}
        canTransfer={workspace.permissions.includes("TRANSFER_STOCK")}
        canCount={workspace.permissions.includes("ADJUST_STOCK") && configuration.inventory.stockCounts}
        locations={Boolean(configuration.inventory.locations)}
        words={{ stock: workspace.terminology.stock, branch: workspace.terminology.branch }}
        entitled={workspace.entitlement.entitled}
      />
    </div>
  );
}
