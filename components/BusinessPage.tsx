"use client";
import { useEffect } from "react";

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
  description?: string | null;
  theme: string;
  aftercallMsg?: string | null;
  openingHours?: string | null;
  socialLinks?: string | null;
};

type ThemeTokens = {
  colors: { bg: string; card: string; text: string; muted: string; primary: string; primaryText: string; accent: string; border: string };
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
}: {
  business: Business;
  services: Service[];
  offer: Offer;
  theme: ThemeTokens;
}) {
  useEffect(() => {
    track(business.id, "PAGE_VIEW");
  }, [business.id]);

  const waLink = business.whatsapp
    ? `https://wa.me/${business.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${business.name}, I found your page and would like to know more.`)}`
    : null;
  const telLink = business.phone ? `tel:${business.phone}` : null;
  const mapsLink = business.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.location)}`
    : business.phone
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.name + " " + (business.location || ""))}`
      : null;
  const quoteText = `Hi ${business.name}, I would like a quote.`;
  const quoteHref = business.whatsapp
    ? `https://wa.me/${business.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(quoteText)}`
    : telLink;

  const t = theme;

  return (
    <div className={`jata-public min-h-screen ${t.colors.bg} ${t.colors.text}`}>
      {/* Optional aftercall banner */}
      {business.aftercallMsg && (
        <div className={`border-b ${t.colors.border} ${t.colors.card} py-2 text-center text-sm font-medium`}>{business.aftercallMsg}</div>
      )}

      <main className="mx-auto max-w-[640px] px-4 pb-28 pt-4 sm:px-6">
        {/* Header */}
        <div className={`rounded-[1.5rem] border ${t.colors.border} ${t.colors.card} p-5 shadow-sm`}>
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

          {/* Primary CTAs above the fold */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            {waLink ? (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track(business.id, "WHATSAPP_CLICK")}
                className="jata-cta inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-4 py-4 text-sm font-bold text-white shadow-sm hover:bg-emerald-600"
              >
                WhatsApp
              </a>
            ) : (
              <span className={`inline-flex items-center justify-center rounded-2xl border ${t.colors.border} px-4 py-4 text-sm font-semibold opacity-50`}>WhatsApp</span>
            )}
            {telLink ? (
              <a
                href={telLink}
                onClick={() => track(business.id, "CALL_CLICK")}
                className={`jata-cta inline-flex items-center justify-center rounded-2xl px-4 py-4 text-sm font-bold ${t.colors.primary} ${t.colors.primaryText} shadow-sm`}
              >
                Call
              </a>
            ) : (
              <span className={`inline-flex items-center justify-center rounded-2xl border ${t.colors.border} px-4 py-4 text-sm font-semibold opacity-50`}>Call</span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            {mapsLink ? (
              <a
                href={mapsLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track(business.id, "DIRECTION_CLICK")}
                className={`jata-cta rounded-2xl border ${t.colors.border} py-3 text-center text-sm font-semibold hover:opacity-80`}
              >
                Get Directions
              </a>
            ) : (
              <span className={`rounded-2xl border ${t.colors.border} py-3 text-center text-sm opacity-50`}>Directions</span>
            )}
            <button
              onClick={() => {
                track(business.id, "SHARE_CLICK");
                if (navigator.share) {
                  navigator.share({ title: business.name, url: window.location.href }).catch(() => {});
                } else {
                  navigator.clipboard.writeText(window.location.href);
                  alert("Link copied!");
                }
              }}
              className={`jata-cta rounded-2xl border ${t.colors.border} py-3 text-center text-sm font-semibold`}
            >
              Share
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <a href="#info" className={`jata-cta rounded-2xl border ${t.colors.border} py-3 text-center text-sm font-semibold`}>
              Info
            </a>
            {quoteHref ? (
              <a
                href={quoteHref}
                target={quoteHref.startsWith("http") ? "_blank" : undefined}
                rel={quoteHref.startsWith("http") ? "noopener noreferrer" : undefined}
                onClick={() => track(business.id, "WHATSAPP_CLICK")}
                className={`jata-cta rounded-2xl border ${t.colors.border} py-3 text-center text-sm font-semibold`}
              >
                Request quote
              </a>
            ) : (
              <a href="#quote" className={`jata-cta rounded-2xl border ${t.colors.border} py-3 text-center text-sm font-semibold`}>
                Request quote
              </a>
            )}
          </div>

          <div className="mt-3">
            <a href="#services" className={`text-xs font-semibold underline ${t.colors.muted}`}>
              View services ↓
            </a>
          </div>
        </div>

        {/* Offer */}
        {offer && offer.title && (
          <div className={`mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950`}>
            <p className="text-xs font-bold tracking-widest text-amber-700">TODAY&apos;S OFFER</p>
            <p className="mt-1 text-base font-bold">{offer.title}</p>
            {offer.subtitle && <p className="text-sm text-amber-900/80">{offer.subtitle}</p>}
          </div>
        )}

        {/* Services */}
        <section id="services" className={`mt-4 rounded-2xl border ${t.colors.border} ${t.colors.card} p-5`}>
          <h2 className="text-sm font-bold">Services and products</h2>
          {services.length === 0 ? (
            <p className={`mt-2 text-sm ${t.colors.muted}`}>No services listed yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {services.map((s) => (
                <li key={s.id} onClick={() => track(business.id, "SERVICE_CLICK")} className={`flex items-start justify-between rounded-xl border ${t.colors.border} bg-zinc-50/50 px-3 py-3`}>
                  <div>
                    <p className="text-sm font-semibold">{s.title}</p>
                    {s.description && <p className={`text-xs ${t.colors.muted}`}>{s.description}</p>}
                  </div>
                  {(s.priceLabel || s.priceFrom) && (
                    <span className={`shrink-0 rounded-full border ${t.colors.border} bg-white px-2.5 py-1 text-xs font-medium`}>
                      {s.priceLabel || `From KES ${s.priceFrom?.toLocaleString()}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* About */}
        <section id="info" className={`mt-4 rounded-2xl border ${t.colors.border} ${t.colors.card} p-5`}>
          <h2 className="text-sm font-bold">Info</h2>
          <p className={`mt-2 text-sm leading-6 ${t.colors.muted}`}>{business.description || "Welcome to " + business.name + " — serving you with quality and care."}</p>
          {business.location && (
            <div className="mt-4">
              <h3 className="text-xs font-bold tracking-widest">LOCATION</h3>
              <p className={`mt-1 text-sm ${t.colors.muted}`}>{business.location}</p>
              {mapsLink && (
                <a href={mapsLink} target="_blank" rel="noopener noreferrer" onClick={() => track(business.id, "DIRECTION_CLICK")} className="mt-2 inline-flex rounded-full border px-4 py-2 text-xs font-semibold">
                  Open in Maps
                </a>
              )}
            </div>
          )}
        </section>

        {/* Contact */}
        <section id="quote" className={`mt-4 rounded-2xl border ${t.colors.border} ${t.colors.card} p-5`}>
          <h2 className="text-sm font-bold">Quote</h2>
          <p className={`mt-2 text-sm ${t.colors.muted}`}>Ask {business.name} for a quote. No payment is taken on this page.</p>
          {quoteHref ? (
            <a href={quoteHref} className={`jata-cta mt-3 inline-flex rounded-full px-4 py-2 text-sm font-semibold ${t.colors.primary} ${t.colors.primaryText}`}>Request quote</a>
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
                <a href={telLink || undefined} className="font-semibold underline" onClick={() => track(business.id, "CALL_CLICK")}>
                  {business.phone}
                </a>
              </p>
            )}
            {business.whatsapp && (
              <p>
                WhatsApp:{" "}
                <a href={waLink || undefined} target="_blank" rel="noopener noreferrer" className="font-semibold underline" onClick={() => track(business.id, "WHATSAPP_CLICK")}>
                  {business.whatsapp}
                </a>
              </p>
            )}
            {business.openingHours && <p>Hours: {(() => { try { return JSON.stringify(JSON.parse(business.openingHours)); } catch { return business.openingHours; } })()}</p>}
          </div>
          {business.socialLinks && (
            <div className="mt-3 flex gap-2 text-xs">
              {(() => {
                try {
                  const links = JSON.parse(business.socialLinks || "{}");
                  return Object.entries(links)
                    .filter(([, v]) => !!v)
                    .map(([k, v]) => (
                      <a key={k} href={String(v)} target="_blank" rel="noopener noreferrer" className="rounded-full border px-3 py-1 font-medium capitalize">
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

        <p className={`mt-6 text-center text-xs ${t.colors.muted}`}>Powered by JATA AFTERCALL • <a href="/" className="underline">Create your page</a></p>
      </main>

      {/* Sticky bottom action bar — large touch targets (§5) */}
      <div className={`safe-bottom fixed inset-x-0 bottom-0 border-t ${t.colors.border} ${t.colors.card} shadow-[0_-8px_24px_rgba(0,0,0,0.08)]`}>
        <div className="mx-auto flex max-w-[640px] gap-2 px-3 py-3">
          {waLink ? (
            <a href={waLink} target="_blank" rel="noopener noreferrer" onClick={() => track(business.id, "WHATSAPP_CLICK")} className="flex flex-1 items-center justify-center rounded-full bg-emerald-500 py-3.5 text-sm font-bold text-white">
              WhatsApp
            </a>
          ) : (
            <span className="flex flex-1 items-center justify-center rounded-full border py-3.5 text-sm font-semibold opacity-50">WhatsApp</span>
          )}
          {telLink ? (
            <a href={telLink} onClick={() => track(business.id, "CALL_CLICK")} className={`flex flex-1 items-center justify-center rounded-full py-3.5 text-sm font-bold ${t.colors.primary} ${t.colors.primaryText}`}>
              Call
            </a>
          ) : null}
          {mapsLink && (
            <a href={mapsLink} target="_blank" rel="noopener noreferrer" onClick={() => track(business.id, "DIRECTION_CLICK")} className="flex items-center justify-center rounded-full border px-5 py-3.5 text-sm font-semibold">
              Directions
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
