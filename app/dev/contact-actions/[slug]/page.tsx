import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BusinessPage from "@/components/BusinessPage";
import { DEMO_BUSINESSES } from "@/lib/demoData";
import { resolveTheme } from "@/lib/themes";
import { resolveDemoContacts } from "@/lib/demoContact";

/**
 * LOCAL EVIDENCE FIXTURE ONLY — no database, no production data, no authentication.
 *
 * Renders the exact public `BusinessPage` component with the four authoritative fictional demo
 * fixtures so a real headless browser can measure the four contact actions at the six mandated
 * viewports in an offline sandbox. This is NOT a production data change and is NOT the live
 * production demo page; it proves the renderer and its destinations, not the production row.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact action fixture", robots: { index: false, follow: false } };

export function generateStaticParams() {
  return DEMO_BUSINESSES.map((demo) => ({ slug: demo.slug }));
}

export default async function ContactActionFixturePage({ params }: { params: Promise<{ slug: string }> }) {
  // Evidence fixtures are local-only: they must not become extra public routes in a release.
  if (process.env.NODE_ENV === "production") notFound();
  const { slug } = await params;
  const demo = DEMO_BUSINESSES.find((entry) => entry.slug === slug);
  if (!demo) notFound();
  const contacts = resolveDemoContacts(
    { slug: demo.slug, name: demo.name, ownerEmail: "demo@jata.link", paymentReferences: [] },
    { phone: "0700000001", whatsapp: "0700000001" },
  );
  return (
    // `jata-light-island` restores the light customer-page palette because this fixture lives
    // under /dev (inside the product theme root) while real /b/ pages are outside it.
    <div className="jata-light-island" data-evidence-fixture-root="true">
      <p role="note" data-evidence-fixture="true" className="bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950">
        Local browser fixture — fictional demo data, not the live production row. Contact actions are the real BusinessPage component.
      </p>
      <BusinessPage
        business={{
          id: `fixture-${demo.slug}`,
          slug: demo.slug,
          name: demo.name,
          category: demo.category,
          phone: contacts.phone,
          whatsapp: contacts.whatsapp,
          location: demo.location,
          lat: null,
          lng: null,
          description: demo.description,
          theme: demo.theme,
          aftercallMsg: demo.aftercallMsg,
          openingHours: JSON.stringify(demo.openingHours),
          socialLinks: null,
        }}
        services={demo.services.map((service, index) => ({
          id: `${demo.slug}-service-${index}`,
          title: service.title,
          description: service.description,
          priceLabel: service.priceLabel,
          priceFrom: service.priceFrom,
        }))}
        offer={{ title: demo.offer.title, subtitle: demo.offer.subtitle }}
        theme={resolveTheme(demo.theme)}
        demoPage
      />
    </div>
  );
}
