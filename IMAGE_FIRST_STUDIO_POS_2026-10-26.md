# JATA AFTERCALL — Image-first Website Studio + POS (2026-10-26)

Audit → Implement → Test → Pull Request. **Not merged, not deployed.** No database
migration, no billing/price change, no production setting was touched.

- Starting branch: `arena/80817e31-jata-aftercall`
- Starting SHA: `5f4a82dfffbcd28c1108fd729833b367656bc324` (tip of `main`, PR #66 merge)
- Final branch/SHA/PR: see the pull request description (this file ships in that PR).

## 1. Root causes found in the audit

1. **Only ~8 distinct pictures existed for every business kind.** `lib/workspaceImagery`
   mapped electronics, fashion and retail to the *same* shop photo; education, creative
   and professional to the same desk; furniture and hospitality to the same interior;
   technical and automotive to the same workshop. There were no pharmacy, hardware,
   transport, agriculture, grocery or salon-distinct images at all, even though the two
   real registries define 16 Website Studio categories (`lib/experience/categories`) and
   56 POS business types (`lib/pos/businessTypes`).
2. **There is no durable media storage in this deployment — by an earlier, deliberate
   decision** (`STORAGE_DECISION.md`, `lib/media/persistence-policy`). New image bytes
   are refused (503) rather than written inline into Neon. Consequences that owners felt:
   phone uploads cannot be kept, and Studio image generation/enhancement
   (`lib/ai/imageLab`) fail-closes with the storage message even though the provider
   abstraction (OpenAI/Gemini/built-in artwork, quotas, provenance, caching) is fully
   built. This change preserves that safety decision and makes the product explain it.
3. **POS had no visual identity of its own**: a plain text header, no category imagery,
   and no persisted place for an owner's preferred header image.
4. **The creative tools existed but were fragmented** (Photo Lab presets behind buttons)
   with no single command field, no speech input, and no truthful capability surface —
   so "animation/video" could be implied by copy but never delivered.

## 2. What was built

### Category imagery (Phases 2 + 5)
- **9 new AI-generated category illustrations** created for JATA under
  `public/category/` (electronics, fashion, pharmacy, hardware, transport, agriculture,
  furniture, education, creative), each in 720/1200 px WebP+JPEG at ~40–90 KB for
  phones. Kenyan/East African settings; pharmacy imagery is clean and unbranded with no
  health claims. They are **labelled "AI-made illustration" everywhere** and never
  presented as photos of a real business. (Image generation hit its per-session cap
  before salon/technical/grocery-specific images; salon shares the existing
  beauty-studio photograph — which depicts a salon — grocery uses fresh-produce, and
  technical services use hardware. Adding those three files later is a registry-only
  change.)
- **`lib/categoryImagery.ts`**: one registry of 18 visual worlds with honest alt text,
  provenance, dimensions, focal points and responsive srcsets; mappings for all 16
  experience categories and all 56 POS types; free-text resolution ("Mama mboga",
  "Agrovet", "Boda delivery", …); a safe produce fallback. It is a static string table
  (no giant-registry imports shipped to phones); coverage of the real registries is
  enforced by tests. `lib/workspaceImagery` now derives from it, so dashboard, Studio
  and POS cannot drift.
- **`components/media/CategoryImagePicker.tsx`**: reusable visual chooser — large
  preview, Phone/Desktop crop switch, focal (crop) repositioning with keyboard-friendly
  sliders, large starter-gallery cards (suggested first), Use / Change / Restore /
  Remove / Upload / Generate actions, loading, broken-image and honest error states.

### Website Studio (Phases 2–4)
- **Studio home** now leads with the business's actual opening image (or its labelled
  suggested image), large, with Create / Change image / Preview actions.
- **Photos → “Gallery” tab** gains the opening-image panel (`HeroImagePanel`): choices
  persist to the draft document's `brand.heroImageUrl` through the existing versioned,
  tenant-scoped `PATCH /api/experience` (409-safe, publishes nothing by itself).
- **Hero focal point** (`brand.heroFocalX/Y`) persists inside the existing document JSON
  — no schema migration — is clamped/validated, and the storefront applies it as
  `object-position`, so crop/reposition survives refresh and publication.
