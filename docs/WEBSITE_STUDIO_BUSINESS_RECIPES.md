# Website Studio — registered business catalogue recipes v1

2026-10-12. **First functional recipe slice, NOT the complete engine or all category/hero/world recipes.**

## Ordered work / authorization

Phases1–2 verified starting45e537c/source db853d6 nativeCI38218114522: proven booking SSR clock/timezone defect and2 shop server/client faults fixed with regressions. Historical aggregate418 had no route/stack and remains unlocalized; current diagnostics/error gates retained.

Phase3 source7ad09de/nativeCI38220541803 SUCCESS: production advisory audit0, full audit stillFAIL10HIGHdevelopment rows; all19 reviewed/9 remediated. User subsequently said **Proceed** after the explicit choice about carrying mitigated dev findings. This authorizes independent recipes with full-security release gate stillOPEN/FAIL, **not** a broad Tailwind/Node migration, advisory waiver, provider/cost/merge/production operation.

## Implemented category contracts

| Category / registered key | Data / presentation | Real fields / editable details | Actions / customer controls |
|---|---|---|---|
|Retail / `retail-stock` v1|Real Product rows, responsive product grid/list; featured/category/contact sections from existing profile|Name/description/price/media from stored catalogue; owner can show brand, variant count, availability; headings/layout/hide/move unchanged editor|Search/category/price/stock filters, authoritative cart for simple available products, option-selection detail route for variants/add-ons; quote/sold-out not directly charged|
|Food / `food-menu` v1|Real Product/menu rows, semantic menu list/grouping or owner grid; existing food hero/menu/featured/hours/contact|Owner ingredients, portion, prep time, extras count only when present; owner display toggles; no invented dietary/health/ETA claims|Dish availability/search/category/price, real product/options/order/cart routes; stored prices/stock/availability/fulfilment remain authoritative|
|Salon / `salon-booking` v1|Real Service rows even if unrelated products exist; service lists/grid, services/gallery/hours/contact profile|Stored duration/specialist/deposit info when present, owned prices/images; editable detail toggles|Duration/search/category filtering; no irrelevant stock/cart control; real `/book?service=<owned-id>` for bookable fixed-price services, quote/detail route otherwise; no dummy Product required|

Public media remains optional existing owner/legacy processed URLs with category layout/alt text/lazy decoding and useful no-photo placeholder. No upload, generated image/provider or persistent-original claim. Retail contain / food and service cover treatment; mobile list columns/action wrapping; touch≥44px. Static/no-JS price/details/navigation remain in HTML, no new mandatory animation/3D/SDK.

## Versioning and safe configuration

- Existing outer v1/v2 support unchanged. Exact optional **v2 section config**: `{ businessRecipe: { version: 1, key: <registered category key>, details: <registered field keys> } }`.
- Only3 implemented keys, their category/section combinations and whitelisted detail enums accepted; duplicates, wrong versions/category/section, authority/executable fields/unknown keys rejected. No price, SKU, contact, stock, payment, capability, arbitrary JS/HTML/SQL or URL can be supplied through this config.
- NEW v2 draft seeding attaches its registered recipe to the existing primary section and category-appropriate layout, never adds dummy sections/business facts/catalogue records. Existing normalization never silently enrolls old v1/v2. Existing owners can explicitly enable/disable via the section editor.
- Raw recipe PATCH config is validated after unchanged ownership/CAS checks **before normalization**, so unsupported config cannot quietly disappear and be treated as a successful edit. Empty config disables presentation; legacy empty config still supported.
- Stored section `layout` controls shared home/catalogue rendering; price display remains visible independently of optional metadata toggles. Primary recipe section determines shop config/layout; each home section uses its own explicit configuration.
- Pure public card contract includes only slug/category capabilities/add CTA/actual approved card style. Original price/stock/variant/deposit/availability rows and IDs come from tenant-scoped loader; no private draft/owner/workspace data crosses the client card boundary.
- Draft changes remain private, preview uses the same renderer, publish validates same document/reviewed revision, history snapshots exact published JSON. Existing server authorization/entitlement/payment/signature/amount/currency/reference guards unchanged. Synthetic browser paid entitlement is NOT payment-provider verification.

## Verification scope

