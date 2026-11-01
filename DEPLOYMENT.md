# JATA AFTERCALL — Deployment

## Supported deployment architecture

Preserve Next.js on Vercel, Prisma/PostgreSQL on Neon, and Paystack. The intended customer domain is `https://jataaftercall.co.ke`; the existing Vercel host remains an operational reference. DNS, TLS, redirects and mail records have not been independently accepted in this audit, so do not change production settings or claim the domain is ready without owner-approved verification.

```
GitHub (POWERBot-1/Jata-Aftercall)
        ↓
Next.js application on Vercel (existing deployment reference)
        ↓
Prisma / PostgreSQL on Neon
        ↓
Paystack (merchant JATA ATLAS 2006074; server verification and webhook)

Intended customer origin: https://jataaftercall.co.ke
```

This describes the supported architecture, not proof of configured production services, domain acceptance, availability or cost. Do not substitute another host/database/provider without an approved architecture decision. No Redis, queues, workers or paid APIs are authorized by this runbook.

---

## Environment Variables

Environment variables are owner-managed. Use Vercel Dashboard → Settings → Environment Variables only under a separately approved production change; this remediation did not inspect or change deployed values. For local development, use `.env.local`. **Never commit `.env` or print secret values.**

```ini
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
AUTH_SECRET="<generate a fresh 32+ character secret locally; do not commit>"
# Local development only:
PUBLIC_BASE_URL="http://localhost:3000"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="same-as-AUTH_SECRET"
PAYSTACK_MERCHANT_ID="2006074"                          # JATA ATLAS — configuration, not secret
PAYSTACK_SECRET_KEY=""                                  # configure test credentials only in a secure local store
PAYSTACK_PUBLIC_KEY=""
# Production canonical-origin values are owner-managed. Do not change them until DNS/TLS is verified
# and a separate production-configuration change is approved.
# Intended canonical origin: https://jataaftercall.co.ke

# Optional local admin fixture only; both values must be supplied from a secure local environment.
# Existing accounts are not promoted or modified by seeding.
# ADMIN_EMAILS="owner@example.test"
# ADMIN_INITIAL_PASSWORD=""
```

Copy `.env.example` to `.env.local` for local dev (`PUBLIC_BASE_URL=http://localhost:3000`).

---

## One-Time Setup (10 minutes)

### 1. Database (Neon free tier) — Option I: Production DB Init + Isolated Build Gate

**Fresh Option I implementation (not historical recovery):**

- Baseline migration exists at `prisma/migrations/20250915000000_init/migration.sql` (12 tables, 4 enums, 20 indexes, 12 FKs, 0 DROP — parity with `schema.prisma`).
- `scripts/migrate.sh`: if `DATABASE_URL` set → `npx prisma migrate deploy`, fail fast on error, no seed, no secret logging. If `DATABASE_URL` not set → skip (preview/offline).
- `scripts/build.sh`: isolated gate — if `DATABASE_URL` present → run `migrate.sh` (failure aborts build, `next build` NOT executed). If absent → skip migration, `prisma generate` with offline fallback, then `next build` proceeds (preview).
- Seeding is restricted to explicitly opted-in non-production fixtures. It refuses when `NODE_ENV=production` or `VERCEL_ENV=production`, requires `JATA_ALLOW_FIXTURE_SEED=true` plus an ephemeral `DEMO_FIXTURE_PASSWORD` of at least 32 characters, and never uses a committed default credential. Admin fixture creation is optional and requires both `ADMIN_EMAILS` and `ADMIN_INITIAL_PASSWORD`; an existing account's role/password is never changed. The build/migrate gate never invokes seed. Existing production account state is unknown and must be reviewed/rotated by the owner separately.
- `package.json` build is now `bash scripts/build.sh` (via `npm run build`).

1. https://neon.tech → Create project `jata-aftercall` → copy **both** connection strings:
   - **Pooled** (the host contains `-pooler`) → `DATABASE_URL`. The app's runtime uses this; it is what
     makes a serverless deployment survive many short-lived connections.
   - **Direct** (the same host **without** `-pooler`) → `DIRECT_URL`. Prisma Migrate uses only this.