- **Navigation** gains Create (Home · Canvas · Website · **Create** · Products ·
  Gallery · Design · Brand · …) with Purposes and Icons; nothing working was removed,
  and plan/entitlement state stays visible.

### Creative engine (Phase 3)
- **`lib/creative/intent.ts`**: pure instruction understanding (typed or spoken) →
  media type, aspect (WhatsApp Status = vertical), existing Studio preset, edit
  operations, follow-up detection ("make it brighter"), and at most one essential
  follow-up question.
- **`lib/creative/capabilities.ts`**: the truth table, derived from the provider
  registry and the storage decision. Today it reports: starter gallery **available**;
  image generation / AI editing / uploads **unavailable** (no durable storage — the
  exact blocker, named); on-phone improvement + speech **browser-dependent**;
  animation/video **unavailable** (no provider adapter). The built-in provider is never
  described as photographic.
- **`POST /api/studio/creative`**: authenticated, `configure`-guarded, rate-limited
  (12/min). Parses intent on the server; returns `needs-input | unsupported |
  unavailable (503) | completed | failed`. Supported image/edit intents delegate to the
  existing `generateStudioImages`/`enhanceStudioImage` (same quota, caching, provenance
  and tenant re-reads) — which themselves fail closed until a storage adapter is
  registered. **No placeholder asset can ever be returned as a result.**
- **Create page** (`/dashboard/businesses/[id]/create`): one command field with "JATA
  understands…" feedback, media-type chips, speech input (Web Speech API feature
  detection with permission-error messaging), reference-photo picker (originals kept),
  progress, results, regenerate, example commands, and the live capability list.

### POS (Phase 5)
- **Category header image** in the POS shell: the owner's saved choice or the suggested
  image for their trade; short banner, width-responsive, lazy, removes itself on error,
  **auto-collapses to a slim strip on the Sell screen** and can be collapsed by hand.
- **Persistence without trading impact**: `presentation` inside the existing
  `PosConfiguration` JSON (no migration), sanitized (site-relative/https only, never
  inline bytes), carried across questionnaire rebuilds, written to draft *and*
  published JSON by `savePosPresentation`, **excluded from the configuration
  fingerprint** (proved by test), audited as `POS_HEADER_IMAGE_UPDATED`.
- **`GET/POST /api/pos/[businessId]/presentation`**: POS route-kit authorization
  (`EDIT_CONFIGURATION` for writes); a non-empty URL must be a starter-gallery image, a
  media asset **owned by this business**, or the business's own cover/logo — another
  tenant's media is refused.
- **Settings** gains the image picker for the POS header. Sales, cart, checkout, money,
  offline queue and sync code are untouched.

### Review surface
- **`/dev/category-gallery`** (development-only, `notFound()` in production): renders
  the real picker, POS headers and intent reading with no login/DB, for owner review at
  phone and desktop widths.

## 3. Provider / storage dependencies and owner actions (blockers)

| Capability | State | Owner action required |
|---|---|---|
| Ready category images, POS header, hero/focal persistence | **Works now** | None |
| AI image/poster generation, AI photo editing, photo uploads | Blocked: **no durable media storage approved** (`STORAGE_DECISION.md`; Vercel Blob was evaluated, not enabled) | Approve a storage provider, then a small follow-up registers the adapter + sets `JATA_STORAGE_PROVIDER`. Cost: storage pricing is usage-based; verify current vendor pricing at approval time — no number is asserted here because it was not verifiable in this sandbox. |
| Photographic (vs built-in artwork) generation | Needs a vendor key | Set `OPENAI_API_KEY` or `GEMINI_API_KEY` server-side (existing env vars). Per-image vendor charges apply; quotas already exist in `lib/ai/quota.ts`. |
| Animation / video adverts | No provider adapter exists | Choose a video provider and agree its per-video cost; implement behind the same registry. UI already routes these requests to a vertical-poster suggestion instead of faking output. |
| Speech input | Browser-dependent | None — works in speech-capable browsers (e.g. Chrome/Android), typed fallback everywhere. |
| 3 more category photos (salon-specific, technical-services, grocery/minimart) | Wanted | One image-generation session; registry-only change afterwards. |

