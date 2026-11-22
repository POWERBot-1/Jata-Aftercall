# Product lifecycle producer contract — design gate

**Status:** DESIGN / NOT APPROVED FOR EXECUTION  
**Reviewed source revision:** `ab5057904a4353f5813b74909e20132d470079dd`  
**Scope:** Read-only subscription observation and durable lifecycle-ledger enqueue design.  
**Explicit exclusions:** No worker, scheduler, production producer, entitlement mutation, expiry mutation, billing action, customer-access change, notification, provider call, or data migration.

This document records the source distinctions that a future producer must preserve. It is not permission to enqueue work or infer commercial policy.

## 1. Product-to-source register

| Product | Candidate authoritative source | Product discriminator | Relevant source fields | Current policy caveat |
|---|---|---|---|---|
| Business Page | `Subscription` | Related `PlanConfig.key` in `MONTHLY` / `ANNUAL` | `id`, `businessId`, `status`, `expiresAt`, `graceUntil`, related plan key, `updatedAt` | Both keys are billing intervals for one product. Emit at most one observation per subscription row. Owner confirmation of the intended lifecycle transition vocabulary remains required. |
| Website Studio | `Subscription` | `INTERACTIVE_BUSINESS` | Same shared-row projection | Team-free access exists outside paid subscription expiry. Do not synthesize a subscription task for team-free access. |
| AI Front Desk | `Subscription` | Explicit Front Desk tier keys resolved through `PlanConfig.key` | Same shared-row projection | Do not infer product identity or expiry from a generic paid-payment row. Preserve suspended/cancelled and billing-state gates. |
| Business POS | `PosSubscription` | `planKey = BUSINESS_POS` | `id`, `businessId`, `planKey`, `status`, `expiresAt`, `graceUntil`, `cancelledAt`, `updatedAt` | Cancellation and suspension take precedence in the current reader. Stored grace boundary is used when present; missing-grace policy needs explicit contract treatment. Team-free access is separate. |
| Autopilot | `AutopilotSubscription` | `JATA_AUTOPILOT`, `JATA_AUTOPILOT_PRO`, `JATA_AUTOPILOT_ENTERPRISE` | `id`, `businessId`, `planKey`, `status`, `expiresAt`, `graceUntil`, `cancelledAt`, `updatedAt` | Current reader calculates fallback grace as `expiresAt + AUTOPILOT_GRACE_DAYS` (3 days) when stored `graceUntil` is absent. A generic missing-grace rule would disagree with current behaviour. Cancellation handling is time-dependent. Team-free access is separate. |
| MJENGO OS | `MjengoSubscription` | `planKey = MJENGO_OS` | `id`, `businessId`, `planKey`, `status`, `expiresAt`, `graceUntil`, `cancelledAt`, `updatedAt` | Current reader also evaluates matching paid-payment evidence and entitlement suspension/cancellation. Do not use payment records as the expiry source. |
| ERP PRO | `ErpProSubscription` | `planKey = ERP_PRO` | `id`, `businessId`, `planKey`, `status`, `expiresAt`, `graceUntil`, `cancelledAt`, `updatedAt` | Existing ERP access/sync path can write entitlement state. A producer must use a dedicated read-only query and must not call sync/provisioning functions. |

### Legacy ERP rows

`ErpSubscription` / `ErpEntitlement` are preserved historical/shared rows. The isolation migration copies `ERP_PRO` and `MJENGO_OS` records into their dedicated product tables. They are not additional active ERP PRO sources. No deletion or cleanup is proposed. Production row reconciliation and a complete exact-head reference inventory remain outstanding.

## 2. Candidate read-only query rules

A future implementation must:

1. Resolve each product from its authoritative subscription source and explicit plan discriminator. Never fan one shared `Subscription` row into multiple product tasks.
2. Select only the minimum fields needed for observation and deduplication: source row ID, tenant/business ID, product discriminator, status, expiry/grace timestamps, cancellation timestamp where present, and the timestamp required by the approved scan boundary.
3. Avoid selecting payment references, customer contact data, provider payloads, message content, or full related records.
4. Exclude team-free access from paid-subscription expiry production. Team-free access must not be represented as an invented subscription.
5. Avoid entitlement readers that perform writes, synchronisation, provisioning, or payment reconciliation. Use Prisma read-only projections directly.
6. Treat the source subscription as the observation subject. Entitlement rows and payment rows may be corroborating policy inputs only where the owner-approved product contract explicitly requires them.
7. Preserve historical rows. This producer is not a cleanup or entitlement-repair process.

No executable Prisma query is specified here because status, grace, team-free, and cancellation rules are not yet approved as a unified contract.

## 3. Run boundary, pagination and replay design

Candidate design for acceptance testing, not yet approved for implementation:

- Capture one immutable `asOf` timestamp when the run is created. Every product scan in that run uses the same cutoff.
- Use deterministic keyset pagination ordered by the stable unique source primary key; never use offset pagination for a moving source.
- A cursor must include the source/product identity and last primary key, be versioned, bounded, and validated before persistence.
- Evaluate how concurrent updates and deletes interact with the cutoff. A timestamp predicate alone is not a database snapshot. The implementation must prove that rows changed during a scan are either consistently observed or safely reconsidered by a subsequent run.
- Establish a finite high-water boundary or equivalent bounded snapshot strategy so newly inserted rows do not extend a run indefinitely.
- A retry of the same logical run must reuse the same run identity and cutoff. A new scan window must have a new run identity.
- Do not treat `updatedAt` as a unique cursor. Pairing a timestamp with a unique primary key may be considered only after query-plan and concurrency tests.

## 4. Idempotency and task payload

The existing ledger derives a SHA-256 idempotency key from:

`product + businessId + subscriptionId + transitionKey`

and the database enforces uniqueness. The key is deterministic but does not define the business meaning or lifecycle vocabulary of `transitionKey`.

Before a producer exists, approve:

- A versioned transition vocabulary per product (including whether expiry and manual-review observations are separate transitions).
- Whether a repeated scan after a subscription renewal creates a new transition or is ignored as stale evidence.
- A source-version rule so a task derived from an old subscription snapshot cannot be mistaken for current state.
- Strict per-product payload allowlists and schema versions. Payloads should contain only opaque identifiers, approved reason codes, and the minimum timestamps needed for audit. Do not put raw subscription/payment/customer records in payloads.
- A stable policy for unknown/malformed dates and missing expiry/grace values. Do not guess grace duration.

The generic payload guard is a defensive denylist/shape bound, not a replacement for strict per-product allowlists.

## 5. Product-policy questions requiring owner decision

| Decision | Why it blocks production |
|---|---|
| Business Page plan-key contract and lifecycle transitions | `MONTHLY` / `ANNUAL` are mapped in the catalogue, but expiry-to-task semantics still need approval. |
| Missing or invalid grace handling per product | Autopilot has a three-day fallback; other products differ. |
| Cancellation semantics per product | Some readers treat cancellation as immediate; Autopilot cancellation is time-dependent. |
| Team-free exclusion and re-entry | Team-free access has no paid subscription expiry and must not produce false expiry tasks. |
| Suspended, pending, refunded and payment-confirmed states | Readers have product-specific state and payment gates. |
| Legacy ERP reconciliation | Historical source rows must be reconciled against dedicated active tables before any data disposition. |
| Transition key and stale-snapshot semantics | Required to prevent duplicate or obsolete lifecycle work. |

## 6. Required isolated PostgreSQL acceptance suite

No producer implementation should begin until tests prove all of the following using an isolated PostgreSQL database and deterministic fixtures:

1. **Source mapping:** every product selects only its authoritative source; shared subscription plan keys map to exactly one product.
2. **Team-free exclusion:** team-free businesses do not create paid-subscription expiry tasks.
3. **Policy parity:** observed expiry/grace/cancellation outcomes match the current product reader for approved states, including Autopilot's fallback.
4. **Malformed data:** null, invalid, inverted, and boundary-equal timestamps follow an explicitly approved policy.
5. **Keyset correctness:** stable ordering, no duplicates, no omissions across page boundaries, and bounded high-water behaviour.
6. **Concurrent mutation:** insert, update, cancellation, renewal and delete during a scan are handled consistently; subsequent runs recover eligible changed rows.
7. **Tenant isolation:** no cursor, query, task, or reconciliation path crosses business boundaries.
8. **Run replay:** duplicate run creation and retry preserve the same cutoff and do not duplicate logical work.
9. **Enqueue races:** concurrent producers with the same source transition create one task under the unique idempotency constraint.
10. **Stale source fencing:** a task from an older source version cannot trigger a later business-side effect. The current ledger records work only; no side effect is in scope here.
11. **Payload allowlists:** each product rejects unknown keys, PII, payment/provider content, and unsupported schema versions.
12. **Legacy ERP preservation:** fixtures demonstrate that legacy rows remain unchanged while active ERP PRO and MJENGO observations use only dedicated tables.

Record test counts, PostgreSQL version, migration state, exact commit SHA, and raw CI run links. Unit-only or mocked Prisma tests do not satisfy these database acceptance requirements.

## 7. Explicit phase gates

- **PASS:** exact-head source model and product reader review documented.
- **BLOCKED:** owner approval of product policy, transition vocabulary, cursor/cutoff and payload schemas.
- **NOT TESTED:** live database inventory, concurrency, tenant isolation, replay and PostgreSQL producer acceptance.
- **PROHIBITED in this phase:** production enqueue, worker/scheduler activation, entitlement or subscription mutation, payment action, customer-access change, provider call, migration, deployment or merge.

This document is a design contract candidate only. It does not authorise a production producer or any operational side effect.
