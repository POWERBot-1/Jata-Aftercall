# Website Studio — release plan

Updated: 2026-10-12 (resume). **Long-term vision NOT COMPLETE; production NOT DEPLOYED.**

Latest bounded M7 source5f0a298/CI38212669278 PASS (2034+1 expected,17/22,133 authenticated +358 fixture/HTTP). Earlier React418 remains unresolved repeatability risk; source-identical evidence-only follow-up CI is next, not a claimed fix. Current19 dependency advisories/2 production-tree findings also remain open. Full qualified evidence/failed diagnostics are in the release report.

The full original requirement source is [WEBSITE_STUDIO_MASTER_SPECIFICATION.md](WEBSITE_STUDIO_MASTER_SPECIFICATION.md), including every numbered section 0–107 and the execution directive. The section register below is a delivery tracker, NOT a replacement for that specification. Later phases remain mandatory. A name, interface, schema or feature flag is not evidence of implementation.

## 1. Verified read-only baseline (completed before source edits)

| Item | Direct evidence |
|---|---|
| Repository | https://github.com/POWERBot-1/Jata-Aftercall; `git remote -v`, `gh repo view` |
| Session feature branch | `arena/7b28a123-jata-aftercall` (fixed for this session; no other branch created, switched to or pushed) |
| Exact implementation base / baseline HEAD | `77e35cec6a5726f569ab3febd3e7766300b14890` |
| Remote predecessor | `arena/33ebb805-jata-aftercall` at the same `77e35cec6a5726f569ab3febd3e7766300b14890` |
| Proposed PR target | Repository default `main`, at `9c36bd1026e50a5ab6e66f7446ae730c71f5963a`; owner confirmation required before merge |
| Verified merge base with main | `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` |
| Inherited, unmerged work | GitHub comparison shows 17 commits ahead, 0 behind, 156 changed files against main. Not assumed merged. The full PR will include this history. |
| Working tree before audit | Clean; no uncommitted changes; `git ls-files -u` empty |
| Shallow status | Initially shallow; GitHub compare verified history read-only. After baseline report, `git fetch --unshallow origin main arena/33ebb805-jata-aftercall` restored history. No working files changed. |
| Branch on remote at baseline | New session branch absent; predecessor exists |
| Permissions / protections | `gh repo view`: ADMIN; main unprotected; ruleset list empty. This is NOT permission to bypass release gates or merge authorization. |
| Other open PRs | #20 (`arena/01a0fde9-jata-aftercall` → main), CONFLICTING; #16 (`arena/01a0edb3-jata-aftercall` → main), failed Vercel status, mergeability initially UNKNOWN. Do not change either. |
| Baseline checks | Vercel success at exact baseline SHA; no database journey check at that SHA. Database journey success at `75f6440ba187ed359eb94de4df29a382f0eb9ebf` and main is older evidence only. |
| CI | `.github/workflows/interactive-business-e2e.yml`: PostgreSQL 16 service; migrate deploy, seed, full suite excluding e2e, experience journey, POS journey; rejects skips. Initially does not run lint, typecheck, build or browser checks. |
| Environment | Node 22.22.3, npm 10.9.8. No configured DATABASE_URL, auth secret, storage, AI or Paystack credentials in the session; no native browser/PostgreSQL executables found. No production data queried. |

### Baseline verification after audit (before motion source integration)

`npm ci --no-audit --no-fund`: installed pinned lockfile (496 packages), no lockfile rewrite. Prisma native-engine download failed at `binaries.prisma.sh` (host not allowed); the pre-existing postinstall swallowed this failure. It is not a successful native client generation.

With the pinned Prisma CLI and generator, `PRISMA_QUERY_ENGINE_LIBRARY=/usr/bin/true PRISMA_SCHEMA_ENGINE_BINARY=/usr/bin/true npx prisma generate --no-engine` generated real schema-derived Prisma 5.22.0 types, **engine=none**. The paths are downloader overrides only, not a working query engine or database. No handwritten client stubs were introduced. CLI schema validation with those overrides and a dummy validation-only DATABASE_URL passed. Runtime native-engine verification remains a CI gate.

- `npm run lint`: PASS, one existing CartProvider `<img>` warning; Next 15 deprecates next lint.
- `npm run typecheck`: PASS. Re-run after client generation to eliminate timing uncertainty from the parallel initial checks.
- `npm run test`: 146 files passed / 10 skipped; **1740 tests passed / 94 skipped**, none failed. The skipped database/e2e suites did not run. Most route integration/security suites use mocks; not real DB proof.
- `npm run build`: PASS for compilation/prerender with no DATABASE_URL and **engine-less** Prisma, using the repository script with `PRISMA_GENERATE_NO_ENGINE=1` and the above downloader overrides. No migrations run. Offline database reads log missing-DATABASE_URL errors. This is not a connected-production verification.
- Gzipped app entry files (`app-build-manifest.json`, not all runtime/network requests): `/b/[slug]/page` 115,794 bytes; `/dashboard/businesses/[id]/design/page` 144,384 bytes; homepage 106,682 bytes. Next reports business first-load JS 116 kB, common JS 103 kB. Save comparable post-integration measurements in release report.

## 2. Existing functionality to preserve

