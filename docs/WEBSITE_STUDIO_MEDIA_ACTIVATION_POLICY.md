# Website Studio media — deferred activation policy

Decision received 2026-10-11: **DEFER PROVIDER APPROVAL**. Persistent-original acceptance is **BLOCKED**, not waived. No object/CDN provider is selected, provisioned, activated or funded. New work must not enable real uploads, provider calls, paid provisioning or spending. Original bytes must not be written inline to Neon as a substitute. Existing Vercel/Neon architecture and working legacy functionality remain intact.

## Current boundary

- The inherited workflow persists **processed derivatives** inline in existing experience/product records; it does not prove original preservation or approved durable storage. Do not re-label those derivatives as originals or as a completed media pipeline.
- No new original-upload path or binary database column is introduced. Independent local image inspection/processing, safe configuration, presentation, test fixtures and planning may proceed without enabling ingestion/provider operations.
- Existing working features are not silently disabled or migrated. A later migration must retain legacy records/read fallbacks, require explicit authorization and report any original bytes that were already discarded as unrecoverable.
- Test media is synthetic/local and must be identified as such. Provider/persistence/device acceptance is BLOCKED or explicitly skipped with this decision as its reason; mocks and compilation are not persistence/provider proof.

## Required controls BEFORE activation (requirements, not implemented claims)

| Area | Required activation evidence |
|---|---|
| Selection/configuration | Explicit owner-approved provider, existing/new project, region, public CDN domain policy, private original access, environment bindings and feature flag. Configure secrets only outside chat in approved secret storage; no invented credentials. |
| Authorization | Server-authenticated owner/business checks before upload token issuance, reads, transforms, variants, acceptance, deletion and publication. Asset ID/object key is never trusted as tenant authority. Public visitors receive only approved published derivatives; unpublished/other-tenant originals denied. Native cross-tenant tests required. |
| Object identity | Tenant-scoped opaque keys, unguessable operation IDs, immutable original checksum/byte length/MIME/dimensions/orientation and provenance. Filename is descriptive only, not a path or access-control mechanism. Never reuse a foreign tenant's object reference. |
| Bytes/metadata separation | Original and processed derivative are separate objects. Original remains immutable; transforms cannot overwrite it. Only URLs/opaque IDs, checksums, provenance, lifecycle and tenant references go in Neon; no new original data URLs/binaries. |
| Upload verification | Registered signatures/MIME/extension, strict size/dimension/decode limits, malformed/truncated/decompression-bomb cases, EXIF/orientation, safe metadata handling. Direct uploads require server verification of the provider object before marking READY; client success is not authority. Unsupported HEIC must be rejected usefully, never claimed converted. |
| Access/transport | TLS, scoped least-privilege provider credentials, private original ACLs, short-lived server-authorized read/operation URLs, encryption/backup behavior verified with chosen provider. Do not log tokens, signed URLs or original private bytes. URL ingestion requires explicit host/redirect/SSRF controls. |
| Owner choice/provenance | Variants remain separate and pending accept/reject. Generated images are labelled; commercial labels/prices/stock/legal/contact remain authoritative server data. Provider return URLs/bytes do not automatically become approved/public assets. |
| Retention | Original retention period, pending/rejected-variant TTL, orphan cleanup schedule, legal holds, backup restoration and regional rules must be documented and OWNER-APPROVED. No retention periods are approved by this checkpoint; no automatic deletions enabled. |
| Deletion | Authenticated tenant-scoped soft-delete/tombstone, reference checks for published/live/history use, bounded retry/idempotency and provider deletion verification. Agree CDN invalidation/backup retention and whether existing published references block deletion. No production cleanup/backfill/deletion without authorization. |
| Cost limits | Currently approved spend: **NONE**. Before activation approve storage/egress/operation/transform caps, business/platform quotas, notification/stop thresholds, provider billing/overage behavior and who can increase limits. Undefined limits must keep new provider operations disabled; application quotas alone cannot promise a provider billing cap. |
| Observability/recovery | Safe operation IDs, status transitions and useful retry/failure UI; monitor denied/cross-tenant attempts, byte/operation budget and failed cleanup without private payloads. Verify restore/rollback and provider outage/static derivative fallback. |

## Required activation checklist

1. Owner explicitly authorizes provider/configuration and cost/retention/deletion/access policies.
2. Secrets and environment are configured in an approved deployment/test environment, outside chat.
3. Native ownership/lifecycle/schema tests and real configured sandbox upload → original checksum → separate derivative → approve/reject → private/public access → deletion/retention tests PASS.
4. Physical Android JPEG/PNG/WebP/large-camera photos, EXIF/orientation, retry/progress and useful unsupported-HEIC errors PASS; simulation is reported separately.
5. Security/dependency/bundle/memory measurements and migration/backfill plan reviewed; no production mutation or deployment without separate approval.

**No acceptance is closed by this document or an adapter alone.** Independent engine work continues; original-preservation/storage/provider acceptance remains BLOCKED until those gates are actually satisfied.


## Independent local raster checkpoint (not activation)

The local preparer now refuses optimization-failure original-inline substitution, works from an immutable File/temp decode copy and can produce a separate in-memory processed derivative. It does not retain originals durably, issue tokens, activate a provider or authorize a new upload endpoint. Existing legacy processed-derivative/read contracts stay unchanged. No exact OS-decoder memory guarantee or physical Android/HEIC acceptance is inferred from local pixel tests. These are independent safety checks; **persistent-original/provider acceptance remains BLOCKED**. All selection/access/retention/deletion/cost/configuration/actual-provider gates above still apply before activation.
