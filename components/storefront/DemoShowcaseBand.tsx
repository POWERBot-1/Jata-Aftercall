import type { DemoShowcaseProps } from "@/lib/demoShowcase";
import { formatKES } from "@/lib/format";

/**
 * The motion-led band at the top of the four public demo pages.
 *
 * It renders server-side and needs no JavaScript: the photograph is a real <img> with a webp
 * source and explicit dimensions, the motion is CSS, and every control is either an in-page link
 * (`#services`, `#quote`) or the page's existing contact actions. If animation is switched off —
 * by the visitor's reduced-motion setting, a slow device or a blocked stylesheet animation — the
 * band simply becomes a still photograph behind real copy.
 *
 * The image is labelled illustrative, and all business details, services, offers and prices are
 * explicitly identified as fictional samples rather than current business information.
 */
export function DemoShowcaseBand(props: DemoShowcaseProps) {
  const {
    motion,
    image,
    secondaryImage,
    imageAlt,
    secondaryImageAlt,
    kicker,
    headline,
    lede,
    detail,
    offerTitle,
    businessName,
    category,
    location,
    services,
  } = props;

  return (
    <section className="jata-showcase" data-motion={motion} aria-label={`${businessName} example page`}>
      <div className="jata-showcase__media">
        <picture>
          <source
            type="image/webp"
            srcSet={`${image}-720.webp 720w, ${image}.webp 1100w`}
            sizes="100vw"
          />
          <img
            src={`${image}.jpg`}
            srcSet={`${image}-720.jpg 720w, ${image}.jpg 1100w`}
            sizes="100vw"
            alt={imageAlt}
            width={1100}
            height={684}
            decoding="async"
            /* React 18 only forwards the lower-case attribute; the hint still preloads the LCP image. */
            {...({ fetchpriority: "high" } as Record<string, string>)}
            className="jata-showcase__img"
          />
        </picture>
        {secondaryImage ? (
          <picture className="jata-showcase__frame2">
            <source type="image/webp" srcSet={`${secondaryImage}-720.webp 720w, ${secondaryImage}.webp 1100w`} sizes="100vw" />
              <img
              src={`${secondaryImage}.jpg`}
              srcSet={`${secondaryImage}-720.jpg 720w, ${secondaryImage}.jpg 1100w`}
              sizes="100vw"
              alt={secondaryImageAlt ?? ""}
              width={1100}
              height={684}
              loading="lazy"
              decoding="async"
              className="jata-showcase__img jata-showcase__img--frame2"
            />
          </picture>
        ) : null}
        <span className="jata-showcase__scrim" aria-hidden="true" />
        <span className="jata-showcase__panel" aria-hidden="true" />
        {motion === "drive" ? <span className="jata-showcase__streaks" aria-hidden="true" /> : null}
        {motion === "steam" ? <span className="jata-showcase__steam" aria-hidden="true" /> : null}
        {motion === "salon" ? <span className="jata-showcase__glow" aria-hidden="true" /> : null}
      </div>

      <div className="jata-showcase__inner">
        <p className="jata-showcase__flag">
          <span className="jata-showcase__pulse" aria-hidden="true" />
          Illustrative demo · {category}
        </p>
        <p className="jata-showcase__kicker">{kicker}</p>
        <p className="jata-showcase__headline">{headline}</p>
        <p className="jata-showcase__lede">{lede}</p>

        {offerTitle ? (
          <p className="jata-showcase__offer">
            <span className="jata-showcase__offer-label">Sample offer · fictional, not current</span>
            <span className="jata-showcase__offer-title">{offerTitle}</span>
          </p>
        ) : null}

        <ul className="jata-showcase__services" aria-label={`Fictional sample services and prices for ${businessName}`}>
          {services.map((service) => (
            <li key={service.id}>
              <a className="jata-showcase__service" href="#services">
                <span className="jata-showcase__service-title">{service.title}</span>
                <span className="jata-showcase__service-price">
                  {service.priceLabel || (service.priceFrom ? `From ${formatKES(service.priceFrom)}` : "Ask for a price")}
                </span>
              </a>
            </li>
          ))}
        </ul>

        <div className="jata-showcase__actions">
          <a className="jata-showcase__cta" href="#services">See services &amp; prices</a>
          <a className="jata-showcase__cta jata-showcase__cta--ghost" href="#quote">Ask a question</a>
        </div>

        <details className="jata-showcase__detail">
          <summary className="jata-showcase__summary">
            What this example shows
            <span className="jata-showcase__chevron" aria-hidden="true" />
          </summary>
          <p className="jata-showcase__detail-body">{detail}</p>
        </details>

        <p className="jata-showcase__meta">
          {location ? `Example location: ${location}. ` : ""}Fictional demo only — names, contact details, services,
          offers and prices are synthetic examples, not current business information or property listings. Illustrative
          photography. No payment is taken on this page.
        </p>
      </div>
    </section>
  );
}

export default DemoShowcaseBand;
