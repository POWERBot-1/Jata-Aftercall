import { OrderScreen } from "./OrderScreen";

/**
 * Orders (§28, §29). The board renders whatever workflow this business configured — the same
 * screen a restaurant, a laundry, a courier and a garage all use, with different columns.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Orders" };

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string; state?: string }> };

export default async function PosOrdersPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  return <OrderScreen businessId={businessId} module="orders" openNew={query.new === "1"} stateFilter={query.state} />;
}