## 4. Acceptance matrix

### Visual experience
- [x] **PASS** — Website Studio displays relevant images for supported categories —
  `category-imagery.test.ts` asserts all 16 profiles resolve to existing, distinct
  files; preview route renders them.
- [x] **PASS** — POS displays relevant images for supported categories — all 56 POS
  types asserted; header renders from the trade registry.
- [x] **PASS** — Uncategorized businesses receive a sensible fallback (fresh produce),
  never a broken image.
- [x] **PASS (starter/gallery)** / **BLOCKED (new uploads)** — select, replace and
  restore persist for register/gallery images on both plans. Uploading *binary* photos
  still cannot be kept until durable storage is approved (server truthfully 503s;
  the UI now surfaces that message instead of failing silently).
- [x] **PASS** — Image choices persist after refresh/login: website hero+focal in the
  versioned draft document; POS header in `PosConfiguration` JSON (round-trip tested).
- [x] **PASS** — Mobile and desktop previews work (picker Phone/Desktop switch; existing
  Studio preview unchanged).
- [x] **PASS (code) / NOT TESTED (device)** — small-screen layout: responsive grids,
  compact POS header tested by code; on-device Android verification needs a device.

### Creative engine
- [ ] **BLOCKED** — text instructions produce a real generated result: provider path is
  complete but storage blocks persistence (above). Endpoint returns truthful
  `unavailable` 503 before any provider call.
- [x] **PASS (code) / NOT TESTED (device mic)** — speech input is feature-detected with
  permission/error handling.
- [x] **PASS** — uploaded-image editing operations exist on-device (existing Photo Lab)
  and AI editing delegates to the provider path; originals are never overwritten
  (existing enhance tests + intent contract).
- [ ] **BLOCKED** — animation/video output: no provider; clearly identified as
  unsupported with a poster alternative.
- [x] **PASS** — unsupported media types are clearly identified; progress/failure/retry
  states map to the image lab's real outcomes.
- [x] **PASS** — no fake AI generation success is possible: capability tests assert
  generation reports unavailable while output cannot be saved, and the built-in
  provider is never called photographic.

### Security and billing
- [x] **PASS** — POS header URL must belong to the requesting business (registry, own
  media, own cover/logo); creative/media APIs keep existing tenant guards; all new
  endpoints return 401 unauthenticated (curl-verified).
- [x] **PASS** — subscription/publishing enforcement unchanged (no billing, pricing,
  entitlement or publication-gate code touched; POS price constant untouched).
- [x] **PASS** — provider secrets never reach the client (capability payload is
  booleans/labels/reasons only; asserted by test).
- [x] **PASS** — upload validation and rate limiting unchanged; new inputs are
  size-capped, scheme-checked and inline-byte-refusing.

### POS integrity
- [x] **PASS** — sales/cart/checkout code untouched; POS engine, money, entitlement,
  offline queue/sync suites pass (270 tests in the related run).
- [x] **PASS** — image customization cannot interfere with checkout: header collapses on
  Sell, removes itself on image error, is presentation-only and fingerprint-neutral.
- [x] **PASS** — offline/sync behaviour untouched.

### Engineering and release
- [x] **PASS** — new tests (56 across imagery/creative/persistence + workspace design)
  and the related regression suites pass.
- [~] **PASS with environmental caveat** — full suite: **2,897 passed, 1 failed,
  121 skipped**. The single failure (`autopilot-phase1-hardening`, `Prisma.dmmf`) and
  the 4 residual `tsc`/build type errors are **pre-existing in this offline sandbox**:
  `prisma generate` cannot reach `binaries.prisma.sh`, leaving a stub client. The
  identical errors reproduce on an unmodified checkout of the starting SHA; `next build`
  reports **“Compiled successfully”** and fails only at that stub-client type-check.
  GitHub/Vercel (with network) generate the real client.
