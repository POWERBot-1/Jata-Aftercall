# JATA AFTERCALL remediation audit (read-only, before implementation)

Audited the dashboard subscription and onboarding pages/forms, business/checkout/Paystack routes, callback and mock checkout pages, public business route/component, tenant/publication/plan helpers, URL/auth configuration helpers, and Prisma schema. No production data or credentials were accessed. Findings below are based on the checked-in implementation, not a live transaction.

## Findings

### A1 — Checkout presentation and onboarding journey are misleading/incomplete
- **Observed:** The subscription page links to onboarding with “Create business & pay”, although onboarding creates a business and then takes the user through services/publishing; it never selects a plan or initiates payment. Its redirect can send users with existing businesses away from creation. `/checkout` itself is only a “Pay with Paystack” button and has no automatic/clear validation or plan/business summary.
- **Expected:** Create business, save it, then offer an actionable plan selection and checkout with the created business ID; existing businesses can select a plan and proceed.
- **Root cause:** UI/navigation defect and missing implementation: onboarding ends at publish, with no payment continuation. Subscription page label overpromises. This is distinct from the checkout API, which does initialize Paystack when supplied a valid context.
- **Affected:** `app/dashboard/subscription/page.tsx`, `app/onboarding/page.tsx`, `components/OnboardingForm.tsx`, `app/checkout/page.tsx`, `lib/subscriptionFlow.ts`.
- **Security implications:** Checkout must retain server-side tenant and plan checks; do not fix this by accepting client-owned identities or prices.
- **Recommended remediation:** Make post-create onboarding continue to plan selection (and provide an explicit skip/return path if appropriate); ensure both new and existing business paths preserve business/plan IDs, loading state, and actionable errors.
- **Required tests:** UI/context tests for newly created business → plan → checkout and existing business → plan → checkout; no-business state does not open unusable checkout.

### A2 — Payment verification trusts weak callback inputs and can create unauthorized activations
- **Observed:** `/api/paystack/verify` permits verification without a session; with no secret it accepts `?mock=success` in this public route. Successful Paystack verification checks amount but not transaction reference or currency, returns payment data, and updates payment separately from subscription activation. Failed responses include raw error messages. Callback displays success based on this endpoint.
- **Expected:** Authenticated payment owner (or tightly scoped non-guessable callback design) can request verification; only an authoritative matching Paystack reference, amount, currency, status and payment association can atomically settle and activate. Browser redirect is not proof.
- **Root cause:** Authentication/authorization defect, Paystack verification defect, state-transition defect, and unsafe mock-route design; payment/subscription writes lack a transaction.
- **Affected:** `app/api/paystack/verify/route.ts`, `app/checkout/callback/page.tsx`, `lib/paystack.ts`.
- **Security implications:** A guessed or leaked reference could be used to trigger unauthenticated verification; an amount-only match can accept an inconsistent transaction; mock success is an activation bypass if deployed without a key.
- **Recommended remediation:** Require session ownership for browser verification; remove public mock activation from production route and isolate deterministic mocks to tests; require exact reference/amount/currency/status match; atomically transition payment and subscription with durable idempotency; return sanitized status only.
- **Required tests:** unauthenticated/other-user denial, mismatched reference/amount/currency, unsuccessful/cancelled/expired transaction, successful activation, duplicate callback.

### A3 — Webhook idempotency and validation are not safe under malformed, replayed or mismatched events
- **Observed:** Signature verification is present, but webhook payloads are cast without shape validation; success events check amount but not currency or Paystack reference/status through the verification API. Unknown references are marked processed, and payment/subscription/webhook marker writes occur separately. Signature-failure audit stores part of the received signature. Event fallback IDs can be time-based.
- **Expected:** Validate signed payload shape and exact payment association; verify the transaction’s authoritative status/reference/amount/currency; make payment activation and event idempotency race-safe; never log signature material.
- **Root cause:** Webhook/callback defect, validation defect, state-transition defect, and security-sensitive logging defect.
- **Affected:** `app/api/paystack/webhook/route.ts`, `lib/paystack.ts`, `ProcessedWebhook`/`Payment`/`Subscription` schema.
- **Security implications:** Replays/races or malformed events could cause inconsistent payment state; partial signature logging unnecessarily retains secret-adjacent material.
- **Recommended remediation:** Strictly validate event shape, compare reference/amount/currency and verified status, atomically claim event and settle payment/subscription, and log only safe event outcomes.
- **Required tests:** signature invalid, malformed JSON/payload, mismatched amount/currency/reference, unknown reference, duplicate delivery/race, successful activation once.

### A4 — Location is text-only in onboarding and directions may fabricate a destination
- **Observed:** Business creation and PATCH persist only `location`; onboarding exposes no latitude/longitude. The public page generates a Maps search for `business name + empty location` whenever a phone exists, creating a misleading action for businesses without a saved location. `Business.lat`/`lng` exist but are unused.
- **Expected:** Owner-authorized location editing supports validated optional coordinates and human-readable address; directions use coordinates, else actual saved text, else no action.
- **Root cause:** UI/validation/persistence defect for coordinates and directions-generation defect.
- **Affected:** `components/OnboardingForm.tsx`, `app/api/business/route.ts`, `components/BusinessPage.tsx`, `app/b/[slug]/page.tsx`, `Business` schema.
- **Security implications:** PATCH currently uses tenant guard (ownership or membership), which must remain. Location updates must not infer owner identity from request payload.
- **Recommended remediation:** Add coordinate inputs and strict range/partial-pair validation to create/update; pass coordinates to the public component; create directions URL only from valid coordinates or nonempty saved location.
- **Required tests:** owner location/coordinates persist; unauthorized update blocked; malformed/out-of-range/partial coordinates rejected; coordinate and text-only directions; absent location has no link.

