# Website Studio — professional service/enquiry recipe v1

2026-10-12. **Scoped M9 continuation; engine/release not complete. Storage DEFERRED, providers/originals BLOCKED.**

## Read-only baseline / reproduction

Start HEAD/remote/PR41 **bb72507ee902570d89aa63e41fa6605eb57122b0**, clean; exact CI38228773648/job114742767287/runnerad787e49f4828bc12238f864578043f8a4ba42d9 SUCCESS, native2090+1 expected/Website17/POS22/210cookie/25SSR/358other checks. Latest reports/acceptance/recipe contracts/PR receipt read before edits; master108/directive unchanged3bae22f5…; no reset/discard/new branch.

Source showed professional quote/nonbookable work entering BookPage's mandatory appointment calendar; the public booking POST intentionally rejects booking-disabled services, and the page could substitute an owned first service for an unavailable query ID. Added4 actual BookPage regressions **before modifying routing**: all4 FAIL (quote/nonbookable not redirected, unknown ID substituted, quote exposed in appointment selection). Fixed only professional routing: quote/nonbookable→request-only enquiry, invalid ID404, fixed bookable consultations remain on the existing dated booking path. Existing other-category booking/deposit/past-time/capacity/payment code unchanged.

## Fourth registered business recipe / shared owner controls

`professional-enquiry` v1, new-v2 explicit seeding to Services; old v1/v2 not silently enrolled. Exact category/section/version/field contract remains the same safe presentation-only parser. Real Service rows only (even with unrelated Products); optional owner professional/staff/duration/booking-deposit facts, headings/layout/hide-show controls and same home/shop/preview renderer. No price/capability/contact/stock/payment authority in config.

- Quote/nonbookable services link directly to `/b/[slug]/enquire?service=<owned id>`; fixed bookable services retain `/book?service=<owned id>`.
- Professional request-type facets distinguish consultation appointments vs quotation/information requests; duration/search/category retained, no stock/cart/dummy Product assumptions.
- Actual item detail has one appropriate professional CTA, not duplicate booking links.
- Existing optional legacy/processed service media, accessible static/mobile HTML and reduced-motion/static behavior retained; no real upload/image provider/GPU feature enabled.

## Request-only semantics / durable storage

New public POST `/api/storefront/enquiry` accepts ONLY slug/service ID/customer contact/notes/idempotency key. It resolves the stored published/active business, validated published professional document and ACTIVE service scoped by that business. Client tenant, price/deposit/status/date/service title/marketing/executable fields are rejected. Origin/JSON/bounded4KB body/input/rate limits fail closed. Unknown/foreign/inactive/service and unpublished/suspended/nonprofessional/malformed documents cannot write.

**An enquiry is not a Booking, Order or Payment.** No date/time invented, appointment confirmed, charge initialized, deposit waived or customer added to marketing. Fixed/paid bookings retain existing financial/availability paths. Enquiry acknowledgement explicitly says no appointment/payment confirmed.

The existing `AIQualityEvent` tenant lead ledger used by `lib/leads.ts` stores the minimum structured contact request (LEAD_GENERAL_INQUIRY/channelwebsite_studio_professional/referenceIdactualService/transactionalOnly). It is private transactional lead data, not public analytics, AI-provider output or binary/original storage. This reuses existing schema/Neon; **no migration/new model**.

Unlike legacy captureLead's in-memory/offline fallback, this endpoint requires configured database +an actual persisted row ID; DB failure503 retains the form for retry, never fake201. Unique server-derived primary key incorporates tenant+customer idempotency token; native primary-key conflict replays identical normalized input once, changed input409/no overwrite. No in-memory replay authority. Request-only status RECEIVED; owner source service title and ID captured server-side. Contact data never appears in public receipt URLs, browser localStorage or analytics.

## Owner read / failure handling

GET on the same endpoint uses actual authenticated session and server tenant `read` guard BEFORE querying rows, private/no-store response, excludes raw replay signature/key; anonymous401/foreign403. Professional Studio overview mounts a read-only enquiry board with refresh/error state. This is an in-app durable ledger, no external notification/provider call or AI-package entitlement bypass. Customer data stays with the owning business's existing lead/privacy architecture.

SSR enquiry page follows existing owner/member/admin draft-preview permission; known draft preview keeps real service facts but disables submission, API refuses unpublished writes anyway. Public selected service must belong to that slug, never substitutes a different service. No-JS HTML remains readable with Call/WhatsApp fallback; sending the form requires JS, explicitly disclosed.

On failure, customer fields are retained and the same idempotency key reused for unchanged retry. Field changes create a fresh key. Success clears contact inputs. Durable request success is separate from optional measurement; only server-side ENQUIRY_SUBMITTED analytics (hashed IP/session/actual service ID, NO contacts) recorded once, measurement failure does not discard the saved lead.

## Tests and evidence qualification

