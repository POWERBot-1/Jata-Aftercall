/**
 * `<img>` is used deliberately where the image URL is owner-supplied (a business cover or
 * logo) or comes from a fixed local registry with explicit width/height. next/image would
 * require the optimizer to fetch arbitrary remote URLs and would not respect the aspect-ratio
 * container these images fill, so the raw element with `loading="lazy"` is the safer choice.
 */
/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getBusinessUrl } from "@/lib/url";
import { entitlementStatusLabel, experienceStatusLabel } from "@/lib/statusLabels";
import { StatusPill } from "@/components/ui/StatusPill";
import { WorkspaceEmpty, WorkspaceHero, WorkspacePanel } from "@/components/workspace/WorkspaceUI";
import { WorkspaceDoor } from "@/components/workspace/WorkspaceDoor";
import { WORKSPACE_HERO_PHOTO, WORKSPACE_PHOTOS, categoryLabel, photoForCategory } from "@/lib/workspaceImagery";
import { ArrowRight, ExternalLink, Globe, Image as ImageIcon, Palette, ShoppingBag, Wand2 } from "lucide-react";

export const metadata: Metadata = { title: "Website studio" };
export const dynamic = "force-dynamic";

/**
 * Studio index (§15)
 *
 * The door into each business's interactive website. It shows, at a glance, whether the
 * package is paid for, whether the site is live and what still needs the owner's attention —
 * and each entry is a real link into the existing studio editor, not a mock preview.
 */
export default async function StudioIndexPage() {
  const session = await getSession();
  if (!session) return null;

  const businesses = await prisma.business.findMany({
    where: session.role === "ADMIN" ? {} : { ownerId: session.userId },
    select: { id: true, name: true, slug: true, category: true, location: true, coverUrl: true, isPublished: true },
    orderBy: { createdAt: "desc" },
  });

  type ExperienceRow = {
    businessId: string;
    status: string;
    draftVersion: number;
    publishedVersion: number;
    draftJson: string | null;
    publishedJson: string | null;
  };
  type EntitlementRow = { businessId: string; status: string };

  const [experiences, entitlements] = await Promise.all([
    prisma.businessExperience
      .findMany({
        where: { businessId: { in: businesses.map((business) => business.id) } },
        select: { businessId: true, status: true, draftVersion: true, publishedVersion: true, draftJson: true, publishedJson: true },
      })
      .catch(() => [] as ExperienceRow[]) as Promise<ExperienceRow[]>,
    prisma.interactiveBusinessEntitlement
      .findMany({ where: { businessId: { in: businesses.map((business) => business.id) } }, select: { businessId: true, status: true } })
      .catch(() => [] as EntitlementRow[]) as Promise<EntitlementRow[]>,
  ]);

  const experienceByBusiness = new Map(experiences.map((row) => [row.businessId, row]));
  const entitlementByBusiness = new Map(entitlements.map((row) => [row.businessId, row.status]));
  const liveCount = businesses.filter((business) => business.isPublished).length;

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
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
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
