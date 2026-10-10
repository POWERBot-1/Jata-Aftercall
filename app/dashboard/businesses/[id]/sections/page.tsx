import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { SectionEditor } from "@/components/dashboard/SectionEditor";

export const metadata: Metadata = { title: "Sections" };
export const dynamic = "force-dynamic";

export default async function SectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  if (!workspace.experience) redirect(`/dashboard/businesses/${id}`);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Sections</h1>
        <p className="text-sm text-zinc-600">
          Reorder, hide, duplicate or edit what customers see on {workspace.business.name}. Nothing changes on the live
          site until you publish.
        </p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <SectionEditor businessId={id} document={workspace.document} draftVersion={workspace.experience?.draftVersion ?? null} />
    </div>
  );
}
