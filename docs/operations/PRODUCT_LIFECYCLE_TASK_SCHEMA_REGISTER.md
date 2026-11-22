# Product lifecycle task schema register

## Decision
**BLOCKED — task-specific allowlists are not yet safe to finalize.**

The reviewed lifecycle components define the task product, business/subscription identifiers, transition key and a generic JSON payload. The expiry observer returns a broader observation object containing identity, timestamps, status, state and explanatory text. The persistence adapter does not itself define a task-type discriminator or a concrete payload contract for each transition.

No schema is inferred from the generic denylist or from synthetic unit-test examples. In particular, do not persist the full expiry-observation object as a task payload: it contains business/subscription identifiers and free-form explanatory text that are not required for a minimal operational record.

## Required producer inventory before allowlisting

For every real enqueue caller, capture:
- source file and function;
- product and transition key;
- exact payload keys and value types;
- whether each value is required for execution, audit, or neither;
- whether the same value already exists in indexed task columns;
- representative synthetic fixtures for valid, invalid, secret-like and personal-data-like inputs.

The inventory must include all products supported by `LifecycleProduct`, not just one observed product. A missing producer is not permission to invent a payload schema.

## Proposed schema principles (not yet executable contracts)

1. Keep business and subscription identifiers in the dedicated indexed columns; do not duplicate them in JSON payloads.
2. Prefer enum reason/state codes and bounded timestamps over prose.
3. Do not store names, contact details, addresses, customer messages, transcripts, provider responses, payment credentials or raw request bodies.
4. Reject unknown keys by default once a concrete schema is approved for a task type.
5. Version each approved schema and test backward compatibility explicitly.
6. Keep event metadata, run cursors and summaries on separate, purpose-specific allowlists; they are not interchangeable with task payloads.

## Evidence status

| Requirement | Status | Evidence |
|---|---|---|
| Generic payload denylist and complexity bounds | PASS (partial control) | `lib/admin/product-lifecycle-payload-guard.ts` |
| Guard applied to task payload, event metadata, run cursor and summary writes | PASS (guard coverage only) | `lib/admin/product-lifecycle-execution-store.ts` |
| Per-task producer inventory | BLOCKED | Concrete producer callsites and fixtures not established in this review |
| Product/transition-specific strict allowlists | BLOCKED | Cannot define without producer inventory |
| Synthetic fixtures from real producer contracts | NOT TESTED | No approved producer contracts yet |
| Worker/scheduler activation | BLOCKED | Must remain disabled |

## Next gate

Locate and review every actual enqueue caller on the lifecycle integration branch. Build synthetic fixtures from those callsites, then introduce strict, versioned schemas one task type at a time. Keep the PR draft and do not activate a worker or scheduler while any producer remains unclassified.
