# 01 — Phase 0: Live Commercial Audit (READ-ONLY)

**Date:** 2026-11-05 · **Classification:** §41.2 audit of the existing commercial implementation
**Evidence basis:** (a) this checkout of `POWERBot-1/Jata-Aftercall` at branch point `19f11d9`;
(b) Vercel control plane, read-only (names/states only, no secret values retrieved);
(c) owner-supplied production `PlanConfig` query transcribed in `PLAN_CATALOGUE_AUDIT_2026-10-29.md`
Part II §12 (2026-10-29). **No database credential exists in this environment** (`.env*` contains
only `.env.example`; `DATABASE_URL`/`DIRECT_URL`/`PAYSTACK_*` are absent from the sandbox
environment), so no live customer rows were read by this agent.

---

## 1. Production control-plane state (read-only, 2026-11-05)

| Item | Value | Source |
|---|---|---|
| Project | `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`, team `powerbot-1`) | Vercel connector |
| Current production deployment | `dpl_9XjMnD81yAXWVW3THPS6K95vFA1K`, state **READY / PROMOTED** | Vercel connector |
| Production commit | `19f11d9ecd8daad1db2aaf35cc1166425f871acc` — *"Merge pull request #78 … Forensic audit: release blockers…"* (verified signature) | deployment metadata |
| Promoted at | 2026-11-01 ~16:17 UTC (epoch `1793549961283`) | deployment metadata |
| Production env var **names** present | `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_MERCHANT_ID`, `MPESA_*` (5), `CLIENT_KEY`, `ADMIN_EMAILS`, `NODE_ENV`, **`ERP_PRO_ENABLED`** | Vercel `list_projects` (names/targets only; values never retrieved) |
| `ERP_PRO_ENABLED` | **now present with target `production`** (created 2026-10-29, after the October audit recorded it absent). **Value NOT VERIFIED** — it is a sensitive variable; whether ERP is switched on in production is **NOT TESTED** in this phase | Vercel connector |
| Vercel cron definitions | `crons.definitions: []` — **no scheduled production jobs** | project metadata |
| Preview builds | skipped by the project's Ignored Build Step (`if [ "$VERCEL_ENV" == "production" ] …`), so pushing this branch runs no code and touches no database | project metadata |

## 2. Authoritative catalogue — code (Phase 1)

The authoritative catalogue is table **`PlanConfig`** (`prisma/schema.prisma:743-753`), keyed by
unique `key`. Writers: `prisma/seed.ts` (manual) and the authenticated admin plans API
(`app/api/admin/plans/route.ts`). **No migration inserts plan rows; `scripts/build.sh` never seeds.**
Money is DB-driven: `lib/pricing.ts` states *"Pricing is DB-driven (§16, §32, §39) — never scattered
hardcodes"* and centralises resolution so *"payable amount is always server-derived"*.

Complete key inventory as encoded in the repository:

| Key | KES | Days | Class | Where enforced |
|---|---:|---:|---|---|
| `MONTHLY` | 149 | 30 | Public page plan | `FALLBACK_PLANS`, seed |
| `ANNUAL` | 999 | 365 | Public page plan | `FALLBACK_PLANS`, seed |
| `AI_BUSINESS_FRONT_DESK` | 499 | 30 | Public add-on — **the single current Front Desk package** | `assertAIFrontDeskPricing` (`lib/pricing.ts`), inline guard `app/api/checkout/route.ts` (499/30), `AI_FRONT_DESK_PRICE_KES` (`lib/ai-entitlement.ts`), `FALLBACK_PLANS`, seed |
| `INTERACTIVE_BUSINESS` (branded Website Studio) | 999 | 30 | Public add-on | `assertInteractiveBusinessPricing`, `lib/experience/entitlement.ts` |
| `BUSINESS_POS` | 499 | 30 | **Private** (`PRIVATE_PLAN_KEYS`) | `assertBusinessPosPricing`, `lib/pos/entitlement.ts` |
| `JATA_AUTOPILOT` | 2,499 | 30 | Private | `assertAutopilotPlanPricing`, `lib/autopilot/entitlement.ts` |
| `JATA_AUTOPILOT_PRO` | 6,999 | 30 | Private | same |
| `JATA_AUTOPILOT_ENTERPRISE` | 19,999 | 30 | Private | same |
| `ERP_PRO` (branded JATA BOS PRO) | 3,000 | 30 | Private + feature flag | `lib/erp/entitlement.ts` — **absent from seed and from production rows** (Oct-29 evidence) |

