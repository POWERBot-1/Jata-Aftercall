import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { FALLBACK_PLANS, homepagePlanCards, planDisplayName, type HomepagePlanCard } from "@/lib/pricing";
import { formatNumber } from "@/lib/format";
import { FRONT_DESK_TIER_PRICING, FRONT_DESK_TIER_KEYS, AI_FRONT_DESK_VOICE_KEY } from "@/lib/frontDeskTiers";
import { getVoiceReadiness } from "@/lib/telnyx/voice-readiness";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

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

export default async function ProductsPage() {
  let stored: HomepagePlanCard[] = [];
  try {
    stored = await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } });
  } catch {
    stored = [];
  }
  const plans = homepagePlanCards(stored.length > 0 ? stored : FALLBACK_PLANS);
  const voiceReadiness = getVoiceReadiness();
  // Show the complete, owner-approved Front Desk 2.0 package family even before the
  // commercial PlanConfig rows are installed. A package is labelled catalogue-active only
  // when its real active row matches the approved price and term; these cards never create
  // checkout links or grant entitlements.
  const frontDeskTiers = FRONT_DESK_TIER_KEYS.map((key) => {
    const approved = FRONT_DESK_TIER_PRICING[key];
    const row = stored.find((plan) => plan.key === key);
    const catalogueMatch = Boolean(
      row && row.priceKES === approved.priceKES && row.durationDays === approved.durationDays,
    );
    const providerReady = key !== AI_FRONT_DESK_VOICE_KEY || voiceReadiness.canSell;
    return {
      ...approved,
      catalogueMatch,
      available: catalogueMatch && providerReady,
      status: key === AI_FRONT_DESK_VOICE_KEY
        ? providerReady ? "Provider and commercial gates verified" : "Awaiting provider activation — not for sale"
        : catalogueMatch ? "Active in the server catalogue" : "Awaiting catalogue activation — not for sale",
    };
  });

  return (
    <MarketingLayout
      eyebrow="Products"
      title="One account. Every plan and product. One place to pay."
      intro="JATA AFTERCALL keeps your business details, conversations and sales tools on the same Next.js application and the same database. Prices below come from the live plan catalogue; showing a card never activates a product."
    >
      <MarketingSection title="AI Front Desk 2.0 — all four packages" id="ai-front-desk-tiers">
        <p className="mk-prose">
          One AI front desk, four package levels. Prices shown are the approved package prices.
          A package is purchasable only when its matching active catalogue record and service
          readiness checks are present. These cards are informational and do not start checkout.
        </p>
        <div className="mk-grid">
          {frontDeskTiers.map((tier) => (
            <article className="mk-card" key={tier.key} data-tier={tier.key}>
              <h3>{tier.name}</h3>
              <p className="mk-card__price">KES {formatNumber(tier.priceKES)} / 30 days</p>
              <p>{tier.key === "AI_BUSINESS_FRONT_DESK"
                ? "The essential AI receptionist for customer questions grounded in your business information."
                : tier.key === "AI_FRONT_DESK_STANDARD"
                  ? "A higher package level for businesses that need more from their AI front desk."
                  : tier.key === "AI_FRONT_DESK_PRO"
                    ? "The advanced AI front desk package for businesses with more demanding customer workflows."
                    : "A premium phone receptionist for inbound calls, with English and Kiswahili voice handling and human handoff."}</p>
              <p><strong>{tier.status}</strong></p>
              <p className="mk-prose">
                {tier.available
                  ? "Catalogue and required readiness checks are satisfied. Access still requires a verified business entitlement."
                  : "This package is visible for transparency but cannot be purchased or activated until its catalogue and readiness gates are satisfied."}
              </p>
              <Link href="/products/ai-front-desk">View AI Front Desk details →</Link>
            </article>
          ))}
        </div>
      </MarketingSection>
      <MarketingSection title="What you can switch on" id="catalogue">
        <div className="mk-grid">
          {plans.map((plan) => {
            const detail = PRODUCT_DETAIL[plan.key];
            if (!detail) return null;
            return (
              <article key={plan.key} className="mk-card">
                <h3>{planDisplayName(plan)}</h3>
                <p className="mk-card__price">KES {formatNumber(plan.priceKES)} / {plan.durationDays === 365 ? "year" : `${plan.durationDays} days`}</p>
                <p>{detail.blurb}</p>
                <ul className="mk-prose">
                  {detail.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
                <Link href={`/products/${detail.slug}`}>See how it works →</Link>
              </article>
            );
          })}
          <article className="mk-card" key="AI_FRONT_DESK_VOICE">
            <h3>AI Front Desk Voice</h3>
            <p className="mk-card__price">KES {formatNumber(FRONT_DESK_TIER_PRICING[AI_FRONT_DESK_VOICE_KEY].priceKES)} / 30 days</p>
            <p>A premium AI phone receptionist designed to answer calls to your existing business number, understand customer requests and hand over to your team when needed.</p>
            <ul className="mk-prose">
              <li>Designed around your existing business phone identity</li>
              <li>English and Kiswahili voice experience planned</li>
              <li>Provider usage charges will be disclosed separately before activation</li>
            </ul>
            <p><strong>Awaiting provider activation.</strong> Not yet available for purchase or live calls.</p>
            <Link href="/products/ai-front-desk#voice">View Voice readiness →</Link>
          </article>
        </div>
        <div className="mk-btn-row">
          <Link href="/pricing" className="mk-btn">Compare all plans</Link>
          <Link href="/#demo" className="mk-btn mk-btn--ghost">Open a working demo</Link>
        </div>
      </MarketingSection>

      <MarketingSection title="How the products fit together" tone="cream" id="together">
        <div className="mk-prose">
          <p>Your Business Page is the public link you share with customers. AI Business Front Desk, Website Studio, Business POS and JATA Autopilot are additional products that attach to the same business and account. Each one keeps its own plan key, price and entitlement check; paying for one never silently switches on another.</p>
          <p>Publishing a page or website is gated by a server-verified payment (or a verified JATA Team Free Access entitlement). A browser redirect from Paystack is never treated as proof of payment — the server verifies the transaction and the webhook settles it.</p>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
