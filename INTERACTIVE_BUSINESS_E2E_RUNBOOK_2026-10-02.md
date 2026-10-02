# INTERACTIVE BUSINESS (KES 999) — END-TO-END JOURNEY RUNBOOK (2026-10-02)

**Gate:** §66 — a real owner and a real customer complete the full journey against a real database.
**Artefact that runs the journey:** `tests/e2e/interactive-business-journey.test.ts`
**Status:** ✅ **EXECUTED AND PASSING — 17/17 steps, run `36982597396`, 2026-10-02 08:0x UTC, PostgreSQL 16 on GitHub Actions.**

Run it again from any machine (section 4 covers what to check on an existing database first):

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/jata_e2e"   # disposable database
npx prisma migrate deploy && npm run seed
npm run test:e2e
```

It also runs on every push and pull request through
`.github/workflows/interactive-business-e2e.yml`, which provisions PostgreSQL 16 with
`prisma migrate deploy` — the same path `scripts/migrate.sh` uses in production.

---

## 1. What the journey asserts

The test drives the application's **own route handlers** with the **real Prisma client** — no parallel code
path, no duplicated business logic. It is skipped unless `DATABASE_URL` (or `E2E_DATABASE_URL`) is set, so
the offline unit/integration suite is unaffected.

| Step | Journey stage | Assertion |
|---|---|---|
| 1 | Register | Real owner account and business row created by `POST /api/auth/register`. |
| 2 | Business profile | Category, phone, location saved (publication checklist inputs). |
| 3 | Choose package | `POST /api/checkout` prices the Interactive plan **server-side**: `Payment.amount = 99900` kobo, `KES`, `PENDING`. |
| 4 | Pay gate | `POST /api/experience/publish` → **403** `requires: "PAYMENT"`; `Business.isPublished` stays `false`. |
| 5 | Verify + activate | Verification → `PAID`, subscription `ACTIVE`, interactive entitlement `ACTIVE/entitled`. |
| 6 | Category configure | Experience created for a category (`food`) and reloadable per business. |
| 7 | Media | Image uploaded to the tenant media library. |
| 8 | Product + price | Priced product created (`basePriceKES = 850`). |
| 9 | Draft vs live | Draft edit lands in `draftJson`; `publishedJson` is still empty — the live site is untouched. |
| 10 | Publish | After payment: `isPublished = true`, experience `PUBLISHED`, `ExperienceVersion` snapshot written (rollback data), business URL `/b/<slug>`. |
| 11 | Customer browse/order | Guest `POST /api/storefront/checkout` → **server-priced** basket: 2 × 850 = **1700 KES**, pickup fee 0; the client-supplied total is ignored. |
| 12 | Customer pay | Order payment settles → `paymentStatus = PAID`, `status = CONFIRMED`; a repeat confirmation is idempotent (one payment row). |
| 13 | Owner processes | Order appears on `GET /api/orders`; `PATCH` to `ACCEPTED` → `PROCESSING`; an illegal backwards move → **409**. |
| 14 | Booking | Service with availability → free slots listed → guest books (`CONFIRMED`) → owner sees it on `GET /api/bookings` and completes it. |
| 15 | Tenant isolation | A second owner gets **403** on edit / orders / publish for the first business, and nothing is written. |
| 16 | Unpaid never publishes | Second business can build (experience + product) but publish → **403** `requires: "PAYMENT"`. |
| 17 | Lapsed entitlement | Expired subscription → entitlement `EXPIRED`, re-publish → **403**; products, orders and draft content are **retained**, live copy unchanged. |

Payments settle through the application's existing **test-settlement branch** (active only when
`NODE_ENV !== "production"` and `PAYSTACK_SECRET_KEY` is unset) — the same `activateSubscriptionForPayment` /
`settleOrderPayment` functions the Paystack webhook calls, so the state machine, idempotency guard and
entitlement sync under test are the production ones.

## 2. What the first real run exposed (and fixed)

Executing against a database found three defects that no amount of UI or unit testing could have:

| Defect | Symptom | Fix |
|---|---|---|
| `prisma/schema.prisma` used `/** … */` block comments and several models declared a relation to `Business` without the opposite field | `prisma generate` failed with **P1012** — no client could be generated at all, on any branch | Block comments converted to `//`; the missing back-relations added. Back-relation fields create no columns, so no migration is needed for them. |
| `prisma/migrations` had no `migration_lock.toml` | Prisma refused to treat the folder as a migrations directory (`migrate deploy`, `migrate diff`) | `migration_lock.toml` added with `provider = "postgresql"`. |
| No migration ever created the commerce, notification or AI tables (`Product`, `Order`, `OrderItem`, `Cart`, `PreOrder`, `Notification`, `KnowledgeDocument`, `AIConfiguration`, …) | A fresh database provisioned with `prisma migrate deploy` could not run the platform — the Interactive migration itself alters `"Product"`, which did not exist | New `20260930000000_commerce_baseline` migration, generated from `prisma migrate diff` against the real engine, running before the Interactive migration. |

