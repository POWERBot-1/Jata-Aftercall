import type { Metadata } from "next";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { StudioIndexView } from "@/components/studio/StudioIndexView";

export const metadata: Metadata = { title: "Website Studio" };
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
    <StudioIndexView
      businesses={businesses}
      experienceByBusiness={experienceByBusiness}
      entitlementByBusiness={entitlementByBusiness}
      liveCount={liveCount}
    />
  );
}
