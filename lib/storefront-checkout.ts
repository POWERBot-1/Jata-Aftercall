/**
 * Shared storefront checkout rules, used by the quote endpoint and the checkout endpoint, so a price a customer
 * reviews is computed exactly the way the charge is computed.
 */
import prisma from "./db";
import { normalizeExperienceDocument } from "./experience/document";
import type { RequestedItem } from "./experience/pricing";

const hits = new Map<string, { count: number; reset: number }>();

/** Per-instance throttle (§47). A coarse first line of defence; idempotency is what stops duplicate orders. */
export function throttled(ip: string, limit = 20): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
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
  const document = normalizeExperienceDocument(JSON.parse(experience.publishedJson), experience.categoryKey);
  return { business, document };
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
