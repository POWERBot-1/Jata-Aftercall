"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Clock, Gift, ShieldCheck, Sparkles, Store } from "lucide-react";
import { normalizeKePhone, getWhatsAppUrl } from "@/lib/phone";
import { getDirectionsUrl } from "@/lib/location";
import { formatOpeningHours } from "@/lib/openingHours";
import { formatNumber } from "@/lib/dateFormat";
import { ContactActions } from "@/components/storefront/ContactActions";
import { RenderModeProbe } from "@/components/storefront/RenderModeProbe";
import { StoreHero, type HeroImage } from "@/components/storefront/public/StoreHero";
import { StoreSection } from "@/components/storefront/public/StoreSection";
import { StoreFooter } from "@/components/storefront/public/StoreFooter";
import { OrderRequestPanel, type OrderRequestProduct } from "@/components/business-hub/OrderRequestPanel";
import { PromotionSpotlight } from "@/components/business-hub/PromotionSpotlight";
import { LoyaltyCardPanel } from "@/components/business-hub/LoyaltyCardPanel";
import { LoyaltyRewardsSection } from "@/components/business-hub/LoyaltyRewardsSection";
import { EnquiryPanel } from "@/components/business-hub/EnquiryPanel";
import { QrIdentityBlock } from "@/components/business-hub/QrIdentityBlock";
import type { PromotionView } from "@/lib/business-hub/promotions";
import type { PublicLoyaltyRewards } from "@/lib/business-hub/loyaltyPoints";

type Service = { id: string; title: string; description?: string | null; priceLabel?: string | null; priceFrom?: number | null; imageUrl?: string | null };
type Offer = { title: string; subtitle?: string | null } | null;

type Business = {
  id: string;
  slug: string;
  name: string;
  category: string;
  phone?: string | null;
  whatsapp?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  description?: string | null;
  theme: string;
  aftercallMsg?: string | null;
  openingHours?: string | null;
  socialLinks?: string | null;
  /** The business's own logo, when it has uploaded one. Falls back to the monogram. */
  logoUrl?: string | null;
};

type ThemeTokens = {
  colors: { bg: string; card: string; text: string; muted: string; primary: string; primaryText: string; accent: string; border: string; surfaceMuted: string };
  radius: string;
};

function track(businessId: string, eventType: string) {
  fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId, eventType, source: typeof window !== "undefined" ? window.location.href : undefined }),
  }).catch(() => {});
}

/** The contact-action skins for a graphite canvas (touch targets stay at 44px). */
const HERO_SKIN = {
  whatsapp: "st-action st-action--whatsapp",
  call: "st-action st-action--call",
  neutral: "st-action st-action--neutral",
  muted: "st-actions__status",
};

