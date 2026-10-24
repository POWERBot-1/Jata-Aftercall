import Link from "next/link";

/**
 * Hero — the first screen.
 *
 * Motion here is CSS-only (a slow drift on the photograph, a staggered rise on the copy), so the
 * page has no animation dependency: if scripts fail, the hero still paints, the headline and both
 * calls to action are immediate, and every rule is disabled under `prefers-reduced-motion`.
 *
 * The photograph is a stock-style illustration of a Nairobi business street, not a photograph of a
 * customer, and the phone frame is an example page built from the same components the real page
 * uses — it is labelled "Example page" rather than presented as a customer result.
 */
export function Hero() {
  return (
    <section className="lp-hero" id="top" aria-labelledby="hero-title">
      <div className="lp-hero__media" aria-hidden="true">
        <picture>
          <source
            type="image/webp"
            srcSet="/landing/hero-nairobi-1080.webp 1080w, /landing/hero-nairobi.webp 1600w"
            sizes="100vw"
          />
          <img
            src="/landing/hero-nairobi.jpg"
            srcSet="/landing/hero-nairobi-1080.jpg 1080w, /landing/hero-nairobi.jpg 1600w"
            sizes="100vw"
            alt=""
            width={1600}
            height={679}
            decoding="async"
            /* React 18 only forwards the lower-case attribute; the hint still preloads the LCP image. */
            {...({ fetchpriority: "high" } as Record<string, string>)}
          />
        </picture>
        <span className="lp-hero__scrim" />
        <span className="lp-hero__grain" />
      </div>

      <div className="lp-hero__inner">
        <div className="lp-hero__copy">
          <p className="lp-eyebrow">
            <span className="lp-eyebrow__dot" aria-hidden="true" />
            For Kenyan micro &amp; small businesses
          </p>
          <h1 id="hero-title" className="lp-hero__title">
            Make the next step after a customer interaction{" "}
            <span className="lp-hero__accent">easy to find.</span>
          </h1>
          <p className="lp-hero__lede">
            JATA AFTERCALL gives your business a light, mobile-first page for the moment <em>after</em> a customer
            interacts with you — WhatsApp, Call, Directions, Services, Offer, Analytics. No bulky website. No
            complexity.
          </p>
          <div className="lp-hero__actions">
            <Link href="/register" className="lp-btn lp-btn--primary">
              Get my business page <span aria-hidden="true">→</span>
            </Link>
            <a href="#demo" className="lp-btn lp-btn--ghost">
              Explore demos
            </a>
          </div>
          <p className="lp-hero__micro">Set up your page · Mobile-friendly · Pay with M-Pesa or card</p>
        </div>

        <figure className="lp-phone">
          <div className="lp-phone__frame">
            <div className="lp-phone__screen">
              <p className="lp-phone__thanks">Thanks for contacting us 👋</p>
              <div className="lp-phone__biz">
                <span className="lp-phone__avatar" aria-hidden="true">MB</span>
                <div>
                  <p className="lp-phone__name">Mary&apos;s Beauty Studio</p>
                  <p className="lp-phone__meta">Braids, nails &amp; beauty · Kitengela</p>
                </div>
              </div>
              <div className="lp-phone__ctas">
                <span className="lp-phone__cta lp-phone__cta--wa">WhatsApp</span>
                <span className="lp-phone__cta">Call</span>
              </div>
              <div className="lp-phone__offer">
                <p className="lp-phone__offer-label">Sample offer · fictional</p>
                <p className="lp-phone__offer-title">Example braid price — from KES 1,500</p>
                <p className="lp-phone__offer-sub">Illustrative value only · not current</p>
              </div>
              <div className="lp-phone__rows">
                <span><span>Braiding</span><span>From KES 1,500</span></span>
                <span><span>Nails</span><span>From KES 800</span></span>
                <span><span>Makeup</span><span>From KES 2,500</span></span>
              </div>
              <div className="lp-phone__chips">
                <span>Directions</span>
                <span>Share</span>
              </div>
            </div>
          </div>
          <figcaption className="lp-phone__caption">
            Fictional demo page — sample contact details, service entries and prices; no current offer is represented.
            <a href="#demo" className="lp-phone__caption-link">Explore the examples →</a>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export default Hero;
