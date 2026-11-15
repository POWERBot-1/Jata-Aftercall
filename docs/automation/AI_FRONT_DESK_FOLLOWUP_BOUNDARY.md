# AI Front Desk follow-up producer: boundary assessment

**Assessment date:** 2026-11-15  
**Branch:** `arena/d1e54a52-jata-aftercall`  
**Inspected starting head:** `4c4f9a80dd054dcc7707973e7a97f2e15dc87edc`

## Decision

**BLOCKED — no safe authoritative AI Front Desk follow-up transaction boundary exists in the current implementation. No producer was added.** Do not treat an AI-generated answer, an in-memory conversation mutation, AI quality telemetry, lead capture, or an owner notification as a persisted follow-up schedule.

This is a deliberate fail-closed decision, not an approval to alter the AI Front Desk's storage model or communication behavior.

## Inspected flows and evidence

1. **Conversation and turn state — `lib/ai-conversation.ts`, `lib/ai-front-desk.ts`.** `getOrCreateConversationContext` and `updateConversationContext` store contexts in process-local `Map`s keyed by business/conversation. `finalizeTurn` updates that in-memory context and returns the generated reply. This is neither durable storage nor a Prisma transaction. Concurrent requests, process restart, or cache loss are not covered by a database commit boundary.
2. **Generated reply — `app/api/ai/chat/route.ts`, `lib/ai-channels.ts`.** The route passes the normalized event to `processNormalizedChannelEvent`; that runs `handleAIFrontDeskTurn` and returns reply text. There is no persisted follow-up/schedule record in this call path and no customer message send here. An assistant reply is not evidence that a follow-up was scheduled.
3. **Quality telemetry — `AIQualityEvent` in `prisma/schema.prisma`, `lib/intelligence.ts:recordAIQualityEvent`, `lib/ai-front-desk.ts:finalizeTurn`.** `finalizeTurn` records `TURN_*` telemetry after generating the response. `recordAIQualityEvent` catches database errors and returns a synthetic fallback object. This is intentionally best-effort analytics, not authoritative follow-up state; it cannot anchor an atomic producer.
4. **Lead and handoff capture — `lib/leads.ts`, `app/api/ai/leads/route.ts`, `lib/ai-tools.ts` (`create_lead`, `request_human`).** `captureLead` currently stores lead records and idempotency keys in process-local maps. `AIQualityEvent` insertion is optional/best-effort and uses metadata containing the lead record. Handoff may create a separate notification. The API authenticates and checks `canAccessBusiness` for signed-in callers; anonymous callers are limited to a currently published business. Those checks establish route access but do not make the in-memory lead a persistent transaction boundary.
5. **Notifications — `lib/notification.ts`, `Notification` model.** `createNotification` writes an owner-directed `Notification` outside a caller-supplied transaction, catches persistence errors, and falls back to an in-memory notification. This is not an authoritative scheduled customer follow-up record and may represent human escalation. Making its insert fail-closed or folding it into unrelated transactions could change existing notification behavior and is out of scope.
6. **Autopilot follow-up proposals — `AutopilotActionProposal` and `QUEUE_CONSENTED_FOLLOWUP`.** This is an Autopilot action proposal/consent/approval pathway, not an AI Front Desk follow-up transaction. Reusing it would conflate product semantics and could change approval or messaging policy.

## Missing prerequisite before producer implementation

The product needs an explicitly approved definition of an AI Front Desk “follow-up”: which persisted business action qualifies (for example, human-handoff task creation versus a scheduled customer communication), which actor/surface owns it, whether it may ever contact the customer, and what consent/authorization evidence is mandatory. Then an authoritative durable record must be created at that action boundary with:

- a Business foreign key and tenant identity derived from the persisted relation;
- a stable idempotency key and a unique constraint;
- explicit lifecycle/status and due-time semantics if it is scheduled;
- consent/purpose and permission evidence when customer communication is contemplated;
- an atomic insert in the same Prisma transaction as the originating follow-up action;
- a narrowly scoped event payload with no message body, phone, credentials, payment data, or secrets.

If the approved semantics are only “human follow-up requested,” the durable task/lead record should be the authoritative transaction and no customer message should be sent. If scheduled customer communication is intended, a separate explicit consent and delivery policy is a prerequisite; this assessment does not authorize sending or scheduling any message.

## No code / policy side effects

No Prisma schema, event producer, AI behavior, permission, consent policy, notification, payment, or workflow was changed. Existing `business.created` and `enquiry.created` producers remain untouched. `PROGRAMME_READINESS.json` and its checker were not modified. No workflow was activated and no external message was sent.
