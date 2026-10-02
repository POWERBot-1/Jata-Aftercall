import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { loadStorefront } from "@/lib/experience/storefront";
import { StorefrontShell } from "@/components/storefront/StorefrontShell";
import { verifyOrderPayment } from "@/lib/experience/payments";
import { formatKES } from "@/lib/format";
import { orderStatusToStage } from "@/lib/experience/orders";
import { OrderStatusPanel } from "@/components/storefront/OrderStatusPanel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; reference: string }>; searchParams: Promise<{ verify?: string }> };

export const metadata: Metadata = { title: "Order", robots: { index: false, follow: false } };

export default async function OrderConfirmationPage({ params, searchParams }: Props) {
  const { slug, reference } = await params;
  const { verify } = await searchParams;

  const data = await loadStorefront(slug);
  if (!data) notFound();

  // Orders are read through the tenant: a reference from another business is not found (§37).
  const order = await prisma.order.findFirst({
    where: { orderReference: reference, businessId: data.business.id },
    include: { items: true },
  });
  if (!order) notFound();

  // Confirming a payment is explicit: verify with Paystack, then settle (§27).
  let state: "SUCCESS" | "PENDING" | "FAILED" = order.paymentStatus === "PAID" ? "SUCCESS" : "PENDING";
  if (verify === "1" && order.paymentStatus !== "PAID") {
    const result = await verifyOrderPayment(reference);
    state = result.state === "SUCCESS" ? "SUCCESS" : result.state === "NOT_STARTED" ? "PENDING" : "PENDING";
  }
  const refreshed = await prisma.order.findUnique({
    where: { id: order.id },
    select: { paymentStatus: true, status: true },
  });
  const paid = (refreshed?.paymentStatus || order.paymentStatus) === "PAID";

  return (
    <StorefrontShell data={data}>
      <section className="eb-section">
        <div className="eb-container" style={{ maxWidth: "44rem" }}>
          <OrderStatusPanel
            slug={slug}
            reference={order.orderReference}
            paid={paid || state === "SUCCESS"}
            status={order.status}
            stage={orderStatusToStage((refreshed?.status || order.status) as string)}
            totalKES={order.totalKES}
            fulfilment={order.fulfilmentType}
            confirmationLabel={data.profile.cta.confirmation}
            items={order.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              unitPriceKES: item.unitPriceKES,
              variantDesc: item.variantDesc,
            }))}
            subtotalKES={order.subtotalKES}
            deliveryFeeKES={order.deliveryFeeKES}
            whatsapp={data.document.settings.whatsapp || null}
            phone={data.document.settings.phone || null}
            businessName={data.business.name}
          />
          <p style={{ marginTop: "1.5rem" }}>
            <Link href={`/b/${slug}`} className="eb-btn eb-btn--outline">
              Back to {data.business.name}
            </Link>
          </p>
          <p className="eb-muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            Order total {formatKES(order.totalKES)} · Reference {order.orderReference}
          </p>
        </div>
      </section>
    </StorefrontShell>
  );
}
