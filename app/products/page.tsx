import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { homepagePlanCards, planDisplayName, type HomepagePlanCard } from "@/lib/pricing";
import { formatNumber } from "@/lib/format";
import { FRONT_DESK_TIER_PRICING, FRONT_DESK_TIER_KEYS, AI_FRONT_DESK_VOICE_KEY } from "@/lib/frontDeskTiers";
import { getVoiceReadiness } from "@/lib/telnyx/voice-readiness";
import {
  buildMarketingCatalogue,
  catalogueCardStatus,
  frontDeskTierStatus,
  isPriceMatchedRow,
  priceMatchedGridKeys,
  VOICE_SELLING_CONDITIONS,
} from "@/lib/productCatalogue";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";
import { getMjengoOsPlan } from "@/lib/pricing";
import { mjengoCheckoutRefusal } from "@/lib/mjengo/settlement";

export const metadata: Metadata = { title: "Products — JATA AFTERCALL" };
export const dynamic = "force-dynamic";

/** Product copy is derived from the same plan catalogue the checkout uses. No invented tiers. */
const PRODUCT_DETAIL: Record<string, { slug: string; blurb: string; bullets: string[] }> = {
  MONTHLY: {
    slug: "business-page",
    blurb: "A single mobile-first link for the moment after a customer contacts you.",
    bullets: ["Public /b/your-business page", "WhatsApp, Call, Directions and Share actions", "Services, prices, offer and opening hours"],
  },
  ANNUAL: {
    slug: "business-page",
    blurb: "The same business page paid once for a full year.",
    bullets: ["Everything in the monthly page plan", "365 days of access", "Same Paystack confirmation before publishing"],
  },
  AI_BUSINESS_FRONT_DESK: {
    slug: "ai-front-desk",
    blurb: "A published AI assistant that answers customer questions from your own business information.",
    bullets: ["Customer-facing /b/<slug>/ai page", "Grounded in your configured products, services and FAQs", "Live only after the plan is confirmed"],
  },
  // AI Front Desk 2.0 tiers — same product, four package tiers. Each row must exist or the card
  // would be dropped from this grid (`if (!detail) return null`), hiding a catalogue offer.
  AI_FRONT_DESK_STANDARD: {
    slug: "ai-front-desk",
    blurb: "The AI front desk on the Front Desk Standard package tier.",
    bullets: ["Everything in Front Desk Starter", "Customer-facing /b/<slug>/ai page", "Live only after the plan is confirmed"],
  },
  AI_FRONT_DESK_PRO: {
    slug: "ai-front-desk",
    blurb: "The AI front desk on the Front Desk Pro package tier.",
    bullets: ["Everything in Front Desk Starter", "Customer-facing /b/<slug>/ai page", "Live only after the plan is confirmed"],
  },
  JATA_AUTOPILOT: {
    slug: "jata-autopilot",
    blurb: "Business-health diagnostics and draft actions for your approval, configured in the workspace.",
    bullets: ["Preview diagnostics without a plan", "Live actions require the standard Autopilot package", "Priced and activated inside the dashboard"],
  },
  // Approved workspace-only Autopilot tiers. The blurb is copied verbatim from
  // `AUTOPILOT_PLAN_CATALOG` (lib/autopilot/entitlement.ts); a unit test pins the parity so
  // the two can never drift. Sales happen only inside the authenticated Autopilot workspace —
  // these cards never link to a public checkout.
  JATA_AUTOPILOT_PRO: {
    slug: "jata-autopilot",
    blurb: "Higher AI reasoning & multimodal document quotas, supervised/advanced playbooks, and consented follow-up workflows — 30 days.",
    bullets: ["Everything in the standard JATA Autopilot package", "Offered only inside the authenticated JATA Autopilot workspace", "Preview in your dashboard is free before you pay"],
  },
  JATA_AUTOPILOT_ENTERPRISE: {
    slug: "jata-autopilot",
    blurb: "Multi-branch executive operations, expanded multimodal & voice allowances, and dedicated governance controls — 30 days.",
    bullets: ["Everything in the standard JATA Autopilot package", "Offered only inside the authenticated JATA Autopilot workspace", "Preview in your dashboard is free before you pay"],
  },
  INTERACTIVE_BUSINESS: {
    slug: "website-studio",
    blurb: "A fuller, category-aware website built and previewed in the Website Studio canvas.",
    bullets: ["Sections, catalogue and bookings based on your business type", "Draft preview before publication", "Publication requires a confirmed entitlement"],
  },
  BUSINESS_POS: {
    slug: "business-pos",
    blurb: "An owner-only point of sale configured around how your business actually works.",
    bullets: ["Products, inventory, sales and receipts", "Staff roles and branch scoping", "Sold per business from the dashboard"],
  },
  ERP_PRO: {
    slug: "erp-pro",
    blurb: "JATA BOS PRO — Business Operating System Pro: the books, the stock and the buying behind the counter.",
    bullets: ["Accounting, invoicing, inventory and purchasing", "Broader than the separate Business POS till", "Priced per business; switched on from the ERP workspace after payment"],
  },
};

