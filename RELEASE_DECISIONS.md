# Release decisions: media storage and sale-price policy

Status: **proposals for owner approval. Nothing in this file is implemented.** No media has been moved or deleted, no
provider has been added, no schema or dependency has changed, and no paid resource has been created.

Scope of the code read: this branch at `685e6e7` (plus the pricing fix in the commit that adds this file).

---

## 1. Media storage: `MediaAsset.url` and inline image data

### 1.1 Where image bytes live today

Image data URLs (`data:image/...;base64,...`) are stored as text in Neon in these places:

| Location | Writer | Notes |
|---|---|---|
| `MediaAsset.url` (`TEXT`) | `POST /api/media` (`app/api/media/route.ts`); AI images via `storeGeneratedImage` (`lib/ai/imageLab.ts`) | The main store. Hash-deduplicated per business. |
| `BusinessExperience.draftJson` and `publishedJson` | Any document save or publish, once a photo is picked (`MediaPicker` sets the document field to `asset.url`) | `safeUrl` (`lib/experience/document.ts`) accepts data-image URLs up to `MAX_STORED_CHARS` = 4,000,000 characters, so a full copy is written into each document. |
| `ExperienceVersion.snapshotJson` | Each publish | One full document copy per published version. Not capped in code. |
| `ExperienceDraftRevision.snapshotJson` | Each draft write | Full document copy. Capped at `DRAFT_HISTORY_LIMIT` = 30 per business. |
| `Product.imageUrl` (and `Service.imageUrl`) | `POST/PATCH /api/products`, `/api/services` through `safeUrl` | Same 4,000,000-character cap. |

Consequence: one photo of about 3 MB can be written into the asset row, the draft, the published copy, each publish
snapshot, and up to 30 history rows. The text is then stored in Neon, which is the store that the release rule says
must not hold binary media. Size of the existing data: **not measured.** Measuring it needs a read-only query, which
needs owner approval (see 1.8).

### 1.2 Readers

- `GET /api/media` returns `url` to the Studio media library. `MediaPicker` renders each one with `<img src={url}>`.
- `lib/studio/studioData.ts` loads `url` for the Studio.
- `lib/ai/imageLab.ts` `loadAssets` returns `url` to the AI photo tools.
- The storefront renders the document's image fields and `Product.imageUrl` in `<img>` tags. The published copy
  (`publishedJson`) is what visitors get.
- Structured data (`lib/experience/structuredData.ts`) and the checkout and booking routes read the published document.

### 1.3 Deletion

`DELETE /api/media` removes the `MediaAsset` row only. It does **not** remove the copies in `draftJson`,
`publishedJson`, version snapshots, history, or `Product.imageUrl`. A deleted asset can therefore still appear on the
site. This is a defect today, separate from the storage question.

### 1.4 Existing records and compatibility

- Two kinds of URL are stored: `data:` URLs (the upload path) and `https://` URLs (the `url` field accepted by
  `POST /api/media`, which is an external hotlink). External links are a separate risk: the business's images are
  loaded from third-party hosts, which can track visitors and can disappear.
- Any migration must keep reading both forms until the backfill is verified.

### 1.5 Proposed provider: Vercel Blob

Why this option: it is the same vendor as the hosting, it is CDN-backed, the SDK authenticates with OIDC on Vercel
(so no long-lived token is needed on Vercel), and the repo's storage interface (`lib/storage/types.ts`, `lib/storage/index.ts`)
already anticipates it. The other candidates in `STORAGE_DECISION.md` (S3-compatible, Cloudinary, Neon Object Storage) are
not evaluated here. Pricing and limits below were re-read from the official Vercel documentation on this turn.

