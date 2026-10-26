import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";

/**
 * Shown when a business slug does not resolve to a published, active page.
 *
 * Uses the shared tokens/buttons (not a raw zinc palette) so the screen stays on-brand and
 * adapts to the active theme, and it always offers a real way back instead of dead-ending.
 */
export default function NotFound() {
  return (
    <div className="jata-page">
      <a href="#main" className="jata-skip-link">
        Skip to content
      </a>
      <nav className="jata-nav" aria-label="Main">
        <div className="mx-auto flex w-full max-w-6xl items-center px-4 py-3">
          <BrandMark compact />
        </div>
      </nav>
      <main id="main" className="jata-narrow" style={{ textAlign: "center" }}>
        <p className="jata-kicker" style={{ justifyContent: "center" }}>
          Error 404
        </p>
        <h1 className="jata-title">This business page isn&apos;t available</h1>
        <p className="jata-subtitle">
          It may not be published yet, or the link may be incorrect. If the owner gave you this link, let them know it
          did not open.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/" className="jata-btn jata-btn-primary">
            Go to home
          </Link>
          <Link href="/#demo" className="jata-btn jata-btn-secondary">
            Explore example pages
          </Link>
        </div>
      </main>
    </div>
  );
}
