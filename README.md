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
- `/register` `/login` `/onboarding`
- `/b/[slug]` public page (canonical)
- `/checkout` `/checkout/callback` `/checkout/mock` (dev)
- `/dashboard` `/dashboard/subscription`
- `/admin` `/admin/customers` `/admin/businesses` `/admin/payments` `/admin/subscriptions` `/admin/plans`
- `POST /api/checkout` `GET /api/paystack/verify` `POST /api/paystack/webhook` `POST /api/analytics/event` `GET /api/analytics` `POST/PATCH /api/business` `POST /api/services` `POST /api/offer`

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
