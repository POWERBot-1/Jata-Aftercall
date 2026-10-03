# JATA AFTERCALL — Every call leaves your business behind.

Lightweight Kenyan SME after-interaction conversion pages. A customer scans/finds your link → lands on a fast, mobile-first page with WhatsApp, Call, Directions, Services, Offer & Analytics.

**V1 is a sellable MVP — create a business page in ~5 minutes, demonstrable in 60 seconds.**

> `https://jata-aftercall.vercel.app/b/marys-beauty-studio` (path-based, zero-cost)

---

## 60-Second Demo

> "Give me your business name and number." → Create page → Open the current zero-cost demo at `https://jata-aftercall.vercel.app/b/marys-beauty-studio` → "This is what your customer can see after dealing with you."

---

## Features (V1)

- **Sales landing** `/` — proposition, pricing (DB-driven), demo businesses
- **Onboarding** `/onboarding` — name/category/phone/WhatsApp/location/description → theme (3: clean/dark/warm) → services → offer → preview
- **Public business page** `/b/[slug]` — mobile-first, sticky CTA bar, large touch targets, offer, services, about, location, contact; fast, minimal JS; SEO title/OG/canonical; themes via tokens (not duplicated pages)
- **Paystack payments** to **JATA ATLAS merchant 2006074** — server-side verification + webhook HMAC + idempotency; never trust frontend; no card data stored
- **Customer dashboard** `/dashboard` — business live status, metrics (views/WA/calls/directions/shares), edit page/offer/services, publish/unpublish, subscription & payment history, share CTA
- **Admin panel** `/admin` — customers, businesses, payments, subscriptions, plan config (pricing admin-editable), aggregate metrics, health
- **Analytics** — privacy-preserving `page_view`, `whatsapp_click`, `call_click`, `direction_click`, `share_click`, `service_click` per business
- **Self-service referrals (Stage 2)** — every published page carries an opaque `/r/<code>` link; a recipient opens it without an account, registers themselves, and the referral is recorded in the same database transaction that creates their first business
- **Zero-cost infra** — serverless Next.js on Vercel/Pages (`*.vercel.app` / `*.pages.dev`), Neon Postgres free tier, no VPS/domain/paid SSL required; `PUBLIC_BASE_URL` abstraction for future `jata.link`

---

## Stack

Next.js 14 • TypeScript • Tailwind • Prisma • PostgreSQL (Neon free tier) • bcrypt + jose (JWT) • Paystack • Vitest

---

## Quick Start (local)

```bash
npm install
cp .env.example .env.local
# fill DATABASE_URL (Neon free) and AUTH_SECRET (openssl rand -base64 32)
npx prisma migrate dev
npm run seed   # plans + themes + development/demo accounts + 4 demo businesses
npm run dev    # http://localhost:3000
```

Demo pages (no login): `/b/nyumbani-kitchen` `/b/marys-beauty-studio` `/b/kamau-auto-care` `/b/john-kamau-properties`

---

## Environment

See `.env.example` — never commit `.env`.

```
DATABASE_URL=postgresql://...
AUTH_SECRET=...
PUBLIC_BASE_URL=http://localhost:3000
PAYSTACK_MERCHANT_ID=2006074
PAYSTACK_SECRET_KEY=sk_test_xxx   # server only
PAYSTACK_PUBLIC_KEY=pk_test_xxx
ADMIN_EMAILS=admin@jata.link
```

---

## Deployment (zero-cost)

See `DEPLOYMENT.md` — GitHub → Vercel (or Cloudflare Pages) → provider HTTPS URL → Neon → Paystack webhook `https://<provider>/api/paystack/webhook`. Includes rollback, domain upgrade, webhook/idempotency tests, and cost gates.

---

## Paystack — JATA ATLAS

All subscription payments route to **Paystack merchant 2006074 (JATA ATLAS)**. Secret never exposed to frontend; verification server-side; webhook authoritative + idempotent. See `lib/paystack.ts` and `DEPLOYMENT.md`.

> **Publication policy (updated 2026-09-29, supersedes decision G2 of 2026-09-28):** public publication **is** gated on a successfully verified subscription payment. `PUBLISH_REQUIRES_PAYMENT = true` (`lib/publication.ts`) — `PATCH /api/business` rejects `isPublished: true` (403) unless the business has a verified `PAID` payment backing a currently-valid subscription (admin route remains the operator override). Unpublishing is always allowed. This behavior is pinned by `tests/security/publication-access.test.ts` and `tests/unit/publication-gate.test.ts`.

---

## Routes

