# AI FRONT DESK 2.0 — Commercial Migration Deliverables Index

**Workstream:** §41 Live commercial catalogue, customer entitlements and production billing migration
**Branch:** `arena/0a551243-jata-aftercall`
**Date opened:** 2026-11-05
**Gate status: PHASE 0 (READ-ONLY AUDIT) COMPLETE → DESIGN SUBMITTED → IMPLEMENTATION ACCEPTED
(PR #81) → RELEASE RUNBOOK PREPARED (`07_RELEASE_READINESS.md`) → AWAITING OWNER APPROVAL FOR
PRODUCTION.**

**Nothing in this workstream has been executed against production.** No `PlanConfig` row, no
subscription, no entitlement, no payment, no environment variable and no deployment has been
created, altered or removed by this workstream. All SQL in `scripts/commercial/` is *prepared,
not run*. Execution requires the explicit approval defined in §41.11.

**Implementation status (2026-11-05, updated):** the four-tier catalogue, entitlement family,
checkout guard, settlement stamping, seed rows, pricing/products/subscription/landing surfaces
and the admin entitlement column are **built and tested on this branch** (unit 2,778 pass,
integration 819 pass, security 393 pass; only pre-existing offline-Prisma failures remain).
Deliverable #3 (customer inventory) remains **BLOCKED** — awaiting the authorised read-only
production run. Nothing is deployed; production rows are not created; no customer row is touched.

---

## Execution sequence (§41.11) and where we are

```
AUDIT LIVE STATE ──► DESIGN CATALOGUE ──► DEFINE ENTITLEMENTS ──► MAP EXISTING CUSTOMERS
   [DONE, see 01]      [DONE, see 02]        [DONE, see 02]          [BLOCKED — needs owner-run
                                                                     read-only query, see 03/05]
        │
        ▼
REHEARSE MIGRATION ──► SUBMIT EVIDENCE ──► OBTAIN OWNER APPROVAL ──► EXECUTE (NOT AUTHORISED)
   [scripted, see 05]    [this index]        [OPEN — see README §Open decisions]
```

## Deliverables map (§41.10 → files)

| # | Required deliverable | File | Status |
|---|---|---|---|
| 1 | Existing live catalogue inventory | `01_PHASE0_AUDIT.md` §2–§4 | **PASS** (code + owner-supplied 2026-10-29 production query; re-verification pack in `scripts/commercial/phase0_readonly_inventory.sql`) |
| 2 | Existing package & product identifier map | `01_PHASE0_AUDIT.md` §5 | **PASS** |
| 3 | Existing customer entitlement inventory | `01_PHASE0_AUDIT.md` §6 + `scripts/commercial/phase0_readonly_inventory.sql` (queries E–H) + framework `06_CUSTOMER_MIGRATION_REGISTER.md` | **BLOCKED — awaiting authorised read-only production inventory.** Framework for population is ready; no customer record invented |
| 4 | Legacy-to-new package mapping | `03_LEGACY_MAPPING_AND_IMPACT.md` §1 | **PASS (design)** — Option A (key reuse) adopted for implementation; per-customer application **BLOCKED** on #3 |
| 5 | Four-tier entitlement matrix | `02_ENTITLEMENT_MATRIX.md` | **PASS (design)** — uncommercialised cells marked **PENDING OWNER DECISION** as required; engine implementation shipped, matrix cells still undecided |
| 6 | Usage & allowance matrix | `02_ENTITLEMENT_MATRIX.md` §3 | **PASS (design)** — all numeric allowances **PENDING OWNER DECISION** (none invented) |
| 7 | Checkout & payment architecture assessment | `01_PHASE0_AUDIT.md` §7 | **PASS** |
| 8 | Paystack dependency assessment | `01_PHASE0_AUDIT.md` §8 | **PASS** — no provider-side plan/product objects exist; no provider reconfiguration required for price changes |
| 9 | Subscription lifecycle & transition specification | `04_LIFECYCLE_SPEC.md` | **PASS (design)** — upgrade/downgrade implementation queued for approval-gated PRs |
| 10 | Customer impact assessment | `03_LEGACY_MAPPING_AND_IMPACT.md` §3 | **PASS (rules)** / per-customer report **BLOCKED** on #3 |
| 11 | Migration scripts & test evidence | `scripts/commercial/*.sql` + `05_REHEARSAL_ROLLBACK_CHECKLIST.md` §2, §8 | Scripts **PREPARED, NOT EXECUTED**; application test evidence recorded (§8); rehearsal **NOT TESTED** (non-production dataset + approval required) |
| 12 | Reconciliation & rollback plan | `05_REHEARSAL_ROLLBACK_CHECKLIST.md` §1, §3 | **PASS (plan)** / execution **NOT TESTED** |
| 13 | Customer notification plan | `05_REHEARSAL_ROLLBACK_CHECKLIST.md` §4 | **PASS (plan)** — sending requires approval |
| 14 | Production execution checklist | `05_REHEARSAL_ROLLBACK_CHECKLIST.md` §5 | **PASS (document)** |
| 15 | Post-migration verification report | `05_REHEARSAL_ROLLBACK_CHECKLIST.md` §6 (acceptance matrix) | **NOT TESTED** — pre-execution statuses recorded |
| — | Customer-by-customer migration & reconciliation framework | `06_CUSTOMER_MIGRATION_REGISTER.md` | **FRAMEWORK READY** — population BLOCKED on #3 |
| — | Release readiness: exact production sequence, rollback, reconciliation report, post-deploy verification | `07_RELEASE_READINESS.md` | **PREPARED** — execution gated on §41.11 approval + #3 |

## Open decisions required from the owner (before any implementation PR merges or any production change)

1. **Legacy key reuse (recommended) vs. new-key migration** — `03_LEGACY_MAPPING_AND_IMPACT.md` §1.
   Option A (recommended) reuses `AI_BUSINESS_FRONT_DESK` as the Starter key: **zero customer rows
   are mutated**. Option B creates a new Starter key and migrates rows under an approved rule.
2. **Entitlement allowances** — every numeric allowance in `02_ENTITLEMENT_MATRIX.md` §3 is
   **PENDING OWNER DECISION**. The matrix deliberately invents no allowance and silently includes
   no costly capability.
3. **Production inventory** — owner/operator runs `scripts/commercial/phase0_readonly_inventory.sql`
   (read-only; every statement is a `SELECT`) against the enrolled production Neon branch and
   supplies the output, so the customer-by-customer plan (deliverable #3/#10) can be completed.
4. **Production approval (still open)** — the instruction of 2026-11-05 authorised *code work on
   this branch*, which has proceeded. It does **not** authorise charges, catalogue writes,
   entitlement mutations, provider changes or deployment (§41.11): the exact changes, customer
   impact, scripts, rollback plan and verification evidence in these files must still be presented
   for explicit owner approval before any production step.
