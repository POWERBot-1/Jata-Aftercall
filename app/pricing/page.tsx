import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { FALLBACK_PLANS, homepagePlanCards, planDisplayName, type HomepagePlanCard } from "@/lib/pricing";
import { formatNumber } from "@/lib/format";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = { title: "Pricing and subscriptions — JATA AFTERCALL", description: "Transparent JATA AFTERCALL plan prices, payment, renewal, cancellation and refund information." };
export const dynamic = "force-dynamic";

const PLAN_SCOPE: Record<string, string> = {
  MONTHLY: "Public Business Page · per business",
  ANNUAL: "Public Business Page · per business",
  AI_BUSINESS_FRONT_DESK: "AI Front Desk add-on · per business",
  INTERACTIVE_BUSINESS: "Website Studio · per business",
  BUSINESS_POS: "Owner-only POS · per business",
  ERP_PRO: "JATA BOS PRO · per business",
  JATA_AUTOPILOT: "Owner-only Autopilot · per business",
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
  INTERACTIVE_BUSINESS: "Subscription · pay from your dashboard",
  BUSINESS_POS: "Separate product · purchased in the Business POS workspace",
  ERP_PRO: "Separate product · purchased in the ERP workspace",
  JATA_AUTOPILOT: "Separate product · purchased in the Autopilot workspace",
};

const PLAN_DESCRIPTIONS: Record<string, string> = {
  MONTHLY: "Your public business page at /b/your-business with WhatsApp, Call, Directions and Share actions, services, prices, an offer and opening hours.",
  ANNUAL: "The same public business page paid once for a full year — 365 days of access with the same dashboard and the same Paystack confirmation.",
  AI_BUSINESS_FRONT_DESK: "An AI front desk on your business page that answers customer questions from your own services and offer, and records the questions it could not answer.",
  INTERACTIVE_BUSINESS: "Website Studio: build, edit and preview a full business website with a priced catalogue, stock, bookings, orders and checkout on your own page.",
  BUSINESS_POS: "An owner-only point of sale — sales, stock, credit and reports — configured around how your business actually works. Separate from your page plan.",
  ERP_PRO: "JATA BOS PRO — Business Operating System Pro: accounting, invoicing, inventory, purchasing and business operations with supported messaging tools. Broader than the separate Business POS till, which covers counter sales only.",
  JATA_AUTOPILOT: "A supervised assistant that checks your business health and drafts offer and FAQ actions for your approval. The preview is free; live actions switch on after payment is confirmed.",
};

const PLAN_ROUTE: Record<string, string> = {
  MONTHLY: "/products/business-page",
  ANNUAL: "/products/business-page",
  AI_BUSINESS_FRONT_DESK: "/products/ai-front-desk",
  INTERACTIVE_BUSINESS: "/products/website-studio",
  BUSINESS_POS: "/products/business-pos",
  ERP_PRO: "/products/erp-pro",
  JATA_AUTOPILOT: "/products/jata-autopilot",
};

export default async function PricingPage() {
  let stored: HomepagePlanCard[] = [];
  try {
    stored = await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } });
  } catch {
    stored = [];
  }
  const plans = homepagePlanCards(stored.length > 0 ? stored : FALLBACK_PLANS);

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
          {plans.map((plan) => (
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
          ))}
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
