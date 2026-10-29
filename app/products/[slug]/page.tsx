import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingLayout, MarketingSection } from "@/components/marketing/MarketingShell";

export const dynamic = "force-dynamic";

type ProductPage = {
  key: string;
  eyebrow: string;
  title: string;
  intro: string;
  sections: Array<{ heading: string; body: string[] }>;
  demo?: { href: string; label: string };
  /** Verified routes rendered ahead of the default actions (sign-in, workspace, price, register). */
  actions?: Array<{ href: string; label: string }>;
};

const PRODUCTS: Record<string, ProductPage> = {
  "business-page": {
    key: "MONTHLY",
    eyebrow: "Business Page",
    title: "One link for everything a customer needs next.",
    intro: "A mobile-first public page at /b/your-business with your contact options, services, prices, offer and opening hours. Built in the dashboard, published after payment is confirmed.",
    sections: [
      { heading: "What the customer sees", body: [
        "Four clearly labelled actions — WhatsApp, Call, Directions and Share — rendered with icons on every page, at every screen size.",
        "A prefilled WhatsApp message, a normalised Kenyan tel: link, directions from your configured address or coordinates, and native share with a copy-link fallback.",
        "Your active services and prices, a current offer when you have one, opening hours and location.",
      ] },
      { heading: "What you control", body: [
        "Business name, category, description, nominated phone and WhatsApp numbers, location and opening hours.",
        "Publish/unpublish, theme, services, offer and a referral link — all from the authenticated dashboard.",
        "Kenyan numbers are validated server-side on every write. A missing or invalid number produces an honest unavailable state, never a fabricated destination.",
      ] },
      { heading: "Plans", body: [
        "Monthly — KES 149 / 30 days, or Annual — KES 999 / 365 days. Both use the same page and the same Paystack confirmation.",
      ] },
    ],
    demo: { href: "/b/nyumbani-kitchen", label: "Open the restaurant demo" },
  },
  "ai-front-desk": {
    key: "AI_BUSINESS_FRONT_DESK",
    eyebrow: "AI Business Front Desk",
    title: "Answers from your business, not from guesswork.",
    intro: "A customer-facing AI assistant on /b/<slug>/ai that is grounded in the products, services, FAQs and knowledge you configure for that business.",
    sections: [
      { heading: "What it does", body: [
        "Answers customer questions from your configured catalogue and business details, with a publish/readiness check before the desk goes live.",
        "Records unanswered questions and handoff requests in the dashboard so you can improve the knowledge base.",
        "Keeps historical records readable after a plan ends, while live answers require an active entitlement.",
      ] },
      { heading: "Entitlement and price", body: [
        "AI Business Front Desk — KES 499 / 30 days. Live answers are enabled only from the server-verified subscription state, not from a browser flag.",
      ] },
      { heading: "Connectivity", body: [
        "AI answers always require a live connection. The installable app never caches AI responses or private business data.",
      ] },
    ],
  },
  "website-studio": {
    key: "INTERACTIVE_BUSINESS",
    eyebrow: "Website Studio",
    title: "A fuller website, built from your business type.",
    intro: "Website Studio builds a category-aware website from sections, catalogue items and bookings, with a canvas, live draft preview and inspector on one screen.",
    sections: [
      { heading: "How it works", body: [
        "Choose your business category, add products or services, then edit sections and theme in the studio canvas.",
        "Preview your unpublished draft as the owner. Publishing validates content, references, entitlement and payment before a versioned snapshot goes live.",
        "Customers keep the same /b/<slug> address; the experience engine renders the published document.",
      ] },
      { heading: "Entitlement and price", body: [
        "Website Studio — KES 999 / 30 days. A confirmed entitlement is required before a website is published.",
      ] },
    ],
    demo: { href: "/b/kamau-auto-care", label: "Open an example business page" },
  },
  "business-pos": {
    key: "BUSINESS_POS",
    eyebrow: "Business POS",
    title: "A point of sale configured around your business.",
    intro: "An owner-only POS workspace for products, inventory, sales, receipts, staff and branches. It is sold per business from inside the dashboard, never from the public pricing list.",
    sections: [
      { heading: "What it includes", body: [
        "Sales, purchases, inventory movements, expenses, customers, credit and reporting with tenant-scoped access control.",
        "An offline-first sales queue already exists for the till: offline records are replayed with stable idempotency keys and are never treated as confirmed money until the server accepts them.",
        "Live operation requires a published configuration and a confirmed entitlement.",
      ] },
      { heading: "Entitlement and price", body: [
        "Business POS — KES 499 / 30 days, activated from /dashboard/pos after Paystack confirms payment.",
      ] },
      { heading: "Security boundary", body: [
        "POS requests go through one access boundary that derives the business from the signed-in membership and checks role-level permissions. Team access never bypasses that boundary.",
      ] },
    ],
  },
  "erp-pro": {
    key: "ERP_PRO",
    eyebrow: "JATA BOS PRO",
    title: "Business Operating System Pro — the books, the stock and the buying.",
    intro:
      "JATA BOS PRO is the business operating system for a trading business: accounting, invoicing, inventory, purchasing and business operations, with supported messaging tools. KES 3,000 per 30 days, billed per business. Reading this page begins nothing.",
    sections: [
      { heading: "What it includes", body: [
        "Double-entry accounting — chart of accounts, journals, invoices, payments and reports — with the Kenya tax engine applied to the figures you record.",
        "Inventory, purchasing, customers, suppliers and multi-branch operations, with an audit trail across the workspace.",
        "Supported messaging tools where configured; SMS and WhatsApp message charges are billed to you by the messaging provider at their rates.",
        "Sender ID application tracking and KYC workspace, automation rules and industry packs.",
      ] },
      { heading: "How JATA BOS PRO differs from Business POS", body: [
        "The separate Business POS product is the counter till: sales, stock, credit and reports for the front of the business.",
        "JATA BOS PRO runs the records and operations around the counter — the accounts, the buying, the suppliers and the reporting — of which selling at the till is one part.",
        "They are separate products with separate plan keys, subscriptions and entitlement checks. Paying for one never switches on the other, and neither is included in the four page plans.",
      ] },
      { heading: "Price and billing", body: [
        "KES 3,000 per 30 days, billed per business (plan key ERP_PRO). The workspace shows the amount before any payment starts, and that amount always comes from the stored plan catalogue on the server — never from the browser.",
        "The advertised price excludes SMS and WhatsApp usage charges, Sender ID registration or network fees, payment-provider transaction fees, and KRA eTIMS certification or integrator fees.",
      ] },
      { heading: "KRA eTIMS and hardware limits", body: [
        "JATA AFTERCALL does not claim KRA eTIMS certification, and it does not submit invoices to eTIMS on your behalf today. The product keeps a submission seam that refuses to submit without a certified, configured adapter, and an invoice stays queued rather than being reported as accepted.",
        "No hardware integrations beyond the browser workspace — scanners, printers, scales or physical tills — are claimed as operational.",
      ] },
      { heading: "Viewing, buying and access", body: [
        "Four separate stages: viewing this page, beginning a purchase, the server confirming the payment, and the workspace entitlement switching on. A page visit or a checkout initiation activates nothing.",
        "Access needs an account, a business, a server-confirmed payment for plan key ERP_PRO, and a deployment with the ERP product switched on. Until an operator enables it, the ERP screens state plainly that the product is not switched on and nothing is charged.",
        "If the workspace is not enabled for your account, the ERP screen explains exactly what is missing instead of offering a payment.",
      ] },
    ],
    actions: [
      { href: "/login", label: "Sign in" },
      { href: "/dashboard/erp", label: "Open the ERP workspace" },
    ],
  },
  "jata-autopilot": {
    key: "JATA_AUTOPILOT",
    eyebrow: "JATA Autopilot",
    title: "Business-health diagnostics and draft actions, under your approval.",
    intro:
      "JATA Autopilot checks your business health and drafts offer and FAQ actions for you to approve. The standard package is KES 2,499 per 30 days, billed per business; the preview inside your dashboard is free before you pay.",
    sections: [
      { heading: "What it does", body: [
        "Business health diagnosis with 15 industry packs, and draft offer and FAQ actions collected in an approval queue.",
        "Nothing runs without your approval — every action waits for the owner to approve or reject it.",
        "You can preview it free in your dashboard before you pay; live actions switch on only after the payment is confirmed.",
      ] },
      { heading: "Entitlement and price", body: [
        "JATA Autopilot standard package — KES 2,499 / 30 days, sold per business from the authenticated Autopilot workspace. Pro and Enterprise tiers are offered only inside that workspace.",
      ] },
    ],
    actions: [{ href: "/dashboard/autopilot", label: "Open JATA Autopilot" }],
  },
};

