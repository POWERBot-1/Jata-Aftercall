import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/landing/Hero";
import { BenefitsSection, StorySection } from "@/components/landing/Sections";
import { DemoShowcase } from "@/components/landing/DemoShowcase";
import { FaqSection, LandingFooter } from "@/components/landing/FaqAndFooter";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { FALLBACK_PLANS, homepagePlanCards, planDisplayName, type HomepagePlanCard } from "@/lib/pricing";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { LANDING_STEPS, LANDING_DEMO_SLUGS, PLAN_BADGES, PLAN_INCLUDES, POS_PLAN_CARD, buildLandingDemoCards, type LandingDemoRow } from "@/lib/landing";
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
 *   • Plans are read from the database; the private Business POS never becomes a payable choice.
 *     Marketing order comes from `homepagePlanCards()`.
 *   • A database failure falls back to every advertised plan, not just the original two.
 *   • The Business POS card is the fifth card in the same grid. It links to the authenticated
 *     `/dashboard/pos` flow — never to `/register` or checkout — and its price is the stored plan
 *     price, so showing the card grants nothing.
 *   • The four fictional demo cards show active services only; fallback content is labelled
 *     synthetic. Links require the dedicated demo owner, no non-demo payment rows, and a published
 *     ACTIVE business with active services — not a matching slug alone.
 */
export default async function HomePage() {
  const session = await getSession();
  let storedPlans: HomepagePlanCard[] = [];
  try {
    storedPlans = await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } });
  } catch {
    storedPlans = [];
  }
  // An unreadable or empty plan table falls back to every advertised plan, POS included.
  const plans = homepagePlanCards(storedPlans.length > 0 ? storedPlans : FALLBACK_PLANS);

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

            <div className="lp-plans" data-plan-count={plans.length}>
              {plans.map((p) => {
                // The POS is a card in this grid but never a page-plan purchase: it keeps its own
                // copy and CTA, and the four page-plan maps in lib/landing.ts never mention it.
                const isPos = p.key === POS_PLAN_KEY;
                const includes = isPos ? POS_PLAN_CARD.includes : PLAN_INCLUDES[p.key] ?? [];
                const badge = isPos ? POS_PLAN_CARD.badge : PLAN_BADGES[p.key];
                const blurb = isPos
                  ? POS_PLAN_CARD.blurb
                  : p.key === "INTERACTIVE_BUSINESS"
                    ? "Build, edit and preview your interactive business website."
                    : null;
                const featured = p.key === "ANNUAL";
                return (
                  <article
                    key={p.key}
                    className="lp-plan"
                    data-featured={featured}
                    data-plan={p.key}
                    aria-label={planDisplayName(p)}
                  >
                    {/* One direct child per card row, so the cards can share those rows (see `.lp-plan` in globals.css). */}
                    <p className="lp-plan__name">{planDisplayName(p)}</p>
                    {badge ? <span className="lp-plan__badge">{badge}</span> : null}
                    <p className="lp-plan__price">KES {formatNumber(p.priceKES)}</p>
                    <p className="lp-plan__period">{p.durationDays === 365 ? "per year" : `per ${p.durationDays} days`} • {p.durationDays} days access</p>
                    {blurb ? <p className="lp-plan__blurb">{blurb}</p> : null}
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
                    {/* The POS opens the existing authenticated flow; nothing here sells or activates it. */}
                    <Link href={isPos ? "/dashboard/pos" : "/register"} className="lp-plan__cta">
                      {isPos ? POS_PLAN_CARD.cta : "Get my business page"}
                    </Link>
                    <p className="lp-plan__fine">
                      {isPos ? POS_PLAN_CARD.fine : "Secure Paystack checkout. Your plan starts once payment is confirmed."}
                    </p>
                  </article>
                );
              })}
            </div>
            <p className="lp-pricing__note">
              Prices are shown in Kenyan shillings. Plans renew for the period you choose and can be changed from your
              dashboard. The owner-only Business POS is a separate product, sold per business: it is not part of your
              page plan and it switches on only once Paystack confirms the payment.
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

      </main>

      <LandingFooter availableDemoSlugs={availableDemoSlugs} />
    </div>
  );
}
