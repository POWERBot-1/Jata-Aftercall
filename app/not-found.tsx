import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark } from "@/components/ui/BrandMark";

// A 404 must stay out of the search index: `robots` renders the noindex/nofollow meta that the
// cross-tenant browser contract (and good SEO for a not-found page) relies on.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/**
 * Root 404.
 *
 * Before this file existed an unknown URL fell through to Next.js's unstyled default 404 — a
 * dead end that did not look like the product and offered no way back. This screen answers the
 * three journey questions plainly: where am I (a 404), what next (use one of the actions), and
 * what happens (each action is a real, safe route). It is a server component built only from
 * shared tokens and the real sign-in / pricing / home routes, so it works without JavaScript.
 */
export default function NotFound() {
  return (
    <div className="jata-page">
      <a href="#main" className="jata-skip-link">
        Skip to content
      </a>
      <nav className="jata-nav" aria-label="Main">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <BrandMark compact />
          <Link href="/login" className="jata-nav-link">
            Log in
          </Link>
        </div>
      </nav>
      <main id="main" className="jata-narrow" style={{ textAlign: "center" }}>
        <p className="jata-kicker" style={{ justifyContent: "center" }}>
          Error 404
        </p>
        <h1 className="jata-title">That page could not be found.</h1>
        <p className="jata-subtitle">
          The link may be broken or the page may have moved, or you may have followed a link to someone else&apos;s
          workspace. Nothing has changed on your account, and no payment or data was affected.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/" className="jata-btn jata-btn-primary">
            Go to home
          </Link>
          <Link href="/login" className="jata-btn jata-btn-secondary">
            Sign in to your workspace
          </Link>
          <Link href="/#pricing" className="jata-btn jata-btn-ghost">
            See pricing
          </Link>
        </div>
        <p className="mt-6 text-sm" style={{ color: "var(--jata-muted)" }}>
          If you followed a link from a business, the page may be unpublished.{" "}
          <Link href="/" className="font-semibold underline">
            Return home
          </Link>{" "}
          and try again.
        </p>
      </main>
    </div>
  );
}