/**
 * Who each approved Front Desk 2.0 package serves — drawn from the approved tier copy in
 * PLAN_INCLUDES / the tier pricing names, never from an invented capability.
 */
const TIER_SERVES: Record<string, string> = {
  AI_BUSINESS_FRONT_DESK: "For any business publishing an AI assistant on its own page — answers grounded in your configured products, services and FAQs.",
  AI_FRONT_DESK_STANDARD: "For busy businesses that need more from their front desk — everything in Starter, on the higher Standard package tier.",
  AI_FRONT_DESK_PRO: "For multi-product businesses with demanding customer workflows — everything in Starter, on the advanced Pro package tier.",
  AI_FRONT_DESK_VOICE: "For businesses that want their existing phone number answered — a premium receptionist with English and Kiswahili handling and handoff to your team.",
};

const TIER_DETAIL_HREF: Record<string, string> = {
  AI_FRONT_DESK_VOICE: "/products/ai-front-desk#voice",
};

export default async function ProductsPage() {
  let stored: HomepagePlanCard[] = [];
  try {
    stored = await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } });
  } catch {
    stored = [];
  }
  // Approved catalogue constants fill every hole; stored rows (when readable) win their own
  // slots. A missing PlanConfig row changes a card's availability label — never its visibility.
  const plans = buildMarketingCatalogue(stored, homepagePlanCards);
  // Only a price-matched row counts as catalogue-present: a stored row whose price/term
  // drift from the approved constants would be rejected by checkout, so it must not read
  // as "in the server catalogue" (or display its amount) on the public grid either.
  const storedKeys = priceMatchedGridKeys(stored, homepagePlanCards);
  const voiceReadiness = getVoiceReadiness();

  // The complete, owner-approved Front Desk 2.0 package family, shown even before the
  // Standard/Pro/Voice PlanConfig rows are installed. A package reads catalogue-active only
  // when its real active row matches the approved price and term; these cards never create
  // checkout links or grant entitlements.
  const mjengoPlan = await getMjengoOsPlan().catch(() => null);
  const mjengoRefusal = mjengoCheckoutRefusal(mjengoPlan);

  const frontDeskTiers = FRONT_DESK_TIER_KEYS.map((key) => {
    const approved = FRONT_DESK_TIER_PRICING[key];
    const catalogueMatch = isPriceMatchedRow(stored.find((plan) => plan.key === key), key);
    const available = catalogueMatch && (key !== AI_FRONT_DESK_VOICE_KEY || voiceReadiness.canSell);
    return {
      ...approved,
      available,
      status: frontDeskTierStatus({ key, catalogueMatch, voiceCanSell: voiceReadiness.canSell }),
    };
  });

  return (
    <MarketingLayout
      eyebrow="Products"
      title="One account. Every plan and product. One place to pay."
      intro="JATA AFTERCALL keeps your business details, conversations and sales tools in one workspace. Every approved package below stays visible even before its server catalogue row is installed — an informational card never activates a product or starts checkout, and only real catalogue and readiness conditions mark a package as available."
    >
      <MarketingSection title="AI Front Desk 2.0 — all four packages" id="ai-front-desk-tiers">
        <p className="mk-prose">
          One AI front desk, four package levels. Prices shown are the approved package prices.
          A package is purchasable only when its matching active catalogue record and service
          readiness checks are present — until every one of those conditions is satisfied the
          card is labelled &ldquo;not for sale&rdquo;. These cards are informational and do not
          start checkout.
        </p>
        <div className="mk-grid">
          {frontDeskTiers.map((tier) => (
            <article className="mk-card" key={tier.key} data-tier={tier.key}>
              <h3>{tier.name}</h3>
              <p className="mk-card__price">KES {formatNumber(tier.priceKES)} / 30 days</p>
              <p>{TIER_SERVES[tier.key]}</p>
              {tier.key === AI_FRONT_DESK_VOICE_KEY ? (
                <ul className="mk-prose">
                  <li>Designed around your existing business phone identity</li>
                  <li>English and Kiswahili voice experience planned</li>
                  <li>Provider usage charges will be disclosed separately before activation</li>
                </ul>
              ) : null}
              <p><strong>{tier.status}</strong></p>
              {tier.key === AI_FRONT_DESK_VOICE_KEY && !voiceReadiness.canSell ? (
                <div className="mk-prose">
                  <p>Pending before Front Desk Voice can be sold or take live calls:</p>
                  <ul>
                    {VOICE_SELLING_CONDITIONS.map((condition) => <li key={condition}>{condition}</li>)}
                  </ul>
                </div>
              ) : null}
              <p className="mk-prose">
                {tier.available
                  ? "Catalogue and required readiness checks are satisfied. Access still requires a verified business entitlement."
                  : "This package is visible for transparency but cannot be purchased or activated until its catalogue and readiness gates are satisfied."}
              </p>
              <Link href={TIER_DETAIL_HREF[tier.key] ?? "/products/ai-front-desk"}>
                {tier.key === AI_FRONT_DESK_VOICE_KEY ? "View Voice readiness →" : "View AI Front Desk details →"}
              </Link>
            </article>
          ))}
        </div>
      </MarketingSection>
      <MarketingSection title="MJENGO OS — Business management" id="mjengo-os">
        <div className="mk-grid">
          <article className="mk-card" data-product="MJENGO_OS">
            <h3>MJENGO OS</h3>
            <p className="mk-card__price">KES 2,000 / 30 days</p>
            <p>A dedicated business-management workspace for sales and orders, inventory, procurement, customers and credit, accounting, and operational reports.</p>
            <p><strong>{mjengoRefusal ? "Not currently available for purchase" : "Plan configured — access requires a verified MJENGO OS entitlement"}</strong></p>
            {mjengoRefusal ? <p className="mk-prose">{mjengoRefusal}</p> : null}
            <Link href="/products/mjengo-os">Explore MJENGO OS →</Link>
          </article>
        </div>
      </MarketingSection>
      <MarketingSection title="What you can switch on" id="catalogue">
        <div className="mk-grid">
          {plans.map((plan) => {
            const detail = PRODUCT_DETAIL[plan.key];
            if (!detail) return null;
            const status = catalogueCardStatus({
              key: plan.key,
              hasStoredRow: storedKeys.has(plan.key),
              voiceCanSell: voiceReadiness.canSell,
            });
            return (
              <article key={plan.key} className="mk-card">
                <h3>{planDisplayName(plan)}</h3>
                <p className="mk-card__price">KES {formatNumber(plan.priceKES)} / {plan.durationDays === 365 ? "year" : `${plan.durationDays} days`}</p>
                <p>{detail.blurb}</p>
                <ul className="mk-prose">
                  {detail.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
                <p><strong>{status}</strong></p>
                <Link href={`/products/${detail.slug}`}>See how it works →</Link>
              </article>
            );
          })}
        </div>
        <div className="mk-btn-row">
          <Link href="/pricing" className="mk-btn">Compare all plans</Link>
          <Link href="/#demo" className="mk-btn mk-btn--ghost">Open a working demo</Link>
        </div>
      </MarketingSection>

      <MarketingSection title="How the products fit together" tone="cream" id="together">
        <div className="mk-prose">
          <p>Your Business Page is the public link you share with your customers. AI Business Front Desk, Website Studio, Business POS, JATA BOS PRO and JATA Autopilot are additional products that attach to the same business and account. Each one keeps its own plan key, price and entitlement check; paying for one never silently switches on another.</p>
          <p>Publishing a page or website is gated by a server-verified payment (or a verified JATA Team Free Access entitlement). A browser redirect from Paystack is never treated as proof of payment — the server verifies the transaction and the webhook settles it.</p>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
