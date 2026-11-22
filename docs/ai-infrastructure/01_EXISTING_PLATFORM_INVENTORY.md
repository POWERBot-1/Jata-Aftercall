# 01 — EXISTING PLATFORM INVENTORY

**Method:** direct repository inspection at `ee59d95`. Every figure below was produced by a command, not estimated. Nothing was inferred from the repository's own status documents — where those documents disagree with the code, the code is recorded and the disagreement is flagged.

---

## 1. Scale

| Measure | Count | How measured |
|---|---:|---|
| Prisma models | **192** | `grep -c "^model " prisma/schema.prisma` |
| Prisma enums | 28 | `grep -c "^enum "` |
| Prisma schema size | 4,822 lines (190 KB) | `wc -l` |
| Migrations | 65 | `ls prisma/migrations` (excluding lockfile) |
| API route handlers (`route.ts`) | **189** | `find app -name route.ts` |
| Pages (`page.tsx`) | 145 | `find app -name page.tsx` |
| Dashboard pages | 86 | `find app/dashboard -name page.tsx` |
| Components | 161 | `find components -name "*.tsx"` |
| Library modules | 370 | `find lib -name "*.ts"` |
| Test files | 438 | `find tests -name "*.test.ts*"` |
| CI workflows | 12 | `.github/workflows/*.yml` |
| LOC (app + components + lib) | ~159,600 | `wc -l` |

This is not a prototype. Any proposal that treats it as one is wrong.

---

## 2. Products

Eight commercially distinct products, each with its own entitlement module, its own plan key and its own workspace.

| Product | Plan key | Price | Period | Entitlement module | Public? |
|---|---|---:|---|---|---|
| AFTERCALL Monthly | `MONTHLY` | KES 149 | 30d | `lib/subscriptionFlow.ts` | Yes |
| AFTERCALL Annual | `ANNUAL` | KES 999 | 365d | `lib/subscriptionFlow.ts` | Yes |
| AI Front Desk — Starter | `AI_BUSINESS_FRONT_DESK` | KES 499 | 30d | `lib/ai-entitlement.ts` | Yes |
| AI Front Desk — Standard | `AI_FRONT_DESK_STANDARD` | KES 999 | 30d | `lib/ai-entitlement.ts` | Yes |
| AI Front Desk — Pro | `AI_FRONT_DESK_PRO` | KES 1,999 | 30d | `lib/ai-entitlement.ts` | Yes |
| AI Front Desk — Voice | `AI_FRONT_DESK_VOICE` | KES 3,999 | 30d | `lib/ai-entitlement.ts` | **Gated** — hidden and unsellable until `getVoiceReadiness().canSell` |
| Website Studio | `INTERACTIVE_BUSINESS` | KES 999 | 30d | `lib/experience/entitlement.ts` | Yes |
| Business POS | `BUSINESS_POS` | KES 499 | 30d | `lib/pos/entitlement.ts` | Private |
| JATA BOS PRO (ERP) | `ERP_PRO` | KES 3,000 | 30d | `lib/erp/entitlement.ts` | Private |
| MJENGO OS | `MJENGO_OS` | KES 2,000 | 30d | `lib/mjengo/entitlement.ts` | Private |
| JATA Autopilot | `JATA_AUTOPILOT` | KES 2,499 | 30d | `lib/autopilot/entitlement.ts` | Private |
| JATA Autopilot Pro | `JATA_AUTOPILOT_PRO` | KES 6,999 | 30d | `lib/autopilot/entitlement.ts` | Private |
| JATA Autopilot Enterprise | `JATA_AUTOPILOT_ENTERPRISE` | KES 19,999 | 30d | `lib/autopilot/entitlement.ts` | Private |

**Key architectural facts that any integration must respect:**

