# AI Front Desk follow-up: product definition and persistence design

**Status:** design approved for internal human-handoff implementation only, subject to the conditions in the user approval recorded 2026-11-15. Approval does not authorize deployment, merge, paid infrastructure, or customer/external communications.
**Design head:** `326d5191a9f52d32b66fbb41ce64ab8ba5bfe2f3`  
**PR:** #116 (open)

## 1. Follow-up models compared

| Dimension | A. Human-handoff task | B. Scheduled customer communication |
|---|---|---|
| Meaning | A durable item of operational work for the business/operator to review and respond through their normal, separately authorized process. | A future customer-facing message or call, initiated only under explicit permission and channel policy. |
| Complexity | Moderate: durable task record, assignment, lifecycle, authorized UI/API, audit, idempotency, and transactional outbox. Existing `ErpTask` provides a plausible task foundation but its current contract needs review/extension. | High: all task/scheduling needs plus consent provenance, channel-specific eligibility, opt-out/suppression, templates/content controls, delivery provider, retries, cancellation races, time zones, delivery receipts, and cost controls. |
| Privacy exposure | Lower if task stores a short purpose and opaque source reference, and avoids copying conversation text/contact data. Operators may still access the referenced enquiry under existing policy. | Higher: customer contact data and message content must be used by a scheduler/provider and operationally protected; consent and delivery evidence become sensitive records. |
| Operational risk | Missed/late task, duplicate work, wrong assignment, or unauthorized task access. No automatic customer contact is implied. | Unwanted or duplicate contact, wrong recipient/channel/time, consent/opt-out violation, provider failure, unexpected cost, or stale/cancelled message race. |
| Customer value | Enables the business to notice and own a request for human attention; value depends on the business actually reviewing its work queue. | Can provide proactive, timely updates or reminders, but only if customer has authorized the specific communication. |
| Prerequisites | Product definition of qualifying handoff, task ownership/visibility, assignment authority, due-date defaults, lifecycle, retention, and how anonymous/public enquiries are referenced. | All task decisions if represented as work, plus explicit legal/product consent basis, channel permissions, opt-out, timing, content, provider, retry, cancellation and cost policies. |

These models are distinct. Creating a task does not authorize a message; scheduling a message is not merely a task status.

## 2. Recommended first release: human-handoff task, conditionally

**Recommendation:** prefer model A as the smallest useful first release, subject to explicit owner approval of the decisions listed below. It creates accountable business work without assuming permission to contact a customer. This is a recommendation, not evidence of owner approval.

Proposed behavior, subject to product decisions:

- **Creator:** a successful, explicitly defined AI Front Desk handoff action creates the task. A generated answer alone never creates one. The system should not infer handoff solely from response generation or uncertain classification. The qualifying user/tool action must be defined and validated server-side.
- **Owner/access:** the task belongs to the `Business` tenant. Business owners and only operators with an explicitly authorized business role can list/read/update it. Assignment is to a tenant member/operator selected by an authorized actor; never accept an arbitrary tenant or assignee from an untrusted AI/customer payload.
- **Due:** `dueAt` is nullable until the owner approves a default/SLA. Creation time is server time. Do not fabricate a deadline from AI output.
- **Complete/cancel/reassign:** authorized operators use validated state transitions; record actor and timestamp for completion/cancellation and assignment changes. Cancellation should be an explicit authorized action, not deletion. Reopening a completed/cancelled task needs a product-approved transition rule.
- **Duplicates:** unique `(businessId, idempotencyKey)` on a deterministic key derived from the persisted source action identity. Concurrent retries converge on the existing task; conflicting payloads must not overwrite it silently. Key scope and whether a second distinct handoff in one conversation is allowed require product definition.
- **AI response failure:** no task merely because generation began or failed. If the handoff action/task transaction itself fails, return a fail-closed error/appropriate existing fallback and do not claim that follow-up was queued. Do not add a best-effort event. Response delivery failure after a committed task does not undo the task; show the persisted task state to authorized staff.
- **Owner controls:** an owner-facing queue should show task purpose/source, status, assignee, priority, and due time; permit authorized assignment/status/due changes and cancellation. It should not imply that a customer was contacted. Whether and where a task UI belongs is an approval prerequisite.

