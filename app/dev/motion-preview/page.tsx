/** Development-only harness of the ACTUAL storefront renderer; production always returns 404. */
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";
import { isRenderPreference } from "@/lib/experience/renderMode";
import { isTemplateFamily } from "@/lib/experience/templateFamilies";
import { motionFixture, familyFixture, queueStressFixture } from "./fixture";
import { FixtureMount } from "./FixtureMount";

export const dynamic = "force-dynamic";
export const metadata = { title: "Motion verification fixture", robots: { index: false, follow: false } };

export default async function MotionPreviewHarness({ searchParams }: { searchParams: Promise<{ preference?: string; theme?: string; family?: string; queue?: string }> }) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "";
  const isolatedMotionCapture = process.env.CI === "true" && process.env.MOTION_ISOLATED === "1" && ["localhost:4100", "127.0.0.1:4100"].includes(host);
  if (process.env.NODE_ENV === "production" && !isolatedMotionCapture) notFound();
  const params = await searchParams;
  const preference = isRenderPreference(params.preference) ? params.preference : "motion";
  if (params.family !== undefined && !isTemplateFamily(params.family)) notFound();
  const data = params.queue === "1" ? queueStressFixture(preference) : isTemplateFamily(params.family) ? familyFixture(params.family, preference) : motionFixture(preference, params.theme === "none");
  return <>
    <div id="outside-motion-scope" data-motion-recipe="slide">Outside the storefront scope — never animated.</div>
    <FixtureMount><ExperienceSite data={data} previewNotice="Development verification only — synthetic data, not a live business" /></FixtureMount>
  </>;
}
