# Cloudflare R2 setup — owner runbook (preview first, production separately gated)

**Decision (owner, 2026-10-26):** Cloudflare R2 is the durable media provider, run
free-first. The adapter is implemented (`lib/storage/r2.ts`, selected with
`JATA_STORAGE_PROVIDER=cloudflare-r2`). **Nothing is configured in any environment yet.**
This runbook is the exact sequence of *owner-only* dashboard steps. Credentials are created
by the owner in the Cloudflare/Vercel dashboards and must never be pasted into chat, email,
or Git.

## Billing honesty — read before creating anything

- R2 pricing (developers.cloudflare.com/r2/pricing, re-verified 2026-10-26): Standard
  storage **$0.015/GB-month**, Class A (writes) **$4.50/1M**, Class B (reads) **$0.36/1M**,
  **egress free**. Monthly free tier: **10 GB-month storage + 1M Class A + 10M Class B**.
- The free tier is an **allowance, not a hard spending cap**. If a payment method is on file
  and usage exceeds the allowance, Cloudflare bills the overage at those rates. There is no
  configuration that *guarantees* $0 under all traffic conditions.
- The application enforces its own ceilings before accepting writes (**250 MB per business,
  5 GB global** — `lib/media/storageQuota.ts`), which sit far inside the free storage
  allowance; reads are bounded by normal storefront traffic and egress is free. At pilot
  scale the expected bill is **$0**, but treat that as an expectation to monitor, not a
  guarantee: enable Cloudflare billing/usage notifications (dashboard → Billing) at $1/$5
  thresholds if offered.
- Cloudflare may ask for a payment method/billing profile before R2 can be enabled. Adding
  one is an owner decision; the app's ceilings + the free allowance are what keep the pilot
  at $0 in practice.

## Step 1 — Create the PREVIEW bucket (owner, Cloudflare dashboard)

1. Sign in at dash.cloudflare.com → **R2 Object Storage** → enable R2 if prompted.
2. **Create bucket**: name it `jata-media-preview`. Location: Automatic. Storage class:
   Standard. (Production gets its own bucket later — never share buckets across
   environments.)
3. Bucket → **Settings → Public access**: for the preview pilot, enable the **r2.dev
   subdomain** ("Allow public access" via r2.dev) and copy the public URL, e.g.
   `https://pub-xxxxxxxxxxxxxxxx.r2.dev`. Note: r2.dev is rate-limited and intended for
   development; a custom domain is the production-grade option and part of the later
   production gate.
4. **API Tokens**: R2 → **Manage R2 API Tokens** → **Create API token**:
   - Permissions: **Object Read & Write**
   - Scope: apply to **only** `jata-media-preview`
   - TTL: leave default (or set an expiry you will rotate)
   - Create, then copy **Access Key ID** and **Secret Access Key** (shown once).
5. Copy your **Account ID** (shown on the R2 overview page / dashboard URL).

## Step 2 — Set PREVIEW environment variables (owner, Vercel dashboard)

Vercel → project `jata-aftercall` → Settings → Environment Variables. Add each of these
with environment **Preview only**. Do **not** add them to Production yet.

| Variable | Value |
| --- | --- |
| `JATA_STORAGE_PROVIDER` | `cloudflare-r2` |
| `R2_ACCOUNT_ID` | from step 1.5 |
| `R2_ACCESS_KEY_ID` | from step 1.4 |
| `R2_SECRET_ACCESS_KEY` | from step 1.4 (mark Sensitive) |
| `R2_BUCKET` | `jata-media-preview` |
| `R2_PUBLIC_BASE_URL` | the r2.dev URL from step 1.3 (no trailing slash needed) |

Known platform caveat: this project's **Ignored Build Step** currently skips preview
builds (`production` builds, everything else skips). Preview variables alone therefore do
not produce a testable preview deployment. The owner must explicitly approve a testable preview-build policy or provide another
authorized isolated environment. Mocked/fake-client evidence is not a substitute for a real
preview upload and does not satisfy this release’s acceptance criteria. Do not change the
build setting without explicit owner approval.

## Step 3 — Verify (after Step 2, with previews building)

1. Push to a preview branch (or redeploy) and open the preview deployment.
2. Sign in, open Website Studio → **Create**: the capability panel should now list durable
   storage-backed items as available; **Gallery → upload a photo** should succeed, survive a
   page reload, and the image URL should be on the r2.dev domain.
3. Exercise POS product and category photo upload, display, reload and a fresh authenticated
   session; replace and remove references, and verify the saved state each time. Reference
   removal does not promise object deletion: library assets may be retained.
4. In the Cloudflare dashboard, confirm objects use tenant-scoped keys under
   `tenants/<businessId>/image-original/…`. With separately authorized test accounts, verify
   another business cannot read or attach the first business’s media through the application.
   Public object URLs are deliberately publicly readable and are not private access controls.
5. Check R2 metrics and billing alerts. Do not infer a spending cap from the free allowance.

## Step 4 — Production (SEPARATE owner approval, later)

Production activation is **not** part of the preview steps and needs its own explicit
approval after preview evidence is reviewed:

1. Create a separate bucket `jata-media-production` (+ preferably a **custom domain**
   instead of r2.dev) and a separate API token scoped to only that bucket.
2. Add the same six variables to **Production** with the production values.
3. Redeploy production; repeat the Step 3 checks on the production URL.
4. Rollback = remove `JATA_STORAGE_PROVIDER` (or the R2 variables) from Production and
   redeploy: the app returns to fail-closed honest "unavailable" states; existing media rows
   and category imagery keep working, and objects already in R2 are simply no longer written.

## What the code guarantees regardless of configuration

- No credentials → uploads/generation refuse honestly (503); nothing is faked.
- Tenant-scoped keys, server-side validation, 12 MB/object cap, rate limits, AI quotas,
  250 MB/business + 5 GB global storage ceilings — all enforced before writes.
- Database rows store durable URLs + provenance only, never image bytes.

The offline `npm run release:acceptance` inventory does not connect to R2 and must not
be used as evidence of durable object storage, deletion or cross-session persistence.
