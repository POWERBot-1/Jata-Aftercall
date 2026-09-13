# JATA AFTERCALL V1 — AUDIT REPORT

**Date:** 2026-09-13 UTC  
**Repository:** `POWERBot-1/Jata-Aftercall`  
**Branch audited:** `arena/01a09b84-jata-aftercall` (from `main` @ `c76d3b5af088aa374c6adbeaffb8709776de6cd0`)  
**Auditor:** Arena Agent (AUDIT phase — no implementation)  
**Spec version:** JATA AFTERCALL V1 Build Specification (sections 1–53 + 26A)  
**Mode:** AUDIT ONLY — no commits, pushes, PRs or merges per §52/§27

---

## 0. Executive Summary

The repository is **empty / greenfield**. There is no existing application code.

```
c76d3b5 Initial commit
 └── README.md  ("# Jata-Aftercall")
```

This is the **ideal starting condition** for JATA AFTERCALL V1:

- **No legacy stack to unwind.**
- **No existing database, tenant model, auth, payment or deployment config to retrofit.**
- **No secrets in Git.**
- **No accidental entanglement with JATA Qi** (per §27 — isolation required and currently satisfied).
- All choices can be made to satisfy **zero-cost / no-domain / no-VPS** (§26A), **serverless free hosting**, **tenant isolation**, **defense-in-depth security** (§10) and **Paystack → JATA ATLAS merchant 2006074** routing.

**Bottom line:** V1 will be a clean build on a greenfield repo. Risk is *overbuilding* (§29, §51), not legacy debt. The audit recommends a **Next.js + Prisma + Postgres (free-tier Neon/Supabase) + Auth.js** serverless architecture deployable to **Vercel or Cloudflare Pages** on a provider-generated `*.vercel.app` / `*.pages.dev` HTTPS URL, with **path-based routing `/b/:slug`** as the universal fallback (§26A, §38).

> No implementation, commit, push, PR or merge has been performed in this audit. Authorization is requested before any code is written.

---

## 1. Repository & Workspace

| Item | Finding |
|------|---------|
| **Git remote** | `https://github.com/POWERBot-1/Jata-Aftercall.git` |
| **Default branch** | `main` |
| **Audited branch** | `arena/01a09b84-jata-aftercall` |
| **Base commit** | `c76d3b5af088aa374c6adbeaffb8709776de6cd0` — grafted shallow, single commit |
| **Working tree** | clean, 1 file (`README.md`) |
| **Workspace root** | `/home/user/Jata-Aftercall` inside E2B sandbox `is0gh8sn6gg4sefbgnmuc` (Debian 12) |
| **Node toolchain** | Node `v22.22.3`, npm `10.9.8` available; `gh` authenticated as `arena-ai-coding-agent[bot]` |
| **Ignored artefacts** | Snapshot excludes `node_modules`, `.next`, `dist`, etc. (per sandbox rules — compatible with Next.js) |

---

## 2. Existing Stack (§52.2)

**None.** Verification:

```bash
ls -R → only README.md + .git
cat package.json → not found
cat *.config.* , tsconfig.json, next.config.* → not found
find . -name "*.js" "*.ts" "*.py" → none (outside .git)
```

No `package.json`, no framework, no bundler, no ORM, no linter.

**Implication:** Stack can be chosen freely. Audit recommends the cheapest viable zero-cost stack (§16).

---

## 3. Existing Architecture & Infrastructure Reuse (§52.3, §2.7)

| Layer | Existing | Reusable? |
|-------|----------|-----------|
| Frontend framework | none | — |
| Backend/API | none | — |
| Database | none | — |
| ORM/Migrations | none | — |
| Auth/Sessions | none | — |
| Public page renderer | none | — |
| Dashboard/Admin | none | — |
| File/media handling | none | — |
| Analytics pipeline | none | — |
| Deployment config (`vercel.json`, `wrangler.toml`, `Dockerfile`, `fly.toml`) | none | — |
| CI/CD (`.github/workflows`) | none | — |
| Env template (`.env.example`) | none | — |

**Reusable infrastructure:** The only reusable items are GitHub hosting itself and the Arena AI ingress (`E2B`). No application infrastructure exists to preserve. This satisfies §27 isolation from JATA Qi — no cross-pollination detected.

---

## 4. Existing Authentication (§52.4)

**None.** No `next-auth`, `lucia`, `passport`, `supabase-auth`, JWT utilities, password hashing, session tables, middleware or auth tests exist.

Security implication: Authorization must be built defense-in-depth from day one (§10, §43). No bypass risk from legacy auth.

---

## 5. Existing Database (§52.5)

**None.** No `DATABASE_URL`, `schema.prisma`, `drizzle.config`, `knexfile`, migrations folder, SQLite file, or Postgres connection code exists.

No tenant-related tables exist (no `USER`, `BUSINESS`, etc.). Greenfield.

---

## 6. Existing Tenant Model (§52.6, §9, §11)

**None.** No multi-tenancy code, no `business_id` foreign keys, no row-level isolation, no middleware scoping.

Audit note: This is the **highest-risk area** for a future SaaS (§9, §43). Since we start greenfield we can enforce **explicit `businessId` on every business-owned row** and **server-side tenant checks on every API route**, rather than bolting it on later. IDOR/BOLA tests must exist from day one.

---

## 7. Existing Deployment Configuration (§52.7, §26A, §49)

**None.** No `vercel.json`, `wrangler.toml`, `Procfile`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/deploy.yml`, `next.config.js` or health endpoint.

Hosting is therefore unconstrained. The audit proposes a **zero-cost serverless/static** deployment per §26A (see §16 below) rather than introducing a VPS.

---

## 8. Existing Payment-Related Code (§52.8, §34)

**None.** Full-text search for `paystack`, `payment`, `subscription`, `pay`, `m-pesa`, `mpesa`, `checkout`, `webhook` returns zero hits outside `README.md`.

No Paystack public/secret keys, no webhook handler, no subscription table, no pricing config.

This is correct for audit phase: no speculative payment scaffolding has been created.

---

## 9. Existing Environment / Secrets Handling (§52.9, §10)

| Check | Result |
|-------|--------|
| `.env` committed? | No file exists; `git ls-files` shows only `README.md` |
| `.env.example` exists? | No |
| Hardcoded secrets (`sk_`, `paystack`, `DATABASE_URL`, API keys) | None found |
| `.gitignore` exists? | No — must be created to exclude `.env*`, `*.pem`, etc. |
| Secrets in Git history (`git log -p`) | None — single commit with 1 line |

Audit requires: create `.env.example` (template) + `.gitignore` + documentation that **secrets are only via env/secrets**, never committed (§10, §53 notes Paystack secret must stay server-side).

---

## 10. Existing Public-Page Architecture (§52.10, §4, §5, §14, §18, §19, §20)

**None.** No route `/b/[slug]` or sub-domain handler, no theme system, no SEO/Open Graph generation, no sticky CTA bar, no CTA deep-links (`https://wa.me/`, `tel:`, `https://maps.google.com`).

