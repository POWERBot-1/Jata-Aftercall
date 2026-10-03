# JATA AFTERCALL — Configurable Business POS
## Implementation record & completion status

Branch: `arena/01a0ff97-jata-aftercall`
Date: 2026-10-03 (Africa/Nairobi)
Repo: `/home/user/Jata-Aftercall`
Plan: `BUSINESS_POS` — **KES 499 / 30 days**

---

## 1. What was asked

A **Configurable Business POS** for Kenyan SMEs, sold as an add-on inside the existing JATA
AFTERCALL platform, built on one thesis:

> ONE JATA POS ENGINE + CONFIGURATION/CAPABILITY SYSTEM + BUSINESS TEMPLATES

Never fifty business-specific apps, and never `if restaurant / if salon / if garage` branches
scattered through the code (§52, §76). A business says what it does; the engine executes the
resulting configuration. The mandatory journey (§4, §43, §72, §81):

```
Create/Select Business → adaptive Questionnaire → Business Operating Profile (machine-readable)
→ "We've configured your POS" → Edit configuration → interactive Preview sandbox
→ Choose Plan (KES 499/month) → Pay → server-verified confirmation → Provision → LIVE
```

Definition of done (§81): an unknown business answers a short adaptive questionnaire and receives a
coherent business-specific POS, while a *different* business simultaneously receives a substantially
different POS **from the same software**.

Implementation boundary (§80): **additive only**. Preserve existing authentication, business
ownership, tenant boundaries, subscription architecture, payment verification, customer-facing
business pages, AFTERCALL functionality and production safety controls. No separate application, no
new infrastructure, no unrelated Commerce work.

---

## 2. What was built

| Layer | Where | Size |
| --- | --- | --- |
| Pure configuration engine (no Prisma, no React) | `lib/pos/{types,capabilities,units,terminology,workflow,permissions,businessTypes,questionnaire,presentation,configuration,templates,money,inventory,credit,receipt,reports,preview,forms,questionnaireView}.ts` | 19 modules |
| Server layer (tenancy, persistence, entitlements, audit) | `lib/pos/{store,sales,operations,workspace,reporting,dashboard,http,validation,guard,audit,entitlement,provisioning,settlement}.ts` | 13 modules, ~14,100 lines total |
| HTTP API | `app/api/pos/[businessId]/**` | 25 route files |
| Screens | `app/dashboard/pos/**` | 28 pages |
| Client components | `components/pos/*.tsx` | 17 |
| Data model | `prisma/schema.prisma` + `prisma/migrations/20261003000000_business_pos/migration.sql` | 24 `Pos*` tables |
| Tests | `tests/{unit,security,integration}/pos-*.test.ts`, `tests/e2e/business-pos-journey.test.ts` + `tests/helpers/posFakeDb.ts` | 11 suites |

Content the engine carries:

- **56 business types** (55 trades + `other` = "Something else" with free text, §10, §19)
- **165 capabilities** in 8 groups (Sales, Customers, Inventory, Procurement, Finance, Staff,
  Orders, Reporting — §8)
- **97 questionnaire questions** across 10 sections with progressive disclosure (§41)
- **8 configurable order workflows** (`GENERIC`, `RESTAURANT`, `DELIVERY`, `GARAGE`, `APPOINTMENT`,
  `PROJECT`, `PRODUCTION`, `LAUNDRY`) as explicit state machines (§29)
- **33 capability-action permissions** (`VIEW_SALES`, `CREATE_SALE`, `REFUND_SALE`, `APPLY_DISCOUNT`,
  `APPROVE_CREDIT`, `EDIT_CONFIGURATION`, `MANAGE_USERS`, …) and **11 built-in roles** (§36)
- **24 report definitions**, each labelled `recorded` / `calculated` / `estimate` (§35)
- **22 built-in templates** (`RETAIL_BASIC`, `RETAIL_CREDIT`, `WHOLESALE`, `RESTAURANT`,
  `RESTAURANT_DELIVERY`, `SALON`, `BARBER`, `HARDWARE`, `GARAGE`, `AUTO_PARTS`, `LAUNDRY`,
  `BOUTIQUE`, `FARM`, `AGRIBUSINESS`, `MANUFACTURING`, `PROFESSIONAL_SERVICE`, `REAL_ESTATE`,
  `EDUCATION`, `EVENTS`, `PRINTING`, `SERVICE_BUSINESS`, `ONLINE_SELLER` — §51)