- [x] **PASS** — lint on all touched/new files: 0 errors (1 pre-existing-style
  react-hooks warning in the new Create screen's data load, matching existing screens).
- [x] **PASS** — no schema changes or migrations (`prisma/schema.prisma` untouched);
  no unrelated regressions in the full run beyond the pre-existing failure above.
- [ ] **BLOCKED (sandbox)** — before/after **screenshots**: no Chrome/Chromium binary is
  available or downloadable in this sandbox (browser hosts are outside the allowed
  egress list), so `scripts/browser/*` checks could not run. Mitigation: the dev-only
  `/dev/category-gallery` preview renders the real components for owner screenshots,
  and the new image files were visually inspected during development.
- [x] **PASS** — no production deployment or merge performed by this change.

## 5. Verification evidence (commands run)

```
npx vitest run tests/unit/category-imagery.test.ts tests/unit/creative-engine.test.ts \
  tests/unit/image-first-persistence.test.ts tests/unit/workspace-design.test.ts   → 56 passed
npx vitest run <16 related pos/media/studio/experience suites>                    → 270 passed
npx vitest run (full)                    → 2897 passed, 1 failed (pre-existing), 121 skipped
npx tsc --noEmit                         → only the 4 pre-existing Prisma-stub errors
npx eslint <all touched/new files>       → 0 errors, 3 → 1 warnings after cleanup
npm run build                            → "Compiled successfully"; final type-check
                                           stops on the same 4 pre-existing stub errors
curl /dev/category-gallery               → 200 (real components render)
curl /api/studio/creative (no session)   → 401;  POST → 401
curl /api/pos/<id>/presentation          → 401 UNAUTHENTICATED
curl /category/*.webp|jpg                → 200 with expected byte sizes
```

## 6. Files changed (summary)

New: `lib/categoryImagery.ts`, `lib/creative/{intent,capabilities}.ts`,
`components/media/CategoryImagePicker.tsx`, `components/dashboard/{CreativeStudio,HeroImagePanel}.tsx`,
`components/pos/{PosHeaderImage,PosHeaderImageSettings}.tsx`,
`app/dashboard/businesses/[id]/create/page.tsx`, `app/api/studio/creative/route.ts`,
`app/api/pos/[businessId]/presentation/route.ts`, `app/dev/category-gallery/*`,
`public/category/*` (36 optimized files, ~3.8 MB), 3 test files, this report.

Changed: `lib/workspaceImagery.ts` (derived registry), `lib/experience/{types,document,schema}.ts`
(hero focal), `components/storefront/ExperienceSite.tsx` (apply focal),
`app/dashboard/businesses/[id]/{page,photos/page}.tsx`, `components/dashboard/StudioTabs.tsx`
(Create + Gallery), `lib/pos/{types,configuration,provisioning}.ts` (presentation),
`app/dashboard/pos/[businessId]/{layout,settings/page}.tsx`, `app/globals.css` (POS
header banner), `.env.example` (capability notes).

Untouched, deliberately: `prisma/schema.prisma` and migrations, pricing/billing/Paystack
code, POS sales/money/offline code, publication gates, auth/session code.

## 7. Continuation (2026-10-26, same PR) — category completeness + activation-ready storage

**Audit first.** PR/branch/head/main/CI were re-verified live before any change: PR #67 open
and mergeable, head `4e31ab1…`, `origin/main` still `5f4a82d…`, all 12 checks green.
`STORAGE_DECISION.md` §5–§7.5 requires (a) a priced comparison, (b) explicit provider
selection + budget cap, (c) a *separate* authorization for the vendor adapter. The owner has
not yet made that selection, so this continuation implements only the safe, vendor-agnostic
parts and leaves activation **BLOCKED on the owner decision** — no provider enabled, no
account created, no token, no spend, no production change.

**Category completeness (Phase 4) — done.** The three worlds that previously borrowed
related-trade images now have dedicated AI-generated, visually QA'd photography
(`public/category/{salon,technical,grocery}*`, 720 jpg 71–86 KB / 1200 webp 111–143 KB):
a premium Kenyan salon/barber interior, a fundi/technician with toolbox, and a stocked
minimart checkout. Registry now covers **21 visual worlds**; Studio `salon`→salon and
`technical`→technical; POS `salon`/`barber`→salon, `grocery`/`supermarket`/
`convenience_shop`→grocery; free-text keeps "Mama mboga" on produce while
grocery/mini-mart, hair/salon/barber, and repair/electrician/plumber/fundi resolve to their
new dedicated worlds ("Beauty products & cosmetics" still resolves to beauty). All 16 Studio
profiles and 56 POS types remain covered by the registry-derived tests; picker, focal,
persistence and POS checkout behaviour are unchanged. `tests/unit/category-imagery.test.ts`
updated + extended (34/34 with workspace-design). The owner can review every category at
`/dev/category-gallery` (404 in production).

**Durable storage (Phase 2) — comparison done, activation BLOCKED.** Verified 2026-10-26
against official pricing pages; full analysis in `STORAGE_COMPARISON_2026-10-26.md`.
Recommendation: **Vercel Blob** ($0.023/GB-month storage, $0.05/GB transfer — at JATA's
scale ≈ $0–5/mo, same vendor/bill/dashboard as hosting, smallest adapter). Cloudflare R2 is
cheaper at >1 TB/mo delivery but adds a second vendor; S3 needs the most assembly;
Cloudinary jumps to $99/mo. **Owner must still:** choose the provider, approve a budget cap
+ alert, separately authorize the adapter, create the token personally (`BLOB_READ_WRITE_TOKEN`,
server-side only), and set `JATA_STORAGE_PROVIDER`. Neither the agent nor this PR can do
any of those steps.

**Creative engine plumbing (Phase 3, safe subset) — done and tested.** The engine is now
genuinely *activation-ready* without pretending to be active:

- `lib/storage`: `resolveDurableStorageProvider()` / `hasDurableStorage()` — never-throwing,
  capability-derived; `vercel-blob` selection still refused (existing test untouched), no
  provider implemented (`IMPLEMENTED_PROVIDERS` unchanged, still empty).
- `lib/ai/assetStore.ts`: builds the image lab's `ImageAssetStore` over any durable provider
  — server-side byte re-validation, tenant-prefixed keys, durable-URL-only metadata rows
  with provenance, inline-data scan before insert, orphan cleanup on DB failure, refusal of
  cross-tenant or data-URL provider responses.
- `/api/studio/ai/image`, `/api/studio/ai/enhance`, `/api/studio/creative` (generate + edit
  paths) now pass `resolveImageAssetStore()`; `/api/media` stores validated upload bytes
  with the durable provider when one is configured. With none configured (today) every one
  of these returns the **identical fail-closed 503 as before** — proven by the untouched
  503 suites plus new tests (`tests/unit/durable-asset-store.test.ts`, 8;
  `tests/integration/media-durable-upload.test.ts`, 5 — happy path 201 with durable URL,
  wrong-tenant provider and provider-down both write nothing, invalid bytes and tenant-guard
  refusals happen before storage).
- `lib/creative/capabilities.ts` derives `durableStorage` from the resolved provider, so the
  UI truth table flips automatically on activation — and still reports unavailable today.

So once the owner completes the five steps in the comparison doc, generation, iterative
edits, enhancement saves and uploads become real **with no further feature code** beyond the
small vendor adapter itself. Speech input remains browser feature-detected; animation/video
remain **unavailable** (no provider, no claims made).

**Verification (Phase 5).** Full suite: **2,911 passed** (2,897 + 14 new), 1 pre-existing
sandbox-only failure (`Prisma.dmmf` stub client, proven identical on base), 121 skipped.
Typecheck: only the same 4 pre-existing stub-client errors (CI generates the real client and
passed on this PR). ESLint clean on all touched files. Production build: "Compiled
successfully" locally; build type-check stops only on those stub errors. Dev smoke:
`/dev/category-gallery` 200 rendering all three new worlds, new images 200, creative + media
APIs 401 unauthenticated. Browser screenshots / real-device mobile checks remain
**NOT TESTED** (no browser in the sandbox) — use `/dev/category-gallery` on a phone.

**Still BLOCKED / owner actions, in order:** (1) storage provider choice + budget cap →
adapter authorization → token + `JATA_STORAGE_PROVIDER`; (2) optional `OPENAI_API_KEY` or
`GEMINI_API_KEY` for photographic generation; (3) animation/video provider + per-video cost.
