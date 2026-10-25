import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { getBusinessUrl } from "@/lib/url";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { PublishPanel } from "@/components/dashboard/PublishPanel";
import { EntitlementBanner } from "@/components/dashboard/EntitlementBanner";
import { CreateExperienceForm } from "@/components/dashboard/CreateExperienceForm";
import { WebsiteHealth } from "@/components/dashboard/WebsiteHealth";
import { EnquiryBoard } from "@/components/dashboard/EnquiryBoard";
import { usesServiceEnquiries } from "@/lib/experience/enquiries";
import { WorkspaceHero } from "@/components/workspace/WorkspaceUI";
import { StatusPill } from "@/components/ui/StatusPill";
import { photoForCategory, categoryLabel } from "@/lib/workspaceImagery";
import { ExternalLink, Eye, Globe, UploadCloud } from "lucide-react";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// M11 #418: metadata shares the page's single per-request workspace load so the SSR root
// segment completes with the head — the hydration bootstrap scripts are emitted after the
// content (see lib/request-cache.ts).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  await loadWorkspace(id);
  return { title: "Website studio" };
}

export default async function StudioHomePage({ params }: Props) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const { business, experience, document, profile, entitlement, validation, counts, hasUnpublishedChanges } = workspace;
  const publicUrl = getBusinessUrl(business.slug);

  return (
    <div className="space-y-6">
      <WorkspaceHero
        compact
        kicker="Website studio"
        title={business.name}
        subtitle={`${categoryLabel(business.category)} · ${profile.label}. Edit the site your customers see, then publish when you are ready — nothing reaches them before that.`}
        photo={photoForCategory(business.category)}
        actions={
          <>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="ws-btn-amber">
              <ExternalLink size={16} aria-hidden="true" /> {business.isPublished ? "View live site" : "Preview site"}
            </a>
            <Link href={`/dashboard/businesses/${business.id}/preview`} className="ws-btn-outline">
              <Eye size={16} aria-hidden="true" /> Phone &amp; desktop preview
            </Link>
            <Link href={`/dashboard/businesses/${business.id}#publish`} className="ws-btn-quiet">
              <UploadCloud size={16} aria-hidden="true" /> Publish
            </Link>
          </>
        }
        meta={`${hasUnpublishedChanges ? "Unpublished changes are saved" : "No unpublished changes"} · draft version ${experience?.draftVersion ?? 0} · published version ${experience?.publishedVersion ?? 0}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={business.isPublished ? "success" : "neutral"} icon={<Globe size={11} />}>
          {business.isPublished ? "Live" : "Draft"}
        </StatusPill>
        <StatusPill tone={entitlement.entitled ? "success" : "warning"}>
          Package: {entitlement.entitled ? "Active" : "Not active"}
        </StatusPill>
        {hasUnpublishedChanges ? <StatusPill tone="warning">Unpublished changes</StatusPill> : null}
      </div>

      <StudioTabs businessId={business.id} capabilities={profile.capabilities} />

      <EntitlementBanner businessId={business.id} entitlement={entitlement} isPublished={business.isPublished} />

      {!experience ? (
        <CreateExperienceForm businessId={business.id} currentCategory={business.category} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div id="publish">
          <PublishPanel
            businessId={business.id}
            ready={validation.ready}
            checks={validation.checks}
            published={experience.status === "PUBLISHED" && business.isPublished}
            draftVersion={experience.draftVersion}
            publishedVersion={experience.publishedVersion}
            hasUnpublishedChanges={hasUnpublishedChanges}
            entitled={entitlement.entitled}
            publicUrl={publicUrl}
          />
          </div>

          <section className="jata-card">
            <h2 className="text-sm font-bold">Your website at a glance</h2>
            <dl className="jata-stat-grid mt-3">
              <div className="jata-stat">
                <dt>{profile.itemNounPlural}</dt>
                <dd>{counts.products}</dd>
              </div>
              <div className="jata-stat">
                <dt>Services</dt>
                <dd>{counts.services}</dd>
              </div>
              <div className="jata-stat">
                <dt>Images</dt>
                <dd>{counts.media}</dd>
              </div>
              <div className="jata-stat">
                <dt>Draft version</dt>
                <dd>{experience.draftVersion}</dd>
              </div>
            </dl>
            <div className="jata-quick-actions mt-4">
              <Link className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${business.id}/sections`}>Edit sections</Link>
              <Link className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${business.id}/items`}>Manage {profile.catalogueLabel.toLowerCase()}</Link>
              <Link className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${business.id}/photos`}>Photos</Link>
              <Link className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${business.id}/design`}>Design</Link>
              <Link className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${business.id}/theme`}>Brand & settings</Link>
              <Link className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${business.id}/preview`}>Preview</Link>
            </div>
          </section>
        </div>
      )}

      {experience ? <WebsiteHealth businessId={business.id} /> : null}
      {experience && usesServiceEnquiries(document.categoryKey) ? <EnquiryBoard businessId={business.id} /> : null}

      {experience ? (
        <section className="jata-card">
          <h2 className="text-sm font-bold">What customers can do on your site</h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {profile.capabilities.map((capability) => (
              <li key={capability} className="rounded-full border bg-white px-3 py-1 font-semibold capitalize">
                {capability.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
          <p className="jata-hint">
            Sections on this page: {document.sections.filter((section) => section.visible !== false).length} visible of{" "}
            {document.sections.length}.
          </p>
        </section>
      ) : null}
    </div>
  );
}
