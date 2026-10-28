# POS / ERP - PRO — Business Operating System gap matrix

**Directive:** "Unified Business Operating System" (owner, 2026-10-28) — ~20 integrated modules.
**Head reviewed:** `e500664` for the original matrix; rows 7, 9, 10 and the notification/dashboard rows
were re-checked on `e282a48` on `arena/7a3563c1-jata-aftercall` (PR #71, base `main`).
**Report date:** 2026-10-28.

This document exists because the directive's scope is much wider than the software, and the gap
must be stated in the same units the directive uses. Each row was checked against the repository,
not against the roadmap. Labels: **PASS** (works and is proven), **PARTIAL** (a real subset works),
**FAIL** (present but broken), **NOT TESTED** (code exists, no proof), **MISSING** (not built).

The ERP Pro product is **additive** beside the existing Business POS: 42 new models
(`Erp*` / `Msg*`), four additive migrations (`20261027000000_pos_erp_pro`, `20261028000000_erp_tasks`,
`20261029000000_erp_notifications`, `20261030000000_erp_approvals`),
its own plan (`ERP_PRO`, KES 3,000/30 days). No existing POS model, order transition, payment path or
migration was modified.

## 1. What the directive asks for, versus what exists

| # | Module | Status | What actually exists | What is missing |
|---|---|---|---|---|
| 1 | POS and sales | **PARTIAL** | Pre-existing POS: `PosSale`, `PosSaleItem`, `PosPayment`, `PosInventoryMovement`, branches, staff, receipt sequences, idempotency records, refund path. ERP Pro adds storefront orders on top of the same catalogue. | Shift open/close and cash-drawer reconciliation as first-class objects; barcode-driven flow verified in a browser; offline queue for the ERP storefront. |
| 2 | CRM and customer lifecycle | **PARTIAL** | `PosCustomer`, `MsgContact`, consent + suppression + audience models, segmentation (`lib/messaging/segments.ts`), import with de-duplication (`lib/messaging/import.ts`), ERP `/customers` page. | Leads/pipeline/stages, quotes, opportunities, support cases, merge workflow, retention automation. |
| 3 | Products and inventory | **PARTIAL** | `PosProduct`, `PosInventoryItem`, `PosInventoryMovement` (signed delta + reason + unit, multi-branch), stock reads inside ERP, low-stock surfacing. | Warehouses as entities, batches/lots/expiry/serials, transfers UI, stocktake reconciliation, explicit costing method, valuation reports. |
| 4 | Orders and fulfilment | **PARTIAL** | `ErpStoreOrder` + items, a validated state machine (`orderTransitions`, 16 PG tests), public tracking page with a token, `PosOrderEvent` audit. | Picking/packing/dispatch, proof of delivery, partial fulfilment, delivery assignment/fleet, profitability reporting. |
| 5 | Procurement and suppliers | **MISSING** | `PosSupplier` exists (name, terms, credit, balance) and `PosPurchase`/`PosPurchaseItem`. | Requisitions, purchase orders with approval thresholds, goods-received notes, three-way matching, lead-time and price history, reorder proposals. |
| 6 | Accounting and finance | **PASS (core)** | Real double-entry: `ErpAccount`, `ErpPeriod`, `ErpJournal`, `ErpJournalLine`, immutable posted journals, controlled reversals, period close/reopen, trial balance, invoices + payments + allocations, credit notes, expenses, supplier bills, Kenya tax rules. Proven by the PG suite. | Bank feed import and reconciliation matching; P&L/cash-flow *reports* beyond trial balance (data is there, report surface is thin); no statutory filing. |
| 7 | Approvals and finance operations | **PARTIAL** | `ErpApprovalRequest` + append-only `ErpApprovalEvent`: submit, approve, reject (with a required reason), withdraw by the requester, comment in the decision note. Authority is re-derived on the server from the role, the amount and a per-tenant threshold, so a crafted POST is refused where a legitimate click is accepted; self-approval is refused in the domain; `APPROVE_SPEND` gates the action and the queue is scoped per viewer (finance roles see everything, everybody else sees what they raised or what names them). Requests raise deduplicated `APPROVAL_REQUESTED` / `APPROVAL_DECIDED` notifications and audit rows. Proven by 23 domain + 6 render + 10 real-PostgreSQL tests. Role limits (`ERP_APPROVAL_LIMITS_CENTS`) and immutable `ErpAuditEvent` were already in place. | Delegate and escalate (an unanswered request does not yet rise to a higher role); a settings field to store a tenant-wide threshold (the domain honours one, nothing stores it); wiring into expenses/journals so those actions *must* raise a request rather than only being able to. |
| 8 | Documents and records | **MISSING** | `ErpKycDocument` only (compliance evidence placeholder). The repo has a separate durable media stack for the POS/website. | Document register, versions, categories, expiry reminders, retention, access-controlled download, tenant-scoped storage paths for ERP records. |
| 9 | Tasks, projects, workflow | **PARTIAL** | `ErpTask`: title, detail, `OPEN → IN_PROGRESS → DONE|CANCELLED` (terminal states enforced), priority, named assignee restricted to members of the tenant, role-based assignment, due date, source (`MANUAL`/`AUTOMATION`), idempotency key unique per tenant. `/tasks` board: overdue → open → recently finished, KPIs, create form, start/done/cancel controls gated by `MANAGE_TASKS`, cancel requires a reason. Server-side enforcement in the server actions; audit rows `TASK_CREATED` and `TASK_STATUS_CHANGED`. The automation engine's `CREATE_TASK` action now persists a real task instead of only previewing one. Proven by 22 domain tests, 9 render tests and 13 real-PostgreSQL tests. | Projects, checklist items, dependencies, recurrence, escalation/reminders, calendar view, per-project reporting, task inbox aggregation across modules. |
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

**Count (re-counted against the table, not carried over):** 1 PASS-core (accounting), 1 PASS-engine
with a missing inbox (messaging), **12 PARTIAL**, **6 MISSING**.
No module in the directive is falsely marked complete, and no module in this table is represented
in the UI as a working feature when the row above says otherwise.

## 2. Architecture facts the directive assumes

| Assumption | Reality on this head |
| --- | --- |
| Multi-tenant hierarchy Platform → Business → Location → Department → User | Business → (branch/staff for POS) → user roles. **No department entity.** Every ERP query is keyed by `businessId`; tenant isolation is proven by a real-PostgreSQL test that crosses two tenants. |
| Server-enforced permissions | Yes — `requireErpAccess` / `resolveErpRole` resolve the role from the database on every action; navigation hides links but is never the enforcement point. |
| Role-aware UI | Yes (`lib/erp/navigation.ts`, per-page role gates). |
| Unified global search / command launcher | **Missing.** Each module has its own filters. |
| Notification centre / task inbox | **Partial** — the notification centre is live (`/notifications`, per-person read state, unread bell in the shell, dashboard widgets for own work, overdue counts, unread notices and pending approvals), and approvals now raise `APPROVAL_REQUESTED` / `APPROVAL_DECIDED` notices. What is missing: one combined inbox that interleaves tasks and notices, and escalation notices for requests nobody answers. |
| Location/branch scoping in ERP | **Partial** — POS has `PosBranch`; the ERP itself is business-wide, not branch-scoped. |
| Brand identity | Original espresso / cream / amber, via `--jata-*` tokens only (`app/erp.css`). The withdrawn graphite/lime look is gone. |
| Runtime | Next.js 16.4.2, React 18.3.1, Prisma 5.22.0, Neon PostgreSQL, Vercel — unchanged. |

## 3. What "one dashboard" would require that does not exist yet

1. A **shell** (`app/dashboard/erp/[businessId]/layout.tsx` exists) with company switcher, global
   search over permitted records, notification centre, task inbox and quick-create — the notification
   bell and unread count are now in the shell, and the board and inbox exist. Still missing: global
   search, quick-create, and a workspace (company) switcher inside the sidebar.
2. **Widgets bound to persisted queries.** Building them against invented numbers is the one thing
   the directive forbids, so each widget must land with the query and the test that proves it reads
   real rows.
3. **A task entity** — four separate directive modules (9, 15, 18, and the notification centre) all
   converge on "create a task". The entity now exists (`ErpTask`), the automation action writes real
   rows, and the board is live. Still missing for the dashboard: an aggregated inbox widget, overdue
   *notifications* (the engine can raise a task, not yet a notification), and escalation.

## 4. Honest sequencing

The dependency order that actually works here, given what is built:

1. **Task/notification spine** — *done in part (2026-10-28)*: `ErpTask` + assignment + due dates are
   wired to the automation engine and the sidebar, with tests. Remaining: escalation, reminders, and
   the notification surface that the dashboard inbox needs.
2. **Approval request object** — *done in part (2026-10-30)*: submit/approve/reject/withdraw with an
   append-only history and server-side authority. Remaining: delegate and escalate. Unblocks
   procurement (5) and high-impact automation.
3. **Procurement slice** — requisition → PO → goods received → supplier bill, reusing
   `PosSupplier`, `PosInventoryMovement` and the approval object (now built). This is the MGAS
   bulk-order scenario's missing half.
4. **Document register** — reuse the existing media stack; adds expiry reminders on top of (1).
5. **Dashboard widgets + global search** — only after (1)–(4) give them real data.
6. **ERP AI assistant** — last, because it must read from a schema whose semantics are settled.

Each step is additive (new tables + new migration), reversible by dropping the new tables in
reverse dependency order, and separable into its own reviewable PR.

## 5. What was *not* done in this pass

The earlier remediation pass (head `e500664`) was scoped to retargeting PR #71 to `main`, clearing
the merge with `main`, restoring the brand identity and re-running every gate. That pass added no
module.

**Two passes implement section 4 step 1.** `00cdd71` added the task spine: `ErpTask`, one additive
migration, `lib/erp/tasks.ts`, the `/tasks` board, two server actions, a navigation entry and the
automation `CREATE_TASK` action rewritten to persist (22 domain + 9 render + 13 PostgreSQL tests).
`c57a3a3` added the notification foundation: `ErpNotificationRead` and ten defaulted columns on
`ErpNotification`, `lib/erp/notifications.ts`, the `/notifications` centre, the shell unread bell, the
dashboard "What needs you today" widgets, task-assignment and daily-overdue notices, and paginated
finished work on the board (23 domain + 8 render + 10 PostgreSQL tests).
`e282a48` added approvals: `ErpApprovalRequest` + `ErpApprovalEvent`, the `APPROVE_SPEND`
permission, `lib/erp/approvals.ts`, the `/approvals` screen, request/decision notifications and the
dashboard's pending-approval figure (23 domain + 6 render + 10 PostgreSQL tests).

**Nothing else in section 1 moved.** Modules 5, 8, 11, 12, 13 and 17 are still MISSING; no
placeholder screen was created for any of them, and no capability above is claimed as working
beyond what its row states.
