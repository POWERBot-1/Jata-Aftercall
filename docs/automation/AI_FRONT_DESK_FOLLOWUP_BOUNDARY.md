# AI Front Desk follow-up boundary assessment

**Initial assessment:** 2026-11-15 at `4c4f9a80dd054dcc7707973e7a97f2e15dc87edc`
**Product design:** [AI Front Desk follow-up product definition and persistence design](AI_FRONT_DESK_FOLLOWUP_PRODUCT_DESIGN.md)
**Current implementation head when last verified:** `140c222fd43c6f3805f9a91f38fdc563930c9a91`

## Current status

The initial inspection correctly found no persisted follow-up transaction in the original AI Front Desk flows. Product approval was subsequently given for **internal human-handoff tasks only**, with the explicit `request_human` operation as the trigger and per-business event-processing pause control. The implementation adds an authoritative `ErpTask` row and inserts its minimal `ai_front_desk.followup_task.created` event using `enqueueAutomationEvent` within the same Prisma transaction. Active deduplication is tenant-plus-conversation scoped; terminal tasks release the active key. AI-generated answers, telemetry, lead capture, and owner notifications are not substitutes for this transaction.

**No customer message, call, SMS, marketing communication, provider activation, or external workflow activation is authorized.** Event processing is disabled by default and pending rows are retained. The authorized pause endpoint does not delete tasks or outbox rows. The design and approval do not authorize production deployment, merge, or paid infrastructure.

## Historical boundary findings retained

- Conversation context in `lib/ai-conversation.ts` is process-local; response generation and `AIQualityEvent` telemetry are not durable follow-up records.
- `captureLead` in `lib/leads.ts` remains a separate process-local/best-effort path. Existing lead and notification behavior is not the authoritative source for the new task.
- `Notification` is not a scheduled customer follow-up. Autopilot consented-follow-up proposals are a separate workflow and are not reused.
- Existing Business Page `enquiry.created` and `business.created` producers remain unchanged.

## Verification gate

At `140c222fd43c6f3805f9a91f38fdc563930c9a91`, the PostgreSQL-backed journey, migration/schema, typecheck/build, failure-path, and full-suite checks passed (run IDs and labels recorded in the PR CI). The programme-completeness gate still fails on its existing outstanding records and must not be changed or represented as passed. Production smoke was skipped. The handoff implementation is not authorized for deployment or external event processing by this approval.