No demo data (§24) — no `Nyumbani Kitchen`, `Mary's Beauty Studio`, etc.

This is the product's primary surface (§4: "The public page is the most important part"). Building it fast, mobile-first, minimal-JS is critical to §19 performance & §5 conversion.

---

## 11. Existing Admin / Customer Dashboard Capability (§52.11, §7, §36, §39)

**None.** No `/dashboard`, `/admin`, `/login`, `/register` routes; no role model (`USER` vs `ADMIN` vs `BUSINESS_MEMBER`). Must be built per §36 (customer dashboard) and §39 (owner/admin panel) with strict authorization separation.

---

## 12. Existing Tests (§52.12, §25)

**None.** No `vitest`, `jest`, `playwright`, `cypress`, `__tests__`, `spec.*` files.

§25 and §43 require **unit + integration + security + E2E** suites. Since greenfield, test harness can be introduced cleanly from start (Vitest + Playwright recommended for Next.js).

---

## 13. Existing Security Controls (§52.13, §10)

**None.** No rate limiter, CSRF token handler, helmet/secure headers, input sanitization, output encoding, XSS guards, audit logging, authorization middleware, dependency audit config.

Must be implemented per §10 checklist and tested explicitly for the 8 attack classes listed.

---

## 14. Exact Files/Components That Would Need Modification (§52.14 + §30.7)

Since the repo is empty, the audit lists **files to be created** (no modifications). This is the complete patchset footprint for authorized implementation — kept minimal per §1 / §29:

### A. Project scaffolding
```
package.json
tsconfig.json
next.config.js                 // PUBLIC_BASE_URL abstraction, image domains, headers
tailwind.config.ts
postcss.config.js
.env.example                   // DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL,
                               // PUBLIC_BASE_URL, PAYSTACK_SECRET_KEY,
                               // PAYSTACK_PUBLIC_KEY, PAYSTACK_MERCHANT_ID=2006074,
                               // ADMIN_EMAILS
.gitignore
eslint.config.js (or .eslintrc)
```

### B. Database & ORM
```
prisma/schema.prisma           // USER, BUSINESS, BUSINESS_MEMBER, BUSINESS_PROFILE,
                               // SERVICE, OFFER, ANALYTICS_EVENT, PAGE_THEME,
                               // SUBSCRIPTION, PAYMENT, PLAN_CONFIG, AUDIT_EVENT,
                               // VERIFICATION_TOKEN? + InteractionEvent abstraction
prisma/migrations/*           // generated via `prisma migrate`
lib/db.ts                      // PrismaClient singleton
lib/tenant.ts                  // requireTenant(), assertOwnership() helpers
```

### C. Auth
```
lib/auth.ts                    // Auth.js / NextAuth config OR lucia+jwt
lib/password.ts                // bcrypt hashing if credential provider used
middleware.ts                  // protect /dashboard/*, /admin/*, /api/*
app/(auth)/login/page.tsx
app/(auth)/register/page.tsx
app/(auth)/logout/route.ts
app/api/auth/[...nextauth]/route.ts  // if using Auth.js
```

### D. Core domain logic
```
lib/slug.ts                    // slugify, uniqueness, collision protection
lib/pricing.ts                 // plans from DB/config, not hardcoded (§16, §32)
lib/analytics.ts               // recordEvent(), privacy-preserving
lib/paystack.ts                // server-only client: initialize, verify, webhook verify
lib/interactionEvent.ts        // InteractionEvent abstraction for V2 (§21, §48)
lib/seo.ts                     // generateMetadata for /b/[slug]
lib/themes.ts                  // 3 theme definitions: clean / dark / warm
```

### E. Public surfaces (§4, §32, §33)
```
app/page.tsx                   // Sales landing page (§32) — "Turn every interaction..."
app/b/[slug]/page.tsx          // Public business page (mobile-first, sticky CTA, SEO)
app/b/[slug]/opengraph-image.tsx // OG image (optional, for share previews)
components/public/*             // Hero, CTA bar, OfferCard, ServiceList, About, Map
components/themes/*             // Theme1Clean, Theme2Dark, Theme3Warm
app/health/route.ts            // GET /health — DB check (§26)
app/sitemap.ts + app/robots.ts // SEO
```

### F. Onboarding / self-service (§33–§38)
```
app/onboarding/page.tsx        // Business info form (name, category, phones, location, desc)
app/onboarding/services/page.tsx
app/onboarding/offer/page.tsx
app/onboarding/preview/page.tsx
app/onboarding/checkout/page.tsx // or app/checkout/[plan]/page.tsx — Paystack init
app/api/checkout/route.ts      // server: create Paystack transaction + Payment PENDING
app/api/paystack/webhook/route.ts // signature verify + idempotency + subscription activation
app/api/paystack/verify/route.ts  // polling fallback (reference lookup)
```

### G. Customer dashboard (§36)
```
app/dashboard/layout.tsx       // auth guard + tenant scope
app/dashboard/page.tsx         // overview: status LIVE, metrics, quick actions
app/dashboard/business/page.tsx
app/dashboard/page-preview/page.tsx
app/dashboard/services/page.tsx
app/dashboard/offer/page.tsx
app/dashboard/analytics/page.tsx
app/dashboard/subscription/page.tsx // plan, status, expiry, renew CTA, history
app/dashboard/settings/page.tsx
app/api/business/route.ts      // CRUD scoped to tenant
app/api/services/route.ts
app/api/offer/route.ts
app/api/analytics/route.ts     // scoped read
app/api/analytics/event/route.ts // POST from public page CTA clicks
```

