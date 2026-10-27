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
  JATA_AUTOPILOT: "Owner-only Autopilot · per business",
  INTERACTIVE_BUSINESS: "Website Studio · per business",
  BUSINESS_POS: "Owner-only POS · per business",
};

const PLAN_ROUTE: Record<string, string> = {
  MONTHLY: "/products/business-page",
  ANNUAL: "/products/business-page",
  AI_BUSINESS_FRONT_DESK: "/products/ai-front-desk",
  INTERACTIVE_BUSINESS: "/products/website-studio",
  BUSINESS_POS: "/products/business-pos",
  JATA_AUTOPILOT: "/products",
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
      <MarketingSection title="Plan comparison" id="comparison">
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Period</th><th scope="col">Scope</th><th scope="col">Details</th></tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.key}>
                  <td><strong>{planDisplayName(plan)}</strong></td>
                  <td>KES {formatNumber(plan.priceKES)}</td>
                  <td>{plan.durationDays === 365 ? "per year" : `per ${plan.durationDays} days`}</td>
                  <td>{PLAN_SCOPE[plan.key] || "Per business"}</td>
                  <td><Link href={PLAN_ROUTE[plan.key] || "/products"}>What is included →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <p>Each plan is a prepaid fixed period of access for one business: 30 days for monthly products, 365 days for the annual page plan. The Business POS and JATA Autopilot are separate owner-only products with their own plan keys and activation flows; they are not included in a page plan.</p>
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
