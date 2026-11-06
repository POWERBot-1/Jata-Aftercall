# 03 — Legacy-to-New Package Mapping & Customer Impact Assessment

**Status: DESIGN (mapping rules PASS) · per-customer application BLOCKED on the read-only
production inventory (`scripts/commercial/phase0_readonly_inventory.sql`, queries E–H).**
No customer row has been read, classified or changed by this workstream.

## 1. Legacy-to-new mapping (deliverable #4)

### Option A — **RECOMMENDED: key reuse, zero customer mutation**

| Legacy state | New catalogue key | Treatment |
|---|---|---|
| Any business with `Subscription.planId → AI_BUSINESS_FRONT_DESK` (KES 499/30), any status | `AI_BUSINESS_FRONT_DESK` = **Front Desk Starter** | **Untouched.** Same row id, same key, same price (499), same period (30d), same start/expiry, same payment history. Only the customer-facing *name* changes to "Front Desk Starter". |
| `AIPackageEntitlement.packageKey = AI_BUSINESS_FRONT_DESK` | same | Untouched; continues to grant Starter entitlements |
| Payments referencing `plan_ai_front_desk` | same | Untouched ledger |
| Team Free Access businesses | n/a (synthetic entitlement) | Untouched |
| Non-Front-Desk plans (MONTHLY, ANNUAL, Website Studio, POS, Autopilot, ERP) | unchanged keys | Out of scope; untouched |
| Unclassifiable/uncertain rows | — | Preserve as-is, classify in the exception register for manual review (§41.3) |

**Consequence:** the protected population (current KES 499 customers) requires **no entitlement
mutation, no date change, no re-charge and no interruption** — preservation is achieved by
*extending* the catalogue (three new rows) rather than rewriting existing ones. The recoverable
legacy↔new mapping is trivially total: legacy key = Starter key, identity mapping.

### Option B — new Starter key (`AI_FRONT_DESK_STARTER`), explicit migration

Only if the owner rejects key reuse. Requires: insert new Starter row; per-customer
`UPDATE Subscription SET planId = <new id>` + `UPDATE AIPackageEntitlement SET packageKey = …`
inside one idempotent, audited transaction per business; backfill `Payment.planId` **only if**
approved (default: leave historical `planId` pointing at the preserved legacy row so payment
history remains byte-identical); dual-read shim during transition; rollback = reverse mapping.
**Higher risk (F-2's `syncAIPackageEntitlement` would otherwise overwrite the new key), strictly
more writes, and no customer benefit over Option A. Not proposed.**

## 2. Migration rules for every existing subscription (§41.3)

1. **Preserve valid paid entitlements** — status, package, features exactly as today (Starter).
2. **Preserve payment references and billing history** — no `Payment` row created, edited or
   deleted under Option A; under any option, historical rows are append-only.
3. **Preserve start/expiry dates** — no reset, no extension, no shortening.
4. **No duplicate subscriptions** — `Subscription.businessId` unique already enforces this;
   migration creates zero new subscription rows (Option A).
5. **No duplicate charges** — migration performs no checkout, no Paystack call, no amount change.
6. **No entitlement interruption** — nothing flips status; lazy expiry semantics unchanged.
7. **No silent access change** — Starter gains/loses nothing at migration time; future changes
   only via decided matrix cells (`02_ENTITLEMENT_MATRIX.md`).
8. **Recoverable mapping** — identity mapping (Option A) recorded in the migration event log.
9. **Migration event recorded** — a single `AuditEvent` batch entry per run (id, operator,
   script version, row counts) — written only at execution time, which requires approval.
10. **Reconciliation report** — before/after counts by plan key, status, and entitlement class;
    every business accounted for; exceptions listed individually.

Where a mapping cannot be established safely (orphan entitlements, `planId` pointing at missing
rows, PAID payments with no subscription, contradictory statuses): **preserve current entitlement,
flag MANUAL_REVIEW in the exception register, do not touch.**

## 3. Customer impact assessment (deliverable #10)

| Population | Impact of migration itself (Option A) | Impact of going live with four tiers |
|---|---|---|
| Active KES 499 Front Desk subscribers | **None** — identical access until their own expiry | May be *offered* upgrades; price they pay does not change; renewal at 499 continues to work (Starter key unchanged) |
| Expired / cancelled / suspended | None (states preserved; historical access preserved) | Same as today; upgrade purchase path becomes available |
| Team Free Access | None | None |
| Page-plan / Website Studio / POS / Autopilot / ERP holders | None | None — their keys, prices and entitlements untouched |
| New customers | none pre-launch | See Starter/Standard/Pro/Voice at 499/999/1999/3999; server-side pricing identical in mechanism |
| Customers with uncertain status | Preserved + exception register | Same; manual review before any outreach |

**Billing implications:** no charge changes for anyone at migration time. First possible charge
differences occur only when a customer *chooses* a different tier through the normal verified
checkout. **No proration** is applied mid-period (see `04_LIFECYCLE_SPEC.md` §3).

## 4. What must be true before the per-customer plan is finalised

- Owner runs `scripts/commercial/phase0_readonly_inventory.sql` (read-only) on production and
  supplies output → population counts per status, anomaly list, exception register seeded.
- Rehearsal of the same queries + scripts against a non-production dataset (§41.9).
- Any Option-A surprise (e.g. production rows whose key is *not* `AI_BUSINESS_FRONT_DESK` but
  whose entitlement says Front Desk) goes to the exception register — **not** to an automatic fix.
