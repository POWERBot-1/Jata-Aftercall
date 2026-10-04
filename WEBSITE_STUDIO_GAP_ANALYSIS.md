# JATA AFTERCALL — WEBSITE STUDIO: GAP ANALYSIS

Audit performed against `main` @ `455646c` (merged PR #35) before any code was changed.
Scope: **Website Studio only** (JATA Aftercall Interactive Business). JATA Qi, AI Business
Front Desk, POS and subscription pricing are untouched.

Legend: **EXISTS** (works, leave alone) · **IMPROVE** (works, extend) · **MISSING** (build) ·
**BROKEN** (exists but does not actually work) · **BLOCKED** (cannot be completed here).

---

## 1. What already works (do not rebuild)

| Area | Where | State |
| --- | --- | --- |
| Package journey: choose → edit → preview → plan → pay → publish → live | `app/onboarding`, `app/dashboard/subscription`, `lib/subscriptionFlow.ts`, `lib/experience/entitlement.ts` | EXISTS — KES 999/mo gate, verified payment + active subscription, both enforced server-side |
| Published vs draft separation | `BusinessExperience.draftJson/publishedJson`, `ExperienceVersion`, `lib/experience/document.ts` | EXISTS |
| Publish safety | `lib/experience/validate.ts`, `app/api/experience/publish/route.ts`, `components/dashboard/PublishPanel.tsx` | EXISTS — checklist + server re-check; unpaid sites cannot go live |
| Category intelligence (16 profiles) | `lib/experience/categories.ts` | EXISTS — restaurant/takeaway/salon/beauty/fashion/electronics/hardware/mechanic/furniture/pharmacy/real-estate/professional/fundi-cleaning/photographer-events/accommodation/retail are all covered by aliases |
| Section builder | `lib/experience/sections.ts`, `components/dashboard/SectionEditor.tsx` | EXISTS — reorder/hide/duplicate/edit, no HTML |
| Theme engine + brand colours + WCAG correction | `lib/experience/themes.ts`, `lib/experience/color.ts`, `components/dashboard/ThemeEditor.tsx` | EXISTS |
| Commerce, cart, checkout, orders, bookings, enquiries | `lib/experience/*`, `app/api/storefront/*`, `app/api/orders`, `app/api/bookings` | EXISTS |
| Analytics + insights | `lib/analytics.ts`, `lib/experience/insights.ts`, `app/dashboard/businesses/[id]/insights` | EXISTS |
| Structured data / OG / metadata | `lib/experience/structuredData.ts`, `app/b/[slug]/page.tsx` | EXISTS |
| Public `/b/[slug]` rendering (published JSON only) | `lib/experience/storefront.ts`, `components/storefront/*` | EXISTS — must not break |
| Tenant isolation helpers | `lib/tenant.ts`, `guardTenantMutation` | EXISTS |
| AI copy assistance (deterministic provider) | `lib/experience/contentAssist.ts`, `app/api/experience/assist/route.ts`, `components/dashboard/AssistBox.tsx` | EXISTS — suggestions only, commercial fields forbidden |
| Test/CI discipline | `tests/**`, `.github/workflows/interactive-business-e2e.yml` | EXISTS — real-Postgres E2E gate |

## 2. Broken / high-risk (must fix)

| # | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| B1 | **Mobile photo upload is broken end-to-end.** The picker POSTs `{ businessId, dataUrl, alt }`; the route reads `body.url` only. Every upload therefore falls through to `safeUrl("")` → `""` → 400 "That image could not be read". | `components/dashboard/MediaPicker.tsx:59-64` vs `app/api/media/route.ts:99-116` | §19 HIGH PRIORITY: no owner can add a photo from a phone |
| B2 | 2 MB hard cap on both client and server, applied to a *data-URL* string (≈1.5 MB of pixels after base64). A modern phone photo is 3–8 MB, and iOS uploads are often HEIC. | `MediaPicker.tsx:17`, `media/route.ts:20` | The cap rejects the exact files owners have |
| B3 | No normalization: no resize, no re-encode, no EXIF orientation correction, no HEIC handling, no progress, no retry. Large uploads die on a phone data connection. | `MediaPicker.tsx`, `lib/experience/document.ts:safeUrl` (raster-only, no HEIC) | §19, §20 |
| B4 | Dimensions are parsed for PNG/JPEG/GIF only — WebP (the format iOS/Android produce most often) stores `width=height=null`. | `media/route.ts:dimensionsOf` | Layout shift on the published site (§28) |
| B5 | Validation trusts the data-URL prefix, not the bytes; wrong-extension and malformed files pass. | `media/route.ts:IMAGE_DATA_URL` | §41 |

## 3. Missing capability

| Spec | Gap | Plan |
| --- | --- | --- |
| §5 AI copilot | No contextual assistant in the Studio | `lib/studio/copilot.ts` + `/api/studio/copilot` + `StudioCopilot` drawer; proposals only, grounded, apply/preview/undo |
| §8 AI design generation | Themes exist but nothing proposes a coherent design direction from category + brand + photos | `lib/studio/designDirections.ts` — 3 differentiated directions per category, applies theme + brand tokens |
| §10 copywriting | Deterministic templates only; no hero/FAQ/SEO-title kinds; no real model seam | Provider-agnostic `generateCopy()` + new assist kinds; keeps "never invent facts" allow-list |
| §11–§17 AI photography | Nothing exists: no generate, no enhance, no candidates, no styles, no consistency, no quota, no provenance, no cost control | `lib/ai/*` provider abstraction (`generateImage`, `enhanceImage`, `generateAltText`), `/api/studio/ai/*`, `PhotoLab` + `MediaPicker` UI, `AiGeneration` table, quota + rate limits + prompt-hash caching, representative-vs-actual labelling |
| §14 AI enhancement | Nothing | Provider-backed enhance **plus** an always-available on-device canvas enhancement (lighting/contrast/sharpness/crop) so the button is never a no-op offline |
| §18 media library | Picker only: no search, filter, provenance, cover, crop, alt editing, or reuse surface | `/dashboard/businesses/[id]/photos` page + `MediaLibrary` client; extends `/api/media` (GET filters, PATCH, provenance) |
| §22 undo/redo | Nothing in any editor | `lib/studio/history.ts` bounded snapshot stack + Undo in section/design/copy/image flows |
| §25 conversion optimisation | Nothing | `lib/studio/health.ts` recommendations ("no ordering button", "no opening hours", "hero image is low quality") and a Fix-with-JATA action per recommendation |
| §26 guided SEO | `document.seo` is rendered but **not editable anywhere in the Studio** | `SeoPanel` in the Design page + AI-suggested title/description grounded in business facts only |
| §27 alt text | Alt is stored, but there is no way to edit or generate it | Alt editor in the media library + `generateAltText()` |
| §36/§46 health score | Nothing | Same `lib/studio/health.ts` — readiness score with meaningful, non-gimmicky factors |
| §42 provider architecture | No AI vendor seam at all | `lib/ai/provider.ts` registry; `openai`, `gemini` adapters + always-on deterministic `jata-local` provider; keys server-side env only |
| §43 generation history | Nothing | `AiGeneration` rows (business, user, subject, type, provider/model, status, timing) + history panel, droppable by the owner |
| §44 design consistency engine | Nothing | `lib/ai/designContext.ts` derived from category + brand + theme + chosen direction, injected into every copy/image prompt |
| §45 empty states / §52 copy / §53 micro-interactions | Generic empty states, some jargon | Copy pass on new surfaces only |
| §51 AI cost control | n/a today | Monthly entitlement quota counted from `AiGeneration`, per-business + per-IP rate limits, single retry, timeouts, prompt-hash cache, capped candidate count |

## 4. Improve, not rebuild

| Spec | Existing | Improvement |
| --- | --- | --- |
| §4 Studio navigation | `StudioTabs` (Overview/Sections/Catalogue/Theme/Preview/Orders/Bookings/Insights) | Add **Photos**, **Design**, and a **Health** summary on Overview; horizontal scroll stays mobile-safe |
| §6 onboarding questionnaire | `OnboardingForm`, `CreateExperienceForm` | Copilot-driven "tell JATA about your business" prompts that fill real draft fields |
| §9 sections | 17 types | Add **How it works** (`steps`) as an additive registry entry + renderer; hide/duplicate already work |
| §19–§21 media pipeline | data-URL round trip | Client-side normalize (resize/EXIF/HEIC-where-browser-supports/re-encode) → server byte-sniff + dimension parse for all raster formats → dedupe by hash |
| §39/§40 error & loading UX | Plain errors | Human messages, upload progress, generation states, retry, never lose typed work |
| §54 Kenyan context | KES, WhatsApp, en/sw in AI config | Price/phone guards in generated copy; Swahili-friendly tone carried into image/copy prompts |

## 5. Blocked in this environment (and how the code stays honest)

| Item | Why blocked | Handling |
| --- | --- | --- |
| Real provider calls (OpenAI/Gemini image + text) | No API keys in the sandbox; no outbound network to vendor hosts | Adapters are written, contract-tested against injected fetch, and **fail closed to the deterministic provider** when no key is present. Nothing is faked: the local provider produces a real, valid PNG from a real rasterizer and the Studio labels it as JATA artwork, not a photo |
| HEIC/HEIF upload of a genuine Apple file | No sample HEIC in the sandbox | Magic-byte detection + explicit "convert on your phone/we'll take the JPEG" path; browsers that can decode HEIC are used to normalize it, otherwise the owner gets one clear instruction instead of a silent failure |
| `prisma generate` / migration execution | Prisma engine binaries are unreachable; no Postgres in the sandbox | Migration SQL is written by hand in the repo's existing idempotent style and validated statically; the CI workflow (`interactive-business-e2e.yml`) runs `migrate deploy` + the full suite against Postgres 16 |
| iOS/Android device testing | No physical devices | Regression tests cover the pipeline contract (payload shape, size/format policy, orientation mapping, decode failures) and the browser path is written against `createImageBitmap` with an `<img>` fallback |

## 6. Explicitly out of scope (per §57)

JATA Qi · AI Business Front Desk · POS · subscription pricing · Paystack integration ·
deployment model · custom domains · any new subscription plan · merging the PR.

---

# FINAL IMPLEMENTATION STATUS

Audited against the code as delivered on `arena/01a10809-jata-aftercall`. A feature is marked
**IMPLEMENTED** only when the end-to-end behaviour exists and is covered by a test that fails if
it breaks. Anything a sandbox cannot execute is marked **BLOCKED** with the reason, never
"done".

## IMPLEMENTED

| Area | Evidence in the repo |
| --- | --- |
| Mobile photo upload, end to end | `lib/media/*` (byte sniffing, EXIF, resize/re-encode budget, progress, retry) + `PhotoLab`/`MediaPicker` + rewritten `POST /api/media`. 13 tests drive the real pipeline against a stubbed phone browser and then the real route: `tests/integration/mobile-upload-pipeline.test.ts`. JPG/JPEG/PNG/WebP, a 12 MP EXIF-rotated Android JPEG, the old-WebView `<img>` fallback, HEIC guidance, oversized, malformed, wrong-extension, decode failure, failed upload then retry, dedupe and replacement are all asserted. |
| One storage ceiling for upload and publication | `MAX_STORED_CHARS`/`MAX_UPLOAD_CHARS` in `lib/media/imageFormat.ts`, used by `safeUrl` in `lib/experience/document.ts` and by the encoder in `lib/media/browserImage.ts`. An image that can be uploaded can always be used on the site. |
| AI photography (built-in provider, real output) | `lib/ai/*` provider seam, `POST /api/studio/ai/image`, `PhotoLab` (Generate, candidates, Regenerate, Crop, Use this image, Remove, Save to library). `tests/integration/studio-image-lab.test.ts` (15) generates real PNG bytes, stores them, labels them `REPRESENTATIVE`, records the audit row, proves cache reuse, quota, double-tap rate limiting, cross-tenant refusal, and that the produced URL survives the document sanitiser. |
| Photo improvement | On-device enhancement (`device-canvas`, label `ACTUAL`, original untouched) plus the provider path that reports `not_configured` instead of pretending. Same suite. |
| AI copywriting | `lib/ai/copyLab.ts` + `lib/ai/grounding.ts` + the 12 assist kinds on `/api/experience/assist` (product, service, hero, tagline, about, FAQ, CTA, SEO title/description, offer, alt text). 27 tests in `tests/unit/studio-ai-safety.test.ts` prove fabricated years, awards, certificates, guarantees, delivery times, prices, discounts and statistics are rejected. |
| Media library | Photos page + `MediaLibrary`/`MediaPicker` + extended `/api/media` (search, filter by source, alt/label edit, delete, cover, crop, reuse). 16 tests in `tests/integration/media-route-upload.test.ts`. |
| Undo / Redo / recovery | `lib/experience/history.ts` + `ExperienceDraftRevision` + `POST/GET /api/experience/history` + `StudioHistory` on every Studio screen. Every draft write records a revision, so sections, design, photos, catalogue edits and AI content all undo with one mechanism. Branch replacement after an Undo is verified end-to-end (1 → 2 → NEW 3, no collision, no duplicate): `tests/integration/studio-history-branching.test.ts`. Pure cursor, retention and summary behaviour: `tests/unit/studio-draft-history.test.ts`. Route behaviour (401/403/400/409/200, newest-first summaries, no snapshot leakage, audit rows): `tests/integration/experience-history-route.test.ts`. |
| Website health + “Fix with JATA” | `lib/studio/health.ts` (21 weighted checks), `lib/studio/fixes.ts` (pure, owner-facts-only), `WebsiteHealth` panel. 24 tests in `tests/unit/studio-health-and-fixes.test.ts`, including that fixes needing owner input are skipped rather than guessed. |
| Website Copilot | `lib/studio/copilot.ts`, `/api/studio/copilot`, `StudioCopilot` drawer with Apply / Preview / Undo and a hard ban on writing prices, stock, availability, contact details, hours or legal text. |
| Design directions + brand system | `lib/studio/designDirections.ts`, `DesignPanel`, existing theme engine. Three directions per category that keep the owner's colours. |
| Sections `steps` / `why` | Additive registry entries + storefront renderers, so a new type can never render nothing. |
| Draft vs published separation, publish gate, entitlements, Paystack | Unchanged by this work: no diff in `app/api/experience/publish`, `lib/paystack.ts`, subscription or entitlement logic. The existing suites (`experience-publish`, `payment-*`, `paystack-*`, e2e journeys) pass. |
| Migrations | Two additive, guarded migrations (`20261004000000_website_studio_ai`, `20261004010000_studio_draft_history`), enforced by `tests/unit/repair-guards.test.ts`. |

## VERIFIED (commands run on the delivered tree)

| Check | Result |
| --- | --- |
| `npx vitest run` | 100 files passed, 2 skipped; **1194 tests passed, 44 skipped** |
| `npm run lint` | clean (one pre-existing `<img>` warning in `components/storefront/CartProvider.tsx`) |
| `npm run typecheck` | clean (`tsc --noEmit`) |
| `npm run build` | success, all new routes compiled (`/api/experience/history`, `/api/studio/*`, `/dashboard/businesses/[id]/{photos,design}`) |
| Mobile upload regression | 13 tests, pipeline → real route → stored asset |
| Undo/Redo/branching | 7 tests end-to-end, 17 unit, 12 route |
| AI photography | 15 tests, real PNG bytes |
| Publish gate | existing suites unchanged and passing |

## DEFERRED

| Item | Why |
| --- | --- |
| Real vendor photo generation (OpenAI `gpt-image-1`, Gemini image models) against live APIs | No API keys and no outbound vendor network in this environment. The adapters are written and contract-tested; they fail closed to the built-in provider when no key is set. With keys configured, the same code path returns photorealistic candidates and the `REPRESENTATIVE` label is dropped because the provider reports `photorealistic: true`. |
| Live Apple HEIC decoding | No genuine HEIC file or Safari in the sandbox. Detection, the clear “Most Compatible” instruction and the Safari conversion path are implemented and tested; a real iPhone upload must be confirmed on a device. |
| `prisma generate` / migration execution | Prisma engine binaries are unreachable here. Migration SQL is validated statically against `schema.prisma` (columns, nullability, key, FK, additive-only) and runs in CI via `.github/workflows/interactive-business-e2e.yml`. |
| Studio-wide multi-level undo history across page reloads beyond the 30-revision window | Bounded on purpose (storage predictability); older revisions are pruned, never the newest. |

## Explicitly out of scope (unchanged)

JATA Qi · AI Business Front Desk · POS · subscription pricing · Paystack behaviour · deployment
model · custom domains · new plans · merging the pull request.