There is no vertical-specific code path. `grep -rn "restaurant" app lib components` returns
**data** (workflow keys, terminology, template answers, sample menu names) — never a branch that
changes behaviour for one trade.

---

## 3. The request pipeline

Every POS route is the same five lines of intent plus one shared wrapper:

```ts
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ businessId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId, request,
    options: { permission: "CREATE_SALE", requireLive: true },
    fallback: "We couldn't record that sale.",
    handler: async ({ ctx, actor, body }) => fromOutcome(await createSale({ … }), { … }, 201),
  });
}
```

`handlePosRequest` (`lib/pos/http.ts`, `lib/pos/guard.ts`) runs, in order:

1. `requirePosAccessFromRequest` — session → `assertBusinessOwnership` (existing platform tenant
   guard) → role/permission resolution from the business's own configuration → POS entitlement.
2. `readJsonBody` — 256 KB cap; an oversized, unparseable, array or non-object body becomes `{}`
   rather than an error the caller can probe (§56).
3. `businessIdMismatch()` — a body-supplied `businessId` that differs from the URL is refused
   **403 `TENANT_ID_MISMATCH`** and audited as `POS_ACCESS_DENIED` (§5, §75). The tenant is always
   derived from the authenticated identity, never from the browser.
4. The handler.
5. `posErrorBody` — refusals return `{ error, code, warnings }` in plain language; nothing leaks a
   stack, a query or a credential (§38, §56). `fromOutcome` maps `NOT_ALLOWED` → 403 and every other
   domain refusal → 400.

Policy per route: reads are `fast: true` and work in any lifecycle state; anything that moves money,
stock or orders is `requireLive: true`; setup data (products, customers, suppliers, staff,
configuration) is writable before payment so a business can start partially (§61).

### Permission map (abridged)

| Route | Read | Write |
| --- | --- | --- |
| `/sales`, `/sales/[saleId]` | `VIEW_SALES` | `CREATE_SALE` (live); refund/void inside `[saleId]` (live) |
| `/products`, `/products/[productId]` | `VIEW_INVENTORY` | `EDIT_INVENTORY` |
| `/customers`, `/customers/[customerId]` | `VIEW_CUSTOMERS` | `MANAGE_CUSTOMERS`; repayment → `RECORD_REPAYMENT` |
| `/suppliers`, `/suppliers/[supplierId]` | `VIEW_SUPPLIERS` | `MANAGE_SUPPLIERS`; payment → `RECORD_SUPPLIER_PAYMENT` |
| `/inventory` | `VIEW_INVENTORY` | `ADJUST_STOCK` / `TRANSFER_STOCK` (live) |
| `/orders`, `/orders/[orderId]` | `VIEW_ORDERS` | `MANAGE_ORDERS` / `CANCEL_ORDER` (live) |
| `/expenses` | `VIEW_EXPENSES` | `CREATE_EXPENSE` (live) |
| `/purchases`, `/purchases/[purchaseId]/receive` | `VIEW_SUPPLIERS` | `CREATE_PURCHASE` (live) |
| `/reports` | `VIEW_REPORTS` (+ `CLOSE_DAY` for `daily_closing`) | — |
| `/audit` | `VIEW_AUDIT` | — |
| `/staff`, `/branches` | `VIEW_STAFF` / — | `MANAGE_USERS`, `EDIT_CONFIGURATION` |
| `/configuration/**` (draft, publish, preview, versions, clone, plan) | `fast` reads | `EDIT_CONFIGURATION` |

`OWNER` holds everything including `EDIT_PRICE`; `CASHIER` cannot refund, discount, approve credit,
adjust stock, read reports or edit the setup. A role the configuration does not define **fails
closed**.

---

## 4. Lifecycle, entitlement and payment

`lib/pos/entitlement.ts` + `lib/pos/settlement.ts`:

- States (§44): `DRAFT → CONFIGURED → PREVIEW → AWAITING_PAYMENT → PAYMENT_CONFIRMED →
  PROVISIONING → LIVE`, plus `SUSPENDED` / `CANCELLED`.
- `derivePosEntitlement({ subscription, entitlement, paidPayment, configurationStatus, now })` is
  the single authority. A business is **never** `LIVE` without an in-date `PosSubscription` on
  `BUSINESS_POS`; `CANCELLED` wins over everything; an expired plan becomes `SUSPENDED` with
  `nextAction: "renew"` (history stays readable, new money is refused).
- `lifecycleWithoutPayment` collapses `CONFIGURED` → `AWAITING_PAYMENT` for display, so an unpaid
  business is never shown as trading.
- `settlePosPayment(tx, …)` is idempotent: a `PENDING → PAID` `updateMany` plus a `ProcessedWebhook`
  row, then `provisionAfterPayment` in the **same transaction**. A replayed event settles once.
- `lib/paystack.ts:activateSubscriptionForPayment` needed no environment access, so tests drive the
  real settlement path without credentials.

**Checkout & callback (§4, §67, §80).** `app/api/checkout/route.ts` asserts the POS amount and
duration from `PlanConfig` (`assertPosPlanPricing`). `GET /api/paystack/verify` resolves the plan key
from the payment's own `planId` column — `Payment` has no Prisma relation to `PlanConfig`, so there
is nothing to `include` and a failed lookup degrades to the ordinary AFTERCALL answer — and for a
POS payment reads
`posSubscription` instead of the AFTERCALL `subscription` and returns `posBusinessId` on **every**
buyer-facing answer — paid, pending, repaired, failed and mismatched alike. `app/checkout/callback`
turns that id into `/dashboard/pos/<id>` (shape-checked against `^[A-Za-z0-9_-]{1,64}$`, never taken
from a query string), so a POS buyer lands in their POS and an AFTERCALL buyer lands exactly where
they always did. `lib/pricing.ts:publiclyListedPlans()` keeps `BUSINESS_POS` out of the landing
page's plan cards, the onboarding picker and customer-facing subscription copy. (The landing page
gained one dedicated POS entry of its own on 2026-10-03 — an entry point only; see §7.)

---

## 5. Money, stock and credit rules that matter

- **Prices are server-derived** from the tenant's own `PosProduct` rows. A client-sent
  `unitPriceKES` is honoured only for a role holding `EDIT_PRICE`, and the change is written to
  `PosAuditEvent` as `POS_PRICE_CHANGED` with before/after values (§37).
- **Part payments.** `validatePayments` refuses `SHORT_PAYMENT` unless the configuration allows a
  balance (`sales.partialPayments` or `sales.deposits`). Allowing *credit* alone is not enough: the
  refusal tells the owner to put the sale on the customer's account instead of inventing an
  unattributable debt (§30, §31).
- **Credit** (`lib/pos/credit.ts`) is decided server-side: `decideCredit` returns
  `{ allowed, reason, code, remainingKES, requiresApproval, newBalanceKES }` and refuses
  `OVER_LIMIT` rather than asking the browser. Customer credit and supplier credit are **separate
  ledgers** (`PosCreditEntry` with `partyType`), each with its own statements
  (`buildStatement`) and its own report (`outstanding_credit` vs `supplier_debt`).
- A fully-credit sale has `balanceKES: 0` — credit *is* the payment; the debt lives on the customer
  account and on the receipt's credit line.
- **Stock never moves silently** (§33). Every change writes a `PosInventoryMovement` with a signed
  `delta`, a `quantity`, a reason (`OPENING`, `SALE`, `RETURN`, `PURCHASE`, `PURCHASE_RETURN`,
  `ADJUSTMENT`, `DAMAGE`, `EXPIRY`, `COUNT`, `TRANSFER_IN/OUT`, `PRODUCTION_IN/OUT`, `WASTAGE`), a
  reference and the actor. A **money-only refund does not return stock**; stock comes back only for
  the refunded sale items named in the request (a `VOID` returns every line).