**There is no four-tier Front Desk catalogue anywhere in the repository.** The only Front Desk
package is the single 499/30 `AI_BUSINESS_FRONT_DESK`.

## 3. Verified production catalogue (owner-supplied, 2026-10-29)

8 rows, all `isActive = true`, every price/duration matching §2 exactly; `ERP_PRO` absent
(`PLAN_CATALOGUE_AUDIT_2026-10-29.md` Part II §12). Before/after count 8/8; **writes: 0**.
This inventory is 7 days old at the date of this audit — re-verification with
`scripts/commercial/phase0_readonly_inventory.sql` (queries A–C) is required before execution.

## 4. Existing customer subscriptions & entitlements — data model

| Store | Cardinality / keys | Lifecycle fields | Notes |
|---|---|---|---|
| `Subscription` | **one row per business** (`businessId @unique`), `planId → PlanConfig` | `status` (PENDING/ACTIVE/EXPIRING/EXPIRED/SUSPENDED/CANCELLED), `startAt`, `expiresAt`, `graceUntil` | A business holds exactly ONE AFTERCALL subscription row; switching plan repoints the same row (`lib/paystack.ts` settlement, `subscriptionWindow` in `lib/paymentVerification.ts` extends an ACTIVE window rather than stacking) |
| `Payment` | `reference @unique`, `planId`, `amount` (kobo), `currency`, `status` (PENDING/PAID/FAILED/CANCELLED/EXPIRED/REFUNDED), `purpose` (SUBSCRIPTION/ORDER/BOOKING_DEPOSIT), `paystackId`, `raw` | audit trail via `AuditEvent` | single payment ledger for the whole app |
| `AIPackageEntitlement` | **one row per business** (`businessId @unique`), `packageKey` default `AI_BUSINESS_FRONT_DESK` | `status`, `activatedAt`, `expiresAt` | denormalised Front Desk entitlement |
| `PosSubscription`/`PosEntitlement`, `AutopilotSubscription`/`AutopilotEntitlement`, `ErpSubscription`/`ErpEntitlement` | per-business, per-product | own statuses | additive products with their own rows |
| `ProcessedWebhook` | `id @unique` (event id) | — | webhook idempotency |

**Critical architectural fact for the four-tier design:** because `Subscription.businessId` is
unique, the four Front Desk tiers compete for that single row — tier changes are *state
transitions of one row*, never a second concurrent subscription. The lifecycle spec
(`04_LIFECYCLE_SPEC.md`) is built on this.

