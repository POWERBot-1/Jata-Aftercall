import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { formatKES } from "@/lib/format";
import { publiclyListedPlans } from "@/lib/pricing";
// The Business POS price is a server-side constant, never a number written into this page (§45).
import { POS_PLAN_PRICE_KES } from "@/lib/pos/entitlement";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  let plans: { key: string; name: string; priceKES: number; durationDays: number }[] = [];
  try {
    // The AFTERCALL plan cards never include the Business POS: `publiclyListedPlans()` keeps the
    // private plan out of them (POS spec §67). The POS has one dedicated entry of its own further
    // down this page — a product decision recorded in BUSINESS_POS_IMPLEMENTATION.md §7 on
    // 2026-10-03 — and its price is read from the server constant, so this page can never set it.
    plans = publiclyListedPlans(await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } }));
  } catch {
    plans = [];
  }
  // Fallback if DB not seeded
  if (plans.length === 0) {
    plans = [
      { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365 },
      { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30 },
    ];
  }

  return (
    <div className="jata-landing">
      <a href="#main" className="jata-skip-link">Skip to content</a>
      <Navbar session={session} />
      <main id="main">
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="mb-3 inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium tracking-wide text-zinc-700">
              FOR KENYAN MICRO & SMALL BUSINESSES
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
              Turn every customer interaction <span className="underline decoration-amber-400 decoration-4 underline-offset-4">into another opportunity to sell.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-7 text-zinc-600">
              JATA AFTERCALL gives your business a lightweight, mobile-first page for the moment <em>after</em> a customer interacts with you — WhatsApp, Call, Directions, Services, Offer, Analytics. No bulky website. No complexity.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/register" className="jata-btn jata-btn-primary">
                Get my business page →
              </Link>
              <a href="#demo" className="jata-btn jata-btn-secondary">
                See demo pages
              </a>
            </div>
            <p className="mt-3 text-xs text-zinc-500">Create your page in ~5 minutes. Works on any Android phone.</p>

            <div className="mt-8 grid grid-cols-3 gap-4 border-t border-zinc-100 pt-6 text-sm">
              <div><p className="font-semibold">WhatsApp & Call</p><p className="text-xs text-zinc-500">One-tap CTAs above the fold</p></div>
              <div><p className="font-semibold">Offer + Services</p><p className="text-xs text-zinc-500">Today&apos;s deal, always visible</p></div>
              <div><p className="font-semibold">Directions & Share</p><p className="text-xs text-zinc-500">Map + share in one tap</p></div>
            </div>
          </div>

          {/* Phone mock */}
          <figure className="mx-auto w-full max-w-[360px]">
          <div className="jata-light-island relative" aria-label="Example business page" role="img">
            <div className="rounded-[2rem] border border-zinc-200 bg-zinc-900 p-2 shadow-2xl">
              <div className="rounded-[1.6rem] bg-white p-5">
                <p className="text-center text-xs font-semibold tracking-widest text-zinc-500">THANKS FOR CONTACTING US 👋</p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-amber-100" />
                  <div>
                    <p className="text-sm font-bold">Mary&apos;s Beauty Studio</p>
                    <p className="text-xs text-zinc-500">Braids, nails & beauty in Nairobi</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <span className="rounded-xl bg-emerald-700 py-3 text-center text-sm font-bold text-white">WhatsApp</span>
                  <span className="rounded-xl bg-zinc-900 py-3 text-center text-sm font-bold text-white">Call</span>
                </div>
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-800">TODAY&apos;S OFFER</p>
                  <p className="text-sm font-bold">Braids from KES 1,500</p>
                  <p className="text-xs text-zinc-600">This week only</p>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between rounded-lg bg-zinc-50 px-3 py-2"><span>Braiding</span><span className="text-zinc-500">From KES 1,500</span></div>
                  <div className="flex justify-between rounded-lg bg-zinc-50 px-3 py-2"><span>Nails</span><span className="text-zinc-500">From KES 800</span></div>
                </div>
                <div className="mt-4 flex gap-2 text-xs">
                  <span className="flex-1 rounded-full border px-3 py-2 text-center">Directions</span>
                  <span className="flex-1 rounded-full border px-3 py-2 text-center">Share</span>
                </div>
              </div>
            </div>
          </div>
          <figcaption className="mt-3 text-center text-sm text-zinc-600">Example page — loads fast, one primary action</figcaption>
          </figure>
        </div>
      </section>

      {/* What you get */}
      <section className="border-y border-zinc-100 bg-zinc-50">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <h2 className="text-xl font-bold">Your customer gets a page that sells — not a website that confuses.</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              { t: "Business info", d: "Name, category, value prop, about, opening hours." },
              { t: "Instant contact", d: "WhatsApp + Call + Directions with large tap targets." },
              { t: "Services & Offers", d: "Menu of services + today's offer stacked for mobile." },
              { t: "Location", d: "Map/location info customers can actually use." },
              { t: "Share", d: "Customer can share your page to referrals in one tap." },
              { t: "Basic analytics", d: "Page views, WhatsApp/calls/directions/shares — privacy-preserving." },
            ].map((f) => (
              <div key={f.t} className="rounded-2xl border border-zinc-200 bg-white p-5">
                <p className="text-sm font-semibold">{f.t}</p>
                <p className="mt-1 text-sm text-zinc-600">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight">Simple pricing</h2>
        <p className="mt-1 text-sm text-zinc-600">Pay securely with Paystack (M-Pesa or card). We never store your card details.</p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:max-w-2xl">
          {plans.map((p) => (
            <div key={p.key} className="rounded-2xl border border-zinc-200 p-6">
              <p className="text-sm font-semibold">{p.name}</p>
              <p className="mt-1 text-3xl font-bold">KES {p.priceKES.toLocaleString()}</p>
              <p className="text-xs text-zinc-500">{p.durationDays === 365 ? "per year" : `per ${p.durationDays} days`} • {p.durationDays} days access</p>
              <Link href="/register" className="mt-4 inline-flex w-full justify-center rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white">Get my business page</Link>
              <p className="mt-2 text-center text-xs text-zinc-600">Secure Paystack checkout. Your plan starts once payment is confirmed.</p>
            </div>
          ))}
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

      {/* How it works */}
      <section className="border-t border-zinc-100 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <h2 className="text-xl font-bold">Create your page in ~5 minutes</h2>
          <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-5">
            {["Business name & phone", "Category & location", "Choose style (3 themes)", "Add services & offer", "Publish → share link"].map((s, i) => (
              <li key={s} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"><span className="font-bold">{i + 1}.</span> {s}</li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-zinc-600">Then put <code className="rounded bg-zinc-100 px-1.5 py-0.5">/b/your-business</code> on WhatsApp, Facebook, Instagram, TikTok, Google Business, posters and receipts — anywhere customers find you.</p>
        </div>
      </section>

      {/* Demo */}
      <section id="demo" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="text-xl font-bold">Demo businesses</h2>
        <p className="text-sm text-zinc-600">Realistic examples — different categories & themes.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { slug: "nyumbani-kitchen", name: "Nyumbani Kitchen", cat: "Restaurant", theme: "Warm" },
            { slug: "marys-beauty-studio", name: "Mary's Beauty Studio", cat: "Beauty", theme: "Clean" },
            { slug: "kamau-auto-care", name: "Kamau Auto Care", cat: "Mechanic", theme: "Dark" },
            { slug: "john-kamau-properties", name: "John Kamau Properties", cat: "Real Estate", theme: "Clean" },
          ].map((d) => (
            <Link key={d.slug} href={`/b/${d.slug}`} className="rounded-2xl border border-zinc-200 p-5 hover:bg-zinc-50">
              <p className="text-sm font-bold">{d.name}</p>
              <p className="text-xs text-zinc-500">{d.cat} • {d.theme} theme</p>
              <p className="mt-2 text-sm font-semibold underline">/b/{d.slug} →</p>
            </Link>
          ))}
        </div>
      </section>

      </main>
      <footer className="border-t border-zinc-100 py-8 text-center text-sm text-zinc-600">
        <p>JATA AFTERCALL — after-call business pages for Kenyan small businesses.</p>
        <p className="mt-1">Payments are processed securely by Paystack.</p>
      </footer>
    </div>
  );
}
