# Verification Report — AI Business Front Desk (PR #24, `POWERBot-1/Jata-Aftercall`)

**Date:** 2026-10-03
**Object under verification:** the AI Business Front Desk implementation in **PR #24**
(`arena/01a102f2-jata-aftercall`), head `b0beb4e`.
**Verification branch:** `arena/01a1032d-jata-aftercall`, head **`cdf9458`** (rebased onto `b0beb4e`),
delivered as **draft PR #25 based on PR #24's branch** →
https://github.com/POWERBot-1/Jata-Aftercall/pull/25
**Verdict:** **REMEDIATION REQUIRED — NOT READY FOR REVIEW** (PR #24 at `b0beb4e`). The remediation
on PR #25 is green end-to-end — including every suite against real PostgreSQL — and ready for human
review.

> Note: this file is an untracked verification artifact. It is deliberately **not** committed to the
> branch.

---

## PART A — REPOSITORY STATE

### A1. Branch, PR and commit state

| Item | Value | Evidence |
| --- | --- | --- |
| Repository | `POWERBot-1/Jata-Aftercall` | `git remote -v` |
| Working branch (this session) | `arena/01a1032d-jata-aftercall` | `git branch --show-current` |
| Branch base | `main` @ `f3b48e1` (merge of PR #23) | `git merge-base` |
| Verification head (local **and** remote) | **`cdf9458`** | `git ls-remote origin refs/heads/arena/01a1032d-jata-aftercall` |
| Working tree | **clean** (`git status --short` empty at the end of each turn) | `git status --short` |
| PR #24 | **OPEN, UNMERGED**, head branch `arena/01a102f2-jata-aftercall`, head `b0beb4e` | `gh pr view 24` |
| PR #24 head movement during verification | `97b8ccd` → `b0beb4e` (pushed by someone else while I worked) | `gh pr view 24 --json headRefOid` |
| PR #25 | **DRAFT**, base **PR #24's branch `arena/01a102f2-jata-aftercall`**, head `cdf9458`, **MERGEABLE / CLEAN**, 27 files, +1171 / −110 | `gh pr view 25` |
| Commits added by me | `a616563` (fixes) · `53fd58a` (pricing test collection) · `a9255e5` (entitlement tests) · `64ef5c3` (CI runs the whole suite against the real database) · `b8c6d13` + `cdf9458` (temporary evidence step, added then removed) | `git log --oneline -6` |

**Nothing was merged.** PR #24 was not merged and not pushed to: this session is only permitted to
push `arena/01a1032d-jata-aftercall`. PR #25's base was therefore re-pointed from `main` to **PR #24's
own branch**, so merging PR #25 lands the remediation inside PR #24 with one click (equivalently:
`git cherry-pick a616563 53fd58a a9255e5 64ef5c3` on that branch). PR #25 stays a draft and should not
be merged independently.

### A2. Canonical `PlanConfig` — KES 499 / 30 days / ACTIVE

* `lib/pricing.ts:118` — `{ key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true }`.
* `lib/pricing.ts:81-85` — `assertAIFrontDeskPricing()` throws unless a plan resolves to 499 / 30.
* `lib/ai-entitlement.ts:12-14` — `AI_FRONT_DESK_PLAN_KEY`, `AI_FRONT_DESK_PRICE_KES = 499`, `AI_FRONT_DESK_DURATION_DAYS = 30`.
* `prisma/seed.ts` seeds the same 499 / 30 row.
* **No KES 999 contamination**: 999 appears only at `lib/pricing.ts:119` for `INTERACTIVE_BUSINESS`
  (and 999/365 for `ANNUAL`). Grepping `AI_BUSINESS_FRONT_DESK` with `999` returns nothing.
* Checkout derives the amount from the server-side plan; `/api/orders` and `/api/cart` discard any
  client-supplied `discountKES`.

**Caveat found (defect D-10):** the §49 pricing suite was named `tests/unit/pricing-ai-test.ts`, which
does **not** match the vitest glob `tests/**/*.test.ts` (`vitest.config.ts`), so those 7 canonical
assertions had never executed anywhere. Renamed; they now run, pass, and a guard test prevents a
recurrence.

### A3. Environment and tooling

| Item | Value |
| --- | --- |
| Node | `v22.22.3` |
| npm | `10.9.8` |
| Prisma client | **not generated** — TLS to the Prisma binary host is blocked in this sandbox (`prisma generate` fails; `npm ci` prints `prisma generate skipped (offline)`) |
| Local database | none reachable |
| Consequence | 39 database-backed tests skip locally (B7) |
| Payment credentials | none configured; settlement uses the application's own test branch (`NODE_ENV !== "production" && !PAYSTACK_SECRET_KEY`) |
| GitHub Actions log download | blocked from this sandbox (`results-receiver.actions.githubusercontent.com` unreachable) — CI conclusions come from the **Jobs API step status** plus one measured count block CI posted to the PR (B6) |
| Sandbox continuity | the sandbox was rebuilt between verification turns (`node_modules` and git metadata were lost; restored with `npm ci`, then `git fetch` + `git reset --mixed cdf9458`, confirming the working tree matched the remote exactly). Every result in B4 was re-run from scratch on the rebuilt checkout and reproduced the earlier numbers |

---

## PART B — VERIFICATION MATRIX

### B4. Commands, exit statuses, counts (on `cdf9458`)

| # | Command | Exit status | Result |
| --- | --- | --- | --- |
| 1 | `npm run lint` | **0** | passes; 2 **pre-existing** warnings: `components/dashboard/MediaPicker.tsx:45` (`react-hooks/exhaustive-deps`), `components/storefront/CartProvider.tsx:210` (`@next/next/no-img-element`) |
| 2 | `npm run typecheck` (`tsc --noEmit`) | **0** | no errors |
| 3 | `npm test` (`vitest run`) | **0** | **909 passed \| 39 skipped \| 0 failed**, 82 files passed / 1 skipped of 83, 20.74 s |
| 4 | `npm run build` (`bash scripts/build.sh`) | **0** | `[build] Build completed successfully` |
| 5 | CI `Interactive Business E2E` run **37154313898** @ **`cdf9458`** | **success** | real PostgreSQL: `npm ci` → `prisma generate` → `prisma migrate deploy` → `npm run seed` → **whole non-e2e suite (908 tests)** → **§66 journey** → **Business POS journey** |
| 6 | CI run **37154037057** @ `64ef5c3` | **success** | first run that included the new real-database suite step |

Nothing is reported as PASS here that did not actually complete with the exit status shown.

### B5. AI Front Desk test inventory (each run individually on `cdf9458`)

| Test file | Tests | Result |
| --- | --- | --- |
| `tests/unit/ai-grounding-and-safety.test.ts` | 11 | 11 passed |
| `tests/unit/ai-front-desk-merchant-credentials.test.ts` *(new)* | 3 | 3 passed |
| `tests/unit/ai-entitlement.test.ts` *(new)* | 6 | 6 passed |
| `tests/unit/pricing-ai.test.ts` *(renamed, now collected)* | 7 | 7 passed |
| `tests/integration/ai-front-desk-lifecycle.test.ts` (5 original + §15 journey + emergency-pause test) | 7 | 7 passed |
| `tests/integration/ai-front-desk-order-stage-transitions.test.ts` *(new)* | 5 | 5 passed |
| `tests/integration/ai-front-desk-publish-atomicity.test.ts` *(new)* | 4 | 4 passed |
| `tests/security/ai-front-desk-route-authorization.test.ts` *(new)* | 10 | 10 passed |
| `tests/security/ai-front-desk-tenant-isolation.test.ts` | 3 | 3 passed |
| `tests/unit/test-collection-guard.test.ts` *(new)* | 4 | 4 passed |
| **AI Front Desk subtotal** | **56** | **56 passed, 0 failed** |
| Whole suite minus the two journeys (what CI runs on the real database) | 908 | 908 passed, 0 skipped, 0 failed |

Supporting suites re-run for this verification: `tests/unit/phase3-commerce.test.ts` (11 passed),
`tests/unit/phase4-notifications.test.ts` (8 passed),
`tests/integration/paystack-webhook-route.test.ts` (14 passed),
`tests/integration/payment-verification-route.test.ts` (9 passed),
`tests/security/paystack-security.test.ts` (6 passed),
`tests/unit/plan-availability.test.ts`, `tests/unit/publication-gate.test.ts`,
`tests/unit/payment-settlement.test.ts`, `tests/unit/paystack.test.ts` (all pass).

### B6. Continuous-integration evidence (real PostgreSQL)

Workflow `.github/workflows/interactive-business-e2e.yml`: `postgres:16` service container,
`DATABASE_URL=postgresql://jata:jata@localhost:5432/jata_e2e`, `AUTH_SECRET` set, **no Paystack
secret**. The POS step deliberately **fails** the job if its log contains “skipped” or no “N passed”,
so a green POS step proves that journey really executed.

| Run | Head | Outcome |
| --- | --- | --- |
| 37146047008 (PR #24) | `97b8ccd` | **failure** — “Run the §66 journey” failed, POS journey skipped |
| 37147557539 (PR #24) | `b0beb4e` | success (both journeys) |
| 37149251156 (PR #25) | `566b498` | success (both journeys) |
| 37149567580 (PR #25) | `a616563` (rebased) | success (both journeys) |
| 37149763824 (PR #25) | `53fd58a` | success (both journeys) |
| 37150062880 (PR #25) | `a9255e5` | success (both journeys) |
| 37154037057 (PR #25) | `64ef5c3` | success — first run including the new whole-suite step |
| **37154313898 (PR #25)** | **`cdf9458`** | **success — every step, including the whole non-e2e suite** |

Measured counts on the real database (captured by temporarily having CI post its own summary as a PR
comment, then removing that step so it does not comment on every push):

```
npx vitest run --exclude tests/e2e (real PostgreSQL)
 Test Files  81 passed (81)
      Tests  908 passed (908)          # 0 skipped — the step fails the job if anything skips
   Duration  11.16s
npm run test:e2e       1 file, 17 passed | 1 skipped
npm run test:e2e:pos   1 file, 22 passed
```

**Before this verification, CI ran only the two journeys.** The unit, integration and security suites
— including every AI Business Front Desk test — had never executed against a real database, only
against a mocked Prisma client. Commit `64ef5c3` closes that (gap G1).

### B7. What the 39 locally-skipped tests are

`tests/e2e/interactive-business-journey.test.ts` (18 tests, 17 skipped) and
`tests/e2e/business-pos-journey.test.ts` (22 tests, 22 skipped) self-skip without a reachable
database. They are exactly the journeys CI runs against real PostgreSQL, and CI now runs the other
81 files against that same database, so the local gap is fully covered by CI.

---

## PART C — DEFECTS FOUND

### C8. Defect register

Severity: **Critical** = tenant data exposure or revenue bypass; **High** = integrity or secret
handling; **Medium** = correctness/verification.

| ID | Defect | Severity | Where | Fix | Pinned by |
| --- | --- | --- | --- | --- | --- |
| **D-1** | **Anonymous callers receive HTTP 200 with tenant data.** `getCurrentUser()` (`lib/auth.ts`) swallows every error and returns `null`; the intelligence, notifications, preorder and merchant-payment routes treated “no session” as “unknown tenant” instead of “unauthenticated”, so unauthenticated reads **and writes** (including knowledge approval and notification delivery) succeeded. | Critical | `app/api/intelligence/{demand,quality,questions}/route.ts`, `app/api/notifications/route.ts`, `app/api/preorders/route.ts`, `app/api/merchant-payment/route.ts`, `lib/tenant.ts` | `requireBusinessAccess` takes `mode: "read" \| "write"`; every one of those routes returns **401** with no session, **403** for another tenant | `tests/security/ai-front-desk-route-authorization.test.ts` (2 tests) |
| **D-2** | **Live AI served without a paid entitlement.** `/api/ai/chat` and `/b/[slug]/ai` answered customers whenever the business was published, so a **published business with no subscription**, and one with a merely **PENDING** payment, received live AI. | Critical (revenue) | `app/api/ai/chat/route.ts`, `app/b/[slug]/ai/page.tsx` | both entry points gate on `entitlement.entitled === true` (chat returns the closed state; the page `notFound()`s) | `tests/security/ai-front-desk-route-authorization.test.ts` (2 tests) |
| **D-3** | **Publish was not atomic** — the configuration was promoted and the business marked published as two independent best-effort writes, which can leave a half-published business. | High | `lib/ai-config.ts`, `lib/ai-readiness.ts` | `saveExtendedAIConfig()` accepts `{ requirePersistence: true }` and rolls the in-memory config back when persistence fails; readiness publishes as one guarded sequence returning `PUBLISH_FAILED` | `tests/integration/ai-front-desk-publish-atomicity.test.ts` (2 tests) |
| **D-4** | **Emergency pause did not stop customer service** — step 0 of `lib/ai-front-desk.ts` checked only `MAINTENANCE` despite the comment citing `PAUSED / MAINTENANCE (§45)`, so a `PAUSED` business kept answering customers. | High | `lib/ai-front-desk.ts` | both `PAUSED` and `MAINTENANCE` short-circuit to `ACTION_REQUIRED` + `escalatedToHuman`, surfacing `Operational status: …`; owner Preview Mode is exempt | `tests/integration/ai-front-desk-lifecycle.test.ts` (“honours the emergency pause…”) |
| **D-5** | **Order transitions lost their cause** — unknown stage and illegal-but-known transition collapsed into one response (`b0beb4e` made both 409). | Medium | `lib/experience/orders.ts`, `app/api/orders/route.ts` | `assertOrderStageTransition()` returns `reason: "UNKNOWN_STAGE" \| "INVALID_TRANSITION"` → **400** and **409** | `tests/integration/ai-front-desk-order-stage-transitions.test.ts` (5 tests) |
| **D-6** | **Tenancy checks threw on every call** — `lib/tenant.ts` filtered `Business` on a `userId` field the model does not define, so the Prisma `where` raised instead of answering. | Critical | `lib/tenant.ts` | fixed independently in `b0beb4e` (`findUnique` + ownerId/userId check); here their path is kept **and** a schema-safe `findFirst({ id, ownerId })` runs first, plus a source-scan test that fails if a non-existent Business field reappears | `tests/security/ai-front-desk-tenant-isolation.test.ts`, route-authorization suite |
| **D-7** | **Client-supplied pricing honoured** — `/api/orders` and `/api/cart` accepted a client `discountKES`. | Medium | `app/api/orders/route.ts`, `app/api/cart/route.ts` | client discount discarded; totals recomputed server side | order-stage + commerce suites |
| **D-8** | **Silent persistence failures** — `lib/order.ts` swallowed write errors (an order “succeeded” though not stored) and `lib/inventory.ts` did not fail closed when a reservation could not be persisted. | Medium | `lib/order.ts`, `lib/inventory.ts` | both now rethrow / fail closed | commerce + lifecycle suites |
| **D-9** | **Merchant credentials could be encrypted with the committed development key** in production when `MERCHANT_CREDENTIAL_KEY` is unset. | High (secrets) | `lib/merchant-payment.ts` | production fails closed with an explicit error instead of silently using `DEV_ONLY_KEY_MATERIAL` | `tests/unit/ai-front-desk-merchant-credentials.test.ts` (1 test) |
| **D-10** | **The §49 pricing suite never ran** — the filename did not match vitest's include glob, so the canonical KES 499 / 30-day assertions were dead locally *and* in CI. | Medium (verification) | `tests/unit/pricing-ai-test.ts` | renamed to `tests/unit/pricing-ai.test.ts` | 7 tests now collected and passing |

All ten are fixed on `cdf9458`. D-1, D-2, D-3, D-4, D-5 (partially), D-7, D-8, D-9 and D-10 are
**still present on PR #24's head `b0beb4e`**; only D-6 and the 409 status of D-5 were fixed there.

**Guard against recurrence of D-10:** `tests/unit/test-collection-guard.test.ts` walks `tests/` and
fails if any file is named so that vitest will not collect it, or if a test file appears outside
`tests/`. Proven by adding `tests/unit/zz-dummy-ai-test.ts` → two assertions fail naming the file
(`expected [ 'tests/unit/zz-dummy-ai-test.ts' ] to deeply equal []`); removing it → 4 passed again.

### C9. Regression proof (the defects are real, not theoretical)

**Against PR #24's head `b0beb4e`** — clean `git worktree` at `b0beb4e`, with **only** the new test
files copied in, no source changes: **9 failed / 13 passed**.

```
× unauthenticated reads of tenant intelligence, notifications and payment config are refused (401)
  AssertionError: GET /api/intelligence/demand must not be readable anonymously: expected 200 to be 401
× unauthenticated writes are refused (401) — including knowledge approval and notification delivery
  AssertionError: POST /api/intelligence/demand must not be writable anonymously: expected 200 to be 401
× a published business with no AI entitlement is not served live AI
  AssertionError: expected 'structured_data' to be 'fallback'
× a pending (unpaid) entitlement is not served live AI
  AssertionError: expected 'structured_data' to be 'fallback'
× never promotes the configuration when the business cannot be marked published
  AssertionError: expected true to be false
× rolls the business back when the configuration snapshot cannot be published
  AssertionError: expected true to be false
× an impossible transition is a state conflict (409), not a generic validation error
  AssertionError: expected undefined to be 'INVALID_TRANSITION'
× an unknown stage is a malformed request (400)
  AssertionError: expected 409 to be 400
× fails closed in production when no credential key is configured
```

**D-4 separately:** `git stash push lib/ai-front-desk.ts` → the emergency-pause test fails with
`expected 'KNOWN' to be 'ACTION_REQUIRED'`; `git stash pop` restores the pass.

**Against the original head `97b8ccd`** (earlier in this session, 15 new tests): 8 failed / 7 passed,
including the tenant-isolation failures caused by D-6.

---

## PART D — REMAINING GAPS

### D10. Requirement-by-requirement verification result

“Test” = executed and passing. “Code” = verified by reading the implementation plus a passing
build/typecheck, **not** by an executing assertion.

| # | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Canonical `PlanConfig` (499 / 30 / ACTIVE, no 999 confusion) | **Test** | `pricing-ai.test.ts` (7), lifecycle pricing invariant; `lib/pricing.ts:118`; grep clean |
| 2 | Server-side entitlement | **Test** | `ai-entitlement.test.ts` (6), route-authorization (2); `deriveAIEntitlement()` ignores client input |
| 3 | Server-side Paystack verification | **Test + Code** | `payment-verification-route.test.ts` (9), `paystack-security.test.ts` (6); `verifyTransaction()` server-side; test-settlement branch gated to `NODE_ENV !== "production" && !PAYSTACK_SECRET_KEY` |
| 4 | Idempotent webhooks | **Test + Code** | `paystack-webhook-route.test.ts` (14); `isWebhookProcessed(eventId)` at `app/api/paystack/webhook/route.ts:26,69,132`; HMAC signature verified (401 on mismatch) |
| 5 | Tenant-scoped sync | **Code + Test** | `syncAIPackageEntitlement(businessId)` upserts keyed by `businessId`; conversation memory keyed `businessId::conversationId`; tenant-isolation tests (3) |
| 6 | Expiry revokes access | **Test** | `ai-entitlement.test.ts`: expired → `entitled:false, EXPIRED`; grace → `entitled:true, PAST_DUE`; suspension → `SUSPENDED` |
| 7 | Full lifecycle CHOOSE→CONFIGURE→EDIT→PREVIEW→VERIFY→PAY→SERVER VERIFY→PUBLISH→LIVE | **Test (real PostgreSQL)** | the §15 fresh journey test (added in `b0beb4e`) walks register→create→configure→data→edit price 1200→1350→preview isolation→readiness→KES 499 payment→entitlement; 7 lifecycle tests pass, and now run against the CI database |
| 8 | Tenant isolation across db / API / service / dashboard / customer AI / commerce / notifications / intelligence / config / entitlement / publication; 401 unauth, 403 wrong tenant | **Test** | route-authorization (10) and tenant-isolation (3) cover 401 / 403 / 200 with no credential leak across intelligence, notifications, preorders, merchant payment, orders and AI chat; `lib/tenant.ts` hardened |
| 9 | Business Brain authority over docs; KNOWN / UNKNOWN / ACTION_REQUIRED | **Test** | `ai-grounding-and-safety.test.ts` (11) drives `handleAIFrontDeskTurn` through grounded, ungrounded and escalation outcomes; `lib/ai-front-desk.ts:50` defines the tri-state |
| 10 | AI safety: prompt injection, tool auth, no secrets in model context | **Test + Code** | grounding/safety suite (11); `detectPromptInjection()` at `lib/ai-front-desk.ts:99` blocks override/secret requests → `ACTION_REQUIRED`; `lib/ai-tools.ts:106-121` refuses HIGH_RISK tools (refund, cancel_order, change_price, change_inventory, modify_business_configuration) unless `authorizedHighRisk`; merchant secrets are AES-256-GCM encrypted and only a public summary reaches customers |
| 11 | Commerce: backend totals, idempotent orders, concurrency-safe inventory, no oversell, deterministic preorder, validated transitions | **Test (deterministic) + Code** | `phase3-commerce.test.ts` (11), order-stage suite (5); totals recomputed server-side; `deriveIdempotentOrderReference()` + idempotency cache keyed `businessId::preview\|live::key`; availability/preorder rules in `lib/inventory.ts`; reservations fail closed. **True multi-writer concurrency is unverified — G6** |
| 12 | Merchant payment separation / encryption | **Test + Code** | `ai-front-desk-merchant-credentials.test.ts` (3): versioned envelope, no plaintext, production fail-closed |
| 13 | Notifications / leads / human handoff | **Test + Code** | `phase4-notifications.test.ts` (8); `lib/notification.ts` create/status/retry/list; `lib/leads.ts` capture with classification; escalation sets `escalatedToHuman` |
| 14 | Memory + English / Kiswahili / mixed | **Test + Code** | `lib/ai-conversation.ts`; `language: en \| sw \| mixed` and `languageBehavior` in `lib/ai-config.ts:68-69,398-445`; multilingual phrases exercised in the grounding suite |
| 15 | Server-side readiness + atomic publish + emergency pause | **Test** | lifecycle (readiness `canPublish=false` until paid) + publish-atomicity (4) + the emergency-pause test |
| 16 | Owner dashboard (configure, preview, publish, pause) | **Code + Build** | `app/dashboard/ai/page.tsx`, `components/AIDashboardClient.tsx`, `components/AIConfigForm.tsx`, `components/AIFrontDeskCustomerClient.tsx` reviewed; `tests/unit/dashboard-ux.test.ts` covers general dashboard guards only. **No browser E2E of the AI dashboard — G5** |
| 17 | Audit redaction / privacy | **Test + Code** | lifecycle audit-redaction test; `redactAuditMetadata()` at `lib/audit.ts:25-35` replaces sensitive keys and long values with `[REDACTED]` before persistence |

### D11. Remaining gaps (nothing hidden)

| ID | Gap | Impact | Status / action |
| --- | --- | --- | --- |
| **G1** | CI ran only the two journeys, so all other suites (including every AI Front Desk test) executed solely against a mocked Prisma client | Medium — schema mismatches of the kind that broke `97b8ccd` would not be caught outside the journeys | **CLOSED** by commit `64ef5c3`: CI now runs `npx vitest run --exclude "tests/e2e/**"` with `DATABASE_URL` set and fails the job if anything skips; measured **908 passed / 0 skipped** on PostgreSQL 16 |
| **G2** | `prisma generate` cannot run in this sandbox → 39 DB tests skip locally | Low | covered by CI (B6/B7) |
| **G3** | Live Paystack never exercised (no credentials; out of scope by instruction) | Medium for go-live | out of scope; needs the owner's production activation decision |
| **G4** | `getAIPackageStatus()` still falls back to `prisma.payment.findFirst({ status: "PAID" })` regardless of plan, relying on the downstream plan-key check and the `entitled === true` gates | Low — verified safe by test (an `INTERACTIVE_BUSINESS` subscription yields `NONE`) | open; tighten the query to filter by plan, then re-run the entitlement tests |
| **G5** | The owner AI dashboard was reviewed as code and compiles, but was not exercised in a browser | Low | open; manual UAT or an existing browser harness |
| **G6** | Inventory “no oversell” is proven by deterministic reservation logic, not by concurrent writers against a real database | Medium | open; add a real-DB concurrency test (two parallel orders for the last unit) |
| **G7** | `POST /api/ai/leads` is intentionally unauthenticated (customers submit leads); `GET` is correctly 401/403. No rate limiting or abuse controls were verified | Medium | open; add rate limiting / captcha before public launch |
| **G8** | Conversation memory, the order idempotency cache and the notification/lead stores are **in-process**; behaviour with multiple app instances is unverified | Medium at scale | open; move to Redis/DB before horizontal scaling |
| **G9** | CI logs cannot be downloaded from this sandbox, so per-run detail beyond the posted summary block is unavailable | Low | read the run page directly if more detail is needed |

### D12. Scope boundaries respected

* No merge of PR #24; no push to `arena/01a102f2-jata-aftercall`.
* No changes to JATA POS, JATA Qi, Interactive Business, unrelated subscription packages, Phase 6,
  custom domains, voice, or unrelated UI/refactors. The only POS-adjacent files touched
  (`lib/order.ts`, `lib/inventory.ts`, `app/api/orders/route.ts`) are shared commerce primitives the
  AI Front Desk order flow depends on; the changes are failure-safety and pricing-integrity only.
* No production Paystack credentials configured or exposed; test settlement path only.
* The one shared-infrastructure change (`.github/workflows/interactive-business-e2e.yml`) exists
  solely so the AI Front Desk suites are exercised against a real database; it adds a step and does
  not alter the existing journeys.

### D13. Risks and assumptions

1. The remediation is delivered on **PR #25**, now based on PR #24's branch, because this session
   cannot push PR #24's branch. It is a **draft verification vehicle** and must not be merged
   independently.
2. PR #24's head moved mid-verification (`97b8ccd` → `b0beb4e`). Every statement here is against
   `b0beb4e`; if the branch moves again, re-run C9.
3. `b0beb4e` and this remediation fixed the same real-PostgreSQL failure by different routes
   (`findUnique` vs a schema-safe `findFirst`); both paths are present, schema-safe one first. They
   do not conflict, but one can be removed if the maintainers prefer a single path.
4. The 400-vs-409 split (D-5) is stricter than `b0beb4e`'s blanket 409; if the maintainers prefer one
   status, `tests/integration/ai-front-desk-order-stage-transitions.test.ts` is where to change it
   deliberately.
5. “Production ready” is **not** claimed: no production environment, no live Paystack, no
   multi-instance runtime and no browser-level dashboard run were available for verification.

---

## PART E — FINAL CLASSIFICATION

### E14. Classification

> ## **REMEDIATION REQUIRED — NOT READY FOR REVIEW**

for **PR #24 as it stands at `b0beb4e`**, because two Critical defects remain on that head and are
reproduced by failing tests: anonymous callers receive tenant data (D-1) and live AI is served
without a paid entitlement (D-2), plus publish atomicity (D-3), the ignored emergency pause (D-4),
merchant-credential key handling (D-9) and the dead §49 pricing suite (D-10).

The remediation that closes all ten is **green** on `cdf9458`: lint 0, typecheck 0, `npm test` 0 with
**909 passed / 39 skipped / 0 failed**, build 0, and CI run **37154313898 success** — which now
includes the **whole non-e2e suite (908 tests, 0 skipped) against real PostgreSQL**. Once PR #25 is
merged into PR #24's branch and the four commands plus CI are re-run there, the classification for
that branch becomes **VERIFIED — READY FOR HUMAN REVIEW**.

### E15. What changed (27 files, +1171 / −110 vs `b0beb4e`)

**Source fixes:** `lib/tenant.ts`, `lib/ai-config.ts`, `lib/ai-readiness.ts`, `lib/ai-front-desk.ts`,
`lib/experience/orders.ts`, `lib/order.ts`, `lib/inventory.ts`, `lib/merchant-payment.ts`,
`app/api/ai/chat/route.ts`, `app/api/cart/route.ts`, `app/api/orders/route.ts`,
`app/api/preorders/route.ts`, `app/api/notifications/route.ts`, `app/api/merchant-payment/route.ts`,
`app/api/intelligence/{demand,quality,questions}/route.ts`, `app/b/[slug]/ai/page.tsx`.

**CI:** `.github/workflows/interactive-business-e2e.yml` — new step running
`npx vitest run --exclude "tests/e2e/**"` against the CI database, failing on any skip, with its log
added to the failure comment.

**Tests added:** `tests/security/ai-front-desk-route-authorization.test.ts` (10),
`tests/integration/ai-front-desk-order-stage-transitions.test.ts` (5),
`tests/integration/ai-front-desk-publish-atomicity.test.ts` (4),
`tests/unit/ai-front-desk-merchant-credentials.test.ts` (3),
`tests/unit/ai-entitlement.test.ts` (6), `tests/unit/test-collection-guard.test.ts` (4); one
emergency-pause test added to `tests/integration/ai-front-desk-lifecycle.test.ts`;
`tests/unit/pricing-ai-test.ts` → `tests/unit/pricing-ai.test.ts`.

### E16. Recommended next steps (ordered)

1. **Merge draft PR #25 into PR #24's branch** (or cherry-pick `a616563 53fd58a a9255e5 64ef5c3`),
   then re-run `npm run lint && npm run typecheck && npm test && npm run build` and let CI run.
2. Tighten `getAIPackageStatus()`'s fallback payment query to filter by plan (G4).
3. Add rate limiting to the public lead endpoint (G7).
4. Add a real-DB concurrency test for the last-unit inventory case (G6).
5. Browser UAT of the owner AI dashboard (G5), then close PR #25 unmerged.

### E17. Attestation

* Every PASS corresponds to a command that completed with exit status 0 in this session:
  `npm run lint`, `npm run typecheck`, `npm run test` (909 / 39 / 0), `npm run build`, and the
  per-file vitest runs in B5. CI success is asserted from the GitHub Actions Jobs API
  (run 37154313898, head `cdf9458`), and the 908-test real-database count is CI's own output.
* Dependencies were installed from the lockfile (`npm ci`, exit 0, 418 packages) on the rebuilt
  sandbox; CI performs a clean `npm ci` on every run.
* Nothing here relies on a previous claim without repository evidence: each finding cites a file, a
  test, or a run ID that can be re-executed.
* Not verified, and not claimed: production runtime behaviour, live Paystack settlement,
  multi-instance deployment, browser-level dashboard interaction, and concurrent-writer inventory
  behaviour.
