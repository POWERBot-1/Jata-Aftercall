import { LANDING_BENEFITS, LANDING_STORY } from "@/lib/landing";
import { LandingIcon } from "./Icons";

/**
 * Product story and benefits.
 *
 * Both sections are server-rendered from `lib/landing.ts`. There are no counters, ratings or
 * outcome claims here — only statements about what the page does, which the product actually does.
 */
export function StorySection() {
  return (
    <section className="lp-section lp-section--cream" id="product" aria-labelledby="product-title">
      <div className="lp-wrap">
        <p className="lp-kicker">The moment after</p>
        <h2 id="product-title" className="lp-h2">
          Put the next step after a customer interaction in one place.
        </h2>
        <p className="lp-lede">
          A customer may see a post and then look for your details or services. JATA AFTERCALL gives you one mobile-friendly
          page for the business information and contact options you choose to share.
        </p>

        <ol className="lp-story">
          {LANDING_STORY.map((act) => (
            <li key={act.step} className="lp-story__item">
              <span className="lp-story__step" aria-hidden="true">{act.step}</span>
              <h3 className="lp-story__title">{act.title}</h3>
              <p className="lp-story__body">{act.body}</p>
            </li>
          ))}
        </ol>

        <div className="lp-marquee" aria-hidden="true">
          <div className="lp-marquee__track">
            {[0, 1].map((copy) => (
              <div className="lp-marquee__row" key={copy}>
                <span>WhatsApp</span><span aria-hidden="true">·</span>
                <span>Call</span><span aria-hidden="true">·</span>
                <span>Directions</span><span aria-hidden="true">·</span>
                <span>Offers</span><span aria-hidden="true">·</span>
                <span>Services &amp; prices</span><span aria-hidden="true">·</span>
                <span>Share</span><span aria-hidden="true">·</span>
                <span>Analytics</span><span aria-hidden="true">·</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function BenefitsSection() {
  return (
    <section className="lp-section lp-section--ink" id="benefits" aria-labelledby="benefits-title">
      <div className="lp-wrap">
        <p className="lp-kicker lp-kicker--light">What is on the page</p>
        <h2 id="benefits-title" className="lp-h2 lp-h2--light">
          Business details, services and contact options in one place.
        </h2>
        <div className="lp-benefits">
          {LANDING_BENEFITS.map((benefit) => (
            <article key={benefit.title} className="lp-benefit">
              <span className="lp-benefit__icon" aria-hidden="true">
                <LandingIcon name={benefit.icon} />
              </span>
              <h3 className="lp-benefit__title">{benefit.title}</h3>
              <p className="lp-benefit__body">{benefit.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