2. Paste both into the hosting environment and `DATABASE_URL` locally in `.env.local`. `DIRECT_URL` may
   be omitted locally and in CI — `scripts/lib/prisma-env.sh` defaults it to `DATABASE_URL`, and
   `scripts/migrate.sh` refuses to run if that default would send migrations through a pooler.
3. Run migrations (local dev):
   ```bash
   npm ci
   npx prisma migrate deploy   # or: npx prisma db push (dev) — or via gate: bash scripts/migrate.sh
   export JATA_ALLOW_FIXTURE_SEED=true
   export DEMO_FIXTURE_PASSWORD="$(openssl rand -hex 32)"
   npm run seed                # non-production plans/themes and fictional demo fixtures only
   # Keep the generated value in this local shell; never print, commit, or reuse it in production.
   ```
   Production deployments are owner-managed: `DATABASE_URL` can cause the build gate to run `migrate deploy` before `next build`. Treat this as a database write and deploy operation: it requires a separate reviewed change, backup/recovery plan and explicit owner approval. No production build, migration or deployment is authorized by this runbook/remediation; CI-only disposable PostgreSQL rehearsal is not production approval.

   **Why `DIRECT_URL` exists (do not skip it on Neon).** Neon's pooled endpoint is PgBouncer in
   transaction mode. Prisma Migrate takes a *session-level* advisory lock before applying migrations, and
   transaction pooling does not reliably preserve it, so `migrate deploy` through the pooler fails with
   **P1002** (timeout acquiring pg_advisory_lock) — or leaves the migration recorded as failed and every
   later deploy fails with **P3009** until somebody runs `prisma migrate resolve`. The schema therefore
   declares `directUrl = env("DIRECT_URL")`, and `scripts/migrate.sh` refuses, before Prisma is invoked,
   either of these:
   - a pooled `DATABASE_URL` with no `DIRECT_URL` (the preflight exits 1 with the remedy), or
   - a `DIRECT_URL` that still points at a pooled host.

   CI cannot catch this class of bug: every job points at a plain PostgreSQL service container with no
   pooler in front of it. That is why the guard is a separate, unit-tested preflight
   (`scripts/lib/direct-url-guard.mjs`, `tests/unit/direct-url-guard.test.ts`).

**Behavior matrix:**

| `DATABASE_URL` | `scripts/migrate.sh` | `scripts/build.sh` | Result |
|---|---|---|---|
| absent | skip, exit 0 | skip migrate, generate fallback, next build | Preview/offline build PASS |
| present, migrate success | deploy success | migrate success → generate → next build | Production build PASS |
| present, migrate failure | deploy fail, exit 1 | migrate fail → build aborts, next build NOT executed | Production build FAIL (gate) |

### 2. Hosting — Vercel (recommended)
1. Use the existing owner-managed Vercel project for this repository; do not create or reconfigure a project as part of remediation.
2. Its Next.js build command is `npm run build` (`bash scripts/build.sh`); with production `DATABASE_URL` configured, the gate may run migrations, which remain separately approval-controlled.
3. Configure environment variables only through the owner-approved Vercel process. Production values were not inspected here; no production variable changes are authorized. A preview may omit database settings for the offline build path.
4. Use the existing Vercel deployment reference only as operational context; do not deploy from this remediation task.
5. Do not change `PUBLIC_BASE_URL`, DNS, domain assignments or email records here. The intended canonical domain needs owner-approved DNS/TLS/mail verification first.
6. Validate builds and health checks only on disposable CI/preview infrastructure. A Vercel integration check is not proof that the official domain, database or customer flows are accepted.

**Isolated gate notes:**
- No secret logging: `DATABASE_URL` never echoed.
- No seed in gate: `npm run seed` remains manual post-migration.
- No `/api/seed` endpoint — verified via `grep app/api`.

### 3. Paystack (JATA ATLAS 2006074)

