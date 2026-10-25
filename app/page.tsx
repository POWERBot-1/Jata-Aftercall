import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/landing/Hero";
import { BenefitsSection, StorySection } from "@/components/landing/Sections";
import { DemoShowcase } from "@/components/landing/DemoShowcase";
import { FaqSection, LandingFooter } from "@/components/landing/FaqAndFooter";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { formatKES, formatNumber } from "@/lib/format";
import { FALLBACK_PLANS, orderHomepagePlans, planDisplayName, publiclyListedPlans } from "@/lib/pricing";
// The Business POS price is a server-side constant, never a number written into this page (§45).
import { POS_PLAN_PRICE_KES } from "@/lib/pos/entitlement";
import { LANDING_STEPS, LANDING_DEMO_SLUGS, PLAN_BADGES, PLAN_INCLUDES, buildLandingDemoCards, type LandingDemoRow } from "@/lib/landing";
import { isVerifiedDemoRecord } from "@/lib/demoContent";
import { DEMO_PAYMENT_PREFIX } from "@/lib/demoData";

export const dynamic = "force-dynamic";

/**
 * Public sales landing page.
 *
 * Layout is a stack of full-bleed sections (hero → story → benefits → demo showcase → pricing →
 * how it works → FAQ → footer), each server-rendered. The only client component on the page is the
 * demo tab switcher; everything else — including the phone, marquee and reveal motion — is CSS.
 *
 * Data rules that predate this redesign and still hold:
 *   • Plans are read from the database and filtered with `publiclyListedPlans()`; the private
 *     Business POS plan is never a card (§67). Marketing order comes from `orderHomepagePlans()`.
 *   • A database failure falls back to every advertised plan, not just the original two.
 *   • The POS keeps its own separate entry and its price comes from the server constant.
 *   • The four fictional demo cards show active services only; fallback content is labelled
 *     synthetic. Links require the dedicated demo owner, no non-demo payment rows, and a published
 *     ACTIVE business with active services — not a matching slug alone.
 */
