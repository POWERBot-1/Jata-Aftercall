import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getBusinessMetrics } from "@/lib/analytics";
import { getBusinessUrl } from "@/lib/url";
import DashboardClient from "@/components/DashboardClient";
export const dynamic = "force-dynamic";


export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const businesses = await prisma.business.findMany({
    where: session.role === "ADMIN" ? {} : { ownerId: session.userId },
    include: { services: true, offer: true, subscription: { include: { plan: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Fetch metrics per business (simple sequential; acceptable for MVP)
  const metricsMap: Record<string, Awaited<ReturnType<typeof getBusinessMetrics>>> = {};
  for (const b of businesses) {
    try {
      metricsMap[b.id] = await getBusinessMetrics(b.id);
    } catch {
      metricsMap[b.id] = { views: 0, whatsapp: 0, calls: 0, directions: 0, shares: 0, serviceClicks: 0, total: 0 };
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold">Your business</h1>
      <p className="text-sm text-zinc-600">Identity, live state, view and share, sectioned editing, and real activity counts. Live means published. Payment is not required.</p>
      <DashboardClient
        businesses={businesses.map((b) => ({
          id: b.id,
          slug: b.slug,
          name: b.name,
          category: b.category,
          isPublished: b.isPublished,
          status: b.status,
          theme: b.theme,
          phone: b.phone,
          whatsapp: b.whatsapp,
          location: b.location,
          lat: b.lat,
          lng: b.lng,
          description: b.description,
          aftercallMsg: b.aftercallMsg,
          publicUrl: getBusinessUrl(b.slug),
          subscription: b.subscription ? { status: b.subscription.status, expiresAt: b.subscription.expiresAt?.toISOString() || null, planName: b.subscription.plan.name } : null,
          servicesCount: b.services.length,
          hasOffer: !!b.offer,
        }))}
        metricsMap={metricsMap}
      />
    </div>
  );
}