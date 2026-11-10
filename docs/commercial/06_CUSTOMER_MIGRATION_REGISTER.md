# 06 — Customer-by-Customer Migration & Reconciliation Framework

**Status: FRAMEWORK READY — POPULATION BLOCKED on the authorised read-only production inventory
(`scripts/commercial/phase0_readonly_inventory.sql`).** No customer record has been read,
invented, classified or changed. This file defines exactly how every production customer will be
accounted for the moment the verified inventory output is supplied.

## 1. How the register is populated (no manual data entry, no invention)

1. Owner/operator runs `scripts/commercial/phase0_readonly_inventory.sql` (SELECTs only) on the
   enrolled production branch and returns the raw output (exact steps:
   `scripts/commercial/README.md`). **This repository is PUBLIC:** raw output with customer
   emails never enters it. The register below is populated from that output using pseudonymous
   `businessId`s and masked emails (`j***@example.com`); full emails remain in the owner's
   private inventory copy.
2. Every row of query **E2** (subscriptions) becomes one register line; query **F2**
   (entitlements) and query **C/D** (payments) are joined onto it by `businessId`.
3. Every row of queries **G1–G4** (anomalies) becomes an exception-register line — never an
   automatic fix.
4. Query **H** snapshots the protected out-of-scope populations; query **I** is the duplicate-
   charge canary; **J** the idempotency baseline.
5. Counts from **E/F/C** are stored as the BEFORE snapshot for `scripts/commercial/03_reconcile.sql`
   (run again as AFTER; under Option A, R2/R3/R4 must be byte-identical).

## 2. Classification rules (applied mechanically, per §41.3)

| Class | Rule | Treatment |
|---|---|---|
| `PRESERVE_AS_STARTER` | Subscription.planId → `AI_BUSINESS_FRONT_DESK` (any status) or entitlement `packageKey = AI_BUSINESS_FRONT_DESK` | **No write.** Identity mapping to Front Desk Starter; dates, payments and access untouched |
| `PRESERVE_OUT_OF_SCOPE` | Plan key ∈ {MONTHLY, ANNUAL, INTERACTIVE_BUSINESS} or POS/Autopilot/ERP stores | No write; counted in protected-population reconciliation (query H) |
| `PRESERVE_TEAM_FREE` | Verified Team Free Access (synthetic entitlement, no payment) | No write |
| `PRESERVE_UNCERTAIN` | Any row failing the identity mapping: missing planId target, PAID-without-subscription (G4), contradictory entitlement vs subscription (G3), unknown packageKey (G2), multiple anomalies | **Preserve current entitlement as-is**, flag `MANUAL_REVIEW` with the exact anomaly, seek instructions — never guess |
| `NEW_TIER_CUSTOMER` (post go-live) | Subscription/entitlement on STANDARD/PRO/VOICE created after execution | Normal lifecycle; verified by reconcile R6 spot-checks |

**Forbidden by construction:** creating, editing or deleting any `Subscription`, `Payment`,
`AIPackageEntitlement` or billing row as part of classification. Option A's whole point is that
the safe classification requires zero customer writes.

## 3. Register template (one line per customer, produced from the inventory)

| businessId | userId/email | plan key (before) | subscription status | startAt | expiresAt | graceUntil | entitlement packageKey | entitlement status | last PAID reference | amount (KES) | verified? | class (§2) | anomaly codes | migration action | action result | reconciler | timestamp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| *(populated from queries E2/F2/C — never by hand)* | | | | | | | | | | | | | | `NONE (Option A)` or `MANUAL_REVIEW` | | | |

Totals row: `n_subscriptions`, `n_entitlements`, `n_paid_payments`, counts per class — must sum
against queries E/F/C exactly (zero unaccounted customers = the §41.10 "every affected customer
accounted for" criterion).

## 4. Per-customer verification procedure (post-approval execution, §41.9)

For each register line, after the approved change record executes:

1. BEFORE snapshot values (already recorded) — unchanged under Option A.
2. AFTER read: same row via `03_reconcile.sql` R6-style query — start/expiry/status/payment
   references byte-identical.
3. Access probe: signed-in read of the entitlement status endpoint returns the same
   `entitled`/`expiresAt` as before (or the approved new value for an executed upgrade).
4. Mark `action result = VERIFIED_IDENTICAL` or open an exception with evidence.

## 5. Exception register (extends `05_…§7`)

| ID | Source | Rule | Status |
|---|---|---|---|
| E-1 | inventory not yet supplied | whole register unpopulated | OPEN — awaiting owner-run SQL |
| E-2…n | one line per G1–G4 anomaly row | preserve + MANUAL_REVIEW | seeded at population time |

## 6. Exit criteria for this framework

- [ ] Inventory output received and transcribed verbatim
- [ ] Register populated for 100% of rows in query E2/F2 (no hand-authored rows)
- [ ] Class totals reconcile to BEFORE snapshot counts
- [ ] Every anomaly has an exception line with an owner decision recorded
- [ ] Framework statuses in `README.md` §Deliverables move from BLOCKED to PASS with evidence
