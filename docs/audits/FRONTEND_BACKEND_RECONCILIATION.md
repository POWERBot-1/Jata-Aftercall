# Frontend–backend reconciliation

**Assessment baseline:** `044ca8a948cdc058a2b992a4e9a7d405d3b2c3c3`.
**Method:** source route/component/service inventory, repository test discovery and candidate CI on code SHA `0cd537d5f273048ec8da8c6560be2342b9786eb1` (disposable PostgreSQL and real-Chrome capture workflows passed). No live user data, real payment/provider, or production API call.

## Feature-path map

| User action | Frontend | Server/API/service | Authorization and persistence boundary | Response/UI state | Reconciliation result |
|---|---|---|---|---|---|
| Sign up / sign in / reset password | `RegisterForm`, `LoginForm`, recovery forms | `/api/auth/*`, `lib/auth.ts`, registration/reset modules | Server validates; session/token operations; reset delivery requires configured mail service. | Forms expose success/error states in source. No real mail or browser lifecycle run. | NOT TESTED end-to-end |
| Select and buy plan | `PlansClient`, `CheckoutForm`, checkout routes | `/api/checkout`, `lib/paystack.ts`, payment verification and webhook handlers | Only verified payment may activate plan; subscription owner and amount/currency/reference must match. | Callback/status UI exists; pending/failed/duplicate scenarios not tested here. | NOT TESTED end-to-end |
| Edit business details / publish public page | Dashboard and Studio routes | business/experience APIs, publication and storage services | Authenticated business owner, tenant match, publication policy and durable media. | Save/preview/publish state exists. Persistence across reload, public rendering and failure recovery not exercised. | NOT TESTED; durable media is launch-critical |
| Ask business AI | `AIFrontDeskCustomerClient`, merchant AI settings | `/api/ai/chat`, brain, entitlement, publication and lead services | Paid entitlement and published authoritative business context; tenant isolation. | Chat/fallback/CTA states present in source; actual answer grounding not tested. | NOT TESTED |
| Autopilot proposal / approval | Autopilot dashboard pages and controls | `/api/autopilot/*`, proposal/policy services | Consent, subscription, quiet-hour/limit/kill-switch and merchant approval before sensitive action. | Prior tests cover policy/controls, but no live proposal-to-action audit performed. | NOT TESTED |
| POS sale / offline sync / refund | POS pages and client queue | `/api/pos/[businessId]/*`, POS services/transactions | Staff/business authorization, entitlement, idempotency, stock/payment correctness. | Queue/sync/report UI exists; simulated internet loss and server reconciliation not run. | NOT TESTED |
| Admin/agent management | Admin/agent pages and action components | `/api/admin/*`, `/api/agents/*`, auth/admin guards | Server-side role and record ownership checks. | PR #77 status portal UI and screenshots exist in merged history; completeness workflow check failed. | Partial source proof only |

## Observed contract boundary facts

- Business URLs, page metadata, sitemap and robots all share `getBaseUrl()`. Explicit public URL configuration takes priority; Vercel/local fallback behavior is documented in `lib/url.ts`. The effective production value was not inspected because deployment settings are outside the approved code-only boundary.
- Paystack verification is server-side in source. A redirect/query parameter from a browser is not sufficient settlement proof. The test suite contains payment verification, signature, tenant/payment isolation and idempotency tests, but no current-turn payment lifecycle evidence was created.
- AI Front Desk entitlement and grounded business-brain services exist in source and have targeted unit/security coverage. A public experience still requires checking publish state and business data retrieval against a real isolated fixture.
- POS endpoints are nested by `businessId`, and dedicated tenant-isolation/permission/offline-sync tests exist. This is not a complete direct-API negative authorization proof for every endpoint.
- Website Studio's durable media adapter is present and tested as code. Existing Studio documentation identifies storage as unavailable when no approved durable provider is configured. Runtime bucket persistence and public/private access policies remain unverified.
- The visible install instructions formerly displayed the Vercel URL while linking to `/`; the AI QR helper defaulted to `jata.co.ke`. Both stale application references were corrected in this branch and the QR fallback has new tests.

## Release gaps

The complete sequence `action → handler → endpoint → service → guard → DB/provider → response → displayed state` has not been proven for each control. Candidate CI covers selected disposable-DB journeys and browser captures, but does not cover every control or connected product/payment flow. There is no claim here that dead controls, swallowed exceptions, duplicate submissions, stale state, retry behavior, status semantics, tenant checks or entitlement checks were exhaustively ruled out.

Re-run connected E2E with synthetic tenants, a disposable PostgreSQL instance, provider mocks/test mode only and browser traces on the exact final commit. Compare request payloads and status/error schemas, then exercise success, timeout, invalid input, unauthenticated, wrong tenant, expired entitlement, duplicate submit and retry. Never use production data or real payment/customer messaging.