- Prices are **DB-driven** from `PlanConfig`, never hardcoded at the point of charge. Constants in code (`FRONT_DESK_TIER_PRICING`, `POS_PLAN_PRICE_KES`, …) are used only as assertions and display fallbacks.
- Plan **keys are identifiers**, not copy. `lib/planKey.ts` documents a past bug where a 20-character truncation silently produced unresolvable keys. Keys are matched exactly.
- `PRIVATE_PLAN_KEYS` (`lib/pricing.ts`) can never appear in a payable list. Presentation cards for them are marketing only and grant nothing.
- Each product has **its own** subscription model — there is not one shared subscription engine:
  - `Subscription` (business-level, unique per business)
  - `AIPackageEntitlement`, `InteractiveBusinessEntitlement`, `PosSubscription` + `PosEntitlement`, `ErpSubscription` + `ErpEntitlement`, `AutopilotSubscription` + `AutopilotEntitlement`
  - `MJENGO_OS` resolves through `lib/mjengo/entitlement.ts`
- `JATA_TEAM_FREE_ACCESS` (`lib/team-access.ts`) grants access by append-only audit chain keyed to a phone fingerprint. It is never a fake payment row, is server-only, and is pinned by a test that it is never imported by a client component.

---

## 3. Module map

| Domain | Location | Approx. modules | Notable content |
|---|---|---:|---|
| **AI Front Desk** | `lib/ai-*.ts` (13 files) + `lib/ai/` (12 files) | 25 | Brain, grounding, tools, commerce turn, config, entitlement, publication, readiness, channels, quota, provider registry, local/OpenAI/Gemini adapters |
| **Voice** | `lib/voice/` (13), `lib/telnyx/` (3), `worker/voice-media/` (3) | 19 | STT/TTS adapters, call lifecycle, events, metering, handoff, language (en/sw), Telnyx call control + webhook signature, Dockerised media worker |
| **Autopilot** | `lib/autopilot/` | 15 | Propose→approve→execute→rollback, 50 KB `actions.ts`, policy, security, consent, usage, industry packs, settlement |
| **POS** | `lib/pos/` | 40 | Sales, inventory, credit, receipts, reporting, offline, permissions, publication policy |
| **ERP / BOS** | `lib/erp/` | 29 | Double-entry accounting, invoicing, eTIMS (disabled), procurement, requisitions, approvals, tasks, tax, automation |
| **Business Hub** | `lib/business-hub/` | 11 | Loyalty (stamps + points), enquiries, order requests, promotions, QR identity |
| **Website Studio** | `lib/experience/` (44) + `lib/openpage/` (17) + `lib/studio/` | 60+ | Site schema/versioning, themes, immersive renderer, publication state machine, entitlements |
| **MJENGO OS** | `lib/mjengo/` | 7 | Access, CSRF, settlement, sanitisation (no `dangerouslySetInnerHTML`), workspace |
| **Payments** | `lib/payments/`, `lib/paystack.ts`, `lib/merchant-payment.ts`, `lib/checkout-transaction.ts`, `lib/paymentVerification.ts` | 14 | Paystack (merchant 2006074), M-PESA/Daraja, wallet, idempotency, reconciliation, refunds |
| **Messaging** | `lib/messaging/` | 11 | Segments (GSM-7/UCS-2), campaigns, consent, suppression, Meta WhatsApp Cloud, sender IDs, wallet billing |
| **Agents** | `lib/agents/`, `lib/agent-*.ts` | 12 | Applications, commissions, referral reporting, phone verification, notification replay |
| **Intelligence** | `lib/intelligence.ts` | 1 | Quality events, unanswered questions, demand insights |
| **Platform** | `lib/auth.ts`, `lib/tenant.ts`, `lib/rate-limit.ts`, `lib/audit.ts`, `lib/safeError.ts`, `lib/storage/`, `lib/media/`, `lib/qi/` | 20+ | JWT sessions, RBAC, tenant isolation, rate limiting, audit, R2 storage, Qi seam |

---

## 4. Data model — by owner

