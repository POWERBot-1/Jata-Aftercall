/**
 * Booking management (§29, §37)
 *
 * Owner board for booking-enabled businesses: confirm, start, complete, cancel, no-show.
 * Ownership is re-checked against the stored booking row — the id in the request body is
 * never trusted on its own (§37).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { BOOKING_STATUS_LABELS, isBookingStatus, isValidBookingTransition, type BookingStatus } from "@/lib/experience/booking";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const status = searchParams.get("status")?.trim() || "";
    const bookings = await prisma.booking.findMany({
      where: { businessId, ...(status && status !== "ALL" ? { status } : {}) },
      orderBy: { startAt: "asc" },
      take: 100,
    });
    return NextResponse.json({
      bookings: bookings.map((booking) => ({
        id: booking.id,
        serviceId: booking.serviceId,
        serviceName: booking.serviceName,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        customerEmail: booking.customerEmail,
        staffName: booking.staffName,
        startAt: booking.startAt,
        endAt: booking.endAt,
        status: booking.status,
        statusLabel: BOOKING_STATUS_LABELS[booking.status as BookingStatus] || booking.status,
        depositKES: booking.depositKES,
        paymentStatus: booking.paymentStatus,
        notes: booking.notes,
        createdAt: booking.createdAt,
      })),
    });
  } catch {
    console.error("booking list failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
    const status = typeof body?.status === "string" ? body.status : "";
    if (!bookingId || !isBookingStatus(status)) return NextResponse.json({ error: "Choose a booking and a valid status." }, { status: 400 });

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, businessId: true, status: true, serviceName: true },
    });
    if (!booking) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, booking.businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    if (!isValidBookingTransition(booking.status, status)) {
      return NextResponse.json({ error: `A booking cannot go from ${booking.status} to ${status}.` }, { status: 409 });
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status, ...(status === "CONFIRMED" ? {} : {}) },
      select: { id: true, status: true, serviceName: true, startAt: true },
    });
    await logAudit({
      actorId: session.userId,
      action: "BOOKING_STATUS_CHANGED",
      targetType: "BOOKING",
      targetId: bookingId,
      metadata: { from: booking.status, to: status },
    });
    return NextResponse.json({ booking: updated });
  } catch {
    console.error("booking update failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
