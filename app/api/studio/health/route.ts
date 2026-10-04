/**
 * Website health check (§24, §25, §36, §46)
 *
 * Read-only intelligence about one business's website: what is complete, what is missing, why
 * it matters and what JATA would change to fix it. Ownership is checked by `loadWorkspace`
 * before any other query runs, and every count is scoped to that business.
 */

import { NextResponse } from "next/server";
import { loadWorkspace } from "@/lib/experience/workspace";
import { loadStudioIntelligence } from "@/lib/studio/studioData";
import { healthSummaryLine } from "@/lib/studio/health";
import { providerStatus } from "@/lib/ai/registry";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  const workspace = await loadWorkspace(businessId);
  if (!workspace) return NextResponse.json({ error: "We couldn't find that website." }, { status: 404 });

  try {
    const intelligence = await loadStudioIntelligence({
      businessId,
      document: workspace.document,
      business: workspace.business,
      published: workspace.business.isPublished,
    });
    const provider = providerStatus();
    return NextResponse.json({
      report: intelligence.health,
      summary: healthSummaryLine(intelligence.health),
      counts: intelligence.counts,
      topSellingIds: intelligence.topSellingIds,
      publishing: {
        entitled: workspace.entitlement.entitled,
        ready: workspace.validation.ready,
        hasUnpublishedChanges: workspace.hasUnpublishedChanges,
        failedChecks: workspace.validation.checks.filter((check) => check.status === "fail").map((check) => check.label),
      },
      ai: {
        providerLabel: provider.image.label,
        photographic: provider.image.photorealistic,
        note: provider.note,
      },
    });
  } catch {
    return NextResponse.json({ error: "We couldn't check your website right now. Please try again." }, { status: 500 });
  }
}
