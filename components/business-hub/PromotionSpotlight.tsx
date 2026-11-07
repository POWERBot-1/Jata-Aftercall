/**
 * Promotional Spotlight — the customer-facing band (Business Hub C).
 *
 * Rendered on the server from the live promotions list, so an expired promotion is absent from
 * the HTML itself rather than hidden with CSS or JavaScript: there is no state in which an
 * expired offer is present but invisible.
 *
 * A call to action is only rendered for a promotion whose CTA target exists. "Order now" deep
 * links into the order-request basket; WhatsApp and call use the numbers the owner configured.
 */

import { formatBusinessDateTime } from "@/lib/sale-pricing";
import { normalizeKePhone, getWhatsAppUrl } from "@/lib/phone";
import type { PromotionView } from "@/lib/business-hub/promotions";

function ctaHref(promotion: PromotionView, slug: string): { href: string; external: boolean } | null {
  if (promotion.ctaKind === "ORDER_REQUEST") return { href: `#order`, external: false };
  if (promotion.ctaKind === "WHATSAPP") {
    const digits = normalizeKePhone(promotion.ctaValue);
    if (!digits) return null;
    return { href: getWhatsAppUrl(digits, `Hi! I saw your promotion: ${promotion.title}`), external: true };
  }
  if (promotion.ctaKind === "CALL") {
    const digits = normalizeKePhone(promotion.ctaValue);
    if (!digits) return null;
    return { href: `tel:+${digits}`, external: false };
  }
  void slug;
  return null;
}

export function PromotionSpotlight({
  promotions,
  slug,
  demoPage = false,
}: {
  promotions: PromotionView[];
  slug: string;
  /** Fictional demo pages label their sample promotions clearly. */
  demoPage?: boolean;
}) {
  // Two independent guarantees that an expired offer is never presented as live: the server only
  // ever loads live rows, and this component drops anything that is not. A caller that forgets to
  // filter cannot put an expired promotion in front of a customer.
  const live = promotions.filter((promotion) => promotion.isLive !== false && promotion.state !== "EXPIRED");
  if (live.length === 0) return null;

  return (
    <section id="promotions" aria-labelledby="promotions-title" className="jata-card">
      <h2 id="promotions-title" className="jata-section-title">
        Offers right now
      </h2>
      <ul className="mt-3 space-y-3">
        {live.map((promotion) => {
          const cta = ctaHref(promotion, slug);
          return (
            <li
              key={promotion.id}
              className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50"
              data-promotion-state={promotion.state}
            >
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                {promotion.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={promotion.imageUrl}
                    alt=""
                    className="h-24 w-full shrink-0 rounded-xl object-cover sm:h-20 sm:w-28"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    {promotion.badge ? (
                      <span className="rounded-full bg-amber-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-50">
                        {promotion.badge}
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold uppercase tracking-widest text-amber-800">Offer</span>
                    )}
                    <span className="text-[11px] font-semibold text-amber-900/80">{promotion.windowLabel}</span>
                  </p>
                  <h3 className="mt-1 text-base font-bold text-amber-950">{promotion.title}</h3>
                  {promotion.subtitle ? <p className="text-sm text-amber-900/90">{promotion.subtitle}</p> : null}
                  {promotion.body ? <p className="mt-1 text-sm text-amber-900/80">{promotion.body}</p> : null}
                  {promotion.discountLabel ? (
                    <p className="mt-1 inline-block rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-bold text-amber-900">
                      {promotion.discountLabel}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[11px] text-amber-900/70">
                    Ends {formatBusinessDateTime(new Date(promotion.endsAt))} (Nairobi time)
                    {demoPage ? " · fictional sample promotion" : ""}
                  </p>
                </div>
                {cta ? (
                  <a
                    href={cta.href}
                    {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="jata-btn jata-btn-primary shrink-0"
                  >
                    {promotion.ctaLabel || (promotion.ctaKind === "ORDER_REQUEST" ? "Order now" : promotion.ctaKind === "CALL" ? "Call now" : "Chat on WhatsApp")}
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default PromotionSpotlight;
