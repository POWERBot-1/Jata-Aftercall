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
  const queueStress = params.queue === "1";
  return <>
    {queueStress ? (
      // Dev-only compact layout so every stress target intersects the viewport at once. Storefront
      // sections are viewport-relative in height, so without this no viewport can show more than a
      // handful of targets and the eight-slot bound is never actually contended.
      <style>{`.motion-queue-stress .eb-scope section,.motion-queue-stress .eb-scope header{min-height:0!important;height:auto!important;padding-top:4px!important;padding-bottom:4px!important;margin:0!important}.motion-queue-stress .eb-scope [data-motion-recipe]{max-height:200px;overflow:hidden}.motion-queue-stress .eb-scope img{max-height:120px!important}`}</style>
    ) : null}
    <div id="outside-motion-scope" data-motion-recipe="slide">Outside the storefront scope — never animated.</div>
    <div className={queueStress ? "motion-queue-stress" : undefined} data-queue-stress={queueStress ? "1" : undefined}>
      <FixtureMount><ExperienceSite data={data} previewNotice="Development verification only — synthetic data, not a live business" trackViews={false} /></FixtureMount>
    </div>
  </>;
}
