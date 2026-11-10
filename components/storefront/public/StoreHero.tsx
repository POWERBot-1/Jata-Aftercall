/**
 * The public storefront hero.
 *
 * IMAGE IS EVERYTHING — with the truth attached. When the business has supplied imagery it leads
 * the page: a full-bleed frame, a graded scrim that keeps the copy legible over any photograph, and
 * the primary actions on top of it. When it has not, the fallback is an intentional composition —
 * a category-toned graphite panel with the business monogram — never a stock photograph passed off
 * as the business's own.
 *
 * The platform's voice is constant in both cases: the JATA AFTERCALL flag, the same type scale, the
 * same action furniture. Only the photograph (and the category tone behind it) is the business's.
 */

import { MapPin, Tag } from "lucide-react";
import type { CategoryArtKey } from "@/lib/storefront/tokens";

export type HeroImage = {
  kind: "business" | "illustrative";
  /** For platform demo assets: a path without extension, served as .webp with a .jpg fallback.
   *  For a business upload: the full URL. */
  path: string;
  alt: string;
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function StoreHero({
  name,
  category,
  location,
  description,
  logoUrl,
  image,
  artLabel,
  children,
}: {
  name: string;
  category?: string | null;
  location?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  image: HeroImage | null;
  artLabel: string;
  /** The hero's actions — placed by the page so the hero never owns contact behaviour. */
  children?: React.ReactNode;
}) {
  const initials = initialsOf(name) || "JA";

  return (
    <section className="st-hero" aria-labelledby="st-hero-title">
      {image ? (
        image.kind === "illustrative" ? (
          <div className="st-hero__media">
            <picture>
              <source
                type="image/webp"
                srcSet={`${image.path}-720.webp 720w, ${image.path}.webp 1100w`}
                sizes="100vw"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${image.path}.jpg`}
                srcSet={`${image.path}-720.jpg 720w, ${image.path}.jpg 1100w`}
                sizes="100vw"
                alt={image.alt}
                width={1100}
                height={684}
                decoding="async"
                {...({ fetchPriority: "high" } as Record<string, string>)}
              />
            </picture>
            <span className="st-hero__scrim" aria-hidden="true" />
          </div>
        ) : (
          <div className="st-hero__media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.path} alt={image.alt} decoding="async" {...({ fetchPriority: "high" } as Record<string, string>)} />
            <span className="st-hero__scrim" aria-hidden="true" />
          </div>
        )
      ) : (
        <div className="st-hero__fallback" aria-hidden="true">
          <span className="st-hero__monogram">{initials}</span>
        </div>
      )}

      <div className="st-hero__body">
        <p className="st-hero__flag">
          <span className="st-hero__flagDot" aria-hidden="true" />
          JATA AFTERCALL · {artLabel}
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="st-hero__logo" decoding="async" />
          ) : null}
          <h1 id="st-hero-title" className="st-hero__title">
            {name}
          </h1>
        </div>

        <p className="st-hero__meta">
          {category ? (
            <span className="st-hero__metaItem">
              <Tag size={13} aria-hidden="true" />
              {category}
            </span>
          ) : null}
          {location ? (
            <span className="st-hero__metaItem">
              <MapPin size={13} aria-hidden="true" />
              {location}
            </span>
          ) : null}
        </p>

        {description ? <p className="st-hero__lede">{description}</p> : null}

        {children}

        {image?.kind === "illustrative" ? (
          <p className="st-hero__note">Illustrative photograph — not the business&apos;s own. No payment is taken on this page.</p>
        ) : null}
      </div>
    </section>
  );
}

export default StoreHero;

/** Keyed export of the art-direction keys a hero can be tinted with, so a page can pass the label
 *  without importing the token table itself. */
export type HeroArtKey = CategoryArtKey;