export default async function HomePage() {
  const session = await getSession();
  let plans: { key: string; name: string; priceKES: number; durationDays: number }[] = [];
  try {
    plans = orderHomepagePlans(publiclyListedPlans(await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } })));
  } catch {
    plans = [];
  }
  if (plans.length === 0) {
    plans = orderHomepagePlans(publiclyListedPlans(FALLBACK_PLANS));
  }

  let demoRows: LandingDemoRow[] = [];
  try {
    const rows = await prisma.business.findMany({
      where: { slug: { in: [...LANDING_DEMO_SLUGS] }, isPublished: true, status: "ACTIVE" },
      select: {
        slug: true,
        name: true,
        category: true,
        location: true,
        isPublished: true,
        status: true,
        owner: { select: { email: true } },
        payments: {
          where: { NOT: { reference: { startsWith: DEMO_PAYMENT_PREFIX } } },
          select: { reference: true },
          take: 1,
        },
        services: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { title: true, priceLabel: true, priceFrom: true, isActive: true } },
        offer: { select: { title: true, subtitle: true, isActive: true, validUntil: true } },
      },
    });
    demoRows = rows.map(({ owner, payments, ...row }) => ({
      ...row,
      isVerifiedDemo: isVerifiedDemoRecord({
        slug: row.slug,
        ownerEmail: owner.email,
        paymentReferences: payments.map((payment) => payment.reference),
      }),
    }));
  } catch {
    demoRows = [];
  }
  const demoCards = buildLandingDemoCards(demoRows);
  const availableDemoSlugs = demoCards.filter((card) => card.routeAvailable).map((card) => card.slug);

  return (
    <div className="jata-landing lp-page">
      <a href="#main" className="jata-skip-link">Skip to content</a>
      <Navbar session={session} />

      <main id="main">
        <Hero />
        <StorySection />
        <BenefitsSection />
        <DemoShowcase cards={demoCards} />

        {/* Pricing */}
        <section className="lp-section lp-section--ink lp-pricing" id="pricing" aria-labelledby="pricing-title">
          <div className="lp-wrap">
            <div className="lp-section__head">
              <div>
                <p className="lp-kicker lp-kicker--light">Pricing</p>
                <h2 id="pricing-title" className="lp-h2 lp-h2--light">Simple pricing</h2>
                <p className="lp-lede lp-lede--light">
                  Pay securely with Paystack (M-Pesa or card). We never store your card details. Every plan starts on
                  the same page — you choose how much of the product you need.
                </p>
              </div>
            </div>

            <div className="lp-plans">
              {plans.map((p) => {
                const includes = PLAN_INCLUDES[p.key] ?? [];
                const badge = PLAN_BADGES[p.key];
                const featured = p.key === "ANNUAL";
                return (
                  <article key={p.key} className="lp-plan" data-featured={featured} aria-label={planDisplayName(p)}>
                    {/* One direct child per card row, so the cards can share those rows (see `.lp-plan` in globals.css). */}
                    <p className="lp-plan__name">{planDisplayName(p)}</p>
                    {badge ? <span className="lp-plan__badge">{badge}</span> : null}
                    <p className="lp-plan__price">KES {formatNumber(p.priceKES)}</p>
                    <p className="lp-plan__period">{p.durationDays === 365 ? "per year" : `per ${p.durationDays} days`} • {p.durationDays} days access</p>
                    {p.key === "INTERACTIVE_BUSINESS" ? <p className="lp-plan__blurb">Build, edit and preview your interactive business website.</p> : null}
                    {includes.length > 0 ? (
                      <ul className="lp-plan__includes">
                        {includes.map((item) => (
                          <li key={item}>
                            <span className="lp-plan__tick" aria-hidden="true">✓</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <Link href="/register" className="lp-plan__cta">Get my business page</Link>
                    <p className="lp-plan__fine">Secure Paystack checkout. Your plan starts once payment is confirmed.</p>
                  </article>
                );
              })}
            </div>
            <p className="lp-pricing__note">
              Prices are shown in Kenyan shillings. Plans renew for the period you choose and can be changed from your
              dashboard. The owner-only Business POS is a separate product and is not part of these four plans.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="lp-section lp-section--cream" id="how" aria-labelledby="how-title">
          <div className="lp-wrap">
            <p className="lp-kicker">How it works</p>
            <h2 id="how-title" className="lp-h2">Create your page</h2>
            <ol className="lp-steps">
              {LANDING_STEPS.map((step, index) => (
                <li key={step} className="lp-step">
                  <span className="lp-step__num" aria-hidden="true">{index + 1}</span>
                  <span className="lp-step__label">{step}</span>
                </li>
              ))}
            </ol>
            <p className="lp-lede lp-lede--tight">
              Then put <code className="lp-code">/b/your-business</code> on WhatsApp, Facebook, Instagram, TikTok, Google
              Business, posters and receipts — anywhere customers find you.
            </p>
          </div>
        </section>

        <FaqSection />

        {/* Final call to action */}
        <section className="lp-final" aria-labelledby="final-title">
          <div className="lp-wrap lp-final__inner">
            <div>
              <h2 id="final-title" className="lp-h2 lp-h2--light">Your business page, ready to share.</h2>
              <p className="lp-lede lp-lede--light">
                Build the page, preview it on your own phone, and publish it once your payment is confirmed.
              </p>
            </div>
            <div className="lp-final__actions">
              <Link href="/register" className="lp-btn lp-btn--amber">Get my business page <span aria-hidden="true">→</span></Link>
              <a href="#demo" className="lp-btn lp-btn--outline">Explore demos</a>
            </div>
          </div>
        </section>

        {/*
          Business POS — the owner's operating system, sold separately from the AFTERCALL page plans.
          This is an entry point only: it links into the existing POS flow (/dashboard/pos), where the
          business is chosen, configured, previewed and paid for. Nothing here activates or claims to
          activate a POS, and the existing plan cards above are untouched (§67 exception, 2026-10-03).
        */}
        <section aria-labelledby="business-pos-heading" className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:flex sm:items-center sm:gap-5">
            <span
              aria-hidden="true"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                focusable="false"
              >
                <rect x="3" y="3.5" width="18" height="12" rx="2.5" />
                <path d="M7.5 11.5V8.5" />
                <path d="M11.5 11.5V6.5" />
                <path d="M15.5 11.5V9.5" />
                <path d="M6 19.5h12" />
              </svg>
            </span>
            <div className="mt-3 min-w-0 sm:mt-0 sm:flex-1">
              <h3 id="business-pos-heading" className="text-sm font-semibold">Business POS</h3>
              {/* One text node, so the price and its period read as a single string (§45). */}
              <p className="mt-1 text-2xl font-bold">{`${formatKES(POS_PLAN_PRICE_KES)}/month`}</p>
              <p className="mt-2 text-sm text-zinc-600">
                A point-of-sale for your counter, configured around how your business works — sales,
                stock, credit and reports. Per business. This is separate from your JATA AFTERCALL page plan.
                It is owner-only: sign in to open it, and set it up from your own dashboard.
              </p>
            </div>
            <div className="mt-4 sm:mt-0 sm:w-60 sm:shrink-0">
              <Link href="/dashboard/pos" className="inline-flex w-full justify-center rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white">
                Open Business POS
              </Link>
              <p className="mt-2 text-center text-xs text-zinc-600">
                Sign in, answer a few questions and see your POS. It switches on only once Paystack confirms the payment.
              </p>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter availableDemoSlugs={availableDemoSlugs} />
    </div>
  );
}
