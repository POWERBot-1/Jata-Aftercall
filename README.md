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
- `/b/[slug]` public page (canonical)
- `/checkout` `/checkout/callback` `/checkout/mock` (dev)
- `/dashboard` `/dashboard/subscription`
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
`tests/integration/referral-registration.test.ts`, `tests/security/referral-security.test.ts`,
`tests/security/referral-payment-boundary.test.ts`.

---

## Tenancy & Security

- Every business-owned row has `businessId` FK; `lib/tenant.ts:assertBusinessOwnership` checks `ownerId`/`BusinessMember` against `session.userId` on every API boundary — never trust client-supplied tenant IDs.
- Admins are role-gated; all admin actions audited.
- Input sanitized (`sanitizeText`), output encoded (React escapes), rate-limited (auth/analytics/webhook in-memory), HSTS/secure headers, bcrypt passwords, JWT httpOnly cookies.
- No fake telephony — V1 does not claim cellular-call redirection.
- Tests: `tests/security/tenant-isolation.test.ts` (negative isolation), `tests/unit/*`, `tests/security/paystack-security.test.ts`.

---

## Pricing

DB-driven `PlanConfig` — admin configures without code changes. Seed: `ANNUAL KES 999/year`, `MONTHLY KES 149/month`. Payment flow always derives `amount` from `PlanConfig`.

---

## Testing

```bash
npm test            # vitest unit + isolation + paystack + validation
npx tsc --noEmit    # typecheck
npm run build       # must pass before deploy
```

---

## Audit

See `AUDIT.md` (pre-implementation audit).

---

## License

Proprietary — JATA AFTERCALL.
