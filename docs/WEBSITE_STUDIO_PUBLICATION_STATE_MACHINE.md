# Website Studio per-site publication state machine

## Scope

Publication state belongs to an individual `StudioWebsite`. Business-level `Business.isPublished` remains the outer public-route gate; it is not a substitute for the state of a particular website. The default website retains `/b/[businessSlug]`; secondary websites use `/b/[businessSlug]/[websiteSlug]`.

## States

- `DRAFT`: a provisioned site that has not yet completed a Studio publication. For the default site only, the existing published `BusinessExperience` may remain the bounded compatibility renderer while the site is in this initial state.
- `PUBLISHED`: the website's immutable `StudioWebsiteContent.publishedJson` snapshot is public. Draft writes do not change it.
- `UNPUBLISHED`: an explicit owner action has disabled this website. It is terminal for legacy fallback; a legacy snapshot must not reappear.
- `SUSPENDED`: reserved for administrative/business suspension where supported. Public rendering rejects it.

## Permitted transitions

| From | To | Trigger | Required preconditions |
| --- | --- | --- | --- |
| absent | DRAFT | first authorized Studio provisioning | business ownership and workspace membership verified |
| DRAFT | PUBLISHED | publish | exact expected draft version and snapshot; publication entitlement/payment and content validation; tenant authorization |
| PUBLISHED | PUBLISHED | publish changes | exact expected draft and current published versions; entitlement/payment and validation |
| PUBLISHED | UNPUBLISHED | unpublish | exact expected draft and published versions; tenant authorization |
| UNPUBLISHED | PUBLISHED | publish again or restore | fresh reviewed draft or validated historical snapshot; current-version compare-and-swap |
| PUBLISHED | PUBLISHED | rollback | target version belongs to same website; expected draft/published versions match; snapshot validates; new immutable version is created |
| any | SUSPENDED | authorized suspension policy | policy authorization and audit evidence |

A draft save increments the draft revision only. It never changes the published snapshot or website publication state. A rollback appends a new publication version and draft revision; it never rewrites history.

## Public resolution

1. Reject missing and suspended businesses before rendering.
2. Resolve the requested website using both business ID and website slug. The default route resolves only the default website.
3. A secondary route requires that exact secondary website to be `PUBLISHED`; it never falls back to the default site or a legacy business snapshot.
4. A `PUBLISHED` Studio site renders only its own published snapshot.
5. For the default route, `DRAFT` means initial provisioning only: the existing published legacy BusinessExperience may be used while the tenant's business-level public gate is on.
6. `UNPUBLISHED` blocks legacy fallback. Default-site unpublish also closes the business-level public gate and marks the legacy experience unpublished.
7. An unpublished draft is never returned to anonymous visitors.

## Concurrency and history

Draft save, publish, unpublish and rollback use version predicates / compare-and-swap inside transactions. A stale operation returns a conflict rather than overwriting newer state. Publication and rollback history records are append-only and are committed atomically with the corresponding snapshot and state change. Audit events are emitted only after the database transaction commits.

## Compatibility boundary

The legacy fallback is intentionally limited to the default route and the initial `DRAFT` provisioning state. It is not available to secondary sites, after an explicit `UNPUBLISHED` transition, or after the Studio site has entered `PUBLISHED`.