- **Corrections, never rewrites** (§54): refunds, returns, adjustments and reversals append rows.
  `PosSale.refundedKES` accumulates; the original sale row is not edited.
- **Purchases** (`lib/pos/operations.ts`): `receiveNow` defaults to *true* for a business that does
  not use purchase orders and *false* for one that does, so stock arrives when the business says it
  arrives — an order stays `ORDERED` until it is received, then `PARTIAL`/`RECEIVED`. Supplier credit
  writes `PAYABLE` ledger entries.
- **Receipts** are generated from configuration (§32): `formatReceiptNumber` gives `XX-000012`,
  `receiptToText` renders the configured layout, terminology and payment lines.
- **Reports** distinguish `recorded` (from rows), `calculated` (derived) and `estimate`, and a
  report the configuration cannot support answers `available: false` with a plain-language reason
  rather than returning zeros (§35). Date ranges are bounded by `sanitizeRange`
  (`startOfDay(from)` … `endOfDay(to)`) and can never widen into another tenant.

---

## 6. Configuration, cloning and versioning

- `buildConfiguration(answers, context)` turns answers into a `PosConfiguration`;
  `BASELINE_CAPABILITIES` guarantees the universal fallback POS (§47) — `pos_sale`, `receipt`,
  `cash`, `mpesa`, `catalogue`, `customer_profiles`, `customer_history`, `daily_sales`,
  `payment_breakdown` — so an unconfigured business can still trade.
- `applyQuestionDefaults` fills, at the **route boundary only** (`sanitizeAnswersPayload`), the
  defaults the questionnaire was already showing, so a skipped question cannot silently switch a
  module off (§17, §41).
- Everything on screen is generated: navigation and module labels, dashboard cards, quick actions,
  forms and field visibility, order states, payment methods, receipt layout, the report catalogue,
  empty states and the setup checklist (§23, §24, §34, §46, §60, §61). Terminology changes words
  only — `PosProduct` is still a product underneath.
- **Clone** (`copyConfigurationTo`) copies structure by granular scope (`capabilities`, `workflows`,
  `terminology`, `payments`, `categories`, `permissions`, `dashboard`, `receipt`, `rules`). It
  returns `{ ok, reason?, code? }`: `NOT_ALLOWED` when the target is not the caller's business, and
  `CLONE_SCOPE_REFUSED` **naming the refused scopes** when a caller asks for `sales`, `balances` or
  `secrets` — never a silent drop (§25, §50). Transactions, payment history, balances, receipt
  numbers, tenant ids and credentials are never copied.
- **Versions** (§48, §49): publishing appends an immutable `PosConfigurationVersion`; rollback adds
  a new version. Historical transactions are never rewritten by a configuration change.

---

## 7. Security posture (§5, §56, §67, §75)

- Tenant is derived from the authenticated session plus authorized business membership; a
  browser-supplied tenant id is compared and refused, and the attempt is audited.
- Foreign and missing record ids answer identically (no existence oracle).
- Forged payment confirmation fails: settlement requires the provider's own verified record, and
  amount/currency/reference mismatches are refused and audited.
- Replayed payment events settle once (`ProcessedWebhook` + conditional `updateMany`).
- Unauthorized refunds, discounts, credit approvals, configuration changes, branch access and staff
  management are refused by permission, and the refusal is audited.
- POS is **private** (§67): no POS plan, price or wording reaches the public business page, the
  customer-facing AFTERCALL copy, call instructions or phone redirection messages.
  - **Documented exception (product decision, 2026-10-03).** The public landing page (`app/page.tsx`)
    carries one dedicated **Business POS** entry: the product name, `KES 499/month` read from
    `POS_PLAN_PRICE_KES` (never a number written into the page), a plain-language line that the POS
    switches on only once Paystack confirms the payment, and a link into the existing
    `/dashboard/pos` flow. It is an entry point only — no second flow, no activation claim.
    `publiclyListedPlans()` and `PRIVATE_PLAN_KEYS` are unchanged, so the plan cards, onboarding
    picker and AFTERCALL subscription screens still exclude the private POS plan, and the business
    page and referral copy still never mention it.
