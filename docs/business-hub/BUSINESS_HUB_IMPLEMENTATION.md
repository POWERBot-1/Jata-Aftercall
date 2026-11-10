# JATA Business Hub — implementation record

**Repository:** `POWERBot-1/Jata-Aftercall`
**Branch:** `arena/6d6b0932-jata-aftercall`
**Scope:** five native capabilities added to the existing Business Page, inside the existing
**KES 149 monthly / KES 999 annual** subscription.
**Date:** 2026-11-07

Everything below was executed in this workspace. Where a check could not be run, it is labelled
BLOCKED or NOT TESTED with the reason — nothing here is inferred from a test that did not run.

---

## 1. What was built

| # | Capability | Implementation | Owner screen |
|---|---|---|---|
| A | Instant Order Requests | `components/business-hub/OrderRequestPanel.tsx`, `lib/business-hub/orderRequests.ts`, `app/api/public/order-request/route.ts` | `/dashboard/businesses/[id]/customers` |
| B | Smart Customer Hub | `lib/business-hub/{customerHub,enquiries}.ts`, `components/business-hub/CustomerHubBoard.tsx` | `/dashboard/businesses/[id]/customers` |
| C | Promotional Spotlight | `lib/business-hub/promotions.ts`, `components/business-hub/Promotion{Spotlight,Board}.tsx` | `/dashboard/businesses/[id]/promotions` |
| D | Digital Loyalty Card | `lib/business-hub/loyalty.ts`, `components/business-hub/Loyalty{CardPanel,Board}.tsx` | `/dashboard/businesses/[id]/loyalty` |
| E | Business QR Identity | `lib/qr/{encoder,render,png}.ts`, `lib/business-hub/qrIdentity.ts`, `components/business-hub/QrIdentity{Block,Panel}.tsx` | `/dashboard/businesses/[id]/qr` |

Design rules, each enforced by a test rather than by intent:

- **No new paid or mandatory dependency.** `jsqr` (Apache-2.0) and `qrcode` (MIT) are
  **devDependencies** used only as test oracles; a test asserts they are absent from
  `dependencies` and from every shipped module.
- **No billing change.** No hub module references `prisma.subscription`, `prisma.payment`,
  `planConfig`, an entitlement model or Paystack (asserted). Prices, plans, Paystack flows and
  expiry dates are untouched.
- **Tenant isolation.** Every owner read/write is scoped by the `businessId` from the URL and
  authorised by `lib/business-hub/guard.ts` (`authorizeOwner` → `guardTenantMutation`). A
  `businessId` is never taken from a request body (asserted).
- **Honest wording.** An order request is never called a confirmed order or a payment, and loyalty
  stamps are always described as verified by the business (asserted).

### Public page order (verified by rendering the real component)

identity/contact → **Promotional Spotlight** → services → featured products → **instant order
requests** → **enquiry** → **loyalty card access** → info/opening hours → contact/WhatsApp/
directions/share → **QR identity**. Every added section is conditional on data, so an
unconfigured business sees no empty widgets.

---

## 2. Database changes

Migration: `prisma/migrations/20261128000000_business_hub_conversion/migration.sql`
Schema: the *JATA Business Hub* block in `prisma/schema.prisma`.

**Nine new tables, two new enum types, nothing else.** Statement inventory of the migration:

| Statement | Count |
|---|---|
| `CREATE TYPE` | 2 |
| `CREATE TABLE` | 9 |
| `CREATE INDEX` / `CREATE UNIQUE INDEX` | 25 |
| `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` | 13 |

| Table | Purpose |
|---|---|
| `OrderRequest` | one customer order request (reference, contact, status, server-priced total) |
| `OrderRequestItem` | requested lines (name snapshot, server unit price, line total) |
| `CustomerEnquiry` | general enquiries with their own workflow |
| `Promotion` | Promotional Spotlight rows (window, CTA, activation) |
| `LoyaltyProgram` | per-business configuration (goal, stamps per visit, reward, terms, on/off) |
| `LoyaltyCard` | one card per customer (public code, counters) |
| `LoyaltyStampEvent` | append-only record of one owner-verified transaction |
| `LoyaltyRedemption` | append-only record of one reward payout |
| `BusinessHubActivity` | shared append-only activity/audit trail |

Enums: `OrderRequestStatus` (NEW, REVIEWING, CONFIRMED, DECLINED, COMPLETED, CANCELLED),
`CustomerEnquiryStatus` (NEW, REVIEWING, CONTACTED, CLOSED, DECLINED).

### Constraints that carry the product guarantees

