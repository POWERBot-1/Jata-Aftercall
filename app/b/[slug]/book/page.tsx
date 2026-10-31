import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { loadStorefront } from "@/lib/experience/storefront";
import { requestCache } from "@/lib/request-cache";
import { StorefrontShell } from "@/components/storefront/StorefrontShell";
import { BookingClient } from "@/components/storefront/BookingClient";
import { bookingCalendar } from "@/lib/experience/bookingCalendar";
import { isBookableConsultation, professionalEnquiryHref } from "@/lib/experience/professionalWorkflow";
import { usesServiceEnquiries } from "@/lib/experience/enquiries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ service?: string; item?: string }> };

// M11 #418: shared per-request with `generateMetadata` and the body (lib/request-cache.ts).
const canPreview = requestCache(async (slug: string): Promise<boolean> => {
  const session = await getSession();
  if (!session) return false;
  if (session.role === "ADMIN") return true;
  const business = await prisma.business.findUnique({ where: { slug }, select: { ownerId: true, members: { select: { userId: true } } } });
  if (!business) return false;
  return business.ownerId === session.userId || business.members.some((member) => member.userId === session.userId);
});

// M11 #418: metadata shares the page's single storefront load so the SSR root segment
// completes with the head — the hydration bootstrap scripts are emitted after the content.
export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { slug } = await params;
  await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  return { title: "Book", robots: { index: false, follow: false } };
}

export default async function BookPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { service, item } = await searchParams;
  const data = await loadStorefront(slug, { allowDraft: await canPreview(slug) });
  if (!data) notFound();

  const professional = usesServiceEnquiries(data.document.categoryKey);
  if (professional && item) notFound(); // this category's requests are tied to real Service rows, never dummy Products
  if (professional && service) {
    const selected = data.services.find((entry) => entry.id === service);
    if (!selected) notFound();
    if (!isBookableConsultation(selected)) redirect(professionalEnquiryHref(data.business.slug, selected.id));
  }
  const bookables = professional ? data.services.filter(isBookableConsultation) : data.services.length > 0 ? data.services : data.items;
  if (professional && bookables.length === 0) redirect(professionalEnquiryHref(data.business.slug));
  const bookingEnabled = data.profile.capabilities.includes("booking");
  const enquiryItem = item ? data.items.find((entry) => entry.id === item) : null;

  return (
    <StorefrontShell data={data} previewNotice={data.isPreview ? "Draft preview — only you can see these unpublished changes." : null}>
      <section className="eb-section" data-motion-recipe="fade">
        <div className="eb-container">
          <header style={{ marginBottom: "1.75rem" }}>
            <h1 className="eb-h2">{bookingEnabled ? "Book" : data.profile.cta.enquire}</h1>
            <p className="eb-lede">
              {bookingEnabled
                ? `Choose a ${data.profile.itemNoun.toLowerCase()}, pick a time, and we will confirm with you.`
                : "Tell us what you need and we will come back to you with a quote."}
            </p>
          </header>
          <BookingClient
            slug={slug}
            businessId={data.business.id}
            calendar={bookingCalendar(new Date())}
            bookables={bookables.map((entry) => ({
              id: entry.id,
              name: entry.name,
              kind: entry.kind,
              durationMinutes: entry.durationMinutes,
              depositKES: entry.depositKES,
              price: entry.price,
              pricingType: entry.pricingType,
              imageUrl: entry.imageUrl,
              description: entry.description,
            }))}
            preselectedId={service}
            enquiryItemId={enquiryItem?.id}
            enquiryItemName={enquiryItem?.name}
            ctaLabel={bookingEnabled ? "Book now" : data.profile.cta.enquire}
            confirmationLabel={data.profile.cta.confirmation}
            requireDate
          />
        </div>
      </section>
    </StorefrontShell>
  );
}
