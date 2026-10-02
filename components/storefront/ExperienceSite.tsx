/**
 * Public business home page (§4, §7–§12, §23, §34)
 *
 * The hero and the ordered section list come from the tenant's published experience
 * document; nothing about the layout is hard-coded per category (§51).
 */

import Link from "next/link";
import type { StorefrontData } from "@/lib/experience/storefront";
import { structuredDataFor } from "@/lib/experience/structuredData";
import { StorefrontShell } from "./StorefrontShell";
import { SectionRenderer } from "./Sections";

export function ExperienceSite({ data, previewNotice }: { data: StorefrontData; previewNotice?: string | null }) {
  const { document, theme, profile, business } = data;
  const hero = document.sections.find((section) => section.type === "hero" && section.visible);
  const body = document.sections.filter((section) => section.visible && section.type !== "hero" && section.type !== "navigation");
  const commerce = profile.capabilities.includes("commerce");
  const booking = profile.capabilities.includes("booking");
  const heroImage = hero?.imageUrl || document.brand.heroImageUrl || null;

  const structuredData = structuredDataFor({
    business,
    document,
    items: data.items.map((item) => ({ name: item.name, basePriceKES: item.price, description: item.description, imageUrl: item.imageUrl })),
    services: data.services.map((service) => ({ title: service.name, priceFrom: service.price, description: service.description })),
  });

  return (
    <StorefrontShell data={data} previewNotice={previewNotice} structuredData={structuredData}>
      {hero ? (
        <section className={`eb-hero eb-hero--${theme.treatment.heroStyle}`}>
          {heroImage && theme.treatment.heroStyle !== "split" ? (
            <div className="eb-hero__media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt="" fetchPriority="high" decoding="async" />
              <div className="eb-hero__scrim" />
            </div>
          ) : null}
          <div className={theme.treatment.heroStyle === "split" ? "eb-container" : "eb-hero__content"}>
            <div className={theme.treatment.heroStyle === "split" ? "eb-hero__grid" : ""}>
              {heroImage && theme.treatment.heroStyle === "split" ? (
                <div className="eb-hero__media">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={heroImage} alt="" fetchPriority="high" decoding="async" />
                </div>
              ) : null}
              <div className={theme.treatment.heroStyle === "split" ? "" : "eb-container"}>
                {document.brand.tagline ? <span className="eb-eyebrow">{document.brand.tagline}</span> : null}
                <h1 className="eb-h1" style={{ marginTop: "0.75rem" }}>
                  {hero.title || business.name}
                </h1>
                {hero.subtitle ? <p className="eb-lede">{hero.subtitle}</p> : null}
                <div className="eb-hero__actions">
                  <Link href={commerce ? `/b/${business.slug}/shop` : booking ? `/b/${business.slug}/book` : "#contact"} className="eb-btn">
                    {hero.cta?.label || profile.cta.primary}
                  </Link>
                  {document.settings.whatsapp || document.settings.phone ? (
                    <a
                      href={`https://wa.me/${(document.settings.whatsapp || document.settings.phone || "").replace(/\D/g, "")}`}
                      className="eb-btn eb-btn--outline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      WhatsApp
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {body.map((section) => (
        <SectionRenderer key={section.id} section={section} data={data} />
      ))}

      {body.length === 0 ? (
        <section className="eb-section">
          <div className="eb-container">
            <div className="eb-empty">
              <h3 className="eb-h3">{business.name} is finishing this page</h3>
              <p>Please check back shortly.</p>
            </div>
          </div>
        </section>
      ) : null}
    </StorefrontShell>
  );
}
