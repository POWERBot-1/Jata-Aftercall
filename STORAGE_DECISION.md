# Object storage decision (Immersive Website Engine)

Status: **proposed, not approved.** No paid resource, credential or production configuration has been created.
Scope: image derivatives and GLB models. Lite storefronts do not depend on either.

**Current source correction (E-25):** the `inline-data-url` identifier remains for compatibility, but `put()` fails closed; `/api/media` refuses new data-image bytes and accepts hosted/path references as metadata only. `IMPLEMENTED_PROVIDERS` is empty, no durable object-read adapter is wired, and legacy reads remain. No database inventory ran, so existing media is unknown. Price figures below are earlier illustrations, not current quotes; compare current provider terms/costs before selection. See `RELEASE_DECISIONS.md` §1 and `OWNER_APPROVAL_REQUEST.md` C.

## 1. Rules that do not change

- Binary media never goes into Neon. Neon stores metadata only: key, provider, URL, bytes, content type, dimensions and provenance.
- Data URLs are not the long-term store for images or 3D assets. The inline provider in `lib/storage/inline.ts` is declared non-durable and its `put()` fails closed. `assertCanStore` in `lib/storage/index.ts` encodes the provider/size checks, but a repo-wide source search found only its definition and unit-test calls: **no application/runtime call site currently invokes it**. The feature flag (`immersiveFeatureEnabled`) also requires durable-provider capabilities. Any future upload path must call `assertCanStore` before writing; that future call is not yet implemented.
- Tenant isolation: every key is built as `tenants/<businessId>/<kind>/<name>` (`lib/storage/keys.ts`). Traversal, extension mismatch and oversize inputs are rejected before any provider is called.
- No secret is read, written or printed by the code in this change. `resolveStorageProvider` fails loudly for an unknown or not-yet-implemented provider (currently `vercel-blob`).

## 2. The provider interface (as built)

`lib/storage/types.ts` defines:

- `ObjectStorageProvider` with `id`, `capabilities` (`durable`, `cdn`, `maxObjectBytes`, `derivatives`, `models`), `put()` and `remove()`.
- `StoredObjectRef` returned by `put()`. This is the only shape that is written to the database.
- Kinds: `image-original`, `image-derivative`, `model-glb`, `model-texture`. Size limits and content types per kind live in `keys.ts`.

Adding a provider means implementing this interface and registering it in `lib/storage/index.ts`. Nothing else in the engine changes.

## 3. Candidates

| Option | Status in this repo | Notes |
| --- | --- | --- |
| Inline data URL (legacy identifier/read compatibility) | Non-durable; new `put()` is disabled and fails closed | Existing historical references may be read; no new binary write. Not a durable provider and not for 3D. |
| Vercel Blob | Candidate only. Not implemented. | Same vendor as hosting. CDN-backed. Needs a read-write token secret. |
| S3-compatible (including AWS S3 or R2) | Candidate only; not evaluated or implemented | Compare storage, requests, egress/cache, versions/backups, lifecycle and current provider terms. Access/identity and cost are unknown. |
| Cloudinary | Candidate only; not evaluated or implemented | Compare current plans/credits, transformations, bandwidth, access controls, retention and deletion. Compatibility and cost are unknown. |

## 4. Vercel Blob: cost model (disclosed, not authorised)

Source: a prior read of Vercel's official usage and pricing page (Sept 2026 revision). Not refreshed in E-25; figures below are historical illustrations, not current quotes or an approved budget.

- Storage: **$0.023 per GB-month**.
- Simple operations: **$0.40 per 1M**. Advanced operations: **$5.00 per 1M**.
- Data transfer: **$0.05 per GB**.
- Hobby includes 1 GB storage, 10K simple and 2K advanced operations, and 10 GB transfer.
- Fast Origin Transfer applies on CDN cache misses, so cache hit rate matters for cost.

Third-party blog figures for these prices conflict with the official page. Do not rely on them.

Illustrative estimate (assumptions, not measured):

- 500 businesses × 20 product photos × (1 original + 3 derivatives) × ~300 KB average ≈ 12 GB stored.
- Storage: 12 GB × $0.023 ≈ **$0.28 per month**.
- Transfer: 100,000 page views × 1.5 MB, if none were cached ≈ 150 GB × $0.05 ≈ **$7.50 per month**. With a high CDN hit rate this falls sharply.
- 3D models would add storage and transfer. Each GLB is capped at 8 MB by the policy in `lib/experience/immersive/policy.ts`. Model volume is unknown and must be measured before any upload is enabled.

That illustration reflects only its stated historical assumptions; it is not a current estimate, forecast, quote or budget. Actual workload, provider terms, cache behavior and total cost are unknown. A per-tenant upload quota, global ceiling, alerts and explicit one-time/monthly budget must be approved before any real customer upload.

## 5. Recommendation (conservative)