| Guarantee | Constraint |
|---|---|
| One request per double-tap | unique `(businessId, requestKey)` |
| One request reference | unique `reference` |
| One enquiry per double-tap | unique `(businessId, requestKey)` |
| One stamp per verified transaction | unique `(businessId, transactionRef)` |
| One payout per filled-card cycle | unique `(cardId, cycleIndex)` |
| One card code | unique `code` |
| One programme per business | unique `businessId` on `LoyaltyProgram` |
| Hub data dies with the business | `ON DELETE CASCADE` foreign keys to `Business` |

### Migration timestamp assessment — `20261128000000_business_hub_conversion`

**Question:** the name is dated 2026-11-28, later than today (2026-11-07). Why, and is it
compatible with Prisma?

**Finding — keep the name. Renaming it is the unsafe option.**

1. It follows the repository's existing sequence. The previous head is
   `20261127000000_voice_call_foundation`, which is **already on `main`** and was committed in
   `69c0af8` on **2026-11-06** — i.e. the repository already ships migrations named with dates
   later than their commit dates (`20261115` … `20261127`). The hub migration simply takes the
   next slot, `20261128`.
2. Prisma orders migrations **lexicographically by directory name**, not by calendar date.
   `20261128000000_business_hub_conversion` is the greatest name in the folder, so it is applied
   last — which is what an additive migration needs. Verified: `ls prisma/migrations | sort`.
3. The folder contains only `migration.sql` (12,254 bytes); `migration_lock.toml` correctly lives
   at the migrations root (`provider = "postgresql"`), and Prisma's object naming is reproduced
   exactly (`<Table>_pkey`, `<Table>_<col>_key`, `<Table>_<col>_idx`, `<Table>_<col>_fkey`),
   matching the neighbouring `voice_call_foundation` migration.
4. Renaming it *down* to today's date would place it **before** `20261115` … `20261127`, which may
   already be applied in any environment that has run migrations; that produces a history in which
   apply order and name order disagree, and it invites a filename collision with the next
   today-dated migration. Renaming it *up* would only re-create the same situation one slot later.
   **Recommendation:** keep `20261128…`, and continue the sequence from there (the next migration
   should be `20261129…` or later) until the repository's numbering has caught up with the
   calendar.
5. The migration has never been applied anywhere: it exists only on this unmerged branch.

### Schema ⇄ SQL parity (BLOCKED locally; the real tools passed in CI)

`prisma migrate diff`, `prisma validate` and `prisma migrate deploy` all need the schema-engine
binary, which cannot be downloaded here (`binaries.prisma.sh` is unreachable), so in this
workspace they are **BLOCKED**. In their place, `tests/prisma/business-hub-migration-parity.test.ts`
(10 checks, all passing) parses `schema.prisma` and the SQL and asserts, for all nine models:

- every table and both enum types exist, with exactly the documented enum values;
- every scalar column exists with the SQL type Prisma emits (`String→TEXT`, `Int→INTEGER`,
  `Boolean→BOOLEAN`, `DateTime→TIMESTAMP(3)`, enum → its type);
- nullability matches the schema (optional → nullable, required → `NOT NULL`);
- every `@unique` and `@@unique([…])` exists as a unique index or table constraint;
- every `@@index([…])` exists as an index;
- every relation has a cascading foreign key to the parent's `id`;
- the migration creates **only** hub tables, alters **only** hub tables, and contains no
  destructive statement (`DROP `, `TRUNCATE`, `ALTER COLUMN`, `DELETE FROM`, `UPDATE "`).

In CI, where the engines are available, the tools this substitutes for ran for real and passed:
**Migrations + schema on PostgreSQL 18** (asserts the server really is PostgreSQL 18, applies the
complete migration history, checks `migrate status` reports nothing pending or failed, bounds
schema drift against the recorded baseline, then re-runs `migrate deploy` as a no-op) and **Exact
candidate applies on disposable PostgreSQL 18**. Run identifiers in §4.

### Defect found in review: `P1012` on `Business.orderRequestItems`

The first push put the whole branch in this state:

```
Error: Prisma schema validation - (get-dmmf wasm)
Error code: P1012
error: Error validating field `orderRequestItems` in model `Business`: The
       relation field `orderRequestItems` on model `Business` is missing an
       opposite relation field on the model `OrderRequestItem`.
  --> prisma/schema.prisma:616
Validation Error Count: 1
```

- **Root cause.** `Business` declared the back-relation `orderRequestItems OrderRequestItem[]`,
  but `OrderRequestItem` carried `businessId` only as a bare scalar — it related to
  `OrderRequest`, not to `Business`. Prisma requires both sides of a relation. Every other hub
  model pairs its `businessId` with a `business Business @relation(...)`, which is why this was
  the only one.
- **Why it was not caught in this workspace.** `prisma validate` and `prisma generate` need the
  schema engine, so neither can run here; without a generated client every Prisma model type
  resolves to `any`, and TypeScript cannot see the missing side either. It surfaced as CI's
  *"Validate Prisma schema and generate the client"* step failing, which skips lint, typecheck,
  audit, migrations and everything downstream — so every check on the branch reported failure.
