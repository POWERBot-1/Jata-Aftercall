# Database-backed Prisma suite

These tests run against a real, migrated PostgreSQL database through Prisma. They make no mocks of Prisma or of
the database. The only replaced components are the Paystack HTTP client, the analytics sink, and the order
notification sender, so that no network call is made.

They are skipped unless `PRISMA_TEST_DATABASE_URL` is set. Skipped tests are reported as skipped; they are not
passes. Use an **isolated test database only**, never production.

## Run (native Prisma engines, the release path)

    DATABASE_URL=postgresql://... npx prisma migrate deploy   # isolated DB, migrations via pinned Prisma
    DATABASE_URL=postgresql://... PRISMA_TEST_DATABASE_URL=postgresql://... npx vitest run tests/prisma

CI sets both URLs to its disposable PostgreSQL 16 service. The first is the schema datasource;
the second explicitly opts into the real-Prisma suite. Neither may point at production.

## Run (WebAssembly build of the same Prisma query engine; used when native engine binaries cannot be downloaded)

`PRISMA_WASM_HARNESS_DIR` points at a test-only harness holding a driverAdapters client generated from the same
schema, plus `@prisma/adapter-pg` and `pg`. The harness is not part of the repository or its lockfile.
Its results are reported as engine `wasm-query-engine+adapter-pg`, which is not the pinned native-engine path.

    PRISMA_TEST_DATABASE_URL=postgresql://... PRISMA_WASM_HARNESS_DIR=/path/to/harness npx vitest run tests/prisma

## What is covered

- `schema-constraints`: CHECK on sale windows, unique indexes, foreign keys, legacy sale price without a window.
- `checkout-commit`: concurrent same-key orders, key reuse, stock rollback, rollback after a database error inside
  the order write, last-unit race, replay by a fresh client.
- `payment-settlement`: single and concurrent settlement, webhook replay, rollback on a database fault, FAILED then
  provider success, provider in-progress, provider final failure, amount mismatch, payment received on a cancelled order.
- `storefront-checkout`: quote/checkout parity, sale window boundaries, sale expiry between quote and checkout,
  tenant isolation, last-unit race through the route, same-key retry, unpaid-attempt rule, and
  `/api/paystack/verify` on an order payment (no subscription created).

- `subscription-payment` (real webhook route, real HMAC signatures): PENDING subscription activates (regression);
  a provider-verified charge.success after charge.failed settles the payment and activates the subscription (gap
  closed 2026-10-13 — the settlement now accepts the same provider-verified states as the order path: PENDING,
  FAILED, CANCELLED, EXPIRED, never REFUNDED); the verify route re-checks a stored FAILED with Paystack and
  activates on a verified success, while a still-failing provider verdict changes nothing.
- `pos-publication-policy`: concurrent Option B settlement creates one PAID payment/entitlement/case; owner and
  escalation notifications remain idempotent; the exact 72-hour boundary is enforced; failed publication remains
  open until a real snapshot; legacy PAID repair requires and uses verified provider `paid_at` rather than mutable
  row timestamps. All provider evidence is synthetic and no provider HTTP call is made.

## Not covered here

- Bulk pricing through the real `AIConfiguration` table (the mock suite covers it).
- Browser journeys (Playwright) against a live server with a database.
- Customer browser flows for "Continue to payment" (needs the browser journeys, which need a DB-backed server).
- Migrations applied by `prisma migrate deploy` (the wasm harness was migrated with raw SQL; see the release report).
