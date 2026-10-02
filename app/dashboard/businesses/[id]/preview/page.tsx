import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { PreviewClient } from "@/components/dashboard/PreviewClient";
import { EntitlementBanner } from "@/components/dashboard/EntitlementBanner";

export const metadata: Metadata = { title: "Preview" };
export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  if (!workspace.experience) redirect(`/dashboard/businesses/${id}`);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Preview</h1>
        <p className="text-sm text-zinc-600">Mobile first — most of your customers will meet you on a phone.</p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <EntitlementBanner businessId={id} entitlement={workspace.entitlement} isPublished={workspace.business.isPublished} />
      <PreviewClient
        businessId={id}
        slug={workspace.business.slug}
        draftVersion={workspace.experience.draftVersion}
        publishedVersion={workspace.experience.publishedVersion}
      />
    </div>
  );
}
