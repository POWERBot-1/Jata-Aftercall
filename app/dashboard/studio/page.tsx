import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getBusinessUrl } from "@/lib/url";
import { entitlementStatusLabel, experienceStatusLabel, toneClass } from "@/lib/statusLabels";

export const metadata: Metadata = { title: "Website studio" };
export const dynamic = "force-dynamic";

/**
 * Studio index (§15)
 *
 * The door into each business's Interactive website. It shows, at a glance, whether the
 * package is paid for, whether the site is live, and what still needs the owner's attention.
 */
export default async function StudioIndexPage() {
  const session = await getSession();
  if (!session) return null;

  const businesses = await prisma.business.findMany({
    where: session.role === "ADMIN" ? {} : { ownerId: session.userId },
    select: { id: true, name: true, slug: true, category: true, isPublished: true },
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

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Website studio</p>
        <h1 className="text-xl font-bold">Your interactive websites</h1>
        <p className="text-sm text-zinc-600">Pick a business to edit its website, catalogue, theme and orders.</p>
      </header>

      {businesses.length === 0 ? (
        <div className="jata-empty">
          <p className="text-sm font-semibold">No business yet</p>
          <p className="mt-1 text-sm text-zinc-600">Create your business first, then build its interactive website.</p>
          <Link className="jata-btn jata-btn-primary mt-4" href="/onboarding">Create business</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {businesses.map((business) => {
            const experience = experienceByBusiness.get(business.id) || null;
            const entitlement = entitlementStatusLabel(entitlementByBusiness.get(business.id) || "NONE");
            const state = experienceStatusLabel(experience?.status || "DRAFT");
            const hasUnpublishedChanges = Boolean(experience?.draftJson) && experience?.draftJson !== experience?.publishedJson;
            return (
              <li key={business.id} className="jata-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold [overflow-wrap:anywhere]">{business.name}</h2>
                    <p className="text-sm text-zinc-600">{business.category} · {getBusinessUrl(business.slug)}</p>
                    <p className="mt-2 flex flex-wrap gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${toneClass(state.tone)}`}>{state.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${toneClass(entitlement.tone)}`}>
                        Package: {entitlement.label}
                      </span>
                      {hasUnpublishedChanges ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-sm font-semibold text-amber-900">Unpublished changes</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link className="jata-btn jata-btn-primary" href={`/dashboard/businesses/${business.id}`}>Open studio</Link>
                    <Link className="jata-btn jata-btn-secondary" href={getBusinessUrl(business.slug)} target="_blank" rel="noopener noreferrer">
                      {business.isPublished ? "View site" : "Preview"}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