export function generateStaticParams() {
  return Object.keys(PRODUCTS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = PRODUCTS[slug];
  return product ? { title: `${product.eyebrow} — JATA AFTERCALL`, description: product.intro } : { title: "Product not found" };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = PRODUCTS[slug];
  if (!product) notFound();
  return (
    <MarketingLayout eyebrow={product.eyebrow} title={product.title} intro={product.intro}>
      {product.sections.map((section, index) => (
        <MarketingSection key={section.heading} id={`section-${index + 1}`} title={section.heading} tone={index % 2 === 0 ? "paper" : "cream"}>
          <div className="mk-prose">
            {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </MarketingSection>
      ))}
      <MarketingSection title="Try it" tone="cream" id="try">
        <div className="mk-btn-row">
          {(product.actions ?? []).map((action) => (
            <Link key={action.href} href={action.href} className="mk-btn">
              {action.label}
            </Link>
          ))}
          {product.demo ? <Link href={product.demo.href} className={`mk-btn ${product.actions?.length ? "mk-btn--ghost" : ""}`}>{product.demo.label}</Link> : null}
          <Link href="/pricing" className={`mk-btn ${product.demo || product.actions?.length ? "mk-btn--ghost" : ""}`}>See the price</Link>
          <Link href="/register" className="mk-btn mk-btn--ghost">Create an account</Link>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
