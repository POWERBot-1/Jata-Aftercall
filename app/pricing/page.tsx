import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { FALLBACK_PLANS, getMjengoOsPlan, homepagePlanCards, planDisplayName, type HomepagePlanCard } from "@/lib/pricing";
import { AI_FRONT_DESK_VOICE_KEY, FRONT_DESK_TIER_KEYS } from "@/lib/frontDeskTiers";
import { getVoiceReadiness } from "@/lib/telnyx/voice-readiness";
import { displayTierPricing, frontDeskFamilyCard } from "@/lib/productCatalogue";
import { formatNumber } from "@/lib/format";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";
import { mjengoCheckoutRefusal } from "@/lib/mjengo/settlement";
import { MJENGO_PLAN_PRICE_KES, MJENGO_PLAN_DURATION_DAYS } from "@/lib/mjengo/entitlement";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Pricing and subscriptions — JATA AFTERCALL", description: "Transparent JATA AFTERCALL plan prices, payment, renewal, cancellation and refund information." };
export const dynamic = "force-dynamic";

const PLAN_SCOPE: Record<string, string> = {
  MONTHLY: "Public Business Page · per business",
  ANNUAL: "Public Business Page · per business",
  AI_BUSINESS_FRONT_DESK: "AI Front Desk Starter · per business",
  AI_FRONT_DESK_STANDARD: "AI Front Desk Standard · per business",
  AI_FRONT_DESK_PRO: "AI Front Desk Pro · per business",
  AI_FRONT_DESK_VOICE: "AI Front Desk Voice · per business",
  INTERACTIVE_BUSINESS: "Website Studio · per business",
  BUSINESS_POS: "Owner-only POS · per business",
  ERP_PRO: "JATA BOS PRO · per business",
  JATA_AUTOPILOT: "Owner-only Autopilot · per business",
  MJENGO_OS: "MJENGO OS · per business",
};

/**
 * How the backend treats each offer. Ordinary subscriptions are bought through the shared
 * business-page checkout; the separate products are bought inside their own workspaces and are
 * never payable choices on the ordinary plan lists.
 */
const PLAN_KIND: Record<string, string> = {
  MONTHLY: "Subscription · pay from your dashboard",
  ANNUAL: "Subscription · pay from your dashboard",
  AI_BUSINESS_FRONT_DESK: "Subscription · pay from your dashboard",
  AI_FRONT_DESK_STANDARD: "Subscription · pay from your dashboard",
  AI_FRONT_DESK_PRO: "Subscription · pay from your dashboard",
  AI_FRONT_DESK_VOICE: "Subscription · pay from your dashboard",
  INTERACTIVE_BUSINESS: "Subscription · pay from your dashboard",
  BUSINESS_POS: "Separate product · purchased in the Business POS workspace",
  ERP_PRO: "Separate product · purchased in the ERP workspace",
  JATA_AUTOPILOT: "Separate product · purchased in the Autopilot workspace",
  MJENGO_OS: "Separate product · purchased in the MJENGO OS workspace",
};

const PLAN_DESCRIPTIONS: Record<string, string> = {
  MONTHLY: "Your public business page at /b/your-business with WhatsApp, Call, Directions and Share actions, services, prices, an offer and opening hours.",
  ANNUAL: "The same public business page paid once for a full year — 365 days of access with the same dashboard and the same Paystack confirmation.",
  AI_BUSINESS_FRONT_DESK: "Front Desk Starter — an AI front desk on your business page that answers customer questions from your own services and offer, and records the questions it could not answer.",
  AI_FRONT_DESK_STANDARD: "Front Desk Standard — the same AI front desk for your business page, on the Standard package tier. The amount is charged from the stored plan catalogue on the server.",
  AI_FRONT_DESK_PRO: "Front Desk Pro — the same AI front desk for your business page, on the Pro package tier. The amount is charged from the stored plan catalogue on the server.",
  AI_FRONT_DESK_VOICE: "Front Desk Voice — the same AI front desk for your business page, on the top Voice package tier. The amount is charged from the stored plan catalogue on the server.",
  INTERACTIVE_BUSINESS: "Website Studio: build, edit and preview a full business website with a priced catalogue, stock, bookings, orders and checkout on your own page.",
  BUSINESS_POS: "An owner-only point of sale — sales, stock, credit and reports — configured around how your business actually works. Separate from your page plan.",
  ERP_PRO: "JATA BOS PRO — Business Operating System Pro: accounting, invoicing, inventory, purchasing and business operations with supported messaging tools. Broader than the separate Business POS till, which covers counter sales only.",
  JATA_AUTOPILOT: "A supervised assistant that checks your business health and drafts offer and FAQ actions for your approval. The preview is free; live actions switch on after payment is confirmed.",
  MJENGO_OS: "MJENGO OS — Business Management: sales, inventory, procurement, customers, credit, accounting and reports — a separate workspace with its own plan and entitlement, distinct from Business POS and JATA BOS PRO.",
};

