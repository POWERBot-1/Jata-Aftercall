import { OrderScreen } from "../orders/OrderScreen";

/** Job cards (§18 garage/workshop). The order board filtered to the job workflow. */

export const dynamic = "force-dynamic";

export const metadata = { title: "Jobs" };

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string }> };

export default async function PosJobsPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  return <OrderScreen businessId={businessId} module="jobs" workflowKey="garage" openNew={query.new === "1"} />;
}