export default function BusinessPage({
  business,
  services,
  offer,
  theme,
  referralHref = null,
  aiFrontDeskLive = false,
  demoPage = false,
  products = [],
  promotions = [],
  loyaltyEnabled = false,
  pointsEnabled = false,
  loyaltyRewards = null,
  enquiryEnabled = true,
  hero = null,
  artLabel = "Local business",
}: {
  business: Business;
  services: Service[];
  offer: Offer;
  theme: ThemeTokens;
  /** Stage 2: owner referral CTA. Path only — never a code, id, or other tenant data. */
  referralHref?: string | null;
  /**
   * True only when this business has a live, entitled AI Business Front Desk. The link is never
   * offered otherwise: /b/<slug>/ai answers 404 for a business without the paid package, so a
   * customer tapping it would land on "Page not found".
   */
  aiFrontDeskLive?: boolean;
  /** Whether this page contains only fictional demonstration content. */
  demoPage?: boolean;
  /** Catalogue shown in the Instant Order Request basket (server-priced, active rows only). */
  products?: OrderRequestProduct[];
  /** Live promotions only — an expired promotion is never passed to this component. */
  promotions?: PromotionView[];
  /** True once the owner has enabled their loyalty programme in the dashboard. */
  loyaltyEnabled?: boolean;
  /** True only when the independent points programme is active for this business. */
  pointsEnabled?: boolean;
  /** The Loyalty Rewards state from the server; the section is rendered in every state. */
  loyaltyRewards?: PublicLoyaltyRewards | null;
  /** The enquiry form is on by default; it is hidden only where the owner turned it off. */
  enquiryEnabled?: boolean;
  /** The hero image, when the business (or its verified demo fixture) has one. Never invented. */
  hero?: HeroImage | null;
  /** Art-direction label for the business's category. */
  artLabel?: string;
}) {
  useEffect(() => {
    track(business.id, "PAGE_VIEW");
  }, [business.id]);

  // Kenyan normalization: 07XXXXXXXX / 01XXXXXXXX -> 254XXXXXXXXX
  const waInquiryText = `Hi ${business.name}, I found your page and would like to know more.`;
  const quoteText = `Hi ${business.name}, I would like a quote.`;

  const normalizedWa = normalizeKePhone(business.whatsapp);
  const waLink = normalizedWa ? getWhatsAppUrl(normalizedWa, waInquiryText) : null;
  const waQuoteLink = normalizedWa ? getWhatsAppUrl(normalizedWa, quoteText) : null;

  // tel: link — keep original but fallback to normalized if valid
  const telLink = business.phone ? `tel:${business.phone}` : null;
  const normalizedPhone = normalizeKePhone(business.phone);
  const telLinkNormalized = normalizedPhone ? `tel:+${normalizedPhone}` : telLink;

  const mapsLink = getDirectionsUrl(business.location, business.lat, business.lng);

  // Request Quote fallback: WhatsApp -> tel: -> #quote
  const quoteHref = waQuoteLink || telLinkNormalized || "#quote";
  const quoteActionEvent = waQuoteLink ? "WHATSAPP_CLICK" : telLinkNormalized ? "CALL_CLICK" : null;

  // The Loyalty Rewards section is part of the page in every state. `loyaltyRewards` is the
  // server's verdict; when a caller passes only the legacy boolean, that boolean is the state.
  const rewards: PublicLoyaltyRewards =
    loyaltyRewards ??
    { status: pointsEnabled ? "active" : "inactive", earning: null, redemption: null, rewards: [] };

  const t = theme;
  const hours = formatOpeningHours(business.openingHours);

  const activeServices = services;

  return (
    <div className={`jata-public st-root min-h-screen ${t.colors.bg} ${t.colors.text}`} data-store-root="business-page">
      <RenderModeProbe preference="auto" />
      {/* Optional aftercall banner */}
      {business.aftercallMsg && (
        <div className={`border-b ${t.colors.border} ${t.colors.card} py-2 text-center text-sm font-medium`}>{business.aftercallMsg}</div>
      )}

      <main className="mx-auto flex max-w-[720px] flex-col gap-3 px-3 pb-28 pt-3 sm:px-6 sm:pt-5">
        {/* ── the hero: identity, imagery and the actions that matter, in one frame ─────────────── */}
        <StoreHero
          name={business.name}
          category={business.category}
          location={business.location}
          description={business.description}
          logoUrl={business.logoUrl}
          image={hero}
          artLabel={artLabel}
        >
          {!waLink && !telLinkNormalized ? (
            <p className={`text-sm ${t.colors.muted}`}>Contact details for this business are coming soon.</p>
          ) : null}
          <div className="mt-1">
            <ContactActions
              business={{
                slug: business.slug,
                name: business.name,
                category: business.category,
                whatsapp: business.whatsapp,
                phone: business.phone,
                location: business.location,
                lat: business.lat,
                lng: business.lng,
              }}
              businessId={business.id}
              variant="primary"
              group="primary"
              onShare={() => track(business.id, "SHARE_CLICK")}
              skin={HERO_SKIN}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href="#services"
              className={`jata-cta inline-flex min-h-11 items-center rounded-full border ${t.colors.border} px-4 py-2 text-sm font-semibold`}
            >
              View services ↓
            </a>
            <a
              href="#info"
              className={`jata-cta inline-flex min-h-11 items-center rounded-full border ${t.colors.border} px-4 py-2 text-sm font-semibold`}
            >
              Info
            </a>
            {quoteHref && quoteHref !== "#quote" ? (
              <a
                href={quoteHref}
                target={quoteHref.startsWith("http") ? "_blank" : undefined}
                rel={quoteHref.startsWith("http") ? "noopener noreferrer" : undefined}
                onClick={() => { if (quoteActionEvent) track(business.id, quoteActionEvent); }}
                className={`jata-cta inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold ${t.colors.primary} ${t.colors.primaryText}`}
              >
                Request quote
              </a>
            ) : (
              <a href="#quote" className={`jata-cta inline-flex min-h-11 items-center rounded-full border ${t.colors.border} px-4 py-2 text-sm font-semibold`}>
                Request quote
              </a>
            )}
            {aiFrontDeskLive && (
              <a
                href={`/b/${business.slug}/ai`}
                className={`jata-cta inline-flex min-h-11 items-center justify-center rounded-full border ${t.colors.border} px-4 py-2 text-xs font-semibold`}
              >
                Ask AI Front Desk →
              </a>
            )}
          </div>
        </StoreHero>

        {/* Offer */}
        {offer && offer.title && (
          <div className={`rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950`}>
            <p className="text-xs font-bold tracking-widest text-amber-700">{demoPage ? "SAMPLE OFFER · FICTIONAL, NOT CURRENT" : "TODAY'S OFFER"}</p>
            <p className="mt-1 text-base font-bold">{offer.title}</p>
            {offer.subtitle && <p className="text-sm text-amber-900/80">{offer.subtitle}</p>}
          </div>
        )}

        {/* Promotional Spotlight (Business Hub §C) — live promotions only. Expired rows are
            filtered out server-side, so an expired offer is absent from the HTML rather than
            merely hidden by a client-side rule. */}
        <div>
          <PromotionSpotlight promotions={promotions} slug={business.slug} demoPage={demoPage} />
        </div>

        {/* Loyalty Rewards (Loyalty 2.0) — placed with the page's headline content so a customer
            meets it without scrolling past everything else. Rendered in every state: an inactive
            or unreadable programme is announced here, never silently removed. It is independent
            of the stamp card, which keeps its own section further down. */}
        <LoyaltyRewardsSection businessName={business.name} businessSlug={business.slug} rewards={rewards} />

        {/* Services */}
        <StoreSection
          id="services"
          data-motion-recipe="fade"
          eyebrow={(
            <>
              <Store size={13} aria-hidden="true" /> What they offer
            </>
          )}
          title="Services and products"
          lede={activeServices.length === 0 ? "No services listed yet." : undefined}
        >
          {activeServices.length > 0 ? (
            <ul className="grid gap-2">
              {activeServices.map((s) => (
                <li key={s.id} onClick={() => track(business.id, "SERVICE_CLICK")} className={`flex items-start justify-between gap-3 rounded-2xl border ${t.colors.border} ${t.colors.surfaceMuted} px-3 py-3`}>
                  <div className="flex min-w-0 items-start gap-3">
                    {s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.imageUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-xl object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{s.title}</p>
                      {s.description && <p className={`text-xs ${t.colors.muted}`}>{s.description}</p>}
                    </div>
                  </div>
                  {(s.priceLabel || s.priceFrom) && (
                    <span className={`shrink-0 rounded-full border ${t.colors.border} ${t.colors.card} px-2.5 py-1 text-xs font-medium`}>
                      {s.priceLabel || `From KES ${formatNumber(s.priceFrom)}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </StoreSection>

        {/* Featured catalogue products — the same rows the order basket is priced from. The page
            already lists the business's services above, so they are not repeated here. */}
        {products.some((product) => product.kind !== "SERVICE") ? (
          <StoreSection
            eyebrow={(
              <>
                <Gift size={13} aria-hidden="true" /> Straight from the shelf
              </>
            )}
            title="Featured products"
          >
            <ul className="grid grid-cols-2 gap-3">
              {products.filter((product) => product.kind !== "SERVICE").slice(0, 6).map((product) => (
                <li key={product.id} className={`overflow-hidden rounded-xl border ${t.colors.border} ${t.colors.surfaceMuted}`}>
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.imageUrl} alt="" className="h-24 w-full object-cover" loading="lazy" decoding="async" />
                  ) : null}
                  <div className="p-2">
                    <p className="truncate text-xs font-semibold">{product.name}</p>
                    <p className="mt-0.5 text-xs font-bold">
                      {product.priceKES === null ? (
                        <span className={t.colors.muted}>Price on request</span>
                      ) : (
                        <>
                          KES {formatNumber(product.priceKES)}
                          {product.wasPriceKES ? (
                            <span className={`ml-1 font-normal line-through ${t.colors.muted}`}>KES {formatNumber(product.wasPriceKES)}</span>
                          ) : null}
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </StoreSection>
        ) : null}

        {/* Instant order requests (Business Hub §A) — everything the page offers, catalogue
            products and the page's own services alike. */}
        {products.length > 0 ? (
          <div>
            <OrderRequestPanel slug={business.slug} businessName={business.name} products={products} />
          </div>
        ) : null}

        {/* A recorded customer enquiry (Business Hub §B) */}
        {enquiryEnabled ? (
          <div>
            <EnquiryPanel slug={business.slug} businessName={business.name} />
          </div>
        ) : null}

        {/* Digital loyalty card (Business Hub §D) — shown once the owner enables their programme */}
        {loyaltyEnabled ? (
          <div>
            <LoyaltyCardPanel businessName={business.name} />
          </div>
        ) : null}

        {/* About */}
        <StoreSection
          id="info"
          data-motion-recipe="fade"
          eyebrow={(
            <>
              <ShieldCheck size={13} aria-hidden="true" /> About
            </>
          )}
          title={`About ${business.name}`}
        >
          <p className={`text-sm leading-6 ${t.colors.muted}`}>{business.description || "Welcome to " + business.name + " — serving you with quality and care."}</p>
          {business.location && (
            <div className="mt-4">
              <h3 className="text-xs font-bold tracking-widest">LOCATION</h3>
              <p className={`mt-1 text-sm ${t.colors.muted}`}>{business.location}</p>
              {mapsLink && (
                <a href={mapsLink} target="_blank" rel="noopener noreferrer" onClick={() => track(business.id, "DIRECTIONS_CLICK")} className={`jata-cta mt-2 inline-flex items-center rounded-full border ${t.colors.border} px-4 py-2 text-sm font-semibold`}>
                  Open in Maps
                </a>
              )}
            </div>
          )}
        </StoreSection>

        {/* Quote */}
        <StoreSection id="quote" data-motion-recipe="fade" title="Quote">
          <p className={`mt-2 text-sm ${t.colors.muted}`}>Ask {business.name} for a quote. No payment is taken on this page.</p>
          {quoteHref && quoteHref !== "#quote" ? (
            <a href={quoteHref} onClick={() => { if (quoteActionEvent) track(business.id, quoteActionEvent); }} className={`jata-cta mt-3 inline-flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-semibold ${t.colors.primary} ${t.colors.primaryText}`}>Request quote</a>
          ) : (
            <p className={`mt-2 text-sm ${t.colors.muted}`}>Add a phone or WhatsApp number to receive quote requests.</p>
          )}
        </StoreSection>

        <StoreSection
          eyebrow={(
            <>
              <Clock size={13} aria-hidden="true" /> Reach them
            </>
          )}
          title="Contact"
        >
          <div className={`mt-2 space-y-1 text-sm ${t.colors.muted}`}>
            {business.phone && (
              <p>
                Phone:{" "}
                <a href={telLinkNormalized || undefined} className="font-semibold underline" onClick={() => track(business.id, "CALL_CLICK")}>
                  {business.phone}
                </a>
              </p>
            )}
            {business.whatsapp && (
              <p>
                WhatsApp:{" "}
                {waLink ? (
                  <a href={waLink} target="_blank" rel="noopener noreferrer" className="font-semibold underline" onClick={() => track(business.id, "WHATSAPP_CLICK")}>
                    {business.whatsapp}
                  </a>
                ) : (
                  <span className="font-semibold">{business.whatsapp}</span>
                )}
              </p>
            )}
          </div>
          {hours.length > 0 && (
            <div className={`mt-3 text-sm ${t.colors.muted}`}>
              <h3 className={`text-xs font-bold tracking-widest ${t.colors.text}`}>OPENING HOURS</h3>
              <dl className="mt-1 space-y-0.5">
                {hours.map((row, i) => (
                  <div key={`${row.label}-${i}`} className="flex flex-wrap gap-x-2">
                    <dt className={row.label ? "font-semibold" : "sr-only"}>{row.label || "Hours"}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {business.socialLinks && (
            <div className="mt-3 flex gap-2 text-xs">
              {(() => {
                try {
                  const links = JSON.parse(business.socialLinks || "{}");
                  return Object.entries(links)
                    .filter(([, v]) => !!v)
                    .map(([k, v]) => (
                      <a key={k} href={String(v)} target="_blank" rel="noopener noreferrer" className={`jata-cta inline-flex items-center rounded-full border ${t.colors.border} px-3 py-1 text-sm font-medium capitalize`}>
                        {k}
                      </a>
                    ));
                } catch {
                  return null;
                }
              })()}
            </div>
          )}
        </StoreSection>

        {/* Stage 2: referral CTA for business owners visiting this public page. Self-service:
            the recipient registers themselves; no admin assistance and no extra cost. */}
        {referralHref && (
          <StoreSection
            eyebrow={(
              <>
                <Sparkles size={13} aria-hidden="true" /> For business owners
              </>
            )}
            title={`Own a business like ${business.name}?`}
          >
            <p className={`mt-1 text-sm leading-6 ${t.colors.muted}`}>
              Create your own page in a few minutes, then share it with your customers. You choose your own plan — nothing is shared between pages.
            </p>
            <Link
              href={referralHref}
              className={`jata-cta mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-bold sm:w-auto ${t.colors.primary} ${t.colors.primaryText}`}
            >
              Create my page
            </Link>
          </StoreSection>
        )}

        {/* Business QR identity (Business Hub §E) — always the canonical public page URL, derived
            from the slug, so editing the profile can never repoint a code that is already printed. */}
        <div>
          <QrIdentityBlock slug={business.slug} businessName={business.name} />
        </div>

        <StoreFooter referralHref={referralHref} />
      </main>

      {/* Sticky bottom action bar — the same four actions, still >=44 px touch targets (§5). */}
      <div className={`safe-bottom fixed inset-x-0 bottom-0 border-t ${t.colors.border} ${t.colors.card} shadow-[0_-8px_24px_rgba(0,0,0,0.45)]`}>
        <div className="mx-auto max-w-[720px] px-3 py-2">
          <ContactActions
            business={{
              slug: business.slug,
              name: business.name,
              category: business.category,
              whatsapp: business.whatsapp,
              phone: business.phone,
              location: business.location,
              lat: business.lat,
              lng: business.lng,
            }}
            businessId={business.id}
            variant="sticky"
            group="sticky"
            onShare={() => track(business.id, "SHARE_CLICK")}
            skin={HERO_SKIN}
          />
        </div>
      </div>
    </div>
  );
}
