import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { CreativeStudio } from "@/components/dashboard/CreativeStudio";
import { EntitlementBanner } from "@/components/dashboard/EntitlementBanner";

export const metadata: Metadata = { title: "Create" };
export const dynamic = "force-dynamic";

/**
 * Create (Website Studio creative engine).
 *
 * One command-led workspace for making and improving visual assets. Everything it can do
 * is derived from the connected providers and storage at request time (see
 * `lib/creative/capabilities`); the page itself never advertises a capability the server
 * has not confirmed. Entitlement state stays visible exactly as on the Studio home —
 * Create adds no way around the package rules, which the server enforces per request.
 */
export default async function CreatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Create</h1>
        <p className="text-sm text-zinc-600">
          Describe what you want for {workspace.business.name} — a poster, a better photo, a fresh opening image — in your own words.
        </p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <EntitlementBanner businessId={id} entitlement={workspace.entitlement} isPublished={workspace.business.isPublished} />
      <CreativeStudio businessId={id} />
    </div>
  );
}
