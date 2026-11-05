# 07 — Release Readiness: Production Sequence, Rollback, Reconciliation & Verification

**Status: PREPARED — NOT EXECUTED. Implementation accepted (PR #81); production execution NOT
authorised (§41.11).** Prepared 2026-11-05. This file is the single consolidated runbook for the
approval-gated production phase; it references (does not duplicate) `05_REHEARSAL_ROLLBACK_CHECKLIST.md`
and `06_CUSTOMER_MIGRATION_REGISTER.md`.

---

## 1. Release identity & verified current state

| Item | Value (verified read-only 2026-11-05) |
|---|---|
| Pull request | #81, OPEN, `arena/0a551243-jata-aftercall` → `main` |
| Commits (preserved, never rewritten) | `b221cef` design docs · `be2779d` implementation · `1b09879` real-browser check alignment · `69c3261` + `c18772a` release runbook & inventory pack (docs-only follow-ups append; nothing is rewritten) |
| PR diff | 37 files, +1,794 / −93 vs base `19f11d9`; no debug leftovers (scan clean) |
| Production deployment | `dpl_9XjMnD81yAXWVW3THPS6K95vFA1K` — READY / PROMOTED at base `19f11d9` (PR #78). **Unchanged by this workstream.** |
| Production aliases | `jataaftercall.co.ke`, `www.jataaftercall.co.ke`, `jata-aftercall.vercel.app` (+ branch aliases) — official domain already bound to the current production deployment |
| Production DB writes by this workstream | **ZERO** — all SQL in `scripts/commercial/` is PREPARED, NOT EXECUTED |
| Official domain | https://jataaftercall.co.ke |

**CI evidence (PR #81): 18 PASS / 1 FAIL recorded at heads `be2779d`, `1b09879`, `69c3261` and
`c18772a`; the live head's checks are always visible in the PR checks panel.**

| Check | Result |
|---|---|
| Static (install, generate, lint, typecheck, audit) | pass |
| Schema, types, unit suite, build | pass |
| full-suite | pass |
| Migrations + schema on PostgreSQL 18 | pass |
| Migrations and PostgreSQL suite | pass |
| Production build path on PostgreSQL 18 | pass |
| Exact candidate applies on disposable PostgreSQL 18 | pass |
| Schema reconciliation proposal closes the drift | pass |
| Failure paths actually fail | pass |
| Journey against a real database | pass |
| D2 — build, audit and controls on the candidate tree | pass |
| Migration target guard | pass |
| Real-Chrome six-viewport capture on a disposable database | pass |
| capture | pass |
| Release gate (aggregate) | pass |
| instruction-integrity | pass |
| Vercel · Vercel Preview Comments | pass |
| **programme-completeness** | **FAIL — PRE-EXISTING** |

`programme-completeness` fails identically on the unmodified base `19f11d9` (verified via isolated
worktree, same exit 1): its 34 rows are **28 BLOCKED + 6 NOT_TESTED, zero FAIL** — all belong to
other programme directives (ADMIN-002…008 owner/production gates; MOTION-003/004/005/009/010;
ADMIN-023), none to this workstream's deliverables. It stays red until those programme rows are
completed through their own gates; **this workstream will not falsify programme statuses to clear
it.** Observed effect: PR merge state reports BLOCKED while it is red (repo admins decide whether
it is a required context; branch protection is not readable from this sandbox).

---

## 2. Production migration prerequisites (all must be TRUE before Step 1)

| # | Prerequisite | State |
|---|---|---|
| P-1a | **§41.11 approval — MERGE of PR #81** | **GRANTED 2026-11-05 (owner), contingent on P-2/P-7 below completing first** — merge executes only after inventory is supplied and every customer reconciled with zero unexplained discrepancies, with CI green |
| P-1b | **§41.11 approval — DEPLOY, scripts `01`/`03`, execution window, notification wording** | **OPEN — explicitly HELD for a separate production approval after merge** (owner decision 2026-11-05: "approve merge only; hold deploy/SQL") |
| P-2 | **Phase 0 customer inventory** — owner runs `scripts/commercial/phase0_readonly_inventory.sql` (validated; SELECTs only) per `scripts/commercial/README.md` and pastes the 16 result grids; register then populated from that verbatim output and every customer reconciled | **OPEN — owner accepted this step 2026-11-05 ("I'll run the SQL and paste the output here"); output not yet supplied** (deliverable #3 still BLOCKED until then) |
| P-3 | Owner decisions on all **PENDING OWNER DECISION** cells (`02_ENTITLEMENT_MATRIX.md` §2–§3; `05_…` §7 items E-2…E-7), or explicit acceptance that those capabilities stay unmarketed/undecided | **OPEN** |
| P-4 | Rehearsal evidence: `01 → 03 → 02 → 01` against a non-production dataset with a representative customer slice (§41.9 — legacy access, per-tier checkout, activation, renewal/expiry, duplicate webhook replay, interrupted migration, rollback) | **NOT TESTED** |
| P-5 | PR #81 merged to `main` by authorised reviewer | NOT DONE (by instruction) |
| P-6 | Deploy freeze agreed for the execution window (no other production deploys) | OPEN |
| P-7 | Baseline reconciliation captured (Section 5, BEFORE column) | NOT DONE |

---

## 3. Exact production migration sequence (after ALL prerequisites)

> **Order rule (corrected 2026-11-05): code BEFORE rows.** Old code + new tier rows is the one
> unsafe combination (old entitlement engine denies any key ≠ `AI_BUSINESS_FRONT_DESK`, so a tier
> could be sold without granting access). New code + no tier rows is safe (tiers simply do not
> exist: checkout returns `PLAN_NOT_FOUND`).

| Step | Action | Artifact | Expected result | Abort if |
|---|---|---|---|---|
| 0 | Re-run read-only inventory; complete register; capture baseline reconciliation | `phase0_readonly_inventory.sql`, `03_reconcile.sql` (BEFORE), `06_…REGISTER.md` | B-1 = **8** `PlanConfig` rows (Oct-29 verified); register fully populated; B-2…B-6 snapshots stored | Inventory cannot be obtained → **STOP (P-2 unmet)** |
| 1 | Obtain and record explicit §41.11 approval (P-1) covering every change in this table | change record | written approval on file | absent → **STOP** |
| 2 | Freeze deploys for the window (P-6) | — | freeze confirmed | — |
| 3 | **Deploy the approved release** (merge of PR #81 → production deploy) | Vercel production deploy from `main` | new deployment READY; `jataaftercall.co.ke` serves new release; **catalogue still 8 rows — tiers not yet listed** | deploy fails → fix forward; no SQL has run, nothing to roll back |
| 4 | Run the catalogue extension | `scripts/commercial/01_extend_front_desk_catalogue.sql` | guard passes (Starter 499/30 present); 3 rows inserted; R1 post = **11 rows**; Starter **id/key/price/duration unchanged**; Starter display name = "Front Desk Starter — KES 499/month" | guard raises → **nothing written** (script refuses); investigate before retry |
| 5 | Run reconciliation after | `scripts/commercial/03_reconcile.sql` | **B-2, B-3, B-4 byte-identical to baseline**; R5 exceptions empty/individually listed; R6 spot-check start/expiry unchanged | any B-2…B-4 diff → **STOP, execute rollback (Section 4)** |
| 6 | Signed-in smoke (Section 6, "smoke" subset) | manual / test accounts | Starter / Standard / Pro listed at 499/999/1,999 × 30d; Voice hidden until inbound voice reception is implemented and verified; one dev/mock checkout per tier activates the correct tier key; one legacy subscriber view unchanged; **no production charge completed** | smoke failure → **STOP, rollback (Section 4)** |
| 7 | Dispatch approved notifications (`05_…` §4 wording only) | existing email/in-dashboard channels | messages sent, log attached | wording not pre-approved → hold |
| 8 | Monitor 24 h; publish verification report (Section 6 full checklist + `05_…` §6 matrix update) | webhook/audit streams | zero attributable errors | sustained errors → incident per Section 4 |

---

## 4. Rollback procedure (prepared, tested-in-rehearsal-only)

**Trigger:** any failure at Steps 4–6, or material error found during the 24 h window.
**Catalogue deactivation stops new sales; it does not revoke existing entitlements.**

1. `scripts/commercial/02_rollback_front_desk_catalogue.sql` — closes new sales by setting
   `isActive=false` for the new tier rows. It never touches Starter, other plans, or customer
   rows. Voice is not advertised or sellable in this release.
2. **Keep the tier-aware application release deployed. Do not roll back to pre-tier code while
   any Standard/Pro customer has an unexpired subscription or grace period.** That older code
   does not recognise the new entitlement keys and would cut off paid access.
3. If an application rollback is unavoidable, first deploy a separately built and tested
   compatibility release that retains tier-aware entitlement evaluation and matching customer
   access paths. If no such release is available, stop and keep the current tier-aware code
   deployed while sales remain disabled.
4. Re-run `03_reconcile.sql`; confirm B-2…B-4 again identical to baseline and list any new-tier
   subscribers for continued access monitoring.
5. **No data restore is ever needed under Option A** — catalogue deactivation does not delete
   subscriptions, entitlements or payments. Customers who purchased a tier keep access through
   their paid term and grace period; never silently revoke or reclassify it.
6. **Forward recovery:** after the defect is fixed, re-run rehearsal (P-4), re-obtain approval if
   scope changed, then re-enable only the approved catalogue rows after verification.
---

## 5. Customer reconciliation report (template)

**Sources:** BEFORE/AFTER runs of `scripts/commercial/03_reconcile.sql`; population from
`phase0_readonly_inventory.sql`; per-customer detail in `06_CUSTOMER_MIGRATION_REGISTER.md`
(population remains **BLOCKED** until P-2).

### 5.1 Population fingerprint (must be byte-identical BEFORE vs AFTER)

| Query | Definition | Baseline expectation | Post expectation |
|---|---|---|---|
| B-1 / R1 | `PlanConfig` rows | 8 rows (verified 2026-10-29) | **11 rows** (+Standard, +Pro, +Voice; `ERP_PRO` still absent) |
| B-2 / R2 | `Subscription` by plan key × status | snapshot | **byte-identical** |
| B-3 / R3 | `AIPackageEntitlement` by packageKey × status | snapshot | **byte-identical** |
| B-4 / R4 | `Payment` by status (+ `max(createdAt)`) | snapshot | **byte-identical — zero new Payment rows attributable to migration** |
| B-5 / R5 | orphan `planId`s / contradictions | enumerated | empty or individually listed with disposition |
| B-6 / R6 | 5 most recent ACTIVE/EXPIRING Front Desk subscribers | start/expiry/receipt | **unchanged** |

### 5.2 Per-customer section (columns = `06_…REGISTER.md`; fill ONLY from supplied inventory)

| businessId | current plan key | status | startAt | expiresAt | last payment | mapped tier | action | exception ID |
|---|---|---|---|---|---|---|---|---|
| _(BLOCKED — no verified inventory)_ | | | | | | | | |

**Rule:** no customer row may be invented, assumed or migrated from inference; every customer is
reconciled against actual records before any customer-specific execution is sought.

### 5.3 Sign-off

- Prepared by: ____________ (date: ______) — baseline attached
- Reviewed by: ____________ (date: ______) — B-2…B-4 identical confirmed
- Exceptions dispositioned: ____________ (register IDs: ______)

---

## 6. Post-deployment verification checklist

**Domain & release**
- [ ] https://jataaftercall.co.ke serves the new release (alias already bound to production; confirm HTTP status + release SHA after deploy)
- [ ] `jata-aftercall.vercel.app` serves the same release; no stale alias

**Catalogue (SQL verification)**
- [ ] R1 = 11 active rows; four Front Desk tiers at 499 / 999 / 1,999 / 3,999, all `durationDays = 30`
- [ ] Starter row: same `id`, same `key = AI_BUSINESS_FRONT_DESK`, price 499/30 unchanged; display name "Front Desk Starter — KES 499/month"

**Surfaces (signed-in and signed-out)**
- [ ] `/pricing`: four tiers listed with correct prices/periods; PLAN_KIND/scope copy correct
- [ ] `/products` + `/products/ai-front-desk`: tier cards present, link to detail, price section lists four tiers
- [ ] Homepage: ten plan cards render; CTA routes resolve; `data-plan-count="10"` grid centred
- [ ] Dashboard → Subscription catalogue: only active, sellable tier offers with stored prices; Voice remains unavailable
- [ ] Dashboard → AI: price card shows the held tier (Starter fallback when none)
- [ ] Admin → Subscriptions: "Front Desk entitlement" column shows packageKey · status · expiry

**Checkout & payments (mock/dev amounts only — no production charge)**
- [ ] Per-tier checkout initiation returns server-priced amount (499/999/1,999/3,999)
- [ ] Tampered price/plan requests rejected (`PLAN_PRICING_INVALID` / `PLAN_NOT_FOUND` / `PLAN_UNAVAILABLE`)
- [ ] Paystack verification + webhook path unchanged: signature check, amount re-validation, `ProcessedWebhook` idempotency, duplicate charge replay → single activation
- [ ] R4 confirms zero Payment rows created by the migration itself

**Entitlements**
- [ ] Mock/dev purchase of each sellable tier stamps `packageKey` = purchased tier on `AIPackageEntitlement`; Voice checkout is rejected before payment
- [ ] Legacy subscriber: entitlement status/expiry byte-identical to baseline; only display name changed
- [ ] Non-Front-Desk plan holder: Front Desk still denied (no cross-product grant)
- [ ] Expiry/grace/suspend paths return the same pinned status reasons as before

**Monitoring (24 h)**
- [ ] Webhook error rate, checkout failures, entitlement denials — no attributable regression
- [ ] Update `05_…` §6 acceptance matrix rows with evidence (a green build alone moves nothing)
- [ ] Attach this completed checklist to the change record

---

## 7. Outstanding owner decisions (consolidated — nothing here may be assumed)

1. **§41.11 production approval — partial, recorded 2026-11-05:** MERGE **granted** (contingent on inventory + reconciliation + green CI); **DEPLOY/SQL/window/notifications still OPEN** — the remaining scope is exactly Section 3's table and requires a separate explicit approval after merge.
2. **Phase 0 inventory run** (P-2 / deliverable #3) — `phase0_readonly_inventory.sql` output supplied; register populated.
3. **Entitlement & allowance cells** — every `PENDING OWNER DECISION` cell in `02_ENTITLEMENT_MATRIX.md` §2–§3 (conversation capacity, channels, voice, overage; `05_…` E-2).
4. **Upgrade/downgrade rules** — E-3 residual absorption vs forfeit vs credit; E-4 effective-at-period-end vs immediate.
5. **Starter display-name change** — included inside script `01` (Option A as documented); strike the trailing `UPDATE … name` block if the owner wants zero touch to the Starter row.
6. **Starter key rename** (`AI_BUSINESS_FRONT_DESK` → `AI_FRONT_DESK_STARTER`) — optional follow-up, **PENDING**, never part of this release.
7. **Notifications** — E-7 legacy rename notice wording; marketing copy may only claim shipped capability (no WhatsApp/SMS/voice/volume until decided and enforced).
8. **`programme-completeness` red status — authorised resolution established (see §7.1).**
9. **E-5** `ERP_PRO_ENABLED` env value unverified (out of scope, recorded); E-6 WhatsApp/SMS/Voice technical readiness check at implementation of decided cells.

### 7.1 Programme-completeness: investigation result & authorised resolution

**What the check is:** `scripts/admin/check-programme-readiness.mjs` requires every requirement
header in `docs/ADMIN_BUILDING_INSTRUCTIONS.md` to have `status: "PASS"` in
`docs/agents/PROGRAMME_READINESS.json` with an acceptance description and existing evidence
files. It fails while any row is `BLOCKED`/`NOT_TESTED` — by design, it goes green only when the
**whole** agent programme is complete.

**Findings (verified, not assumed):**

1. The failure is **pre-existing**: identical exit 1 at base `19f11d9` (isolated worktree);
   34 rows = **28 BLOCKED + 6 NOT_TESTED, zero FAIL** — none belong to this workstream
   (ADMIN-002…008 owner/production gates; MOTION-003/004/005/009/010 motion directives;
   ADMIN-023 revision-inspection directive).
2. It **does not block merges**: PR #78 merged 2026-11-01 with `programme-completeness` itself
   **failing** on that PR (run 41323324358/job 124897966953) — so it is not an enforced merge
   requirement; `Release gate (aggregate)` is the green aggregate gate and it passes on PR #81.
3. It **cannot be legitimately cleared by this workstream**: marking those rows PASS without the
   underlying work + evidence would fabricate programme evidence, which is prohibited.

**Authorised resolution paths (owner/admin choice — outside this workstream's authority):**

- **(a) Complete the underlying programme directives** through their own gates (the only path the
  check itself accepts), or
- **(b) Repo admin adjusts the gate** — remove/repurpose the `programme-completeness` job or its
  required-context status, recording the decision in the change record, or
- **(c) Accept it as a permanent red advisory** on PRs (precedent: PR #78 merged in this state).

This workstream executes (c) by default (no action needed for merge) and recommends the owner
pick (a) or (b) for hygiene. **No status in `PROGRAMME_READINESS.json` will be altered here.**

### 7.2 Decision sheet — safe defaults, nothing invented

Each row: owner answers with an option letter (or "default"); defaults require **no** new policy
values and keep every undecided capability unmarketed and ungranted (`02_…` §4).

| # | Decision | Options | Safe default |
|---|---|---|---|
| D-1 | WhatsApp reception on Starter (does today's package include it?) | (a) confirm included → keep current behaviour · (b) not included → stays unmarketed | (b) unmarketed, behaviour unchanged |
| D-2 | SMS on Standard/Pro/Voice | (a) include per tier (needs SMS product readiness E-6) · (b) not included | (b) |
| D-3 | Voice reception on Voice tier (defining capability) | (a) include at launch (needs E-6 readiness) · (b) launch without voice, add later | (b) — tier sells with remaining features only |
| D-4 | Conversation/token/storage allowances per tier (§3 of `02_…`) | (a) set values per tier · (b) keep unmetered-as-today for all tiers | (b) unmetered, no overage ever auto-charged |
| D-5 | Overage handling at any future limit | (a) deny + upgrade prompt (spec default) · (b) paid overage (separate approval) | (a) deny + prompt |
| D-6 | Customer memory / leads / quotations / handoff / booking / analytics / staff / storage / support per tier | (a) assign per tier · (b) none until decided | (b) |
| D-7 | Upgrade overlap (E-3) | (a) residual absorption · (b) forfeit · (c) credit | needs explicit choice before upgrades ship |
| D-8 | Downgrade timing (E-4) | (a) end-of-period · (b) immediate | needs explicit choice before upgrades ship |
| D-9 | Starter display-name change inside script `01` | (a) keep · (b) strike the UPDATE block | (a) keep (Option A as documented) |
| D-10 | Legacy rename notification (E-7) | (a) send · (b) skip | (b) skip — no price/expiry change |

---

## 8. Recommended next action

**Owner (now):** run `scripts/commercial/phase0_readonly_inventory.sql` read-only against
production per `scripts/commercial/README.md` and paste the 16 result grids here (decision of
2026-11-05). **This workstream (on receipt):** populate `06_…REGISTER.md` from the verbatim
output only, reconcile every customer, close or enumerate exceptions, then **execute the granted
merge of PR #81** and report the merge SHA. **After merge:** book the rehearsal, decide the
`07_…` §7.2 decision sheet, and return for the **separate explicit DEPLOY/SQL approval** — only
that second approval unlocks Section 3 Steps 3–8 (deploy → `01` → `03` → smoke → monitor).
