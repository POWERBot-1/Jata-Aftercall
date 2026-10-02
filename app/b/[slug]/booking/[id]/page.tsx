import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { loadStorefront } from "@/lib/experience/storefront";
import { StorefrontShell } from "@/components/storefront/StorefrontShell";
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/lib/experience/booking";
import { formatDateTime, formatKES } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; id: string }> };

export const metadata: Metadata = { title: "Booking", robots: { index: false, follow: false } };

export default async function BookingConfirmationPage({ params }: Props) {
  const { slug, id } = await params;
  const data = await loadStorefront(slug);
  if (!data) notFound();
  const booking = await prisma.booking.findFirst({ where: { id, businessId: data.business.id } });
  if (!booking) notFound();

  return (
    <StorefrontShell data={data}>
      <section className="eb-section">
        <div className="eb-container" style={{ maxWidth: "40rem" }}>
          <div className="eb-card" style={{ padding: "clamp(1.25rem, 4vw, 2rem)" }}>
            <span aria-hidden="true" style={{ fontSize: "1.75rem" }}>{booking.status === "CANCELLED" ? "❌" : booking.status === "CONFIRMED" ? "✅" : "⏳"}</span>
            <h1 className="eb-h2" style={{ marginTop: "0.5rem" }}>{data.profile.cta.confirmation}</h1>
            <p className="eb-muted">{data.business.name} will confirm with you directly.</p>
            <dl style={{ display: "grid", gap: "0.5rem", marginTop: "1.5rem" }}>
              <div className="eb-totals__row"><dt>What</dt><dd style={{ margin: 0 }}>{booking.serviceName}</dd></div>
              <div className="eb-totals__row"><dt>When</dt><dd style={{ margin: 0 }}>{formatDateTime(booking.startAt)}</dd></div>
              {booking.staffName ? <div className="eb-totals__row"><dt>With</dt><dd style={{ margin: 0 }}>{booking.staffName}</dd></div> : null}
              <div className="eb-totals__row">
                <dt>Status</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>{BOOKING_STATUS_LABELS[booking.status as BookingStatus] || booking.status}</dd>
              </div>
              {booking.depositKES > 0 ? (
                <div className="eb-totals__row">
                  <dt>Deposit</dt>
                  <dd style={{ margin: 0 }}>{formatKES(booking.depositKES)} · {booking.paymentStatus === "PAID" ? "Paid ✓" : "Unpaid"}</dd>
                </div>
              ) : null}
            </dl>
            <p style={{ marginTop: "1.5rem" }}>
              <Link href={`/b/${slug}`} className="eb-btn eb-btn--outline">Back to {data.business.name}</Link>
            </p>
          </div>
        </div>
      </section>
    </StorefrontShell>
  );
}
