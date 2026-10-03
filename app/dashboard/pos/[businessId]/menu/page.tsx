import { ProductScreen } from "../products/ProductScreen";

/** Menu (§18 restaurant). Same catalogue screen as Products, with the trade's own words. */

export const dynamic = "force-dynamic";

export const metadata = { title: "Menu" };

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string }> };

export default async function PosMenuPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  return <ProductScreen businessId={businessId} module="menu" openNew={query.new === "1"} />;
}
