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

export const metadata: Metadata = { title: "Website studio" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function StudioHomePage({ params }: Props) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const { business, experience, document, profile, entitlement, validation, counts, hasUnpublishedChanges } = workspace;
  const publicUrl = getBusinessUrl(business.slug);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">{business.name}</h1>
        <p className="text-sm text-zinc-600">
          {profile.label} ·{" "}
          <a className="underline" href={publicUrl} target="_blank" rel="noopener noreferrer">
            {publicUrl}
          </a>
        </p>
      </header>

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
