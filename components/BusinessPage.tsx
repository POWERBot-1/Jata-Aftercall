"use client";
import { useEffect } from "react";
import Link from "next/link";
import { normalizeKePhone, getWhatsAppUrl } from "@/lib/phone";
import { getDirectionsUrl } from "@/lib/location";
import { formatOpeningHours } from "@/lib/openingHours";
import { formatNumber } from "@/lib/dateFormat";
import { ContactActions } from "@/components/storefront/ContactActions";
import { RenderModeProbe } from "@/components/storefront/RenderModeProbe";

type Service = { id: string; title: string; description?: string | null; priceLabel?: string | null; priceFrom?: number | null };
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

export default function BusinessPage({
  business,
  services,
  offer,
  theme,
  referralHref = null,
  aiFrontDeskLive = false,
  demoPage = false,
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

  const t = theme;
  const hours = formatOpeningHours(business.openingHours);
  const whatsappCta = "bg-emerald-700 text-white hover:bg-emerald-800";

  return (
    <div className={`jata-public min-h-screen ${t.colors.bg} ${t.colors.text}`}>
      <RenderModeProbe preference="auto" />
      {/* Optional aftercall banner */}
      {business.aftercallMsg && (
        <div className={`border-b ${t.colors.border} ${t.colors.card} py-2 text-center text-sm font-medium`}>{business.aftercallMsg}</div>
      )}

      <main className="mx-auto max-w-[640px] px-4 pb-28 pt-4 sm:px-6">
        {/* Header */}
        <div className={`rounded-[1.5rem] border ${t.colors.border} ${t.colors.card} p-5 shadow-xs`}>
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${t.colors.primary} ${t.colors.primaryText} text-sm font-bold`}>
              {business.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold leading-tight">{business.name}</h1>
              <p className={`text-xs font-semibold uppercase tracking-widest ${t.colors.muted}`}>{business.category}</p>
              {business.description && <p className={`mt-2 text-sm leading-6 ${t.colors.muted}`}>{business.description}</p>}
            </div>
          </div>

          {/* Owner mandate: all four contact actions are visibly rendered with icons and labels.
              Unavailable destinations are honest, focusable states — never dead links. */}
          {!waLink && !telLinkNormalized ? (
            <p className={`mt-5 text-sm ${t.colors.muted}`}>Contact details for this business are coming soon.</p>
          ) : null}
          <div className="mt-5">
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
              skin={{
                whatsapp: whatsappCta,
                call: `${t.colors.primary} ${t.colors.primaryText}`,
                neutral: `border ${t.colors.border}`,
                muted: `text-xs ${t.colors.muted}`,
              }}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <a href="#info" className={`jata-cta inline-flex items-center justify-center rounded-2xl border ${t.colors.border} py-3 text-center text-sm font-semibold`}>
              Info
            </a>
            {quoteHref && quoteHref !== "#quote" ? (
              <a
                href={quoteHref}
                target={quoteHref.startsWith("http") ? "_blank" : undefined}
                rel={quoteHref.startsWith("http") ? "noopener noreferrer" : undefined}
                onClick={() => { if (quoteActionEvent) track(business.id, quoteActionEvent); }}
                className={`jata-cta inline-flex items-center justify-center rounded-2xl border ${t.colors.border} py-3 text-center text-sm font-semibold`}
              >
                Request quote
              </a>
            ) : (
              <a href="#quote" className={`jata-cta inline-flex items-center justify-center rounded-2xl border ${t.colors.border} py-3 text-center text-sm font-semibold`}>
                Request quote
              </a>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <a href="#services" className={`inline-flex min-h-11 items-center text-sm font-semibold underline ${t.colors.muted}`}>
              View services ↓
            </a>
            {aiFrontDeskLive && (
              <a
                href={`/b/${business.slug}/ai`}
                className={`jata-cta inline-flex min-h-11 items-center justify-center rounded-2xl border ${t.colors.border} px-4 py-2 text-xs font-semibold`}
              >
                Ask AI Front Desk →
              </a>
            )}
          </div>
        </div>

        {/* Offer */}
        {offer && offer.title && (
          <div className={`mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950`}>
            <p className="text-xs font-bold tracking-widest text-amber-700">{demoPage ? "SAMPLE OFFER · FICTIONAL, NOT CURRENT" : "TODAY'S OFFER"}</p>
            <p className="mt-1 text-base font-bold">{offer.title}</p>
            {offer.subtitle && <p className="text-sm text-amber-900/80">{offer.subtitle}</p>}
          </div>
        )}

        {/* Services */}
        <section id="services" data-motion-recipe="fade" className={`mt-4 rounded-2xl border ${t.colors.border} ${t.colors.card} p-5`}>
          <h2 className="text-sm font-bold">Services and products</h2>
          {services.length === 0 ? (
            <p className={`mt-2 text-sm ${t.colors.muted}`}>No services listed yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {services.map((s) => (
                <li key={s.id} onClick={() => track(business.id, "SERVICE_CLICK")} className={`flex items-start justify-between rounded-xl border ${t.colors.border} ${t.colors.surfaceMuted} px-3 py-3`}>
                  <div>
                    <p className="text-sm font-semibold">{s.title}</p>
                    {s.description && <p className={`text-xs ${t.colors.muted}`}>{s.description}</p>}
                  </div>
                  {(s.priceLabel || s.priceFrom) && (
                    <span className={`shrink-0 rounded-full border ${t.colors.border} ${t.colors.card} px-2.5 py-1 text-xs font-medium`}>
                      {s.priceLabel || `From KES ${formatNumber(s.priceFrom)}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* About */}
        <section id="info" data-motion-recipe="fade" className={`mt-4 rounded-2xl border ${t.colors.border} ${t.colors.card} p-5`}>
          <h2 className="text-sm font-bold">Info</h2>
          <p className={`mt-2 text-sm leading-6 ${t.colors.muted}`}>{business.description || "Welcome to " + business.name + " — serving you with quality and care."}</p>
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
        </section>

        {/* Contact */}
        <section id="quote" data-motion-recipe="fade" className={`mt-4 rounded-2xl border ${t.colors.border} ${t.colors.card} p-5`}>
          <h2 className="text-sm font-bold">Quote</h2>
          <p className={`mt-2 text-sm ${t.colors.muted}`}>Ask {business.name} for a quote. No payment is taken on this page.</p>
          {quoteHref && quoteHref !== "#quote" ? (
            <a href={quoteHref} onClick={() => { if (quoteActionEvent) track(business.id, quoteActionEvent); }} className={`jata-cta mt-3 inline-flex rounded-full px-4 py-2 text-sm font-semibold ${t.colors.primary} ${t.colors.primaryText}`}>Request quote</a>
          ) : (
            <p className={`mt-2 text-sm ${t.colors.muted}`}>Add a phone or WhatsApp number to receive quote requests.</p>
          )}
        </section>

        <section className={`mt-4 rounded-2xl border ${t.colors.border} ${t.colors.card} p-5`}>
          <h2 className="text-sm font-bold">Contact</h2>
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
        </section>

        {/* Stage 2: referral CTA for business owners visiting this public page. Self-service:
            the recipient registers themselves; no admin assistance and no extra cost. */}
        {referralHref && (
          <section className={`mt-4 rounded-2xl border ${t.colors.border} ${t.colors.card} p-5 text-center`}>
            <h2 className="text-sm font-bold">Own a business like {business.name}?</h2>
            <p className={`mt-1 text-sm leading-6 ${t.colors.muted}`}>
              Create your own page in a few minutes, then share it with your customers. You choose your own plan — nothing is shared between pages.
            </p>
            <Link
              href={referralHref}
              className={`jata-cta mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-bold sm:w-auto ${t.colors.primary} ${t.colors.primaryText}`}
            >
              Create my page
            </Link>
          </section>
        )}

        <p className={`mt-6 text-center text-xs ${t.colors.muted}`}>Powered by JATA AFTERCALL • <Link href="/" className="underline">Create your page</Link></p>
      </main>

      {/* Sticky bottom action bar — the same four actions, still >=44 px touch targets (§5). */}
      <div className={`safe-bottom fixed inset-x-0 bottom-0 border-t ${t.colors.border} ${t.colors.card} shadow-[0_-8px_24px_rgba(0,0,0,0.08)]`}>
        <div className="mx-auto max-w-[640px] px-3 py-2">
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
            skin={{
              whatsapp: whatsappCta,
              call: `${t.colors.primary} ${t.colors.primaryText}`,
              neutral: `border ${t.colors.border}`,
              muted: `text-xs ${t.colors.muted}`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
