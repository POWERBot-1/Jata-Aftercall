export type PublicViewer = {
  userId: string;
  role: string;
} | null;

export type PublicBusinessAccess = {
  isPublished: boolean;
  ownerId: string;
  ownerMemberIds?: string[];
};

export type PublicPageDecision = "missing" | "not_found" | "preview" | "public";

/**
 * Public visitors never see an unpublished page.
 * Owner/admin preview is decided only from the server session and the stored owner/member rows.
 * A URL-supplied owner id is not an input and must not be consulted.
 */
export function publicPageDecision(input: {
  business: PublicBusinessAccess | null;
  viewer: PublicViewer;
}): PublicPageDecision {
  if (!input.business) return "missing";
  if (input.business.isPublished) return "public";
  if (!input.viewer) return "not_found";
  if (input.viewer.role === "ADMIN") return "preview";
  if (input.viewer.userId && input.viewer.userId === input.business.ownerId) return "preview";
  if (input.business.ownerMemberIds?.includes(input.viewer.userId)) return "preview";
  return "not_found";
}

/** Publishing a page requires a successfully verified subscription payment (admin override aside). */
export const PUBLISH_REQUIRES_PAYMENT = true;

export type PublicationSubscriptionState = {
  status: string;
  expiresAt?: Date | null;
  graceUntil?: Date | null;
};

export type PublicationPaymentEvidence = {
  paidPayment: { status: string } | null;
  subscription: PublicationSubscriptionState | null;
};

/**
 * True only when the business has a verified PAID payment backing a currently-valid
 * subscription (ACTIVE/EXPIRING, not past the grace window). Callers load the two
 * rows server-side; this function stays pure so the gate is unit-testable.
 */
export function hasVerifiedPublicationRight(evidence: PublicationPaymentEvidence, now: Date = new Date()): boolean {
  if (!evidence.paidPayment || evidence.paidPayment.status !== "PAID") return false;
  const subscription = evidence.subscription;
  if (!subscription) return false;
  if (subscription.status !== "ACTIVE" && subscription.status !== "EXPIRING") return false;
  const validUntil = subscription.graceUntil ?? subscription.expiresAt ?? null;
  if (validUntil && now.getTime() > validUntil.getTime()) return false;
  return true;
}

/**
 * Whether the requested isPublished value may be written.
 * - Unpublishing is always allowed (never locks an owner out of hiding a page).
 * - Publishing requires a verified payment, unless the caller is an admin
 *   (the admin-only route remains the documented operator override).
 */
export function canSetPublished(
  isPublished: boolean,
  options: { isAdmin?: boolean; verifiedPayment?: boolean } = {},
): boolean {
  if (typeof isPublished !== "boolean") return false;
  if (!isPublished) return true;
  if (!PUBLISH_REQUIRES_PAYMENT) return true;
  return options.isAdmin === true || options.verifiedPayment === true;
}