**Customer inventory (deliverable #3): BLOCKED.** No database credential exists in this
environment and none was requested. The read-only pack `scripts/commercial/phase0_readonly_inventory.sql`
produces every required table (active/expired/suspended/cancelled entitlements, start/expiry
dates, payment references and verification status, package distribution, anomalies) and must be
run by the owner/operator on the enrolled production branch; output is transcribed back as
evidence exactly as on 2026-10-29.

## 5. Identifier map (deliverable #2)

| Concept | Identifier | Where it appears |
|---|---|---|
| Front Desk plan key (current, single tier) | `AI_BUSINESS_FRONT_DESK` | `PlanConfig.key`, `AIPackageEntitlement.packageKey`, entitlement guards, pricing copy, tests |
| Front Desk plan row id | `plan_ai_front_desk` (seed convention) | `PlanConfig.id`, `Payment.planId`, `Subscription.planId` |
| Checkout addressing | `planId` (any flow) or `planKey` (Autopilot-only allowlist) | `app/api/checkout/route.ts` |
| Paystack transaction reference | `generatePaymentReference()` → `Payment.reference` (unique) | checkout → `initializeTransaction` → webhook/verify |
| Paystack transaction id | `Payment.paystackId` / verified `transaction.id` | `activateSubscriptionForPayment` requires it as provider evidence |
| Webhook event id | `ProcessedWebhook.id` | idempotent processing |
| Currency | `PAYMENT_CURRENCY` = KES; amounts stored in **kobo** (`toKobo`) | `lib/money.ts`, `lib/paymentCurrency.ts` |
| AI entitlement row | `AIPackageEntitlement.businessId` (unique) | `lib/ai-entitlement.ts` |
| Product page slugs | `/products/ai-front-desk`, etc. | `app/products/[slug]` |
| Provider-side plan/product ids | **NONE** — see §8 | — |

## 6. Existing entitlement states (what the engine actually enforces)

`lib/ai-entitlement.ts` is the server-side gate for live Front Desk:

- `deriveAIEntitlement()` (pure, unit-tested) evaluates `subscription` + `AIPackageEntitlement`
  + latest `PAID` payment into statuses NONE/PENDING/ACTIVE/PAST_DUE/EXPIRED/SUSPENDED/CANCELLED
  with `graceUntil` support, and **fails closed** on unreadable billing (`verification:
  "UNAVAILABLE"` → not entitled, correct HTTP contract 503 vs 402).
- **Plan-substitution bypass is closed:** a subscription row belonging to any other plan key
  denies Front Desk even if a stale entitlement row still says ACTIVE
  (`subscriptionIsOtherProduct`), pinned by `tests/unit/ai-entitlement-plan-substitution.test.ts`.
- Team Free Access (`lib/team-access.ts`) grants a synthetic active entitlement with **no
  payment row** — a protected population the migration must not disturb.
- `syncAIPackageEntitlement()` upserts the entitlement row and **always writes
  `packageKey: AI_FRONT_DESK_PLAN_KEY`** — under Option B (new Starter key) this would overwrite
  migrated keys; under Option A it is harmless for Starter but must still learn the other three
  tiers. **Implementation blocker recorded.**
- **Four-tier gap:** any plan key ≠ `AI_BUSINESS_FRONT_DESK` currently resolves to
  `entitled: false` ("Current subscription plan does not include the AI Business Front Desk
  package"). Standard/Pro/Voice keys would be *purchased but not granted* until the entitlement
  engine is extended. **No tier may be sold before that extension ships in the same release.**

## 7. Checkout & payment architecture assessment (deliverable #7)

Flow: `POST /api/checkout` → server resolves plan from `PlanConfig` (never trusts browser amount)
→ validates per-plan pricing invariants (499/30, 999/30, POS, Autopilot, Website Studio; fails
closed with `PLAN_PRICING_INVALID`) → expires stale PENDING attempts → single-PENDING-per
(business, plan) duplicate-click guard (oldest row wins, loser CANCELLED) → creates
`Payment(PENDING, amount=toKobo(plan.priceKES))` → `initializeTransaction` (Paystack) with
`metadata {businessId, userId, planId, planKey}` → callback `/checkout/callback`.

Settlement (`app/api/paystack/webhook/route.ts`, `app/api/paystack/verify/route.ts`):

- **Signature:** HMAC-SHA512 of raw body vs `x-paystack-signature`, `timingSafeEqual`
  (`lib/paystack.ts:81-85`); failure → audit `WEBHOOK_SIGNATURE_FAILED`, 401.
- **Provider re-verification:** every `charge.success` re-fetches the transaction from Paystack
  and `validatePaymentEvidence()` must match reference + amount + currency + status=success +
  transaction id — a browser redirect or screenshot can never activate entitlement.
- **Idempotency:** `ProcessedWebhook` event-id guard (checked inside the settlement transaction);
  payment compare-and-set (`SETTLEABLE_PAYMENT_STATES`); `alreadySettled` responses.
- **Amount validation:** server-derived at initiation **and** re-checked against the provider
  transaction at settlement — a changed displayed price cannot alter the charge independently of
  `PlanConfig`.
- **Refunds:** `refund.processed` verifies amount/currency, marks REFUNDED, suspends the matching
  product's subscription/entitlement (POS/Autopilot/standard) in one transaction; partial refunds
  are audited for manual review, never auto-applied.
- **Failure handling:** `charge.failed` marks PENDING→FAILED; in-progress provider statuses are
  never recorded as failures; `SETTLEABLE_PAYMENT_STATES` lets a provider-verified success repair
  stale local FAILED/CANCELLED/EXPIRED rows (money is with the business).

**Assessment: the verification/webhook architecture is sound and must be preserved verbatim
(§41.6). The migration changes *what price/key the catalogue holds*, not *how payments settle*.**

## 8. Paystack dependency assessment (deliverable #8)

| Question | Finding |
|---|---|
| Are Paystack Plans/Products/Subscriptions used? | **No.** `initializeTransaction` performs one-off charges with a per-transaction amount; no plan/price/product code objects exist in the repo or in checkout metadata |
| Must provider-side configuration change for the four-tier prices? | **No.** Prices live only in `PlanConfig` + server-side assertions; Paystack never stores them |
| Provider-side changes required at all? | **None for pricing.** Only if the owner later elects Paystack-managed recurring plans (not proposed) |
| Secrets | `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_MERCHANT_ID` present in Production (names verified; values never retrieved) |
| Server-side amount validation | present at initiation and settlement (§7) — will be re-pointed at the four-tier assertions |
| Webhook URL / signature | unchanged by this migration |
| Duplicate-charge protection | single-PENDING guard + event-id idempotency + compare-and-set — unchanged; new tiers inherit it because they use the same code path |

## 9. Renewal, upgrade/downgrade, usage, notifications, admin — current state

| Concern | Current state | Evidence |
|---|---|---|
| Renewal | Renewing the same plan **extends** the ACTIVE window from `expiresAt` (`subscriptionWindow`) — no double-charge for overlap; verified payment settles stale states | `lib/paymentVerification.ts` |
| Expiry | Derived at read time from `expiresAt`/`graceUntil`; Autopilot/POS/ERP also have settlement-time EXPIRED transitions. **No scheduled production cron exists** (`crons.definitions: []`) — expiry of the standard `Subscription` row is lazy | Vercel metadata; `lib/ai-entitlement.ts` |
| Upgrade/downgrade | **Not implemented as a first-class transition** for the Front Desk package; the single `Subscription` row silently repoints to the newly purchased plan on settlement, keeping/stacking the window per `subscriptionWindow`. No proration, no mid-period entitlement differential | `lib/paystack.ts` settlement |
| Usage metering | **Studio AI only** (`lib/ai/quota.ts`: images/enhances/copy per rolling month per plan; preview quota 3/3/40). **No** Front Desk conversation/token/SMS/WhatsApp/voice-minute metering exists | `lib/ai/quota.ts` |
| Customer-facing usage visibility | Studio quota only; no subscription-period usage dashboard for Front Desk | — |
| Approaching-limit / renewal / expiry notifications | `app/api/notifications` is a generic notifications API; **no renewal/expiry/package-change notification job exists** (no cron) | §1 |
| Billing history | `Payment` + `AuditEvent` + `/receipt` + dashboard subscription page show plan, status, dates, receipt links | `app/dashboard/subscription/page.tsx` |
| Admin visibility | Admin plans CRUD (`/admin/plans`, with the Oct-29 key-truncation fix), audit events; **no admin screen enumerating customer entitlements/expiry across businesses** | `app/api/admin/plans/route.ts` |
| Hardcoded Front Desk price checks | `AI_FRONT_DESK_PRICE_KES = 499` (`lib/ai-entitlement.ts`), `assertAIFrontDeskPricing` 499/30 (`lib/pricing.ts`), inline checkout guard 499/30, `FALLBACK_PLANS`, `lib/landing.ts` card copy, pricing page copy, `PLAN_INCLUDES`/`PLAN_BADGES`, tests | grep: 23 non-test references to `AI_BUSINESS_FRONT_DESK` |
| Other products on this subscription architecture | MONTHLY/ANNUAL page plans and Website Studio share the single `Subscription` row; POS/Autopilot/ERP have parallel stores; Team Free Access is separate | §4 |

## 10. Phase 0 findings (each mapped to §41)

| ID | Finding | §41 relevance |
|---|---|---|
| F-1 | Catalogue is a single 499/30 Front Desk package; **no tier structure exists** in code, seed or (as of Oct-29) production | 41.1, 41.5 |
| F-2 | Entitlement engine hard-denies any key ≠ `AI_BUSINESS_FRONT_DESK`; `syncAIPackageEntitlement` force-writes that key — selling new tiers before extending it would take money without granting access | 41.4, 41.12 |
| F-3 | One `Subscription` row per business — tier changes must be modelled as transitions of that row | 41.7 |
| F-4 | Payment/webhook/verification/idempotency architecture is production-grade and must be preserved, not rebuilt | 41.6 |
| F-5 | No Paystack provider-side plan objects — price changes are local-catalogue-only | 41.5, 41.8 |
| F-6 | No usage metering for Front Desk; no renewal/expiry notifications; no scheduled cron at all | 41.8, notifications (41.10 #13) |
| F-7 | No first-class upgrade/downgrade; no proration rules | 41.7 |
| F-8 | No admin cross-customer entitlement view | 41.10 #12 |
| F-9 | Customer inventory unread: no DB credential in this environment; read-only pack prepared | 41.2, 41.3 |
| F-10 | `ERP_PRO_ENABLED` now exists in Production env (value unverified) — out of scope for this workstream but recorded | 41.2 |
| F-11 | Team Free Access and non-Front-Desk products (page plans, Website Studio, POS, Autopilot, ERP) share the payment stack; the migration must not touch their keys, prices or rows | 41.3, 41.6 |

**Phase 0 verdict: READ-ONLY AUDIT PASS (code + control plane + prior owner evidence).
Production customer inventory BLOCKED pending owner-run read-only SQL. Zero writes performed.**
