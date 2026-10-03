import { OrderScreen } from "../orders/OrderScreen";

/** Projects (§18 contractor/events). The order board filtered to the project workflow. */

export const dynamic = "force-dynamic";

export const metadata = { title: "Projects" };

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string }> };

export default async function PosProjectsPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  return <OrderScreen businessId={businessId} module="projects" workflowKey="project" openNew={query.new === "1"} />;
}