## 3. Existing persistence review and proposed model

Relevant existing Prisma records:

- `ErpTask` (`prisma/schema.prisma` around line 3719) already has `businessId`/Business relation, status, priority, `assignedTo`, `assignedRole`, creator/completer IDs, due/completion timestamps, source type/ID, idempotency key, unique `(businessId, idempotencyKey)`, and business-scoped indexes. Its status is currently documented `OPEN | IN_PROGRESS | DONE | CANCELLED`.
- `CustomerEnquiry` (around line 4299) is durable and tenant scoped but stores direct contact and message data and models customer enquiry states, not operator assignment, task completion metadata, or a generic AI handoff action. Do not duplicate its message/contact fields into a task.
- `AutomationEvent` (around line 861) is the existing outbox/inbox record with unique `eventId`, tenant, product/type, direction, lifecycle, payload and retry fields. `enqueueAutomationEvent(tx, event)` validates then inserts through a caller's Prisma transaction.
- `AIQualityEvent` is analytics, not authoritative task state. Conversation context remains process-local. Neither is suitable as the task record.

**Proposal:** first determine whether `ErpTask` can safely serve as the authoritative record, rather than creating a parallel table. It is the closest existing model. A minimal additive extension may be needed to distinguish the purpose (`AI_FRONT_DESK_HANDOFF`), preserve cancellation actor/time and audit assignment/status changes. Existing generic fields (`sourceType`, `sourceId`, `idempotencyKey`) could potentially carry the source and dedupe key, but only after verifying all existing callers, constraints, access APIs, and migration compatibility. No fields/table are prescribed as approved.

Proposed logical record contract (not schema code):

- `id`; `businessId` FK to `Business` (source of tenant identity).
- `sourceType` fixed to approved AI Front Desk handoff source; `sourceId` opaque durable enquiry/action ID. Do not use an in-memory conversation ID as the sole source reference.
- `purpose` fixed enum/value such as `HUMAN_HANDOFF`; never a generic ambiguous “follow-up”.
- `status`: `OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED` (candidate lifecycle; confirm compatibility with existing `ErpTask` states). Terminal transition/reopen rules require approval.
- `priority`, nullable `assignedTo` (tenant operator ID), optional role assignment only if existing authorization supports it.
- Server `createdAt`, nullable `dueAt`; `completedAt` and `completedBy`; proposed `cancelledAt` and `cancelledBy` or an append-only transition audit record.
- Stable `idempotencyKey`, unique within business; deterministic from the durable originating handoff action ID plus event purpose/version. Do not include message text, customer identifiers, or AI-generated data in the key.
- Minimal audit: task ID, business ID, actor ID/type, action, previous/new status or assignee (where required), timestamp, and reason code. Avoid copying customer text into audit. Existing audit facilities and retention must be checked before deciding whether to add a dedicated history table.

Keep the full conversation, customer contact values, message body, credentials, payment details, and sensitive AI context out of task and outbox payload. Link to an authorized durable enquiry by opaque ID only if that enquiry exists and access rules permit it.

## 4. Exact future transaction and outbox boundary

There is **no such AI Front Desk transaction in current code**. If model A is approved and the persistence changes are implemented, the intended boundary is a single `prisma.$transaction(async tx => ...)` in a dedicated server-side handoff/task service, invoked only after the qualifying handoff action and authorization have been validated:

1. Resolve/confirm the `Business` and durable source enquiry/action using `tx`; derive `businessId` from those persisted rows, not from AI-generated or event input.
2. Validate that the source belongs to that business, is eligible for the approved handoff, and the actor/action is authorized. Validate assignee membership in the same tenant if assigned.
3. Derive deterministic task idempotency key; create or return the existing task using the approved duplicate semantics and database uniqueness. Concurrent create races must safely resolve to the one committed task.
4. For a newly created task, derive the event ID deterministically from persisted task identity (and event type/version), e.g. SHA-256 of `ai_front_desk.followup_task.created:v1:<taskId>` encoded with a validator-compatible prefix. Do not use caller-supplied tenant identity.
5. Call existing `enqueueAutomationEvent(tx, ...)` with `type: "ai_front_desk.followup_task.created"`, `source: "ai_front_desk"`, `tenantId: task.businessId`, persisted task creation time and minimal routing data such as `{ businessId: task.businessId, taskId: task.id, purpose: "HUMAN_HANDOFF" }`. Confirm this exact type/product is allowed by downstream schemas/worker policy before release.
6. Return only after commit. Outbox validation or insert error must throw and roll back task creation. Do not catch and swallow it or call standalone `publishAutomationEvent`.