- No secret is ever returned by a POS route; `PosConfiguration` stores no credentials.

---

## 8. Data model

24 tables, all additive, all keyed and indexed by `businessId`:

`PosConfiguration`, `PosConfigurationVersion`, `PosSubscription`, `PosEntitlement`, `PosTemplate`,
`PosBranch`, `PosStaff`, `PosProduct`, `PosInventoryItem`, `PosInventoryMovement`, `PosCustomer`,
`PosCustomerAsset`, `PosSupplier`, `PosSale`, `PosSaleItem`, `PosPayment`, `PosCreditEntry`,
`PosExpense`, `PosPurchase`, `PosPurchaseItem`, `PosOrder`, `PosOrderItem`, `PosOrderEvent`,
`PosAuditEvent`.

`prisma/migrations/20261003000000_business_pos/migration.sql` uses `CREATE TABLE IF NOT EXISTS`
only — no `DROP`, no `ALTER COLUMN`, no `ALTER TABLE` on a non-`Pos` table, no data rewrites.
`tests/unit/repair-guards.test.ts` reads the **raw SQL** and fails if any of those invariants break,
if a POS table loses `businessId`, or if an index is missing. Applying the migration to production
remains an operator-authorised step through the existing deployment gate (`scripts/build.sh` →
`scripts/migrate.sh`); nothing in this change runs it.

---

## 9. Tests — what each suite proves

| Suite | Proves |
| --- | --- |
| `tests/unit/pos-engine.test.ts` | Configuration from answers, capability prerequisites and cascades, workflows, terminology, generated navigation/cards/forms, receipts, report bases, preview sandbox purity |
| `tests/unit/pos-money.test.ts` | `calculateSale`, `validatePayments` (empty sale, disallowed method, credit not configured, short payment), `decideCredit` limits and approvals, statements, credit-word detection |
| `tests/unit/pos-entitlement.test.ts` | `derivePosEntitlement` across every lifecycle state, expiry → `SUSPENDED`, `CANCELLED` precedence, idempotent settlement |
| `tests/unit/pos-schema.test.ts` | Schema/migration invariants without a database (Prisma CLI is unavailable offline) |
| `tests/unit/pos-prisma-contract.test.ts` | Parses `prisma/schema.prisma` and checks every POS query against it: an `include` or a `where` filter through a relation the model does not have fails the build. Written after CI proved this repository's offline tooling cannot see that mistake |
| `tests/security/pos-tenant-isolation.test.ts` | Cross-tenant customer/sale/inventory/configuration access, forged tenant ids, foreign record ids |
| `tests/security/pos-permissions.test.ts` | Unauthorized refunds, discounts, credit approval, configuration changes, branch and staff access; unknown role fails closed. Also walks the baseline and all 56 business types and fails if the navigation offers a screen that screen's own route would refuse for its owner (§36, §47, §60) |
| `tests/security/pos-page-authorization.test.ts` | **21 tests**: the server-rendered POS pages (`/credit`, `/expenses`, `/staff`) are rendered against the in-memory database and must answer exactly like the module's API — an owner and any role holding the permission keep the screen; a cashier is refused with the read abandoned before a single row is loaded and the refusal audited as `POS_ACCESS_DENIED`; page and API agree actor for actor; cross-tenant, signed-out and unknown-business access still fail before rendering; lifecycle/payment gates unchanged (§11, §36, §44, §56, §75) |
| `tests/integration/pos-journey.test.ts` | The whole §4 journey at domain level, including the two-business §81 proof and clone safety |
| `tests/integration/pos-api-routes.test.ts` | **66 tests over HTTP**: the real route handlers against an in-memory Prisma double — workspace generation, configuration, preview, plan/payment/provisioning, sales and refunds, every operating screen, reports, audit, cloning, versions and the security matrix |
| `tests/integration/pos-payment-confirmation.test.ts` | The verification route for a POS payment (POS subscription read, `posBusinessId` on every outcome, refusals) and proof that every other plan is untouched (§80) |
| `tests/helpers/posFakeDb.ts` | In-memory Prisma double: `findMany/findFirst/findUnique/create/update/updateMany/delete/count/aggregate`, `$transaction`, relation `include`s, and a seeded two-tenant fixture |
| `tests/e2e/business-pos-journey.test.ts` | **22 steps against a real PostgreSQL database**, through the app's own route handlers: register → fallback POS (§47) → refused trading before payment (§44) → questionnaire configuration in plain language (§3, §52) → preview sandbox that writes nothing (§23) → refused publish (§44) → plan quoted from `PlanConfig` and kept off public surfaces (§45, §67) → server-priced checkout → server-confirmed payment provisioning to LIVE without writing an AFTERCALL subscription (§43, §80) → first sale with receipt and audited stock movement (§31–§33) → itemised refund that never rewrites the sale (§54) → server-decided credit (§30) → cashier refusals with attribution (§36, §75) → configured order workflow (§29) → expense, purchase and supplier ledgers (§12, §17) → labelled reports (§35) → audit entries (§37) → clone with scope and tenant refusals (§25, §50, §75) → versioning and rollback with history intact (§48, §49) → cross-tenant isolation including a body-supplied tenant id (§5) → lapsed plan (§44). Skipped without `DATABASE_URL`; CI runs it as its own step |
| `tests/e2e/interactive-business-journey.test.ts` | The pre-existing §66 platform journey. It shares the CI database job, which is how the POS payment path is proven not to have disturbed AFTERCALL (§80) |

