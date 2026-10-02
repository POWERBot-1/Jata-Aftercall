import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/db";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { BookingBoard, type BoardBooking } from "@/components/dashboard/BookingBoard";

export const metadata: Metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

export default async function BookingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  if (!workspace.experience) redirect(`/dashboard/businesses/${id}`);
  if (!workspace.profile.capabilities.includes("booking")) redirect(`/dashboard/businesses/${id}`);

  const bookings = await prisma.booking.findMany({
    where: { businessId: id },
    orderBy: { startAt: "asc" },
    take: 100,
  });

  const board: BoardBooking[] = bookings.map((booking) => ({
    id: booking.id,
    serviceName: booking.serviceName,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    customerEmail: booking.customerEmail,
    staffName: booking.staffName,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt ? booking.endAt.toISOString() : null,
    durationMinutes: booking.durationMinutes,
    status: String(booking.status),
    depositKES: booking.depositKES,
    paymentStatus: String(booking.paymentStatus),
    notes: booking.notes,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Bookings</h1>
        <p className="text-sm text-zinc-600">Requests arrive here with the customer’s chosen time and contact details.</p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <BookingBoard bookings={board} />
    </div>
  );
}
