# POS / ERP - PRO — Business Operating System gap matrix

**Directive:** "Unified Business Operating System" (owner, 2026-10-28) — ~20 integrated modules.
**Head reviewed:** `e500664` on `arena/7a3563c1-jata-aftercall` (PR #71, base `main`).
**Report date:** 2026-10-28.

This document exists because the directive's scope is much wider than the software, and the gap
must be stated in the same units the directive uses. Each row was checked against the repository,
not against the roadmap. Labels: **PASS** (works and is proven), **PARTIAL** (a real subset works),
**FAIL** (present but broken), **NOT TESTED** (code exists, no proof), **MISSING** (not built).

The ERP Pro product is **additive** beside the existing Business POS: 38 new models
(`Erp*` / `Msg*`), one additive migration, its own plan (`ERP_PRO`, KES 3,000/30 days). No existing
POS model, order transition, payment path or migration was modified.

## 1. What the directive asks for, versus what exists

| # | Module | Status | What actually exists | What is missing |
|---|---|---|---|---|
| 1 | POS and sales | **PARTIAL** | Pre-existing POS: `PosSale`, `PosSaleItem`, `PosPayment`, `PosInventoryMovement`, branches, staff, receipt sequences, idempotency records, refund path. ERP Pro adds storefront orders on top of the same catalogue. | Shift open/close and cash-drawer reconciliation as first-class objects; barcode-driven flow verified in a browser; offline queue for the ERP storefront. |
| 2 | CRM and customer lifecycle | **PARTIAL** | `PosCustomer`, `MsgContact`, consent + suppression + audience models, segmentation (`lib/messaging/segments.ts`), import with de-duplication (`lib/messaging/import.ts`), ERP `/customers` page. | Leads/pipeline/stages, quotes, opportunities, support cases, merge workflow, retention automation. |
| 3 | Products and inventory | **PARTIAL** | `PosProduct`, `PosInventoryItem`, `PosInventoryMovement` (signed delta + reason + unit, multi-branch), stock reads inside ERP, low-stock surfacing. | Warehouses as entities, batches/lots/expiry/serials, transfers UI, stocktake reconciliation, explicit costing method, valuation reports. |
| 4 | Orders and fulfilment | **PARTIAL** | `ErpStoreOrder` + items, a validated state machine (`orderTransitions`, 16 PG tests), public tracking page with a token, `PosOrderEvent` audit. | Picking/packing/dispatch, proof of delivery, partial fulfilment, delivery assignment/fleet, profitability reporting. |
| 5 | Procurement and suppliers | **MISSING** | `PosSupplier` exists (name, terms, credit, balance) and `PosPurchase`/`PosPurchaseItem`. | Requisitions, purchase orders with approval thresholds, goods-received notes, three-way matching, lead-time and price history, reorder proposals. |
| 6 | Accounting and finance | **PASS (core)** | Real double-entry: `ErpAccount`, `ErpPeriod`, `ErpJournal`, `ErpJournalLine`, immutable posted journals, controlled reversals, period close/reopen, trial balance, invoices + payments + allocations, credit notes, expenses, supplier bills, Kenya tax rules. Proven by the PG suite. | Bank feed import and reconciliation matching; P&L/cash-flow *reports* beyond trial balance (data is there, report surface is thin); no statutory filing. |
| 7 | Approvals and finance operations | **PARTIAL** | Role limits (`ERP_APPROVAL_LIMITS_CENTS`), approval-required paths on high-impact actions, immutable `ErpAuditEvent`, RBAC resolved server-side. | A general approval-request object with submit/approve/reject/comment/delegate/escalate, and per-tenant configurable thresholds. |
| 8 | Documents and records | **MISSING** | `ErpKycDocument` only (compliance evidence placeholder). The repo has a separate durable media stack for the POS/website. | Document register, versions, categories, expiry reminders, retention, access-controlled download, tenant-scoped storage paths for ERP records. |
| 9 | Tasks, projects, workflow | **MISSING** | The automation engine can *create a task* action, but there is no task entity, board or calendar. | Task/project model, assignment, dependencies, checklists, escalation, activity history. |
| 10 | Messaging and communication | **PASS (engine), MISSING (inbox)** | SMS/WhatsApp campaign engine with consent, suppression, audiences, templates, sender-ID registry + events, wallet with reservations, idempotent dispatch, dry-run preview, per-recipient ledger. | Shared inbox / conversation threading, assignment, SLA escalation, email channel, internal announcements. |
| 11 | HR, workforce, payroll | **MISSING** | `PosStaff` (POS operators). | Employee records, shifts, attendance, leave, payroll inputs/exports, offboarding. |
| 12 | Assets, maintenance, fleet | **MISSING** | `PosCustomerAsset` (customer-owned item history). | Internal asset register, preventive maintenance, work orders, downtime, fleet/fuel/driver records. |
| 13 | Customer service | **MISSING** | — | Cases, SLA, knowledge base, internal notes. |
| 14 | Marketing and growth | **PARTIAL** | Campaign engine + segments + consent + opt-out enforcement. | Attribution, coupons/promotions, drip/re-engagement builders, performance dashboards. |
| 15 | Compliance, risk, safety | **PARTIAL** | `ErpComplianceProfile`, Kenya sector matrix, tax-rule registry with version, eTIMS readiness posture and submission states (uncertainty modelled explicitly), `lib/erp/compliance.ts`. | Licence/permit register with expiry, inspections, incidents, risk register, training records. |
| 16 | Business intelligence | **PARTIAL** | `/reports` page, trial balance, wallet/usage reporting, `app/api/erp/[businessId]/export` (CSV), `/api/erp/status` health. | Documented metric definitions, drill-down everywhere, saved views, scheduled exports, margin analytics. |
| 17 | AI business assistant | **MISSING (ERP)** | The platform has AI front-desk / autopilot features elsewhere; **none of it is wired to ERP data**, and no grounded ERP assistant exists. | Tenant-scoped retrieval, citations to records, permission filtering, kill switch, usage limits, audit of AI actions. |
| 18 | Automation engine | **PARTIAL** | `ErpAutomationRule`, `ErpAutomationRun`, validated triggers/conditions, kill switch, approval flags, idempotency, run history, starter rules per industry pack. Only the **LOW-impact** actions are implemented (`NOTIFY`, `CREATE_TASK`, `SUGGEST_PURCHASE`, `ADD_TAG`); `SEND_TEMPLATE`, `PAUSE_CAMPAIGN`, `POST_JOURNAL` are declared `implemented: false` and refuse. | Scheduled/cron execution, retries + dead-letter, loop protection limits, dry-run UI, the three unwired actions. |
| 19 | Integrations and API platform | **PARTIAL** | `MsgChannelConnection` (provider credentials per tenant), provider adapters behind flags, webhook routes, idempotent event processing, sender-ID and delivery-event ingestion. eTIMS is readiness-only. | OAuth-style connection lifecycle, secret rotation, versioned public API, integration health dashboard, accounting/logistics/email connectors. |
| 20 | Continuity and disaster recovery | **PARTIAL** | Migration rollback rehearsed with `pg_dump`/`pg_restore` into a scratch database and row-count comparison (`scripts/erp/migration-verify.sh`, 24 PASS); documented reverse-dependency drop order; idempotent re-apply. | Application-level backup/restore rehearsal on real data volumes, RPO/RTO numbers, job-failure monitoring, incident runbook, tested restore-from-snapshot on the provider. |

**Count:** 1 PASS-core (accounting), 2 PASS-engine (messaging fire-path), 9 PARTIAL, 8 MISSING.
No module in the directive is falsely marked complete, and no module in this table is represented
in the UI as a working feature when the row above says otherwise.

## 2. Architecture facts the directive assumes

| Assumption | Reality on this head |
| --- | --- |
| Multi-tenant hierarchy Platform → Business → Location → Department → User | Business → (branch/staff for POS) → user roles. **No department entity.** Every ERP query is keyed by `businessId`; tenant isolation is proven by a real-PostgreSQL test that crosses two tenants. |
| Server-enforced permissions | Yes — `requireErpAccess` / `resolveErpRole` resolve the role from the database on every action; navigation hides links but is never the enforcement point. |
| Role-aware UI | Yes (`lib/erp/navigation.ts`, per-page role gates). |
| Unified global search / command launcher | **Missing.** Each module has its own filters. |
| Notification centre / task inbox | **Missing** as a cross-module surface (`ErpNotification` exists per record). |
| Location/branch scoping in ERP | **Partial** — POS has `PosBranch`; the ERP itself is business-wide, not branch-scoped. |
| Brand identity | Original espresso / cream / amber, via `--jata-*` tokens only (`app/erp.css`). The withdrawn graphite/lime look is gone. |
| Runtime | Next.js 16.4.2, React 18.3.1, Prisma 5.22.0, Neon PostgreSQL, Vercel — unchanged. |

## 3. What "one dashboard" would require that does not exist yet

1. A **shell** (`app/dashboard/erp/[businessId]/layout.tsx` exists) with company switcher, global
   search over permitted records, notification centre, task inbox and quick-create — today the
   layout offers navigation and plan status only.
2. **Widgets bound to persisted queries.** Building them against invented numbers is the one thing
   the directive forbids, so each widget must land with the query and the test that proves it reads
   real rows.
3. **A task entity** — four separate directive modules (9, 15, 18, and the notification centre)
   all converge on "create a task", and `CREATE_TASK` is already an automation action with no
   table behind it. This is the single highest-leverage missing piece.

## 4. Honest sequencing

The dependency order that actually works here, given what is built:

1. **Task/notification spine** — one `ErpTask` + assignment + due dates + escalation, wired to the
   existing automation engine and the sidebar. Unblocks modules 9, 15, 18 and the dashboard inbox.
2. **Approval request object** — submit/approve/reject/delegate with immutable history, replacing
   the role-limit shortcut in module 7. Unblocks procurement (5) and high-impact automation.
3. **Procurement slice** — requisition → PO → goods received → supplier bill, reusing
   `PosSupplier`, `PosInventoryMovement` and the approval object. This is the MGAS bulk-order
   scenario's missing half.
4. **Document register** — reuse the existing media stack; adds expiry reminders on top of (1).
5. **Dashboard widgets + global search** — only after (1)–(4) give them real data.
6. **ERP AI assistant** — last, because it must read from a schema whose semantics are settled.

Each step is additive (new tables + new migration), reversible by dropping the new tables in
reverse dependency order, and separable into its own reviewable PR.

## 5. What was *not* done in this pass

This pass was scoped to the PR #71 remediation the owner asked for: retarget to `main`, resolve the
merge with `main`, restore the brand identity, and clear every release gate with evidence. That is
done and green on `e500664`.

**Nothing in section 1 beyond ERP Pro's existing core was implemented in this pass.** No module was
added, no placeholder screen was created, and no capability above is claimed as working. Building
the BOS modules is a multi-phase program on the sequence in section 4, and each phase needs its own
review and its own evidence.