| Prefix / owner | Models |
|---|---:|
| ERP (`Erp*`) | 35 |
| POS (`Pos*`) | 31 |
| Agents (`Agent*`) | 22 |
| Messaging (`Msg*`) | 13 |
| Autopilot (`Autopilot*`) | 11 |
| Loyalty (`Loyalty*`) | 10 |
| Website Studio (`Studio*`) | 8 |
| Payments (`Payment*`) | 8 |
| Voice (`Voice*`) | 6 |
| Control plane (`Control*`) | 3 |
| AI Front Desk (`AIConfiguration`, `AIPackageEntitlement`, `AIQualityEvent`, `AiGeneration`, `KnowledgeDocument`, `FAQ`, `UnansweredQuestion`, `DemandInsight`, `AiGeneration`) | 9 |
| Business / commerce core (`Business`, `BusinessMember`, `Service`, `Booking`, `Offer`, `Cart`, `Order`, `OrderItem`, `PreOrder`, `Subscription`, `PlanConfig`, …) | ~25 |

**Tenant isolation pattern:** every tenant-owned model carries `businessId` with `onDelete: Cascade` and an `@@index([businessId])`. Enforcement is application-level in `lib/tenant.ts`, not row-level security. `canAccessBusiness`, `assertBusinessOwnership`, `assertBusinessRole` and `guardTenantMutation` are the four gates. Roles are `OWNER > ADMIN > MANAGER > STAFF > VIEWER` with a weight table, and every failure path is explicitly **fail-closed** (a comment in `guardTenantMutation` records a past bug where `role && …` treated `null` as "allow").

---

## 5. Existing AI capability — precisely what is there and what is not

This section matters most, because it determines whether the directive's "Business Brain / model adapter / retrieval / multilingual voice / agent framework / evaluation" already exists.

### 5.1 Business Brain — **EXISTS, deterministic, tenant-scoped**

`lib/ai-business-brain.ts`
- `getBusinessBrain(businessId)` — throws if `businessId` is absent ("tenant isolation enforced"), then loads business + products + services + FAQs + knowledge + AI config in parallel with an explicit `select` (payment credentials are never selected).
- `detectKnowledgeConflicts(...)` — flags stale prices/stock in uploaded documents versus structured data, resolution is always `STRUCTURED_DATA_WINS`.

`lib/ai-grounding.ts` (963 lines, ~55 exports) — the real retrieval engine:
- `matchCatalogue`, `authoritativeUnitPrice`, `applyBulkUnitPrice`, `stockIsConfirmed`
- `contentTokens`, `singularize`, `unrecognizedProductTokens`, `unlistedProductTokens` — token-based matching with stopwords, unit/pack tokens and non-product-word filters
- `detectPolicyEnquiry`, `interpretOpeningStatus`, `formatDeliveryAnswer`, `formatZoneList`
- `redactSecretsFromPublicText`, `composePublicPaymentText` — output safety
- Intent classification: `isOrderingIntent`, `isConfirmation`, `isBookingIntent`, `isPreorderIntent`, `isHumanHandoff`, `refersToPreviousPlace`

### 5.2 Controlled agent framework — **EXISTS, with a three-tier permission model**

`lib/ai-tools.ts` — `AI_TOOL_REGISTRY` with 22 tools:

| Category | Tools | Gate |
|---|---|---|
| `READ` (10) | `get_business_hours`, `search_products`, `get_product`, `check_inventory`, `calculate_order`, `get_delivery_fee`, `get_faqs`, `get_promotions`, `get_payment_methods`, `check_payment_status` | Entitlement only |
| `WRITE` (7) | `create_lead`, `create_order`, `create_preorder`, `create_booking`, `create_payment_request`, `request_human`, `send_owner_notification` | Entitlement + operational status (`PAUSED`/`MAINTENANCE`/`pauseAllOrdering` block ordering tools) |
| `HIGH_RISK` (5) | `refund`, `cancel_order`, `change_price`, `change_inventory`, `modify_business_configuration` | Requires `authorizedHighRisk === true` **and** actor is not `CUSTOMER` **and** `canBusinessRolePerform(role, "high_risk")` |

