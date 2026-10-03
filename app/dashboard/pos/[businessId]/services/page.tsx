import { ProductScreen } from "../products/ProductScreen";

/** Services (§13). The same catalogue screen filtered to work you do rather than things you keep. */

export const dynamic = "force-dynamic";

export const metadata = { title: "Services" };

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string }> };

export default async function PosServicesPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  return <ProductScreen businessId={businessId} module="services" kind="SERVICE" openNew={query.new === "1"} />;
}
