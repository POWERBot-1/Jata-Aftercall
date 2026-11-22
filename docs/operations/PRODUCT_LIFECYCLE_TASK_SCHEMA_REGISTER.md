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
| Generic payload denylist, complexity bounds and object-root validation | PASS (partial control) | `lib/admin/product-lifecycle-payload-guard.ts` |
| Guard applied to task payload, event metadata, run cursor and summary writes | PASS (guard coverage only) | `lib/admin/product-lifecycle-execution-store.ts` |
| Per-task producer inventory | BLOCKED | Concrete producer callsites and fixtures not established in this review |
| Product/transition-specific strict allowlists | BLOCKED | Cannot define without producer inventory |
| Synthetic fixtures from real producer contracts | NOT TESTED | No approved producer contracts yet |
| Worker/scheduler activation | BLOCKED | Must remain disabled |

## Next gate

Locate and review every actual enqueue caller on the lifecycle integration branch. Build synthetic fixtures from those callsites, then introduce strict, versioned schemas one task type at a time. Keep the PR draft and do not activate a worker or scheduler while any producer remains unclassified.

## Source-level producer inventory — 2026-11-22

The lifecycle integration branch was inspected at PR #137/#138:

| Source | Finding | Consequence |
|---|---|---|
| `app/api/cron/product-lifecycle-observer/route.ts` | Authenticated GET returns aggregate counts and an opaque cursor; it does not enqueue tasks. | No task payload contract originates here. |
| `lib/admin/product-lifecycle-execution-ledger.ts` | `planLifecycleObservation` is a pure decision function; it returns a small action enum and does not persist or enqueue. | Planner output is not a persisted payload. |
| `lib/admin/product-lifecycle-execution-store.ts` | Exports the generic enqueue adapter; the inspected PR #137/#138 changed-file scope contains no call to it. | The adapter has no demonstrated production producer contract yet. |
| `lib/admin/product-expiry-grace-observation-store.ts` | Loads five subscription inventories and returns detailed observations internally; the HTTP route strips rows and returns aggregates. | Do not persist the full observation object or treat the read-only route as a producer. |

**Inventory result: no concrete enqueue callsite was found in the inspected lifecycle PR source scope.** This is narrower than a repository-wide proof: a complete search of every source file on the candidate head is still required before declaring the producer inventory globally complete.

The next safe implementation step is therefore not to invent a per-transition schema or connect the planner to enqueue. First obtain a complete candidate-head callsite inventory. If no producer exists, define and review the first producer contract as a separate change before adding any enqueue wiring. Until then, the generic denylist remains defense-in-depth only and worker/scheduler activation stays blocked.


## Payload root-shape hardening — 2026-11-22

The generic JSON guard now rejects null, scalar and array roots. Lifecycle JSON columns are object contracts; accepting a scalar or array at the root would bypass the intended key-based review boundary even if nested values were bounded. A unit test covers null, undefined, string, number, boolean, empty array, non-empty array and a valid empty object. This is defense-in-depth only; it does not replace task-specific strict allowlists or constitute executed test evidence until exact-head CI runs.

## Candidate-head static inventory evidence — 2026-11-22

The fail-closed TypeScript-compiler-AST inventory ran in POS/ERP verification workflow [44999096907](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44999096907) on candidate SHA `66e050f1cbff1c05e90fe6e5ef4612273d9cc44f`.

| Measure | Exact result |
|---|---:|
| Tracked TS/TSX/JS source files scanned | 1,533 |
| Production references to lifecycle enqueue/run creation adapter | 0 |
| Test references | 7 |
| TypeScript parse errors | 0 |
| Scanner unit tests | 5 passed, 0 failed |

**Assessment:** PASS for the bounded static inventory gate on this exact candidate SHA. The scan did not find a production callsite for `enqueueLifecycleTasks` or `createLifecycleExecutionRun`; the seven references are test references. This is stronger than the earlier PR #137/#138 changed-file review, but it is not a whole-program proof. Reflection, computed module paths, runtime-generated code and arbitrary indirect invocation are outside the scanner's static-analysis model.

**Do not over-interpret this result:** the per-task producer inventory remains BLOCKED because no real production producer contract exists to enumerate. Task-specific strict allowlists and fixtures derived from real producer contracts remain BLOCKED / NOT TESTED. The next implementation must not invent a payload schema or wire the pure planner into enqueue merely to create a caller. A separately reviewed first producer contract is required before production enqueue wiring.

The same workflow completed successfully: migration-chain scenarios reported `RESULT: PASS (all migration scenarios)`; the PostgreSQL suite reported 12 test files and 115 tests passed. The candidate remains a draft PR, and no worker or scheduler was activated.
