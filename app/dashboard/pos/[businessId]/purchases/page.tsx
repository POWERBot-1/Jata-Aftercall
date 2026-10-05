import { listProducts, listPurchases, listSuppliers } from "@/lib/pos/store";
import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { PosRefusal } from "@/components/pos/PosRefusal";
import { PurchasesClient } from "@/components/pos/PurchasesClient";

/**
 * Purchases (§12, §33). What came in, from whom, what it cost, and what is still on order.
 * Receiving writes the stock movements, so the stock room and the purchases always agree.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Purchases" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosPurchasesPage({ params }: Props) {
  const { businessId } = await params;
  // Purchases belong to the suppliers module (§17).
  const gate = await loadPosPageWorkspace(businessId, "VIEW_SUPPLIERS");
  if (!gate.workspace) return <PosRefusal message={gate.refusal} basePath={gate.basePath} />;
  const workspace = gate.workspace;
  const configuration = workspace.configuration;

  const [purchases, suppliers, products] = await Promise.all([
    listPurchases(businessId, { take: 40 }),
    listSuppliers(businessId, { take: 200 }),
    listProducts(businessId, { take: 400 }),
  ]);

  const supplierName = new Map((suppliers as any[]).map((supplier) => [supplier.id, supplier.name]));

  return (
    <div className="space-y-3">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">Purchases</p>
          <h2 className="text-xl font-bold">Buying in</h2>
          <p className="pos-note">
            {configuration.suppliers.purchaseOrders
              ? "Order it, then receive it when it arrives — stock moves only when it does."
              : "Record what you buy and it goes straight into stock."}
          </p>
        </div>
      </div>

      <PurchasesClient
        businessId={businessId}
        basePath={workspace.basePath}
        purchases={(purchases as any[]).map((purchase) => ({
          id: purchase.id,
          reference: purchase.reference,
          status: purchase.status,
          supplierName: purchase.supplierId ? supplierName.get(purchase.supplierId) ?? null : null,
          totalKES: Number(purchase.totalKES ?? 0),
          paidKES: Number(purchase.paidKES ?? 0),
          createdAt: purchase.createdAt,
          expectedAt: purchase.expectedAt ?? null,
          items: (purchase.items ?? []).map((item: any) => ({
            id: item.id,
            name: item.name,
            quantity: Number(item.quantity ?? 0),
            receivedQty: Number(item.receivedQty ?? 0),
            unitKey: item.unitKey ?? null,
            unitCostKES: Number(item.unitCostKES ?? 0),
            productId: item.productId ?? null,
          })),
        }))}
        suppliers={(suppliers as any[]).map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        products={(products as any[]).map((product) => ({
          id: product.id,
          name: product.name,
          unitKey: product.unitKey ?? "piece",
          costKES: product.costKES == null ? null : Number(product.costKES),
        }))}
        purchaseOrders={Boolean(configuration.suppliers.purchaseOrders)}
        partialReceiving={Boolean(configuration.suppliers.partialReceiving)}
        supplierCredit={Boolean(configuration.suppliers.credit)}
        word={workspace.terminology.supplier}
        canCreate={workspace.permissions.includes("CREATE_PURCHASE")}
        entitled={workspace.entitlement.entitled}
      />
    </div>
  );
}
