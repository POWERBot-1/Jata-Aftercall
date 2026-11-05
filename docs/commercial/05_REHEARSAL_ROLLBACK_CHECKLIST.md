# 05 — Migration Rehearsal, Rollback, Notifications, Execution Checklist & Acceptance

**Status: PLAN — all execution items NOT EXECUTED / NOT TESTED until the §41.11 approval gate.**

## 1. Reconciliation & rollback plan (deliverables #12)

**Reconciliation (before/after, every run):**

- B-1 counts: `PlanConfig` rows by key/price/duration/isActive (before: expect the 8 verified
  Oct-29 rows; after: expect 11 under Option A — 8 + three new tiers, `ERP_PRO` still absent
  unless separately authorised).
- B-2 counts: `Subscription` by plan key × status — must be **byte-identical** before/after
  (Option A mutates nothing).
- B-3 counts: `AIPackageEntitlement` by packageKey × status — identical.
- B-4 counts: `Payment` by status — identical; **zero** new Payment rows attributable to migration.
- B-5 exception query: every row failing the identity mapping (orphan planIds, PAID-without-
  subscription, contradictory statuses) — enumerated individually in the exception register.
- B-6 spot-check: five named active subscribers — start/expiry/receipt unchanged.

**Rollback (tested in rehearsal, prepared in `scripts/commercial/02_rollback_front_desk_catalogue.sql`):**

- The catalogue extension is **additive**: rollback = deactivate the three new keys
  (`isActive=false`). Existing rows, subscriptions, entitlements and payments are untouched by
  both directions, so no data restore is ever needed under Option A.
- If a sale occurred on a new key before rollback: those customers are **not** reverted
  silently — they keep access; the case goes to the exception register for manual handling
  (refund only through the authorised refund process).
- Code rollback = normal deployment rollback to the previous production deployment
  (`dpl_9XjMnD81yAXWVW3THPS6K95vFA1K` lineage); the old code ignores the three new keys only if
  rows are deactivated — hence **deactivate first, then roll back code** (order in §5).

## 2. Migration scripts (deliverable #11) — PREPARED, NOT EXECUTED

| Script | Purpose | Executed? |
|---|---|---|
| `scripts/commercial/phase0_readonly_inventory.sql` | Read-only production audit (SELECTs only): catalogue, subscriptions, entitlements, payments, anomalies, team-free, other products | **NO — awaiting owner/operator** |
| `scripts/commercial/01_extend_front_desk_catalogue.sql` | Idempotent `INSERT … ON CONFLICT (key) DO UPDATE` of Standard/Pro/Voice rows; guarded so it refuses to run if the Starter row is missing/wrong | **NO — awaiting approval** |
| `scripts/commercial/02_rollback_front_desk_catalogue.sql` | Deactivate exactly the three new keys | **NO — awaiting approval** |
| `scripts/commercial/03_reconcile.sql` | The B-1..B-6 before/after report | **NO** |

Rehearsal procedure (§41.9): run 01→03→02→01 against a **non-production** dataset seeded with a
representative customer slice; verify legacy access, new-tier checkout (mock provider in dev),
payment→entitlement activation, renewal/expiry, duplicate webhooks (replay the same event id),
interrupted migration (kill mid-script), rollback, then before/after reports. Evidence attached
to this file's §8 when run.

## 3. Production execution order (only after approval)

1. Re-run read-only inventory; confirm B-1 baseline (8 rows).
2. Freeze: no other deploys during the window.
3. Run `01` (catalogue extension). Verify 11 rows; Starter row id/price unchanged.
4. Deploy the implementation release (entitlement engine + checkout + surfaces + tests) —
   **same approved change record**.
5. Run `03` reconciliation; confirm B-2..B-4 byte-identical.
6. Signed-in smoke: four tiers listed with correct prices; one mock/dev checkout per tier;
   one legacy subscriber view unchanged (no payment completed against production).
7. Monitor webhook/audit streams for 24h; publish post-migration verification report (§6).

## 4. Customer notification plan (deliverable #13) — SENDING REQUIRES APPROVAL