- `/` sales landing, `/health`, `/sitemap.xml`, `/robots.txt`
- `/r/[code]` referral entry (unauthenticated; persists attribution, redirects to `/register`)
- `/register` `/login` `/onboarding`
- `/b/[slug]` public page (canonical) + `/b/[slug]/shop` `/b/[slug]/item/[id]` `/b/[slug]/checkout` `/b/[slug]/order/[reference]` `/b/[slug]/book` `/b/[slug]/booking/[id]`
- `/checkout` `/checkout/callback` `/checkout/mock` (dev)
- `/dashboard` `/dashboard/subscription` `/dashboard/businesses/[id]` (website studio: sections, catalogue, theme, preview, orders, bookings, insights)
- `/admin` `/admin/customers` `/admin/businesses` `/admin/payments` `/admin/subscriptions` `/admin/plans`
- `POST /api/checkout` `GET /api/paystack/verify` `POST /api/paystack/webhook` `POST /api/analytics/event` `GET /api/analytics` `POST/PATCH /api/business` `POST /api/services` `POST /api/offer`

---

## Referrals (Stage 2)

An existing owner shares `{PUBLIC_BASE_URL}/r/<code>` from their public page (or the dashboard card).

- **Self-service and unauthenticated**: the recipient needs no account and no admin assistance.
- **Server-side, first-touch attribution**: opening the link writes a `Referral` row (`PENDING`) and
  returns only an opaque token in an httpOnly `jata_referral` cookie (the token is stored as a
  SHA-256 hash). A later link never overwrites an existing unconverted attribution.
- **Atomic with the first business**: registration converts the row (`CONVERTED` + `referredUserId`
  + `referredBusinessId`) inside the same transaction that creates the user, the business and its
  OWNER membership — all or nothing.
- **Validated server-side on every touch**: unknown/tampered code, unpublished referrer, suspended
  referrer, missing referrer, self-referral, repeated attempts and cross-tenant attribution are all
  rejected. Rejections never block a signup and never explain themselves to the browser.
- **No publication or payment effect**: referral state is never an input to
  `canSetPublished()`/`hasVerifiedPublicationRight()`. A referred page stays unpublished until a
  verified subscription payment exists, exactly like any other page.
- **No private data exposed**: the code is an opaque random string, only the public business name is
  rendered to a recipient, and no email, phone, id or reject reason leaves the server.
- **Migration**: `prisma/migrations/20260929000000_referral_stage2/migration.sql` is additive only
  (one new table, one new enum, one new nullable unique column). Applying it to production is an
  operator-authorised action performed by the existing deployment build gate
  (`scripts/build.sh` → `scripts/migrate.sh`); this repository change does not run it.

Regression/security tests: `tests/unit/referral-code.test.ts`,
`tests/unit/referral-eligibility.test.ts`, `tests/integration/referral-link-route.test.ts`,
`tests/integration/referral-registration.test.ts`, `tests/integration/referral-end-to-end.test.ts`,
`tests/security/referral-security.test.ts`, `tests/security/referral-payment-boundary.test.ts`.

---

## JATA AFTERCALL — Interactive Business (KES 999 / month)

A premium, category-aware website for a real business — not a generic page builder, and not a
second application. It reuses JATA's existing auth, tenancy, database, subscription, Paystack,
publishing and deployment stacks, and it keeps the public route pattern `/b/<slug>`.

**Sixteen categories, one engine.** A business picks what it is (restaurant, salon, real estate,
garage, …). That choice configures homepage sections, product/service fields, customer actions,
CTA wording, checkout vs booking vs enquiry, theme defaults, filters, card types and analytics
events — through an Experience Profile. No category has its own app, and no theme is a template
lock-in: `Business + Category + Experience Profile + Theme + Sections + Data + Enabled Features`.

**Lifecycle.** `CHOOSE → EDIT → PREVIEW → PAY → VERIFY → PUBLISH → LIVE`. An unpaid premium site
never goes live: the publish route re-checks payment, entitlement and the readiness checklist
server-side, so a direct API call is rejected exactly like a button click.

**Drafts and versions.** Owners edit a draft; customers see the published snapshot. The studio
previews draft and live side by side on mobile, tablet and desktop, and every publish writes an
`ExperienceVersion` snapshot that can be restored in one click.

**Money.** Prices are always re-derived server-side from the tenant's own catalogue rows
(`subtotal + delivery − discount = total`); a client-sent price is never used. Payments move through
the existing Paystack stack with an explicit state machine
(`NOT_STARTED → INITIATED → PENDING → SUCCESS | FAILED | CANCELLED | EXPIRED`), idempotent webhook
settling, and UNPAID vs PAID fulfilment: an order whose payment never starts still reaches the
owner's board.

**Ops.** Order stages (`NEW → ACCEPTED → PROCESSING → READY → COMPLETED`, plus `CANCELLED`/
`REFUNDED`) and booking states (`PENDING → CONFIRMED → IN_PROGRESS → COMPLETED`, plus
`CANCELLED`/`NO_SHOW`) are chosen per category and validated server-side. Insights cover today,
the last 7 days, best-performing items and stock that needs attention.

