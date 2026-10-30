import Link from "next/link";
import { LANDING_DEMO_SLUGS } from "@/lib/landing";
import { nairobiCalendarDay } from "@/lib/dateFormat";

/**
 * Shared chrome for the public marketing pages. Uses the EXISTING landing design tokens
 * (`.lp-page`, `.lp-wrap`, `.lp-section`, `.lp-h2`); no rebrand and no second frontend.
 * Every link is a real route. No invented support address or phone number is displayed.
 */

const NAV = [
  { href: "/products", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#demo", label: "Demos" },
  { href: "/faq", label: "FAQ" },
  { href: "/install", label: "Install" },
  { href: "/contact", label: "Support" },
] as const;

export function MarketingHeader({ signedIn = false }: { signedIn?: boolean } = {}) {
  return (
    <header className="mk-header">
      <div className="lp-wrap mk-header__inner">
        <Link href="/" className="mk-brand" aria-label="JATA AFTERCALL home">
          <span className="mk-brand__mark">JATA</span><span className="mk-brand__name">AFTERCALL</span>
        </Link>
        <nav className="mk-nav" aria-label="Main navigation">
          {NAV.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>
        <div className="mk-header__actions">
          {signedIn ? <Link href="/dashboard" className="mk-cta">My account</Link> : <>
            <Link href="/login" className="mk-link">Log in</Link>
            <Link href="/register" className="mk-cta">Get started</Link>
          </>}
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  const year = nairobiCalendarDay().slice(0, 4);
  return (
    <footer className="mk-footer">
      <div className="lp-wrap mk-footer__grid">
        <div>
          <p className="mk-footer__brand"><span className="mk-brand__mark">JATA</span> AFTERCALL</p>
          <p className="mk-footer__line">Business details and contact options in one mobile-friendly page for Kenyan small businesses.</p>
        </div>
        <nav aria-label="Products">
          <p className="mk-footer__heading">Products</p>
          <Link href="/products/business-page">Business Page</Link>
          <Link href="/products/ai-front-desk">AI Business Front Desk</Link>
          <Link href="/products/website-studio">Website Studio</Link>
          <Link href="/products/business-pos">Business POS</Link>
          <Link href="/pricing">Compare plans</Link>
        </nav>
        <nav aria-label="Working demos">
          <p className="mk-footer__heading">Working demos</p>
          {LANDING_DEMO_SLUGS.map((slug) => <Link key={slug} href={`/b/${slug}`}>{slug.replace(/-/g, " ")}</Link>)}
        </nav>
        <nav aria-label="Support and policies">
          <p className="mk-footer__heading">Support</p>
          <Link href="/faq">FAQ</Link>
          <Link href="/help">Help</Link>
          <Link href="/contact">Contact &amp; support</Link>
          <Link href="/install">Install the app</Link>
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms of service</Link>
        </nav>
      </div>
      <div className="lp-wrap mk-footer__base">
        <p>© {year} JATA AFTERCALL. Demo businesses are fictional; photographs are illustrative.</p>
        <p>Payments are processed by Paystack. JATA AFTERCALL does not store card details.</p>
      </div>
    </footer>
  );
}

export function MarketingLayout({
  eyebrow,
  title,
  intro,
  signedIn = false,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  signedIn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="lp-page mk-page">
      <a href="#main" className="jata-skip-link">Skip to content</a>
      <MarketingHeader signedIn={signedIn} />
      <main id="main">
        <section className="lp-section lp-section--cream mk-hero">
          <div className="lp-wrap">
            <p className="lp-kicker">{eyebrow}</p>
            <h1 className="mk-h1">{title}</h1>
            <p className="lp-lede mk-lede">{intro}</p>
          </div>
        </section>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}

export function MarketingSection({ title, children, id, tone = "paper" }: { title?: string; children: React.ReactNode; id?: string; tone?: "paper" | "cream" | "ink" }) {
  return (
    <section id={id} className={`lp-section lp-section--${tone}`} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="lp-wrap lp-wrap--narrow">
        {title ? <h2 id={id ? `${id}-title` : undefined} className="lp-h2">{title}</h2> : null}
        {children}
      </div>
    </section>
  );
}