### H. Admin / Owner panel (§39)
```
app/admin/layout.tsx           // admin role guard + audit logging
app/admin/page.tsx             // aggregate metrics overview
app/admin/customers/page.tsx
app/admin/businesses/page.tsx
app/admin/payments/page.tsx
app/admin/subscriptions/page.tsx
app/admin/plans/page.tsx       // configure pricing (no code changes) (§16, §32)
app/admin/health/page.tsx
app/api/admin/*                // all admin endpoints — authorized + audited
lib/audit.ts                   // log AUDIT_EVENT for privileged ops
```

### I. Static / styling / PWA
```
app/globals.css                // Tailwind + premium typography (§23)
public/manifest.json           // PWA manifest (installable, but not required) (§20)
public/icons/*                 // PWA icons (optional minimal)
```

### J. Tests (§10, §25, §43) — created but not counted as bloat
```
tests/unit/*                   // business creation, service, offer, auth, tenant, analytics
tests/integration/*            // register→business→publish→CTA→analytics→edit→update
tests/security/*               // cross-tenant, IDOR, XSS, auth bypass, rate limit, webhook abuse
tests/e2e/*                    // Playwright: §25 E2E flow (WHAT→WP→Call→Directions→Analytics)
vitest.config.ts
playwright.config.ts
```

### K. Deployment & Docs (§26)
```
DEPLOYMENT.md                  // zero-cost path: GitHub → Vercel/Pages → provider URL
                               // + env vars table, cost gates, rollback, domain upgrade path
.env.example already covers DATABASE_URL, etc.
README.md (expanded)           // 5-min creation guide + demo URLs
```

**No existing files are modified** except `README.md` (expanded). `.git` must not be deleted/moved per workspace rules.

---

## 15. Risks & Dependencies (§52.15)

### Confirmed risks (greenfield = low legacy risk, but product risk remains)

| # | Risk | Severity | Mitigation proposed |
|---|------|----------|---------------------|
| **R1** | **Tenant isolation failure** — customer A reading/editing business B, viewing B's analytics, IDOR via `businessId` param | **Critical** | Every business-owned table has `businessId` FK; helper `requireTenant(businessId, session)` on **every** API route + middleware; **never trust frontend IDs**; Playwright + unit tests for §10 cases before shipping |
| **R2** | **Payment fraud** — frontend claims "paid", query-param tampering, replayed webhook, wrong amount/currency | **Critical** | **Server-side verification only** (§34): `GET https://api.paystack.co/transaction/verify/:reference` with secret; webhook `x-paystack-signature` HMAC verification; idempotency on `reference`/`eventId`; amount & currency server-validated; no hardcoded secret in frontend |
| **R3** | **Webhook abuse / replay** | High | Signature verify + store `processedWebhookIds` set; return 200 only after idempotent handling; rate limit webhook endpoint; log `AUDIT_EVENT` |
| **R4** | **Overbuilding** (§1, §29) — building CRM/ecommerce/chatbot instead of smallest sellable after-interaction page | High | Enforce §1 "DO NOT BUILD" list in code review; smallest coherent patchset; demo test: "create page in <5 min" |
| **R5** | **Secrets leakage** — committing `PAYSTACK_SECRET_KEY`, `DATABASE_URL`, `NEXTAUTH_SECRET` | High | `.gitignore` + `.env.example` only; `npm run audit` / `gitleaks` in CI; env injected via Vercel/Cloudflare dashboard, never in repo |
| **R6** | **Free-tier limits** — Neon/Supabase free tier row/connection caps, Vercel/Cloudflare function execution limits | Medium | Design for managed serverless (§26A); document limits in `DEPLOYMENT.md`; cost gate before adding paid infra; DB connection pooling via Prisma + PgBouncer (Neon) or D1's edge SQLite |
| **R7** | **XSS via business name/description/offer** — malicious HTML/JS rendered on public page (§10) | High | Input sanitization + output encoding (React auto-escapes; no `dangerouslySetInnerHTML` without sanitize); CSP headers; test XSS payloads in security suite |
| **R8** | **Rate-limit abuse** — scraping public pages, brute-force login/register, spamming analytics | Medium | Rate limit auth & webhook & analytics-event routes (Upstash Redis free or in-memory for MVP); CAPTCHA deferred per zero-cost but noted as future |
| **R9** | **Slug collision / path traversal** — `../`, unicode, reserved words (`admin`, `api`, `b`, `dashboard`) | Medium | Slug validation: `^[a-z0-9-]{3,50}$`, blocklist reserved slugs, uniqueness DB constraint, 409 on collision, normalize via `slugify` |
| **R10** | **Scope creep on custom domain** — hardcoding `jata.link` and breaking provider URL fallback | Medium | Single `PUBLIC_BASE_URL` env var; URL generation via `getPublicUrl(slug)` helper; support both `https://domain/b/slug` (MVP) and future `https://slug.domain` via config, never hardcoded (§26A) |

### Dependencies

- **External:** Paystack API + webhooks (requires public HTTPS URL — provided by Vercel/Pages free domain), managed Postgres (Neon free or Supabase free) OR Cloudflare D1, free hosting provider (Vercel or Cloudflare Pages). All have documented free tiers.
- **Internal:** Node 22 available in sandbox and on providers; Prisma, Next.js, Auth.js all support serverless/edge. No VPS dependency.

---

## 16. Cheapest Viable Deployment Architecture (§52.16, §26A, §26, §49)

### Zero-cost MVP — no domain, no VPS, no paid SSL

```
Developer pushes to GitHub (arena/01a09b84-jata-aftercall)
        ↓
Managed hosting — choose ONE (both free):
  Option A: Vercel (recommended for Next.js)
    vercel.com → Import GitHub repo → auto-build → https://jata-aftercall.vercel.app
  Option B: Cloudflare Pages + Functions
    pages.dev → Connect GitHub → https://jata-aftercall.pages.dev
        ↓
Provider-generated HTTPS URL — valid SSL automatically
        ↓
Serverless functions handle:
  - /b/[slug] (SSR/ISR public page)
  - /api/* (auth, CRUD, analytics, paystack webhook)
  - /dashboard/*, /admin/* (SSR with auth guard)
        ↓
Managed DB — free tier:
  Option A: Neon Postgres (free: 0.5GB, 1 project, pooling built-in) → DATABASE_URL
  Option B: Supabase Postgres (free: 500MB, 2 projects) → DATABASE_URL
  Option C: Cloudflare D1 (free: 5GB SQLite, edge) — if using Cloudflare Pages
        ↓
Analytics: own ANALYTICS_EVENT table (no paid provider) (§8, §26A)
Media: V1 minimal or Cloudinary free tier / Vercel Blob free tier if logos needed;
       alternatively store as URL string only in V1 to avoid ephemeral disk reliance (§26A)
Auth: Auth.js with DB sessions (works serverless, no self-hosted auth server) (§26A)
```

