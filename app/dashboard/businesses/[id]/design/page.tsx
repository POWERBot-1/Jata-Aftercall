import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { themesForCategory } from "@/lib/experience/themes";
import { designDirections } from "@/lib/studio/designDirections";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { DesignPanel } from "@/components/dashboard/DesignPanel";

export const metadata: Metadata = { title: "Design" };
export const dynamic = "force-dynamic";

/**
 * Design (§8, §26, §30, §44, §52)
 *
 * One place to choose a complete look, set the brand kit and write the search/social wording that
 * Google and WhatsApp show. Everything here is a draft change the owner applies deliberately.
 */
export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const { document } = workspace;
  const directions = designDirections({
    categoryKey: document.categoryKey,
    businessName: document.brand?.businessName || workspace.business.name,
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
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Design</h1>
        <p className="text-sm text-zinc-600">
          Choose a direction, set your brand, and decide how {workspace.business.name} appears when people find or share your website.
        </p>
      </header>
      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />
      <DesignPanel
        businessId={id}
        document={document}
        draftVersion={workspace.experience?.draftVersion ?? null}
        directions={directions}
        themes={themes}
        currentDirectionKey={document.designDirectionKey || null}
      />
    </div>
  );
}