Unknown tool names fail to `HIGH_RISK` + `ACTION_REQUIRED`. This is the "human approval for consequential actions" requirement from instruction 10, already implemented and tested.

`lib/autopilot/actions.ts` — owner-side agent with a full audit trail: `proposeAutopilotAction` → `approveAndExecuteProposal` → `rollbackExecutedProposal`, plus `validateAutopilotActionPayload`, `rejectProposal`, `dispatchQueuedAutopilotFollowup`.

### 5.3 Model adapter — **EXISTS, but only for Studio images/copy and Voice**

| Adapter | File | Capabilities | Selection |
|---|---|---|---|
| `jata-local` | `lib/ai/providers/local.ts` (15.5 KB) | Deterministic branded artwork + copy, no network | Always available |
| `openai` | `lib/ai/providers/openai.ts` | Image generate/edit, text | `JATA_AI_IMAGE_PROVIDER` / `JATA_AI_TEXT_PROVIDER` = `openai` |
| `gemini` | `lib/ai/providers/gemini.ts` | Image generate/edit, text | same, = `gemini` |
| Voice LLM | `lib/voice/llm.ts` | Grounded chat completion, OpenAI only, `gpt-4o-mini` default, 8 s timeout, 160 max tokens, temperature 0.2 | `VOICE_AI_PROVIDER=openai` |

`lib/ai/provider.ts` defines the `AiProvider` interface with `generateImage`, `enhanceImage`, `generateText` and a `withRetry` helper capped at **2 attempts** with hard timeouts. There is **no** text-completion adapter for the Front Desk, and **no** embedding adapter anywhere.

### 5.4 Retrieval — **EXISTS as lexical scoring; NO vector retrieval**

No `pgvector`, no embedding column, no embedding call, no vector store in the repository (verified: the only matches for `embedding`/`vector(` are in GLB-safety parsing, a Qi client comment, and a QR route). `KnowledgeDocument` stores `content String @db.Text` and `isApproved Boolean`; retrieval is token matching in `ai-grounding.ts`. This is fast, free, explainable and testable — and it is the single biggest genuine gap for semantic retrieval.

### 5.5 Multilingual voice — **EXISTS at the interface level, English + Kiswahili only**

- `lib/voice/language.ts`: `detectLanguageSwitch` (explicit phrases), `detectLanguage` (Swahili marker heuristic, requires ≥2 hits, explicit switch always wins). Languages: `en`, `sw`.
- `lib/voice/speech/`: provider-agnostic `SpeechToTextAdapter` / `TextToSpeechAdapter`. Adapters: `openai` (STT + TTS), `loopback` (test). `resolveSpeechAdapters` returns `null` when unconfigured — callers must refuse the call.
- `lib/telnyx/voice-readiness.ts`: three-state readiness (`AWAITING_PROVIDER` → `CONFIGURED_NOT_VERIFIED` → `READY`). `canSell` requires provider config **and** `TELNYX_VOICE_LIVE_VERIFIED=true` **and** `VOICE_CALLS_ENABLED=true` **and** `VOICE_CUSTOMER_BILLING_ENABLED=true`. Currently the most likely state is `AWAITING_PROVIDER` — nothing is sold that cannot be delivered.
- `worker/voice-media/` — standalone Docker node (not a Vercel function), HMAC-authenticated WebSocket handshake, healthcheck on `:8787`.

### 5.6 Evaluation infrastructure — **PARTIAL**

| Exists | Where |
|---|---|
| `AIQualityEvent` model (source used, confidence, escalated, customer-corrected, missing-info) | `prisma/schema.prisma` |
| `UnansweredQuestion` model with owner-approved answers | same |
| `DemandInsight`, `recordCustomerQuestion`, `getTopCustomerQuestions`, `recordAIQualityEvent`, `getQualityEvents` | `lib/intelligence.ts` |
| `evaluateAIReadiness(businessId)` — pre-publish checklist | `lib/ai-readiness.ts` |
| 438 test files, incl. behavioural suites `ai-grounding-and-safety`, `ai-business-front-desk-behavior`, `ai-front-desk-journey`, `ai-front-desk-filler-regression`, `ai-payment-request-integrity` | `tests/` |
| `PREVIEW_TEST_QUESTIONS` golden set | `lib/ai-grounding.ts:12` |

