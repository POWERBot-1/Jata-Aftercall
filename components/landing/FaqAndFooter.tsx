import Link from "next/link";
import { LANDING_DEMO_SLUGS, LANDING_FAQ } from "@/lib/landing";
import { nairobiCalendarDay } from "@/lib/dateFormat";

/** FAQ — native `<details>` disclosures: keyboard operable, no JavaScript, no layout shift. */
export function FaqSection() {
  return (
    <section className="lp-section lp-section--cream" id="faq" aria-labelledby="faq-title">
      <div className="lp-wrap lp-wrap--narrow">
        <p className="lp-kicker">Questions owners ask</p>
        <h2 id="faq-title" className="lp-h2">Straight answers, before you pay.</h2>
        <div className="lp-faq">
          {LANDING_FAQ.map((item, index) => (
            <details key={item.question} className="lp-faq__item" open={index === 0}>
              <summary className="lp-faq__q">
                <span>{item.question}</span>
                <span className="lp-faq__mark" aria-hidden="true" />
              </summary>
              <p className="lp-faq__a">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const DEMO_NAMES: Record<string, string> = {
  "nyumbani-kitchen": "Nyumbani Kitchen",
  "marys-beauty-studio": "Mary's Beauty Studio",
  "kamau-auto-care": "Kamau Auto Care",
  "john-kamau-properties": "John Kamau Properties",
};

export function LandingFooter({ availableDemoSlugs }: { availableDemoSlugs: readonly string[] }) {
  const year = nairobiCalendarDay().slice(0, 4);
  const available = new Set(LANDING_DEMO_SLUGS.filter((slug) => availableDemoSlugs.includes(slug)));
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer__grid">
          <div>
            <p className="lp-footer__brand">
              <span className="lp-footer__mark">JATA</span> AFTERCALL
            </p>
            <p className="lp-footer__line">After-call business pages for Kenyan small businesses.</p>
            <p className="lp-footer__line lp-footer__line--muted">
              Payments are processed securely by Paystack. We never store your card details.
            </p>
          </div>
          <nav className="lp-footer__col" aria-label="Product">
            <p className="lp-footer__heading">Product</p>
            <a href="#product">How it works</a>
            <a href="#benefits">What you get</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <nav className="lp-footer__col" aria-label="Demo businesses">
            <p className="lp-footer__heading">Demo businesses</p>
            {LANDING_DEMO_SLUGS.filter((slug) => available.has(slug)).map((slug) => (
              <Link key={slug} href={`/b/${slug}`}>{DEMO_NAMES[slug] ?? slug}</Link>
            ))}
            {available.size === 0 ? <span>No demo page is currently available to open.</span> : null}
          </nav>
          <nav className="lp-footer__col" aria-label="Account">
            <p className="lp-footer__heading">Account</p>
            <Link href="/register">Create an account</Link>
            <Link href="/login">Log in</Link>
            <Link href="/dashboard">Dashboard</Link>
          </nav>
          <nav className="lp-footer__col" aria-label="Support and policies">
            <p className="lp-footer__heading">Support</p>
            <Link href="/products">All products</Link>
            <Link href="/pricing">Plans &amp; billing</Link>
            <Link href="/install">Install the app</Link>
            <Link href="/help">Help</Link>
            <Link href="/contact">Contact &amp; support</Link>
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms of service</Link>
          </nav>
        </div>
        <div className="lp-footer__base">
          <p>© {year} JATA AFTERCALL. All example business pages are demonstrations.</p>
          <p>Photographs on this page are illustrative and not photographs of the demo businesses.</p>
        </div>
      </div>
    </footer>
  );
}