| Area | Actual repository entry points / findings |
|---|---|
| Website Studio | `/dashboard/studio`, `/dashboard/businesses/[id]/{sections,design,photos,theme,items,preview,orders,bookings,insights}`; `loadWorkspace` authorizes before loading drafts. `SectionEditor`, `DesignPanel`, `PhotoLab`, `LayoutVariantPanel`, `PreviewClient`, `PublishPanel`, `StudioHistory`. |
| Renderer / public pages | `/b/[slug]` retains classic BusinessPage and calls `ExperienceSite`, `SectionRenderer`, `StorefrontShell` for experience sites. Core content server-rendered. `/shop`, `/item/[id]`, `/book`, `/checkout`, `/order/[reference]`, `/ai` exist. |
| Preview / history | `?preview=draft` permitted only to owner/member/admin; draft/public JSON separate. Preview mobile/desktop iframe; undo/redo monotonic draft versions; publication snapshots and restore-to-draft on `/api/experience/versions`. No direct bypass of pay/verify/publish. |
| Schema | `ExperienceDocument` v1, brand/settings/19 registered section types; normalization strips unrecognized config. Optional renderPreference and generation seed. Baseline clamped version; M1 now rejects explicit unsupported formats and validates raw publication/whole-document/restore boundaries. Legacy missing-version history gets explicit restore-only missing defaults; no general repair-before-publication. |
| Database | Existing Business (tenant), BusinessMember, Product, ProductVariant, Service, Offer, BusinessExperience, ExperienceVersion, ExperienceDraftRevision, InteractiveBusinessEntitlement, MediaAsset, AiGeneration; Subscription/Payment/Order and POS/payment-wallet models. 15 migration directories through `20261010000200_checkout_idempotency`. Reuse these, do not duplicate tables merely to match conceptual names. |
| Auth / tenancy | JWT HttpOnly/SameSite session cookies (`lib/auth.ts`); tenant/resource and business-role helpers (`lib/tenant.ts`). Owners/members/admin must be enforced by existing server guard, not browser tenantId. Read-only/member role semantics require continuing review. |
| Media | `POST /api/media` takes dataUrl/url and validates bytes; `GET/PATCH/DELETE` media library; `lib/media/{browserImage,imageFormat,imagePlan}` resize/EXIF/format/output pipeline; PhotoLab/MediaPicker. Upload currently stores data URLs in Neon. |
| Storage | `lib/storage/*` interface and inline provider. No active durable provider, no production upload call to storage interface; derivative planning is not generated/persisted variants. `STORAGE_DECISION.md` contains proposal, not approval. |
| AI Image / copy | `lib/ai/provider.ts`, registry and OpenAI/Gemini/local adapters; `/api/studio/ai/{image,enhance,history,status}`. Built-in provider generates labelled representative artwork, NOT professional product photography or product-consistent AI. Copy grounding guards authoritative data. Vendor requests not exercised here. |
| Design diversity | category directions, theme families, seeded variants and structural similarity. Current generator selects category themes and shuffles sections; compares only this business's published versions. This is NOT the required full art director, 20-family recipe library or platform anti-similarity engine. |
| Motion / capability | CSS + IntersectionObserver MotionReveal; root render-mode probe and hardware/network score. Reduced-motion/Save-Data constraints exist. Arbitrary score alone is not validated runtime performance. No motion or GSAP at baseline. |
| Immersive | Three 0.186.1 dependency; lazy ImmersiveStage/ThreeProductViewer, GLB preview, eligibility rules, static fallback and dev-only `/dev/immersive-preview`. Visitor-facing 3D disabled. No production model upload/optimization pipeline, no WebGPU renderer, compression codecs or complete scene graph. |
| AI Front Desk / ASK JATA | `lib/ai-front-desk.ts`, `ai-grounding.ts`, `ai-business-brain.ts`, tools and entitlements; `/api/ai/chat`, `/b/[slug]/ai`. Tenant-scoped products, stock, FAQs, hours and commerce actions. Preserve and regression-test; do not rewrite. |
| Payments / subscription | `lib/paystack.ts`, `paymentVerification.ts`, `/api/paystack/{verify,webhook}`, `lib/experience/payments.ts`; server validates reference/amount/currency/status, signatures and idempotent settlement. Website Studio gate in `experience/publish` plus `experience/entitlement`. Preserve test/live separation and established sale/cancel/refund policies. |
| POS | Existing `lib/pos/*`, `/dashboard/pos/[businessId]`, `/api/pos/[businessId]/*` with role/entitlement/transaction checks. Existing integration and real-DB journey. No new payment logic in visual components. |
| Plans | **Corrected baseline audit:** price-sorted AI before Annual and showed Interactive Business. M2 fixes DOM/mobile order Monthly → Annual → AI Front Desk → Website Studio → separate POS and canonical customer-facing Studio brand. IDs, server prices/durations and checkout policies unchanged; database/fallback ordering and POS isolation tests pass. |

## 3. Confirmed defects and dependency risks

1. Client photo validation uses default 5 MB upload ceiling before resizing despite 24 MB source ceiling; large normal phone photos rejected too soon.
2. Valid signature with an incorrect recognized File.type is rejected before decoding; unreliable Android metadata must be normalized on-device while canonical server payloads remain strictly checked.
3. EXIF handling guesses rotation from landscape/portrait, risks double-rotating browser-corrected photos, handles only +90°, and does not release ImageBitmap memory. HEIC branch is unreachable because shared validation refuses it before decode.
4. Media POST accepts arbitrary safe-shaped URLs and unverified `aiGenerationId`; dimensions can be client-preferred rather than binary-derived. Ownership/provenance needs further hardening. Do not silently delete existing assets.
5. Unknown schema versions and malformed content are repaired by normalization rather than rejected at publication. Add a strict boundary while preserving v1 editing/legacy fallback.
6. Baseline `GET /api/services` leaked draft services; M1 checks ownership/visibility before reads and limits non-owner reads to active services of published non-suspended businesses. Eight mock security tests pass; native database proof pending CI.
7. Baseline CI missed `PRISMA_TEST_DATABASE_URL`; M1 wires disposable CI Postgres to both database variables, keeps the no-skips gate and adds lint/types/build. Actual execution still pending.
8. Historical documentation contains obsolete verification and policy statuses. This release report is authoritative for this branch, not old reported test counts. Existing inherited subscription `it.fails` documents a real payment-lifecycle gap; do not count expected failure as resolved.
9. Persistent image binaries/originals, vendor AI calls, physical Android validation and visitor-facing immersive delivery remain blocked/incomplete. Do not claim these done on interface or mock evidence.
10. Direct homepage/pricing inspection corrected an earlier audit assumption: plan cards price-sort Monthly → AI → Annual → Interactive Business and retain the old name. Required display order/Website Studio branding remains OPEN at M1; keep stable internal IDs and server pricing.
11. M1 also fixes a stale-snapshot publication leak: public storefront reads require business.isPublished even when the experience status says PUBLISHED; trusted owner draft preview remains separate.

## 4. Explicit conflicts / decisions

| Conflict | Resolution / gate |
|---|---|
| “107 sections” vs Section 0–107 | Preserve all **108 numbered blocks**, not omit Section 0 or 107. |
| GSAP requested in master vs mandatory motion + no unnecessary duplicate systems | Install motion; use dynamic `motion/mini` + existing CSS/IntersectionObserver initially. No GSAP present at baseline. GSAP-specific choreography remains an open requirement pending a distinct technical need and bundle evidence; not silently marked complete. |
| Store original + shrink uploads vs existing data-URL/Neon design | Keep existing assets readable and unchanged. No migration/deletion now. Request approval for a capped Vercel Blob object-store implementation (smallest Vercel-compatible candidate), tenant-scoped references, originals + derivatives, migration/backfill and cost limits. Until approved/configured/exercised, Stage 4/U is BLOCKED. Improving browser processing is not persistence proof. |
| M-PESA in final vision vs do not modify M-PESA branch | Reuse existing payment services only. Do not switch to or modify any M-PESA branch or provider policy. M-PESA live validation requires separate owner-approved sandbox/provider setup. JATA Qi untouched. |
| Example hardware score vs measured capability requirement | Existing score is advisory only. Never enable public immersive solely from the score. Runtime frame/capability measurement and feedback are Stage 7 requirements; Lite safety preferences always win. |
| Merge requested “wherever possible” vs explicit authorization and all gates | Prepare one PR; do NOT merge without explicit owner authorization, review of inherited 17 commits, all current checks, storage/policy gates and approved migration procedure. No auto-merge, force-push or protection bypass. |
| Push/PR automation vs Vercel architecture | GitHub may automatically create a Vercel preview. No production deploy command or merge is authorized. Record observed preview separately; production default NOT DEPLOYED. |
| Final SHA inside a committed report | A commit cannot contain its own content hash. Record the tested implementation SHA and milestone SHAs in committed docs; record the final documentation commit SHA on the PR and in the handoff, verify remote equality. Never invent a self-referential SHA. |

