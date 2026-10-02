/**
 * Storefront shell (§23, §34, §43)
 *
 * Shared chrome for every page of a business's website: brand navigation, cart context,
 * the category-aware action bar and the footer. Pages supply only their own content, so
 * the experience stays coherent across home, catalogue, item and checkout (§53).
 */

import Link from "next/link";
import type { StorefrontData } from "@/lib/experience/storefront";
import { navigationFor } from "@/lib/experience/document";
import { themeRootClassName, themeStyleVars } from "@/lib/experience/themes";
import { CartProvider } from "./CartProvider";
import { ActionBar } from "./ActionBar";
import { PageViewTracker } from "./Track";

export function StorefrontShell({
  data,
  previewNotice,
  structuredData,
  children,
}: {
  data: StorefrontData;
  previewNotice?: string | null;
  structuredData?: Record<string, unknown> | null;
  children: React.ReactNode;
}) {
  const { document, theme, profile, business } = data;
  const nav = navigationFor(document);
  const commerce = profile.capabilities.includes("commerce");
  const booking = profile.capabilities.includes("booking");

  return (
    <div className={themeRootClassName(theme)} style={themeStyleVars(theme, document.brand)}>
      <PageViewTracker businessId={business.id} />
      {structuredData ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      ) : null}

      {previewNotice ? (
        <div role="status" className="eb-preview-banner" style={{
          background: "#111827", color: "#fff", padding: "0.55rem 1rem", textAlign: "center", fontSize: "0.8rem", fontWeight: 600,
        }}>
          {previewNotice}
        </div>
      ) : null}

      <a href="#main" className="eb-skip">Skip to content</a>

      <CartProvider
        slug={business.slug}
        businessId={business.id}
        cartNoun={profile.cta.cart}
        checkoutHref={`/b/${business.slug}/checkout`}
        canCheckout={commerce}
      >
        <header className="eb-nav">
          <div className="eb-container eb-nav__inner">
            <Link href={`/b/${business.slug}`} className="eb-nav__brand">
              {document.brand.logoUrl || business.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={(document.brand.logoUrl || business.logoUrl) as string} alt="" className="eb-nav__logo" />
              ) : (
                <span className="eb-nav__fallback" aria-hidden="true">{business.name.slice(0, 2).toUpperCase()}</span>
              )}
              <span className="eb-nav__name">{document.brand.businessName || business.name}</span>
            </Link>
            {nav.length > 0 ? (
              <nav className="eb-nav__links" aria-label="Sections">
                {nav.slice(0, 6).map((entry) => (
                  <a key={entry.id} href={`/b/${business.slug}${entry.href}`} className="eb-nav__link">
                    {entry.label}
                  </a>
                ))}
              </nav>
            ) : null}
            <div className="eb-nav__cta">
              <Link href={commerce ? `/b/${business.slug}/shop` : booking ? `/b/${business.slug}/book` : `#contact`} className="eb-btn eb-btn--sm">
                {profile.cta.primary}
              </Link>
            </div>
          </div>
        </header>

        <main id="main">{children}</main>

        <footer className="eb-footer">
          <div className="eb-container eb-footer__grid">
            <div>
              <p style={{ fontFamily: "var(--eb-font-display)", fontSize: "1.15rem", fontWeight: 600, margin: 0 }}>
                {document.brand.businessName || business.name}
              </p>
              {document.brand.tagline ? <p style={{ opacity: 0.8 }}>{document.brand.tagline}</p> : null}
              {document.settings.location ? <p style={{ opacity: 0.8 }}>{document.settings.location}</p> : null}
              {nav.length > 0 ? (
                <nav aria-label="Footer" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "1rem", fontSize: "0.9rem" }}>
                  {nav.slice(0, 6).map((entry) => (
                    <a key={entry.id} href={`/b/${business.slug}${entry.href}`}>{entry.label}</a>
                  ))}
                </nav>
              ) : null}
            </div>
            <div style={{ fontSize: "0.9rem" }}>
              {document.settings.phone ? (
                <p style={{ margin: "0 0 0.35rem" }}><a href={`tel:${document.settings.phone.replace(/\s/g, "")}`}>{document.settings.phone}</a></p>
              ) : null}
              {document.settings.email ? (
                <p style={{ margin: "0 0 0.35rem" }}><a href={`mailto:${document.settings.email}`}>{document.settings.email}</a></p>
              ) : null}
              {document.settings.whatsapp ? <p style={{ opacity: 0.8 }}>WhatsApp {document.settings.whatsapp}</p> : null}
            </div>
          </div>
          <div className="eb-container eb-footer__note">
            © {new Date().getFullYear()} {business.name}. Powered by JATA AFTERCALL.
          </div>
        </footer>

        <ActionBar
          businessId={business.id}
          slug={business.slug}
          shopHref={`/b/${business.slug}/shop`}
          bookHref={`/b/${business.slug}/book`}
          whatsapp={document.settings.whatsapp || null}
          phone={document.settings.phone || null}
          location={document.settings.location || null}
          lat={document.settings.lat}
          lng={document.settings.lng}
          primaryLabel={profile.cta.primary}
          showCart={commerce}
        />
      </CartProvider>
    </div>
  );
}
