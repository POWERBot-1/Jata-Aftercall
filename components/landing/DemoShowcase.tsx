"use client";

/**
 * Interactive demo-business showcase.
 *
 * Four example businesses, one panel at a time. Interaction is deliberately plain:
 *   • Tabs follow the WAI-ARIA tabs pattern — roving focus with Arrow/Home/End, and a real button
 *     per tab, so it works with a screen reader, a keyboard and a thumb.
 *   • Every panel links to the live demo page (`/b/<slug>`), which is the existing, real
 *     experience. Nothing here starts a transaction; the demo pages take no payments.
 *   • Images are lazy-loaded except nothing is forced, so a slow connection only fetches the
 *     panel the visitor actually opens.
 *   • Panels are hidden with the `hidden` attribute rather than unmounted, so switching is instant
 *     and no layout shift is introduced; motion is CSS and is disabled by reduced-motion.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import type { LandingDemoCard } from "@/lib/landing";

function shortName(name: string) {
  return name.replace(" Properties", "").replace(" Auto Care", " Auto").replace(" Beauty Studio", " Beauty");
}

export function DemoShowcase({ cards }: { cards: LandingDemoCard[] }) {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = cards.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section className="lp-section lp-section--paper" id="demo" aria-labelledby="demo-title">
      <div className="lp-wrap">
        <div className="lp-section__head">
          <div>
            <p className="lp-kicker">Demo businesses</p>
            <h2 id="demo-title" className="lp-h2">
              Four real pages. Four different businesses.
            </h2>
            <p className="lp-lede">
              Open any demo and use it as a customer would — the WhatsApp button, the offer, the services and the
              map all work. Each page states plainly that it is an example.
            </p>
          </div>
          <p className="lp-demo__hint" aria-hidden="true">Pick a business to preview →</p>
        </div>

        <div className="lp-demo" role="tablist" aria-label="Demo businesses" aria-orientation="horizontal">
          {cards.map((card, index) => (
            <button
              key={card.slug}
              type="button"
              role="tab"
              id={`demo-tab-${card.slug}`}
              aria-selected={index === active}
              aria-controls={`demo-panel-${card.slug}`}
              tabIndex={index === active ? 0 : -1}
              ref={(node) => { tabRefs.current[index] = node; }}
              onClick={() => setActive(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`lp-demo__tab lp-demo__tab--${card.motion}`}
              data-active={index === active}
            >
              <span className="lp-demo__tab-name">{card.name}</span>
              <span className="lp-demo__tab-meta">{shortName(card.category)}{card.location ? ` · ${card.location.split(",")[0]}` : ""}</span>
            </button>
          ))}
        </div>

        <div className="lp-demo__body">
          {cards.map((card, index) => (
            <article
              key={card.slug}
              role="tabpanel"
              id={`demo-panel-${card.slug}`}
              aria-labelledby={`demo-tab-${card.slug}`}
              hidden={index !== active}
              className="lp-demo__panel"
              data-motion={card.motion}
              data-price-source={card.source}
            >
              <figure className="lp-demo__media">
                <picture>
                  <source
                    type="image/webp"
                    srcSet={`${card.image}-720.webp 720w, ${card.image}.webp 1100w`}
                    sizes="(max-width: 900px) 100vw, 55vw"
                  />
                  {/*
                    A hand-authored <picture> pair rather than next/image: these are static files in
                    /public, the srcset and sizes are chosen for this layout, and the optimization
                    endpoint is not part of this deployment. Both sources are lazy so a slow
                    connection only fetches the panel the visitor actually opens.
                  */}
                  <img
                    src={`${card.image}.jpg`}
                    srcSet={`${card.image}-720.jpg 720w, ${card.image}.jpg 1100w`}
                    sizes="(max-width: 900px) 100vw, 55vw"
                    alt={card.imageAlt}
                    width={1100}
                    height={684}
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
                <figcaption className="lp-demo__credit">Illustrative photograph · example business</figcaption>
                {card.inset ? (
                  <span className="lp-demo__inset">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${card.inset.image}-720.jpg`}
                      alt={card.inset.alt}
                      width={720}
                      height={448}
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                ) : null}
              </figure>

              <div className="lp-demo__content">
                <p className="lp-demo__kicker">{card.kicker}</p>
                <h3 className="lp-demo__headline">{card.headline}</h3>
                <p className="lp-demo__story">{card.story}</p>

                {card.offer ? (
                  <p className="lp-demo__offer">
                    <span className="lp-demo__offer-label">Offer on the page</span>
                    <span className="lp-demo__offer-title">{card.offer.title}</span>
                    {card.offer.subtitle ? <span className="lp-demo__offer-sub">{card.offer.subtitle}</span> : null}
                  </p>
                ) : null}

                <ul className="lp-demo__services" aria-label={`Services shown on ${card.name}`}>
                  {card.services.map((service) => (
                    <li key={service.title}>
                      <Link href={`/b/${card.slug}#services`} className="lp-demo__service">
                        <span className="lp-demo__service-title">{service.title}</span>
                        <span className="lp-demo__service-price">{service.priceLabel}</span>
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="lp-demo__actions">
                  <Link href={`/b/${card.slug}`} className="lp-btn lp-btn--primary">
                    Open the demo <span aria-hidden="true">→</span>
                  </Link>
                  <Link href="/register" className="lp-btn lp-btn--ghost">
                    Build yours
                  </Link>
                </div>
                <p className="lp-demo__note">
                  {card.source === "live"
                    ? "Prices shown are the ones this demo page currently displays. Example business — no real customer data."
                    : "Prices shown come from the documented demo content for this example business — no real customer data."}
                </p>
              </div>
            </article>
          ))}
        </div>

        <ul className="lp-demo__index">
          {cards.map((card) => (
            <li key={card.slug}>
              <Link href={`/b/${card.slug}`} className="lp-demo__index-link">
                /b/{card.slug}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default DemoShowcase;