## 5. Coordinated staged delivery

Every milestone runs lint, types, available suites, build/schema checks and relevant mobile/browser checks. Real native-Prisma checks run against CI's isolated PostgreSQL. Blocked tests are recorded, not silently passed.

| Stage | Baseline status | Safe work / acceptance gate | Remains / dependencies |
|---|---|---|---|
| 1 Foundation + Lite | PARTIAL | Strict supported schema boundary; refuse unsafe/unknown configs; server publication checks; preserve SSR fallback, existing history/preview and paid gates; close observed draft-read leak; regression tests. | Complete asset ownership/publication/performance gates need approved persistent assets and full browser/DB journeys. Archived/version lifecycle needs fuller review. |
| 2 Motion | PARTIAL | Actually install compatible motion via npm; on-demand animation module, finite recipes, touch-safe section reveal; never hide SSR content on failures; live reduced-motion/Save-Data/network changes; isolated preview tier; measure route/dynamic chunks. | Full requested presets/recipes, gallery/parallax/choreography and GSAP decision are not delivered just by reveal integration. |
| 3 AI art direction + diversity | PARTIAL | Build on existing direction/context/seeded variants and approved components; validate provider configuration/output; meaningful category/content-led structures, deterministic regeneration and brand locks; no arbitrary code. | 20 families, full recipe library, cross-business privacy-safe fingerprints, intelligent uniqueness and all creative controls. Vendor credentials/network needed for actual AI art direction verification. |
| 4 Image Studio | PARTIAL + BLOCKED | Correct early-size/MIME/EXIF/memory defects, honest HEIC path and useful progress/errors; real browser pixel tests. Preserve originals, accept/reject variants and tenant metadata. | Owner approval + durable provider/token/cost limits; original binary/derivative migration. Vendor generation/background/product-consistency/campaign quality actually exercised. Physical Android tests. |
| 5 Immersive | DEV PREVIEW ONLY | Preserve static fallback and lazy boundary; only approved tenant assets, bounded model sizes, compression/codec tests, WebGL context recovery, optional WebGPU adapter measurement. | Durable storage, production GLB ingestion/optimization, scene recipes, asset ownership, public path, WebGPU renderer. Not enabled here merely by existing Three dependency. |
| 6 Commerce + ASK JATA | EXISTING / PARTIAL | Existing links, ordering, booking, Paystack, AI retrieval and POS suites remain authoritative. No duplicate payments. Cross-tenant failure and paid publication tests. | Full immersive-to-order/booking/pay/POS browser journey, provider sandbox, remaining inherited payment gap review. |
| 7 Adaptive performance / analytics | PARTIAL | Start with measured bundle/runtime fallback evidence, privacy-safe events and configurable preferences; progressively measured quality, analytics, optimization. | Real device/network telemetry, reliable runtime benchmark, historical adaptive choices, quality score and make-it-fast optimization, analytics-driven creative learning. |

## 6. Mandatory release gates and acceptance coverage

- Run npm scripts: lint, typecheck, test, test:e2e, test:e2e:pos, build, test:browser:immersive. Add focused automated boundary/animation/photo/security checks without weakening existing ones.
- Validate Prisma schema; CI `prisma migrate deploy` against isolated Postgres 16 + seed, no skips. Do not run production migrations/reset. This milestone should need no new migration; inherited three 20261010 migrations must still be reviewed and tested.
- Test schema/version compatibility and malicious URLs/config, Lite SSR, lazy Motion, reduced motion, import/observer failure, low-memory/network, no JS and static immersive fallback.
- Image JPEG/PNG/WebP, incorrect/empty MIME, source over 5 MB, malformed/truncated content, bounded pixel memory, actual EXIF orientation 1–8, WebView fallback, output compression/preview, error retry. Browser emulation is not physical Android.
- Tenant tests: product/service read visibility, media/image ownership/provenance, experience/history/preview/publication, AI retrieval, orders/payments/POS. Mock route tests and DB tests reported separately.
- Preserve owner edit → preview → pay → server verify → entitled publish → live and restore-to-draft rollback. No live charges/refunds.
- Section 102 acceptance A–X and Section 80 full journey remain release criteria; Stage 1/2 passing is not overall success. U (no binary Neon), L (real image provider), I (public immersive), W (real low-end device), full E/uniqueness and the complete end-to-end journey are currently unfulfilled.
- Before merge: clean tree, only intended diff, baseline/inherited diff reviewed, verified exact remote SHA, finished current checks, no conflicts, safe migration plan, approvals. Verify target SHA afterward only if merge authorized.
- Production deployment is a separate explicit approval; current status **NOT DEPLOYED**.

## 7. Recovery / evidence

Recover from this exact GitHub feature branch and verified commits, not session artifacts. Logs, binaries, screenshots and .next are ignored scratch only; source, specification, test scripts, release plan and report are committed and pushed. Record milestone SHA, remote equality, PR URL/check URLs, measured bundles and passed/failed/skipped/blocked/not-run tests in [WEBSITE_STUDIO_RELEASE_REPORT.md](WEBSITE_STUDIO_RELEASE_REPORT.md).

## 8. Section-by-section long-term requirement register

Status entries are conservative audit/delivery assessments. The original text remains the requirement. Even where a boundary is preserved, full real-world acceptance remains gated on the tests above.

