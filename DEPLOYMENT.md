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

### 1. Database (Neon free tier)
1. https://neon.tech → Create project `jata-aftercall` → copy **Connection string (pooled)**.
2. Paste as `DATABASE_URL` in hosting env + locally in `.env.local`.
3. Run migrations:
   ```bash
   npm ci
   npx prisma migrate deploy   # or: npx prisma db push (dev)
   npm run seed                # creates plans, themes, 4 demo businesses + admin@jata.link
   ```

### 2. Hosting — Vercel (recommended)
1. https://vercel.com → **Add New Project** → Import `POWERBot-1/Jata-Aftercall`.
2. Framework: Next.js — Build command: `npm run build` — Output: `.next`.
3. Add all env vars above (Production + Preview).
4. **Deploy** → get `https://jata-aftercall.vercel.app`.
5. Set `PUBLIC_BASE_URL` to that URL and redeploy (or set before first deploy).
6. Verify: `https://jata-aftercall.vercel.app/health` → `{"status":"ok","db":"up"}`.

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
# Requires auth if session exists; anonymous callback is allowed.
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

Amount mismatch test: send amount that differs from Payment.amount → webhook returns `{"status":"rejected","reason":"amount mismatch"}` and does not activate subscription.

### Mock mode (when PAYSTACK_SECRET_KEY not set)
- Checkout returns `{"mock": true, "authorization_url": "/checkout/mock?reference=..."}`
- Visit mock page and click **Simulate successful payment** → calls `/api/paystack/verify?reference=...&mock=success` → subscription becomes ACTIVE.

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

## Commands Summary

```bash
npm ci
npx prisma generate
npx prisma migrate deploy   # prod
npx prisma migrate dev      # dev (creates migration)
npm run seed                 # demo data + admin
npm run build                # must pass before deploy
npm test                     # vitest
npm run dev
```