**What is free vs paid (§26A documentation requirement):**

| Component | MVP (free) | Limits | Future paid |
|-----------|------------|--------|-------------|
| Hosting (Vercel/Pages) | ✅ Free | 100GB bandwidth/mo, 6k execution hrs | Pro plan if traffic grows; custom domain later |
| HTTPS/SSL | ✅ Auto via provider | — | — |
| DB (Neon/Supabase/D1) | ✅ Free tier | ~0.5GB storage, connection limits | Scale to paid tier |
| Auth | ✅ Self-contained | — | Optional paid email provider later |
| Paystack | Paystack account is merchant's | Per-transaction fee (borne by merchant) | Same — not infra cost |
| Domain `jata.link` | ❌ Optional later | Requires purchase + DNS | KES ~1,500/yr |
| VPS | ❌ Not required | — | Only if justified (§26A) |
| WhatsApp Business API | ❌ Not required V1 | — | Later V2/V3 |
| SMS | ❌ Not required V1 | — | Later V2 |

**Cost gate (§26A):** Before adding any paid infra, document why free alternative insufficient, monthly cost, and whether it can wait until revenue exists. V1 must not incur recurring hosting costs.

**How wildcard vs path routing is solved without a domain:**

```ts
// lib/url.ts — DOMAIN ABSTRACTION (§26A)
export function getBusinessUrl(slug: string): string {
  const base = process.env.PUBLIC_BASE_URL!; // e.g. https://jata-aftercall.vercel.app
  // MVP: always use path-based — guarantees compatibility with provider domain
  return `${base}/b/${slug}`;
  // Future: if CUSTOM_DOMAIN with wildcard DNS is configured, switch to:
  // return `https://${slug}.${new URL(base).host}`;
}
```

No `jata.link` string is hardcoded. SEO canonicals, OG URLs, sitemap and share-preview all call this helper.

**Health & rollback (§26):**

- `GET /health` returns `{ status: "ok", db: "up", version }` — used by deployment checks.
- Rollback = `git revert` + Vercel/Pages automatic previous deployment restore (one click).

---

## 17. Paystack Integration Points (§52.17)

### Designated merchant

- **Business:** JATA ATLAS
- **Paystack Merchant ID:** `2006074` — treated as **configuration**, not secret (§53)
  - Env var: `PAYSTACK_MERCHANT_ID=2006074` (or `NEXT_PUBLIC_PAYSTACK_MERCHANT_ID` if needed for display — never secret)
  - Secret/public keys: `PAYSTACK_SECRET_KEY` (server only), `PAYSTACK_PUBLIC_KEY` (client for inline checkout if needed) — via env/secrets dashboard, never in code

### No existing payment infra — full integration must be created

| Concern | Implementation point | File(s) | Verification |
|---------|----------------------|---------|--------------|
| **Initialize transaction** | `POST /api/checkout` (server) creates `PAYMENT` row `PENDING`, then `POST https://api.paystack.co/transaction/initialize` with `amount` (kobo), `email`, `reference` (uuid), `callback_url`, `metadata: { businessId, userId, planId }`. Returns `authorization_url` to frontend. | `lib/paystack.ts`, `app/api/checkout/route.ts` | Never trust frontend amount; compute from `PLAN_CONFIG` |
| **Callback / verification** | Server calls `GET https://api.paystack.co/transaction/verify/:reference` with secret. Only on `status===success` && `amount===expected` && `currency===KES` (or NGN if Paystack KES not configured — must document) does subscription become `ACTIVE`. | `app/api/paystack/verify/route.ts`, `lib/paystack.ts` | Amount/currency validated server-side |
| **Webhook** | `POST /api/paystack/webhook` — verify `x-paystack-signature` = `HMAC-SHA512(secret, rawBody)`. Process `charge.success`, `charge.failed`, `refund.processed`. Idempotent via `Payment.reference` unique + `AuditEvent` + `processedEventIds`. | `app/api/paystack/webhook/route.ts` | Signature required; idempotent; safe failure |
| **Ownership mapping** | `reference` ties to `PAYMENT(id, reference UNIQUE, userId, businessId, planId, amount, status)`; on success create/update `SUBSCRIPTION` bound to `businessId`. | `prisma/schema.prisma`, `lib/paystack.ts` | Correct customer/business association |
| **Admin visibility** | Admin panel shows `PAYMENT` rows (reference, amount, status, date, business) without exposing secret keys. | `app/admin/payments/page.tsx` | No sensitive credentials exposed |
| **Zero-cost hosting fit** | Serverless function can receive POST webhooks on provider HTTPS URL; Paystack webhook URL set to `https://<provider-domain>/api/paystack/webhook`. No VPS required. Tested on Vercel/Cloudflare — both accept external POST. | `DEPLOYMENT.md` | Verified in docs — serverless supports webhooks |
| **Duplicate prevention** | `reference` has DB unique constraint; `SUBSCRIPTION` extension wrapped in transaction; re-delivered event finds existing `PAID` row and skips extension. | `lib/paystack.ts` | Explicit test: double webhook = one extension |

### Flow diagram (§35 preferred flow)

```
GET / (sales page) → GET /register → POST /api/auth/register → Business form
        ↓
POST /api/checkout { planId }  →  PAYMENT PENDING  →  redirect to Paystack authorization_url
        ↓                                    |
Paystack checkout (hosted by Paystack)       |
        ↓                                    |
   callback to /checkout/success?reference=… → POST /api/paystack/verify
        ↓                                    ↓ (also webhook)
  verify server-side → if success → SUBSCRIPTION ACTIVE → redirect /onboarding/preview
        ↓ else FAILED → show "Payment unsuccessful [Try Again]"
        ↓
Preview → Publish → Public URL https://provider-domain/b/slug → Dashboard
```

