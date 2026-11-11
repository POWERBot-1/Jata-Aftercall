import type { Metadata } from "next";
import Link from "next/link";
import { formatKES } from "@/lib/format";
import { getMjengoOsPlan } from "@/lib/pricing";
import { MJENGO_PLAN_DURATION_DAYS, MJENGO_PLAN_PRICE_KES } from "@/lib/mjengo/entitlement";
import { mjengoCheckoutRefusal } from "@/lib/mjengo/settlement";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "MJENGO OS — Business Management | JATA AFTERCALL",
  description: "A dedicated business-management workspace from JATA AFTERCALL.",
};

export const dynamic = "force-dynamic";

export default async function MjengoOsProductPage() {
  const plan = await getMjengoOsPlan().catch(() => null);
  const refusal = mjengoCheckoutRefusal(plan);
  const terms = plan
    ? `${formatKES(Number(plan.priceKES))} / ${plan.durationDays} days`
    : `${formatKES(MJENGO_PLAN_PRICE_KES)} / ${MJENGO_PLAN_DURATION_DAYS} days (approved terms; stored plan row unavailable)`;

  return (
    <MarketingLayout
      eyebrow="Business management"
      title="MJENGO OS"
      intro="A dedicated business-management workspace for the daily operations behind your business — connected to JATA AFTERCALL, with its own plan and entitlement."
    >
      <MarketingSection title="One workspace for the work behind the counter" id="mjengo-workspace">
        <div className="mk-grid">
          <article className="mk-card">
            <h3>Sales &amp; orders</h3>
            <p>Review business sales and order activity in one place.</p>
          </article>
          <article className="mk-card">
            <h3>Inventory &amp; procurement</h3>
            <p>Track stock, suppliers, purchase orders and goods received.</p>
          </article>
          <article className="mk-card">
            <h3>Customers &amp; credit</h3>
            <p>Keep customer records, outstanding balances and credit activity together.</p>
          </article>
          <article className="mk-card">
            <h3>Accounting &amp; reports</h3>
            <p>Review journals, financial summaries and operational reports.</p>
          </article>
        </div>
      </MarketingSection>

      <MarketingSection title="Plan and availability" tone="cream" id="mjengo-plan">
        <div className="mk-prose">
          <p><strong>MJENGO OS: {terms}</strong></p>
          <p>MJENGO OS is separate from Business POS (KES 499 / 30 days) and JATA BOS PRO (KES 3,000 / 30 days). Purchasing one does not activate the others.</p>
          <p><strong>{refusal ? "Not currently available for purchase" : "Plan configured; workspace access requires a verified MJENGO OS entitlement."}</strong></p>
          {refusal ? <p>{refusal} The product information is visible, but checkout remains fail-closed until the production readiness gate is enabled.</p> : null}
        </div>
        <div className="mk-btn-row">
          {!refusal ? <Link href="/dashboard/mjengo" className="mk-btn">Open MJENGO OS workspace</Link> : null}
          <Link href="/products" className="mk-btn mk-btn--ghost">Back to all products</Link>
        </div>
      </MarketingSection>

      <MarketingSection title="Built as a separate JATA product" id="mjengo-separation">
        <div className="mk-prose">
          <p>MJENGO OS has its own plan key, subscription checks and workspace routes. It does not silently replace or extend a Business POS or JATA BOS PRO subscription.</p>
          <p>Payments are only started when the server confirms that the product is enabled and the stored plan matches the approved terms. This page itself never initiates a payment.</p>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
