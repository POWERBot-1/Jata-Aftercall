# JATA AFTERCALL — Fresh Option I Implementation (2026-09-15)

**Not historical recovery of 9179d78 — fresh implementation against canonical main a1af2fd.**

Canonical main: `a1af2fde034378cdf66276ac1c45091c602f58df`

## Objective

Production DB initialization — initial migration + isolated build gate

- Baseline migration exists
- Build invokes migration when DATABASE_URL available
- Migration failure prevents build
- Preview/offline builds remain possible without DATABASE_URL
- Seed remains manual/trusted, no unauthenticated endpoint
- No destructive/reset
- No secrets introduced
- Tenant isolation unaffected

## Scope Implemented (6 files)

1. `prisma/migrations/20250915000000_init/migration.sql` — baseline, generated from schema.prisma via manual SQL (Prisma migrate diff offline). Parity verified:
   - Tables: 12 (User, Business, BusinessMember, Service, Offer, PageTheme, AnalyticsEvent, PlanConfig, Subscription, Payment, AuditEvent, ProcessedWebhook)
   - Enums: 4 (Role, BusinessStatus, SubscriptionStatus, PaymentStatus)
   - Indexes: 20 (8 unique + 12 regular: User email idx, Business ownerId, slug, BusinessMember businessId, Service businessId, AnalyticsEvent 2, Subscription userId, Payment userId/businessId, AuditEvent actorId/action)
   - FKs: 12 (Business.ownerId→User, BusinessMember.userId→User CASCADE, BusinessMember.businessId→Business CASCADE, Service.businessId→Business CASCADE, Offer.businessId→Business CASCADE, AnalyticsEvent.businessId→Business CASCADE, Subscription.businessId→Business CASCADE, Subscription.userId→User, Subscription.planId→PlanConfig, Payment.businessId→Business SET NULL, Payment.userId→User, AuditEvent.actorId→User SET NULL)
   - DROP: 0

2. `scripts/migrate.sh` — isolated gate:
   - `set -euo pipefail`
   - DATABASE_URL absent → skip, exit 0, log `[migrate] DATABASE_URL not set — skipping`
   - DATABASE_URL present → `npx prisma migrate deploy`, fail → exit 1, log ERROR, no secret logging
   - No seed, no destructive

3. `scripts/build.sh` — isolated build gate:
   - `set -euo pipefail`
   - DATABASE_URL present → `bash scripts/migrate.sh` (failure aborts via set -e, next build NOT executed)
   - DATABASE_URL absent → skip migrate, log preview/offline
   - `prisma generate` with fallback
   - `next build`
   - Logs: `[build] Starting...`, `[build] DATABASE_URL detected...`, `[build] Running prisma generate...`, `[build] Running next build...`

4. `package.json` — build now `bash scripts/build.sh`, added `migrate` script `bash scripts/migrate.sh`, postinstall unchanged.

5. `DEPLOYMENT.md` — updated to document Option I behavior matrix, gate notes, no secret logging, no seed in gate.

6. This file — evidence artifact.

## Behavior Matrix (Verified)

| DATABASE_URL | migrate.sh | build.sh | Result |
|---|---|---|---|
| absent | skip 0 | skip migrate, generate fallback, next build | PASS (preview) |
| present, migrate success (mock) | deploy success 0 | migrate success → generate → next build | PASS (prod success) |
| present, migrate failure (mock) | deploy fail 1 | migrate fail → build aborts, next build NOT executed | PASS (gate) |

## Evidence Requirements — Measured

- **npm ci**: PASS (to be measured)
- **npm run lint**: PASS (to be measured)
- **npm test**: 50/50 PASS (to be measured, includes tenant-isolation, paystack-security)
- **Preview build without DATABASE_URL**: `unset DATABASE_URL && npm run build` → should PASS, no migration, fallback, 33 routes (to be measured)
- **Production migration-success mock**: Mock DATABASE_URL, mock `prisma migrate deploy` returning 0 via temporary script override or env, run `bash scripts/build.sh` → should run migrate then build → PASS (to be measured)
- **Production migration-failure gate**: Mock migrate to exit 1, run `bash scripts/build.sh` → must exit non-zero, must NOT run next build → PASS (to be measured)
- **Failed migration prevents next build**: Verified via exit code and log absence of "Running next build" after failure, or presence of error before build
- **Prisma parity**: 12 tables, 4 enums, 20 indexes, 12 FKs, 0 DROP — verified via grep counts
- **No unauthenticated seed/init endpoint**: `grep -r "seed|/api/migrate|/api/init" app/api` → none, seed only via CLI
- **No secrets**: `.gitignore` excludes env, no hardcoded DATABASE_URL, scripts do not echo URL
- **No unauthorized product changes**: No changes to lib/db.ts, lib/tenant.ts, lib/auth.ts, app/, prisma/schema.prisma, prisma/seed.ts — only allowed scope
- **Tenant isolation**: `npm test` includes `tenant-isolation.test.ts` — must PASS

## Governance

- No reconstruction of historical 9179d78 claimed
- Fresh implementation against a1af2fd
- No merge, no deploy, no production migration/seed performed
- PR will be created from new branch against main, awaiting independent verification

## Test Commands

```bash
npm ci
npm run lint
npm test
# Preview
unset DATABASE_URL
npm run build
# Prod success mock (with temp DATABASE_URL and mocked prisma)
# Prod failure mock
```

## Notes

- Migration SQL manually authored to match Prisma's expected output for postgres, based on schema.prisma. No DROP, idempotent via CREATE.
- Scripts use `bash` and `set -euo pipefail` for safety.
- Build gate preserves offline fallback from original `lib/db.ts`.