V1 enforces: **no ACTIVE subscription without verified PAID payment** (§35, §44). Unpaid → page not published / `SUSPENDED` state.

### Environment variables required

```
# not committed — documented in .env.example
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000  # or provider URL in prod
PUBLIC_BASE_URL=http://localhost:3000
PAYSTACK_SECRET_KEY=sk_test_***      # server only — from Paystack dashboard for JATA ATLAS 2006074
PAYSTACK_PUBLIC_KEY=pk_test_***      # safe to expose for inline checkout
PAYSTACK_MERCHANT_ID=2006074
```

Never request the secret in chat, never commit it, never log raw webhook body with secrets.

---

## 18. Proposed Data Model Changes (§52.18, §11)

Current DB: **empty** — all entities are new. Small, tenant-aware schema per §11 + §34–§40:

### Prisma sketch (authoritative schema will be in `prisma/schema.prisma`)

```prisma
// ───────────────── CORE ─────────────────
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  phone         String?
  passwordHash  String?   // bcrypt if credential auth; nullable if OAuth later
  role          Role      @default(CUSTOMER) // CUSTOMER | ADMIN
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  businesses    BusinessMember[]
  payments      Payment[]
  auditEvents   AuditEvent[]
}

enum Role { CUSTOMER ADMIN }

model Business {
  id           String         @id @default(cuid())
  ownerId      String         // User id of owner (creator)
  owner        User           @relation(fields: [ownerId], references: [id])
  slug         String         @unique // URL-safe, 3–50, blocklist reserved
  name         String
  category     String         // enum per §14 but stored as string for flexibility
  phone        String?
  whatsapp     String?        // E.164 or 07...
  location     String?        // human-readable + optional lat/lng
  lat          Float?
  lng          Float?
  description  String?        @db.Text
  logoUrl      String?
  coverUrl     String?
  language     String?        // en / sw / sheng copy preference
  theme        String         @default("clean") // clean | dark | warm
  aftercallMsg String?        // "Thanks for contacting us 👋" (customizable) §6
  isPublished  Boolean        @default(false)
  status       BusinessStatus @default(PENDING) // PENDING | ACTIVE | SUSPENDED
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  profile      BusinessProfile?
  services     Service[]
  offer        Offer?
  events       AnalyticsEvent[]
  subscription Subscription?
  payments     Payment[]
  members      BusinessMember[]

  @@index([ownerId])
}

enum BusinessStatus { PENDING ACTIVE SUSPENDED }

model BusinessMember {
  id         String   @id @default(cuid())
  userId     String
  businessId String
  role       String   @default("OWNER") // OWNER | MEMBER (future)
  user       User     @relation(fields: [userId], references: [id])
  business   Business @relation(fields: [businessId], references: [id])
  createdAt  DateTime @default(now())
  @@unique([userId, businessId])
}

model BusinessProfile {
  id         String   @id @default(cuid())
  businessId String   @unique
  business   Business @relation(fields: [businessId], references: [id])
  // denormalized cache if needed — primarily Business holds core fields
  // kept for §11 conceptual parity; can be merged into Business in V1 to keep schema small
  openingHours String? // JSON string: { mon: "9-5", ... }
  socialLinks  String? // JSON: { facebook, instagram, tiktok, googleBusiness }
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model Service {
  id          String   @id @default(cuid())
  businessId  String
  business    Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  title       String
  description String?  @db.Text
  priceFrom   Int?     // store kobo/cents or KES integer; display "From KES 1,500"
  priceLabel  String?  // "From KES 1,500" preformatted if owner prefers
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  @@index([businessId])
}

model Offer {
  id         String    @id @default(cuid())
  businessId String    @unique
  business   Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)
  title      String    // "Braids from KES 1,500"
  subtitle   String?   // "This week only"
  validUntil DateTime?
  isActive   Boolean   @default(true)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}

model PageTheme {
  id        String   @id @default(cuid())
  key       String   @unique // clean | dark | warm
  name      String
  config    String   @db.Text // JSON: colors, fonts, spacing
}

model AnalyticsEvent {
  id         String   @id @default(cuid())
  businessId String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  eventType  String   // PAGE_VIEW | WHATSAPP_CLICK | CALL_CLICK | DIRECTION_CLICK | SHARE_CLICK | SERVICE_CLICK
  source     String?  // referrer / utm / InteractionEvent.source later
  ipHash     String?  // privacy-preserving hash, not raw IP
  userAgent  String?
  createdAt  DateTime @default(now())
  @@index([businessId, eventType])
  @@index([businessId, createdAt])
}

model PlanConfig {
  id          String   @id @default(cuid())
  key         String   @unique // BASIC | ANNUAL | TRIAL
  name        String   // "Basic — KES 99/month" (display, admin-editable)
  priceKES    Int      // in KES (or kobo if needed for Paystack)
  durationDays Int     // 30 / 365
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Subscription {
  id         String             @id @default(cuid())
  businessId String             @unique
  business   Business           @relation(fields: [businessId], references: [id], onDelete: Cascade)
  userId     String
  planId     String
  plan       PlanConfig         @relation(fields: [planId], references: [id])
  status     SubscriptionStatus @default(PENDING)
  startAt    DateTime?
  expiresAt  DateTime?
  graceUntil DateTime?          // configurable grace per §40
  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @updatedAt
}

enum SubscriptionStatus { PENDING ACTIVE EXPIRING EXPIRED SUSPENDED CANCELLED }

model Payment {
  id         String        @id @default(cuid())
  reference  String        @unique // Paystack reference (uuid)
  businessId String?
  business   Business?     @relation(fields: [businessId], references: [id])
  userId     String
  user       User          @relation(fields: [userId], references: [id])
  planId     String?
  amount     Int           // in kobo/lowest unit as sent to Paystack
  currency   String        @default("KES") // or NGN — document actual Paystack currency
  status     PaymentStatus @default(PENDING)
  paystackId String?       // Paystack transaction id
  raw        String?       @db.Text // safe JSON subset (no card/PIN data)
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt
  @@index([userId])
  @@index([businessId])
}

enum PaymentStatus { PENDING PAID FAILED REFUNDED EXPIRED CANCELLED }

model AuditEvent {
  id         String   @id @default(cuid())
  actorId    String?  // User id performing action (null for system/webhook)
  actor      User?    @relation(fields: [actorId], references: [id])
  action     String   // e.g. "BUSINESS_SUSPEND", "PAYMENT_VERIFIED", "SUBSCRIPTION_EXTENDED"
  targetType String?  // "BUSINESS" | "PAYMENT" | ...
  targetId   String?
  metadata   String?  @db.Text // safe JSON
  createdAt  DateTime @default(now())
  @@index([actorId])
}

model ProcessedWebhook {
  id        String   @id // Paystack event id or reference
  createdAt DateTime @default(now())
}

// ───────────────── FUTURE ABSTRACTION (no table needed V1, but contract reserved) ─────────────────
// InteractionEvent interface per §21 / §48 — stored as AnalyticsEvent with source/eventType today;
// later promoted to dedicated table if call-event delivery is integrated. Design:
// { businessId, eventType: CALL_COMPLETED|CALL_MISSED|WHATSAPP_CLICK|QR_SCAN|SOCIAL_CLICK|DIRECT_VISIT,
//   timestamp, source, destinationPage, metadata: JSON }
```

