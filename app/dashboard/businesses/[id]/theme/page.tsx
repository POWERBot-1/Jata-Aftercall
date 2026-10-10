import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { themesForCategory } from "@/lib/experience/themes";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { ThemeEditor } from "@/components/dashboard/ThemeEditor";

export const metadata: Metadata = { title: "Theme & brand" };
export const dynamic = "force-dynamic";

export default async function ThemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  if (!workspace.experience) redirect(`/dashboard/businesses/${id}`);

  const themes = themesForCategory(workspace.document.categoryKey).map((theme) => ({
    key: theme.key,
    name: theme.name,
    description: theme.description,
    swatches: [theme.palette.bg, theme.palette.surface, theme.palette.primary, theme.palette.accent, theme.palette.text],
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Theme & brand</h1>
        <p className="text-sm text-zinc-600">
          Shared design tokens, not templates: your colours apply across every section of {workspace.profile.label.toLowerCase()}.
        </p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <ThemeEditor
        businessId={id}
        document={workspace.document}
        draftVersion={workspace.experience?.draftVersion ?? null}
        themes={themes}
        showCommerce={workspace.profile.capabilities.includes("commerce")}
        showBooking={workspace.profile.capabilities.includes("booking")}
      />
    </div>
  );
}
