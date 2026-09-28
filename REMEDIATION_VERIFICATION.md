# JATA AFTERCALL remediation verification

## Implementation summary

- New and existing business journeys now present active, database-backed plans with a real checkout action and preserve `businessId` + `planId` through hosted Paystack checkout.
- Checkout first shows the authorized business and active plan by name/price, then the API rechecks the signed-in user and tenant authorization, derives the amount from `PlanConfig`, persists a pending payment, and returns a hosted authorization URL. A recent matching pending payment is rejected to prevent an accidental second attempt.
- Payment verification requires the signed-in payment owner or an authorized admin; it matches provider reference, amount, currency and successful status before atomic payment/subscription/business settlement. Callback UI reports pending/failure and does not declare success from redirect parameters.
- Webhooks verify HMAC signatures, validate payload shape, independently verify successful transactions with Paystack, and commit event idempotency and subscription activation in the same database transaction. Failed, refund, replay, mismatch and unknown-reference paths do not activate a subscription.
- Location creation and owner-authorized dashboard edits persist `location`, `lat` and `lng`; coordinates are validated as an optional complete decimal pair in geographic ranges. Directions use valid coordinates, otherwise saved text, otherwise no link.
- Onboarding now supports creating an additional business, collects location, offers plans after save, and retains the existing optional-publish policy. Public draft checks and subscription-expiry presentation were not weakened.
- No schema changes or migrations were made.

## Reproducible checks

Executed from repository root:

| Command | Result |
|---|---|
| `npm ci` | Completed; postinstall Prisma engine download was unavailable due sandbox network failure. npm reported 10 dependency vulnerabilities (3 moderate, 5 high, 2 critical). |
| `npm run lint` | Pass — no ESLint warnings/errors. |
| `npx tsc --noEmit` | Pass — no TypeScript errors. |
| `npm test` | Pass — 21 test files, 160 tests. |
| `env -u DATABASE_URL npm run build` | Pass — Next production build completed, including type validation. Migration was skipped because no database URL was supplied. Prisma client generation could not download its engine; the repository's offline fallback allowed the Next build to complete. |
| `git diff --check` | Pass. |

### Deterministic flow evidence (no live charge)

These tests use mocked database/provider boundaries and do not connect to production or charge a card:

- `tests/integration/customer-lifecycle.test.ts`: authenticated business creation with coordinates → database-authoritative plan checkout → local non-production test settlement → ACTIVE subscription with plan-derived duration → draft remains private until explicitly published → published state and coordinate directions.
- `tests/integration/checkout-route.test.ts`: auth and tenant access, missing/inactive plan, browser amount ignored, authoritative KES 149 plan amount, duplicate pending checkout prevention, local mock only outside production, missing live config fails closed, and sanitized provider initialization errors.
- `tests/integration/payment-verification-route.test.ts`: owner authentication, successful server verification, mismatched amount/currency, failed/cancelled transactions, mock isolation, and repeat verification idempotency.
- `tests/unit/payment-settlement.test.ts`: payment/subscription/business settlement as one transaction, authoritative expiry duration, duplicate callback/webhook idempotency, and repair of legacy PAID-without-subscription state.
- `tests/integration/paystack-webhook-route.test.ts`: signature rejection, malformed payload, authoritative Paystack verification, mismatch rejection and duplicate event acknowledgement.
- `tests/unit/paystack-client.test.ts`: hosted checkout URL allowlisting, reference checks, provider-response validation and the real HMAC helper.
- `tests/integration/business-location-route.test.ts` and `tests/unit/location-payment.test.ts`: authenticated create/update, cross-tenant update denial, coordinate persistence/ranges, coordinates/text directions, and no fabricated directions without saved location.
- `tests/security/publication-access.test.ts`: existing published/unpublished public access behavior remains enforced.

The repository has no configured test database or browser E2E harness in this environment. Consequently the tests prove route/state behavior with deterministic mocks, not an actual PostgreSQL transaction, live Paystack sandbox transaction, webhook delivery, or browser session.

## Configuration status (sandbox process only)

Values were never printed. The status check showed each following variable as `NOT SET` in this sandbox runtime:

- `DATABASE_URL` — needed for application database access; intentionally absent for offline build/test isolation.
- `AUTH_SECRET` and `NEXTAUTH_SECRET` — the application requires one of these aliases to sign sessions; both absent here.
- `PAYSTACK_SECRET_KEY` — required for live hosted checkout and server-side Paystack verification; absent here, so only the non-production mock route tests ran.
- `PAYSTACK_PUBLIC_KEY` — **NOT REQUIRED** for the server-initialized hosted checkout flow.
- `PAYSTACK_MERCHANT_ID` — **NOT REQUIRED** by the current hosted checkout integration.
- `PUBLIC_BASE_URL` and `NEXTAUTH_URL` — absent; local URL helper falls back to localhost, and Vercel has deployment host fallbacks. Verify the production canonical host separately.

**Production/Vercel variable status: UNVERIFIED.** This workspace cannot read Vercel production environment configuration. No production setting was changed. Do not interpret sandbox `NOT SET` as proof that a production variable is missing.

## Safety and limitations

- No production database connection, migration, data modification, real payment, or production environment change was made.
- Live Paystack initialization/verification/webhook behavior remains unverified without a configured sandbox credential and a non-production integration deployment. No real financial transaction was performed.
- The current build establishes source/type/build integrity only. Prisma client generation was unable to fetch its engine in this sandbox; build/runtime with a generated client and real database must be verified in CI/deployment before production readiness.
- Dependency installation reports the repository's existing dependency audit findings; no dependency upgrade was included in this focused remediation.
