import { paymentMethodOptions } from "@/lib/pos/money";
import { formatReceiptNumber, receiptPrefixFromBusinessName } from "@/lib/pos/receipt";
import { listCustomers, listProducts, nextSaleSequence, stockLevels } from "@/lib/pos/store";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { TillClient } from "@/components/pos/TillClient";

/**
 * New sale (§4 quick action, §62).
 *
 * The screen is generated like everything else: the payment buttons are the methods this business
 * configured, the discount box only appears for a business that gives discounts and a person who
 * may give them, and a business that does not track stock never sees a stock number.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "New sale" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosSellPage({ params }: Props) {
  const { businessId } = await params;
  const workspace = await loadPosWorkspaceCached(businessId);
  const configuration = workspace.configuration;

  const [products, customers, sequence, stock] = await Promise.all([
    listProducts(businessId, { take: 300 }),
    configuration.customers.enabled ? listCustomers(businessId, { take: 200 }) : Promise.resolve([]),
    nextSaleSequence(businessId),
    configuration.inventory.enabled ? stockLevels(businessId) : Promise.resolve([]),
  ]);

  const stockByProduct = new Map<string, number>();
  for (const item of stock as any[]) {
    const scope = item.branchId ?? "";
    if (workspace.branchId && scope && scope !== workspace.branchId) continue;
    stockByProduct.set(item.productId, (stockByProduct.get(item.productId) ?? 0) + Number(item.quantity ?? 0));
  }

  const prefix = receiptPrefixFromBusinessName(configuration.receipt.businessName || workspace.business.name);

  return (
    <div className="space-y-3">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{workspace.terminology.sale}</p>
          <h2 className="text-xl font-bold">New {workspace.terminology.sale.toLowerCase()}</h2>
        </div>
        <span className="jata-status">Next receipt {formatReceiptNumber(prefix, sequence)}</span>
      </div>

      <TillClient
        businessId={businessId}
        basePath={workspace.basePath}
        products={(products as any[]).map((product) => ({
          id: product.id,
          name: product.name,
          kind: product.kind === "SERVICE" ? "SERVICE" : "PRODUCT",
          priceKES: Number(product.priceKES ?? 0),
          unitKey: product.unitKey ?? "piece",
          barcode: product.barcode ?? null,
          category: product.category ?? null,
          stock: configuration.inventory.enabled && product.trackInventory !== false
            ? stockByProduct.get(product.id) ?? 0
            : null,
        }))}
        customers={(customers as any[]).map((customer) => ({
          id: customer.id,
          name: customer.name,
          phone: customer.phone ?? null,
          balanceKES: Number(customer.balanceKES ?? 0),
        }))}
        methods={paymentMethodOptions(configuration)}
        words={{
          sale: workspace.terminology.sale,
          customer: workspace.terminology.customer,
          product: workspace.terminology.product,
          products: workspace.terminology.products,
          order: workspace.terminology.order,
        }}
        flags={{
          discounts: configuration.sales.discounts,
          splitPayments: configuration.sales.splitPayments,
          partialPayments: configuration.sales.partialPayments,
          credit: configuration.credit.enabled,
          taxEnabled: configuration.sales.tax.enabled,
          taxLabel: configuration.sales.tax.label,
          deliveryEnabled: configuration.delivery.enabled,
          deliveryFeeKES: configuration.delivery.feeKES,
          canEditPrice: workspace.permissions.includes("EDIT_PRICE"),
          canDiscount: workspace.permissions.includes("APPLY_DISCOUNT"),
          channels: configuration.orders.channels.length ? ["walk_in", ...configuration.orders.channels.filter((channel) => channel !== "walk_in")] : ["walk_in"],
        }}
        entitled={workspace.entitlement.entitled}
        entitlementReason={workspace.entitlement.reason}
        nextReceiptNumber={formatReceiptNumber(prefix, sequence)}
      />
    </div>
  );
}