const PLAN_ROUTE: Record<string, string> = {
  MONTHLY: "/products/business-page",
  ANNUAL: "/products/business-page",
  AI_BUSINESS_FRONT_DESK: "/products/ai-front-desk",
  AI_FRONT_DESK_STANDARD: "/products/ai-front-desk",
  AI_FRONT_DESK_PRO: "/products/ai-front-desk",
  AI_FRONT_DESK_VOICE: "/products/ai-front-desk",
  INTERACTIVE_BUSINESS: "/products/website-studio",
  BUSINESS_POS: "/products/business-pos",
  ERP_PRO: "/products/erp-pro",
  JATA_AUTOPILOT: "/products/jata-autopilot",
  MJENGO_OS: "/products/mjengo-os",
};

export default async function PricingPage() {
  let stored: HomepagePlanCard[] = [];
  try {
    stored = await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } });
  } catch {
    stored = [];
  }
  const plans = homepagePlanCards(stored.length > 0 ? stored : FALLBACK_PLANS);

  // Every approved package, including Standard, Pro and Voice: the seven marketing cards
  // above are the owner-order grid, and the family block below always renders all four
  // AI Front Desk tiers at their approved prices with honest catalogue/provider
  // availability — even when a stored PlanConfig row is missing or Voice is gated.
  // Presentation only; nothing here changes checkout, entitlement or Paystack guards.
  const voiceReadiness = getVoiceReadiness();
  const session = await getSession();
  const frontDeskFamily = FRONT_DESK_TIER_KEYS.map((key) =>
    frontDeskFamilyCard(key, stored, voiceReadiness.canSell),
  );
  const mjengoPlan = await getMjengoOsPlan().catch(() => null);
  const mjengoRefusal = mjengoCheckoutRefusal(mjengoPlan);
  const mjengoPlanValid = Boolean(mjengoPlan && mjengoPlan.key === "MJENGO_OS" && Number(mjengoPlan.priceKES) === MJENGO_PLAN_PRICE_KES && Number(mjengoPlan.durationDays) === MJENGO_PLAN_DURATION_DAYS);
  const mjengoTerms = mjengoPlanValid && mjengoPlan ? `${formatNumber(Number(mjengoPlan.priceKES))} / ${mjengoPlan.durationDays} days` : "Pricing currently unavailable";

  return (
    <MarketingLayout
      eyebrow="Pricing"
      title="Clear prices. Fixed access periods. No hidden debit."
      intro="Every price on this page is read from the same PlanConfig catalogue that checkout uses. All amounts are in Kenyan shillings (KES). Showing a plan here does not activate it — a plan starts only after the server verifies payment, or when an account holds a verified JATA Team Free Access entitlement."
    >
      <MarketingSection title="Every plan and product" id="comparison">
        {/* Stacked cards, not a wide table: the full catalogue must be scannable at 320px with no
            horizontal scrolling. Each card is one offer in the marketing order from the single
            catalogue helper, so this page can never drift from the homepage grid. */}
        <div className="mk-grid">
          {/* Tier cards display the approved tier price so this grid and the family block
              below can never disagree; every other card keeps its stored price. */}
          {plans.map((raw) => {
            const plan = displayTierPricing(raw);
            return (
            <article key={plan.key} className="mk-card" data-plan={plan.key} aria-label={planDisplayName(plan)}>
              <h3>{planDisplayName(plan)}</h3>
              <p className="mk-card__price">
                KES {formatNumber(plan.priceKES)} {plan.durationDays === 365 ? "per year" : `per ${plan.durationDays} days`}
              </p>
              <p className="mk-card__scope">{PLAN_SCOPE[plan.key] || "Per business"}</p>
              <p className="mk-card__kind">{PLAN_KIND[plan.key] || "Subscription · pay from your dashboard"}</p>
              <p>{PLAN_DESCRIPTIONS[plan.key] || ""}</p>
              <Link href={PLAN_ROUTE[plan.key] || "/products"}>What is included →</Link>
            </article>
            );
          })}
        </div>
        <div className="mk-prose">
          <p>
            <strong>Showing an offer never activates it.</strong> Every offer above is billed per business. Ordinary
            subscriptions are paid through the business-page checkout on this site; the separate products — Business POS,
            JATA BOS PRO and JATA Autopilot — are purchased inside their own workspaces and are never payable choices on
            the ordinary plan lists. Access switches on only after the server verifies the payment.
          </p>
          <p>
            <strong>JATA BOS PRO exclusions.</strong> The advertised price excludes SMS and WhatsApp usage charges, Sender
            ID registration or network fees, payment-provider transaction fees, and KRA eTIMS certification or integrator
            fees. KRA eTIMS submission is not claimed as certified or operational, and no hardware integrations are
            promised.
          </p>
        </div>
        <div className="mk-btn-row">
          <Link href="/register" className="mk-btn">Create an account</Link>
          <Link href="/dashboard/subscription" className="mk-btn mk-btn--ghost">Plans in my dashboard</Link>
        </div>
      </MarketingSection>

      <MarketingSection title="AI Front Desk 2.0 — all four packages" id="ai-front-desk">
        <p className="mk-prose">
          One AI front desk, four package levels. Prices shown are the approved package prices.
          A package is purchasable only when its matching active catalogue record and service
          readiness checks are present — until every one of those conditions is satisfied the
          card says so plainly. These cards are informational and do not start checkout.
        </p>
        <div className="mk-grid">
          {frontDeskFamily.map((tier) => (
            <article key={tier.key} className="mk-card" data-tier={tier.key}>
              <h3>{tier.name}</h3>
              <p className="mk-card__price">KES {formatNumber(tier.priceKES)} / 30 days</p>
              <p className="mk-card__scope">AI Front Desk tier · per business</p>
              <p className="mk-card__kind">
                {tier.available
                  ? PLAN_KIND[tier.key] || "Subscription · pay from your dashboard"
                  : "Not yet for sale — listed at the approved price; checkout stays fail-closed until its catalogue and readiness gates pass"}
              </p>
              <p>{PLAN_DESCRIPTIONS[tier.key] || ""}</p>
              <p><strong>{tier.status}</strong></p>
              <Link
                href={
                  tier.key === AI_FRONT_DESK_VOICE_KEY
                    ? "/products/ai-front-desk#voice"
                    : PLAN_ROUTE[tier.key] || "/products/ai-front-desk"
                }
              >
                {tier.key === AI_FRONT_DESK_VOICE_KEY ? "View Voice readiness →" : "What is included →"}
              </Link>
            </article>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection title="MJENGO OS — business management" id="mjengo-os" tone="cream">
        <div className="mk-grid">
          <article className="mk-card" data-product="MJENGO_OS">
            <h3>MJENGO OS</h3>
            <p className="mk-card__price">{mjengoTerms === "Pricing currently unavailable" ? mjengoTerms : `KES ${mjengoTerms}`}</p>
            <p>MJENGO OS is a separate business-management workspace with its own plan key, subscription checks and workspace routes. It covers sales, inventory, procurement, customers, credit, accounting and reports — with its own entitlement, independent from Business POS and JATA BOS PRO.</p>
            <p className="mk-card__kind">Separate product · per business · verified MJENGO OS entitlement required</p>
            <p><strong>{mjengoRefusal ? "Not currently available for purchase" : "Plan configured — checkout remains subject to server-side business and payment verification"}</strong></p>
            {mjengoRefusal ? <p className="mk-prose">{mjengoRefusal}</p> : null}
            <Link href="/products/mjengo-os">Explore MJENGO OS →</Link>
            <div className="mk-btn-row">
              <Link href={session ? "/dashboard/subscription" : "/login"} className="mk-btn">Get MJENGO OS</Link>
            </div>
          </article>
        </div>
      </MarketingSection>

      <MarketingSection title="Payment, renewal and cancellation" id="billing" tone="cream">
        <div className="mk-prose">
          <h3>How you pay</h3>
          <p>Plans are paid through the existing Paystack checkout, using M-Pesa or a card. JATA AFTERCALL does not receive or store your card details. The server verifies the transaction with Paystack and its signed webhook before a subscription or publication right is activated — a browser redirect alone is never proof of payment.</p>
          <h3>What you are buying</h3>
          <p>Each plan is a prepaid fixed period of access for one business: 30 days for monthly products, 365 days for the annual page plan. The Business POS, JATA BOS PRO and JATA Autopilot are separate owner-only products with their own plan keys and activation flows; they are not included in a page plan.</p>
          <h3>Renewal</h3>
          <p>The current checkout makes a one-off payment. There is no saved-card automatic debit in this flow. When a period ends your page and content are kept, but paid features and publishing pause until you renew from your dashboard. You will see the expiry and status on the subscription screen.</p>
          <h3>Cancellation</h3>
          <p>You can stop at the end of any paid period by not renewing. Unpublishing a page is always available from your dashboard. Historical payment records and receipts remain visible; hiding a page does not delete your data.</p>
          <h3>Refunds</h3>
          <p>There is no self-service in-app refund button. If a payment was taken in error, or a duplicate charge occurred, contact support from the account that made the payment with the payment reference; each case is reviewed against the server-verified payment record. Nothing on this page promises a refund without a review.</p>
          <h3>Team access</h3>
          <p>Verified JATA Team members receive eligible features without a payment transaction. No payment, invoice, subscription or receipt record is created for that entitlement. Ordinary customer billing remains exactly as described above.</p>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