### A5 — Existing-business plan selection can choose a wrong context and plan-only checkout is unusable
- **Observed:** Subscription selection infers the selected business from the first subscription or first owned business; it does not validate a requested `businessId` before displaying the page. The no-business plan cards can link to `/checkout?planId=...`, which cannot initialize because businessId is mandatory. The no-subscription message can hide available plan actions in some business/subscription states.
- **Expected:** Explicitly select an authorized business, show active database plans, and link only to valid business+plan checkout.
- **Root cause:** UI/navigation and parameter-propagation defects.
- **Affected:** `app/dashboard/subscription/page.tsx`, `lib/subscriptionFlow.ts`, `app/checkout/page.tsx`.
- **Security implications:** The API currently checks business ownership; this must remain authoritative regardless of UI selection.
- **Recommended remediation:** Query authorized businesses, reject/redirect invalid selection, require selection before checkout, and consistently render available plans for the selected business.
- **Required tests:** no-business, invalid businessId, multiple businesses, ownership enforcement, valid plan context.

### A6 — Subscription activation is fragile and publishing logic does not represent the requested lifecycle
- **Observed:** Activation uses a separate `ProcessedWebhook` marker as a second idempotency mechanism and performs subscription upsert, business activation, and marker creation in separate writes. A retry/race can leave partial state. The public page decision is based on publication/ownership and the expiry branch only displays a banner; `Business.status` is set ACTIVE during activation but is not part of public-page access decision. Publishing is independently permitted by `canSetPublished`.
- **Expected:** Deterministic transactional payment → ACTIVE subscription and business state; preserve existing publication/expiry policy without weakening access.
- **Root cause:** State-transition defect and test-coverage/policy consistency concern. Existing publication policy intentionally allows publishing without payment; this audit does not recommend changing it without product confirmation.
- **Affected:** `lib/paystack.ts`, `lib/publication.ts`, `app/api/business/route.ts`, `app/b/[slug]/page.tsx`, schema.
- **Security implications:** Do not make all businesses public or activate based on client state. Preserve draft privacy.
- **Recommended remediation:** Use transactional, reference-idempotent activation; preserve `isPublished` and current public expiry behavior unless verified product policy says otherwise; add tests that lock the intended policy.
- **Required tests:** activation start/expiry from authoritative plan duration, duplicate settlement, draft remains protected, published page policy regression.

### A7 — Error handling and configuration reporting need hardening
- **Observed:** Checkout initialization and verification may return upstream error messages or log thrown objects. Paystack setup is optional in code and mock checkout is presented when secret is unset. `getBaseUrl` accepts `PUBLIC_BASE_URL`, then `NEXTAUTH_URL`, then Vercel host. Prisma requires `DATABASE_URL`; auth uses `AUTH_SECRET` or `NEXTAUTH_SECRET`; Paystack uses `PAYSTACK_SECRET_KEY`; optional merchant metadata uses `PAYSTACK_MERCHANT_ID`.
- **Expected:** Safe actionable customer errors without upstream payloads/secrets; explicit non-production mock/test strategy; document required configuration by variable name only, without disclosing values.
- **Root cause:** Environment/configuration and error-handling defects.
- **Affected:** `app/api/checkout/route.ts`, verify/webhook routes, `lib/paystack.ts`, `lib/url.ts`, `lib/auth.ts`, build/config docs.
- **Security implications:** Raw provider errors and signature fragments are unnecessary disclosures; never print configuration values.
- **Recommended remediation:** Map provider/config failures to safe messages; keep the secret server-only; use test doubles in tests rather than public mock activation; report configuration presence only when the runtime environment safely permits it.
- **Required tests:** missing configuration, provider failure, sanitized errors; inspect logs/output for secret values.

## Schema/configuration observations

- `Business.location` (nullable text), `lat`/`lng` (nullable floats), `isPublished`, and `status` already exist; no schema migration is indicated by this audit.
- `Subscription.businessId` is unique; user/plan/status/start/expiry fields are present.
- `Payment.reference` is unique; payment links user, optional business/plan, amount in minor units and currency.
- `ProcessedWebhook.id` is the only webhook deduplication key.
- Code references `DATABASE_URL` (Prisma), `PAYSTACK_SECRET_KEY`, optional `PAYSTACK_MERCHANT_ID`, `PUBLIC_BASE_URL`, `NEXTAUTH_URL`, and `AUTH_SECRET`/`NEXTAUTH_SECRET`. Runtime values were not printed or accessed for this report.

## Verification scope before implementation

The source inspection identifies the defects above. The audit does not assert live Paystack or production configuration status. Subsequent verification should use deterministic mocked providers and the repository test/build commands; no real charge or production database operation is authorized.