| Audience | Message | When |
|---|---|---|
| All existing Front Desk subscribers | "Your plan is now called **Front Desk Starter** — same price, same expiry, nothing changes. New tiers available if you want more." | Day 0 (email via existing account email; in-dashboard banner) |
| Existing subscribers, T-3d | Standard renewal/expiry reminder (existing behaviour once notification job ships) | ongoing |
| All customers (marketing surface) | Four-tier comparison matching the real entitlement matrix; **no feature claimed that is PENDING OWNER DECISION** | at go-live |
| Exception-register cases | Personal outreach after manual review | per case |
| Team Free Access | No change notice needed (nothing changes) | — |

No price-change notice is required for legacy customers under Option A (their price does not
change).

## 5. Production execution checklist (deliverable #14)

- [ ] Owner-supplied read-only inventory output transcribed; exception register seeded
- [ ] Entitlement matrix cells resolved or explicitly left PENDING (and unmarketed)
- [ ] Implementation PRs merged with tests (checkout, entitlement, surfaces, catalogue tests)
- [ ] Rehearsal evidence attached (§2 procedure, all 12 checks of §41.9)
- [ ] **Explicit owner approval recorded** covering: catalogue rows, code release, scripts, window
- [ ] Baseline reconciliation captured (B-1..B-6)
- [ ] Script `01` run; 11-row verification
- [ ] Release deployed; smoke checks green
- [ ] Reconciliation after (B-2..B-4 identical; B-5 exceptions listed)
- [ ] Notifications dispatched (approved wording only)
- [ ] 24h webhook/audit monitoring clean
- [ ] Post-migration verification report published (§6)

## 6. Acceptance criteria matrix (§41.12) — status at 2026-11-05

| Criterion | Status |
|---|---|
| Four approved packages exist in authoritative catalogue | **BLOCKED** (design ready; rows not created — no approval) |
| Prices/periods correct | **BLOCKED** (same) |
| Checkout uses authoritative server-side pricing | **PASS** (existing mechanism proven for one tier; must be re-asserted for four at implementation) |
| Payment verification remains secure | **PASS** (architecture audited, untouched) |
| Each package grants only approved entitlements | **BLOCKED** (engine not yet four-tier) |
| Existing entitlements preserved/migrated per approved rule | **NOT TESTED** (Option A design = preserve-by-construction; needs inventory + rehearsal) |
| Payment/subscription history intact | **PASS by construction** (Option A writes nothing) / **NOT TESTED** in rehearsal |
| Renewals & expiry work correctly | **PASS** for existing tier (existing suites) / **NOT TESTED** for new tiers |
| Upgrade/downgrade rules work | **NOT TESTED** (spec written; no implementation yet) |
| Duplicate events cannot duplicate charges/entitlements | **PASS** (existing architecture + tests) |
| Usage attributed to business + period | **BLOCKED** (no Front Desk metering exists) |
| Customer-facing info matches entitlement system | **BLOCKED** (pricing copy must ship with matrix, PENDING cells excluded) |
| Reconciliation shows no unexplained discrepancies | **NOT TESTED** |
| Rollback/forward recovery tested | **NOT TESTED** |
| Approved change record + post-change evidence | **BLOCKED** (approval not yet sought) |

A pricing-page render or green build does **not** move any BLOCKED/NOT TESTED row to PASS.

## 7. Exception register (seeded from Phase 0 findings)

| ID | Item | Status |
|---|---|---|
| E-1 | Production customer inventory unread (no DB credential in environment) | OPEN — owner-run SQL |
| E-2 | All entitlement-matrix cells marked PENDING OWNER DECISION (§2 of `02_…`) | OPEN — owner decisions |
| E-3 | Upgrade overlap rule R-2 (residual absorption vs forfeit vs credit) | OPEN — owner decision |
| E-4 | Downgrade effective-at-period-end vs immediate | OPEN — owner decision |
| E-5 | `ERP_PRO_ENABLED` present in Production env, value unverified | OPEN — out of scope, recorded |
| E-6 | WhatsApp/SMS/Voice technical readiness per tier | OPEN — engineering readiness check at implementation |
| E-7 | Legacy "new name" notification (optional under Option A) | OPEN — owner decision |

## 8. Evidence log (appended as work proceeds)

- 2026-11-05 — Phase 0 code audit complete (`01_PHASE0_AUDIT.md`); Vercel control-plane read-only
  check complete; zero writes; deliverables 1–2, 4–9, 12–14 in design state; deliverable 3 BLOCKED.
