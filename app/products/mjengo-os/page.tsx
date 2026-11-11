import type { Metadata } from "next";
import Link from "next/link";
import { formatKES } from "@/lib/format";
import { getMjengoOsPlan } from "@/lib/pricing";
import { mjengoCheckoutRefusal } from "@/lib/mjengo/settlement";
import { MJENGO_PLAN_PRICE_KES, MJENGO_PLAN_DURATION_DAYS } from "@/lib/mjengo/entitlement";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "MJENGO OS | Construction Business Management System — JATA AFTERCALL",
  description: "Manage construction projects, materials, procurement, customers and business records with MJENGO OS by JATA AFTERCALL.",
  alternates: { canonical: "https://jataaftercall.co.ke/products/mjengo-os" },
  openGraph: {
    title: "MJENGO OS | JATA AFTERCALL",
    description: "A connected business workspace for sales, inventory, procurement, customers, accounting and reports.",
    url: "https://jataaftercall.co.ke/products/mjengo-os",
    type: "website",
  },
};

export const dynamic = "force-dynamic";

const capabilities = [
  {
    title: "Sales & orders",
    description: "Review POS-linked orders and walk-in sales in one business workspace.",
    value: "Keep sales activity and order records visible.",
  },
  {
    title: "Inventory & materials",
    description: "Manage products, stock records and inventory movements.",
    value: "See stock information and movement history.",
  },
  {
    title: "Procurement & suppliers",
    description: "Work with supplier records, purchase orders and goods received.",
    value: "Keep purchasing activity connected to stock operations.",
  },
  {
    title: "Customers & credit",
    description: "Maintain customer records, debt and credit activity.",
    value: "Keep customer relationships and balances together.",
  },
  {
    title: "Accounting",
    description: "Access journals, trial balance and profit-and-loss reporting.",
    value: "Improve visibility into recorded financial activity.",
  },
  {
    title: "Workforce",
    description: "Access staff, attendance and payroll workspace sections.",
    value: "Keep workforce operations within the same product.",
  },
  {
    title: "Business reports",
    description: "Review operational and financial reports.",
    value: "Bring business information into a clearer reporting view.",
  },
];

const audiences = [
  "Building contractors coordinating jobs, materials and supplier purchases.",
  "Construction businesses tracking stock, sales and customer balances.",
  "Property developers overseeing recurring operational activity.",
  "Construction-material suppliers managing inventory, customers and orders.",
  "Growing businesses that need clearer operational and financial records.",
];

const problems = [
  ["Materials that are difficult to track", "Use inventory records and movement visibility to follow stock."],
  ["Purchases and suppliers spread across different records", "Keep supplier, purchase-order and goods-received activity together."],
  ["Sales and customer balances hard to reconcile", "Review sales, orders, customer records and credit activity in one workspace."],
  ["Financial information difficult to review", "Use accounting journals and available financial reports for better visibility."],
];

