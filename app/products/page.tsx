import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { FALLBACK_PLANS, homepagePlanCards, planDisplayName, type HomepagePlanCard } from "@/lib/pricing";
import { formatNumber } from "@/lib/format";
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

  return (
    <MarketingLayout
      eyebrow="Products"
      title="One account. Every plan and product. One place to pay."
      intro="JATA AFTERCALL keeps your business details, conversations and sales tools on the same Next.js application and the same database. Prices below come from the live plan catalogue; showing a card never activates a product."
    >
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
