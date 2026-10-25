import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";

/**
 * Landing navigation — sticky, responsive, and functional without JavaScript.
 *
 * The phone layout uses a native `<details>` disclosure for the menu, so navigation works before
 * hydration, with scripts blocked, and if any animation fails. Every link is a real anchor to a
 * section of this page, or the existing `/login` and `/register` flows — no new routes, and the
 * authenticated state still shows Dashboard / Admin / Logout exactly as before.
 *
 * Header contract (see `.lp-nav` in globals.css): the wordmark and its tagline own the left of the
 * bar, the account controls own the right, and the two never share a row on a phone — below 420 px
 * the account links live in the menu panel, and below 640 px the tagline drops to its own line under
 * the wordmark. Nothing here is hidden to fix a collision: the wordmark, the tagline and the menu
 * control are all rendered at every width.
 */
const SECTIONS = [
  { href: "#product", label: "Product" },
  { href: "#benefits", label: "Benefits" },
  { href: "#demo", label: "Demos" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
] as const;

export function Navbar({ session }: { session?: { email: string; role: string } | null }) {
  const authLinks = session ? (
    <>
      <Button href="/dashboard" variant="secondary" size="sm">Dashboard</Button>
      {session.role === "ADMIN" ? <Button href="/admin" variant="secondary" size="sm">Admin</Button> : null}
      <form action="/api/auth/logout" method="post" className="lp-nav__logout">
        <button className="jata-btn jata-btn-ghost jata-btn-sm">Logout</button>
      </form>
    </>
  ) : (
    <>
      <Link href="/login" className="jata-nav-link lp-nav__login">Log in</Link>
      <Button href="/register" size="sm">Get started</Button>
    </>
  );

  return (
    <nav className="jata-nav lp-nav" aria-label="Main">
      <div className="lp-nav__inner">
        <BrandMark tagline />
        <div className="lp-nav__links">
          {SECTIONS.map((section) => (
            <a key={section.href} href={section.href} className="jata-nav-link lp-nav__link">
              {section.label}
            </a>
          ))}
        </div>
        <div className="lp-nav__actions">{authLinks}</div>
        <details className="lp-nav__compact">
          <summary aria-label="Open menu">
            <span className="lp-nav__burger" aria-hidden="true" />
            <span className="lp-nav__compact-label">Menu</span>
          </summary>
          <div className="lp-nav__panel">
            {SECTIONS.map((section) => (
              <a key={section.href} href={section.href} className="lp-nav__panel-link">
                {section.label}
              </a>
            ))}
            {session ? (
              <>
                <Link href="/dashboard" className="lp-nav__panel-link">Dashboard</Link>
                {session.role === "ADMIN" ? <Link href="/admin" className="lp-nav__panel-link">Admin</Link> : null}
                <form action="/api/auth/logout" method="post">
                  <button className="lp-nav__panel-link lp-nav__panel-button">Logout</button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" className="lp-nav__panel-link">Log in</Link>
                <Link href="/register" className="lp-nav__panel-link lp-nav__panel-cta">Get started</Link>
              </>
            )}
          </div>
        </details>
      </div>
    </nav>
  );
}
