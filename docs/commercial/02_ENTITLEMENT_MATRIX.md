# 02 — Target Catalogue, Four-Tier Entitlement Matrix & Usage/Allowance Matrix

**Status: DESIGN — PROPOSED, NOT APPROVED, NOT IMPLEMENTED.**
Rule applied throughout (§41.4): a cell whose package assignment is not yet commercially or
technically established is marked **PENDING OWNER DECISION**. No allowance is invented; no costly
capability is silently included in a package.

## 1. Target live catalogue (§41.1)

| Package | Proposed `PlanConfig.key` | Price | Period | Row id (seed convention) |
|---|---|---:|---|---|
| Front Desk Starter | **`AI_BUSINESS_FRONT_DESK`** (reuse — see `03_LEGACY_MAPPING_AND_IMPACT.md` §1 Option A) | KES 499 | 30 days | `plan_ai_front_desk` (existing) |
| Front Desk Standard | `AI_FRONT_DESK_STANDARD` *(new)* | KES 999 | 30 days | `plan_ai_front_desk_standard` |
| Front Desk Pro | `AI_FRONT_DESK_PRO` *(new)* | KES 1,999 | 30 days | `plan_ai_front_desk_pro` |
| Front Desk Voice | `AI_FRONT_DESK_VOICE` *(new)* | KES 3,999 | 30 days | `plan_ai_front_desk_voice` |

Consistency surfaces that must all render/charge these values after implementation: `PlanConfig`
(authoritative), `prisma/seed.ts`, `FALLBACK_PLANS`, `assert*Pricing` guards, checkout
server-side validation, `/pricing`, `/products/ai-front-desk`, homepage cards + `PLAN_INCLUDES`
/`PLAN_BADGES` (`lib/landing.ts`), onboarding & `/dashboard/subscription` lists, admin plans API,
entitlement engine, usage enforcement, admin reporting. **A four-card pricing page without the
row/entitlement/checkout changes is explicitly out of scope and does not satisfy §41.12.**

All four keys are *publicly listed* (not in `PRIVATE_PLAN_KEYS`): they appear in onboarding and
the subscription payable list, exactly like the current package.

## 2. Entitlement matrix (server-side enforced)

Enforcement point: `deriveAIEntitlement`-family evaluation in `lib/ai-entitlement.ts` (extended),
called from `app/api/ai/entitlement/route.ts` and every AI surface. **UI hiding is never an
entitlement control.** "Starter" column = today's proven behaviour of `AI_BUSINESS_FRONT_DESK`.

| Capability | Starter (499) | Standard (999) | Pro (1,999) | Voice (3,999) |
|---|---|---|---|---|
| Business knowledge (services/offer grounding) | ✅ (current) | ✅ | ✅ | ✅ |
| Website chat channel | ✅ (current) | ✅ | ✅ | ✅ |
| WhatsApp channel | **PENDING OWNER DECISION** (does the current package already include WhatsApp reception? code path must be confirmed in implementation PR) | PENDING | PENDING | PENDING |
| SMS channel | ❌ not established | **PENDING OWNER DECISION** | PENDING OWNER DECISION | PENDING OWNER DECISION |
| Voice reception (inbound calls) | ❌ not established | ❌ not established | ❌ not established | **PENDING OWNER DECISION** (defining capability of the tier — technical readiness also PENDING) |
| Conversation capacity (concurrent/serial) | PENDING OWNER DECISION (today: unmetered) | PENDING | PENDING | PENDING |
| AI usage / token allowance | PENDING OWNER DECISION (today: unmetered) | PENDING | PENDING | PENDING |
| Customer memory (returning-customer context) | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Lead management | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Quotations | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Human handoff (to owner/staff) | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| POS integration | ❌ separate paid product (`BUSINESS_POS`) — must NOT be bundled without a decision | same | same | same |
| Booking integration | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Workflow automation | ❌ separate product family (Autopilot) — not bundled | same | same | same |
| Analytics | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Staff permissions | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Storage | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Voice minutes | n/a (no voice) | n/a | n/a | PENDING OWNER DECISION |
| Support & escalation | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Historical records access after expiry | ✅ `historicalAccessAllowed: true` (current, all statuses) | ✅ same rule | ✅ | ✅ |
| Grace period | existing `graceUntil` policy (shared) | same | same | same |

**Upgrade paths:** Starter → Standard → Pro → Voice (and downgrades) per `04_LIFECYCLE_SPEC.md`.
Cross-product upgrades (e.g. page plan → Front Desk) remain governed by the single
`Subscription` row rule.

**Implementation gate:** the entitlement engine must accept the four-key family, deny every other
key, and stop force-writing `packageKey: AI_BUSINESS_FRONT_DESK` in `syncAIPackageEntitlement`
for non-Starter tiers — with tests — **before any new tier can be sold** (finding F-2).

## 3. Usage & allowance matrix (deliverable #6)

Existing metering found in Phase 0: **Studio AI only** (`lib/ai/quota.ts` — images 40, enhances 40,
copy 400 per rolling month for `INTERACTIVE_BUSINESS`; preview 3/3/40). Nothing below exists yet.

| Meter | Source of truth today | Starter | Standard | Pro | Voice | Enforcement |
|---|---|---|---|---|---|---|
| AI requests / conversations | none | PENDING OWNER DECISION | PENDING | PENDING | PENDING |
| Tokens | none | PENDING | PENDING | PENDING | PENDING |
| WhatsApp messages | none | PENDING | PENDING | PENDING | PENDING |
| SMS segments | none (no SMS product) | n/a | PENDING | PENDING | PENDING |
| Voice minutes | none (no voice product) | n/a | n/a | n/a | PENDING |
| Storage | none | PENDING | PENDING | PENDING | PENDING |
| Studio images/enhance/copy | `lib/ai/quota.ts` (Website Studio plan) | unchanged — out of scope | — | — | — |

Rules (§41.8): allowances bind to the **entitlement + subscription period**; thresholds produce
customer-visible warnings before enforcement; **no automatic overage charges, paid add-ons or
automatic upgrades** — overage handling is **PENDING OWNER DECISION** and defaults to *deny at
limit with an upgrade prompt*. Cost attribution and admin reconciliation read the same meter
records (one ledger, no second counter — mirroring `lib/ai/quota.ts`'s design principle).

## 4. What "PENDING OWNER DECISION" means operationally

Each pending cell is tracked in the exception register (`05_REHEARSAL_ROLLBACK_CHECKLIST.md` §7).
Until a cell is decided: the feature is **not** granted to that tier, **not** marketed for that
tier, and its absence is stated honestly on the pricing surface. Deciding a cell later is a
catalogue change subject to the same approval gate.