| Item | Value (official docs) |
|---|---|
| Hobby included | 1 GB storage, 10,000 simple operations, 2,000 advanced operations, 10 GB data transfer per month |
| Pro, on demand | $0.023 per GB-month storage; $0.40 per 1M simple operations; $5.00 per 1M advanced operations; $0.05 per GB transfer |
| Simple operation | A blob accessed by URL on a cache MISS, or `head()` |
| Advanced operation | `put()`, `copy()`, `list()`, creating a store, multipart upload parts |
| Free operations | `del()` |
| Hobby over-limit behaviour | Blob access stops until the period resets; the docs say to wait 30 days |
| Max cached blob size | 512 MB (larger blobs miss the cache every time) |

Cost estimate, to be replaced by measurements: a compressed photo of about 300 KB, 500 photos across a business base,
is about 150 MB, well inside the 1 GB Hobby storage. The monthly cost of 10 GB on Pro is about $0.23 for storage. The
real cost driver is transfer and cache misses, which depend on traffic, and we have no traffic data.

**Production risk to decide:** on Hobby, a business that exceeds the included operations or transfer loses its images
for up to a month. That is not acceptable for a paid customer's storefront. A Pro (or a paid Blob) account is therefore
the likely requirement before any customer-facing use.

### 1.6 Security controls required

- **Authorization:** uploads only through `POST /api/media` with a session and `canAccessBusiness` (already the case).
  Business ID comes from the server session check, never from a storage key the client supplies.
- **Tenant isolation:** keys built on the server as `tenants/<businessId>/<kind>/<random>` (`lib/storage/keys.ts`
  already builds this shape). Random suffix so keys are not guessable.
- **Content validation:** sniff bytes (magic numbers), not the declared MIME type (`validateImageBytes` already does
  this). Allow PNG, JPEG, WebP, GIF only. Reject SVG. Enforce `MAX_UPLOAD_BYTES` (5 MB) and dimension limits. Re-encode
  server-side to strip metadata (EXIF location) — this needs a library, so it needs approval (see 1.9).
- **Quotas:** per-business count and byte quota, enforced in the database inside the same transaction as the row
  write. The value is an owner decision.
- **Rate limiting:** on upload, per business and per session.
- **Access mode:** storefront images are shown to visitors, so the public store is the simpler choice (CDN-cached).
  Drafts are then readable by anyone with the URL. If that is not acceptable, use a private store and a proxy, which
  costs function and transfer usage on every view. Owner decision.
- **Deletion:** delete the blob and rewrite references (documents, products, services) in one reconciliation job, so
  a deleted photo disappears from the site. Until that job exists, deletion is refused for any asset that is referenced
  by a published document.
- **Secrets:** on Vercel, the store connected to the project provides `BLOB_STORE_ID` and OIDC (no secret in the repo).
  Outside Vercel, `BLOB_READ_WRITE_TOKEN` is needed and must be stored only in the platform's secret store.

### 1.7 Migration and backfill (after approval)

1. **Measure (read-only):** count rows and bytes of `data:` URLs per table, per business. No writes.
2. **Write path behind a flag:** `JATA_STORAGE_PROVIDER=vercel-blob`. New uploads store a blob, then a `MediaAsset`
   row with the `https` URL. Reads accept both forms (`safeUrl` already accepts `https`; a `data:` URL is still accepted).
   Storage failure returns 503 and writes no row. It must not fall back silently to inline data.
3. **Backfill, per business, idempotent:** for each `data:` asset, upload the bytes, update the row, then rewrite the
   same URL in `draftJson` and `publishedJson` (through a versioned write and a publish, so the normal gates still apply).
   Record each mapping in a table. Dry-run first. Do not touch history or version snapshots directly; they age out (30 revisions) or
   are kept as an audit trail (owner decision).
4. **Verify:** check every rewritten page renders and every image loads, on a non-production database branch first.
5. **Cleanup (only after a verification window the owner sets):** clear the legacy `data:` text from the rows that
   were rewritten. Remove the inline fallback code path only after that.

Owner-approved tests are required for each step: unit tests for key building, sniffing, and quotas; integration tests
with a mocked blob client; and a DB-backed test on a branch. No production data.