- **Correction.** `OrderRequestItem.businessId` was promoted to a real relation
  (`business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)`,
  commit `e34b7d8`) and the matching foreign key was added to the migration — the 13th, cascading,
  like every other hub table. No call site changes: `createOrderRequest` already writes
  `businessId` on every line item. It is also the better model, because the database — not only
  the application — now enforces that a line item belongs to the business that owns its request.
- **Verified.** `prisma validate`, `prisma generate`, lint, typecheck and the production
  dependency audit all pass in CI on the corrected commit; the parity suite derives the 13th
  foreign key from the schema itself and finds it in the SQL (10/10); the migration applied
  cleanly to a real PostgreSQL 18 server.

### Rollback

Nothing outside the hub references these tables, so a rollback is the reverse DDL only. It
touches no other table, and **no subscription, payment or entitlement is affected either way**.
Take a snapshot first, as always.

```sql
DROP TABLE "BusinessHubActivity";
DROP TABLE "LoyaltyRedemption";
DROP TABLE "LoyaltyStampEvent";
DROP TABLE "LoyaltyCard";
DROP TABLE "LoyaltyProgram";
DROP TABLE "Promotion";
DROP TABLE "CustomerEnquiry";
DROP TABLE "OrderRequestItem";
DROP TABLE "OrderRequest";
DROP TYPE "CustomerEnquiryStatus";
DROP TYPE "OrderRequestStatus";
```

The destructive statements are deliberately **not** written inside the migration file: the
repository's own migration guard (`tests/unit/repair-guards.test.ts`) rejects any migration whose
SQL text contains a destructive statement — comment included — and the migration was authored to
satisfy that guard. Rollback without touching data: remove the four hub tabs from
`components/dashboard/StudioTabs.tsx`; the public sections then render nothing (each is
conditional on data).

---

## 3. API surface

Public (rate-limited, same-site checked, honeypot protected, idempotency key):

