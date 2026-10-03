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
| Tests | `tests/{unit,security,integration}/pos-*.test.ts` + `tests/helpers/posFakeDb.ts` | 9 suites |

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
duration from `PlanConfig` (`assertPosPlanPricing`). `GET /api/paystack/verify` now reads the plan
key with the payment (`include: { plan: { select: { key: true } } }`), and for a POS payment reads
`posSubscription` instead of the AFTERCALL `subscription` and returns `posBusinessId` on **every**
buyer-facing answer — paid, pending, repaired, failed and mismatched alike. `app/checkout/callback`
turns that id into `/dashboard/pos/<id>` (shape-checked against `^[A-Za-z0-9_-]{1,64}$`, never taken
from a query string), so a POS buyer lands in their POS and an AFTERCALL buyer lands exactly where
they always did. `lib/pricing.ts:publiclyListedPlans()` keeps `BUSINESS_POS` off the landing page,
the onboarding picker and customer-facing subscription copy.

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
| `tests/security/pos-tenant-isolation.test.ts` | Cross-tenant customer/sale/inventory/configuration access, forged tenant ids, foreign record ids |
| `tests/security/pos-permissions.test.ts` | Unauthorized refunds, discounts, credit approval, configuration changes, branch and staff access; unknown role fails closed |
| `tests/integration/pos-journey.test.ts` | The whole §4 journey at domain level, including the two-business §81 proof and clone safety |
| `tests/integration/pos-api-routes.test.ts` | **66 tests over HTTP**: the real route handlers against an in-memory Prisma double — workspace generation, configuration, preview, plan/payment/provisioning, sales and refunds, every operating screen, reports, audit, cloning, versions and the security matrix |
| `tests/integration/pos-payment-confirmation.test.ts` | The verification route for a POS payment (POS subscription read, `posBusinessId` on every outcome, refusals) and proof that every other plan is untouched (§80) |
| `tests/helpers/posFakeDb.ts` | In-memory Prisma double: `findMany/findFirst/findUnique/create/update/updateMany/delete/count/aggregate`, `$transaction`, relation `include`s, and a seeded two-tenant fixture |

Run them:

```bash
npx vitest run                                   # whole suite
npx vitest run tests/integration/pos-api-routes.test.ts
npx tsc --noEmit                                 # typecheck
npm run build                                    # must pass before deploy
```

Status at the time of writing: **794 passed / 5 failed / 17 skipped**. `tsc --noEmit` is clean and
`npm run build` succeeds. The 5 failures are pre-existing and unrelated: the storefront booking-slot
tests assert fixed 10:00/11:00 availability that this sandbox's clock does not produce. They fail
identically at the branch point `8c81bb9` (verified with a `git worktree` checkout), and the POS work
neither touches nor fixes them.

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

- **No database in this environment.** `prisma generate` cannot reach `binaries.prisma.sh`, so the
  migration has not been applied and no DB-backed integration test has run. Substitutes used:
  `npx tsc --noEmit`, `npm run build`, `tests/unit/pos-schema.test.ts`, `tests/unit/repair-guards.test.ts`
  and the in-memory double. **The migration must be applied to a disposable database and the POS
  journey re-run before production** (the same gate the Interactive Business work used — see
  `INTERACTIVE_BUSINESS_E2E_RUNBOOK_2026-10-02.md`).
- **No POS e2e suite against a real database yet.** The Interactive journey has
  `tests/e2e/interactive-business-journey.test.ts`; the POS equivalent is the natural next step once
  `DATABASE_URL` is available.
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
6. **Defaults are applied at the route boundary only.** Engine-level callers (`buildConfiguration`,
   `saveDraft`) still see an unanswered question as unanswered, which keeps the engine honest and
   the HTTP contract friendly.
