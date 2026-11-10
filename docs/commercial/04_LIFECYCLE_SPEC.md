# 04 — Subscription Lifecycle & Transition Specification (Four-Tier Front Desk)

**Status: DESIGN — PROPOSED.** Ground rules: server-authoritative pricing; provider-verified
settlement only; one `Subscription` row per business (F-3); no double charge for overlapping
periods; no paid-access removal before expiry without authorised reason (§41.7).

## 1. Shared invariants (all transitions)

- I-1 The charge amount always comes from `PlanConfig` for the *target* key; assertions
  (`assertFrontDeskTierPricing(key, plan)`) fail closed with `PLAN_PRICING_INVALID`.
- I-2 Entitlement activation requires Paystack-verified evidence (reference+amount+currency+status
  +transaction id) inside the settlement transaction — unchanged from Phase 0 §7.
- I-3 `ProcessedWebhook` event-id + payment compare-and-set keep duplicate callbacks idempotent.
- I-4 Every transition writes an `AuditEvent` with: actor (SYSTEM/customer/admin), from-state,
  to-state, plan key, effective date, payment reference (if any).
- I-5 Customer notification per §4 of `05_REHEARSAL_ROLLBACK_CHECKLIST.md`.

## 2. Transition table

| Transition | Effective date | Billing treatment | Entitlement treatment | Notification | Recovery |
|---|---|---|---|---|---|
| **New purchase** (any tier) | Settlement time | Full period price (499/999/1999/3999), one charge | Subscription row created (or repointed if a row exists — see §3), window = now+30d, entitlement ACTIVE for that tier | Welcome + receipt | Provider-verified success repairs stale PENDING/FAILED (existing) |
| **Renewal (same tier)** | Settlement time | Full period price again; window **extends** from current `expiresAt` (`subscriptionWindow`) — never overlaps | Status stays ACTIVE; `expiresAt += 30d`; tier unchanged | Renewal receipt; expiry warning at T-3 days (once notification job exists) | Same as above |
| **Upgrade (lower → higher tier)** | Settlement time of the higher-tier charge | Customer pays the **full higher-tier price for 30 days**; **no proration, no refund of the residual lower-tier period** (proposed — owner may override) | On settlement: tier key switches to target; `expiresAt` = max(current expiry, now) **+ 30d** (the paid new period is fully granted; the residual old period is absorbed — this is the *only* acceptable "overlap" rule: customer is never charged twice for the same instant, and never loses paid time) | Upgrade confirmation listing new entitlements | If charge fails: existing tier untouched (settlement never runs) |
| **Downgrade (higher → lower)** | End of current paid period (proposed) | No charge now; next renewal bills the lower price | **Deferred:** entitlement stays on the higher tier until `expiresAt`, then becomes the lower tier. Immediate-downgrade variant is PENDING OWNER DECISION | Confirmation + effective date | Reversible until effective date (admin can cancel the scheduled change) |
| **Mid-period package change** | per above | Never refunds automatically; never double-charges | Same as upgrade/downgrade | Same | — |
| **Cancellation** | Customer action | No further charges; no refund unless via existing authorised refund process | Runs to `expiresAt` (grace policy applies), then EXPIRED; historical access retained | Cancellation confirmation; pre-expiry reminder | Re-subscribe anytime |
| **Expired** | `expiresAt` passed | — | Not entitled (lazy evaluation, unchanged); historical access retained | Expiry notice (needs notification job) | Renewal reactivates; verified payment can repair stale states |
| **Failed renewal / failed charge** | — | No state change (in-progress statuses never marked failed; `charge.failed` → payment FAILED only) | Existing entitlement untouched until real expiry | Dunning notice (PENDING OWNER DECISION on cadence) | Retry by customer; existing settle-repair path |
| **Duplicate payment callbacks** | — | Idempotent — at most one settlement | Idempotent — `alreadySettled` | none | `ProcessedWebhook` |
| **Refund / reversal** | Provider event | Existing authorised path: verify amount/currency → REFUNDED | SUSPENDED for the affected product only (existing webhook logic, extended to the four-key family) | Refund confirmation | Existing manual review for partials |
| **Legacy subscription** | migration instant (Option A: no-op) | unchanged | unchanged | optional "same plan, new name" notice (PENDING OWNER DECISION) | identity mapping |
| **Uncertain status** | — | no change | preserved + MANUAL_REVIEW | none until reviewed | exception register |

## 3. Double-charge & overlap rules (explicit)

- R-1 Renewal of the same tier extends from `expiresAt` — two charges can never buy the same
  instant (existing `subscriptionWindow`).
- R-2 Upgrade charges once for the new 30-day period and grants it **on top of** residual time
  (net effect: customer gains time, loses nothing; company absorbs the overlap — the only rule
  that satisfies "do not charge twice for overlapping periods" *and* "do not remove paid access").
  **PENDING OWNER DECISION** if the owner prefers residual-time forfeit or credit.
- R-3 Downgrade charges nothing at switch time; the paid higher tier runs to its natural end.
- R-4 Checkout's single-PENDING guard + unique `Payment.reference` + event idempotency (I-3)
  prevent duplicate charges from any client behaviour.

## 4. Test matrix (mapped to existing suites; new-tier rows are implementation-PR work)

| Behaviour | Existing suite | New-tier coverage needed |
|---|---|---|
| Server-side amount, no client trust | `tests/integration/checkout-route.test.ts`, `tests/unit/pricing-ai.test.ts` | 999/1999/3999 assertions |
| Webhook signature + idempotency | `tests/security`/`tests/integration/paystack-webhook-route.test.ts`, `payments-webhooks.test.ts` | duplicate events across new keys |
| Settlement idempotency & repair | `payment-settlement.test.ts`, `checkout-idempotency.test.ts` | tier-family settle |
| Entitlement derivation | `ai-entitlement.test.ts`, `ai-entitlement-plan-substitution.test.ts` | four accepted keys; all other keys denied; `syncAIPackageEntitlement` preserves tier key |
| Renewal extension | `ai-front-desk-lifecycle.test.ts` | per-tier |
| Upgrade/downgrade | **none today** | new suite `front-desk-tier-transitions.test.ts` (R-1..R-3) |
| Catalogue consistency | `subscription-catalogue.test.ts`, `plan-catalogue-visibility.test.ts` | four public tiers, prices, order |
| Postgres entitlement | `ai-front-desk-entitlement-postgres.test.ts` | tier rows |