Two smaller fixes came from the same run: the journey now sets a hero image (the publication checklist
requires a primary visual) and cleans cart items through their cart.

## 3. Deploying this branch

`scripts/migrate.sh` runs `prisma migrate deploy` on every build that has `DATABASE_URL` set. On this branch
that now works from an empty database. For a database that already carries the schema but no migration
history (for example one provisioned with `prisma db push`), baseline it once instead of re-applying:

```bash
npx prisma migrate resolve --applied 20250915000000_init
npx prisma migrate resolve --applied 20260929000000_referral_stage2
npx prisma migrate resolve --applied 20260930000000_commerce_baseline
npx prisma migrate resolve --applied 20261002000000_interactive_business
```

Both new migrations are written with `IF NOT EXISTS` / `duplicate_object` guards, so they are safe to apply
to a database that already has the objects they create.

## 4. Verifying an existing database before merging

The operator confirmed the live database is provisioned with `prisma migrate deploy`. Run these two
read-only queries against it first — the checked-in history only ever created 13 tables, so if the
platform has been serving commerce features the database was provisioned some other way:

```sql
-- Which migrations this database has actually applied
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY migration_name;

-- Which tables exist today
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY 1;
```

| What you see | What it means | Action before merging |
|---|---|---|
| `_prisma_migrations` is missing or empty | The database was not provisioned by migrations (or `DATABASE_URL` has been unset, in which case `scripts/migrate.sh` skips migrations and the app has been running on the offline fallback) | Either provision a fresh database from the chain, or baseline the four migrations with `prisma migrate resolve --applied <name>` |
| Rows up to `20260929000000_referral_stage2` only | Normal. `20260930000000_commerce_baseline` and `20261002000000_interactive_business` will apply on the next deploy | None — both are guarded, so they are safe either way |
| `"Product"`, `"Order"` etc. already exist in the table list | The schema was applied outside the migration history | None strictly required — the guarded migrations skip existing objects — but baseline them so future migrations track cleanly |
| A row named `20261002000000_interactive_business` | The Interactive migration was applied before the baseline existed (impossible from a clean chain) | Baseline `20260930000000_commerce_baseline` as applied and confirm the commerce tables are present |

## 5. Sandbox limitation (why CI executes the gate)

The workspace that built the package has no database and no route to the Prisma binary hosts, so the gate
cannot be executed there:

| Requirement | Finding |
|---|---|
| `DATABASE_URL` | Not present; no Postgres server available (`apt-get install postgresql` → package not found). |
| Prisma engines | `npx prisma generate` → `binaries.prisma.sh … libquery_engine.so.node.sha256 … socket disconnected`. Retried across sessions and after a clean `npm install`. |
| Alternate engine hosts | `prisma-builds.s3-eu-west-1.amazonaws.com`, `objects.githubusercontent.com`, `cdn.jsdelivr.net` → egress blocked. `prisma/prisma-engines` publishes no GitHub releases. |
| npm-hosted engines | `@prisma/engines@5.22.0` ships 10 files and no binaries; no npm package vendors a linux-x64 `libquery_engine` for Prisma 5.22. |

Schema validation was made possible offline by driving `@prisma/prisma-schema-wasm@5.22.0` (the exact parser
Prisma 5.22 uses) directly in Node, which is how the P1012 errors above were reproduced and fixed without a
database.