**Design and safety.** Mobile-first and accessible: theme palettes are derived, never hand-tuned,
and any colour that would fall below WCAG AA is corrected before it reaches the browser — including
owner-supplied brand colours. JATA stays invisible infrastructure on public sites, and AI assistance
only ever suggests wording: it can never change a price, stock level or availability.

**Migration.** `prisma/migrations/20261002000000_interactive_business/migration.sql` is additive
only (new columns, tables, foreign keys and indexes — no `DROP`, no `ALTER COLUMN`, no data
rewrites). As with every migration, applying it to production is an operator-authorised action
performed by the existing deployment gate (`scripts/build.sh` → `scripts/migrate.sh`); this
repository change does not run it.

**Tests.** `tests/unit/experience-categories.test.ts`, `tests/unit/experience-themes.test.ts`,
`tests/unit/experience-document.test.ts`, `tests/unit/experience-pricing.test.ts`,
`tests/unit/experience-operations.test.ts`, `tests/unit/experience-publish.test.ts`,
`tests/integration/storefront-checkout.test.ts`, `tests/integration/storefront-booking.test.ts`,
`tests/integration/experience-publish.test.ts`, `tests/security/experience-tenant-isolation.test.ts`.

---

## JATA AFTERCALL — Configurable Business POS (KES 499 / month)

The till, stock book, customer accounts and reports a Kenyan SME actually runs on — configured for
*that* business by a short questionnaire instead of bought as one of fifty vertical apps. It is an
additive capability inside the existing platform: same auth, same tenancy, same `PlanConfig` +
Paystack stack, same dashboard shell. Nothing customer-facing changes: the POS is a **private**
business operating system, so it never appears on a public business page, in a call instruction or
in an AFTERCALL redirect message, and it can only be chosen from inside the authenticated platform.

**One engine + configuration + templates.** `lib/pos/` is a pure configuration engine — business
types, capabilities, units, terminology, order workflows, permissions, questionnaire, presentation,
money, inventory, credit, receipts, reports. A business's answers become a machine-readable
`PosConfiguration`, and navigation, screens, forms, dashboard cards, order states, payment methods,
receipt layout, the report catalogue and role permissions are all *generated* from it. There is no
`if (businessType === "restaurant")` anywhere in the app — a vertical is data, never a code branch.
Two businesses answering differently get two substantially different POS systems from the same code,
which `tests/integration/pos-api-routes.test.ts` proves over HTTP.

**The journey.** Create/select business → adaptive questionnaire (only the questions that matter,
progressive disclosure, "Something else" always available) → *"We've configured your POS"* in plain
language → edit the configuration → interactive preview sandbox on sample data → choose the
KES 499 plan → pay → **server-verified** payment → provisioned → LIVE. The lifecycle is explicit and
enforced server-side — `DRAFT → CONFIGURED → PREVIEW → AWAITING_PAYMENT → PAYMENT_CONFIRMED →
PROVISIONING → LIVE`, plus `SUSPENDED` / `CANCELLED`: a preview is never production, payment
initiation is never success, and nothing trades before the settlement path confirms the money.

**Universal fallback.** Before a business answers anything it already gets a working baseline POS —
New Sale, Products/Services, Customers, Payments, Receipts, Sales History, Basic Reports, Settings —
so an unknown trade is never stuck, and setup may stay partial while trading starts.

**Money and stock are server-authoritative.** Prices are re-derived from the tenant's own catalogue
rows; a browser-sent price is honoured only for a role holding `EDIT_PRICE` and is written to the
audit log. Payments carry method, reference, timestamp, user and status; a short payment leaves a
balance only when the configuration allows part payments, and credit over the configured limit is
refused rather than asked about client-side. Customer credit and supplier credit are separate
ledgers with their own statements. Stock never moves without a `PosInventoryMovement` row carrying
a reason, a signed delta and the actor — sales, refunds, adjustments, transfers, counts, purchases,
production and wastage all leave a trail. Corrections are returns, refunds, adjustments and
reversals: historical transactions are never rewritten.

**Copyable, versioned configuration.** A setup can be copied to another business the same person
owns — by granular scope (capabilities, workflows, terminology, payments, categories, permissions,
dashboard, receipt, rules) or saved as the owner's own template — and 22 built-in templates ship in
`lib/pos/templates.ts` (`RETAIL_BASIC`, `WHOLESALE`, `RESTAURANT`, `SALON`, `HARDWARE`, `GARAGE`,
`FARM`, `MANUFACTURING`, `PRINTING`, …). Transactions, balances, receipt numbers, tenant ids and
credentials are never copied, and a scope that would carry them is **refused by name** rather than
quietly dropped. Every publish appends an immutable `PosConfigurationVersion` that can be rolled
back to by adding a new one.

