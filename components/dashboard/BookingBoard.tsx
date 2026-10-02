"use client";

/**
 * Booking board (§29)
 *
 * Confirm, start, complete, cancel or mark a no-show. Only valid transitions are offered, and
 * a deposit is shown separately so an unpaid booking is never treated as confirmed business.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, isValidBookingTransition, type BookingStatus } from "@/lib/experience/booking";
import { formatDateTime, formatDuration, formatKES, maskPhone } from "@/lib/format";

export type BoardBooking = {
  id: string;
  serviceName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  staffName: string | null;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  status: string;
  depositKES: number;
  paymentStatus: string;
  notes: string | null;
};

export function BookingBoard({ bookings: initial }: { bookings: BoardBooking[] }) {
  const router = useRouter();
  const [bookings, setBookings] = useState<BoardBooking[]>(initial);
  const [filter, setFilter] = useState("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = filter === "ALL" ? bookings : bookings.filter((booking) => booking.status === filter);
  const pendingCount = bookings.filter((booking) => booking.status === "PENDING").length;

  async function move(booking: BoardBooking, status: BookingStatus) {
    setBusyId(booking.id);
    setError(null);
    try {
      const response = await fetch("/api/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: booking.id, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "We couldn’t update that booking.");
      setBookings((current) => current.map((entry) => (entry.id === booking.id ? { ...entry, status: data.booking.status } : entry)));
      router.refresh();
    } catch {
      setError("We couldn’t reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="jata-toolbar">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter bookings">
          {["ALL", ...BOOKING_STATUSES].map((status) => (
            <button
              key={status}
              type="button"
              className={`jata-btn ${filter === status ? "jata-btn-primary" : "jata-btn-secondary"}`}
              aria-pressed={filter === status}
              onClick={() => setFilter(status)}
            >
              {status === "ALL" ? "All" : BOOKING_STATUS_LABELS[status as BookingStatus]}
              {status === "PENDING" && pendingCount ? ` (${pendingCount})` : ""}
            </button>
          ))}
        </div>
        <p className="text-sm text-zinc-600">{bookings.length} bookings</p>
      </div>

      {error ? <p className="jata-error text-sm" role="alert">{error}</p> : null}

      {visible.length === 0 ? (
        <div className="jata-empty">
          <p className="text-sm font-semibold">No bookings here yet</p>
          <p className="mt-1 text-sm text-zinc-600">Requests appear here as soon as a customer books a slot.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((booking) => (
            <li key={booking.id} className="jata-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{booking.serviceName}</p>
                  <p className="text-sm text-zinc-600">
                    {booking.customerName} · {maskPhone(booking.customerPhone)}
                  </p>
                  <p className="text-sm text-zinc-600">{formatDateTime(booking.startAt)}</p>
                  {booking.durationMinutes ? <p className="text-xs text-zinc-500">{formatDuration(booking.durationMinutes)}</p> : null}
                  {booking.staffName ? <p className="text-xs text-zinc-500">With {booking.staffName}</p> : null}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{BOOKING_STATUS_LABELS[booking.status as BookingStatus] || booking.status}</p>
                  {booking.depositKES > 0 ? (
                    <p className={`text-xs font-semibold ${booking.paymentStatus === "PAID" ? "text-emerald-700" : "text-amber-700"}`}>
                      Deposit {formatKES(booking.depositKES)} · {booking.paymentStatus === "PAID" ? "Paid" : "Unpaid"}
                    </p>
                  ) : null}
                </div>
              </div>
              {booking.notes ? <p className="mt-2 text-sm text-zinc-600">Note: {booking.notes}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {BOOKING_STATUSES.filter((status) => status !== booking.status && isValidBookingTransition(booking.status, status)).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="jata-btn jata-btn-secondary"
                    disabled={busyId === booking.id}
                    onClick={() => move(booking, status)}
                  >
                    {BOOKING_STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