| Section | Requirement | Status | Evidence / remaining work |
|---|---|---|---|
| 0 | MANDATORY PROJECT BOUNDARY | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 1 | PRODUCT VISION | NOT COMPLETE | Requested behavior remains required in the staged product vision. |
| 2 | CORE ARCHITECTURE | NOT COMPLETE | Requested behavior remains required in the staged product vision. |
| 3 | THREE RENDERING MODES | PARTIAL / OPEN | Lite/CSS Motion exist; public Immersive is not implemented. |
| 4 | CAPABILITY DETECTION | PARTIAL / OPEN | Existing hardware/network score is advisory, not measured runtime capability. |
| 5 | BUSINESS EXPERIENCE SCHEMA | PARTIAL / OPEN | M1 raw v1/version/restore gates pass local tests and eight native PostgreSQL CI cases after fixture correction; asset ownership/full journey remain open. |
| 6 | EXPERIENCE RECIPE ENGINE | NOT COMPLETE | 19 section types do not satisfy all requested recipes. |
| 7 | CRITICAL UNIQUENESS REQUIREMENT | NOT COMPLETE | Theme/shuffle variants are not the required structural uniqueness. |
| 8 | TEMPLATE FAMILIES | PARTIAL / OPEN | All20 named Lite compositions implemented/rendered/tested atM4; full immersive/recipe/library requirements remain mandatory. |
| 9 | ANTI-SIMILARITY ENGINE | NOT COMPLETE | Fingerprint compares only tenant history, not full platform anti-similarity. |
| 10 | AI ART DIRECTOR | NOT COMPLETE | Category direction recipes/copy exist; full AI art director absent. |
| 11 | AI-GENERATED PHOTOGRAPHY ENGINE | BLOCKED / OPEN | Local representative artwork is not professional/product-consistent photography. |
| 12 | IMAGE ENGINE MODES | BLOCKED / OPEN | Device enhancement/crop only verified; vendor campaigns/consistency/angles blocked. |
| 13 | AI IMAGE ART DIRECTION | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 14 | IMAGE GENERATION PIPELINE | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 15 | IMAGE SAFETY + PRODUCT INTEGRITY | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 16 | AUTOMATIC IMAGE PIPELINE | BLOCKED / OPEN | Original binary preservation requires approved/configured durable storage. |
| 17 | PHOTO UPLOAD MUST WORK ON KENYAN ANDROID | BLOCKED / OPEN | Large-source/MIME/EXIF defects confirmed; real Android acceptance pending. |
| 18 | CLIENT IMAGE PROCESSING | PARTIAL / OPEN | Resize/progress/retry exist; early size/decode memory/orientation fixes pending. |
| 19 | IMAGE CDN ARCHITECTURE | BLOCKED / OPEN | Binaries still stored in Neon; provider/token/cost/migration approval required. |
| 20 | IMAGE FORMATS | PARTIAL / OPEN | WebP output + derivative planner; persistent responsive variants not created. |
| 21 | MOTION ENGINE | PARTIAL / OPEN | motion 14.1.0 installed and real lazy mini integration locally verified; four finite primitives, live preferences and CSS fallback. Full recipe/choreography library remains open; GSAP decision explicit. |
| 22 | THREE.JS IMMERSIVE ENGINE | DEV PREVIEW ONLY | Lazy product GLB development preview only; no public commercial engine. |
| 23 | WEBGPU | NOT COMPLETE | GPU availability probe only; no actual WebGPU renderer. |
| 24 | GLB / 3D ASSET PIPELINE | BLOCKED / OPEN | No production ingestion/optimization/codec/object-storage pipeline. |
| 25 | JATA SCENE GRAPH | NOT COMPLETE | Complete validated commercial scene graph absent. |
| 26 | INTERACTION LIBRARY | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 27 | MOBILE-FIRST INTERACTION | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 28 | "LIVELY" WEBSITE SYSTEM | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 29 | BUSINESS-SPECIFIC EXPERIENCE GENERATION | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 30 | COMMERCE BRIDGE | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 31 | M-PESA | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 32 | POS INTEGRATION | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 33 | ASK JATA INTEGRATION | PARTIAL / OPEN | Grounded tenant retrieval exists; complete real-data customer journey open. |
| 34 | AI FRONT DESK ARCHITECTURE | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 35 | AI-GENERATED CONTENT | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 36 | AI EXPERIENCE GENERATION PIPELINE | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 37 | AI SHOULD GENERATE EXPERIENCES, NOT APPLICATION CODE | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 38 | EXPERIENCE VALIDATION | PARTIAL / OPEN | Readiness/entitlement checks exist; schema/assets/performance gates incomplete. |
| 39 | PERFORMANCE BUDGET | PARTIAL / OPEN | Business entry gzip 115794 B baseline; images/models/devices not fully measured. |
| 40 | PERFORMANCE TECHNIQUES | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 41 | NEXT.JS ARCHITECTURE | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 42 | DATABASE DESIGN | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 43 | VERSIONED EXPERIENCES | PARTIAL / OPEN | Existing immutable publication snapshots/restore-to-draft; full archive journey open. |
| 44 | PREVIEW SYSTEM | PARTIAL / OPEN | Owner isolated mobile/desktop preview exists; tier/performance preview pending. |
| 45 | "REGENERATE EXPERIENCE" | PARTIAL / OPEN | Layout variant action exists, not intelligent new structure/art direction. |
| 46 | "MAKE IT MORE..." AI CONTROL | NOT COMPLETE | Requested behavior remains required in the staged product vision. |
| 47 | "MAKE MY PHOTOS BETTER" | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 48 | AI IMAGE WORKSPACE | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 49 | FRONTIER IMAGE CAPABILITY | PARTIAL / OPEN | Provider registry exists; cost/latency/quality orchestration not built. |
| 50 | AI IMAGE QUALITY PIPELINE | BLOCKED / OPEN | No exercised image identity/text/logo quality pipeline. |
| 51 | ACCESSIBILITY | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 52 | SEO | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 53 | OFFLINE/LOW-CONNECTION RESILIENCE | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 54 | ERROR RECOVERY | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 55 | SOUND | PRESERVED / TEST GATED | No intrusive autoplay added; useful optional audio not implemented. |
| 56 | ANALYTICS | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 57 | PERFORMANCE ANALYTICS | NOT COMPLETE | No complete runtime asset/mode/fallback/performance telemetry. |
| 58 | ADAPTIVE EXPERIENCE | NOT COMPLETE | No measured historical mode learning. |
| 59 | SECURITY | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 60 | AI SECURITY | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 61 | EXISTING JATA LIFECYCLE MUST REMAIN | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 62 | HOMEPAGE PLAN POSITIONING | DEFECTS / OPEN | Actual price-sort/name defect confirmed after initial audit assumption; required order/Website Studio branding to be fixed without changing stable IDs or payment policy. |
| 63 | WEBSITE STUDIO UX | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 64 | ONE-CLICK AI GENERATION | NOT COMPLETE | Existing onboarding/copilot is not full one-click AI orchestration. |
| 65 | CATEGORY-SPECIFIC GENERATION | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 66 | TEMPLATE RANDOMIZATION IS NOT ENOUGH | PARTIAL / OPEN | Content/intent-led semantic reasoning + real geometry replaces palette/shuffle gate atM4; configured contextual AI/full goals remain open. |
| 67 | DESIGN DIRECTION OBJECT | PARTIAL / OPEN | Validated v2 ArtDirection and renderer/brief/semantic reasoning bridge implemented; full recipe/scene/image/commerce-strategy context open. |
| 68 | EXPERIENCE GENERATION SEED | PARTIAL / OPEN | Seed/version stored; complete deterministic recipe/direction generation pending. |
| 69 | NO RANDOM BROKEN WEBSITES | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 70 | JATA EXPERIENCE DESIGN SYSTEM | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 71 | BRUNO SIMON-INSPIRED PRINCIPLE | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 72 | "COMMERCIAL IMMERSION" | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 73 | JATA EXPERIENCE ENGINE MODULES | PARTIAL / OPEN | Reuse current modules; interfaces/names do not prove missing engine behavior. |
| 74 | RECOMMENDED DIRECTORY STRUCTURE | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 75 | NO ARCHITECTURAL BREAKAGE | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 76 | DATABASE MIGRATION SAFETY | PRESERVED / TEST GATED | No new destructive migration; inherited migrations need native-Prisma CI. |
| 77 | EXISTING PRODUCTS MUST KEEP WORKING | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 78 | FALLBACK GUARANTEE | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 79 | TESTING REQUIREMENTS | PARTIAL / OPEN | 1740 tests run; 94 skipped; full DB/browser/device/provider gates open. |
| 80 | END-TO-END TEST | BLOCKED / OPEN | Specified full image/AI/tier/customer/order/payment/POS journey not proved. |
| 81 | PERFORMANCE TEST DEVICES | BLOCKED / OPEN | Physical devices not tested. Browser emulation is not physical Android. |
| 82 | REAL-WORLD KENYAN MOBILE REQUIREMENT | PARTIAL / OPEN | Some existing components; full specification and phase acceptance remain required. |
| 83 | PUBLISHING PERFORMANCE CHECK | NOT COMPLETE | Full measured prepublication payload budget absent. |
| 84 | AUTOMATIC EXPERIENCE OPTIMIZATION | NOT COMPLETE | Automatic measured heavy-experience optimizer absent. |
| 85 | DESIGN QUALITY SCORE | PARTIAL / OPEN | Website health weighted checks exist, not complete experience quality score. |
| 86 | IMAGE QUALITY SCORE | BLOCKED / OPEN | Exercised sharpness/identity/composition/brand quality score absent. |
| 87 | AI CREATIVE MEMORY | PARTIAL / OPEN | Draft/design/accepted assets/history exist; rejected-image creative memory incomplete. |
| 88 | BRAND LOCK | NOT COMPLETE | Authoritative-data protection is not full brand-lock UX. |
| 89 | CUSTOMER CONTROL | PARTIAL / OPEN | Edit/hide/move/undo/redo/preview/publish exist; full controls remain. |
| 90 | THE "SURPRISE ME" FEATURE | NOT COMPLETE | Business-aware unconventional generation absent. |
| 91 | THE "MAKE IT IMMERSIVE" FEATURE | NOT COMPLETE | Intelligent 3D asset selection/public engine absent. |
| 92 | THE "MAKE IT SELL" FEATURE | NOT COMPLETE | Evidence-based sales optimization absent. |
| 93 | THE "MAKE IT FAST" FEATURE | NOT COMPLETE | Automatic make-it-fast optimization absent. |
| 94 | THE JATA CREATIVE LOOP | LONG-TERM OPEN | Requested behavior remains required in the staged product vision. |
| 95 | ANALYTICS-DRIVEN AI | NOT COMPLETE | Privacy-safe aggregate AI creative improvement absent. |
| 96 | WHAT MUST REMAIN LIGHTWEIGHT | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 97 | WHAT SHOULD LIVE WHERE | PRESERVED / TEST GATED | Maintain this boundary; full real-world regression acceptance still required. |
| 98 | IMPLEMENTATION PHASES | DELIVERY CONTROL | All seven delivery stages retained; not reduced to install. |
| 99 | DO NOT ATTEMPT EVERYTHING IN ONE UNSAFE CHANGE | DELIVERY CONTROL | Small tested milestones committed and pushed; blocked gates recorded. |
| 100 | GIT REQUIREMENT | DELIVERY CONTROL | Same branch + exact remote SHA verification required. |
| 101 | DO NOT CLAIM SUCCESS WITHOUT TESTING | DELIVERY CONTROL | No overall success claim from compilation/mocks. |
| 102 | ACCEPTANCE CRITERIA | LONG-TERM OPEN | A-X remains unsatisfied as a whole; U/L/I/E/W and full journey blocked. |
| 103 | THE FINAL PRODUCT EXPERIENCE | LONG-TERM OPEN | Full customer experience remains long-term goal. |
| 104 | THE JATA DIFFERENTIATOR | LONG-TERM OPEN | Combined AI/image/diversity/motion/commerce differentiator remains goal. |
| 105 | "SIGMA-LEVEL" ENGINEERING PRINCIPLE | LONG-TERM OPEN | Closed-loop engine not delivered by early phases. |
| 106 | FINAL ARCHITECTURE | LONG-TERM OPEN | Full architecture remains mandatory; no placeholders-as-success. |
| 107 | NON-NEGOTIABLE FINAL RULE | LONG-TERM OPEN | Unique validated commercial experiences remain final objective. |

