/** Development-only harness of the ACTUAL storefront renderer; production always returns 404. */
import { notFound } from "next/navigation";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";
import { isRenderPreference } from "@/lib/experience/renderMode";
import { isTemplateFamily } from "@/lib/experience/templateFamilies";
import { motionFixture, familyFixture } from "./fixture";
import { FixtureMount } from "./FixtureMount";

export const dynamic = "force-dynamic";
export const metadata = { title: "Motion verification fixture", robots: { index: false, follow: false } };

export default async function MotionPreviewHarness({ searchParams }: { searchParams: Promise<{ preference?: string; theme?: string; family?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const preference = isRenderPreference(params.preference) ? params.preference : "motion";
  if (params.family !== undefined && !isTemplateFamily(params.family)) notFound();
  const data = isTemplateFamily(params.family) ? familyFixture(params.family, preference) : motionFixture(preference, params.theme === "none");
  return <>
    <div id="outside-motion-scope" data-motion-recipe="slide">Outside the storefront scope — never animated.</div>
    <FixtureMount><ExperienceSite data={data} previewNotice="Development verification only — synthetic data, not a live business" /></FixtureMount>
  </>;
}