| Does not exist | Consequence |
|---|---|
| No prompt/model regression harness (no golden-output scoring for an LLM path) | Adding an LLM has no quality gate today |
| No retrieval quality metric (precision/recall over the catalogue) | Cannot detect retrieval regressions |
| No cost/usage ledger for Front Desk (only Studio quotas in `lib/ai/quota.ts` and `VoiceUsageRecord`) | Token spend is unmeasurable per tenant |
| No red-team/off-policy suite | Behavioural drift is undetectable |

**This is the highest-value place to build.** Everything else is majority-built.

### 5.7 Channel layer — **EXISTS as normalisation**

`lib/ai-channels.ts` declares 8 channel types (`web_chat`, `business_page`, `whatsapp`, `instagram`, `facebook`, `sms`, `email`, `voice`) and normalises inbound → `handleAIFrontDeskTurn` → normalised delivery. Only `web_chat`/`business_page` and `voice` have live delivery paths; the rest are declared with no adapter (consistent with `docs/commercial/02_ENTITLEMENT_MATRIX.md` marking WhatsApp/SMS as PENDING OWNER DECISION).

---

## 6. Dependency inventory

**Runtime dependencies: 16. Total installed tree: 554 packages.**

| Package | Version | Purpose | Licence |
|---|---|---|---|
| `next` | 16.4.2 | Framework | MIT |
| `react`, `react-dom` | 18.3.1 | UI | MIT |
| `@prisma/client` / `prisma` | 5.22.0 | ORM | Apache-2.0 |
| `@aws-sdk/client-s3` | ^3.1156.0 | R2 (S3-compatible) | Apache-2.0 |
| `jose` | ^5.9.6 | JWT | MIT |
| `bcryptjs` | ^2.4.3 | Password hashing | MIT |
| `nodemailer` | 10.1.6 | SMTP | MIT-0 |
| `motion` | ^14.1.0 | Animation | MIT |
| `three` | ^0.186.1 | 3D/immersive | MIT |
| `recharts` | ^3.10.1 | Charts | MIT |
| `@tanstack/react-table` | ^9.3.1 | Tables | MIT |
| `lucide-react` | ^1.56.0 | Icons | ISC |
| `sonner` | ^2.0.8 | Toasts | MIT |
| `server-only` | ^0.0.1 | Build guard | MIT |
| `ws` | ^8.22.1 | Voice media WebSocket | MIT |

**No AI SDK is a dependency.** OpenAI and Gemini are called with plain `fetch`. There is no LangChain, no Vercel AI SDK, no vector client, no inference runtime. Adding any of these is a new dependency and therefore a new decision.

---

## 7. Infrastructure and deployment