1. Keep new media writes fail-closed and preserve legacy reads. Do not enable 3D uploads or route new writes to the inline provider.
2. Before selecting a durable provider, compare only candidates confirmed compatible with this runtime and access pattern, including provider/egress/operation costs, public versus private access, tenant isolation/quotas, privacy, retention/deletion, rollback and legacy-media remediation. Current compatibility and quotes are unknown; Vercel Blob, S3-compatible storage and Cloudinary remain candidates, not recommendations or approvals.
3. After a provider and explicit one-time/monthly budget are approved, implement its adapter and read path behind the interface. Confirm the provider's current SDK, identity, secret names and access model before any secret is configured; do not create a token or store it in the repo.
4. Before any approved upload, enforce per-tenant quotas, global storage ceiling and alerts. No provider activation, account, upload, migration, backfill, spending or deletion is authorized by this proposal.
5. Measure real GLB sizes. Add Draco, Meshopt or KTX2 only after the decoders are wired and tested. 3D activation is a separate owner decision.

## 6. Decisions still needed from the owner

- Approve a non-binding compatibility, current-cost, access/tenant/privacy, retention/deletion, rollback and legacy-media remediation comparison; then select a provider only after that evidence is reviewed.
- Set explicit one-time and monthly spending ceilings, quota limits, alerting and an abort threshold before any account, secret, activation, upload or migration; current costs are unknown.
- Separately authorize adapter/read-path implementation and the exact secret/identity setup after provider selection.
- Separately approve when (if ever) 3D asset uploads may be enabled for real businesses.

## 7. Activation runbook (proposed, NOT active)

Nothing in this section is enabled. Each step needs the owner's explicit approval, listed in section 7.5.

### 7.1 Environment variables

| Variable | Current value | Purpose | Secret? |
| --- | --- | --- | --- |
| `JATA_STORAGE_PROVIDER` | unset (defaults to `inline-data-url`) | Selects the provider. `vercel-blob` is refused today with a clear error. | No |
| `JATA_IMMERSIVE_ENABLED` | unset (off) | Master switch for visitor-facing 3D. Also requires a durable provider with model support. | No |
| `BLOB_READ_WRITE_TOKEN` | not set, not created | Vercel Blob read-write token, if Vercel Blob is approved. Expected name; confirm against the SDK before use. | **Yes** |

No variable is read from the repository, and no secret is committed. The token must be created by the owner in the Vercel dashboard and stored only in the Vercel project's environment settings.

### 7.2 Historical cost illustrations (not current quotes or a budget)

Section 4 records a prior Vercel price-list snapshot and illustrative assumptions. Those values were not refreshed in E-25 and must not be used for selection, a spend cap or a business commitment. Current provider terms, total cost, transfer/cache profile and usage remain unknown; obtain a current like-for-like comparison before any decision or spend. Real GLB sizes are unknown; measure only on an approved synthetic/local fixture before enabling any uploads.

### 7.3 Spending safeguards (required before activation)

1. Set a spend limit and budget alert in the Vercel dashboard. Confirm the limit with the owner first.
2. Per-tenant upload quota (count and bytes) enforced in the application before `put()` is called.
3. Global storage ceiling, checked before each upload. Uploads refuse when the ceiling is reached.
4. Enforce the per-kind size limits in `lib/storage/keys.ts` (images and models) at the server.
5. Cache all served assets with long-lived immutable URLs, so repeat reads are cheap.
6. Keep 3D disabled (`JATA_IMMERSIVE_ENABLED` unset) until real transfer numbers are known.

### 7.4 Migration behaviour (designed, not executed)

- Some legacy image references may be inline data URLs in draft/history/product rows; current inventory is unknown. Current source preserves legacy read paths, but does not establish that every historical consumer is still compatible. Nothing is migrated automatically.
- A future, approved backfill design must inventory and classify legacy references first; preserve tenant scope and provenance; use deterministic idempotency keys; verify each uploaded object and new reference; and write a new version without mutating the prior revision. Run a dry-run and verification on an approved isolated copy before separately authorizing any real migration.
- Retain old references/objects until the owner-approved rollback window and verification complete. Delete only under a separate approved retention/deletion procedure after verifying no drafts, published snapshots, versions, history, products or other rows still reference the object. Neon/binary behavior and historical duplicates must be measured; bounded storage cannot be claimed without evidence.
- **Rollback is not implemented or executable today.** Switching the provider identifier back to `inline-data-url` is not a rollback: inline `put()` fails closed, and no durable object-read adapter is wired. A future plan must preserve old readers/references, specify how both old and new objects remain readable during rollback, and verify restoration using disposable fixtures before production is even considered. No inline-write fallback may be introduced to make rollback appear to work.

### 7.5 Owner decisions required before activation

1. Approve only a non-binding compatibility/cost/access/privacy/retention/deletion comparison; provider selection follows that review.
2. Set one-time and monthly budget ceilings and per-tenant/global quotas, with no account, secret, activation, upload or spend until separately approved.
3. After selection, separately authorize adapter/read-path implementation and provider-specific secret/identity setup.
4. Define legacy inventory and remediation; any isolated-copy inventory, real backfill, deletion or production-data action requires its own explicit scope and approval.
5. Approve visitor-facing 3D (`JATA_IMMERSIVE_ENABLED`) separately from image storage, with its own safety/performance review.
