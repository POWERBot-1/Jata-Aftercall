# JATA Autopilot — Plan Activation Repair (Standard · Pro · Enterprise)

**Scope:** the three activation controls in the Command Center
(`/dashboard/autopilot/[businessId]`) — “Activate KES 2,499”, “Activate KES 6,999”,
“Activate KES 19,999” — and the checkout route they call.
**Production status: NOT DEPLOYED.** Delivered as a pull request for owner review.
**No real charge, provider session or production database write was made during this work.**

---

## 1. Production baseline (read-only)

| Item | Value | How verified |
| --- | --- | --- |
| Production `main` SHA | `32b10ce2a79b9e134ad144ccc6fe5ba22f91b398` | GitHub API `commits/main` |
| Vercel production deployment | id `7325313244`, created `2026-10-26T06:11:07Z`, state success | GitHub Deployments API / commit status (`Vercel: success`) |
| Live site | `https://jata-aftercall.vercel.app` serves the current build (six pricing cards incl. the Autopilot card added after #61) | GET of `/` |
| `PAYSTACK_SECRET_KEY` presence | Reported present in the 2026-10-25 production audit; **not read**, not printed | `PRODUCTION_DEPLOYMENT_AUDIT_2026-10-25.md` §Env vars |
| Plan rows in production DB | **Not readable from this environment** (no credentials; signing in would create records). Read-only check for the owner is in §7 | — |

## 2. How the flow was reproduced

No browser, Chrome binary, PostgreSQL or production credentials exist in this environment, so the
defect was reproduced at the level it actually occurs — the button handler’s own gate and the
server route — with the real route handlers and the real tenant/settlement code:

* **Real `POST /api/checkout`** driven from tests against a stateful in-memory Prisma double that
  implements the models the route touches (`business`, `businessMember`, `planConfig`, `user`,
  `payment`, `processedWebhook`, `autopilotSubscription`, `autopilotEntitlement`).
* **Real `lib/tenant.ts`** (ownership + `manage_billing`), **real `lib/autopilot/settlement.ts`**
  and **real `activateSubscriptionForPayment`**.
* Only `initializeTransaction` is mocked, so no provider call is possible.
* The client half is exercised through the real `lib/autopilot/checkoutClient.ts` with a mocked
  `fetch`, covering network failure, 401, 409, 502, 503 and hostile/missing checkout URLs.

Result with **seeded plan rows and a configured provider** (reproduced at the start of this work):

```
JATA_AUTOPILOT              → 200, amount 249900 (KES 2,499)
JATA_AUTOPILOT_PRO          → 200, amount 699900 (KES 6,999)
JATA_AUTOPILOT_ENTERPRISE   → 200, amount 1999900 (KES 19,999)
```

So the payment backend is **not** broken when the plan catalogue and provider are configured.
The failure is where the button decides whether to call it at all, and where the answer is shown.

## 3. Root cause per button

All three buttons share one code path; the cause is identical, and each tier fails on its own
stored row.

| Button | Root cause |
| --- | --- |
| **Activate KES 2,499** (Standard) | `startCheckout(plan.id, …)` returned **before any network request** when `plan.id` was `null`. The id comes from the `PlanConfig` row read during server rendering / `GET /api/autopilot/overview`. `PlanConfig` rows are written **only** by `npm run seed`, which the build and migration gates deliberately never run (see `DEPLOYMENT.md` §64–§66 and `scripts/build.sh`). With a row missing or replaced, `id` is `null` and the click does nothing. The only feedback was written to the page-level banner, which is rendered near the top of a long page — two to three screens above the plans panel — so the button read as dead. |
| **Activate KES 6,999** (Pro) | Same gate, scoped to `JATA_AUTOPILOT_PRO`. Its row is created by the same seed loop, so a database seeded before the Autopilot tiers existed (or one whose plan rows were re-created) produces the same `null` id. |
| **Activate KES 19,999** (Enterprise) | Same gate, scoped to `JATA_AUTOPILOT_ENTERPRISE`. |

Three further defects in the same flow were confirmed and are fixed here:

1. **Every** server refusal (401, 403, 404, 409, 500, 502, 503) was reported only in that distant
   banner, with no per-button loading state. Any refusal therefore looked exactly like a dead
   control.
2. The browser decided the plan by **stored database id**, so a stale id returned 404 even when
   the current row existed; and it could never reach the server’s own plan catalogue.
3. Two clicks in the same tick could both pass the `PENDING` pre-check and create **two pending
   payments and two provider sessions** (the check and the insert were not serialised), and an
   abandoned checkout locked the plan for 15 minutes with no way to inspect or retire it.

> **Note on PR #64.** That change repaired the Appearance picker’s stacking, the dead hero anchor
> and swallowed network errors in *other* Command Center handlers. It did not touch the plan
> activation gate, the checkout route, or the location of checkout feedback. This defect is
> independent of it.

## 4. Implementation

### `app/api/checkout/route.ts`

* Accepts `planKey` **in addition to** `planId`. Only the three Autopilot keys are accepted by key
  (`isAutopilotPlanKey`); anything else is `400 PLAN_NOT_ALLOWED`. `planId` behaviour for every
  other product is unchanged.
* Resolves the plan **server-side by key** when the id is stale/absent, so a re-created or missing
  stored id no longer dead-ends the click. If the id and key disagree, `409 PLAN_MISMATCH`.
* Price and duration still come **only from the stored `PlanConfig` row**; the existing
  `assertAutopilotPlanPricing` contract (KES 2,499 / 6,999 / 19,999 and exactly 30 days) still
  fails closed with `500 PLAN_PRICING_INVALID`. Client-supplied `amount`, `priceKES`, `currency`
  or `durationDays` are ignored.
* Every error now carries a stable `code` (`SIGN_IN_REQUIRED`, `BUSINESS_NOT_FOUND`,
  `PLAN_NOT_FOUND`, `PLAN_NOT_CONFIGURED`, `PLAN_UNAVAILABLE`, `PLAN_PRICING_INVALID`,
  `EMAIL_REQUIRED`, `CHECKOUT_IN_PROGRESS`, `PAYMENTS_UNAVAILABLE`, `PROVIDER_ERROR`,
  `CHECKOUT_FAILED`, `TENANT_FORBIDDEN`) alongside the existing human message, so the UI can
  respond precisely instead of guessing.
* A missing catalogue row is now a specific, actionable response (`503 PLAN_NOT_CONFIGURED`,
  “An administrator must run `npm run seed` …”) rather than a silent no-op.
* **Duplicate-purchase protection:** stale `PENDING` rows older than the 15-minute window are
  retired to `EXPIRED` (a later provider-verified success can still settle that state — see
  `SETTLEABLE_PAYMENT_STATES`); the in-progress response now includes the existing `reference`
  and a `statusUrl` (`/checkout/callback?reference=…`); and after creating the row, every request
  re-reads the ordered `PENDING` set and the loser cancels itself and returns `409`, so two
  simultaneous clicks converge on **one** payable session.
* Authentication, `assertBusinessOwnership`, `manage_billing`, Paystack initialisation, the
  production “no provider key” fail-closed branch, and metadata are unchanged (metadata now also
  records `planKey`).

### `lib/autopilot/checkoutClient.ts` (new, client-safe)

One place that turns a click into either a validated redirect or a visible notice.
It never throws and never reports success: the only success outcome is a URL that is
`https://checkout.paystack.com` or the app’s own `/checkout/mock` page. Network failure,
session expiry (`/login` link), payment already in progress (link to the existing payment),
missing configuration, unavailable payments and provider refusal all map to explicit messages.

### `components/autopilot/AutopilotCommandCenter.tsx`

* Buttons send the **allowlisted plan key** instead of the stored id, so a click always reaches
  the server.
* Per-button state: the clicked button shows “Starting checkout…”, all activation buttons are
  disabled while a request is in flight, and a synchronous `useRef` guard blocks a same-tick
  double click.
* Activating feedback is rendered **inside the plans panel** (`role="alert"`,
  `aria-live="assertive"`) directly above the three cards, with an action link where one exists —
  no off-screen-only messages.
* Non-owner/admin viewers see why they cannot activate.
* The old “plan record is not seeded … run database seed” pre-request dead-end is removed.

### `lib/checkoutPolicy.ts` (new)

Holds the pending-window constant and the status-link builder (a Next.js route module may only
export HTTP handlers, and the tests and confirmation page share these values).

## 5. Regression tests added

| File | Tests | Covers |
| --- | --- | --- |
| `tests/integration/autopilot-activation.test.ts` | **27 PASS** | one passing test per requirement: correct plan id per tier at the server price; client price/duration override rejected; stale-id self-heal; pricing/cycle drift fails closed; 401 + tenant + `manage_billing` enforcement; unknown/allowlist/inactive/unconfigured plans; provider failure and missing provider key with the payment failed safely; duplicate click, concurrent race convergence, stale-attempt retirement, independent plans; unverified payment cannot activate (no evidence, wrong amount, wrong currency); verified payment activates only the paying business, on the paid tier, leaves the AFTERCALL subscription untouched, is idempotent and extends from the existing expiry |
| `tests/unit/autopilot-checkout-client.test.ts` | **10 PASS** | request body carries only `businessId` + `planKey`; network error notice; 401 sign-in link; 409 existing-payment link; 503 configuration/payments messages; 502 provider message; hostile/missing checkout URL refused; non-JSON error body; URL and status-path validators |
| `tests/unit/autopilot-activation-ui.test.ts` | **7 PASS** | key-based click handler (old null-id dead-end gone), in-flight guard, per-button loading label, inline notice inside the plans panel, billing-permission message, URL validation, no fabricated success |
| `tests/unit/autopilot-controls-repair.test.ts` | 14 PASS (2 assertions updated) | the existing contract still holds; checkout feedback now lives in the shared client module |
| `scripts/browser/autopilot-activation.check.mjs` | **NOT RUN here** | real-browser check of the three buttons with `POST /api/checkout` intercepted and answered from canned responses, so a run can never create a payment. Requires Chrome, a seeded owner session and a business id (see §7). |

## 6. Test evidence (commands and results as executed)

| Command | Result |
| --- | --- |
| `npx vitest run tests/integration/autopilot-activation.test.ts` | **27 passed** |
| `npx vitest run tests/unit/autopilot-checkout-client.test.ts` | **10 passed** |
| `npx vitest run tests/unit/autopilot-activation-ui.test.ts` | **7 passed** |
| `npx vitest run tests/integration/checkout-route.test.ts tests/integration/payment-settlement.test.ts tests/integration/payment-verification-route.test.ts tests/integration/paystack-webhook-route.test.ts` | **48 passed** (8 checkout + 17 settlement + 9 verification + 14 webhook) |
| `npm test` (full suite) | **2750 passed, 1 failed, 121 skipped** (2872). The single failure is `Prisma.dmmf` in `tests/unit/autopilot-phase1-hardening.test.ts` — pre-existing in this offline sandbox (no generated Prisma client) and identical on unmodified `main` |
| `npm run lint` | **0 errors, 40 warnings** (same warning set as `main`) |
| `npx tsc --noEmit` | 4 errors, **all pre-existing offline-Prisma gaps in test files** (`tests/prisma/autopilot-constraints-and-concurrency.test.ts`, `tests/prisma/experience-boundary.test.ts`, `tests/unit/autopilot-phase1-hardening.test.ts`). Verified identical on a stashed clean `main` |
| `npm run build` | `next build --webpack` **compiled successfully**; the build’s type-check step reports exactly the same four pre-existing test-file errors as `main`. `prisma generate` cannot reach `binaries.prisma.sh` here; on Vercel it runs and these resolve |
| `node --check scripts/browser/autopilot-activation.check.mjs` | syntax OK |
| `npm run test:browser:autopilot-activation` | **NOT RUN** — requires `CHROME_PATH`, `JATA_SESSION_TOKEN`, `BUSINESS_ID` |

### CI on the pull request (all green)

`gh pr checks 65` — every job passed on this branch:

| Check | Result |
| --- | --- |
| Static (install, generate, lint, typecheck, audit) | pass (57s) — type-check passes with a real generated Prisma client |
| Journey against a real database | pass (11m46s) — PostgreSQL 18 |
| Production build path on PostgreSQL 18 | pass (1m45s) |
| Migrations + schema on PostgreSQL 18 | pass (1m39s) |
| Exact candidate applies on disposable PostgreSQL 18 | pass (2m4s) |
| D2 — build, audit and controls on the candidate tree | pass (2m11s) |
| Failure paths actually fail / Schema reconciliation / Migration target guard | pass |
| Release gate (aggregate) | pass |
| Vercel (preview build) | pass |

**Payment-security regression results:** unverified payments cannot settle (`PAYMENT_EVIDENCE_REQUIRED`),
amount/currency mismatches reject (`PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_CURRENCY_MISMATCH`),
settlement covers only the paying tenant, is idempotent under webhook replay, extends an active
subscription from its existing expiry, and never rewrites the separate AFTERCALL `Subscription`.
The existing webhook, verification, settlement and order/payment suites all still pass.

## 7. Blockers / owner actions

1. **Confirm the three plan rows exist in production** (read-only; no secrets involved):
   ```sql
   SELECT key, "priceKES", "durationDays", "isActive"
   FROM "PlanConfig"
   WHERE key IN ('JATA_AUTOPILOT','JATA_AUTOPILOT_PRO','JATA_AUTOPILOT_ENTERPRISE');
   ```
   If any row is missing or inactive, run **`npm run seed`** against production (idempotent
   upsert; it does not delete data). The build/migrate gate intentionally never seeds, so this is
   the only step that creates the three plans. Until it is done the fixed UI will say
   “JATA Autopilot plans are not configured in this deployment yet …”, which is the honest state —
   no payment can be taken and none will be reported as successful.
2. **End-to-end payment check with a real test-mode Paystack transaction** must be performed by
   the owner (or with explicit authorisation). This work made none.
3. `PAYSTACK_SECRET_KEY` must remain set in Vercel; without it the route fails closed with
   `503 PAYMENTS_UNAVAILABLE` (now shown inline).

## 8. Changed files

* `app/api/checkout/route.ts` — key-based plan resolution, error codes, config message,
  stale-attempt retirement, duplicate-click convergence.
* `lib/autopilot/checkoutClient.ts` — **new** activation client (request, response mapping, URL
  validation).
* `lib/checkoutPolicy.ts` — **new** pending window + status link.
* `components/autopilot/AutopilotCommandCenter.tsx` — key-based activation, per-button loading,
  in-flight guard, inline feedback, billing-permission message.
* `tests/integration/autopilot-activation.test.ts` — **new**, 27 tests.
* `tests/unit/autopilot-checkout-client.test.ts` — **new**, 10 tests.
* `tests/unit/autopilot-activation-ui.test.ts` — **new**, 7 tests.
* `tests/unit/autopilot-controls-repair.test.ts` — two assertions updated for the shared client.
* `scripts/browser/autopilot-activation.check.mjs` — **new** browser check (not run here).
* `package.json` — `test:browser:autopilot-activation` script.
* `AUTOPILOT_ACTIVATION_REPAIR_2026-10-26.md` — this report.

Nothing in `prisma/`, `lib/paystack.ts`, `lib/autopilot/settlement.ts`, `lib/autopilot/entitlement.ts`
or the webhook/verify routes was changed.
