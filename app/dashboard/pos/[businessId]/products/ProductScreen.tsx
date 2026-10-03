import { emptyStateFor } from "@/lib/pos/presentation";
import { formSpec } from "@/lib/pos/forms";
import { listProducts, stockLevels } from "@/lib/pos/store";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { RecordBoard } from "@/components/pos/RecordBoard";
import type { PosModuleKey } from "@/lib/pos/types";

/**
 * The catalogue screen (§13, §24).
 *
 * One screen serves Products, Menu and Services: the module key decides the words and the filter,
 * and the field list comes from the configuration. A business that does not track stock never sees
 * a stock column, and one without wholesale pricing never sees a wholesale field (§52).
 */

export async function ProductScreen({
  businessId,
  module = "products",
  kind,
  openNew = false,
}: {
  businessId: string;
  module?: PosModuleKey;
  kind?: "PRODUCT" | "SERVICE";
  openNew?: boolean;
}) {
  const workspace = await loadPosWorkspaceCached(businessId);
  const configuration = workspace.configuration;
  const spec = formSpec(configuration, "product");

  const [products, stock] = await Promise.all([
    listProducts(businessId, { take: 400, kind }),
    configuration.inventory.enabled ? stockLevels(businessId) : Promise.resolve([]),
  ]);

  const stockByProduct = new Map<string, number>();
  for (const item of stock as any[]) {
    if (workspace.branchId && item.branchId && item.branchId !== workspace.branchId) continue;
    stockByProduct.set(item.productId, (stockByProduct.get(item.productId) ?? 0) + Number(item.quantity ?? 0));
  }

  const rows = (products as any[]).map((product) => ({
    ...product,
    stock: product.trackInventory === false || !configuration.inventory.enabled ? null : stockByProduct.get(product.id) ?? 0,
  }));

  const heading = module === "menu" ? "Menu" : module === "services" ? spec.plural : spec.plural;
  const blurb = module === "menu"
    ? "What the kitchen and bar sell. Change a price here and it changes at the till."
    : module === "services"
      ? "The work you do for people — with what it costs and how long it takes."
      : configuration.sales.products && configuration.sales.services
        ? "Everything you sell — things you keep and things you do."
        : configuration.sales.products
          ? "What you keep and sell."
          : "The work you do for people.";

  return (
    <div className="space-y-3">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{heading}</p>
          <h2 className="text-xl font-bold">{heading}</h2>
          <p className="pos-note">{blurb}</p>
        </div>
      </div>

      <RecordBoard
        businessId={businessId}
        basePath={workspace.basePath}
        apiPath={`/api/pos/${encodeURIComponent(businessId)}/products`}
        word={spec.word}
        plural={spec.plural}
        fields={spec.fields.filter((field) =>
          module === "services" ? field.key !== "trackInventory" || configuration.sales.products : true,
        )}
        rows={rows}
        titleKey="name"
        subtitleKeys={["category", "unitKey"]}
        valueColumns={[
          { key: "priceKES", money: true },
          ...(configuration.inventory.enabled && module !== "services" ? [{ key: "stock", label: "In stock" }] : []),
        ]}
        canEdit={workspace.permissions.includes("EDIT_INVENTORY")}
        canArchive
        openNew={openNew}
        emptyState={emptyStateFor(configuration, module === "services" ? "services" : module === "menu" ? "menu" : "products", workspace.basePath)}
      />
    </div>
  );
}
