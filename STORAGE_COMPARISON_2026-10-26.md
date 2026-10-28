# Durable media storage — verified comparison for owner decision

**Date:** 2026-10-26 · **Status:** for owner decision — nothing in this document is enabled,
purchased or configured. **Context:** `STORAGE_DECISION.md` keeps new media writes fail-closed
until the owner selects a durable provider, sets a budget, and separately authorizes its
adapter. This document is the priced comparison §6/§7.5 asks for, with prices re-verified
against official vendor pages on 2026-10-26 (the figures in `STORAGE_DECISION.md` were a
September 2026 read).

The application is ready for whichever provider is chosen: uploads, AI generation and AI
editing already route through the `lib/storage` provider contract
(`tenants/<businessId>/…` keys, per-object caps, server-side validation, tenant guards,
quotas and provenance), and capabilities in the Studio turn on automatically once a durable
provider is configured. What is missing is exactly one thing: **the owner's provider choice +
budget cap + (then) adapter authorization and token creation.**

## Verified pricing (official pages, checked 2026-10-26)

| | Vercel Blob | Cloudflare R2 | Amazon S3 (Standard) | Cloudinary |
| --- | --- | --- | --- | --- |
| Storage | **$0.023 / GB-month** | **$0.015 / GB-month** | **$0.023 / GB-month** (first 50 TB) | credit-based (below) |
| Delivery / egress | $0.05 / GB (Pro: counts toward Flat Rate CDN's 1 TB/mo) | **free** | ~$0.09 / GB after 100 GB/mo free (direct); CDN extra | 1 credit / GB bandwidth |
| Writes | $5.00 / 1M advanced ops | $4.50 / 1M Class A | $5.00 / 1M PUT | counts as credits via transformations |
| Reads | $0.40 / 1M simple ops | $0.36 / 1M Class B | $0.40 / 1M GET | — |
| Free allowance | Hobby: 1 GB storage + 10 GB transfer/mo | 10 GB-month + 1M/10M ops/mo | none ongoing (new-account free tier only) | Free plan: 25 credits/mo |
| Paid entry | usage-based on existing Vercel plan | usage-based, separate Cloudflare account | usage-based, AWS account | Plus **$99/mo** ($89 yearly) = 225 credits |
| Source | vercel.com/docs/vercel-blob/usage-and-pricing | developers.cloudflare.com/r2/pricing | aws.amazon.com/s3/pricing | cloudinary.com/pricing |

Cloudinary's unit: 1 credit = 1 GB managed storage **or** 1 GB delivered bandwidth **or**
1,000 transformations. Its free 25 credits suit a pilot only; the first paid step is a flat
~$99/month — effectively ~$0.44/GB at full use of 225 credits, far above the others at JATA's
volumes, in exchange for built-in image transformations JATA mostly does not need (derivatives
are already generated in-app / client-side).

## Worked example at JATA's current scale (illustrative, not a quote)

Assumptions: 200 businesses × 20 photos × ~200 KB ≈ **0.8 GB stored**; **100 GB/month**
delivered to phones and storefronts; 50k uploads/year.

| Provider | Storage | Delivery | Ops | ≈ Monthly total |
| --- | --- | --- | --- | --- |
| Vercel Blob (Pro) | $0.02 | within Flat Rate CDN 1 TB, else $5.00 | <$0.01 | **~$0–5** |
| Cloudflare R2 | within free 10 GB | $0 | within free tier | **~$0** |
| Amazon S3 | $0.02 | ~$0–9 (+ CloudFront if used) | <$0.01 | **~$0–9** |
| Cloudinary | exceeds free credits at ~25 GB combined use | — | — | **$0, then $99** |

At 10× that scale Blob delivery would cost ~$50/mo where R2 stays ~$0 — R2 wins on pure
price at large transfer volumes. At today's scale every option is effectively pocket change,
so operational fit decides.

## Fit, security and effort

- **Vercel Blob — recommended.** Same vendor, bill and dashboard as the existing hosting;
  token (`BLOB_READ_WRITE_TOKEN`) is created in the Vercel project and injected as a
  server-side env var; the official `@vercel/blob` SDK maps 1-to-1 onto the existing
  `ObjectStorageProvider.put/remove` contract, so the adapter is small and the already-named
  `vercel-blob` selection in `lib/storage` lights up. Public URLs are unguessable but public:
  correct for storefront media (the app already treats media assets as publishable), never
  for private documents. Writes stay server-only behind the existing auth/tenant/quota
  checks; the token must never reach the browser or the repo.
- **Cloudflare R2 — cheapest at scale.** S3-compatible; needs a separate Cloudflare account,
  bucket, API token (access key pair), a public-access decision (`r2.dev` subdomain or a
  custom domain on Cloudflare DNS) and the S3 SDK in the adapter. More moving parts and a
  second vendor to operate; zero egress only matters once delivery passes ~1 TB/mo.
- **Amazon S3 — most assembly required.** Bucket policy/IAM user, plus CloudFront (or
  accept S3 egress pricing/latency) for sane delivery to Kenyan phones. No advantage over
  Blob at this scale.
- **Cloudinary — not recommended as the system of record.** Excellent transformations, but
  credit pricing turns into a flat $99/mo quickly and storage+bandwidth draw from the same
  pool; could still be reconsidered later purely as a transform CDN in front of Blob/R2.

Tenant isolation does not depend on the vendor: keys are server-built
`tenants/<businessId>/<kind>/<name>` (§ `lib/storage/keys.ts`), the asset store and media
route reject any provider response outside the caller's tenant prefix, and database rows are
scanned so inline image bytes can never be persisted. Per-tenant quotas already exist for
AI generation; upload caps (12 MB/object) and rate limits already apply. A **global storage
ceiling + billing alert** must be set with the budget approval (`STORAGE_DECISION.md` §5).

## Exact owner decision needed

1. **Choose a provider** — recommendation: **Vercel Blob**.
2. **Approve a budget cap** (one-time + monthly) and billing alert threshold — at current
   scale ≈ $0–5/mo expected; a $10–20/mo cap with alerts is a sane starting envelope.
3. **Separately authorize the adapter implementation** (per `STORAGE_DECISION.md` §7.5) —
   a small follow-up PR adding the vendor adapter behind `lib/storage` + its SDK dependency.
4. **Create the credential yourself** in the vendor dashboard (Blob: Storage → create store
   → `BLOB_READ_WRITE_TOKEN` in the Vercel project's env vars, server-side only) and set
   `JATA_STORAGE_PROVIDER=vercel-blob`. Never paste the token into chat or the repo.
5. In the same sitting, if photographic AI generation is wanted: set **one** of
   `OPENAI_API_KEY` / `GEMINI_API_KEY` (server-side). Without it, durable storage alone
   enables uploads, on-phone enhancement saves and the built-in branded artwork saves.

Until steps 1–4 happen, behaviour is unchanged and honest: uploads and generation report
**unavailable** (503), the capability panel says why, and ready category imagery keeps
working. Nothing in this PR's code spends money, creates accounts or stores a single byte.
