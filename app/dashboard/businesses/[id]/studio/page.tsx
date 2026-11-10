import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { loadWorkspace } from "@/lib/experience/workspace";
import { loadStudioPreviewBase } from "@/lib/openpage/previewData";
import { STUDIO_PROMPT_EXAMPLES } from "@/lib/openpage/requirements";
import { getBusinessUrl } from "@/lib/url";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { WebsiteStudio } from "@/components/studio/openpage/WebsiteStudio";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  await loadWorkspace(id);
  return { title: "Website Studio" };
}

/**
 * The prompt-first Website Studio.
 *
 * Server component: resolves the tenant, the latest draft, the publication readiness and
 * one tenant-scoped preview dataset. All generation/refinement previews stay client-side
 * until the owner saves through the existing versioned draft API. All legacy editing routes now redirect here; this is the sole owner editing surface.
 */
export default async function PromptStudioPage({ params }: Props) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const previewBase = await loadStudioPreviewBase(id);
  if (!previewBase) notFound();

  const { business, experience, document, profile, entitlement, validation, hasUnpublishedChanges } = workspace;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/dashboard/studio" className="jata-btn jata-btn-ghost !px-2 !py-1 text-xs">
          <ArrowLeft size={13} /> Workspace home
        </Link>
        <p className="text-xs text-[color:var(--ws-muted)]">{profile.label} · saved draft v{experience?.draftVersion ?? 0}</p>
      </div>

      <StudioTabs businessId={business.id} capabilities={profile.capabilities} />

      <WebsiteStudio
        business={{
          id: business.id,
          name: business.name,
          slug: business.slug,
          category: business.category,
          isPublished: business.isPublished,
        }}
        initialDocument={document}
        initialDraftVersion={experience?.draftVersion ?? 0}
        publishedVersion={experience?.publishedVersion ?? 0}
        hasExperience={Boolean(experience)}
        hasUnpublishedChanges={hasUnpublishedChanges}
        entitlement={entitlement}
        validation={validation}
        previewBase={previewBase}
        publicUrl={getBusinessUrl(business.slug)}
        examples={STUDIO_PROMPT_EXAMPLES}
      />
    </div>
  );
}
