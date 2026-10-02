# INTERACTIVE BUSINESS (KES 999) — END-TO-END JOURNEY RUNBOOK (2026-10-02)

**Gate:** §66 — a real owner and a real customer complete the full journey against a real database.
**Artefact that runs the journey:** `tests/e2e/interactive-business-journey.test.ts`
**Status:** ⛔ **NOT EXECUTED IN THIS SANDBOX — environment-blocked (measured, see §2).** Ready to run in one command wherever a database is reachable (§3).

---

## 1. What the journey test covers

`tests/e2e/interactive-business-journey.test.ts` drives the application's **own route handlers** with the
**real Prisma client** — no parallel code path, no duplicated business logic. It is skipped unless
`DATABASE_URL` (or `E2E_DATABASE_URL`) is set, so the offline unit/integration suite is unaffected.

| Step | Journey stage | What is asserted |
|---|---|---|
| 1 | Register | A real owner account and business row are created by `POST /api/auth/register`. |
| 2 | Business profile | Category, phone, location saved (publication checklist input). |
| 3 | Choose package | `POST /api/checkout` prices the Interactive plan **server-side**: `Payment.amount = 99900` kobo, `KES`, `PENDING`. |
| 4 | Pay gate | `POST /api/experience/publish` → **403** `requires: "PAYMENT"`; `Business.isPublished` stays `false`. |
| 5 | Verify + activate | Payment verification → `PAID`, subscription `ACTIVE`, interactive entitlement `ACTIVE/entitled`. |
| 6 | Category configure | Experience created for a category (`food`) and reloadable per business. |
| 7 | Media | Image uploaded to the tenant media library. |
| 8 | Product + price | Priced product created (`basePriceKES = 850`). |
| 9 | Draft vs live | Draft edit is stored in `draftJson`; `publishedJson` is still empty — the live site is untouched. |
| 10 | Publish | After payment: `isPublished = true`, experience `PUBLISHED`, `ExperienceVersion` snapshot written (rollback data). |
| 11 | Customer browse/order | Guest `POST /api/storefront/checkout` → **server-priced** basket: 2 × 850 = **1700 KES**, pickup fee 0, client-supplied total ignored. |
| 12 | Customer pay | Order payment settles → `Order.paymentStatus = PAID`, `status = CONFIRMED`; a repeat confirmation is idempotent (one payment row). |
| 13 | Owner processes | Order appears on `GET /api/orders`; `PATCH` to `ACCEPTED` → `PROCESSING`; an illegal backwards move → **409**. |
| 14 | Booking | Service with availability → free slots listed → guest books (`CONFIRMED`) → owner sees it on `GET /api/bookings` and completes it. |
| 15 | Tenant isolation | A second owner gets **403** on edit / orders / publish for the first business, and nothing is written. |
| 16 | Unpaid never publishes | Second business can build (experience, product) but publish → **403** `requires: "PAYMENT"`. |
| 17 | Lapsed entitlement | Expired subscription → entitlement `EXPIRED`, re-publish → **403**; products, orders and draft content are **retained**, live copy unchanged. |

Payments settle through the application's existing **test-settlement branch** (active only when
`NODE_ENV !== "production"` and `PAYSTACK_SECRET_KEY` is unset) — the same `activateSubscriptionForPayment` /
`settleOrderPayment` functions the Paystack webhook calls, so the state machine, idempotency guard and
entitlement sync under test are the production ones.

## 2. Why it could not run here (measured 2026-10-02)

| Requirement | Finding |
|---|---|
| `DATABASE_URL` | Not present in the environment; no Postgres server available (`apt-get install postgresql` → package not found). |
| Prisma engines | `npx prisma generate` fails: `request to https://binaries.prisma.sh/.../libquery_engine.so.node.sha256 failed, reason: Client network socket disconnected before secure TLS connection was established`. Retried 5× across sessions; also after a clean `npm install`. |
| Alternate engine hosts | `prisma-builds.s3-eu-west-1.amazonaws.com`, `objects.githubusercontent.com` → `curl` exit `000` (egress blocked). `gh api repos/prisma/prisma-engines/releases` is empty/404 (only `/tags` responds). |
| npm-hosted engines | `@prisma/engines@5.22.0` tarball contains **10 files, no binaries** (it downloads at install time from the blocked host). No npm package vendors a linux-x64 `libquery_engine` for Prisma 5.22. |
| Embedded Postgres | `@embedded-postgres/*` downloads binaries from GitHub release assets — same blocked egress. |

Consequence: **no database connection of any kind is possible from this sandbox**, so the §66 gate cannot be
closed here. Everything else is verified: `npx tsc --noEmit` clean, `npx vitest run` → 521 passed / 17 skipped
(58 files), `next build` exits 0.

## 3. How to close the gate (one command)

```bash
# 1. Provision an isolated Postgres database — never reuse production.
export DATABASE_URL="postgresql://user:pass@host:5432/jata_e2e"

# 2. Apply the additive Interactive migration and seed the plan.
npx prisma migrate deploy     # or: npm run migrate
npm run seed                  # seeds INTERACTIVE_BUSINESS at KES 999 / 30 days

# 3. Run the journey (no Paystack secret in a non-production env).
unset PAYSTACK_SECRET_KEY
npm run test:e2e
```

Expected result: **17 passed, 0 failed**. Any failure prints the step number, the HTTP status and the
response body, so the breaking stage is identifiable immediately.

Optional hardening once the journey passes: set `PAYSTACK_SECRET_KEY=sk_test_…` and repeat step 5 / step 12
through the real Paystack test-mode charge + webhook (see `PAYSTACK_TESTMODE_E2E_RUNBOOK_2026-09-28.md`).

## 4. Environment expectations

- `NODE_ENV` must not be `production` (vitest sets `test`) and `PAYSTACK_SECRET_KEY` must be unset, so the
  test-settlement branch is used. With a real secret set, the test must be driven by real Paystack test
  charges and will fail at steps 5 and 12 — that is the intended signal, not a bug.
- The test cleans up after itself (businesses, users, orders, bookings, payments, media, versions). Run it
  against a disposable database.
- The journey exercises the **public** storefront routes as a logged-out visitor (session cleared at steps
  11 and 14), so no owner session leaks into the customer path.
