/**
 * Structured data (§33)
 *
 * Category-appropriate schema.org JSON-LD, generated server-side from the tenant's own
 * data. Only types that are technically valid for the business are emitted.
 */

import { getBaseUrl } from "../url";
import { getExperienceProfile } from "./categories";
import type { CategoryKey, ExperienceDocument } from "./types";

type BusinessLike = {
  name: string;
  slug: string;
  description?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  logoUrl?: string | null;
};

type ItemLike = { name: string; basePriceKES?: number | null; salePriceKES?: number | null; imageUrl?: string | null; description?: string | null };

function absolute(path: string): string {
  return `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function structuredDataFor(params: {
  business: BusinessLike;
  document: ExperienceDocument;
  items?: ItemLike[];
  services?: Array<{ title: string; priceFrom?: number | null; description?: string | null }>;
}): Record<string, unknown> {
  const { business, document } = params;
  const profile = getExperienceProfile(document.categoryKey as CategoryKey);
  const url = absolute(`/b/${business.slug}`);
  const image = document.brand.heroImageUrl || business.logoUrl || document.brand.logoUrl || undefined;

  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": profile.structuredDataType,
    name: business.name,
    url,
    description: document.seo?.description || business.description || document.brand.description || `${business.name} — ${profile.label}.`,
  };

  if (image) base.image = image;
  if (business.logoUrl) base.logo = business.logoUrl;
  const phone = document.settings.phone || business.phone;
  if (phone) base.telephone = phone;

  const address = document.settings.location || business.location;
  if (address) {
    base.address = { "@type": "PostalAddress", streetAddress: address, addressCountry: "KE" };
  }
  if (typeof document.settings.lat === "number" && typeof document.settings.lng === "number") {
    base.geo = { "@type": "GeoCoordinates", latitude: document.settings.lat, longitude: document.settings.lng };
  }

  const openings = document.settings.openingHours;
  if (openings && Object.keys(openings).length > 0) {
    base.openingHoursSpecification = Object.entries(openings)
      .filter(([, value]) => value && value !== "Closed")
      .map(([day, value]) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: day,
        opens: String(value).split("-")[0]?.trim() || "09:00",
        closes: String(value).split("-")[1]?.trim() || "17:00",
      }));
  }

  const items = params.items || [];
  if (items.length > 0 && (profile.capabilities.includes("commerce") || profile.capabilities.includes("catalogue"))) {
    base.makesOffer = items.slice(0, 30).map((item) => {
      const price = item.salePriceKES ?? item.basePriceKES ?? null;
      return {
        "@type": "Offer",
        itemOffered: {
          "@type": profile.structuredDataType === "Restaurant" ? "MenuItem" : "Product",
          name: item.name,
          description: item.description || undefined,
          image: item.imageUrl || undefined,
        },
        price: price === null ? undefined : price,
        priceCurrency: "KES",
        availability: "https://schema.org/InStock",
      };
    });
  }

  const services = params.services || [];
  if (services.length > 0) {
    base.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: `${business.name} services`,
      itemListElement: services.slice(0, 30).map((service) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: service.title, description: service.description || undefined },
        price: service.priceFrom ?? undefined,
        priceCurrency: "KES",
      })),
    };
  }

  return base;
}

/** Metadata for the public page — title, description, canonical, Open Graph (§33). */
export function seoMetadataFor(params: {
  business: BusinessLike;
  document: ExperienceDocument;
  pageTitle?: string;
  isPreview?: boolean;
}) {
  const { business, document } = params;
  const url = absolute(`/b/${business.slug}`);
  const title = params.pageTitle
    ? `${params.pageTitle} · ${business.name}`
    : document.seo?.title || `${business.name} — ${document.brand.tagline || business.location || business.description || ""}`.replace(/\s+—\s*$/, "");
  const description =
    document.seo?.description ||
    document.brand.description ||
    business.description ||
    `${business.name} — ${document.brand.tagline || "Browse, order and book directly."}`;
  const image = document.seo?.imageUrl || document.brand.heroImageUrl || business.logoUrl || "/og.jpg";
  return {
    title,
    description: description.slice(0, 180),
    alternates: { canonical: url },
    openGraph: { title, description: description.slice(0, 180), url, siteName: business.name, images: [{ url: image }], type: "website" },
    twitter: { card: "summary_large_image", title, description: description.slice(0, 180), images: [image] },
    robots: params.isPreview ? { index: false, follow: false } : undefined,
  };
}