Paystack keys, dashboard settings and webhook configuration are owner-managed. This remediation does not access or change them. Any future verification must use an approved test-mode environment with synthetic transactions only; do not enable live keys or charge real money without a separate explicit owner decision.

1. Use test keys only in an isolated, owner-approved non-production environment.
2. Configure `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` through the secure secret-management process; never commit or print them.
3. Configure the webhook URL only through a separately approved provider change. The application verifies `x-paystack-signature` server-side with HMAC-SHA512.
4. Test-mode transactions and provider callbacks are not production acceptance and are not run by this guide.

---

## Local Development

```bash
npm install
cp .env.example .env.local  # fill DATABASE_URL (Neon dev branch) + AUTH_SECRET
npx prisma migrate dev
export JATA_ALLOW_FIXTURE_SEED=true
export DEMO_FIXTURE_PASSWORD="$(openssl rand -hex 32)"
npm run seed                # refuses production; creates only disposable/local fixtures
npm run dev                  # http://localhost:3000
```

A new demo-owner row uses the ephemeral password generated in the local shell; the value is not printed or committed. Existing demo or admin rows are not promoted, modified or password-reset by a rerun, so use only a disposable/local database and do not reuse fixture credentials in any deployed environment. No admin account is created unless both `ADMIN_EMAILS` and a fresh `ADMIN_INITIAL_PASSWORD` (at least 32 characters) are explicitly supplied in the local environment. The public fictional demo pages are `/b/nyumbani-kitchen`, `/b/marys-beauty-studio`, `/b/kamau-auto-care` and `/b/john-kamau-properties`.

---

## Health, sitemap, and payment acceptance

Do not run HTTP checks or synthetic callbacks against the production Vercel host from this remediation. Health/sitemap output from a host is not proof of full acceptance. Use CI or an isolated local preview only after confirming its database is disposable.

For payment acceptance, use the existing isolated PostgreSQL journey and provider fakes/test mode; preserve server-side verification, signature checks, amount/currency/reference matching, idempotency and tenant authorization. Never handcraft a success webhook against a deployed URL or use live provider keys. No Paystack callback, test charge or real transaction was performed here.

The local mock checkout is restricted by application code to non-production environments and is not settlement or production evidence. Production provider configuration and any test-mode dashboard changes require separate owner authorization.

---

## Recovery and rollback planning

Code, database and environment rollback are separate owner-controlled production operations; none is authorized by this remediation. Do not assume a Prisma migration is reversible or resolve migration history manually. For a future approved change, document the exact migration's forward-recovery/restore plan, verified backups, application compatibility and responsible operator before any production action. Keep secrets in the provider secret manager; do not copy them into Git or this runbook.

---

## Official domain and mail verification (owner action required)

The intended canonical URL is `https://jataaftercall.co.ke`; `https://jata-aftercall.vercel.app` remains an operational reference. Current DNS/name-server reports conflict and the final MX/SPF/DKIM/DMARC state and delivery have not been verified. Do not add, remove or change DNS records, email records, Vercel domains or production variables from this runbook. The owner should obtain the authoritative zone export from HOSTAFRICA, compare it with Vercel's domain configuration, preserve mail records, then independently verify HTTPS, redirects, secure cookies and mail delivery before authorizing any production update.

`lib/url.ts` centralizes generated origins, but source defaults and Vercel metadata do not establish live canonical behavior.

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
bash scripts/migrate.sh      # local/disposable DB only here; production migration requires separate owner approval
npx prisma migrate deploy   # local/disposable DB only here; production migration is not authorized by this guide
npx prisma migrate dev      # local dev only (creates migration)
JATA_ALLOW_FIXTURE_SEED=true DEMO_FIXTURE_PASSWORD="$(openssl rand -hex 32)" npm run seed  # local fixtures only; seed refuses production
npm run build                # isolated build; production DATABASE_URL can trigger a migration gate, so require separate approval
npm test                     # Vitest suite (count depends on current revision); use disposable DB for DB integration coverage
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