- `POST /api/public/order-request` — create; `GET …?ref=…` — a customer reads their own request
  (status and items only: never the owner's notes, never the contact value — asserted).
- `POST /api/public/enquiry` — create an enquiry.
- `GET /api/public/loyalty/[code]` — progress for one card code (no contact details — asserted).

Owner (session + `authorizeOwner`, tenant taken from the path):

- `GET|POST /api/business/[businessId]/order-requests`, `PATCH …/[requestId]`
- `GET /api/business/[businessId]/enquiries`, `PATCH …/[enquiryId]`
- `GET|POST /api/business/[businessId]/promotions`, `PATCH|DELETE …/[promotionId]`
- `GET|PUT|POST /api/business/[businessId]/loyalty`, `POST …/cards/[cardId]/stamp`,
  `POST …/cards/[cardId]/redeem`
- `GET /api/business/[businessId]/qr` — `?format=svg|png|poster[&download=1]`
- `GET /api/business/[businessId]/hub` — the whole hub in one tenant-scoped read

Pricing is computed server-side from that business's catalogue rows via the same
`effectiveUnitPrice` rule the storefront checkout uses; a client-supplied price is ignored
(asserted).

---

## 4. Verification evidence

Commands, as run. Prisma's engines cannot be downloaded in this workspace, which is the single
cause of every non-passing item below.

| # | Command | Result |
|---|---|---|
| 1 | `./node_modules/.bin/vitest run` (full suite) | **4 212 passed, 303 skipped, 1 failed** — the failure is `tests/unit/autopilot-phase1-hardening.test.ts`, pre-existing and unrelated (see §5) |
| 2 | `./node_modules/.bin/tsc --noEmit` | 3 errors, all pre-existing and all in tests that need a generated Prisma client. Every hub file type-checks |
| 3 | `npx eslint app components lib` | **0 errors**, 49 pre-existing warnings; **no warning in any new file** |
| 4 | `npm run build` | `✓ Compiled successfully in 21.2s`, then **fails at the TypeScript step on the 3 pre-existing errors** above (BLOCKED: generated Prisma client) |
| 5 | `npx next build --webpack` with `typescript.ignoreBuildErrors` temporarily set (config reverted afterwards) | **exit 0** — compiles, lints and prerenders; all 15 new routes emitted (list below) |
| 6 | `node -e "…Prisma.dmmf"` | `undefined` — proves the client is not generated here, and that checks 2 and 4 are environmental |

### Continuous integration — the checks this workspace cannot run

All of the following are GitHub Actions runs on commit `9fa1cf9` of this branch — the head at the
time they ran — taken from the pull request's own check list. Commit `9fa1cf9` is the head of the
code; the commit that adds this document changes nothing executable. Every identifier below is
the run and job that produced the result, so each can be opened and read.

| Check | Result | Run / job |
|---|---|---|
| Static (install, generate, lint, typecheck, audit) | **PASS** | run `42386795130`, job `128445776094` — `prisma validate` + `prisma generate` step passes, then lint, typecheck and the production dependency audit |
| Schema, types, unit suite, build | **PASS** | run `42386795114`, job `128445826326` |
| full-suite | **PASS** | run `42386795179`, job `128445775928` — the same vitest suite that reports 1 failure here (§5); with a generated Prisma client it is green |
| Migrations + schema on PostgreSQL 18 | **PASS** | run `42386795130`, job `128445776033` — applies the complete history on a real PostgreSQL 18 server, then re-runs `migrate deploy` as a no-op |
| Exact candidate applies on disposable PostgreSQL 18 | **PASS** | run `42386795143`, job `128445776260` — the candidate migration rehearsed against a throwaway database |
| Migration target guard | **PASS** | run `42386795125`, job `128445775623` |
| Migrations and PostgreSQL suite | **PASS** | run `42386795114`, job `128446530918` |
| Schema reconciliation proposal closes the drift | **PASS** | run `42386795130`, job `128445775791` |
| Journey against a real database | **PASS** | run `42386795125`, job `128445775916` — 13m38s, applications against a real database |
| Production build path on PostgreSQL 18 | **PASS** | run `42386795130`, job `128445776091` — the production build, against a real database |
| Real-Chrome six-viewport capture on a disposable database | **PASS** | run `42386795221`, job `128446635466` — 8m26s, real Chrome at six viewports |
| capture | **PASS** | run `42386795164`, job `128445775789` |
| Failure paths actually fail | **PASS** | run `42386795130`, job `128445776069` |
| D2 — build, audit and controls on the candidate tree | **PASS** | run `42386795143`, job `128445775941` |
| Voice readiness, webhook, pipeline and media worker tests | **PASS** | run `42386795138`, job `128445775808` — pre-existing suite, unchanged by this branch |
| Release gate (aggregate) | **PASS** | run `42386795130`, job `128446461906` |
| Vercel (preview build of this branch) | **PASS** | deployment `2FXbXwcg1CQh9aYRBj1MnWyvDzrw` |
| **programme-completeness** | **FAIL** | run `42386795190`, job `128445776035` — **pre-existing and unrelated**: it also fails on the unrelated branch `arena/full-remediation-20261107` (pull request #90, run `42386461310`). Locally `node scripts/admin/check-programme-readiness.mjs` reports a platform-wide inventory of BLOCKED / NOT_TESTED programme requirements that this pull request does not own and must not sign off on. |

Routes emitted by the successful build (from `.next/server/app-paths-manifest.json`):
`/dashboard/businesses/[id]/{customers,promotions,loyalty,qr}/page`,
`/api/public/{order-request,enquiry,loyalty/[code]}/route`,
`/api/business/[businessId]/{hub,qr,order-requests,order-requests/[requestId],enquiries,enquiries/[enquiryId],promotions,promotions/[promotionId],loyalty,loyalty/cards/[cardId]/stamp,loyalty/cards/[cardId]/redeem}/route`.

### New test suites (62 tests, all passing)

| Suite | Tests | What it proves |
|---|---|---|
| `tests/unit/qr-encoder.test.ts` | 10 | see §6 |
| `tests/integration/business-hub-journey.test.ts` | 25 | real route handlers end to end: journeys, isolation, abuse protection, subscription regression |
| `tests/unit/business-hub-markup.test.tsx` | 6 | real components rendered to HTML: section order, wording, expired-promotion absence |
| `tests/unit/business-hub-boundaries.test.ts` | 11 | billing isolation, authorisation, section order, QR privacy, honest wording, honeypots |
| `tests/prisma/business-hub-migration-parity.test.ts` | 10 | schema ⇄ SQL equivalence (§2) |

### Acceptance tests

| # | Acceptance test | Result |
|---|---|---|
| 1 | Multi-product order request submit | **PASS** |
| 2 | Request lands in the correct business account | **PASS** |
| 3 | Owner can update status (illegal transitions refused) | **PASS** |
| 4 | Enquiry recorded and manageable | **PASS** |
| 5 | Owner publishes + expires a promotion | **PASS** |
| 6 | Expired promotion not shown as active | **PASS** |
| 7 | Owner verifies a transaction and awards a stamp | **PASS** |
| 8 | Duplicate verification cannot award duplicate stamps | **PASS** |
| 9 | Customer views loyalty progress | **PASS** |
| 10 | QR opens the correct public page | **PASS** (decoded from the served PNG) |
| 11 | QR download is usable/scannable | **PASS** (PNG bytes + SVG/poster) |
| 12 | Business A cannot access Business B's records | **PASS** |
| 13 | KES149 / KES999 entitlements intact | **PASS** |
| 14 | Existing Business Pages still work | **PASS** (full regression suite + rendered markup) |
| 15 | Mobile / desktop / accessibility / error handling in a browser | **PASS** — real Chrome at six viewports against a disposable database in CI: *Real-Chrome six-viewport capture on a disposable database* (run `42386795221`, job `128446635466`) and *capture* (run `42386795164`, job `128445775789`). The images themselves were not inspected by hand: the artifact download is blocked from this workspace, so this is the check's verdict, not a visual review. Owner screens are outside the capture's scope — see §8 |

Security and abuse checks covered by the journey suite: anonymous caller refused (401), staff
member allowed, cross-tenant read/update/create/QR refused (403/404) with nothing written,
foreign-origin submission refused (403), honeypot submission dropped silently (202, no row),
double-submission idempotency (200 + `idempotent`, one row), duplicate stamp refused (409, one
event), duplicate redemption refused (409, one payout), redemption before a full card refused
(409), a client-supplied price ignored, a foreign or inactive product refused (400), promotion
window validation, rate limiting exercised (a repeated IP is throttled at the 11th submission),
and public reads that never expose contact values or owner notes.

---

## 5. The one failing test (pre-existing, environmental)

`tests/unit/autopilot-phase1-hardening.test.ts` → *"Priority 1: validates … DMMF parity"* reads
`Prisma.dmmf`, which is `undefined` because `prisma generate` cannot download its engines here.
Evidence that it is unrelated to this work: the file is untouched by this branch
(`git status` shows no modification), and `node -e "const {Prisma}=require('@prisma/client'); …"`
prints `dmmf is undefined`. The same cause produces the 3 `tsc` errors and the build's type-check
step. It does pass in CI, where `prisma generate` runs: the *full-suite* check is green on the final
commit (run `42386795179`, job `128445775928`).

---

## 6. QR encoder review (capability E)

- **Correctness.** `tests/unit/qr-encoder.test.ts` compares against `qrcode@1.5.4` pinned to byte
  mode (the mode a URL uses, and the mode this encoder always emits): the matrix is
  **module-for-module identical across 4 error-correction levels × 5 payloads (v3–v10)**, and the
  chosen mask is identical in every case. Left in "auto" mode the reference sometimes splits a
  payload into alphanumeric + byte segments — a legitimate optimisation this encoder does not do —
  so that comparison is asserted differently: both symbols decode to the same text under `jsQR`.
- **Scannability.** Every level × payload decodes back to the exact payload from the rendered
  raster, and the PNG is parsed back (IHDR/IDAT/inflate) and decoded. The quiet zone is verified
  white and opaque. Default print output is 12 px per module with a 4-module quiet zone.
- **Security.** No `eval`, no dynamic import, no network, no filesystem. The only node built-in in
  the QR stack is `zlib`, isolated in `lib/qr/png.ts`. All text interpolated into the poster SVG
  (business name, URL, caption) is length-capped and passed through `escapeXml`, so a business
  name cannot inject markup into the served SVG.
- **Bundle safety (defect found and fixed).** The first production build failed:
  `UnhandledSchemeError: Reading from "node:zlib" is not handled by plugins`, because
  `components/BusinessPage.tsx` is a client component and its QR block pulled `node:zlib` into the
  browser bundle. Fixed by splitting the PNG writer into `lib/qr/png.ts` (server-only, imported
  only by the download route) and keeping `render.ts` browser-safe. The build now compiles; the
  repository already uses this principle elsewhere (`next.config.js` swaps `lib/team-access.ts`
  for a stub in the client compilation).
- **Dependencies and licences.** `jsqr` 1.4.0 (Apache-2.0) and `qrcode` 1.5.4 (MIT), both
  permissive and both **devDependencies**; a test fails if either ever appears in `dependencies`
  or is imported by shipped code.
- **NOT TESTED:** scanning with the camera apps of physical Android and iOS devices.

---

## 7. Subscription compatibility (KES149 / KES999)

- A journey test snapshots `planConfig`, `subscription` and `payment` rows, runs a complete hub
  journey (request, enquiry, promotion, enrolment, two stamps, redemption) and asserts all three
  collections are byte-identical afterwards, with plan prices `[149, 999]`.
- No hub module references billing, plans, subscriptions, payments, entitlements or Paystack
  (asserted over every hub file and every hub route).
- No existing pricing, Paystack, subscription or entitlement file is modified by this branch (see
  the changed-file inventory in §9).

---

## 8. Known limitations and outstanding work

1. **No browser or database in this workspace** → no screenshots inspected here, no camera scan.
   Server-rendered markup tests stand in for the customer view, and CI covers the rest: the
   six-viewport real-Chrome capture (run `42386795221`) and the journey against a real database
   (run `42386795125`) both pass on commit `9fa1cf9`. The capture's own images were **not**
   downloaded and reviewed by hand — the artifact download is blocked from this workspace — so
   the browser evidence is the check's verdict plus the rendered-markup suite, not a visual
   review. A ready-to-run browser check is also provided:
   `scripts/browser/business-hub.check.mjs`
   (`CHROME_PATH=… BASE_URL=… SLUG=… SHOT_DIR=… npm run test:browser:business-hub`), which follows
   the repository's `puppeteer-core` convention and **exits 2 with "NOT RUN" when Chrome is
   absent**, so a run without a browser can never be mistaken for a pass. Owner screens inside it
   are skipped (reported NOT RUN) unless `HUB_SESSION_COOKIE` and `BUSINESS_ID` are supplied.
2. **Prisma CLI is unavailable offline**, so `prisma migrate diff` / `validate` / `deploy` were
   never run here; the parity suite substitutes for `migrate diff`. In CI all three ran against a
   real PostgreSQL 18 server and passed (runs `42386795130`, `42386795143`, `42386795125`).
3. **Loyalty is owner-verified only** — by design for this release. Nothing automatically detects
   a purchase, visit or location, and the UI says so.
4. **Rate limits are per instance, in memory.** Behind several instances the effective limit
   multiplies; a shared store would be needed for a hard guarantee, and that dependency was
   deliberately not added.
5. **Order requests are not orders.** No stock reservation, delivery or payment step; the owner
   confirms by phone or WhatsApp.
6. **No owner notifications** (no email/SMS/WhatsApp API, by design). The hub is the notification
   surface; an outbox would be separate work.
7. **Reduced motion.** The only transition added (the loyalty progress bar) is gated with
   `motion-reduce:transition-none`; the only other motion is loading spinners, which match the
   existing convention in ten other components (no repository-wide reduced-motion rule exists for
   them). No decorative animation was added to the public page.
8. **Accessibility.** All new forms label their controls, announce errors with `role="alert"` and
   confirmations with `role="status"`, and the basket announces quantity and total changes with
   `aria-live="polite"`. Layouts use the repository's responsive `sm:`/`md:`/`lg:` classes and the
   shared `jata-*` vocabulary, so theme inheritance and the graphite/lime identity are preserved.
   A full screen-reader pass in a browser remains NOT TESTED.

---

## 9. Changed files

**Modified (11)** — each change is the minimum the hub needs:

| File | Change |
|---|---|
| `components/BusinessPage.tsx` | renders the five new sections in the mandated order, all conditional on data |
| `app/b/[slug]/page.tsx` | one request-cached hub data load, awaited by both `generateMetadata` and the body |
| `components/dashboard/StudioTabs.tsx` | four hub tabs (Customers, Promotions, Loyalty, QR code) |
| `lib/db.ts` | hub models added to the offline stub: reads empty, writes refuse |
| `package.json` | `jsqr` + `qrcode` as devDependencies; `test:browser:business-hub` script |
| `package-lock.json` | lockfile for the two devDependencies |
| `prisma/schema.prisma` | nine hub models, two enums, back-relations on `Business`, and the `OrderRequestItem → Business` relation that fixed the P1012 (§2) |
| `vitest.config.ts` | `*.test.tsx` added to the test include list (component render tests) |
| `tests/helpers/posFakeDb.ts` | exported `registerUniqueIndexes` so a suite can declare the hub's unique indexes |
| `tests/unit/repair-guards.test.ts` | the new migration added to the authorised-migration allowlist with its rationale |
| `docs/release/EVIDENCE-MANIFEST.sha256` | regenerated with the repository's own generator because the manifest covers `package.json`, which this branch edits — one digest line moved, the other 67 are unchanged |

**Added (49)** — 15 API routes, 4 dashboard pages, 10 hub/QR library modules, 10 React
components, 5 test suites + 2 test helpers, 1 browser check script, 1 migration, and this
document. No unrelated file is touched.

---

## 10. Post-merge production acceptance, and the one defect it found

PR #91 merged as `8791eb04b511a8d45390c2abb1d5c0c2fb0e70b3` and was serving production
(Vercel deployment `dpl_2WdzxDGeV5svwMunTwSP6PRrJk4S`). Reading the live site back found that
**capability B — order requests — was not reachable by any customer on an ordinary Business Page.**

### What production actually served

Read-only `GET`s of the live pages, no writes of any kind:

| Page | What the served HTML contained |
|---|---|
| `/b/nyumbani-kitchen` | services and products, enquiry panel, opening hours, contact links, QR block |
| `/b/kamau-auto-care` | the same — a second, different category (Mechanic) |
| `/dashboard/businesses/<id>/customers` (no session) | redirect to `/login` — the owner route is deployed and refuses anonymous callers |

Services, enquiries and QR were live. The order-request basket, the featured catalogue strip,
promotions and loyalty were **absent**, because each is conditional on data the page did not load.

### Root cause

The public loader built the basket from the **`Product`** catalogue alone. The page, however, lists a
business's **`Service`** rows under *Services and products* — and that is what an ordinary KES149
Business Page has. The `Product` catalogue belongs to the Interactive Business experience, and
`lib/demoData.ts` seeds every demo business with services only. So `products.length > 0` was false
on every such page and the section never rendered. The feature was complete, correct and invisible.

### The fix (five files)

| File | Change |
|---|---|
| `lib/business-hub/catalogue.ts` | new `CatalogueKind`, `SERVICE_SELECT`, `priceLabelToKES`, `loadPublicServices`, `loadRequestableCatalogue`; `loadCatalogueForPricing` now returns products **and** services |
| `lib/business-hub/orderRequests.ts` | validation accepts either kind; a service line is stored with `productId: null` rather than borrowing a product id |
| `app/b/[slug]/page.tsx` | feeds the merged, requestable catalogue to the page |
| `components/BusinessPage.tsx` | the basket renders from the merged list; the featured strip stays with catalogue products |
| `components/business-hub/OrderRequestPanel.tsx` | `kind` carried through to the line item |

A service is priced from `priceFrom`, else the amount written in its `priceLabel`, else nothing: a
`QUOTE` service contributes **0** and is labelled `AVAILABLE_ON_REQUEST` — the basket never invents a
price. Withdrawn and foreign-tenant services are refused exactly like products. No schema change, no
migration, no change to pricing, plans, entitlements or commissions.

### Evidence on the candidate

| Check | Result | Where |
|---|---|---|
| Full offline suite | 4 226 passed, 317 skipped, 1 pre-existing failure (§5) | this workspace, `./node_modules/.bin/vitest run` |
| Unit + integration + security against disposable PostgreSQL | **4 479 passed / 395 files** | run `42408108446`, job *Journey against a real database*, step 12 |
| Business Hub journey, 14 steps, real PostgreSQL | success | run `42408108446`, step 15 |
| Business Hub journey, real Chrome, six viewports | success | run `42408108446`, step 18 |
| Control denial (authenticated browser + API) | success | run `42408108446`, step 17 |
| ERP authorisation and tenant isolation over real HTTP | success | run `42408108446`, steps 22–23 |
| Candidate migration rehearsal | success | run `42408148657` |
| Full no-database suite | success | run `42408108427` |
| Release Validation (aggregate) | success | run `42408108528` |
| Admin instruction integrity | **failure** — `programme-completeness` only | run `42408108463`; pre-existing on `main`, see below |

New tests: 5 route-level cases for service lines (priced service, quote-only line, withdrawn service,
another business's service, a services-only business) in `tests/integration/business-hub-journey.test.ts`
(suite now 30/30); 9 loader cases in `tests/unit/business-hub-catalogue.test.ts`; 14 steps in
`tests/e2e/business-hub-journey.test.ts`, which **refuses to skip** — it self-skips without
`DATABASE_URL` and the CI step fails the job if the output contains "skipped" or no "N passed".

### Defects the first real browser run found — all in the check, none in the product

Honest record: the browser journey failed four times before it passed, and every cause was a fault in
the new check, not in the hub.

1. Synthetic `User` fixtures omitted the `NOT NULL` `passwordHash` column, so the fixtures could not
   be created and no check ran at all (`d5c3f56`).
2. The anonymous-visitor check shared the owner's browser context, so it could have travelled with the
   owner's cookie and passed for the wrong reason. It now runs in its own context and asserts the
   visitor does not reach the hub screen (`94e1d20`).
3. The Loyalty screen keeps its reward text in an `<input>`; `innerText` never carries input values,
   so a populated screen read as empty (`94e1d20`).
4. `innerText` returns *rendered* text, and section titles are uppercased by CSS: the page said
   `REQUEST AN ORDER` while the check looked for `Request an order`. The basket had priced the
   selection and accepted the submission all along — only the assertion was wrong (`e3ed0be`).
   The same flaw was in the six-viewport reachability check.

Each viewport is now measured in a fresh context, and Chrome gets a 180 s protocol timeout, because a
full-page capture on a shared runner exceeds the 30 s default and a screenshot timeout is not a layout
failure.

### Capability acceptance after the fix

| Capability | Verdict | Evidence |
|---|---|---|
| Customer hub and enquiry management | **PASS** | hub journey steps B (API) and owner *Customers* screen (browser); enquiry captured against the right business, anonymous and cross-tenant callers refused |
| Public catalogue and service listings | **PASS** | hub journey step A; six viewports; production read of two demo pages |
| Order requests (customer → owner) | **PASS** | hub journey steps A + B; browser basket → send → reference `JATA-REQ-…` with "no payment has been taken"; quote-only and withdrawn lines refused |
| Loyalty: enrol, stamp, redeem | **PASS** | hub journey steps D; duplicate stamp refused, redemption before a full card refused, second redemption refused, public code-only read exposes no contact details |
| Promotions: create, publish, expire, deactivate | **PASS** | hub journey steps C; expired promotion absent from the page; another business's promotion cannot be touched |
| QR identity, resolution, PNG download | **PASS** | hub journey step E (svg/png/poster, URL decodes to `/b/<slug>`); browser download of real PNG bytes. **NOT TESTED:** a physical camera scan |
| Owner dashboard navigation and permissions | **PASS** | browser journey walks Customers / Promotions / Loyalty / QR through the dashboard nav; anonymous callers redirected; foreign business refused |
| Tenant isolation | **PASS** | API: 403/404 with nothing written; browser: another owner's screen refused |
| Mobile UX (320/360/390/430/768/1366) | **PASS** | per-viewport checks in the browser journey; the captured images were not reviewed by hand — the artifact download is blocked from this workspace, so this is the check's verdict |

### Outstanding, and why

- **`programme-completeness` remains NOT READY (24 records).** It is a pre-existing, owner-owned gate
  that also fails on `main`. Every record was reconciled against the implementation, the tests and the
  owner's decisions in `docs/audits/PROGRAMME_RECONCILIATION_2026-11-07.md`: 10 moved to PASS on
  evidence, 16 remain BLOCKED and 8 NOT_TESTED because they depend on owner decisions (control
  provisioning, financial and PII policy), on production-boundary checks that must not be run from a
  sandbox, or on independent inspection of browser recordings that no reachable channel provides. The
  checker was not modified and no count was manipulated.
- **No full screen-reader pass.** Forms are labelled and announce errors and confirmations, but an
  assistive-technology review remains NOT TESTED.

---

## 11. Production verification after the release

Merged to `main` as **49916010f67921b470424c25e6e14d3c4d6d63d7** (PR #92). Vercel built that exact
commit as production deployment **dpl_HWGVEqBBZBFiNCfAYrVcmH2f54GJ** — `READY`, substate `PROMOTED`,
aliases assigned, serving `https://jataaftercall.co.ke` and `https://www.jataaftercall.co.ke`.

### The migration, from the production build log

```
[build] DATABASE_URL detected — invoking migration gate
[migrate] checking the migration connection (pooled vs direct)...
[direct-url] OK (OK_DIRECT_URL_READY) — runtime uses the pooled URL; migrations use the direct URL
[migrate] checking migration target...
[migration-guard] OK_ENROLLED_PRODUCTION env=production mode=enforce
[migrate] DATABASE_URL set — running prisma migrate deploy...
Datasource "db": PostgreSQL database "neondb", schema "public"
59 migrations found in prisma/migrations
No pending migrations to apply.
[migrate] Migrations deployed successfully
```

`20261128000000_business_hub_conversion` was already applied by the PR #91 deployment; this run
confirms the ledger is complete and clean on production, not that a migration was skipped.

### Read-only checks against the live site (no writes of any kind)

| Check | Result |
|---|---|
| `/b/nyumbani-kitchen` (Restaurant) | **PASS** — "Request an order … No payment is taken on this page" with Pilau Combo KES 650, Nyama Choma KES 900, Chapati (2 pcs) KES 100, each with a quantity control; services, enquiry, hours, contacts, QR and the fictional-demo labelling all unchanged |
| `/b/kamau-auto-care` (Mechanic) | **PASS** — Diagnostics KES 1 500, Oil Change KES 2 999, Brake Pads KES 4 500 |
| `/b/john-kamau-properties` (Real estate) | **PASS** — 1BR Rentals KES 25 000, 2BR Rentals KES 35 000, Land Sale KES 1 200 000, parsed from "From KES 1.2M" without inventing a figure |
| `/dashboard/businesses/<id>/customers` and `…/loyalty`, no session | **PASS** — redirect to `/login`; the owner routes are deployed and refuse anonymous callers |

A "From KES 900" service is priced at 900 and a `QUOTE` service carries no price: the basket never
invents a figure the business did not publish.

### Deliberately not done in production

- No order request, enquiry, promotion, loyalty card or any other record was created, and no
  destructive SQL was run: the acceptance rules forbid writing test data to production.
- The owner-facing hub screens were not exercised against production data, because that needs a real
  business owner's session.
- No physical camera scan of a printed QR code.