**Design notes:**

- Every business-owned record has explicit `businessId` FK for tenant isolation (§11).
- `Business.slug` unique constraint enforces URL safety; reserved list enforced in service layer.
- `Payment.reference` unique + `ProcessedWebhook` idempotency table prevents double activation (§34, §42).
- `PlanConfig` in DB makes pricing admin-configurable, not hardcoded (§16, §32, §39).
- `BusinessProfile` kept minimal or merged — audit recommends keeping it as a JSON holder or merging into `Business` to stay "small" per §1, with option to normalize later.
- No secrets, no card data, no M-PESA PINs stored — per §34.

---

## 19. Proposed Onboarding State Machine (§52.19, §33–§37, §40–§45)

### Customer-facing state machine

```
[UNREGISTERED]
    │ POST /api/auth/register (name,email,phone,password)
    ▼
[ACCOUNT_CREATED]  ── authenticated, no business yet
    │ POST /api/business { name,category,phone,whatsapp,location,description? }
    ▼
[BUSINESS_DRAFT]   ── Business row PENDING, slug reserved, not published
    │ Step 2: chose theme  PUT /api/business/theme
    │ Step 3: add services POST /api/services (optional, can be empty)
    │ Step 4: add offer    POST /api/offer   (optional)
    ▼
[BUSINESS_READY_FOR_PAYMENT]  ── preview available at /onboarding/preview (private)
    │ POST /api/checkout { planId } → PAYMENT PENDING → Paystack authorization_url
    ▼
[PAYMENT_PENDING]   ── PAYMENT row PENDING, user on Paystack hosted page
    │ Paystack callback ?reference=  → GET /api/paystack/verify?reference=
    │  ├─ success (server-verified amount/currency) → SUBSCRIPTION ACTIVE
    │  └─ failed/cancelled → PAYMENT FAILED → remains BUSINESS_READY_FOR_PAYMENT (retry)
    │ Also: POST /api/paystack/webhook (async) — same outcome, idempotent
    ▼
[SUBSCRIPTION_ACTIVE]  ── Subscription ACTIVE, Business ACTIVE, preview → publish allowed
    │ POST /api/business/publish { isPublished: true }
    ▼
[PUBLISHED]  ── Public URL https://provider-domain/b/slug LIVE (§38), indexed, analytics enabled
    │ dashboard: edit → saves as draft → republish → public page updates (§7)
    │ expiry checker (cron/interval): if now >= expiresAt - grace → EXPIRING
    ▼
[EXPIRING] → [EXPIRED] → [SUSPENDED]  (per §40)
    │ any point: dashboard [Renew] → new PAYMENT PENDING → verify → extend expiresAt → ACTIVE
    │ data preserved; public page behavior configurable: show "expired" banner or 404 (§40)
```

### Abandoned / failed states (§44, §45)

- **Incomplete onboarding** (ACCOUNT_CREATED or BUSINESS_DRAFT w/o payment): preserved, admin sees "Incomplete onboarding / Payment pending" (§45). User can resume login → redirected to next incomplete step. No public page exposed (isPublished=false).
- **Payment failed:** PAYMENT FAILED row kept; BUSINESS not ACTIVE; UI shows "Payment unsuccessful — Your business page has not been activated [Try Again]" (§44). Onboarding data retained for retry; no new business row needed.
- **No automatic deletion** on expiry (§40): Business + Subscription rows kept; page hidden/suspended but data intact for renewal.

### Subscription lifecycle (detail per §40–§41)

```
PENDING → ACTIVE (on verified PAID)
ACTIVE  → EXPIRING  (cron: expiresAt - 7 days, configurable)
EXPIRING → EXPIRED  (now > expiresAt)
EXPIRED → SUSPENDED (now > graceUntil, public page disabled)
SUSPENDED → ACTIVE  (renewal payment verified → expiresAt = now + plan.durationDays)
```

Cron can be a Vercel Cron Job (free monthly) or a serverless function triggered via webhook; V1 fallback is **lazy evaluation on read**: every request to `/dashboard` or `/b/slug` evaluates `isExpired()` without requiring a persistent worker — zero VPS (§26A).

---

## 20. Test Strategy (§52.20, §10, §25, §43)

### Tooling (zero-cost, works on free hosting)

- **Unit:** Vitest (`vitest run --coverage`)
- **Integration:** Vitest + `next/test` or Node `fetch` against serverless dev server
- **E2E:** Playwright (Chromium in CI)
- **Security helpers:** `supertest`, custom HMAC helper for webhook, XSS payload list (OWASP)

### Test plan — maps to §10 eight claims, §25 suites, §43 self-service security

#### A. Unit (§25)

| Area | Cases |
|------|-------|
| `slug.ts` | valid / invalid / reserved (admin/api/b/dashboard) / collision / unicode / length 50 |
| `pricing.ts` | plan fetch from DB, inactive plan rejected, amount computed server-side |
| `tenant.ts` | `requireTenant` rejects mismatched `businessId` |
| `lib/paystack.ts` | HMAC verification, amount/currency mismatch rejection, idempotency |
| `auth` | bcrypt hashing, session creation, role check |
| `analytics.ts` | event recorded with correct businessId, privacy hash |