For idempotent retries, decide whether an already-existing task with a missing outbox event is impossible by atomicity (expected) or requires a repair/reconciliation path. Unique event identity plus task unique key prevent duplicate logical creation; database constraints handle races. Event processing remains at-least-once and downstream consumers must deduplicate by event ID. This event is a routing notice, not authority to message the customer.

The current public enquiry transaction in `lib/business-hub/enquiries.ts:createEnquiry` demonstrates the repository pattern: persisted business/source, domain row and `enqueueAutomationEvent(tx, ...)` in one transaction. It is an example of mechanics, not proof that AI Front Desk has an eligible persisted source or approved semantics.

## 5. Authorization, privacy, safety

- Derive tenant from persisted task/source and require `businessId` in every read/update predicate; never trust a client-provided tenant alone.
- Business owners may access only their business tasks. Operator access requires an existing, verified role/membership permission scoped to that business; assignment alone should not silently grant general business access. Confirm capability names and route guard behavior before implementing.
- Create permission: server-authorized qualifying handoff path only. Assignment, reassignment, due/priority edits, completion, cancellation, and reopening each require explicit role checks and audited actor attribution.
- Enforce source/task tenant equality in the transaction. Return non-enumerating not-found/denied behavior on cross-tenant IDs. Validate assignment against active tenant membership; ignore/reject AI-provided operator identity.
- Audit state-changing actions with minimal metadata; prevent customer text/phone/email and secret-bearing context from entering event/audit records. Apply established business data retention/deletion requirements to task and audit records; retention duration and deletion/cascade behavior need owner/privacy approval.
- **Kill switch:** a server-side feature flag should stop new AI-created tasks and event enqueueing together, without hiding or deleting already committed tasks. Existing human task management should remain usable if approved. On transaction/outbox/DB failure, fail closed: no claimed task, no standalone event, no customer communication; retain enough sanitized server diagnostics for operations.
- No new customer message or call, no contact data in outbox, no consent inference, and no notification side effect is in this model.

If model B is ever selected, it additionally requires documented consent basis and evidence per purpose/channel, channel-specific opt-in and opt-out/suppression enforcement, quiet hours/time zone and scheduling semantics, content/template approval, cancellation/dispatch race handling, provider credentials and data controls, retry/idempotency/delivery status, cost limits, retention, complaint/escalation behavior, and an explicit no-send kill switch. Those are prerequisites, not this proposal's scope.

## 6. PostgreSQL acceptance-test plan

After policy approval and implementation, add PostgreSQL-backed acceptance tests (not mock-only) for:

1. Task and one minimal outbox event commit together with tenant derived from persisted task/source.
2. Invalid event rejected by `enqueueAutomationEvent` rolls back task; injected outbox insert/constraint failure also rolls back task.
3. Invalid/missing/cross-tenant business or source and cross-tenant assignee are rejected with no rows/events.
4. Same idempotency key sequentially and concurrently creates one task and one event; distinct approved source actions follow the chosen duplicate policy.
5. Retried transaction after commit returns stable task; event ID remains deterministic; downstream duplicate delivery does not create another task/action.
6. Lifecycle transition matrix, completion/cancellation actor/time, reassignment and due-date authorization; unauthorized and cross-tenant status writes leave state/audit unchanged.
7. Owner and permitted operator can access correct tenant task; unrelated tenant, unassigned/unauthorized operator, anonymous/public caller are denied per approved policy.
8. AI answer generation without explicit handoff creates neither task nor follow-up event; failed response before qualifying action likewise creates none. Existing AI routes/journeys and enquiry capture retain behavior.
9. Outbox lifecycle retries/failure/lease and kill-switch behavior, with no customer delivery side effect and no PII in payload.
10. Migration from production-shaped PostgreSQL data, schema drift check, rollback/failure-path verification, and all existing Business Page enquiry producer tests unchanged and passing.