### 1.8 Rollback

- Flag off: new uploads go back to the existing path, and reads keep working for both forms.
- Backfilled rows point to `https` blobs. Do not delete blobs during the rollback window, so a rollback keeps images visible.
- Cleanup (step 5) is the only irreversible step. It needs its own approval.

### 1.9 If storage is unavailable

- Uploads: 503 with a clear message. Nothing is partially written.
- Existing pages: images that point to the blob show broken until it recovers. Text and layout still render.
- Publish: not blocked by storage availability, but a publish that includes an unreachable image should warn the owner.
  (Not implemented.)

### 1.10 New dependencies, secrets, and accounts

- **Dependency:** `@vercel/blob` (npm, from `registry.npmjs.org`). Adding it changes `package.json` and the lockfile,
  which needs owner authorization.
- **Image re-encoding** (optional, recommended): a library such as `sharp`. A second dependency, also needs approval.
- **Account:** a Vercel Blob store on the project. Hobby is free but has the cut-off risk above. Pro costs usage.
  No account or store has been created.
- **Secret:** none in the repo. Platform-managed OIDC on Vercel. `BLOB_READ_WRITE_TOKEN` only if used outside Vercel.

### 1.11 Owner decision required (storage)

Approve **one** of:

- **A.** Vercel Blob, public store, Pro (or paid Blob) account, `@vercel/blob` dependency, the migration in 1.7 with
  the measurement step first.
- **B.** Another provider (name it), with the same questions answered.
- **C.** Keep inline storage for now. Accept that Neon holds binary media, that deleted photos can remain on the site, and
  that the release rule in `STORAGE_DECISION.md` is not met. This is not recommended for release.

Also answer: the per-business quota value; whether drafts must be private; and whether to re-encode uploads
(needs a dependency).

---

## 2. Sale-price policy

### 2.1 The conflict

The schema says, at `prisma/schema.prisma` (Product, `salePriceKES`): *"Display/strike-through price;
`basePriceKES` stays authoritative."* The code does not follow that comment. The checkout and some other paths charge
the sale price. The table below is the full map of what each path charges. (Source lines are in the commit history of
this branch.)

| Path | Unit price used | Sale price? | Bulk rule? | Source |
|---|---|---|---|---|
| Storefront checkout (charges the customer) | `unitPriceFor`: variant price, then sale, then base, plus add-ons | **Yes** | No | `lib/experience/pricing.ts` `priceBasket` |
| Storefront display | sale if set; base shown as "was" | **Yes** | — | `lib/experience/storefront.ts` |
| Pre-order route and AI `create_preorder` (changed in `685e6e7`) | `unitPriceFor`, then bulk rule | **Yes** | Yes | `lib/preorder.ts` |
| Member cart route (changed in `685e6e7`) | `unitPriceFor` | **Yes** | No | `app/api/cart/route.ts` |
| AI front-desk order (`createAuthoritativeOrder`) | `basePriceKES ?? variantPriceKES` | **No** | Yes | `lib/order.ts`, `lib/ai-grounding.ts` |
| AI `create_order` tool | `basePriceKES ?? variantPriceKES` | **No** | No | `lib/ai-tools.ts` (around line 298) |
| Conversational cart parse | `basePriceKES ?? variantPriceKES` | **No** | No | `lib/cart.ts` (around line 126) |
| AI knowledge-conflict check | base is "authoritative"; a knowledge document that disagrees is flagged | **No** | — | `lib/ai-business-brain.ts` (around line 45) |
| Schema.org price, publish validation, Studio display | sale if set, else base | **Yes** | — | `lib/experience/structuredData.ts`, `validate.ts`, `lib/studio/studioData.ts` |
| Dashboard product list | base, with "· was <sale>" | label is inverted | — | `components/dashboard/ItemsEditor.tsx` |
| POS till | the POS's own `priceKES` (a separate product model); override needs permission; wholesale at 12+ units | no sale field | POS rule | `lib/pos/sales.ts` |

