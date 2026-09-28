# JATA AFTERCALL — Deployment

## Zero-Cost MVP Architecture (no domain, no VPS, no paid SSL)

This deployment satisfies §26A: entirely free, provider-generated HTTPS, serverless.

```
GitHub (POWERBot-1/Jata-Aftercall @ arena/01a09b84-jata-aftercall)
        ↓
Free hosting — choose ONE:
  A) Vercel  → https://jata-aftercall.vercel.app
  B) Cloudflare Pages → https://jata-aftercall.pages.dev
        ↓  (auto SSL, serverless functions)
Postgres — free tier:
  Neon (recommended) → DATABASE_URL  OR  Supabase → DATABASE_URL  OR  Cloudflare D1 (if on Pages)
        ↓
Paystack (merchant JATA ATLAS 2006074) — webhook → https://<provider-domain>/api/paystack/webhook
```

### What is free vs paid

| Component | MVP (free) | Limits | Future paid |
|-----------|------------|--------|-------------|
| Hosting (Vercel / Pages) | ✅ Free | 100 GB bandwidth/mo, ~6k hrs exec | Pro if traffic grows |
| HTTPS / SSL | ✅ Auto | — | — |
| DB (Neon/Supabase/D1) | ✅ Free ~0.5 GB | Connection caps; scale when needed | Paid tier |
| Auth | ✅ JWT + bcrypt (no provider) | — | Email provider optional |
| Paystack | Merchant account 2006074 | Per-transaction fee (merchant-paid) | Same |
| Domain jata.link | ❌ Optional later | Requires purchase ~KES 1.5k/yr + DNS | Custom domain |
| VPS | ❌ Not required | — | Only if justified (§26A) |
| WhatsApp / SMS API | ❌ Not required V1 | — | V2+ |

No Redis, queues, workers, paid APIs are used in V1.

---

## Environment Variables

Set these in Vercel Dashboard → Settings → Environment Variables (or `wrangler secret` for Pages). **Never commit `.env`.**

```ini
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
AUTH_SECRET="openssl rand -base64 32 — 32+ chars"
PUBLIC_BASE_URL="https://jata-aftercall.vercel.app"   # or https://jata-aftercall.pages.dev
NEXTAUTH_URL="https://jata-aftercall.vercel.app"
NEXTAUTH_SECRET="same-as-AUTH_SECRET"
PAYSTACK_MERCHANT_ID="2006074"                          # JATA ATLAS — configuration, not secret
PAYSTACK_SECRET_KEY="sk_test_xxx"                       # server only — never exposed to frontend
PAYSTACK_PUBLIC_KEY="pk_test_xxx"
ADMIN_EMAILS="admin@jata.link"
```

Copy `.env.example` to `.env.local` for local dev (`PUBLIC_BASE_URL=http://localhost:3000`).

---

## One-Time Setup (10 minutes)

### 1. Database (Neon free tier) — Option I: Production DB Init + Isolated Build Gate

**Fresh Option I implementation (not historical recovery):**

- Baseline migration exists at `prisma/migrations/20250915000000_init/migration.sql` (12 tables, 4 enums, 20 indexes, 12 FKs, 0 DROP — parity with `schema.prisma`).
- `scripts/migrate.sh`: if `DATABASE_URL` set → `npx prisma migrate deploy`, fail fast on error, no seed, no secret logging. If `DATABASE_URL` not set → skip (preview/offline).
- `scripts/build.sh`: isolated gate — if `DATABASE_URL` present → run `migrate.sh` (failure aborts build, `next build` NOT executed). If absent → skip migration, `prisma generate` with offline fallback, then `next build` proceeds (preview).
- Seed remains manual/trusted: `npm run seed` creates plans, themes, demo businesses + `admin@jata.link`. No `/api/seed`, `/api/migrate`, `/api/init` endpoint. Build/migrate gate never invokes seed.
- `package.json` build is now `bash scripts/build.sh` (via `npm run build`).