| Concern | Current state |
|---|---|
| Hosting | Next.js on Vercel (`vercel.json`), Node `^20.19 \|\| >=22.12` |
| Database | Neon PostgreSQL via Prisma; `DATABASE_URL` pooled, `DIRECT_URL` unpooled for migrations; `scripts/migrate.sh` refuses to migrate through a pooler |
| Long-running process | Only `worker/voice-media` (Docker, port 8787) — not a Vercel function |
| Payments | Paystack merchant `2006074` (server-verified + HMAC webhook + idempotency); M-PESA Daraja for merchant collections |
| Storage | Cloudflare R2, unconfigured by default, fails closed to `503`; ceilings 250 MB/business, 5 GB global enforced in code |
| Rate limiting | **In-process `Map`** (`lib/rate-limit.ts`), per-instance, no Redis. Trusts `X-Forwarded-For` only when `VERCEL=1` |
| Audit | `lib/audit.ts` append-only `AuditEvent`, with secret-shaped-value rejection |
| Security headers | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` globally; `/b/*` relaxed to `SAMEORIGIN`; microphone allowed only on `/dashboard/autopilot/*` |
| Client/server boundary | A webpack plugin rewrites `lib/team-access` to a fail-closed stub in the **client** compilation only |

**Known operational constraint to carry into any design:** the rate limiter is per-instance. Any AI endpoint that costs money must not rely on it as its cost control.

---

## 8. Existing open-source provenance in the tree

`lib/openpage/` is adapted from **OpenPage** (`github.com/buildingopen/openpage`, upstream commit `9818eb4`, MIT, © 2026 Federico De Ponte). `lib/openpage/LICENSE` retains the upstream text verbatim and `ATTRIBUTION.md` records a per-file import table plus what was deliberately *not* imported (the Gemini key in `localStorage`, the Tailwind runtime, invented sample content).

This is the correct pattern and the AI infrastructure layer must follow it exactly: verbatim upstream licence in the subdirectory, attribution file with the upstream commit, and an explicit "not imported" list.

---

## 9. Outstanding engineering obligations found

Preserved verbatim, not fixed, per instruction 11. These were already recorded by the repository and are confirmed here.

| Obligation | Evidence in repo | Status |
|---|---|---|
| Customer entitlement inventory (#3 of the commercial workstream) | `docs/commercial/README.md` — deliverable #3 **BLOCKED**, awaiting an authorised read-only production query | BLOCKED (pre-existing) |
| R2 durable media | `OWNER_RELEASE_BLOCKERS.md` §Durable photos | BLOCKED (pre-existing) |
| Password reset delivery | `OWNER_RELEASE_BLOCKERS.md` §Password reset — needs SMTP | BLOCKED (pre-existing) |
| Production DNS/TLS for `jataaftercall.co.ke` | `README.md` header | BLOCKED (pre-existing) |
| Voice call verification | `TELNYX_VOICE_LIVE_VERIFIED` unset ⇒ `canSell: false` | BLOCKED (pre-existing) |
| eTIMS | `etimsSubmissionPosture().canSubmit` always `false`; no certified adapter | BLOCKED (by design) |
| Agent self-service registration / phone verification | `AGENT_SELF_SERVICE_REGISTRATION_ENABLED` / `AGENT_PHONE_VERIFICATION_ENABLED` unset | Disabled (by design) |
| Qi work-ingress | `lib/qi` — no live transport registered; embedding is an owner-gated decision | INACTIVE (by design) |
| Orphaned lifecycle store module | `lib/admin/product-lifecycle-execution-store.ts` imports 2 non-existent modules | **NEW — found by this workstream, pre-existing** |
| 3 failing Autopilot unit tests | `tests/unit/autopilot-*.test.ts` | **NEW — found by this workstream, pre-existing** |
| 4,822-line single Prisma schema | `prisma/schema.prisma` | Structural debt (informational) |

---

## 10. What this inventory implies for the directive

1. **Instruction 8 is ~70% already satisfied.** Business Brain, model adapter, controlled agent framework and multilingual voice interfaces exist. What genuinely does not exist: **semantic retrieval** and **evaluation infrastructure**.
2. **Instruction 5 (avoid duplication) forbids building a second brain, a second tool registry, a second entitlement engine or a second audit trail.** Each already exists exactly once.
3. **Instruction 7 (separate, versioned, authenticated interface) is the correct shape** — but as a façade and a separately-deployable gateway process, not as a new product.
4. **Instruction 10 is largely implemented** (`lib/ai-tools.ts` HIGH_RISK gate, `lib/money.ts` per product, `lib/tenant.ts`). Any new component must *call* these, not re-implement them.
5. **Instruction 11 means the design must be shippable as documentation plus dormant, feature-flagged code** — which is also the lowest-risk path given the 3 pre-existing test failures and an unbootstrappable Prisma engine in this environment.