23 new recipe/schema/rendering regressions cover new seed/legacy non-enrollment, exact config versions/fields/category/section, metadata/layout persistence/disable, missing facts omitted, correct Product/Service source without dummy rows, actual SSR/home/catalogue/cards/media/CTAs, options/quote/sold-out handling and authoritative price retention. Existing new-draft-content invariant initially failed on intentional config addition; it now requires the exact registered food config on the primary menu and full equality for every other content field/section, not broad filtering.

Local full2023 PASS/108 DB-e2e SKIP/2131,162 PASS/12 SKIP files; recipe focused52 PASS, lint/types/syntax/whitespace and25 isolated booking hydration checks PASS. Missing local nativeDB/engine remainsBLOCKED, not fake success.

Required connected cookie/browser runner extends all3 real HTTP-owned fixtures with owned metadata and verifies seeded recipe v1, raw unsupported recipe refusal/no overwrite, actual section-checkbox saves, hidden/shown details in authenticated same-route preview/noindex, unchanged monetary fields/no salon dummy products, exact reviewed publication/history, public category recipe, no-JS360px facts/no overflow, actual stock/duration/search/no-match recovery, foreign recipe PATCH refusal, and existing Website/POS/cart/quote/booking/expiry/login/zero-runtime/no-provider/media cleanup checks. Actual source-head results recorded after normal push; until then native acceptance is pending.

## Not yet completed / exact next slice

These3 **catalogue/service/menu** recipes are implemented, not full HeroReveal/Product360/ServiceJourney/ASK JATA worlds or complete category stacks. Other13 required business categories retain their existing profiles/generic renderer but have no new registered business recipe yet: beauty/fashion/electronics/automotive/realestate/furniture/fitness/creative/professional/hospitality/education/technical/other. Extend next to one independent service/enquiry or quote/listing recipe with the same real tenant, preview, price and no-dummy evidence; do not declare all categories complete.

Mandatory original108 blocks/directive/7 stages/A–X stay unchanged. Full dependency-security remainsFAIL10dev; historical hydration attributionOPEN; subscription retry/refund/cancel policy unchanged/unapproved. Original/provider storage acceptanceBLOCKED by DEFERRED approval; physical representative Android/networks/memory/CWV/real provider settlement/fullpayment/ASK JATA/POS/immersive/type journeys NOT RUN/open. No merge, production deployment/data, activation, upload, paid provisioning/spending authorized or performed.


## Actual native source acceptance

Source **a622a8cce67d6775baddfdbe455950eea03db599**, CI38224011179/job114726938117 SUCCESS; runner8ddbf8850a2eb537bc3921e36598295b362f422e, actual bot6120715247. All210 required production-cookie/native-DB checks PASS, including actual recipe-checkbox persistence/guarded hide-show preview, invalid/foreign recipe rejection/no overwrite, exact price/data/no dummy service/product assumptions, reviewed publication/history/live isolation, public/no-JS/touch/search/facet/no-match recovery and existing financial/tenant/runtime/cleanup gates. Native2090+1expected/17Website/22POS,25isolatedSSR,358otherbrowserHTTP and native validation/generation/migration/seed/build/lint/types PASS. Entitlement remains synthetic NOT provider verification; fullaudit10highDEV remainsFAIL, physical/provider/fullengine gates not closed. Evidence-only delivery SHA/currenthead CI recorded on PR/handoff. No newer recipe work overwritten in metadata recovery.


## Fourth recipe — professional-enquiry v1 (M9, native pending)

The professional source combines actual Service-only catalogue/consultant facts/request-type search/facets with separate async quote/information requests and existing fixed consultation bookings. Same exact safe v1/v2 section schema/editor/preview/snapshot controls; no dummy Products/stock/cart assumptions or blanket enrollment of legacy. New request form stores only a durable tenant-scoped RECEIVED lead in the existing lead ledger; no fake appointment/date/order/payment/marketing/deposit waiver. Explicit owner board/duplicate-safe retry/DB-failure refusal/anonymous/foreign/publication checks, real native-cookie acceptance pending. Detailed evidence: WEBSITE_STUDIO_PROFESSIONAL_ENQUIRIES.md.12categories still have no new registered recipe; no full-category/provider/security completion claim.
