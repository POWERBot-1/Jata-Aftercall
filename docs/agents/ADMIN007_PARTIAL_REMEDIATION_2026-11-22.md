# ADMIN-007 partial remediation — 2026-11-22

## Scope and exact safety boundary

This candidate implements only non-mutating configuration parsing and source-labelled operational observations. It does not create an operator grant, enable a flag, call a provider, change a tenant configuration, or activate a service.

The owner-approved `CONTROL_ROLE_ACCESS_ENABLED=false` and all 90 DENY cells remain unchanged. All health and configuration reads remain behind the existing server-side Control access guard. No new permission is introduced.

## Implemented

### Fail-closed ERP safety configuration

- Added `lib/erp/safety-config.ts` as the typed parser for the existing ERP messaging and automation safety flags.
- Missing configuration preserves the existing documented defaults (both kill switches off); an explicit boolean kill switch is honored.
- Malformed JSON, non-object JSON, or a non-boolean value for a recognized safety flag sets both messaging and automation kill switches to ON in the returned in-memory decision.
- Messaging dispatch and ERP automation now consume this common parser.
- A failed configuration-store read now aborts dispatch/automation before any side effect; it is no longer caught and treated as an empty configuration.
- Invalid configuration therefore stops dispatch/automation rather than silently parsing as an empty object and proceeding.
- No database write, schema migration, config mutation, or provider call was added.

### Read-only operational observations

- The Control overview's platform-wide health section is available only to a future explicitly authorized global `system.health.read` grant; tenant-scoped grants are refused for platform-wide sources.
- It performs a read-only database reachability query and reads persisted status counts for ERP tasks, payment recovery tasks and messaging outbox recipients.
- Application response, database reachability, queue-state observations and observation timestamp are distinguished.
- Queue counts are explicitly not treated as proof of worker liveness.
- Deployment, live providers, AI provider-metered usage/cost, media storage, canonical incidents and worker heartbeat remain UNAVAILABLE because no authoritative health source or durable heartbeat was verified.
- The section reports partial observations as PENDING, never as complete platform health.

## Tests added

- Valid/defaulted configuration parsing.
- Malformed JSON, arrays, null, scalar JSON and non-boolean safety flags fail closed.
- Messaging dispatch does not send when configuration is malformed or its configuration read fails.
- ERP automation does not run when configuration is malformed or its configuration read fails.
- Existing positive kill-switch behavior remains covered.

## Still BLOCKED

ADMIN-007 is not complete. Remaining work includes:
1. Validated central configuration catalogue covering AI, WhatsApp/SMS, Paystack, email, reporting, POS, Studio, storage, auth and limits.
2. Immutable configuration change history and confirmation/reason workflow.
3. Scoped operator kill-switch UI and audit, only after separate owner authorization.
4. AI-specific kill-switch enforcement across every AI execution entry point.
5. Authenticated provider/deployment/media health probes with source provenance and safe timeouts.
6. Durable last-success/heartbeat history, incident severity and opened/resolved timestamps.
7. Independent six-viewport browser acceptance and exact-head CI.

## Verification and release status

Exact-head CI is pending on this branch. Do not merge or deploy based on this partial slice. The repository-wide readiness gate remains blocked by the unresolved programme requirements. No production database, environment, secret, payment, provider, DNS, Control permission, merge or deployment action was performed.
