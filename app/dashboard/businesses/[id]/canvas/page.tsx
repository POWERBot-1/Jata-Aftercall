import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { themesForCategory } from "@/lib/experience/themes";
import { designDirections } from "@/lib/studio/designDirections";
import { getBusinessUrl } from "@/lib/url";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { StudioCanvas } from "@/components/studio/canvas/StudioCanvas";

export const dynamic = "force-dynamic";

/**
 * Studio Canvas (§4, §14, §63)
 *
 * The editing workspace: outline, live draft preview and inspector on one screen. This page is a
 * thin server shell — ownership, entitlement and the draft all come from the existing
 * `loadWorkspace`, and every write still goes through `/api/experience`.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  await loadWorkspace(id);
  return { title: "Canvas" };
}

export default async function CanvasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const { business, document, profile, experience } = workspace;

  if (!experience) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="jata-kicker">Website studio</p>
          <h1 className="text-xl font-bold">Canvas</h1>
        </header>
        <StudioTabs businessId={business.id} capabilities={profile.capabilities} />
        <div className="jata-empty">
          <p className="text-sm font-semibold">This website has not been created yet</p>
          <p className="mt-1 text-sm text-zinc-600">Build it once from the overview, then edit it here while looking at it.</p>
          <Link className="jata-btn jata-btn-primary mt-4" href={`/dashboard/businesses/${business.id}`}>Open the overview</Link>
        </div>
      </div>
    );
  }

  const directions = designDirections({
    categoryKey: document.categoryKey,
    businessName: document.brand?.businessName || business.name,
    brand: document.brand,
    themeKey: document.themeKey,
  });

  const themes = themesForCategory(document.categoryKey).map((theme) => ({
    key: theme.key,
    name: theme.name,
    description: theme.description,
    swatches: [theme.palette.bg, theme.palette.surface, theme.palette.primary, theme.palette.accent, theme.palette.text],
  }));

  return (
    <div className="space-y-4">
      <StudioTabs businessId={business.id} capabilities={profile.capabilities} />
      <StudioCanvas
        businessId={business.id}
        slug={business.slug}
        businessName={business.name}
        categoryLabel={profile.label}
        document={document}
        draftVersion={experience.draftVersion}
        publishedVersion={experience.publishedVersion}
        hasUnpublishedChanges={workspace.hasUnpublishedChanges}
        directions={directions}
        themes={themes}
        currentDirectionKey={document.designDirectionKey || null}
        currentThemeKey={document.themeKey}
        initialPanel={tab === "design" ? "design" : "section"}
        publicUrl={getBusinessUrl(business.slug)}
      />
    </div>
  );
}