1. https://neon.tech → Create project `jata-aftercall` → copy **Connection string (pooled)**.
2. Paste as `DATABASE_URL` in hosting env + locally in `.env.local`.
3. Run migrations (local dev):
   ```bash
   npm ci
   npx prisma migrate deploy   # or: npx prisma db push (dev) — or via gate: bash scripts/migrate.sh
   npm run seed                # creates plans, themes, 4 demo businesses + admin@jata.link
   ```
   Production (Vercel): `DATABASE_URL` present → `npm run build` automatically runs `scripts/migrate.sh` → `migrate deploy` → `next build`. If migration fails, build fails fast (gate). No manual `migrate deploy` needed in prod, but remains idempotent if run manually.

**Behavior matrix:**

| `DATABASE_URL` | `scripts/migrate.sh` | `scripts/build.sh` | Result |
|---|---|---|---|
| absent | skip, exit 0 | skip migrate, generate fallback, next build | Preview/offline build PASS |
| present, migrate success | deploy success | migrate success → generate → next build | Production build PASS |
| present, migrate failure | deploy fail, exit 1 | migrate fail → build aborts, next build NOT executed | Production build FAIL (gate) |

### 2. Hosting — Vercel (recommended)
1. https://vercel.com → **Add New Project** → Import `POWERBot-1/Jata-Aftercall`.
2. Framework: Next.js — Build command: `npm run build` (`bash scripts/build.sh` — runs migrate gate if `DATABASE_URL` set, else preview) — Output: `.next`.
3. Add all env vars above (Production + Preview). Production must have `DATABASE_URL`; Preview may omit for offline build test.
4. **Deploy** → get `https://jata-aftercall.vercel.app`.
5. Set `PUBLIC_BASE_URL` to that URL and redeploy (or set before first deploy).
6. Verify: `https://jata-aftercall.vercel.app/health` → `{"status":"ok","db":"up"}`. If migration failed, deploy fails at build step (gate) — check logs for `[migrate] ERROR`.

**Isolated gate notes:**
- No secret logging: `DATABASE_URL` never echoed.
- No seed in gate: `npm run seed` remains manual post-migration.
- No `/api/seed` endpoint — verified via `grep app/api`.

### 3. Hosting — Cloudflare Pages (alternative)
1. https://dash.cloudflare.com → Pages → **Connect to Git** → same repo.
2. Build: `npm run build`, Output: `.next` (or use `next-on-pages` for full Pages compatibility — not required for MVP; Vercel is simpler).
3. Add env vars via **Settings → Environment Variables**.
4. Same verification via `/health`.

### 4. Paystack (JATA ATLAS 2006074)
1. https://dashboard.paystack.com → Settings → API Keys → copy **Test** keys (then **Live** after revenue validation).
2. Set `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` in hosting env (test first).
3. Settings → Webhooks → Add `https://<provider-domain>/api/paystack/webhook`.
   - No additional secret needed — Paystack signs with `PAYSTACK_SECRET_KEY` via `x-paystack-signature` (HMAC-SHA512).
4. Test with a KES 50 test transaction (Paystack test cards).

---

## Local Development

```bash
npm install
cp .env.example .env.local  # fill DATABASE_URL (Neon dev branch) + AUTH_SECRET
npx prisma migrate dev
npm run seed
npm run dev                  # http://localhost:3000
```

Demo logins after seed:
- Admin: `admin@jata.link` / `Admin123!`
- Demo owner: `demo@jata.link` / `Demo1234!`

Demo pages (no login needed): `/b/nyumbani-kitchen`, `/b/marys-beauty-studio`, `/b/kamau-auto-care`, `/b/john-kamau-properties`

---

## Health & Verification

```bash
curl https://jata-aftercall.vercel.app/health
# {"status":"ok","db":"up","version":"1.0.0"}

# Sitemap & robots
curl https://jata-aftercall.vercel.app/sitemap.xml
curl https://jata-aftercall.vercel.app/robots.txt
```

---

## Paystack Verification & Webhook Testing

### Verify manually
```bash
# After checkout, Paystack redirects to /checkout/callback?reference=jata_xxx
# Server verifies via GET /api/paystack/verify?reference=jata_xxx
curl "https://jata-aftercall.vercel.app/api/paystack/verify?reference=jata_xxx"
# Requires the signed-in payment owner (or an authorized admin); anonymous verification is denied.
```