Run them:

```bash
npx vitest run                                   # whole suite
npx vitest run tests/integration/pos-api-routes.test.ts
npm run test:e2e:pos                             # POS journey — needs DATABASE_URL
npx tsc --noEmit                                 # typecheck
npm run build                                    # must pass before deploy
```

Status at the time of writing: **824 passed / 5 failed / 39 skipped** offline (the 21 new
page-authorization tests included), where the 39 skipped are the two database journeys (17 §66 steps
+ 22 POS steps) that need `DATABASE_URL`. `tsc --noEmit` is clean and `npm run build` succeeds. The 5
failures are pre-existing and unrelated: the storefront
booking-slot tests assert fixed 10:00/11:00 availability that this sandbox's clock does not produce.
They fail identically at the branch point `8c81bb9` (verified with a `git worktree` checkout), and the
POS work neither touches nor fixes them. In CI, against PostgreSQL 16, both journeys run: the §66
journey **17/17** and the POS journey **22/22**.

---

## 10. Deliberately not built (§55, §63, §64, §68, §69, §71)

Named in the spec as *future-permitted*, and intentionally absent so nothing ships half-done:

- **Offline queue and sync** (§55) — the POS is server-authoritative; a local write-behind queue
  would need a conflict model that does not exist yet.
- **AI assistant layer** (§63, §64) — the required shape (AI proposes → system validates → owner
  confirms → server applies) is respected by the existing configuration engine, but no AI surface is
  wired into the POS.
- **Business intelligence** (§71), **customer-facing commerce from the POS** (§68) and the
  **unified customer record** (§69) — no speculative tables, no premature integration points.
- Two reports (`produce`, `rent`) are declared in the catalogue but honestly answer
  `available: false` until the data that would back them exists.

---

## 11. Known limitations

- **No database in this development environment.** `prisma generate` cannot reach
  `binaries.prisma.sh` here, so nothing was run against a real database locally. Substitutes used:
  `npx tsc --noEmit`, `npm run build`, `tests/unit/pos-schema.test.ts`,
  `tests/unit/repair-guards.test.ts`, `tests/unit/pos-prisma-contract.test.ts`, the in-memory
  double and, for the page-layer authorization fix, `tests/security/pos-page-authorization.test.ts`.
  The engine binaries are unavailable for a second reason in this sandbox: every Prisma CDN host
  (`binaries.prisma.sh`) and every GitHub release-asset host resolve to a blocked TLS handshake, so
  only `registry.npmjs.org`, `github.com`, `api.github.com` and `codeload.github.com` are reachable;
  the local machine has no PostgreSQL and no package mirror to install one from. The database
  journeys therefore run in CI, as they always have.
