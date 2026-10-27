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
          {product.demo ? <Link href={product.demo.href} className="mk-btn">{product.demo.label}</Link> : null}
          <Link href="/pricing" className={`mk-btn ${product.demo ? "mk-btn--ghost" : ""}`}>See the price</Link>
          <Link href="/register" className="mk-btn mk-btn--ghost">Create an account</Link>
        </div>
      </MarketingSection>
    </MarketingLayout>
  );
}