#### B. Integration (§25)

```
register → create business → add service → add offer → preview → checkout (mock Paystack)
→ webhook PAID → subscription ACTIVE → publish → GET /b/slug returns 200 + correct HTML
→ POST /api/analytics/event (WHAT/CALL/DIRECTION) → dashboard metrics increment
→ edit business → republish → public page reflects change
```

Each step asserts **tenant-scoped DB rows**.

#### C. Security — 8 required cases (§10) + §43 expanded

| # | Spec case | Test |
|---|-----------|------|
| 1 | unauthorized page editing | Customer A `PUT /api/business/:businessB` → 403, audit logged |
| 2 | cross-tenant data access | Customer A `GET /api/business/:businessB` and `/api/analytics?businessId=B` → 403 |
| 3 | IDOR | enumerate `businessId` cuid values, attempt to read/update/publish B → 403 |
| 4 | malicious business-name input | POST `{ name: "<script>alert(1)</script>" }` → stored escaped, rendered safe (no script execution, no `dangerouslySetInnerHTML` bypass) |
| 5 | XSS payloads | OWASP set (`"><svg onload=…>`, `javascript:` urls, etc.) on name/desc/offer/social → assert encoded output, CSP header present |
| 6 | unauthorized analytics access | A cannot `GET /api/analytics?businessId=B`; admin can (role-gated) |
| 7 | authentication bypass | unauthenticated `GET /dashboard`, `POST /api/business`, `GET /admin/*` → 401/redirect to /login |
| 8 | rate-limit behavior | 100 rapid `POST /api/auth/register` → 429 after threshold; webhook rate limit likewise |

Plus §43 additional:

- Customer cannot mark own payment as `PAID` via `POST /api/paystack/verify` with fake reference → fails server verification.
- Customer cannot alter `amount` in checkout → server re-computes.
- Suspended user cannot `POST /api/business` → 403.
- `POST /api/paystack/webhook` without valid HMAC → 401; replayed event id → one extension only; amount mismatch → ignored + audit.
- Admin-only endpoints reject normal `CUSTOMER` token → 403.

#### D. E2E (§25 full flow)

```
NEW USER → REGISTER → CREATE BUSINESS → CREATE SERVICE → CREATE OFFER → PREVIEW
→ MOCK CHECKOUT (or real Paystack test mode) → VERIFY → PUBLISH
→ OPEN /b/slug → assert logo/name/category/value prop above fold (§4)
→ CLICK WhatsApp (assert https://wa.me/ link) → verify ANALYTICS_EVENT WHATSAPP_CLICK
→ CLICK Call (tel:) → CALL_CLICK
→ CLICK Directions (maps link) → DIRECTION_CLICK
→ SHARE → SHARE_CLICK (if Web Share API mock)
→ DASHBOARD analytics counters == 1 each
```

Separate run for **payment failure** path: Paystack mock returns failure → assert subscription stays PENDING, public page not live, retry CTA visible.

#### E. Tenant isolation explicit test file

`tests/security/tenant-isolation.spec.ts` — creates two businesses (A/B) with two sessions, runs matrix of cross-access attempts and asserts 403 / no data leak.

### CI

`.github/workflows/ci.yml` (to be created): `npm ci → prisma migrate deploy --dry-run → vitest run → playwright → audit (npm audit / dependabot)`. No secrets needed in CI except test DB URL.

---

## 21. Future Integration Interfaces (§21, §48) — Already Reserved

- `InteractionEvent` TypeScript type defined in `lib/interactionEvent.ts` even though no telephony provider is integrated V1 (§21).
- `ANALYTICS_EVENT.source` + `metadata` JSON fields absorb future `CALL_COMPLETED`, `CALL_MISSED`, `QR_SCAN` etc. without schema migration.
- Webhook abstraction isolates provider-specific code behind `lib/paystack.ts`-style adapter — same pattern will host `lib/telecom.ts` later.
- No fake call events will be generated V1 (§48) — never claim cellular redirection until real integration verified.

---

## 22. Deployment Strategy (§26)

### Environment matrix

| Env | `PUBLIC_BASE_URL` | `DATABASE_URL` | `NEXTAUTH_URL` | Paystack keys | Domain |
|-----|-------------------|----------------|----------------|---------------|--------|
| Development | `http://localhost:3000` | Neon dev branch or local Docker Postgres (optional) | same | `sk_test_…` for 2006074 (test mode) | localhost |
| Preview (provider) | `https://jata-aftercall.vercel.app` (or `*.pages.dev`) | Neon prod/test branch | same | test keys | provider domain |
| Future production | `https://jata.link` | Neon prod | same | `sk_live_…` | custom domain via provider dashboard |

### Steps (zero-cost path) — to be documented in `DEPLOYMENT.md`

1. Create GitHub repo (already exists).
2. Create Neon (or Supabase) project → copy `DATABASE_URL` (Pooling + DIRECT_URL if Neon).
3. Create Vercel (or Cloudflare Pages) project → Import `POWERBot-1/Jata-Aftercall` → set env vars from `.env.example` (no secrets in Git).
4. `npx prisma migrate deploy` runs automatically on build (via `postinstall` or Build Command).
5. Verify `GET /health` → 200, `GET /` → sales page, `GET /b/demo-slug` → demo business (§24).
6. Configure Paystack dashboard: webhook URL `https://<provider-domain>/api/paystack/webhook`, enable `charge.success`.
7. Run demo E2E and security tests against preview URL.
8. Share provider URL — commercially demonstrable immediately (§26A demonstration requirement).

**Rollback:** Vercel/Pages → Deployments → Rollback to previous, or `git revert` + push.

### Secrets handling

- All secrets via provider Dashboard → Environment Variables (or Cloudflare `wrangler secret`).
- Never `echo $PAYSTACK_SECRET_KEY` in logs; `AuditEvent.metadata` never stores raw webhook signature or secret.

---

## 23. Demo Data (§24)

Four realistic seeded businesses (created via `prisma/seed.ts`, not hardcoded in UI):

