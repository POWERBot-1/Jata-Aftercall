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
import { focalToObjectPosition, imageForExperienceCategory } from "@/lib/categoryImagery";
import { ExternalLink, Eye, Globe, Image as ImageIcon, UploadCloud, Wand2 } from "lucide-react";

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

/**
 * The visual heart of the Studio home: the actual opening image customers will meet,
 * large, with the three actions an owner most often wants. It renders the owner's saved
 * draft hero when one exists and the suggested category image otherwise — saying which.
 */
function StudioVisualPreview({
  businessId, categoryKey, heroImageUrl, heroFocalX, heroFocalY, businessName,
}: {
  businessId: string;
  categoryKey: string;
  heroImageUrl: string | null;
  heroFocalX?: number;
  heroFocalY?: number;
  businessName: string;
}) {
  const suggested = imageForExperienceCategory(categoryKey);
  const usingOwn = Boolean(heroImageUrl);
  const focal = usingOwn
    ? focalToObjectPosition({ x: heroFocalX ?? 50, y: heroFocalY ?? 45 })
    : focalToObjectPosition(suggested.focal);
  return (
    <section className="jata-card" aria-label="Your website at a glance">
      <div className="relative overflow-hidden rounded-2xl border bg-zinc-100">
        <div className="relative aspect-[16/9] sm:aspect-[21/9]">
          {usingOwn ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroImageUrl as string} alt={`Opening image for ${businessName}`} className="h-full w-full object-cover" style={{ objectPosition: focal }} />
          ) : (
            <picture>
              {suggested.webp ? <source srcSet={suggested.webpSrcSet} type="image/webp" sizes="100vw" /> : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={suggested.src} srcSet={suggested.srcSet} sizes="100vw" alt={suggested.alt} width={suggested.width} height={suggested.height}
                className="h-full w-full object-cover" style={{ objectPosition: focal }} loading="lazy" decoding="async" />
            </picture>
          )}
          <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold text-white">
            {usingOwn ? "Your opening image (draft)" : `Suggested image · ${suggested.label}`}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/dashboard/businesses/${businessId}/create`} className="jata-btn jata-btn-primary">
          <Wand2 size={15} aria-hidden="true" /> Create something visual
        </Link>
        <Link href={`/dashboard/businesses/${businessId}/photos`} className="jata-btn jata-btn-secondary">
          <ImageIcon size={15} aria-hidden="true" /> Change image
        </Link>
        <Link href={`/dashboard/businesses/${businessId}/preview`} className="jata-btn jata-btn-ghost">
          <Eye size={15} aria-hidden="true" /> Preview phone &amp; desktop
        </Link>
      </div>
      <p className="jata-hint mt-2">Draft image — customers see it only after you publish below.</p>
    </section>
  );
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

      {experience ? <StudioVisualPreview businessId={business.id} categoryKey={profile.key} heroImageUrl={document.brand.heroImageUrl || null} heroFocalX={document.brand.heroFocalX} heroFocalY={document.brand.heroFocalY} businessName={business.name} /> : null}

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
