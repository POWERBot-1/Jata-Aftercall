# JATA AFTERCALL — Website Studio Release Plan

Scope: the **JATA Immersive Website Engine** upgrade to the existing Website Studio inside
`POWERBot-1/Jata-Aftercall`. Nothing here proposes a new application, a database change of
platform, a VPS, or a paid service. JATA Qi and the M‑PESA branch are untouched.

This file is the baseline audit and the delivery plan. `WEBSITE_STUDIO_RELEASE_REPORT.md` is
the running evidence record. Both are committed with the implementation.

---

## 1. Baseline

| Item | Value | How it was read |
| --- | --- | --- |
| Repository | `https://github.com/POWERBot-1/Jata-Aftercall.git` | `git remote -v` |
| Session branch | `arena/a9a473f2-jata-aftercall` | `git branch -vv` |
| Intended target branch | `main` | confirmed below |
| Baseline HEAD (before any edit) | `77e35cec6a5726f569ab3febd3e7766300b14890` | `git rev-parse HEAD` |
| Remote base branch SHA | `origin/main` = `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` | `git ls-remote origin` |
| Baseline branch remote SHA | `refs/heads/arena/33ebb805-jata-aftercall` = `77e35ce…` (identical to local HEAD) | `git ls-remote origin` |
| Working tree at audit start | clean | `git status --porcelain` (empty) |
| Clone depth | **shallow** at clone time; deepened to 161 commits with `git fetch --deepen 400` so a merge base could be computed | `test -f .git/shallow`, `git rev-list --count HEAD` |
| Merge base vs `origin/main` | `9c36bd1…`; branch was **17 ahead / 0 behind** | `git merge-base`, `git rev-list --left-right --count` |
| Uncommitted work at audit start | none | `git status --porcelain` (empty) |

The 17 unmerged commits on the base branch are prior Website Studio / payment / POS work
(`640dc94 Immersive Website Engine phases 1-3`, `864999b phases 3-5`, `917fe96 storage
decision`, `41bea93 immersive preview`, … `77e35ce safe unpaid-order recovery`). **Prior Arena
work is present in the repository and in GitHub history** — it was not inferred.

### Open pull requests at audit time