-4 pre-fix professional routing FAIL→4 PASS; actual components/SSR, mocked data/session context—not native/browser proof.
-13 enquiry contract/form/seed/service-source tests;17 mocked route tests (tenant authority, publication/service scope, DB-failure/no fallback, bounded/origin, duplicate/concurrent/changed retry, PII-safe receipt, owner guard/DTO).
-3 professional SSR/detail/request-type cases and extra fourth recipe seed test extend existing catalogue tests. The old unsupported-category invariant moved to still-unimplementedtechnical; exact4-layout registry asserted, not broadened/deleted.
-57 existing+new runner-boundary checks; exact reviewed `/api/storefront/enquiry` GET/POST permitted only on disposable local origin, all DELETE/PATCH/PUT/external/provider requests still rejected. Application GET auth is proved independently.
-5 new real-Prisma cases cover durable row/re-read/no booking/order/payment/deposit change/concurrent replay/no duplicate analytics/foreign and draft refusal/owner contact isolation. Locally SKIPPED without configured native DB; not presented as passed.
-Local full **2062 PASS/113 DB-e2e SKIP/2175**,165 PASS/13 SKIP files; lint/type/syntax/whitespace PASS after one new JSX apostrophe lint error corrected (no rule disabled). No dependency/lock/schema/migration/booking/payment/refund/cancel policy diff.
-Required cookie/native runner extends the first3 types with a fourth real registered professional fixture, a quote/nonbookable Service and a real fixed consultation (no Products). It tests actual owner recipe checkboxes/private preview/publication/history, request facets, real browser enquiry201/native ledger/owner board, replay200/conflict409, anonymous/foreign/authority denial/no overwrite, unpublished draft refusal/no-JS contact/no fake appointment, fixed zero-deposit booking, all4 tenant/SSR/timezone/privacy/runtime/network/cleanup guards.
-Connected/native source-head outcome is recorded after normal push; local engine=none type generation is not that proof. Entitlement remains synthetic providerVerified:false, not provider payment verification. No paid deposit/provider call executed by browser tests.

## Remaining / next task

This completes the **first professional catalogue +actual asynchronous request +existing consultation** recipe slice, not all professional legal/retainer/payment workflows or engine. Four registered categories now;12 remain generic profiles: beauty/fashion/electronics/automotive/realestate/furniture/fitness/creative/hospitality/education/technical/other.

Next independent category slice: technical services with owned Service-only quotation/contact/appointment semantics and same safe config/edit/preview/paid-publication/durable tenant request/runtime/native-cookie gates. Enquiry endpoint currently supports professional only; extend explicitly after category-specific tests, not blanket capability authority.

10HIGHDEV dependency findings remainFAIL/OPEN with user-authorized independent development, not a risk waiver/broad migration. Historical unlocalized418 still not conclusively attributed; retain error diagnostics. FAILED-subscription retry/refund/cancel policy unapproved/unchanged. All108/all7stages/A–X, fullHero/AI/diversity/world/compression/justifiedWebGPU/adaptation/analytics/performance/device/verifiedprovider/payment/ASKJATA/POS/type acceptance mandatory/open. No merge/production/data/provider/storage activation/real uploads/provisioning/spending. **ENGINE INCOMPLETE; NOT MERGED; production NOT DEPLOYED.**


## First actual native run (not acceptance)

c3c9563/CI38234955080/job114763230878/bot6122238721 FAILED at unpublished-enquiry expected404/no-write. Native2134+1expected/176files, Website17/POS22/connected build and5 real DB enquiry tests PASS; browser173+1, cleanup4/serverstop PASS. No response status/root guessed: preserve the check, add safe status/error/origin-host-protocol diagnostics. Live enquiry UI/owner/replay/consultation/4type final/downstream cases NOTRUN, not local-proof acceptance. No financial/publication/origin guard weakened.


## Origin normalization regression (second native result)

ec3af7f/CI38235794238/job114766020675/bot6122374037 FAIL173+1. Native diagnostic proves Next requestURL uses0.0.0.0 while browser Origin and incoming Host use localhost on the same dynamic port;403 erroneously precedes correct404publication guard. Added2 HTTP/HTTPSproxy regressions FAIL before change, foreign/spoofed-forwarded-host denial staysPASS. Exact origin check now derives browser-facing Host +validated transport protocol, never wildcard/external forwardedhost; incomingHost/proto is browser-facing proxy information, not tenant or payment authority. All20route cases/94focused/lint/types pass; latestlocal2065PASS113DBskip2178. Actual source-head native enquiry flow stillpending, no claim it passed yet.


## Third native result / real link action pending

4e8099d/CI38236701970/job114769047509/bot6122515825 FAIL217+1. Actual origin+unpublished/draft readonly checks, full owned professional edit/preview/publish/snapshot/noJS/source/facets allPASS; selected enquiry-link click did not reach form within25s. Keep target assertion; add safe href/viewport/hit target/path diagnostic and actual centered trusted click, no forced JS/goto/API/timeout workaround. Native5 ledger cases alreadyPASS, but browser enquiry submission/replay/owner/fixed/final/downstream remainNOTRUN until nextsource. No endpoint financial/tenant rule modified by this driver action.
