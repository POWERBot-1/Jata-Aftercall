/**
 * Shared storefront checkout rules, used by the quote endpoint and the checkout endpoint, so a price a customer
 * reviews is computed exactly the way the charge is computed.
 */
import prisma from "./db";
import { normalizeExperienceDocument } from "./experience/document";
import type { RequestedItem } from "./experience/pricing";
import { rateLimitByIdentity, trustedClientIp } from "./rate-limit";

/** Per-instance throttle (§47). A coarse first line of defence; idempotency is what stops duplicate orders. */
export function throttled(ip: string, limit = 20): boolean {
  return !rateLimitByIdentity(ip, { key: "storefront-checkout", max: limit, windowMs: 60_000 }).allowed;
}

export function clientIp(req: Request): string {
  return trustedClientIp(req.headers) ?? "unknown";
}

/** Only a published business with a published experience can take orders (§3, §59). */
export async function loadPublishedShop(slug: string) {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, ownerId: true, isPublished: true, status: true, whatsapp: true, phone: true },
  });
  if (!business || !business.isPublished || business.status === "SUSPENDED") return null;
  const experience = await prisma.businessExperience.findUnique({
    where: { businessId: business.id },
    select: { publishedJson: true, categoryKey: true, status: true },
  });
  if (!experience?.publishedJson || experience.status !== "PUBLISHED") return null;
  try {
    const document = normalizeExperienceDocument(JSON.parse(experience.publishedJson), experience.categoryKey);
    return { business, document };
  } catch {
    // Unsupported configuration cannot authorize a checkout using guessed settings.
    return null;
  }
}

export function parseRequestedItems(rawItems: unknown[]): RequestedItem[] {
  return rawItems.slice(0, 60).map((entry) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    return {
      productId: typeof item.productId === "string" ? item.productId : undefined,
      variantId: typeof item.variantId === "string" ? item.variantId : undefined,
      quantity: Number(item.quantity) || 1,
      addOnIds: Array.isArray(item.addOnIds) ? item.addOnIds.map(String).slice(0, 10) : [],
      notes: typeof item.notes === "string" ? item.notes.slice(0, 300) : undefined,
    };
  });
}

export function parseCustomerDetails(body: Record<string, unknown>): { name: string; phone: string; email: string } | { error: string } {
  const customer = (body.customer && typeof body.customer === "object" ? body.customer : {}) as Record<string, unknown>;
  const name = String(customer.name || "").trim().slice(0, 80);
  const phone = String(customer.phone || "").trim().slice(0, 30);
  const email = String(customer.email || "").trim().slice(0, 160);
  if (name.length < 2) return { error: "Enter your name so the business knows who to expect." };
  if (phone.replace(/\D/g, "").length < 9) return { error: "Enter a valid phone number." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address, or leave it blank." };
  return { name, phone, email };
}