## M3 checkpoint — real Motion integration, 2026-10-11

- Previous feature head `a28c1a46101ac90bbf28d374b4986b689196de8d` is green in native Postgres CI [38143573261](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38143573261): native generate, lint/types, all migrations/seed, full non-e2e/no-skips suite, experience journey/no-skips, POS/no-skips, connected production build. Session mocking/test settlement remain distinct from a browser-authenticated journey or real Paystack verification. The inherited expected failure is not resolved.
- Real `motion/mini` import is now a named, separate async chunk, requested only for eligible intersecting content. Four whitelisted, finite opacity/transform primitives, one scoped controller, ≤40 targets/8 active+pending; no WebGL probe or hardware-only score in the reveal controller. SSR stays visible; owner Lite/none and live reduced-motion/Save-Data/network/visibility constraints cancel safely. Unsupported observer/preferences/animation APIs, failed/hung chunk and partial native errors retain static or bounded CSS content. Owned target guards cannot disable independent nested scopes.
- Local pinned Next/React build, lint/types and **1,820 tests passed / 102 DB/e2e tests skipped**. New unit tests **35 passed** (30 recipe/policy/controller/SSR + five development-framing boundaries). Actual headless Chrome **153.0.8010.0: 124 Motion checks passed**, plus inherited 14 immersive and seven layout checks. Android UA/touch/resources are simulated; model/catalogue inputs are synthetic. Production one-shot HTTP smoke **six passed**; both dev harnesses return404 and production DENY survives the QA environment flag.
- Comparable gzip app-entry sums: business116,460 B (+666), design143,692 B (−692), home106,722 B (+40); lazy mini4,876 B gzip, absent from those initial entries. These are not all route traffic, Core Web Vitals, physical device or complete performance-engine proof.
- CI now executes production-isolation/bundle checks and actual browser regressions, fails if Chrome is missing, and posts successful summaries with feature/runner SHAs. Fresh native/browser outcome for the new Motion source is pending its first verified push; never infer it from the previous head.
- Arena iframe/HMR support is explicit **development-only** `ARENA_LIVE_PREVIEW=1`; production and public-business SAMEORIGIN/self restrictions remain unchanged. Production opt-in flag cannot weaken headers; unit + actual HTTP smoke verify that boundary.
- **Phase2 remains PARTIAL**, not a full preset/parallax/slider/choreography library. Phase3 art direction/20 structural families/complete recipes/scoring, Phase4 Android/originals/provenance/persistent storage/actual provider calls, full Phase5 scenes/compression/WebGPU, final Phase6/payment policy regressions and Phase7 measured adaptation/analytics remain mandatory. No merge, production deployment, provider provisioning or paid operation authorized.
- Durable media is still inline in Neon on the inherited path. Provider selection/cost approval and configured verification environment are required before making truthful persistent-original/provider claims. Implementing an adapter alone will not close this gate.

