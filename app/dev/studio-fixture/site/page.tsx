import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";
import { FIXTURE_NOTICE, fixtureStorefrontData } from "@/lib/studio/fixtures/studioFixture";

/**
 * Fictional storefront preview for the Studio fixture — DEVELOPMENT ONLY. Renders the real public
 * `ExperienceSite` renderer with fictional data. `notFound()` in production. No customer website is read or changed.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fictional storefront preview", robots: { index: false, follow: false } };

export default async function StudioFixtureSitePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <p role="note" className="fixed inset-x-0 top-0 z-50 bg-black/80 px-3 py-1 text-center text-xs font-semibold text-white">
        {FIXTURE_NOTICE}
      </p>
      <ExperienceSite data={fixtureStorefrontData({ isPreview: true })} previewNotice="FICTIONAL FIXTURE preview" />
    </>
  );
}
