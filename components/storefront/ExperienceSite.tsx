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
import { RenderModeProbe } from "./RenderModeProbe";
import { MotionReveal } from "./MotionReveal";
import { MotionEngineMount } from "./motion/MotionEngineMount";
import { sectionRecipesForPage } from "@/lib/experience/motion";
import { isRenderPreference } from "@/lib/experience/renderMode";

export function ExperienceSite({ data, previewNotice }: { data: StorefrontData; previewNotice?: string | null }) {
  const { document, theme, profile, business } = data;
  const hero = document.sections.find((section) => section.type === "hero" && section.visible);
  const body = document.sections.filter((section) => section.visible && section.type !== "hero" && section.type !== "navigation");
  const commerce = profile.capabilities.includes("commerce");
  const booking = profile.capabilities.includes("booking");
  const heroImage = hero?.imageUrl || document.brand.heroImageUrl || null;

  // Choreography is chosen on the server so the markup — and its CSS fallback — is complete before
  // any script runs. The seed comes from the generation that produced this document, falling back
  // to something equally stable for hand-built sites, so a business always animates the same way
  // and two businesses sharing a theme do not animate identically (§7, §68).
  const motionSeed = document.generation?.seed || `${document.categoryKey}:${business.slug}`;
  const renderPreference = isRenderPreference(document.renderPreference) ? document.renderPreference : "auto";
  const recipes = sectionRecipesForPage({ motionLevel: theme.treatment.motion, seed: motionSeed, sections: body });
  const magnetic = theme.treatment.motion === "expressive";

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
                  <Link
                    href={commerce ? `/b/${business.slug}/shop` : booking ? `/b/${business.slug}/book` : "#contact"}
                    className="eb-btn"
                    {...(magnetic ? { "data-eb-magnetic": "" } : {})}
                  >
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

      <RenderModeProbe preference={renderPreference} />
      <MotionEngineMount motionLevel={theme.treatment.motion} seed={motionSeed} preference={renderPreference} />

      {body.map((section) =>
        theme.treatment.motion === "none" ? (
          <SectionRenderer key={section.id} section={section} data={data} />
        ) : (
          <MotionReveal key={section.id} motionLevel={theme.treatment.motion} recipe={recipes[section.id] ?? null}>
            <SectionRenderer section={section} data={data} />
          </MotionReveal>
        ),
      )}

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