- Actual phone/cart inspection additionally exposed inherited root-class leakage: `.eb-nav--sticky` filtered/stuck the entire scope, trapping a fixed cart drawer at document-bottom (measured top2078px with740px viewport). Scoping it to the header restores the viewport drawer (top238.4/bottom740px); uppercase button treatment now only affects buttons. Coarse-pointer controls are≥44px and cart controls wrap. Actual touch add/increase149→298/decrease149/close all PASS with unchanged commerce/price policy. A local real SVG fixture replaces missing/intercepted image requests; all22 browser scenarios verify successful image loading.

### M3 native verification update

Implementation**`4e6009974722670bf90ba25be59c6c1605f3f616`** independently matches its pushed branch. [Run38148693344](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38148693344) now PASS; actual [PR evidence](https://github.com/POWERBot-1/Jata-Aftercall/pull/41#issuecomment-6110263889): native1881 passed +1 inherited expected failure,0 skipped; experience17/POS22; actual Motion124/immersive14/layout7/production HTTP6 all PASS,0 skipped. Native generate/migrations/seed/lint/types/connected build/bundles PASS. Earlier pending-CI text is historical. CI business/design/home gzip116459/143691/106723 B, actual lazy mini4876 B, excluded initially. Automatic Vercel branch preview SUCCESS is not production deployment. Remaining stages/recipe libraries, provider/storage/Android approvals, full inherited185-file PR review, advisory/expected-failure triage andA–X acceptance remain mandatory; overall **IN PROGRESS / NOT COMPLETE / NOT MERGED / NOT DEPLOYED**. Follow-up documentation SHA/remote equality goes on PR/handoff, not into its own commit.

## Owner storage decision — 2026-10-11

Owner explicitly **DEFERRED provider approval**. No object/CDN provisioning/activation, new real uploads/provider calls or spending may be enabled. Persistent-original/provider acceptance remains **BLOCKED**, not waived or passed. No new originals inline in Neon. Preserve existing architecture/working legacy derivatives. Separate immutable originals/derivatives when eventually authorized. `WEBSITE_STUDIO_MEDIA_ACTIVATION_POLICY.md` records required (not already implemented) tenant/security/access, retention/deletion, cost/secret/configuration and actual verification gates before activation. Continue independent mandatory engine work. Main target confirmation was not supplied; no merge, production deployment or production-data change authorized.

## M4 — independent versioned art direction / family renderer checkpoint

- Owner provider deferral remains binding: no provisioning/activation/real original uploads/provider calls/spending enabled; no new original bytes or binary columns in Neon. Required activation controls in `WEBSITE_STUDIO_MEDIA_ACTIVATION_POLICY.md` are requirements, not implemented/provider proof.
- Explicit format**v2** introduces registered artDirection recipeVersion1; missing version still means unchanged legacy**v1**, both supported; unknown outer/recipe versions and executable/foreign config fail closed. Existing stored v1 is not silently upgraded. New draft seeding and owner-approved variant previews produce validated v2 plans. Owner manual layout override, CAS, history/rollback, public/draft separation and financial sources retained.
- All20 master family names have actual Lite server compositions, six body geometries, six catalogue geometries, six gallery geometries, hero/navigation/card/density treatment and responsive rules; spatial/showroom/cardless-immersive are explicitly HTML fallback directions, NOT3D/WebGPU activation. Semantic existing-content order replaces random shuffle; fixed nav/hero/contact slots remain, no invented facts/assets.
- Deterministic category/intent/audience/personality/density/existing-content reasoning, server-owned catalogue counts, bounded retries/current+own-history fingerprint gate. Palette-only/theme-label differences cannot pass; structural similarity compares effective rendered layouts. Ranking is explainable policy fit, **not AI-provider, conversion, image-quality, benchmark or measured adaptation proof**. No cross-tenant/global uniqueness claim.
- Actual API/editor integration: brief/family selection, safe failures, response reasons/no-provider labels, preview-only candidate and explicit reviewed-version apply; counts/history scoped to owned business before validation. Native v2 ownership/apply/unpaid-publish/live/history suite adds6 tests (locally SKIPPED pending CI).
- Local full:152 files PASS/12 SKIP;1856 tests PASS/108 SKIP/1964 total. New art direction unit/SSR33 PASS plus route3 new cases. Existing concurrency fixture supplied the actual persisted reviewed draft; missing/stale CAS order retained ahead of parsing. Unsupported-version test targets new future3; strong fact-preservation tests now distinguish explicitly requested presentation/layout from immutable content.
- Real headless Chrome family matrix**167 PASS**, all20 phone/desktop no-JS/core HTML/links/image/overflow/anchors; measured20/20 unique desktop DOM/layout signatures without palette/family-label scoring; three Lite touch-cart cases. Existing Motion124/immersive14/layout7 +production HTTP6 PASS. Mobile and data are synthetic/emulated; not physical/provider/commercial-world proof.
- Lint/types/offline schema-derived build PASS; no new lint warnings (existing img/deprecation retained). Gzip initial entries business116460 (+666), design146164 (+1780 vs original baseline, +2472 vsM3), home106722 (+40); lazymini4876 B still excluded initially. Registry/composition is server-rendered; no customer entry cost increase vsM3. No lockfile/Prisma migration changes.
- Fresh native/connected-build/family-browser CI pending first M4 verified push. Full recipe library, configured AI wording/image/providers, global diversity strategy, full spatial scenes/compression/WebGPU, Android/durable originals and measured adaptation/analytics still mandatory/open or BLOCKED. No merge/main confirmation/production mutation/deployment authorization.

### M4 native update

**`ced040844a28aa7e9de0e41d17e5cf0eb1d7df32`** /verified remote; [38154909298](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38154909298) PASS, actual [summaries](https://github.com/POWERBot-1/Jata-Aftercall/pull/41#issuecomment-6111096521): native1923 PASS +1 inherited policy-authorization expected failure,0 skipped; new6 native cases PASS; journeys17/22; family167/Motion124/immersive14/layout7/HTTP6 all PASS. Connected build/migrations/lint/types/bundles PASS. Previous pending text is historical. Provider deferral unchanged; remaining independent/blocked obligations and explicit merge/production permissions unchanged. Follow-up documentation identity/remote equality goes on PR/handoff; full release not complete.

## M5 independent immersive hardening checkpoint

Constrained embedded/untextured/static GLB2 graph/resource/actual-byte validation and existing sole lazy viewer lifecycle implemented/tested; live preferences/tab handling, finite8-second auto render budget, real touch/keyboard on-demand orbit, timeout/cancel/context loss/fallback. Local new12 unit, immersive22 actual checks, regressionsfamily167/Motion124/layout7/HTTP6 PASS; local full1868 PASS/108 DB/e2e SKIP. Build/lint/types PASS; initial JS+1 B vsM4 bookkeeping, mini4876 B excluded, no public Three import. Owner storage/provider deferral and public feature gate remainOFF/BLOCKED. Compression/texture/skins/animations/matrix graphs explicitly unsupported; full scene/editor/world/commercial-reference/WebGPU/measurement acceptance OPEN, not silently completed. Fresh native verification pending source push. No SDK/migration/binary write/provider operation/spending/merge/deploy approved or invoked.

### M5 native update / current boundary

Implementation/verified remote**2256add39b429c41a2bb7389f583641a3c7a49f5**; [38158203946](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38158203946) PASS; actual [evidence](https://github.com/POWERBot-1/Jata-Aftercall/pull/41#issuecomment-6111548290): native1935 PASS +1 inherited policy-authorization expected failure,0 skipped; journeys17/22; browser/HTTPfamily167/Motion124/immersive22/layout7/HTTP6 all PASS. No paid/provider/original/public3D activation. Current completed/BLOCKED/outstanding register in release report preserves all remaining independent and provider-dependent requirements. New config and optional safety are verified subcomponents, not entire-engine certification. Final documentation commit/current remote/check identity goes on PR/handoff; no merge/deploy authorized.


### M6 independent local image preparation checkpoint

Owner storage/provider decision remains **DEFERRED**; persistent-original/provider acceptance **BLOCKED**. No provisioning/activation/new real uploads/provider calls/spending or new original bytes inline in Neon. Original/processed separation, authentication/tenant/ACL/token/retention/deletion/cost/configuration activation policy remains mandatory in WEBSITE_STUDIO_MEDIA_ACTIVATION_POLICY.md.

Independent local-only hardening now includes SOURCE-vs-derivative byte limits, signature/MIME/extension/container/dimension bounds, exact EXIF1–8 via immutable-source decode copy, native resize hints, finite decode/cancel/late resource cleanup and transparent derivatives. Inherited inline-original failure fallback removed per explicit owner prohibition. Existing legacy derivative APIs/tenant/commerce behavior unchanged; synthetic mocked-route fixtures corrected rather than weakening assertions.17 unit +actual29 browser checks PASS; all prior family167/Motion124/immersive22/layout7 PASS. Local full1885 PASS/108 DB/e2e SKIP, production compilation/isolation9 PASS; fresh native source push still required. Physical Android, original persistence/provider/HEIC and device memory acceptance NOT PASSED. Customer gzip unchanged vsM5; editor147687 B (+1522), asyncmini4876 B excluded initially. No new dependency/schema/migration. Entire engine/recipes/AI/scenes/WebGPU/measured performance obligations remain open; no merge/deployment authorized.


M6 fresh-native update: **e9b1a1938c247eb54eb7cfd30fd8d47afc7c7be7**, remote equality verified, [38168162520](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/38168162520) PASS;164 files1952 PASS +1 inherited expected failure,0 skipped; experience17/POS22 and358 actual browser/HTTP checks PASS. Native migrations/seed/connected build/gates PASS. Original/provider acceptance remains **BLOCKED by explicit owner DEFERRED decision**, physical Android NOT RUN; no provider/storage/new upload/spend activation. Later stages/recipes/scene/compression/WebGPU/measured adaptation/analytics/fullA–X are not waived. Follow-up documentation delivery SHA/current checks recorded on PR/handoff. No merge/production deployment/data change authorized.


## M7 resume audit / authenticated acceptance dependency

Current remote checkpoint at read-only audit **c3bf39f51a873e56c707637c14d5f6353e532b06**, freshCI38170669015 SUCCESS; native1952 PASS +1 expected failure, Website17/POS22,358 browser/HTTP, no journey skips. f7bd361 is documentation; latest application source e9b1a19. Restored working content matched all687 remote files exactly; local ref/index advanced to verified history without working-file loss after audit reporting. PR41 OPEN/DRAFT, no merge/production approval.

The explicit resume overrides the historical safe-pause STOP, not storage/provider/release controls. [WEBSITE_STUDIO_BROWSER_ACCEPTANCE.md](WEBSITE_STUDIO_BROWSER_ACCEPTANCE.md) records all remaining stages/dependencies/acceptance gaps and all A–X gates. Existing route-handler E2Es use mocked sessions; native green is not a cookie/browser/full journey certification. Subscription FAILED-payment retry expected failure is investigated and preserved, not silently authorized/resolved.

Selected next dependency-safe milestone: actual cookie-authenticated production-mode Next HTTP/browser/native-DB test gate (retail/food/salon), real edit/preview/publish/customer/cart/quote/zero-deposit booking/tenant/history/login flows, synthetic entitlement explicitly NOT provider evidence.54 runner-boundary tests PASS; local full1947 PASS/108 DB-e2e SKIP; lint/types/offline build/schema and358 existing actual browser/HTTP checks PASS. New native authenticated gate BLOCKED locally; fresh source-head CI still required before passing claims. Concrete authorized draft-metadata/noindex and failed-loader classic fallback fixed with8 unit cases; no auth/payment/tenant permission or dependency/schema/migration changes.

Exact required fixture/write/network/native/prerequisite boundaries and evidence qualification are in the acceptance document. Missing native/Chrome/build configuration is BLOCKED/NOT RUN and fails the required CI gate, not an accepted green skip. Storage remains DEFERRED, durable originals/provider gates BLOCKED; no new real upload/call/provision/spend or original-inline substitute. Once actual M7 CI passes, next small implementation is the reusable registered business-recipe slice with this browser gate as regression. All recipe/AI/platform diversity/full scenes/compression/WebGPU/measured adaptation/analytics/optimization/physical-device/complete Section80/A–X acceptance, security/advisory/runner/inherited diff and payment-policy authorization obligations remain mandatory. **ENGINE INCOMPLETE; NOT MERGED; production NOT DEPLOYED.**


### M7 service-catalogue correction pending final native gate

Actual source-a956fd4 CI38209141677 (job114679180184/comment6118508905) failed overall at salon readiness after95 new authenticated passes; native2017+1 expected/Website17/POS22/connected build/isolation PASS. Three earlier new-harness mistakes (creation201, Puppeteer modifier API, normalized snapshot excludes only draft timestamp) are corrected and retained in report, not erased. Retail/food complete provider-free journeys pass. Salon uncovered genuine product-count-for-service-catalogue defect, reproduced5 category positives failing before change. Readiness now accepts Service rows for booking-only profiles, retains product requirements for commerce/non-booking and both for mixed profiles; financial/ownership policy untouched.15 regressions +3 full-review schema cases added; local1965 PASS/108 DB-e2e SKIP/2073, lint/types PASS. Required correction-head native/authenticated gate still pending; no full engine claim. All original7 stages/108 blocks/A–X and provider/physical/inherited-review/authorization gates remain binding.


### M7 last network contract correction / final CI pending

Actual native flows now cover all3 types through booking/tenant/expiry/logout/login, but source2420b5f run38211455026 overallFAIL129+1 due21 legitimate read fetches incorrectly absent from new harness allowance (only owned GET history/health). Reviewed both server-owned, database/local diagnostic-only implementations; add only those exact GETs, forbid mutations/external and extend2 real cross-tenant negatives. Latest local1967 PASS/108 DB-e2e SKIP/2075,56 safety and115 focused checks PASS, lint/types/syntax PASS. Required final native/browser/all-network result pending. Current read-only npm audits FAIL:19 total16 high/3 moderate; production tree2 (Next15.5.26→reported patch15.5.27 moderate cache-poisoning, source-map-js1.2.1→1.2.2 high DoS). Narrow pin/lock/compatibility/call-site triage remains release gate; no broad/major dependency churn here. No storage/provider/financial-policy/merge/production approval changes. Master108/A–X/full7 stages remain mandatory.


### M7 first native PASS / repeatability qualification

Source5f0a298edbe5b0ec2a603157f9ed945aa696e3b5 matches remote; CI38212669278 attempt1/job114690152115/runner4292b89af85be0dd8594d52622ea3f3bda9e7274 SUCCESS, bot6119062617. Actual native2034 PASS+1 expected, Website17/POS22, authenticated133, existing fixture/HTTP358; native build/migrations/lint/types/seed PASS. New gate uses actual production-mode Next/cookies/native disposable DB; entitlement fixture remains synthetic NOT provider proof. No earlier failure retroactively passed: source d72c7bc's one React418 is unresolved despite diagnostics-only5f0a298 pass; require source-identical follow-up and actual path/SSR diagnosis on recurrence. CLI rerun was refused/no new attempt; planned documentation-only push triggers normal PR CI. Gzip116460/147687/106724 B; mini4876 B initially excluded. No package-lock/schema/migration/auth/payment-policy changes. After stable foundation/repeatability and narrow current production advisory triage, registered business recipes remain next engine slice, not already delivered by M7. All original7 stages/108 blocks/A–X remain open mandatory; storage DEFERRED/originals/providers BLOCKED/device/full-provider journey NOT RUN; NOT MERGED/production NOT DEPLOYED.


### M7 source-equivalent repeat PASS / next dependency-safe tasks

Evidence delivery58829dd6cb12a3e5f029b4712546959d39bf8b8e differs from app source5f0a298 ONLY3 docs; fresh CI38213614397/job114693146998/runner568aa21bf220dafec26e44e7b17056a45fc222a7 SUCCESS, actual bot6119192075. Native2034+1 expected/166files, Website17/POS22/authenticated133/fixtureHTTP358, native build/lint/types/15 migrations/seed PASS again; clean/equal verified remote; PR41OPEN/DRAFT, no merge/deploy. Repeat requested at previous checkpoint completed, not still pending. Two source-equivalent passes do NOT fix/waive earlier React418: prioritize controlled SSR/navigation/seed reproduction+targeted regression, narrow production advisory pins/call-site triage, then registered reusable business recipes. All7 stages/108 original blocks/A–X and blocked device/provider/full-financial journey obligations remain binding.


## M8 user-ordered continuation (2026-10-12)

1. Read-only45e537c/current remote/clean/PR41DRAFT/current native CI38214337060 verified and baseline reported before code.
2. Proven actual booking SSR local-midnight/clock defect reproduced before edits (4unitFAIL, real ChromiumNairobi418); serialized server calendar fixes it without slot/payment/auth changes. Historical unlocalized418 not conclusively attributed.12 unit/25 isolated browser/local1979PASS+108DBskip; native +27 route/timezone/+3 calendar checks pending push. Detailed evidence: WEBSITE_STUDIO_HYDRATION_INVESTIGATION.md.
3. After native verification, audit each19 finding/paths/compatible fixes, prioritize2 production-tree; no broad audit-fix/major churn. Native build/regressions mandatory.
4. Only after Phases2/3 verified, registered functional retail/food/salon business recipes through existing renderer/editor/schema/commerce and current native/cookie gate; no superficial variants.
5. All original108 blocks/all7 stages/A–X/full acceptance remain; provider/originals BLOCKED by storage DEFERRED, device/CWV/full-provider journeys NOT RUN. No merge/production/data/cost operation authorized.


### M8 Phase2 PASS / Phase3 compatible fixes pending native

ActualPhase2 db853d6/CI38218114522 SUCCESS (2054+1 expected,17/22,163 cookie/native,25isolatedSSR,358fixtures/HTTP). Booking timezone/midnight defect and2 discovered shop boundary/data-contract defects have regressions; historical aggregate418 stillunlocalized. Phase3 production Next15.5.27/source-map-js1.2.2 and scoped compatible dev fixes clear9/19 rows;0production PASS/full10highDEV FAIL. Matrix documents every package/advisory/path/mitigation; major Tailwind/Puppeteer/Node changes not silently accepted.13 new tests, CSS byte-equivalent, local2000PASS/108DBskip,lint/types/schema/offlinebuild separate; fresh native verification pending. Phase4 not implemented before this verification; remaining full-security gate not waived. Full108/all7/A–X, storageDEFERRED/originals+providersBLOCKED/physical-provider acceptance unchanged.


### M8 Phase3 native verified / Phase4 authorized with security gate held

7ad09de/CI38220541803 SUCCESS2067+1expected,17/22,163actualcookie+25isolatedSSR+358fixtures/HTTP; native schema/build/migrate/seed/lint/types PASS. Productionaudit0PASS/full10highDEVFAIL remainsreleaseblock. User explicitProceed authorizes independent3category recipes only, no risk waiver/broadCSSNode migration. New exactv1 business configs/newv2 seed/non-enrollmentlegacy, functional retailProductGrid+stock/options/foodMenu+ownerfacts/order/salonServices+duration/realbooking, explicit editor details/layout &faithful preview/public snapshots.23 new cases, local2023PASS/108DBskip; actual required GUI/no-JS/facets/foreign/config/price guards extended, native pending. Detailed scope/remaining13categories: WEBSITE_STUDIO_BUSINESS_RECIPES.md. Original108/all7/A–X/fullHero/AI/worlds/performance/provider/device gates remain; no engine-complete/merge/deploy claim.


### M8 Phase4 native PASS / Phase5 handoff (source a622a8c)

Actual sourcea622a8cce67d6775baddfdbe455950eea03db599/CI38224011179/job114726938117/runner8ddbf8850a2eb537bc3921e36598295b362f422e/bot6120715247 SUCCESS:2090+1expected/172files,17Website/22POS,210real-cookie/native,25isolatedSSR,358otherHTTP/browser; native validate/generate/15migrations/seed/build/lint/types PASS. Three initial functional catalogue recipes verified, not complete category/world stacks; other13 categories remain open. Production audit0 PASS/full10highDEV FAIL; userProceed allowed independent recipes, no waiver/migration/deployment/merge. Metadata restoration reconciled701old/706latest exact blobs and same-branch verified fast-forward, no work discarded or recipe rebuilt. All changed paths/evidence/risks/exact next in WEBSITE_STUDIO_M8_HANDOFF.md. Next: professional service/enquiry recipe with actual Service-only, quote/contact/booking and same preview/tenant/payment/native controls. Parallel full-security/historicalhydration/payment-policy/provider/device/AI/scene/performance/7-stage/A–X gaps mandatory; storageDEFERRED/originalsprovidersBLOCKED; NOTMERGED/productionNOTDEPLOYED.
