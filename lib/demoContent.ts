/** Shared visibility and identity rules for public demo content. */
import { DEMO_OWNER_EMAIL, DEMO_PAYMENT_PREFIX, DEMO_SLUGS } from "./demoData";

export type OfferStatus = {
  title?: string | null;
  isActive?: boolean | null;
  validUntil?: Date | string | null;
};

export type DemoBusinessIdentity = {
  slug: string;
  ownerEmail: string | null | undefined;
  paymentReferences: readonly string[];
};

/**
 * A slug alone is not proof that a business row is synthetic. A public route is treated as a demo
 * only when it is one of the fixed showcase slugs, is owned by the dedicated seed demo account,
 * and has no payment reference outside the seed's explicit `demo-` namespace.
 */
export function isVerifiedDemoRecord(record: DemoBusinessIdentity): boolean {
  return (
    DEMO_SLUGS.includes(record.slug) &&
    record.ownerEmail?.trim().toLowerCase() === DEMO_OWNER_EMAIL &&
    record.paymentReferences.every((reference) => reference.startsWith(DEMO_PAYMENT_PREFIX))
  );
}

/** An offer is displayable only when its persisted active flag is true and it has not expired. */
export function isCurrentPublicOffer(offer: OfferStatus | null | undefined, now: Date = new Date()): boolean {
  if (!offer || offer.isActive !== true || !offer.title?.trim()) return false;
  if (offer.validUntil == null) return true;

  const expiry = offer.validUntil instanceof Date ? offer.validUntil.getTime() : Date.parse(offer.validUntil);
  return Number.isFinite(expiry) && expiry >= now.getTime();
}

/** Only active, named service rows may be shown on a public business page or demo preview. */
export function activePublicServices<T extends { title?: string | null; isActive?: boolean | null }>(
  services: readonly T[] | null | undefined,
): T[] {
  return (services ?? []).filter((service) => service.isActive === true && Boolean(service.title?.trim()));
}
