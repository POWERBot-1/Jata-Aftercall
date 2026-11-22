# Phase 11 — acceptance, readiness, Preview isolation and deployment verification — 2026-11-22

## Exact revision and PR

- Repository: `POWERBot-1/Jata-Aftercall`
- PR: #155 — `[DRAFT] Record exact-head AI Front Desk and motion evidence`
- Branch: `arena/ai-front-desk-motion-evidence-20261122`
- Commit: `fc8d99e282a3e6133a6969dc3ca863fee9e53cae`
- Base: PR #154 candidate `b5706a1dbc3c3daa721d4c083b3818b875d06c2f`
- PR remains OPEN / DRAFT / UNMERGED.

## 1. ADMIN-005 full acceptance

**Status: BLOCKED — existing implementation is partial.**

Source inspection of the exact PR base confirms:
- `lib/control/financial-metrics.ts` calculates recurring run-rate from active subscriptions only when LIVE/PAID/KES settlement, payment/business/plan/reference linkage, provider transaction identity, provider settlement timestamp, no settled refund/chargeback, and complete immutable price snapshots are present.
- It covers CORE, POS, AUTOPILOT, ERP legacy, ERP PRO and MJENGO subscription models in the Control overview's recurring-revenue aggregation.
- Unit tests cover 30-day and 365-day normalization, test exclusion, duplicate linkage, no-active-subscription zero, incomplete settlement/snapshot evidence, refunds/chargebacks, unsupported currency/interval and identifier non-disclosure.
- `lib/admin/persisted-financial-evidence-summary.ts` is explicitly an `EVIDENCE_INVENTORY_ONLY` summary. It inventories persisted settlement snapshots, transaction evidence, bank-credit evidence and selected identity/completeness exceptions; it does not calculate date/currency cash totals or prove bank receipt.

Full ADMIN-005 acceptance is not established because the reviewed read model still lacks a unified accepted output for gross settled cash, settled refunds, settled chargebacks and net cash by provider settlement date; authoritative fee/tax presentation; reconciliation exception summaries by immutable identifiers; and source-stamped AI usage/cost/jobs/incidents. The current unit tests are not a substitute for the required PostgreSQL integration and scope/denial acceptance.

No metric was exposed, no Control permission was granted, and the all-DENY matrix/runtime kill switch were not changed. ADMIN-005 stays BLOCKED.

## 2. Programme completeness

**Status: FAIL — strict gate retained.**

Latest Admin instruction integrity run: `45063863907`.
- `instruction-integrity`: PASS.
- `programme-completeness`: FAIL.
- Both readiness test files passed; the repository-wide acceptance command failed as designed.

The checker reports exactly 24 unresolved requirements:
- 21 BLOCKED.
- 3 NOT_TESTED.

IDs: ADMIN-005, ADMIN-006, ADMIN-007, ADMIN-009, ADMIN-010, ADMIN-013, ADMIN-014, ADMIN-015, MOTION-002, MOTION-003, MOTION-004, MOTION-005, MOTION-006, MOTION-007, MOTION-008, MOTION-011, MOTION-012, MOTION-013, MOTION-014, MOTION-015, MOTION-016, MOTION-017, MOTION-018, RELEASE-001.

No readiness status was promoted and no checker/gate was weakened.

## 3. Preview isolation

**Status: BLOCKED — owner-controlled branch-scoped configuration is required.**

Latest Vercel deployment for this exact commit:
- Deployment: `dpl_5Q5jDQajS4jtccrTYKADAXquJmmR`
- URL: `jata-aftercall-5cg0wafq6-powerbot-1.vercel.app`
- State: ERROR; build step exited 1.
- Prisma Client generation succeeded.
- The build then stopped at `scripts/ci/check-preview-environment-isolation.mjs` before Next.js compilation.

The guard reports missing Preview values for:
- `DATABASE_URL`
- `DIRECT_URL`
- `JATA_STAGING_DATABASE_HOST`
- `AUTH_SECRET`
- `NEXTAUTH_SECRET`
- `PUBLIC_BASE_URL`
- `NEXTAUTH_URL`

Vercel environment metadata inspection (without decrypting secret values) found no required branch-specific configuration attached to the current PR #155 branch. The project does contain an isolated Preview configuration associated with a different branch, `arena/financial-evidence-candidate-2`, including a dedicated staging-host marker and non-production origins. This is not inherited by the current PR branch. Configuration on a different branch is not evidence that this deployment is isolated; it must not be copied, reassigned or broadened without owner approval and confirmation that the exact staging database, auth secrets, Paystack test credentials, R2 bucket and preview origins are appropriate for this branch.

No environment variables were created, edited, decrypted or copied. No database, provider, storage or auth configuration was changed. The isolation guard was not bypassed.

## 4. Latest documentation deployment

**Status: FAIL — documentation commit is recorded, but its Vercel Preview deployment failed.**

The latest deployment is tied to commit `fc8d99e282a3e6133a6969dc3ca863fee9e53cae` and failed at the Preview isolation gate above. This is not a successful documentation deployment. GitHub Actions:
- POS / ERP-PRO run `45063863813`: PASS. Schema/types/unit/build job and migrations/PostgreSQL job both succeeded.
- Admin instruction integrity run `45063863907`: aggregate FAIL due to programme completeness; instruction-integrity subcheck PASS.

The successful POS / ERP-PRO CI run is not a Vercel deployment and does not override the Preview failure.

## Stop conditions and next execution

1. Owner must authorize and configure the current PR branch with isolated staging-only Preview variables; do not reuse production values or silently move another branch's configuration.
2. Redeploy the exact commit after the isolation contract is independently verified. Require the isolation guard to pass before application compilation.
3. Continue ADMIN-005 implementation and acceptance with a source-stamped cash/refund/chargeback/fee/tax/exception read model, followed by disposable PostgreSQL integration, tenant-scope and denied-route tests.
4. Resolve every outstanding programme requirement using implementation and exact-head evidence. Do not edit readiness statuses merely to make CI green.

No production merge, production deploy, migration, financial mutation, payout, provider activation, DNS change, customer data use, secret disclosure, Control permission grant or gate relaxation occurred in this phase.