import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/db";
import { loadWorkspace } from "@/lib/experience/workspace";
import { orderStagesFor, orderStatusToStage } from "@/lib/experience/orders";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { OrderBoard, type BoardOrder } from "@/components/dashboard/OrderBoard";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  if (!workspace.experience) redirect(`/dashboard/businesses/${id}`);
  if (!workspace.profile.capabilities.includes("commerce")) redirect(`/dashboard/businesses/${id}`);

  // Tenant-scoped: ownership was verified in loadWorkspace before this read (§37).
  const orders = await prisma.order.findMany({
    where: { businessId: id },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const board: BoardOrder[] = orders.map((order) => ({
    id: order.id,
    orderReference: order.orderReference,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    status: String(order.status),
    stage: orderStatusToStage(String(order.status)),
    paymentStatus: String(order.paymentStatus),
    subtotalKES: order.subtotalKES,
    deliveryFeeKES: order.deliveryFeeKES,
    discountKES: order.discountKES,
    totalKES: order.totalKES,
    fulfilmentType: order.fulfilmentType ? String(order.fulfilmentType) : null,
    deliveryLocation: order.deliveryLocation,
    deliveryInstructions: order.deliveryInstructions,
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceKES: item.unitPriceKES,
      variantDesc: item.variantDesc,
    })),
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Orders</h1>
        <p className="text-sm text-zinc-600">New orders arrive here the moment a customer pays.</p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <OrderBoard orders={board} stages={orderStagesFor(workspace.document.categoryKey)} />
    </div>
  );
}
