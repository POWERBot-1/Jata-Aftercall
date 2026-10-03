import { ProductScreen } from "./ProductScreen";

/** Products and services (§13). The screen is shared with Menu and Services — only the words and the filter change. */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string; kind?: string }> };

export default async function PosProductsPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  return (
    <ProductScreen
      businessId={businessId}
      module="products"
      kind={query.kind === "SERVICE" || query.kind === "PRODUCT" ? query.kind : undefined}
      openNew={query.new === "1"}
    />
  );
}
