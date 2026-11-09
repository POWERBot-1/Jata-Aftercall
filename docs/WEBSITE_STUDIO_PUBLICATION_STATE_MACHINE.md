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

## Implementation authority

`lib/experience/publication-state.ts` is the single place publication is decided. It exports
`STUDIO_SITE_STATES`, `canTransitionStudioSite`, `describeSitePublication`,
`tenantIsPubliclyVisible`, `resolvePublicDocument` and `legacyDraftAllowed`. `loadStorefront`
(`lib/experience/storefront.ts`) calls it and does not re-derive publication inline; the public
routes (`app/b/[slug]`, `app/b/[slug]/[siteSlug]`) call `loadStorefront`. Unit coverage:
`tests/unit/publication-state-machine.test.ts`, `tests/unit/storefront-public-content.test.ts`.

## Correction to "Public resolution" step 6

*The paragraph above states that default-site unpublish always closes the business-level public
gate. That is only correct while the tenant has no other published website. Preserved below in
the original wording; the operative rule is this correction.*

`Business.isPublished` is a tenant-wide kill switch shared by every site of the tenant. Unpublish
therefore clears it **only when no other website of that business remains `PUBLISHED`**:

- unpublishing a secondary site never clears it;
- unpublishing the default site leaves it set while a sibling site is still published, so that
  sibling keeps serving customers;
- unpublishing the last published site clears it, which takes the tenant's public routes down.

Clearing it unconditionally — the previous behaviour — made a business-wide flag stand in for
per-site publication state and silently blanked live sibling websites.

## Additional invariants proven by the database suites

- A site row this module does not recognise fails closed to `SUSPENDED`. Unknown state is never
  read as "never published", which would re-enable a fallback nobody asked for.
- A tenant with no `StudioWebsite` row at all is pre-cutover, not an error: the default route
  keeps serving the legacy `BusinessExperience`.
- A migrated snapshot is not a publication. `StudioWebsiteContent.publishedJson` is seeded from
  the legacy document at provisioning time, so "has a snapshot" is not the same question as
  "has been published". Only the state distinguishes them.
- Publication versions and draft revisions use database-generated ids. Deterministic ids
  (`swv_<site>_<n>`, `swdr_<site>_<n>`) collide with the rows the migration seeds and turn a
  legal publish/rollback into a unique-constraint failure.
- Rollback numbers its new draft revision above both the content cursor and the highest stored
  revision; `(websiteId, draftVersion)` is unique, so the cursor alone is not sufficient.
- A `SUSPENDED` website cannot be republished by its owner; it is reinstated by the operator.
- A secondary website declares its own canonical URL (`/b/<businessSlug>/<websiteSlug>`); it
  must not inherit the default site's canonical, which would make it a duplicate in search.

Evidence: `tests/integration/storefront-per-site-publication-postgres.test.ts` (15 tests, public
resolution on a migrated database) and `tests/integration/studio-publication-state-machine-postgres.test.ts`
(8 tests, the state machine driven through the real publish/unpublish routes).