- **CI has since run the real thing, and it found two defects.** The `Journey against a real
  database` workflow provisions PostgreSQL 16 and ran, on this branch: `prisma generate` (client
  generated), `prisma migrate deploy` — **all five migrations applied successfully, including
  `20261003000000_business_pos`** — and `npm run seed` (the `BUSINESS_POS` plan seeded). Against
  that real client, two POS queries were invalid because they asked `Payment` for a relation it does
  not have (`include: { plan: … }` in the verify route and `where: { plan: { key: … } }` in
  `getPosEntitlement`, the path every POS request takes). Both were `PrismaClientValidationError`s in
  production while looking correct offline, where `prisma` is `any` and the in-memory double ignores
  relation filters. Both are fixed — the plan key is resolved by `planId` — and
  `tests/unit/pos-prisma-contract.test.ts` now fails the build if any POS query does it again.
- **The database-backed POS journey now runs in CI, and it found a third defect.**
  `tests/e2e/business-pos-journey.test.ts` is the POS equivalent of the §66 journey: 22 steps over
  the app's own route handlers against PostgreSQL 16, as its own CI step (`npm run test:e2e:pos`,
  which fails if the suite skips instead of runs). Its third step failed on the first run — an owner
  who had not answered the questionnaire yet was shown the fallback **Products** screen and an
  "+ Add product" action (§47, §60), then refused with "Owner cannot add and edit products", because
  `EDIT_INVENTORY` was gated on the `products` capability while the fallback baseline carries
  `catalogue`. Checking every navigation item against the permission its own route requires, for the
  baseline and all 56 business types, found **23 refused screens across 13 configurations**: Services
  for every service trade (laundry, car wash, cleaning, dental, transport, courier, consultancy,
  agency, professional services, membership), Products and Services for real estate and education,
  and Appointments/Jobs/Projects for barber, spa, clinic, dental, veterinary, car wash, construction
  and education — `VIEW_ORDERS` was gated on `orders` alone, while those trades reach the same board
  through `appointments`, `job_cards`, `projects` or `contracts`. A §81 business (a barber, a laundry)
  was being handed a POS whose own screens refused it. Fixed: a gate is now satisfied by any
  capability that makes the module real, with those sets defined once in `lib/pos/capabilities.ts`
  (`CATALOGUE_CAPABILITIES`, `STOCK_CAPABILITIES`, `ORDER_BOARD_CAPABILITIES`). Stock control did not
  move — `ADJUST_STOCK` still needs `stock_adjustments`, so a laundry can list services and still
  cannot adjust stock it does not keep. `tests/security/pos-permissions.test.ts` now fails if any
  configuration advertises a screen its owner is refused, or if a new screen appears without
  declaring which permission guards it.
- **Server-rendered POS pages authorize the business *and* the module read — the gap is closed.**
  The API routes
  check a module permission for every read and write, and the pages use `workspace.permissions` to
  hide *actions* (add, adjust, refund, manage). But 17 pages also read the store directly behind
  `loadPosWorkspaceCached`, which checks tenant membership and lifecycle only — so a cashier who
  navigated straight to `/credit`, `/expenses` or `/staff` could see data the equivalent API call
  refused. It was a within-tenant role leak, never a cross-tenant one: every write, and every
  cross-tenant read, was already refused and audited (§5, §36, §75).
  The page layer now enforces the same permissions its APIs do:
  `loadPosPageWorkspace(businessId, permission)` (`lib/pos/workspace.ts`) calls the existing
  `requirePosAccess` with `{ permission, fast: true }` — the same engine, the same audit entry and
  the same entitlement resolution the routes use — *before* any store read. A `PERMISSION` or
  `STAFF_INACTIVE` refusal is returned to the page, which renders `components/pos/PosRefusal.tsx`
  ("this screen is not for your role") instead of data; anything else (another tenant, a signed-out
  session, an unexpected failure) is re-thrown so the POS shell keeps explaining it exactly as it
  did. `/credit` now requires `VIEW_CREDIT` (the credit module's declared read permission — it has no
  API route of its own), `/expenses` requires `VIEW_EXPENSES` and `/staff` requires `VIEW_STAFF`,
  matching the routes exactly. `tests/security/pos-page-authorization.test.ts` renders the real page
  components against the in-memory database and proves: a cashier is refused on all three and the
  page's data loaders are never called (nothing protected is read, let alone rendered); an owner —
  and a salesperson, accountant or manager whose role holds the permission — keeps every screen that
  role is entitled to and is refused only the others; page and API answer identically actor for
  actor; the refusal is audited as `POS_ACCESS_DENIED` with `targetType: PERMISSION`; cross-tenant,
  signed-out and unknown-business access still fail before anything renders; and the
  lifecycle/payment gates are unchanged (reads work in every lifecycle state, writes still answer
  402 for an unpaid POS). `tests/security/pos-permissions.test.ts` now declares
  `credit: "VIEW_CREDIT"` in its screen map so the navigation/route coherence guard describes the
  page gate too. No other page was changed, no permission was added or re-pointed, and the API
  layers were not touched. Verified on the follow-up branch: `tsc --noEmit` clean, `npm run build`
  succeeds, **824 passed / 5 failed / 39 skipped** offline (the same five pre-existing
  booking-slot failures), **135/135** security tests, and the CI job on the pull request ran the
  real PostgreSQL §66 (17/17) and Business POS (22/22) journeys — the same job that fails a skipped
  POS journey — with both steps green.
