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

/** Publishing a page is not gated on payment or an active subscription. */
export const PUBLISH_REQUIRES_PAYMENT = false;

export function canSetPublished(isPublished: boolean): boolean {
  return typeof isPublished === "boolean" && !PUBLISH_REQUIRES_PAYMENT;
}
