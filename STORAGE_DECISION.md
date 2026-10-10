# Object storage decision (Immersive Website Engine)

Status: **proposed, not approved.** No paid resource, credential or production configuration has been created.
Scope: image derivatives and GLB models. Lite storefronts do not depend on either.

## 1. Rules that do not change

- Binary media never goes into Neon. Neon stores metadata only: key, provider, URL, bytes, content type, dimensions and provenance.
- Data URLs are not the long-term store for images or 3D assets. The inline provider in `lib/storage/inline.ts` is a development and fallback path only. It is declared non-durable and is refused for derivatives and models (`assertCanStore`).
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
| Inline data URL (current default) | Implemented, non-durable | Images only, capped by `MAX_STORED_CHARS = 4_000_000`. Not for 3D. |
| Vercel Blob | Candidate only. Not implemented. | Same vendor as hosting. CDN-backed. Needs a read-write token secret. |
| Other S3-compatible object store | Not evaluated | Would add a second vendor and its own credentials. Not researched in this pass. |

## 4. Vercel Blob: cost model (disclosed, not authorised)

Source: Vercel's official usage and pricing page, checked in this session (Sept 2026 revision).

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

The estimate is small at this scale, but usage-based billing is unbounded. A per-tenant upload quota and a storage ceiling are needed before enabling uploads for real customers.

## 5. Recommendation (conservative)

1. Keep the inline provider as the default. Do not enable 3D uploads.
2. When explicitly authorised, implement a Vercel Blob adapter behind the interface. It would need one secret, expected to be `BLOB_READ_WRITE_TOKEN` (to be confirmed against the SDK docs before use). Do not create the token or store it in the repo.
3. Before the first real upload: set per-tenant quotas, a global storage ceiling and alerts in the Vercel dashboard, and record which of these the owner has approved.
4. Measure real GLB sizes. Add Draco, Meshopt or KTX2 only after the decoders are wired and tested. Until then, only uncompressed GLB is accepted.

## 6. Decisions still needed from the owner

- Approve Vercel Blob (or name another provider) as the durable store.
- Approve the secret to be created and added to the environment.
- Approve the monthly spend ceiling and per-tenant quota.
- Approve when 3D asset uploads may be enabled for real businesses.