- **The journey is sequential, so one failed step used to look like nine.** Steps share a registered
  owner, a configured business and a running stock tally. Each step now starts as the owner and the
  two steps that act as somebody else (13 as a cashier, 21 as another tenant) say so explicitly,
  because a failure part-way through one of them otherwise leaked that session into every later step.
- Barcode scanning (§59) is supported as keyboard-wedge input on the till and as a product field,
  with no camera-based scanning.
- Receipts are text/HTML; there is no ESC/POS printer driver.

---

## 12. Key decisions worth remembering

1. **Flat result types.** `tsconfig.json` has `strictNullChecks: false`, which breaks
   boolean-discriminated unions (TS2339). Every POS domain result is a flat object with optional
   fields plus a `*Problem()` helper that fills zeros — no `if (result.ok) result.sale…` narrowing.
2. **Never call a React API at module scope.** `lib/pos/workspace.ts` is imported by server code
   under React 18, where `import { cache } from "react"` is `undefined`; calling it at module scope
   throws and `next build` does not catch it. The helper is guarded.
3. **`const module = …` fails the build** (`@next/next/no-assign-module-variable`) — POS code uses
   `moduleKey`.
4. **Audit metadata is stored as a JSON string** in `PosAuditEvent.metadata` (`sanitizeMetadata`
   stringifies and strips forbidden keys; `listPosAudit` re-parses). There is no `metadataJson`.
5. **Domain results carry their own `code`.** `fromOutcome` maps only `NOT_ALLOWED` to 403, so a
   refusal that must be 403 has to say so itself.
6. **The schema is a contract, and offline tooling cannot enforce it.** `prisma` types as `any` here
   and the in-memory double ignores relation filters, so a query can be wrong in a way no local gate
   catches. `tests/unit/pos-prisma-contract.test.ts` parses `prisma/schema.prisma` and validates
   every POS `include`/`where` against it — including a synthetic self-check, because a scanner that
   matches nothing also reports nothing.
7. **Defaults are applied at the route boundary only.** Engine-level callers (`buildConfiguration`,
   `saveDraft`) still see an unanswered question as unanswered, which keeps the engine honest and
   the HTTP contract friendly.
8. **A screen in the navigation is a promise the API must keep.** `availableModules` decides what a
   business is shown from one set of capabilities and the permission gates decide what its API
   answers from another; when the two disagree the owner gets a dead end that reads as a bug in their
   own product, and no test that exercises one configured business can see it. The sets now live
   together in `lib/pos/capabilities.ts` (`CATALOGUE_CAPABILITIES`, `STOCK_CAPABILITIES`,
   `ORDER_BOARD_CAPABILITIES`) and `tests/security/pos-permissions.test.ts` walks the baseline plus
   all 56 business types to keep them agreeing.
