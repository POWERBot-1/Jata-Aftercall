/** Professional requests and appointments are different intents; this never authorizes or prices either. */
import type { StorefrontItem } from "./storefront";
export function isBookableConsultation(item: Pick<StorefrontItem, "kind" | "bookingEnabled" | "pricingType" | "price">): boolean {
  return item.kind === "service" && item.bookingEnabled === true && item.pricingType === "FIXED" && item.price !== null;
}
export function professionalEnquiryHref(slug: string, serviceId?: string): string {
  return `/b/${encodeURIComponent(slug)}/enquire${serviceId ? `?service=${encodeURIComponent(serviceId)}` : ""}`;
}