export default async function MjengoOsProductPage() {
  const plan = await getMjengoOsPlan().catch(() => null);
  const refusal = mjengoCheckoutRefusal(plan);
  const validPlan = Boolean(plan && plan.key === "MJENGO_OS" && Number(plan.priceKES) === MJENGO_PLAN_PRICE_KES && Number(plan.durationDays) === MJENGO_PLAN_DURATION_DAYS);
  const terms = validPlan && plan
    ? `${formatKES(Number(plan.priceKES))} / ${plan.durationDays} days`
    : "Pricing currently unavailable";

  return (
    <MarketingLayout
      eyebrow="JATA AFTERCALL · BUSINESS OPERATING SYSTEM"
      title="Take Control of Every Project, Material and Shilling."
      intro="MJENGO OS brings sales, inventory, procurement, customers, accounting and business reports into one connected workspace. Built for contractors, construction businesses, suppliers and growing operators who need a clearer view of daily operations."
    >
      <MarketingSection title="One workspace for the work behind your business" id="mjengo-hero">
        <div className="mk-prose">
          <p><strong>Projects move. Materials move. Money moves. Keep the records connected.</strong></p>
          <p>MJENGO OS is a dedicated JATA AFTERCALL product with its own workspace and subscription entitlement. Explore the capabilities, check the current plan terms and follow the authenticated business-owner journey to access it.</p>
        </div>
        <div className="mk-btn-row">
          <Link href="/dashboard/mjengo" className="mk-btn">Get MJENGO OS</Link>
          <Link href="#mjengo-features" className="mk-btn mk-btn--ghost">Explore features</Link>
          <Link href="#mjengo-plan" className="mk-btn mk-btn--ghost">View plan</Link>
        </div>
        <div className="mk-grid" aria-label="MJENGO OS capabilities">
          <article className="mk-card"><h3>Operations</h3><p>Sales, orders and workforce workspace sections.</p></article>
          <article className="mk-card"><h3>Materials</h3><p>Inventory, stock movements and procurement records.</p></article>
          <article className="mk-card"><h3>Customers</h3><p>Customer records, balances and credit activity.</p></article>
          <article className="mk-card"><h3>Financial visibility</h3><p>Accounting journals, trial balance and reports.</p></article>
        </div>
      </MarketingSection>

      <MarketingSection title="Bring scattered business activity into view" tone="cream" id="mjengo-problems">
        <div className="mk-grid">
          {problems.map(([problem, response]) => (
            <article className="mk-card" key={problem}>
              <h3>{problem}</h3>
              <p>{response}</p>
            </article>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection title="Explore the MJENGO OS workspace" id="mjengo-features">
        <p className="mk-prose">The sections below reflect the current MJENGO OS workspace navigation and module descriptions.</p>
        <div className="mk-grid">
          {capabilities.map((feature) => (
            <article className="mk-card" key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <p><strong>{feature.value}</strong></p>
            </article>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection title="Who should use MJENGO OS?" tone="cream" id="mjengo-audience">
        <div className="mk-prose">
          <p>Designed for Kenyan businesses that coordinate people, materials, purchases, customers and money as part of daily operations.</p>
          <ul>
            {audiences.map((audience) => <li key={audience}>{audience}</li>)}
          </ul>
        </div>
      </MarketingSection>

      <MarketingSection title="How to get started" id="mjengo-how">
        <div className="mk-grid">
          <article className="mk-card"><h3>1. Access your account</h3><p>Sign in to your JATA AFTERCALL account or register if you are new.</p></article>
          <article className="mk-card"><h3>2. Select your business</h3><p>Choose a business you own. MJENGO OS access is scoped to the selected business.</p></article>
          <article className="mk-card"><h3>3. Complete checkout</h3><p>Review the server-verified product and price, then complete the supported payment process.</p></article>
          <article className="mk-card"><h3>4. Open your workspace</h3><p>Workspace access is granted only after the payment and MJENGO OS entitlement have been verified.</p></article>
        </div>
      </MarketingSection>

      <MarketingSection title="One separate product. Clear subscription terms." tone="cream" id="mjengo-plan">
        <div className="mk-prose">
          <p><strong>MJENGO OS plan: {terms}</strong></p>
          {validPlan ? (
            <p>The price and duration above are read from the active server-side MJENGO OS plan. Checkout independently revalidates the plan before accepting payment.</p>
          ) : (
            <p>The authoritative active plan could not be confirmed. We are not displaying an assumed price or offering checkout until the server-side plan is valid.</p>
          )}
          <p>MJENGO OS is separate from Business POS and JATA BOS PRO. A subscription to one product does not automatically grant access to another.</p>
          <p>Access is per business and depends on a verified MJENGO OS entitlement. Payment confirmation, subscription activation and workspace access are separate server-controlled steps.</p>
          <p><strong>{refusal ? "Checkout is currently unavailable" : "The plan is configured; access still requires an authorized business and verified subscription."}</strong></p>
          {refusal ? <p>{refusal}</p> : null}
        </div>
        <div className="mk-btn-row">
          <Link href="/dashboard/mjengo" className="mk-btn">Get MJENGO OS</Link>
          <Link href="/pricing" className="mk-btn mk-btn--ghost">Compare JATA plans</Link>
        </div>
      </MarketingSection>

      <MarketingSection title="Frequently asked questions" id="mjengo-faq">
        <div className="mk-grid">
          <article className="mk-card"><h3>What is MJENGO OS?</h3><p>A separate business-management workspace for sales, inventory, procurement, customers, accounting, workforce and reporting.</p></article>
          <article className="mk-card"><h3>Who can use it?</h3><p>An authorized owner or permitted user of a business with an active MJENGO OS entitlement.</p></article>
          <article className="mk-card"><h3>Is it Business POS?</h3><p>No. Business POS is a separate point-of-sale product. MJENGO OS has its own plan and access checks.</p></article>
          <article className="mk-card"><h3>Is it JATA BOS PRO?</h3><p>No. JATA BOS PRO is a separate product with separate purchase and entitlement rules.</p></article>
          <article className="mk-card"><h3>How much does it cost?</h3><p>{validPlan ? `The current stored plan is ${terms}.` : "The price is unavailable until the active MJENGO OS plan can be verified."}</p></article>
          <article className="mk-card"><h3>How do I subscribe?</h3><p>Sign in, select a business you own and follow the server-verified checkout flow when the product is enabled and available.</p></article>
          <article className="mk-card"><h3>When can I access the workspace?</h3><p>After the payment provider confirms payment and the server activates the matching MJENGO OS entitlement.</p></article>
          <article className="mk-card"><h3>What happens when a subscription expires?</h3><p>Access follows the server-side subscription and entitlement state. Sign in to see the current status and available next action.</p></article>
          <article className="mk-card"><h3>Can I manage multiple businesses?</h3><p>Workspace access is selected per business. Your account only sees businesses you are authorized to access.</p></article>
        </div>
      </MarketingSection>

      <MarketingSection title="Bring your business operations together" tone="cream" id="mjengo-final-cta">
        <div className="mk-prose">
          <p>Manage sales, materials, procurement, customers and business records with greater operational visibility.</p>
        </div>
        <div className="mk-btn-row">
          <Link href="/dashboard/mjengo" className="mk-btn">Get MJENGO OS</Link>
          <Link href="/products" className="mk-btn mk-btn--ghost">Explore all JATA products</Link>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