| PR | Head | Base | Mergeable |
| --- | --- | --- | --- |
| [#20](https://github.com/POWERBot-1/Jata-Aftercall/pull/20) | `arena/01a0fde9-jata-aftercall` | `main` | **CONFLICTING** |
| [#16](https://github.com/POWERBot-1/Jata-Aftercall/pull/16) | `arena/01a0edb3-jata-aftercall` | `main` | **CONFLICTING** |

Neither is this work. The most recent merged PR is #40 (`arena/01a10b8d-jata-aftercall`,
merged 2026‑10‑05), which is what `origin/main` points at.

### CI

One workflow: `.github/workflows/interactive-business-e2e.yml`. It runs on `pull_request` and
`push` to `main`, provisions Postgres 16, runs `prisma generate`, `prisma migrate deploy`,
`npm run seed`, then the whole vitest suite **with a hard gate that fails the job if anything
skipped** (`grep -E "[1-9][0-9]* skipped"` → exit 1), then the two journey files. It has no
`workflow_dispatch`-triggered requirement on this branch, so required checks for a PR from
`arena/a9a473f2-jata-aftercall` are the PR-triggered run of this workflow.

---

## 2. What already exists and must be preserved

Verified by reading the code, not by assumption.

| Area | Where | State |
| --- | --- | --- |
| Public business site | `app/b/[slug]/**`, `components/storefront/*`, `lib/experience/storefront.ts` | exists |
| Studio editor | `app/dashboard/businesses/[id]/{sections,design,theme,items,photos,preview,orders,bookings,insights}`, `app/dashboard/studio` | exists |
| Studio APIs | `app/api/experience/{route,publish,variant,versions,history,assist}`, `app/api/studio/{copilot,health,ai/{image,enhance,history,status}}` | exists |
| Experience document + validation | `lib/experience/{document,validate,types,sections,themes,color}.ts` | exists |
| Versions, draft revisions, rollback | `ExperienceVersion`, `ExperienceDraftRevision`, `lib/experience/history.ts` | exists |
| Capability detection & render modes | `lib/experience/renderMode.ts`, `components/storefront/RenderModeProbe.tsx` | exists |
| Diversity / anti-similarity | `lib/experience/diversity.ts`, `lib/experience/variant.ts` | exists |
| Design directions | `lib/studio/designDirections.ts` | exists |
| Media upload pipeline | `app/api/media/route.ts`, `lib/media/{browserImage,imageFormat,derivatives,imagePlan}.ts` | exists |
| AI provider abstraction | `lib/ai/provider.ts`, `lib/ai/registry.ts`, `lib/ai/providers/{openai,gemini,local}.ts` | exists |
| Image lab | `lib/ai/imageLab.ts`, `components/dashboard/PhotoLab.tsx` | exists |
| Storage abstraction | `lib/storage/{index,inline,keys,types}.ts` | exists — inline only |
| 3D boundary | `components/storefront/immersive/{ImmersiveStage,ThreeProductViewer}.tsx`, `lib/experience/immersive/policy.ts`, `app/dev/immersive-preview` | exists — gated off |
| Tenant authorisation | `lib/tenant.ts` (`assertBusinessOwnership`, `guardTenantMutation`, `assertBusinessRole`) | exists |
| Publication lifecycle | `lib/publication.ts` (`PUBLISH_REQUIRES_PAYMENT = true`, `hasVerifiedPublicationRight`, `canSetPublished`), `app/api/experience/publish/route.ts` | exists |
| Website Studio entitlement | `lib/experience/entitlement.ts` (`INTERACTIVE_PLAN_KEY = "INTERACTIVE_BUSINESS"`, KES 999 / 30 days) | exists |
| Paystack + M‑Pesa + wallet | `lib/payments/**`, `app/api/paystack/{verify,webhook}`, `app/api/payments/webhooks/**` | exists |
| POS | `lib/pos/**`, `app/api/pos/[businessId]/**`, `app/dashboard/pos/**` | exists |
| AI Business Front Desk / ASK JATA | `lib/ai-front-desk.ts`, `lib/ai-business-brain.ts`, `lib/ai-grounding.ts`, `app/api/ai/**` | exists |
| Test discipline | 157 vitest files, real-Postgres E2E gate | exists |

The Android photo-upload defect described in the directive — *"That image could not be read.
Upload a JPG, PNG or WebP photo."* — is **already fixed on this branch**. `app/api/media/route.ts`
now accepts `body.dataUrl || body.url`, sniffs real bytes with `sniffImageFormat`, parses
dimensions for JPEG/PNG/WebP/GIF, reads EXIF orientation, and the client pipeline in
`lib/media/browserImage.ts` rotates, resizes and re-encodes before upload. Covered by
`tests/integration/mobile-upload-pipeline.test.ts`, `tests/integration/media-route-upload.test.ts`,
`tests/unit/media-*.test.ts`. Do not rebuild it.

---

## 3. Prisma models and migrations

73 models in `prisma/schema.prisma`; **15** migration directories under `prisma/migrations/`
(`20250915000000_init` … `20261010000200_checkout_idempotency`), `provider = "postgresql"`.

Experience/media models already present: `BusinessExperience`, `ExperienceVersion`,
`ExperienceDraftRevision`, `InteractiveBusinessEntitlement`, `MediaAsset`, `AiGeneration`.

**No migration is required for Stage 1–2 work.** `MediaAsset` already carries `width`, `height`,
`bytes`, `hash`, `mime`, `source`, `label`, `aiGenerationId`, `parentAssetId`. Any Stage 4
addition (for example an `ExperienceAsset` variant row) must be additive, must keep existing
columns, and must be run through `prisma migrate deploy` on a preview database first.

**Blocker:** `prisma generate`, `prisma validate` and `prisma migrate deploy` cannot run in this
sandbox — `https://binaries.prisma.sh/...` is outside the allowed host list and the request dies
before TLS. Migration safety is therefore verified by the CI workflow, not locally. Any claim
that migrations passed locally would be false.

---

## 4. Decision register

Each entry records the conflicting evidence, the risk, the decision owner and the exact approval
needed. Nothing here has been changed in code, in tests, in pricing or in the database. Verified
facts are marked **[verified]** with the command or page that produced them; everything else is
marked **[estimate]** or **[unverified]**.

Cross-reference: C1 → Decision A, C2 → Decision B, C3 → resolved (motion only), C4 → Stage 5 open.

### Decision A — Homepage plan order · **AWAITING OWNER APPROVAL**

**Requested order.** Monthly 149 → Annual 999 → AI Business Front Desk 499 → Website Studio 999 →
Business POS 499.

**Recorded decision it appears to conflict with.** [verified] `BUSINESS_POS_IMPLEMENTATION.md` §7,
"Security posture", contains a *Documented exception (product decision, 2026-10-03)*: the public
landing page carries one dedicated **Business POS** entry, and "`publiclyListedPlans()` and
`PRIVATE_PLAN_KEYS` are unchanged, so the plan cards, onboarding picker and AFTERCALL subscription
screens still exclude the private POS plan".

**What the code actually does.** [verified] `app/page.tsx:20` reads plans with
`orderBy: { priceKES: "asc" }`, and the DB-failure fallback at `app/page.tsx:28` sorts by
`priceKES` too. Rendered order today: Monthly 149 → AI Business Front Desk 499 → Annual 999 →
Interactive Business 999. The POS is a **separate `<section>`** rendered after the cards
(`app/page.tsx:148+`), not a plan card.

**Finding that changes the risk assessment.** [verified] Neither `tests/unit/homepage-plan-cards.test.ts`
nor `tests/unit/homepage-business-pos.test.ts` asserts *order*. A grep for order-sensitive patterns
in both files returned only three hits, none of them order assertions
(`not.toMatch(/\b499\b/)`, `not.toMatch(/POS is (now )?(live|active)/i)`,
`toEqual(["/dashboard/pos"])`). Every plan-name assertion is `toContain`. **Reordering the four
plan cards breaks no test.**

**The real conflict is narrower than it looked.** Items 1–4 of the requested order are a pure
presentation change. Item 5 (POS) is *already* rendered after the four cards, which matches the
requested visual order, and moving it into the plan-card grid would be the change that breaks the
recorded §67 decision and two test files.

**Smallest consistent resolution (recommended, not applied).** Add an explicit display order to
`lib/pricing.ts` — e.g. `PLAN_DISPLAY_ORDER = ["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK",
"INTERACTIVE_BUSINESS"]` — and apply it to both the DB path and the fallback path in
`app/page.tsx`, replacing the price-ascending sort. Leave `PRIVATE_PLAN_KEYS`,
`publiclyListedPlans()`, the POS section, every price and the §67 exception untouched. Unknown plan
keys sort after the known ones, preserving today's behaviour for anything an operator adds.

- **Risk.** Low. Customer-facing ordering only; no price, entitlement, checkout or POS change.
- **Decision owner.** Product owner.
- **Exact approval needed.** "Apply `PLAN_DISPLAY_ORDER` Monthly → Annual → AI Business Front Desk
  → Website Studio to the public plan cards; keep Business POS as its own entry after them."

### Decision B — "Interactive Business" → "Website Studio" · **AWAITING OWNER APPROVAL**

**All 35 occurrences classified line by line.** [verified, `grep -rn "Interactive Business" app components lib`]

| Class | Count | Where |
| --- | --- | --- |
| Comment / JSDoc only — no user-visible effect | **20** | `app/api/checkout/route.ts:39`, `app/api/offer/route.ts:19`, `app/b/[slug]/page.tsx:61,95`, `app/dashboard/page.tsx:33`, `app/page.tsx:27`, `components/DashboardClient.tsx:35`, `components/OnboardingForm.tsx:29`, `lib/ai/quota.ts:8`, `lib/analytics.ts:19`, `lib/experience/entitlement.ts:2`, `lib/experience/types.ts:2`, `lib/nextAction.ts:12,28,49`, `lib/pos/entitlement.ts:9`, `lib/pricing.ts:46,108`, `lib/statusLabels.ts:30`, `lib/validation.ts:28` |
| Customer-facing copy | **12** | `components/dashboard/EntitlementBanner.tsx:26`, `components/dashboard/PublishPanel.tsx:127`, `components/dashboard/WebsiteHealth.tsx:233`, `lib/ai/quota.ts:37` (quota label), `lib/experience/entitlement.ts:54,61,71,87`, `lib/experience/validate.ts:185` (publication checklist item), `lib/nextAction.ts:58` (action title), `lib/statusLabels.ts:55` (help text), `lib/studio/copilot.ts:436` |
| Developer-facing error text | **2** | `app/api/checkout/route.ts:42` (500 JSON), `lib/pricing.ts:117` (`throw new Error`) |
| Canonical display name | **1** | `lib/pricing.ts:139` — `FALLBACK_PLANS` entry `name: "Interactive Business — KES 999/month"` |

Separately, the **internal identifier** `INTERACTIVE_BUSINESS` appears **27 times** [verified] —
plan key, `InteractiveBusinessEntitlement.packageKey`, analytics and API contracts. **None of
these may change**: subscriptions, entitlements and payment records reference the key.

**Critical finding that makes a code-only rename ineffective.** [verified, `lib/pricing.ts:50-56`]
`planDisplayName()` returns the **stored** `PlanConfig.name` whenever it is present and free of
`U+FFFD`, and falls back to `FALLBACK_PLANS` only when the stored name is corrupt or blank. So if
the production `PlanConfig` row holds a healthy `"Interactive Business — KES 999/month"`, changing
the code fallback alone will **not** change the homepage. Two ways forward:

1. **Update the database row** — requires approval, and `PlanConfig.name` is operator-editable
   text, so it is production data. **The current stored values cannot be inspected from this
   environment** (no `DATABASE_URL`, no PostgreSQL, Prisma binaries unreachable).
2. **Invert the precedence** so the canonical name wins for known plan keys — code-only, but it
   makes JATA override operator-editable plan names, which is itself a policy change.

**Tests asserting the literal string.** [verified, `grep -rn "Interactive Business" tests/`]
`tests/unit/homepage-plan-cards.test.ts` (lines 4, 45, 63, 69, 81),
`tests/unit/homepage-business-pos.test.ts` (28, 83), plus references in
`tests/e2e/interactive-business-journey.test.ts`, `tests/integration/experience-publish.test.ts`,
`tests/integration/ai-front-desk-order-stage-transitions.test.ts`,
`tests/security/experience-tenant-isolation.test.ts`, `tests/unit/experience-categories.test.ts`,
`tests/unit/experience-operations.test.ts`, `tests/unit/repair-guards.test.ts`.

**Compatibility-safe change plan (recommended, not applied).**

1. Introduce one label constant (e.g. `WEBSITE_STUDIO_LABEL = "Website Studio"`) and use it in the
   **12** customer-facing strings and in the `FALLBACK_PLANS` display name.
2. Leave the 20 comments alone in this change — they are internal and rewording them adds diff
   noise to a customer-facing change. Optionally a follow-up.
3. Preserve every `INTERACTIVE_BUSINESS` identifier, `InteractiveBusinessEntitlement`,
   `packageKey`, analytics event names and API field names. **No migration.**
4. Decide option 1 or 2 above for `PlanConfig.name` and record it here before touching anything.
5. Update only the tests whose expected string is intentionally changing, and say so in the commit.

- **Risk.** Medium. Customer-facing pricing copy, plus either a production data change or a
  precedence change over operator-editable text.
- **Decision owner.** Product owner.
- **Exact approval needed.** (a) rename the 12 customer-facing strings and the fallback display
  name to "Website Studio"; (b) choose DB-row update **or** canonical-precedence for
  `PlanConfig.name`; (c) confirm `INTERACTIVE_BUSINESS` identifiers stay.

### Decision C — Persistent object storage · **AWAITING OWNER APPROVAL**

`STORAGE_DECISION.md` §7.5 lists five open decisions. Current state verified in code:
[verified] `lib/storage/index.ts` implements only `inline-data-url`; `vercel-blob` throws
`StorageNotConfiguredError`. `assertCanStore` has **no production call site** — grep finds only its
definition and `tests/unit/storage-provider.test.ts`. `resolveStorageProvider` is called only from
`lib/experience/immersive/policy.ts`, never from the upload path. So the storage contract exists
and nothing in production writes through it.

**Verified pricing and limits** — from Vercel's official page
`https://vercel.com/docs/vercel-blob/usage-and-pricing`, fetched 2026-10-11:

| Resource | Hobby included | On-demand rate |
| --- | --- | --- |
| Blob Storage Size | **1 GB / month** | $0.023 per GB |
| Blob Simple Operations | **first 10,000** | $0.400 per 1M |
| Blob Advanced Operations | **first 2,000** | $5.000 per 1M |
| Blob Data Transfer | **first 10 GB** | $0.050 per GB |

These **confirm `STORAGE_DECISION.md` §4 exactly**. A widely-circulated blog figure of "500 MB
storage / 1 GB egress" for Hobby is **wrong** and should not be relied on.

Also verified on the same and the sibling docs page (`/docs/vercel-blob`):

- Blob is available on **all plans**, including Hobby.
- **Hobby hard-stops rather than bills**: "you will not be able to access Vercel Blob if limits are
  exceeded… you will have to wait until 30 days have passed." For a paid product this is an
  availability risk, not a cost risk.
- Maximum blob size **in cache is 512 MB**; anything larger is a cache MISS on every access.
- **Private vs public store is chosen at creation and cannot be changed afterwards.** Private reads
  require a token and stream through a Function; public reads are direct blob URLs.
- **Authentication is now OIDC by default** — connecting a store injects `BLOB_STORE_ID`,
  `VERCEL_OIDC_TOKEN` and `BLOB_WEBHOOK_PUBLIC_KEY`. `BLOB_READ_WRITE_TOKEN` is only needed for
  code running outside Vercel or for browser client uploads. **This supersedes
  `STORAGE_DECISION.md` §7.1, which names `BLOB_READ_WRITE_TOKEN` as the expected secret.**
- Client (browser) uploads incur **no** data-transfer charge; server uploads incur Fast Data
  Transfer. Blob Data Transfer is described as ~3× more cost-efficient than Fast Data Transfer.
- `del()` is free. Browsing the store in the dashboard counts as Advanced Operations.
- The region list includes **Cape Town, South Africa (cpt1)** — the nearest listed region to Kenya.
  There is no Nairobi region. [verified from the region selector on the pricing page]

**Options compared.**

| Option | Fits existing stack | Persistence + delivery | Kenyan Android upload | Tenant isolation | Cost / growth | Credentials | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Vercel Blob (recommended)** | Same vendor as hosting; SDK-only, no infra | Durable + CDN; public store serves direct URLs | Client uploads avoid transfer charges; resumable SDK | All writes authenticated; key prefix `tenants/<businessId>/…` already implemented in `lib/storage/keys.ts` | 1 GB free then $0.023/GB-mo; **unbounded** usage billing on Pro; Hobby hard-stops | OIDC automatic on Vercel — **no long-lived secret to manage** | Small: one adapter behind the existing interface |
| S3-compatible (R2, Wasabi, …) | Second vendor, own credentials and SDK | Durable + CDN | Equivalent | Same | **[estimate]** generally cheaper egress | Access key + secret, long-lived | Medium |
| Neon (rejected) | — | **Violates the hard rule**: no binary media in Neon | — | — | — | — | — |
| Vercel filesystem (rejected) | — | Ephemeral; lost on cold start | — | — | — | — | — |

**Recommendation.** Vercel Blob. Create **one public store** for published website imagery — that
content is public by definition, and a public store serves it straight from the CDN, which is what
a Kenyan Android visitor needs. A **private** store would force every image through a Function,
adding invocation and Fast Data Transfer cost to every page view; choose it only if the owner wants
unpublished originals withheld from anyone holding the URL. **This choice is irreversible**, so it
is an owner decision, not an engineering default.

**Setup link.** https://vercel.com/dashboard → Storage → Create Database/Blob store; then connect
the store to the project (this injects the OIDC variables automatically) and
`npm install @vercel/blob`.

**What is *not* verified.** No upload or retrieval has been performed. **Storage does not work
until a real put/get round-trip passes** — that is the acceptance test, and it cannot run without
the owner creating the store.

**Exact approval needed.** (1) approve Vercel Blob as the durable store; (2) choose **public** or
**private** store access mode (irreversible); (3) create the store and connect it to the Vercel
project; (4) set a monthly spend ceiling and a per-tenant upload quota before the first real
upload; (5) approve when 3D (`JATA_IMMERSIVE_ENABLED`) may be switched on — a separate decision.

### Decision D — AI image-generation provider · **AWAITING OWNER APPROVAL**

**The abstraction already exists.** [verified] `lib/ai/registry.ts` resolves
`JATA_AI_IMAGE_PROVIDER = auto | openai | gemini | jata-local`; `auto` prefers a configured vendor
and **always falls back to the built-in `jata-local` provider**, so a deployment with no key still
works. Adapters: `lib/ai/providers/openai.ts` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`,
`OPENAI_IMAGE_MODEL`, default `gpt-image-1`) and `lib/ai/providers/gemini.ts` (`GEMINI_API_KEY` or
`GOOGLE_API_KEY`, `GEMINI_IMAGE_MODEL`, default `gemini-2.5-flash-image`, `GEMINI_TEXT_MODEL`).
Interface: `lib/ai/provider.ts` (`AiProvider`, `ImageRequest`, `EnhanceRequest`,
`providerErrorMessage`). **No new provider code is needed to add a vendor.**

**Recommendation: Gemini**, through the existing adapter, because the key name and model override
are already wired and documented in `.env.example`.

- **Setup link.** https://aistudio.google.com/apikey
- **Free tier — do not assume one exists.** [verified] A Google-hosted developer-forum answer
  states plainly that "`gemini-2.5-flash-image` … is not available for use on the Free Tier",
  citing Google's pricing page. Third-party blogs claiming ~500 free images/day **contradict**
  this. Treat image generation as **paid** until a real key proves otherwise.
- **The configured default model is on an older generation.** [verified] Google's official pricing
  page lists the current image line-up as `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`
  (Nano Banana 2), `gemini-3.1-flash-lite-image` and `gemini-3-pro-image`; `gemini-2.5-flash-image`
  is still listed. Set `GEMINI_IMAGE_MODEL` to a current model — `gemini-3.1-flash-lite-image` for
  cost, or `gemini-nano-banana-2.1` for quality — rather than shipping the 2.5 default.
- **[unverified]** Third-party claims of shutdown dates for `gemini-2.5-flash-image`. Not relied on;
  the owner should confirm against https://ai.google.dev/gemini-api/docs/pricing.
- **Cost.** **[estimate]** Third-party sources quote roughly $0.039 per image for the 2.5 Flash
  Image model. Not verified against Google's page in this session. Assume paid, metered usage; the
  existing `AiGeneration`-backed quota in `lib/ai/quota.ts` is the cost control.
- **Test vs production credentials.** Separate Google Cloud project and separate API key for test;
  set `GEMINI_API_KEY` per Vercel environment (Preview vs Production) so a test key can never reach
  production. `.gitignore` already excludes `.env*` except `.env.example`; no key is committed.
- **Safe validation test (the acceptance gate, not yet run).** A script that resolves the provider
  through `lib/ai/registry.ts`, issues **one** generation against a throwaway business id, asserts
  a non-empty raster with sane dimensions, asserts the `AiGeneration` row moves
  `PENDING → SUCCEEDED`, and deletes what it created. It must read the key from the environment
  only and must never log it. No such test has been executed, so **image generation is not claimed
  to work.**

**Exact approval needed.** Create a Gemini API key, confirm billing is linked, set
`GEMINI_API_KEY` and `GEMINI_IMAGE_MODEL` in the Vercel Preview environment, then authorise the
single-call validation run.

### Decision E — Pull request · **AUTHORIZED, PR OPENED**

[verified] `gh auth status` → logged in as `POWERBot-1` via `GH_TOKEN`.
[verified] `gh api repos/POWERBot-1/Jata-Aftercall` →
`permissions: { admin: true, maintain: true, push: true, pull: true, triage: true }`. Opening a PR
from this branch is authorized.
[verified] `gh pr list --head arena/a9a473f2-jata-aftercall` → `[]` before this change; no
duplicate PR existed.
[verified] Ancestry: `git rev-list --left-right --count origin/main...HEAD` → **0 behind, 20
ahead**, so the branch contains all of `main` and the diff is a clean fast-forward shape.

**Gate that could not be read.** [verified] `gh api repos/…/branches/main/protection` returns
**403 "Resource not accessible by integration"** — this token lacks the scope to read branch
protection. **Whether `main` has required status checks, and what they are, is therefore
unverified.** The CI workflow in the repository triggers on `pull_request` to `main`, so a run
should appear on the PR; its result is recorded in the release report once visible.

**Consequence.** A PR may be opened. It must **not** be merged while required checks are
unverifiable and while Decisions A–D remain open. Release status stays **BLOCKED**.

## 5. Release blockers

| # | Blocker | Blocks | What unblocks it |
| --- | --- | --- | --- |
| B1 | No durable object-storage provider. `lib/storage/index.ts` implements only `inline-data-url`; `vercel-blob` throws `StorageNotConfiguredError`. `STORAGE_DECISION.md` §7.5 lists five owner decisions still outstanding. | Stage 4 (persistent derivatives, originals out of the draft JSON), Stage 5 (any GLB upload) | Owner approves a provider, creates the secret, sets a spend ceiling and a per-tenant quota |
| B2 | No AI image provider key configured. Adapters fail closed to the deterministic `jata-local` provider, which renders real PNGs and labels them JATA artwork, not photography. | Stage 4 "image generation / enhancement actually works" | Owner supplies `OPENAI_API_KEY` or `GEMINI_API_KEY` in the Vercel environment |
| B3 | `binaries.prisma.sh` unreachable from the sandbox | Local `prisma generate` / `validate` / `migrate deploy` | CI, or a host with access to the Prisma binary CDN |
| B4 | No Chrome/Chromium binary in the sandbox (`command -v` finds none; no puppeteer or playwright cache) | `scripts/browser/*.check.mjs`, real-device and responsive validation | `CHROME_PATH` on a host that has one |
| B5 | No PostgreSQL in the sandbox | The 94 DB-gated tests and both E2E journeys | CI's Postgres 16 service, or a local Postgres |
| B6 | PRs #20 and #16 are `CONFLICTING` against `main` | A clean merge of *this* branch is unaffected, but the repo carries unresolved heads | Their authors rebase or close them |

---

## 6. Delivery stages

Status of each stage as at the baseline SHA. "Delivered" means the code path exists **and** was
executed by a named test.

### Stage 1 — Foundation and Lite renderer — **delivered before this work**
`lib/experience/{types,document,validate}.ts` (safe configuration, never executable JS),
`ExperienceVersion` + `ExperienceDraftRevision` + `historyCursor` (versions and rollback),
`lib/experience/renderMode.ts` (capability scoring, configurable thresholds, Lite/Motion),
`app/api/experience/publish` + `lib/publication.ts` (publication gate), `app/b/[slug]` SSR.
Tests: `experience-schema-compat`, `experience-document`, `experience-render-mode`,
`experience-publish`, `experience-version-guard`, `publication-gate`, `immersive-policy`.

### Stage 2 — Motion engine — **delivered in this work**
`lib/experience/motion.ts`, `components/storefront/motion/{MotionEngineMount,MotionRuntime}`,
`MotionReveal` upgrade, CSS fallback in `app/globals.css`, `motion` 14.1.0 installed.
Touch-first: the hover-only `magnetic` recipe is bound to the button and skipped without a fine
pointer; `parallax` / `image-pan` are scroll-linked, not frame loops, and are dropped on
low-power devices. Reduced motion and Save-Data refuse the download outright.
Tests: `tests/unit/motion-engine.test.ts` (29).

### Stage 3 — AI art direction and diversity — **partially delivered, pre-existing**
`lib/studio/designDirections.ts`, `lib/experience/diversity.ts` (fingerprint + weighted
similarity, threshold 0.85), `lib/experience/variant.ts` (seeded variants,
`generateGatedVariant`, regeneration seeds). Deterministic seeding exists and is now also used
by the motion layer via `lib/experience/seed.ts`.
**Still open:** category-aware *photography* direction is a string on the document
(`photographyStyle`), not a model-backed art direction; there is no `ExperienceQualityScore`
(§85) and no `ImageQualityScore` (§86); `AiGeneration` stores `promptHash` but there is no
cross-experience similarity check across *tenants* by design (§95 privacy), so §9's
anti-similarity gate currently runs within one business's own history only.

### Stage 4 — Image Studio — **partially delivered**
Upload, validation, orientation, resize, re-encode, derivatives planning, media library,
provider abstraction, quota, provenance and accept/reject are implemented and tested.
**Blocked:** persistent object storage (B1) and a real image provider (B2).

### Stage 5 — Immersive engine — **boundary delivered, engine off**
`ImmersiveStage` + `ThreeProductViewer` (the only `three` importer), lazy, static-image-first,
never blank. `lib/experience/immersive/policy.ts` gates on a durable provider and a feature
flag. Draco / Meshopt / KTX2 decoders are **not** wired; only uncompressed GLB is accepted.
WebGPU is detected for scoring only — there is no WebGPU render path.

### Stage 6 — Commerce and ASK JATA — **delivered, pre-existing**
`lib/experience/{orders,booking,payments,pricing}.ts`, `app/api/storefront/**`, `ActionBar`,
`CartProvider`, `CheckoutClient`; ASK JATA grounded in tenant data by `lib/ai-grounding.ts` and
`lib/ai-public-products.ts`. Server-side payment verification in `lib/paymentVerification.ts`
and `lib/payments/**`. No payment logic was added to visual components.

### Stage 7 — Adaptive performance and analytics — **partially delivered**
`lib/analytics.ts`, `lib/experience/insights.ts`, `lib/interactionEvent.ts`, and the mode/plan
diagnostic attributes now written to `<html>` (`data-render-mode`, `data-motion-plan`,
`data-motion-engine`). **Open:** measured telemetry for asset load time, 3D init and fallback
rate (§57), and learning from previous-session performance (§58). Mode selection is
signal-based, never device-name based, and thresholds are configurable — that part of §4/§7 is
satisfied.

---

## 7. Acceptance tests

How each item in §7 of the directive is (or is not) covered.

| Requirement | Command | State |
| --- | --- | --- |
| Lint | `npm run lint` | **PASS** locally — one pre-existing warning in `CartProvider.tsx:210` |
| TypeScript | `npm run typecheck` | **PASS** locally, exit 0 |
| Unit + integration + security | `npx vitest run` | **1769 passed, 94 skipped** locally; the skips are the DB-gated suites, which run in CI |
| Production build | `npx next build` | **PASS** locally, exit 0 |
| Prisma schema validation | `npx prisma validate` | **BLOCKED** (B3) |
| Migration safety | `prisma migrate deploy` | **BLOCKED locally** (B3); no migration added by this work |
| Auth + tenant isolation | `tests/security/*.test.ts` | pass locally where not DB-gated; full run in CI |
| Experience schema + rendering | `tests/unit/experience-*.test.ts` | **PASS** |
| Lite / Motion / fallback | `tests/unit/experience-render-mode.test.ts`, `tests/unit/motion-engine.test.ts`, `tests/unit/immersive-policy.test.ts`, `tests/unit/immersive-boundary.test.ts` | **PASS** |
| Immersive in a browser | `npm run test:browser:immersive` | **NOT RUN** (B4) |
| Motion in a browser | `npm run test:browser:motion` | **NOT RUN** (B4) — script added, exits 2 without `CHROME_PATH` |
| Android upload, validation, orientation | `tests/integration/mobile-upload-pipeline.test.ts`, `tests/unit/media-*.test.ts` | **PASS** (contract level); no physical device |
| AI generation / invalid AI / provider failure | `tests/unit/studio-ai-safety.test.ts`, `tests/integration/studio-image-lab.test.ts` | **PASS** against the local provider; real vendor **NOT exercised** (B2) |
| Asset authorisation + storage | `tests/unit/storage-provider.test.ts`, `tests/integration/media-route-upload.test.ts` | **PASS**; durable provider **NOT verified** (B1) |
| Preview isolation, publish gates, entitlement, rollback | `tests/integration/experience-publish.test.ts`, `tests/unit/publication-gate.test.ts`, `tests/security/publication-access.test.ts`, `tests/integration/studio-history-branching.test.ts` | pass locally where not DB-gated; full run in CI |
| ASK JATA accuracy against tenant data | `tests/unit/ai-grounding-and-safety.test.ts`, `tests/unit/ai-public-pricing.test.ts`, `tests/security/ai-front-desk-tenant-isolation.test.ts` | **PASS** |
| WhatsApp / Call / Directions / Order / Booking / payment | `tests/integration/storefront-*.test.ts`, `tests/e2e/interactive-business-journey.test.ts` | E2E **only in CI** (B5) |
| POS regression | `tests/integration/pos-*.test.ts`, `tests/e2e/business-pos-journey.test.ts` | local where not DB-gated; E2E **only in CI** |
| Responsive / low-end Android | — | **NOT RUN** (B4). Low-power behaviour is covered at the decision layer only. |
| GitHub Actions | `.github/workflows/interactive-business-e2e.yml` | runs on PR; result recorded in the release report |

No test was weakened to reach a green result. The 94 skips are the pre-existing DB-gated suites
plus the two journeys; CI's own gate fails the job if anything skips.

---

## 8. Guardrails carried into every stage

- AI produces **validated configuration**, never production code. `lib/experience/validate.ts`
  is the gate; nothing executes AI-emitted JavaScript or SQL.
- Version history and rollback are preserved: every draft write goes through the Studio write
  path and records an `ExperienceDraftRevision`; publishing snapshots an `ExperienceVersion`.
- Core business content stays crawlable HTML. The server render is complete without scripts;
  motion and 3D only upgrade it.
- Immersive and motion failures must never produce a blank page. For motion this is now a
  hard guarantee in CSS plus a 4‑second safety restore in the runtime.
- Images: originals preserved, metadata in Neon, binaries never in Neon.
- Tenant isolation server-side on every relevant route; no client-supplied identifier is
  trusted.
- Lifecycle `CHOOSE → EDIT → PREVIEW → PAY → VERIFY → PUBLISH → LIVE` is unchanged, and
  `PUBLISH_REQUIRES_PAYMENT` remains `true`.
- Sale-price, cancellation, refund and entitlement policies are unchanged.
