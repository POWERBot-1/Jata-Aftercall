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
| `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` | 12 |

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

### Schema ⇄ SQL parity (BLOCKED tool substituted)

`prisma migrate diff`, `prisma validate` and `prisma migrate deploy` all need the schema-engine
binary, which cannot be downloaded here (`binaries.prisma.sh` is unreachable), so they are
**BLOCKED**. In their place, `tests/prisma/business-hub-migration-parity.test.ts` (10 checks, all
passing) parses `schema.prisma` and the SQL and asserts, for all nine models:

- every table and both enum types exist, with exactly the documented enum values;
- every scalar column exists with the SQL type Prisma emits (`String→TEXT`, `Int→INTEGER`,
  `Boolean→BOOLEAN`, `DateTime→TIMESTAMP(3)`, enum → its type);
- nullability matches the schema (optional → nullable, required → `NOT NULL`);
- every `@unique` and `@@unique([…])` exists as a unique index or table constraint;
- every `@@index([…])` exists as an index;
- every relation has a cascading foreign key to the parent's `id`;
- the migration creates **only** hub tables, alters **only** hub tables, and contains no
  destructive statement (`DROP `, `TRUNCATE`, `ALTER COLUMN`, `DELETE FROM`, `UPDATE "`).

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
| 15 | Mobile / desktop / accessibility / error handling in a browser | **NOT TESTED** — no browser or database in this workspace (§7) |

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
step. It is expected to pass in CI, where `prisma generate` runs.

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

1. **No browser or database in this workspace** → no screenshots, no camera scan, no device
   matrix. Server-rendered markup tests stand in for the customer view. A ready-to-run browser
   check is provided: `scripts/browser/business-hub.check.mjs`
   (`CHROME_PATH=… BASE_URL=… SLUG=… SHOT_DIR=… npm run test:browser:business-hub`), which follows
   the repository's `puppeteer-core` convention and **exits 2 with "NOT RUN" when Chrome is
   absent**, so a run without a browser can never be mistaken for a pass. Owner screens inside it
   are skipped (reported NOT RUN) unless `HUB_SESSION_COOKIE` and `BUSINESS_ID` are supplied.
2. **Prisma CLI is unavailable offline**, so `prisma migrate diff` / `validate` / `deploy` have
   not run; the parity suite substitutes for `migrate diff`. Confirm both green in CI.
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

**Modified (10)** — each change is the minimum the hub needs:

| File | Change |
|---|---|
| `components/BusinessPage.tsx` | renders the five new sections in the mandated order, all conditional on data |
| `app/b/[slug]/page.tsx` | one request-cached hub data load, awaited by both `generateMetadata` and the body |
| `components/dashboard/StudioTabs.tsx` | four hub tabs (Customers, Promotions, Loyalty, QR code) |
| `lib/db.ts` | hub models added to the offline stub: reads empty, writes refuse |
| `package.json` | `jsqr` + `qrcode` as devDependencies; `test:browser:business-hub` script |
| `package-lock.json` | lockfile for the two devDependencies |
| `prisma/schema.prisma` | nine hub models, two enums, back-relations on `Business` |
| `vitest.config.ts` | `*.test.tsx` added to the test include list (component render tests) |
| `tests/helpers/posFakeDb.ts` | exported `registerUniqueIndexes` so a suite can declare the hub's unique indexes |
| `tests/unit/repair-guards.test.ts` | the new migration added to the authorised-migration allowlist with its rationale |

**Added (49)** — 15 API routes, 4 dashboard pages, 10 hub/QR library modules, 10 React
components, 5 test suites + 2 test helpers, 1 browser check script, 1 migration, and this
document. No unrelated file is touched.
