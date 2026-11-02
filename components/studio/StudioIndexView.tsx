/**
 * Website Studio index — presentation only.
 *
 * Extracted from app/dashboard/studio/page.tsx so the real list (hero, business doors, status pills,
 * publishing steps) can be rendered by the development-only Studio fixture without any database access.
 * The server page still loads businesses, experiences and entitlements and passes them in unchanged.
 * Renders identical markup to the previous inline JSX.
 */

import Link from "next/link";
import { getBusinessUrl } from "@/lib/url";
import { entitlementStatusLabel, experienceStatusLabel } from "@/lib/statusLabels";
import { StatusPill } from "@/components/ui/StatusPill";
import { WorkspaceEmpty, WorkspaceHero, WorkspacePanel } from "@/components/workspace/WorkspaceUI";
import { WorkspaceDoor } from "@/components/workspace/WorkspaceDoor";
import { WORKSPACE_HERO_PHOTO, WORKSPACE_PHOTOS, categoryLabel, photoForCategory } from "@/lib/workspaceImagery";
import { ArrowRight, ExternalLink, Globe, Image as ImageIcon, Palette, ShoppingBag, Wand2 } from "lucide-react";

export type StudioIndexBusiness = {
  id: string;
  name: string;
  slug: string;
  category: string;
  location: string | null;
  coverUrl: string | null;
  isPublished: boolean;
};

export type StudioIndexExperience = {
  businessId: string;
  status: string;
  draftVersion: number;
  publishedVersion: number;
  draftJson: string | null;
  publishedJson: string | null;
};

export function StudioIndexView({
  businesses,
  experienceByBusiness,
  entitlementByBusiness,
  liveCount,
}: {
  businesses: StudioIndexBusiness[];
  experienceByBusiness: Map<string, StudioIndexExperience>;
  entitlementByBusiness: Map<string, string>;
  liveCount: number;
}) {
  return (
    <div className="ws-stack">
      <WorkspaceHero
        compact
        kicker="Website studio"
        title={
          <>
            Build the site your <em>customers</em> actually use.
          </>
        }
        subtitle="Sections, catalogue, theme, photos and preview — all in one editor. Your public page keeps working while you edit; customers only see a change once you publish it."
        photo={WORKSPACE_HERO_PHOTO}
        actions={
          <>
            <Link href="/dashboard/subscription" className="ws-btn-amber">
              <Wand2 size={16} aria-hidden="true" /> Check your plan
            </Link>
            <Link href="/dashboard" className="ws-btn-outline">
              Back to overview
            </Link>
          </>
        }
        meta={`${businesses.length} ${businesses.length === 1 ? "business" : "businesses"} · ${liveCount} live ${
          businesses.length === 1 ? "site" : "sites"
        } · drafts never reach customers`}
      />

      {businesses.length === 0 ? (
        <WorkspaceEmpty
          title="No business yet"
          text="Create your business first, then build its interactive website: sections, catalogue, theme and preview."
          photo={WORKSPACE_PHOTOS.professional}
          actions={
            <Link href="/onboarding" className="jata-btn jata-btn-primary">
              Create business
            </Link>
          }
        />
      ) : (
        <>
          <ul className="ws-stack">
            {businesses.map((business) => {
              const experience = experienceByBusiness.get(business.id) || null;
              const entitlement = entitlementStatusLabel(entitlementByBusiness.get(business.id) || "NONE");
              const state = experienceStatusLabel(experience?.status || "DRAFT");
              const hasUnpublishedChanges = Boolean(experience?.draftJson) && experience?.draftJson !== experience?.publishedJson;
              return (
                <WorkspaceDoor
                  key={business.id}
                  coverUrl={business.coverUrl}
                  photo={photoForCategory(business.category)}
                  title={business.name}
                  meta={`${categoryLabel(business.category)}${business.location ? ` · ${business.location}` : ""} · ${getBusinessUrl(business.slug)}`}
                  pills={
                    <>
                      <StatusPill tone={business.isPublished ? "success" : "neutral"} icon={<Globe size={11} />}>
                        {business.isPublished ? "Live" : "Draft"}
                      </StatusPill>
                      {/* The business pill already says Live/Draft. Render the site-state pill only
                          when it adds information — a hidden site, or a site state that disagrees
                          with the business record — never as a second identical "Live". */}
                      {state.label !== (business.isPublished ? "Live" : "Draft") ? (
                        <StatusPill tone={state.tone}>{state.label}</StatusPill>
                      ) : null}
                      <StatusPill tone={entitlement.tone}>Package: {entitlement.label}</StatusPill>
                      {hasUnpublishedChanges ? <StatusPill tone="warning">Unpublished changes</StatusPill> : null}
                      {experience ? <StatusPill tone="neutral">Version {experience.publishedVersion}</StatusPill> : null}
                    </>
                  }
                  note={
                    <p className="ws-muted ws-tiny">
                      {hasUnpublishedChanges
                        ? "You have saved changes customers cannot see yet. Open the preview, check them, then publish."
                        : business.isPublished
                          ? "Your site is live. Editing here never changes what customers see until you publish."
                          : "This site is still a draft. Publish it to give customers the full experience."}
                    </p>
                  }
                  actions={
                    <>
                      <Link className="jata-btn jata-btn-primary" href={`/dashboard/businesses/${business.id}`}>
                        Open studio <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                      <Link className="jata-btn jata-btn-secondary" href={getBusinessUrl(business.slug)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={15} aria-hidden="true" /> {business.isPublished ? "View site" : "Preview"}
                      </Link>
                      <Link className="jata-btn jata-btn-ghost" href={`/dashboard/businesses/${business.id}/theme`}>
                        <Palette size={15} aria-hidden="true" /> Theme
                      </Link>
                      <Link className="jata-btn jata-btn-ghost" href={`/dashboard/businesses/${business.id}/photos`}>
                        <ImageIcon size={15} aria-hidden="true" /> Photos
                      </Link>
                      <Link className="jata-btn jata-btn-ghost" href={`/dashboard/businesses/${business.id}/items`}>
                        <ShoppingBag size={15} aria-hidden="true" /> What you sell
                      </Link>
                    </>
                  }
                />
              );
            })}
          </ul>

          <WorkspacePanel title="How publishing works" meta="Draft → preview → live">
            <ol className="grid gap-2 sm:grid-cols-3">
              <Step n={1} title="Edit" text="Change sections, theme, catalogue and photos. Everything is saved to your draft." />
              <Step n={2} title="Preview" text="See the real page at phone or desktop width before anyone else does." />
              <Step n={3} title="Publish" text="Publishing replaces the live version. Until then, customers keep the current site." />
            </ol>
          </WorkspacePanel>
        </>
      )}
    </div>
  );
}

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <li className="rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] px-3 py-2.5">
      <p className="flex items-center gap-2 text-[0.82rem] font-bold">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[color:var(--ws-ink)] text-[0.7rem] text-[color:var(--ws-on-ink)]">{n}</span>
        {title}
      </p>
      <p className="ws-muted ws-tiny mt-1">{text}</p>
    </li>
  );
}
