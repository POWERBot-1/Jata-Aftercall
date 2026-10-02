/**
 * Owner workspace loader (§15, §16, §22, §37)
 *
 * The single server-side entry point for every owner-facing Interactive screen. It does the
 * ownership check first, then loads the draft document, the profile, the entitlement and the
 * publish checklist. Pages never re-derive this — they call `loadWorkspace` and render.
 */

import { getSession, type SessionPayload } from "@/lib/auth";
import prisma from "@/lib/db";
import { assertBusinessOwnership } from "@/lib/tenant";
import { createExperienceDocument, normalizeExperienceDocument } from "./document";
import { getExperienceProfile } from "./categories";
import type { ExperienceProfile } from "./types";
import { getInteractiveEntitlement, type EntitlementState } from "./entitlement";
import { validateForPublication, findInvalidCatalogueItems, type PublishValidation } from "./validate";
import type { ExperienceDocument } from "./types";

export type WorkspaceCounts = { products: number; services: number; media: number; bookings: number; orders: number };

export type Workspace = {
  session: SessionPayload;
  business: {
    id: string;
    name: string;
    slug: string;
    category: string | null;
    phone: string | null;
    whatsapp: string | null;
    location: string | null;
    logoUrl: string | null;
    description: string | null;
    isPublished: boolean;
    status: string;
  };
  experience: {
    id: string;
    status: string;
    categoryKey: string;
    themeKey: string;
    draftVersion: number;
    publishedVersion: number;
    publishedAt: Date | null;
    updatedAt: Date;
  } | null;
  document: ExperienceDocument;
  publishedDocument: ExperienceDocument | null;
  profile: ExperienceProfile;
  entitlement: EntitlementState;
  subscription: { status: string; expiresAt: Date | null; graceUntil: Date | null; plan: { key: string; name: string; priceKES: number } | null } | null;
  paidPayment: { status: string } | null;
  counts: WorkspaceCounts;
  validation: PublishValidation;
  hasUnpublishedChanges: boolean;
};

function readJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasUnpublishedChanges(draftJson: string | null | undefined, publishedJson: string | null | undefined): boolean {
  if (!draftJson) return false;
  if (!publishedJson) return true;
  const draft = normalizeExperienceDocument(readJson(draftJson), undefined);
  const published = normalizeExperienceDocument(readJson(publishedJson), undefined);
  return JSON.stringify(draft) !== JSON.stringify(published);
}

/**
 * Loads everything the owner workspace needs, after verifying that the signed-in user owns
 * (or administrates) the business. Returns `null` when the session or ownership fails, so
 * callers can 404 without leaking whether the business exists (§37).
 */
export async function loadWorkspace(businessId: string): Promise<Workspace | null> {
  const session = await getSession();
  if (!session) return null;
  try {
    await assertBusinessOwnership(businessId, session);
  } catch {
    return null;
  }

  const [business, experience] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true, name: true, slug: true, category: true, phone: true, whatsapp: true,
        location: true, logoUrl: true, description: true, isPublished: true, status: true,
      },
    }),
    prisma.businessExperience.findUnique({ where: { businessId } }),
  ]);
  if (!business) return null;

  const [productCount, serviceCount, mediaCount, bookingCount, orderCount, products, entitlement, paidPayment, subscription] =
    await Promise.all([
      prisma.product.count({ where: { businessId, isActive: true } }),
      prisma.service.count({ where: { businessId, isActive: true } }),
      prisma.mediaAsset.count({ where: { businessId } }),
      prisma.booking.count({ where: { businessId } }),
      prisma.order.count({ where: { businessId } }),
      prisma.product.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true, basePriceKES: true, salePriceKES: true } }),
      getInteractiveEntitlement(businessId),
      prisma.payment.findFirst({ where: { businessId, status: "PAID" }, select: { status: true } }),
      prisma.subscription.findUnique({
        where: { businessId },
        select: { status: true, expiresAt: true, graceUntil: true, plan: { select: { key: true, name: true, priceKES: true } } },
      }),
    ]);

  const draftJson = readJson(experience?.draftJson);
  const publishedJson = readJson(experience?.publishedJson);
  const draft = draftJson ? normalizeExperienceDocument(draftJson, experience?.categoryKey ?? business.category) : null;
  const published = publishedJson ? normalizeExperienceDocument(publishedJson, experience?.categoryKey ?? business.category) : null;
  const categoryKey = experience?.categoryKey || (draft?.categoryKey as string) || business.category || "other";
  const profile = getExperienceProfile(categoryKey);

  const document =
    draft ||
    createExperienceDocument({
      categoryKey,
      businessName: business.name,
      description: business.description,
      phone: business.phone,
      whatsapp: business.whatsapp,
      location: business.location,
      themeKey: experience?.themeKey,
    });

  const validation = validateForPublication({
    document,
    business,
    productCount,
    serviceCount,
    invalidItems: findInvalidCatalogueItems(products),
    entitlement,
    paidPayment,
    subscription,
  });

  return {
    session,
    business,
    experience: experience
      ? {
          id: experience.id,
          status: experience.status,
          categoryKey: experience.categoryKey,
          themeKey: experience.themeKey,
          draftVersion: experience.draftVersion,
          publishedVersion: experience.publishedVersion,
          publishedAt: experience.publishedAt,
          updatedAt: experience.updatedAt,
        }
      : null,
    document,
    publishedDocument: published,
    profile,
    entitlement,
    subscription,
    paidPayment,
    counts: { products: productCount, services: serviceCount, media: mediaCount, bookings: bookingCount, orders: orderCount },
    validation,
    hasUnpublishedChanges: hasUnpublishedChanges(experience?.draftJson, experience?.publishedJson),
  };
}
