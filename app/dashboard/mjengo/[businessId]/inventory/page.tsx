import { notFound } from "next/navigation";
import { loadInventoryOverview } from "@/lib/mjengo/workspace";

export const dynamic = "force-dynamic";

export default async function MjengoInventory({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();
  const { stock, low, tracked } = await loadInventoryOverview(businessId);

  return (
    <section aria-labelledby="mjengo-inventory-heading">
      <h2 id="mjengo-inventory-heading" className="text-lg font-semibold">Inventory</h2>
      <p className="text-sm text-muted-foreground">
        On-hand quantities are the sum of the stock ledger, never a directly edited number. A sale of
        the same product listed twice on one basket is aggregated before the stock check, so
        &quot;2 × 1&quot; is refused when only one unit exists.
      </p>
      <p className="mt-2 text-sm">{tracked} tracked item(s) · {low.length} at or below reorder level</p>

      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">Stock on hand</caption>
        <thead><tr className="text-left text-muted-foreground"><th scope="col">Item</th><th scope="col">On hand</th><th scope="col">Unit</th><th scope="col">Reorder level</th><th scope="col">State</th></tr></thead>
        <tbody>
          {stock.map((line) => {
            const isLow = line.reorderLevel > 0 && line.quantity <= line.reorderLevel;
            return (
              <tr key={line.productId} className="border-t">
                <td className="py-1">{line.name}</td>
                <td>{line.quantity}</td>
                <td>{line.unitKey}</td>
                <td>{line.reorderLevel}</td>
                <td>{line.quantity <= 0 ? "Out of stock" : isLow ? "Low" : "OK"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {stock.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No products registered yet.</p> : null}
    </section>
  );
}