1. **Nyumbani Kitchen** — Restaurant/Food, Nairobi — warm theme — offer "Pilau Combo KES 650"
2. **Mary's Beauty Studio** — Salon/Beauty, Kitengela — clean theme — offer "Braids from KES 1,500" (spec example)
3. **Kamau Auto Care** — Mechanic, Westlands — dark theme — services "Oil Change / Diagnostics"
4. **John Kamau Properties** — Real Estate, Kiambu — clean theme — "1BR from KES 25k"

Each demonstrates different category (§14), theme (§13), and CTAs (§4).

---

## 24. Production Readiness Gates (§28, §53)

Implementation will be declared complete only when these are independently verifiable (per §53):

- [ ] Registration → business creation → theme → services → offer → preview → publish → `/b/slug` live
- [ ] WhatsApp (`https://wa.me/`), Call (`tel:`), Directions (Maps deep-link), Share (Web Share API fallback) all functional
- [ ] Share OG: title `Mary's Beauty Studio | Nairobi`, description, OG image, canonical
- [ ] Mobile sticky CTA bar (§5), fast Lighthouse (>90 performance), minimal JS, lazy images (§19)
- [ ] Analytics counters (views, WA/call/direction/share/service clicks) increment and are tenant-scoped
- [ ] Tenant isolation tests pass (10 × cross-access cases → 403)
- [ ] Security 8-case suite + Paystack webhook HMAC + idempotency + amount validation all pass
- [ ] No secrets in Git (`git secrets` scan), secure headers, XSS payloads neutralized, rate limiting active
- [ ] `prisma migrate deploy` succeeds; production build (`next build`) succeeds; `/health` returns 200
- [ ] `DEPLOYMENT.md` zero-cost path verified on provider URL; demo businesses reachable at `https://provider/b/…`
- [ ] Pricing is DB-driven; Paystack flows verified with test keys for JATA ATLAS 2006074; unpaid ≠ active; duplicate webhook does not double-extend; renewal path works

No fake telephony, no mara claims about cellular call redirection (§47, §53).

---

## 25. Estimated Implementation Scope

| Phase | Effort | Deliverable |
|-------|--------|-------------|
| **A. Scaffold + DB + Auth** | 1 session | Next.js+TS+Tailwind+Prisma+Auth init, `PUBLIC_BASE_URL` helper, `HEALTH` endpoint, seed, `.env.example`, `.gitignore` |
| **B. Public page + themes + SEO + PWA** | 1 session | `/b/[slug]` with 3 themes, sticky CTA, OG metadata, sitemap, performance budget |
| **C. Sales landing + onboarding** | 1 session | Sales page §32, `/onboarding/*`, `/register`, `/login` |
| **D. Dashboard + Admin** | 1 session | Customer dashboard §36 + Admin panel §39 with audit logging |
| **E. Paystack + Subscriptions** | 1 session | Checkout, verify, webhook (HMAC+idempotent), `SUBSCRIPTION` lifecycle, expiry/grace + renewal |
| **F. Analytics + hardening + tests** | 1 session | `ANALYTICS_EVENT`, rate limits, headers, XSS/sanitize, full test suite (§10/§25/§43) + `DEPLOYMENT.md` |
| **Total** | ~6 focused sessions / smallest coherent patchset(s) | Sellable revenue-first MVP per §29: 60-second demo "Give me name & number → mary.jata.link" on zero-cost infra |

No VPS, no domain purchase, no WhatsApp API, no SMS provider required before first revenue.

---

## 26. Audit Conclusion & Request for Authorization

### Pending authorization

This audit **does not claim** production security, deployment readiness, or any implementation.

- **No code has been written.**
- **No DB has been created.**
- **No Paystack keys have been requested or stored.**
- **No deployment has been attempted.**

### Proposed next step

Upon **explicit authorization** from the owner, implementation will proceed **in the smallest coherent patchset** on this branch `arena/01a09b84-jata-aftercall`, following governance:

`AUDIT (this document) → AUTHORIZATION (owner reply) → IMPLEMENTATION → TEST → COMMIT/PUSH → PR → VERIFICATION → EXPLICIT MERGE AUTHORIZATION → MERGE`

### Confirmation of JATA ATLAS paystack configuration

- Implementation will route **all subscription payments** to JATA ATLAS Paystack merchant **2006074**.
- `PAYSTACK_MERCHANT_ID=2006074` will be stored as **configuration** (env var), not a secret.
- `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` will be **injected via deployment env** only, never committed, never exposed to frontend except public key where Paystack docs require it.
- Webhook + verification will be server-side, idempotent, amount-validated, and tied to correct `userId`/`businessId`.

### Required owner action

Please reply with one of:

1. **"AUTHORIZED — proceed with implementation as audited"** (with any adjustments to pricing, theme copy, or demo businesses), or
2. **"AUTHORIZED with changes: …"**, or
3. **"HOLD — revise audit for …"**

Including:

- Preferred hosting preference: **Vercel** vs **Cloudflare Pages** (audit recommends Vercel for Next.js ergonomics; both satisfy zero-cost),
- Preferred free DB: **Neon** vs **Supabase** vs **Cloudflare D1** (recommends Neon for Postgres+Prisma),
- Confirmation that **test-mode Paystack keys for merchant 2006074** will be supplied via deployment secrets (not chat) when implementation reaches that phase,
- Any correction to initial pricing (`KES 999/year`, optional `KES 99/month`) to seed `PlanConfig`.

Until that explicit authorization is received, **no implementation will begin**.

---

## Appendices

### A. Zero-cost checklist (copy to `DEPLOYMENT.md` later)

- [ ] `PUBLIC_BASE_URL` works on `localhost` and `https://provider-domain` and future `https://jata.link`
- [ ] Path-based `/b/slug` fallback works without wildcard DNS
- [ ] `DATABASE_URL` via env; no hardcoded credentials
- [ ] Media does not rely on ephemeral VPS disk
- [ ] Paystack webhook reachable on provider HTTPS URL
- [ ] No VPS, no custom DNS, no paid SSL required

### B. Security headers target (to implement)

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(), microphone=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...
```

### C. Explicit "Do Not Build" reminder (§1)

Do NOT build in V1: full CRM, complex ecommerce, AI chatbot, payment gateway beyond Paystack subscription flow, appointment engine, inventory, bulk SMS, WhatsApp API dependency, call-center software, social management, complicated builder. The implementation patch will be reviewed against this list.

---

*End of audit. Awaiting authorization — no further action taken.*

