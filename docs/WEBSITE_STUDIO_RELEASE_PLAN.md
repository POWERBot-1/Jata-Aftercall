# Website Studio — release plan

Updated: 2026-10-11 UTC. **Long-term vision NOT COMPLETE; production NOT DEPLOYED.**

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
| Plans | **Corrected audit:** required prices exist, but actual homepage price-sorts Monthly → AI → Annual → Interactive Business and retains old branding. Required Monthly → Annual → AI Front Desk → Website Studio → separate POS order/name is OPEN at M1. Preserve stable `INTERACTIVE_BUSINESS` IDs and server prices/policies. |

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
| 5 | BUSINESS EXPERIENCE SCHEMA | PARTIAL / OPEN | M1 raw v1 validator and explicit version/legacy restore gates tested locally; asset ownership/native DB proof still pending. |
| 6 | EXPERIENCE RECIPE ENGINE | NOT COMPLETE | 19 section types do not satisfy all requested recipes. |
| 7 | CRITICAL UNIQUENESS REQUIREMENT | NOT COMPLETE | Theme/shuffle variants are not the required structural uniqueness. |
| 8 | TEMPLATE FAMILIES | NOT COMPLETE | All 20 compositional families remain mandatory, not implemented. |
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
| 21 | MOTION ENGINE | PARTIAL / OPEN | motion 14.1.0 installed; lazy integration/tests pending; GSAP decision explicit. |
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
| 66 | TEMPLATE RANDOMIZATION IS NOT ENOUGH | NOT COMPLETE | Current seeded theme selection/shuffle is explicitly insufficient. |
| 67 | DESIGN DIRECTION OBJECT | PARTIAL / OPEN | Existing DesignDirection tokens; full reasoning/composition bridge open. |
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
