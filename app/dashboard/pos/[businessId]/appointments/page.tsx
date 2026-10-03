import { OrderScreen } from "../orders/OrderScreen";

/** Appointments (§18 salon/clinic). The order board filtered to the appointment workflow. */

export const dynamic = "force-dynamic";

export const metadata = { title: "Appointments" };

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string }> };

export default async function PosAppointmentsPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  return <OrderScreen businessId={businessId} module="appointments" workflowKey="appointment" openNew={query.new === "1"} />;
}