### 2.2 Mismatches a customer can see

For a product with base KES 1,000 and sale KES 800:

- Storefront checkout charges **800**.
- A pre-order or member cart (after `685e6e7`) charges **800**.
- The AI front desk order, and the conversational cart, charge **1,000**.
- The AI knowledge check treats **1,000** as the true price.
- The Studio and schema.org show **800**, with 1,000 as "was" only in the Studio list.

So the same product can cost two different amounts depending on the channel. In addition:

- **No sale window.** There is no start or end date, so a sale stays on until someone removes it.
- **Inverted label.** The dashboard labels the sale-price field "Was (KES)". Under the storefront rule, the base price is
  the "was" value, not the sale price.
- **Bulk rules** apply to pre-orders and AI orders but not to checkout.
- **POS** is a separate catalogue with its own price field, so an owner who maintains both must keep them in step by hand.

### 2.3 Option A: sale price is authoritative whenever configured

- Matches the customer-facing checkout and the storefront display today.
- Code changes: move `createAuthoritativeOrder`, the `create_order` tool, the conversational cart parse, and the AI
  conflict check to `unitPriceFor`. Correct the schema comment and the dashboard labels.
- Risk: an accidental sale price charges customers less, and nothing expires it. Needs sale dates (a schema change) to be safe.
- Customer effect: AI-created orders and quotes change for any product with a sale price set. Requires owner notice.

### 2.4 Option B: base price is authoritative; sale only under explicit rules

- Matches the schema comment and the AI paths today.
- Code changes: `priceBasket`, the member cart, and pre-orders must stop using sale price unless a rule applies.
  The storefront display must show the base price, with the sale shown only when the rule is active.
- The rule needs fields: a sale flag or price, plus start and end times. Adding them is a schema change and needs approval.
- Customer effect: checkout prices go up for every product that has a sale price today. Requires owner notice and likely a
  pause in promotions.

### 2.5 Recommendation (for approval, not implemented)

Use one rule everywhere: **the sale price applies only when it is set and the current time is inside an explicit window**
(start and end). Outside the window, the base price applies. One helper, `resolveUnitPrice(product, variant, now)`, used
by checkout, pre-orders, cart, AI orders, conversational cart, and the display. Apply bulk rules through one shared
step, and decide whether bulk applies to checkout too.

Why this rule: it matches what customers pay today (sale when set), it stops a forgotten sale from lasting forever, and
it makes the schema comment and the code agree once the comment is rewritten. It needs the window fields (schema change).
Without the window, the nearest safe version is Option A plus a manual "remove sale" action.

Deposits: a pre-order deposit is an owner-entered whole amount between 0 and the server total. It has no per-product rule
and is not derived from price. Receipts and order totals use the unit price stored on each line, so they become consistent
as soon as the paths agree. Checkout takes the payment amount from the server total (`pricing.totalKES`, as read in
`app/api/storefront/checkout/route.ts`). Verify that path end to end on a DB branch before release.

### 2.6 Owner decision required (sale price)

Choose one:

- **A.** Sale price authoritative when set (matches today's checkout). Needs: the code changes in 2.3, a sale-end mechanism.
- **B.** Base price authoritative, sale only under a window. Needs: the schema change for sale windows, the code changes in
  2.4, and owner notice of checkout price changes.
- **C.** Recommended hybrid in 2.5: sale price within an explicit window, one shared helper. Needs: the window fields
  (schema change) and the helper.

Also answer: whether bulk rules apply to storefront checkout; whether POS should follow the same rule or stay separate.

**Until this is decided, the current behaviour stays as it is, except for the two paths changed in `685e6e7`**
(pre-orders and member carts now follow checkout, so they charge the sale price). If the owner chooses B, those two
paths must be reverted.
