# AI Front Desk follow-up: product definition and persistence design

**Status:** product scope approved and initial implementation delivered on the PR branch; final verification is tied to the exact current head reported in PR checks. Approval is for internal human-handoff tasks only. It does not authorize deployment, merge, paid infrastructure, customer communications, or external workflow activation.

## 1. Follow-up models compared

| Dimension | A. Human-handoff task | B. Scheduled customer communication |
|---|---|---|
| Meaning | A durable operational work item for the business/operator to review and respond through their normal, separately authorized process. | A future customer-facing message or call, initiated only under explicit permission and channel policy. |
| Complexity | Moderate: durable task record, assignment, lifecycle, authorized UI/API, audit, transaction-coupled outbox and idempotency. Existing `ErpTask` is a plausible shared foundation. | High: task/scheduling needs plus consent provenance, channel eligibility, opt-out/suppression, templates/content controls, delivery provider, retries, cancellation races, time zones, delivery receipts, and cost controls. |
| Privacy exposure | Lower if a task stores a short purpose and opaque source reference, without copying conversation text/contact data. | Higher: customer contact data and message content pass to scheduler/provider; consent and delivery evidence are sensitive. |
| Operational risk | Missed/late task, duplicate work, wrong assignment, or unauthorized access; no automatic customer contact. | Unwanted/duplicate contact, wrong recipient/channel/time, consent/opt-out violation, provider failure, unexpected cost, or cancellation race. |
| Customer value | Gives the business an accountable prompt to review a request for human attention; value depends on staff work-queue use. | Enables timely updates/reminders only when customer authorization exists. |
| Prerequisites | Approved qualifying handoff, task ownership/visibility, assignment authority, due-date defaults, lifecycle, retention, and a durable source reference. | All task decisions plus approved consent basis, channel permissions, opt-out, timing, content, provider, retries, cancellation, and cost policies. |

The models are distinct. Creating a task does not authorize a message; scheduling a message is not merely a task status.

## 2. Approved first release: internal human-handoff task

The user approved internal human-handoff tasks with these conditions: create durable tasks when human intervention is required; scope by tenant; allow owner and authorized staff access; deduplicate active tasks from the same enquiry/conversation; support assignment, priority, optional due dates and lifecycle; expose the task interface within AI Front Desk; atomically persist task and minimal outbox event; allow an authorized operator to pause event processing without deleting tasks; preserve JATA authorization, financial, subscription and tenant authority; require PostgreSQL acceptance and exact-head CI before calling implementation complete.

Further scope confirmations: the trigger is the explicit `request_human` operation only; event pause is per business. Ordinary responses, low-confidence answers, and response failures alone do not create tasks. No customer communications, paid provider activation or external workflow activation are approved. Production deployment and PR merge are not authorized.

Implementation behavior:

- **Creator/trigger:** the server-side `request_human` tool creates the task outside preview. A missing conversation ID fails closed. The AI does not choose tenant or owner identity.
- **Owner/access:** `ErpTask.businessId` scopes the task. The AI Front Desk dashboard exposes its task queue and links to the existing ERP task board, whose tenant access checks govern task operations. The pause endpoint requires `canAccessBusiness` and an `operate` role capability.
- **Due/priority:** default priority is existing `NORMAL`; due date is optional, with no invented SLA. Existing task board supports assignment and lifecycle.
- **Completion/cancellation:** existing task transition rules apply. `DONE` and `CANCELLED` are terminal; cancellation requires a reason. Completion/cancellation clears the active dedupe key so a later explicit handoff can create a new task.
- **Duplicates:** unique `(businessId, aiHandoffActiveKey)` where the active key is deterministic from business and conversation. Concurrent repeats converge on the active row; terminal tasks free the key. The persisted task ID yields a stable event ID.
- **Failure:** task and event are one transaction. If event validation/write fails, task creation rolls back and the operation cannot claim success. Response generation by itself has no persistence effect. Existing lead capture remains separate and non-authoritative.
- **Owner control:** task list in AI Front Desk; existing ERP board owns assignment, priority, due date and lifecycle. Per-business event processing defaults paused. The pause endpoint sets it false and retains task/outbox rows. No UI or route enables event processing in this release.

## 3. Persistence model

Existing model review:

- `ErpTask` already has `businessId`/Business relation, status, priority, `assignedTo`, `assignedRole`, creator/completer, due/completion timestamps, source type/ID, idempotency, uniqueness and business-scoped indexes. The implementation adds `aiHandoffActiveKey` with unique `(businessId, aiHandoffActiveKey)`, nullable so normal tasks are unaffected and terminal AI handoffs can release the active key.
- `AIConfiguration` now has `followupEventsEnabled`, default `false`, for a tenant-scoped fail-closed processing pause.
- `AutomationEvent` is the existing outbox with unique event ID, tenant, product/type, lifecycle and payload. `AIQualityEvent`, process-local conversations, lead capture and notifications remain non-authoritative.
- `CustomerEnquiry` contains customer message/contact data; the new task/event do not copy it. The conversation reference is an opaque `ErpTask.sourceId`, not content or contact information.

The migration is additive: `20261201000000_ai_front_desk_handoff_tasks`. The task uses source type `AI_FRONT_DESK_HANDOFF`, purpose encoded by that fixed source type/title, and `sourceId` for the conversation. Creation is recorded through existing `ErpAuditEvent` conventions; task lifecycle updates use existing task audit behavior. No new customer data is copied into the outbox.

## 4. Transaction and outbox boundary

Implemented in `lib/ai-followup.ts:createAIFrontDeskHandoffTask`, invoked by `lib/ai-tools.ts` only for `request_human` outside preview:

1. A Prisma transaction confirms the business exists and derives tenant ID from that database row.
2. It finds an active task by tenant plus deterministic conversation key; existing active task returns idempotently.
3. It creates the `ErpTask` with fixed purpose, opaque source, owner-role queue, `NORMAL` priority and no due date.
4. It inserts `ai_front_desk.followup_task.created` using `enqueueAutomationEvent(tx, ...)` in the same transaction. Event ID is derived from persisted task ID; tenant from task; payload contains only business ID, task ID and purpose.
5. Any event validation/insert error aborts the transaction. Database uniqueness arbitrates concurrent same-conversation creation; a retry returns the committed active task.

The `AutomationEvent` worker does not claim this event while the tenant config is absent or disabled. The database default is disabled and no enable endpoint is provided. No external workflow was activated. This is routing metadata only and grants no authority to message a customer.

## 5. Authorization and privacy

- Tenant filters and `Business` FK establish ownership. All task routes must retain existing tenant-scoped ERP task checks; AI dashboard resolves the business only after `canAccessBusiness`.
- Authorized staff use existing business role permissions; assignment itself does not grant access. Pause requires the existing `operate` capability. Cross-tenant source IDs do not cross tenant task lookup.
- Task writes occur only from the explicit server-side handoff operation; AI-supplied tenant/assignee values are not accepted. Task event has no message text, phone, email, credentials, payment data, or sensitive AI context.
- Existing terminal transition and audit conventions are reused. Retention/deletion follows existing ERP task/business policies; changes to those policies require separate approval.
- Kill switch is per business and fail-closed: absent/false means no event processing; pausing preserves task and pending event. Database/outbox failure creates no claimed task. Re-enabling is not exposed or authorized in this release.
- Model B remains out of scope. Any future customer communication requires separate explicit consent basis/evidence, opt-out/suppression, channel, content, timing, cancellation, provider, retry, delivery, cost, retention and kill-switch decisions and approval.

## 6. PostgreSQL acceptance plan and current evidence

Required real PostgreSQL tests cover: atomic task/event commit; rollback on outbox validation failure; tenant-derived event and isolation; sequential and concurrent active dedupe; idempotent retries; release of dedupe key after terminal state; minimal event payload; outbox lifecycle; migration from existing data; and unchanged existing journeys/authorization.

A new PostgreSQL test file, `tests/prisma/ai-front-desk-followup-postgres.test.ts`, covers atomic commit/payload minimization, concurrent and sequential dedupe, tenant isolation, invalid-event rollback, and terminal-key release. Existing full database CI also runs migrations, schema checks, typecheck/build, security and journeys. These tests do not authorize production deployment or external activation.

## 7. Owner approval and remaining policy boundary

The approval dated 2026-11-15 resolves the first-release model, explicit `request_human` trigger, per-business pause, and the prohibitions listed above. No additional policy is inferred. Model B is not approved. If future work needs broader AI heuristics, different staff roles, changed retention, re-opening terminal tasks, or external event consumers, obtain further owner approval first.

## 8. Implementation sequence and remaining risks

Initial implementation now exists on PR #116. Remaining acceptance work is to confirm the exact current-head PostgreSQL test/CI statuses and resolve any failing checks. The broader programme-completeness gate remains independent and must not be modified or represented as passed. Before any later external event processing, inspect and authorize each consumer separately. Risks include operator understanding of conversation-linked source data, task-board permission compatibility, and ensuring no future consumer interprets the routing event as consent to contact the customer.
