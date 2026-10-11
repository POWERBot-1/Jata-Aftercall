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

## 4. Conflicts found, and how they are resolved

Recorded rather than silently decided.

| # | Conflict | Resolution |
| --- | --- | --- |
| C1 | The directive requires the homepage order Monthly 149 → Annual 999 → AI Front Desk 499 → Website Studio 999 → POS 499. `app/page.tsx` orders plan cards by `priceKES asc`, which renders Monthly 149 → AI Front Desk 499 → Annual 999 → Interactive Business 999. The POS is a separate dedicated entry, deliberately excluded from the public plan cards by `PRIVATE_PLAN_KEYS` (documented POS §67 exception, recorded in `BUSINESS_POS_IMPLEMENTATION.md`). `tests/unit/homepage-plan-cards.test.ts` and `tests/unit/homepage-business-pos.test.ts` assert the current behaviour. | **Open — needs an owner decision.** Changing the order is a customer-facing pricing change that contradicts a recorded product decision and two passing test files. Not changed in this work. |
| C2 | The directive says to use "Website Studio" instead of "Interactive Business" in customer-facing areas. 35 occurrences of "Interactive Business" exist across `app/`, `components/`, `lib/`, and the homepage tests assert the literal string `Interactive Business — KES 999/month`. `PlanConfig.name` is operator-editable database text. | **Open — needs an owner decision.** The safe change is display text plus tests together, keeping the `INTERACTIVE_BUSINESS` plan key, `InteractiveBusinessEntitlement` table and existing subscription rows untouched. Not changed in this work. |
| C3 | §21/§3 of the specification name **GSAP** for Motion mode; the mandated installation is **`motion`**. | **Resolved: use `motion` only.** Neither library was present, so nothing is duplicated. GSAP is *not* added — the directive itself forbids two animation systems without a documented reason, and `motion` covers the same preset list plus scroll-driven work. |
| C4 | §3 requires three rendering tiers. `IMPLEMENTED_RENDER_MODES = ["lite", "motion"]` in `lib/experience/renderMode.ts`; requesting `immersive` falls back to `motion`, then `lite`. Visitor-facing 3D additionally needs `JATA_IMMERSIVE_ENABLED` **and** a durable storage provider, neither of which is configured. | **Recorded as not delivered.** Stage 5 is open. The fallback chain is implemented and tested, which is why nothing breaks in the meantime. |

---

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