### Webhook idempotency test
```bash
PAYLOAD='{"event":"charge.success","data":{"reference":"jata_abc","amount":99900,"currency":"KES","id":123}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha512 -hmac "$PAYSTACK_SECRET_KEY" | cut -d' ' -f2)
# First delivery
curl -X POST https://jata-aftercall.vercel.app/api/paystack/webhook -H "x-paystack-signature: $SIG" -H "Content-Type: application/json" -d "$PAYLOAD"
# → {"status":"processed"}
# Duplicate
curl -X POST https://jata-aftercall.vercel.app/api/paystack/webhook -H "x-paystack-signature: $SIG" -H "Content-Type: application/json" -d "$PAYLOAD"
# → {"status":"already_processed"}
```

The webhook verifies the transaction against Paystack and checks reference, amount, currency and status before the atomic payment/subscription transition. Mismatches return a safe error and do not activate.

### Local test checkout (when PAYSTACK_SECRET_KEY is not set)
- In non-production environments only, checkout returns a test-only link at `/checkout/mock?reference=...`.
- The signed-in payment owner can choose **Simulate test payment**; the server accepts this mock only outside production and never treats a browser redirect as proof.
- The same mock path is disabled in production; missing live Paystack configuration fails closed with HTTP 503.

---

## Rollback

- **Code:** Vercel Dashboard → Deployments → select previous → **Rollback** (instant), or `git revert <commit> && git push`.
- **DB:** `npx prisma migrate resolve` + previous migration. Demo: `npx prisma migrate deploy` is idempotent. No destructive migrations in V1.
- **Config:** Env vars are versioned in Vercel — revert via dashboard.

---

## Custom Domain Upgrade (future, optional)

1. Purchase `jata.link`.
2. Vercel → Settings → Domains → Add `jata.link` and `*.jata.link` (or Pages → Custom Domains).
3. Configure DNS as provider instructs (CNAME / A).
4. Change `PUBLIC_BASE_URL=https://jata.link` in env and redeploy.
5. Same code works — `getBusinessUrl(slug)` now returns `https://jata.link/b/slug`. Wildcard `https://slug.jata.link` can be enabled later behind a feature flag without re-architecture.

No code rewrite needed — domain is abstracted via `PUBLIC_BASE_URL`.

---

## Security Notes

- Secrets never committed — `.env` ignored, `.env.example` is template only.
- Webhooks verified via HMAC-SHA512, idempotent via `ProcessedWebhook` table + `Payment.reference` uniqueness.
- Tenant isolation enforced server-side in `lib/tenant.ts` — every business-owned read/write checks `ownerId`/`BusinessMember`.
- Rate limiting in-memory (login, webhook, analytics) — zero-cost, no Redis.
- No fake telephony integration — V1 does not claim cellular-call redirection.

---

## Cost Gate (§26A)

Before introducing any paid infra, document:
1. Why free alternative insufficient.
2. Free alternative evaluated.
3. Expected monthly cost.
4. Whether required for V1.
5. Whether postponable until revenue.

Do not add recurring cost for convenience.

---

## Commands Summary (Option I)

```bash
npm ci
npx prisma generate
bash scripts/migrate.sh      # prod gate: runs migrate deploy if DATABASE_URL set, else skip; fail fast
npx prisma migrate deploy   # prod (manual idempotent, also via gate)
npx prisma migrate dev      # dev (creates migration)
npm run seed                 # demo data + admin — manual, never via build gate
npm run build                # = bash scripts/build.sh — isolated gate: migrate (if DB) → generate → next build; fail prevents build
npm test                     # vitest — 50 tests, tenant isolation
npm run dev
```

**Evidence checklist (fresh Option I):**

- `prisma/migrations/20250915000000_init/migration.sql` — 12 tables, 4 enums, 20 indexes, 12 FKs, 0 DROP
- `scripts/migrate.sh` — DATABASE_URL absent → skip, present success → deploy, present failure → exit 1
- `scripts/build.sh` — DATABASE_URL absent → skip migrate → build PASS, present failure → build NOT executed
- Preview build without DATABASE_URL — PASS
- No unauthenticated seed/init endpoint
- No secrets introduced
- Tenant/Paystack/auth unaffected