**Words change, records do not.** Terminology ("Bills" / "Orders" / "Jobs" / "Appointments" /
"Produce" / "Projects", "Guests" / "Clients" / "Vehicle Owners") is presentation only — the entity
structure, the API and the reports are identical across trades.

**Migration.** `prisma/migrations/20261003000000_business_pos/migration.sql` adds 24 `Pos*` tables,
additive only (`CREATE TABLE IF NOT EXISTS`, new foreign keys and indexes, every table keyed and
indexed by `businessId`; no `DROP`, no `ALTER COLUMN`, no data rewrites). As with every migration,
applying it to production is an operator-authorised action performed by the existing deployment gate
(`scripts/build.sh` → `scripts/migrate.sh`); this repository change does not run it.

**Tests.** `tests/unit/pos-engine.test.ts`, `tests/unit/pos-money.test.ts`,
`tests/unit/pos-entitlement.test.ts`, `tests/unit/pos-schema.test.ts`,
`tests/security/pos-tenant-isolation.test.ts`, `tests/security/pos-permissions.test.ts`,
`tests/integration/pos-journey.test.ts`, `tests/integration/pos-api-routes.test.ts`,
`tests/integration/pos-payment-confirmation.test.ts`.
`BUSINESS_POS_IMPLEMENTATION.md` documents the architecture, the request pipeline, the per-route
permission map and what each suite proves.

---

## Tenancy & Security

- Every business-owned row has `businessId` FK; `lib/tenant.ts:assertBusinessOwnership` checks `ownerId`/`BusinessMember` against `session.userId` on every API boundary — never trust client-supplied tenant IDs.
- Admins are role-gated; all admin actions audited.
- Input sanitized (`sanitizeText`), output encoded (React escapes), rate-limited (auth/analytics/webhook in-memory), HSTS/secure headers, bcrypt passwords, JWT httpOnly cookies.
- No fake telephony — V1 does not claim cellular-call redirection.
- Tests: `tests/security/tenant-isolation.test.ts` (negative isolation), `tests/unit/*`, `tests/security/paystack-security.test.ts`.

---

## Pricing

DB-driven `PlanConfig` — admin configures without code changes. Seed: `ANNUAL KES 999/year`, `MONTHLY KES 149/month`, `INTERACTIVE_BUSINESS KES 999/month`, and `BUSINESS_POS KES 499/month` (30 days). Payment flow always derives `amount` from `PlanConfig` (the Interactive and POS amounts are asserted server-side in both checkout and pricing, never read from the browser).

`BUSINESS_POS` and `INTERACTIVE_BUSINESS` are **private** plans: `lib/pricing.ts:publiclyListedPlans()` filters them out of the public landing page, the onboarding plan picker and the customer-facing subscription copy, so they are selectable only from inside the authenticated dashboard. A POS payment settles a `PosSubscription` (not an AFTERCALL `Subscription`), and `GET /api/paystack/verify` answers a POS payment with the `posBusinessId` the callback page uses to return the owner to their own POS — never to a public or AFTERCALL page.

---

## Testing

```bash
npm test            # vitest unit + isolation + paystack + validation + POS suites
npx tsc --noEmit    # typecheck
npm run build       # must pass before deploy
```

The POS suites run against an in-memory Prisma double (`tests/helpers/posFakeDb.ts`) and drive the
real route handlers, so no database or `prisma generate` is needed:
`npx vitest run tests/unit/pos-engine.test.ts tests/integration/pos-api-routes.test.ts`.
`tests/unit/repair-guards.test.ts` reads the raw migration SQL and fails the build if a POS table
loses its `businessId`, if a migration stops being `IF NOT EXISTS`, or if any non-`Pos` table is
altered.

### End-to-end journey (§66)

`tests/e2e/interactive-business-journey.test.ts` walks the whole Interactive journey against a **real**
database: register → business → package → category → configure → product + price + image → preview →
pay KES 999 → verify → activate → publish → public URL → customer order/pay → owner processes → booking →
tenant isolation → lapsed entitlement. It drives the app's own route handlers with the real Prisma client
and is skipped unless `DATABASE_URL` is set.

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/jata_e2e"   # disposable database
npx prisma migrate deploy && npm run seed
npm run test:e2e
```

It runs in CI on every push and pull request
(`.github/workflows/interactive-business-e2e.yml`, PostgreSQL 16 provisioned with
`prisma migrate deploy`) and last completed **17/17 steps**.
See `INTERACTIVE_BUSINESS_E2E_RUNBOOK_2026-10-02.md` for what each step asserts, the schema and
migration defects the first real run exposed, and how to baseline an existing database.

---

## Audit

See `AUDIT.md` (pre-implementation audit).

---

## License

Proprietary — JATA AFTERCALL.