Tests require disposable PostgreSQL and exact-head CI. Until implementation, these are plans, not completed acceptance evidence.

## 7. Approval record and remaining owner/product decisions

On 2026-11-15, the user explicitly approved implementation of the internal human-handoff task system subject to these constraints: AI may create durable tasks when human intervention is required; tenant isolation and owner/authorized-staff access; active duplicate prevention for the same enquiry or conversation; assignment, priority, optional due dates and lifecycle; interface within AI Front Desk; atomic task/outbox transaction; authorized operator can disable event processing without deleting tasks; existing permissions/financial/subscription/tenant authority unchanged; no customer communications or paid/external workflow activation; PostgreSQL acceptance and exact-head CI before completion. Approval does **not** authorize production deployment, PR merge or paid infrastructure.

The following are explicitly out of scope and not approved: customer messaging/calling/SMS/marketing, provider activation, external workflow activation, changes to consent/billing/subscription/permissions, and production actions.

Engineering must encode safe defaults without asserting further policy approval:

1. The implementation trigger should be the explicit `request_human` operation, not generated answers, low-confidence inference, or response failure. If any broader condition is desired, obtain approval first.
2. Deduplicate while active for the same tenant plus durable enquiry or conversation source. Repeated calls return the existing active task; terminal task behavior and whether a later explicit handoff may create a new task should be implemented consistently with “active duplicate” scope and tested.
3. Reuse existing verified owner/staff authorization capabilities; assignment is not an independent grant of business access. Do not widen roles. Any capability gap must stop that surface rather than weaken authorization.
4. Use existing priority values with `NORMAL` as a technical default unless the owner selects another; due date remains optional and has no invented SLA.
5. Keep the task interface within AI Front Desk; link only to a source the viewer is already authorized to access and do not display copied conversation/contact data by default.
6. Preserve existing terminal-state rules unless a needed cancellation/reassignment behavior is not supported; do not add reopen semantics without approval.
7. Event-processing disable control must be exposed only to an already authorized operator, disable processing rather than task creation/history, and preserve pending events/tasks. Implementation must verify whether existing worker controls can provide a tenant-scoped switch without changing global automation policy.
8. Event type and routing contract must be constrained to the approved internal task-routing purpose. No downstream consumer may send customer communications or activate external workflows under this approval.

If existing authorization, worker controls, task data model, or UI cannot meet these requirements without policy changes, stop and report the specific gap for owner decision. Model B still requires separate approval and its consent, opt-out, channel, content, timing, cancellation, provider, cost, retention and failure policies; it remains unapproved.

## 8. Implementation sequence and remaining risks

1. Obtain explicit decisions above; document them without changing current behavior.
2. Inspect every `ErpTask` creator/reader/updater, tenant role guard, audit mechanism, deletion behavior, task UI, automation worker validation and consumer permissions. Confirm migrations can safely extend/reuse the model.
3. Finalize schema and event contract; threat-model tenant/assignment/source references; establish retention and kill switch.
4. Implement transaction service with deterministic idempotency and fail-closed outbox insertion; add authorized APIs/UI without broadening unrelated `ErpTask` permissions.
5. Add the PostgreSQL acceptance coverage above plus focused unit/security tests; run lint/typecheck, full suite, migration/schema checks, production build and exact-head CI. Inspect all downstream event consumers before enabling any workflow.
6. Keep producer disabled until acceptance and owner-approved staged testing. No merge/deploy/activation is authorized by this document.

Remaining risks include ambiguity in what constitutes a handoff, whether a durable source enquiry exists for every qualifying route, shared `ErpTask` permission/migration compatibility, operator membership semantics, source-record retention, downstream outbox consumers, and duplicated work from retries or separate handoff actions. This design resolves the engineering *shape* of a safe boundary, but not the product/owner approval needed to implement it.
