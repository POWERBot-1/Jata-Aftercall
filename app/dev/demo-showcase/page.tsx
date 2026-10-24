/**
 * Development-only harness for the four demo-business experiences.
 *
 * It mounts the REAL public components — `DemoShowcaseBand` above the existing `BusinessPage` —
 * against the documented demo content in `lib/demoData.ts`, so the demo pages can be reviewed,
 * screenshotted and measured without a database. It is not a second demo page: it renders the same
 * components the public route renders, and production always answers 404 (like the other /dev
 * harnesses). No database is read, no customer data exists here, and nothing is writable.
 */
import { notFound } from "next/navigation";
import BusinessPage from "@/components/BusinessPage";
import { DemoShowcaseBand } from "@/components/storefront/DemoShowcaseBand";
import { resolveTheme } from "@/lib/themes";
import { DEMO_BUSINESSES } from "@/lib/demoData";
import { buildDemoShowcase } from "@/lib/demoShowcase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo showcase harness", robots: { index: false, follow: false } };

export default async function DemoShowcaseHarness({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { slug } = await searchParams;
  const demo = DEMO_BUSINESSES.find((entry) => entry.slug === (slug ?? DEMO_BUSINESSES[0].slug));
  if (!demo) notFound();

  const businesses = DEMO_BUSINESSES;
  const services = demo.services.map((service, index) => ({
    id: `${demo.slug}-${index}`,
    title: service.title,
    description: service.description,
    priceLabel: service.priceLabel,
    priceFrom: service.priceFrom,
    category: service.category,
  }));

  const showcase = buildDemoShowcase({
    slug: demo.slug,
    decision: "public",
    business: { name: demo.name, category: demo.category, location: demo.location },
    services,
    offerTitle: demo.offer.title,
  });

  return (
    <div className="jata-public">
      <p
        role="status"
        style={{ background: "#111827", color: "#fff", padding: "0.55rem 1rem", textAlign: "center", fontSize: "0.8rem", fontWeight: 600 }}
      >
        Development verification only — synthetic demo content, no database, not a live business.
      </p>
      {showcase ? <DemoShowcaseBand {...showcase} /> : null}
      <BusinessPage
        business={{
          id: `dev-${demo.slug}`,
          slug: demo.slug,
          name: demo.name,
          category: demo.category,
          phone: demo.phone,
          whatsapp: demo.whatsapp,
          location: demo.location,
          lat: null,
          lng: null,
          description: demo.description,
          theme: demo.theme,
          aftercallMsg: demo.aftercallMsg,
          openingHours: JSON.stringify(demo.openingHours),
          socialLinks: null,
        }}
        services={services}
        offer={{ title: demo.offer.title, subtitle: demo.offer.subtitle }}
        theme={resolveTheme(demo.theme)}
        referralHref={null}
        aiFrontDeskLive={false}
      />
      <nav aria-label="Other demo businesses" style={{ padding: "1rem", textAlign: "center", fontSize: "0.8rem" }}>
        {businesses.map((entry) => (
          <a key={entry.slug} href={`/dev/demo-showcase?slug=${entry.slug}`} style={{ margin: "0 0.5rem", textDecoration: "underline" }}>
            {entry.name}
          </a>
        ))}
      </nav>
    </div>
  );
}
