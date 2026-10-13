# JATA AFTERCALL — Production release report (2026-10-13, updated after push and CI)

Consolidated, evidence-based report for the P0 implementation directive. Every check carries one of
**PASS**, **FAIL**, **BLOCKED** (cannot be executed with the available environment/authority) or
**NOT TESTED** (not executed at all), with the evidence behind it. Nothing here is inferred from
installation, a document, or an older SHA.

| Field | Value |
| --- | --- |
| Canonical baseline (untouched) | `main` = `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` (tip: "Merge pull request #43", 2026-10-13T14:40:24Z) |
| Work branch | `arena/fac28f53-jata-aftercall` |
| Code candidate SHA (pushed; the commit Vercel built and all code evidence below refers to) | `1b8167dcc1df50e9af049f364cb6990b2fe756a4` |
| Later commits on the same branch | `1b92182` (two lost-race tests) and the report-only commits that follow `1b8167d`; each is documentation or test-only, so the code evidence at `1b8167d` remains valid. Current tip: `git ls-remote origin refs/heads/arena/fac28f53-jata-aftercall`, or the PR's head SHA |
| Remote branch tip | pushed and verified with `git ls-remote` at every push of this turn (no force, no history rewrite) |
| Pull request | **#45** — https://github.com/POWERBot-1/Jata-Aftercall/pull/45 (open, base `main`, 8 commits, head `0fe55e4…`, labelled NOT APPROVED FOR PRODUCTION DEPLOYMENT; verification outcome posted as a comment) |
| Branch vs `main` | 7 commits ahead, **107 behind**; `mergeable: false`, `mergeable_state: "dirty"` → **6 conflicting files** |
| Recovery checkpoint | `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` — present, never moved |
| Environment | node v22.22.3, npm 10.9.8. No `DATABASE_URL`, no Prisma engine, no Postgres/docker, no Chrome/Chromium **and no way to run one** (see Phase 4). npm registry and github.com reachable; `binaries.prisma.sh` is not |
| Preview | Vercel Preview for `1b8167d`, deployment `7044323662`, state `success`, created 2026-10-13T16:40:53Z, **SSO-protected** |
| Merged? Deployed? | **No.** No merge, no production deploy, no migration run, no env change, no provider activation, no spending, no production data touched |
| Final status | **BLOCKED** — see §F.1; blockers are verification-authority items, not known defects |

---

## A. Audit and scope discipline

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Audit before implementation | **PASS** | Sections below; each conclusion names its command or file |
| A2 | Small, reviewable commits | **PASS** | 8 commits on the branch; this turn added only `1b92182` (tests) and the report update |
| A3 | No destructive git operations, `main` untouched | **PASS** | No reset/rebase/force-push; `main` still `8db6a9e4…`; checkpoint `9c36bd10…` intact; preflight found a clean tree |
| A4 | Parallel work preserved | **PASS** | PRs #16, #20, #41, #42, #44 untouched; no branch created, switched to, or pushed except the authorized one; pushing reused `origin` only |
| A5 | Scope buckets | **PASS** | §F.2 |
| A6 | No manufactured approval, no capability switched on | **PASS** | No provider activated, no env var set, no test-mode flag changed |

### A7 — Preflight result (requested explicitly)

- Repository `POWERBot-1/Jata-Aftercall`, remote `origin https://github.com/POWERBot-1/Jata-Aftercall.git`, branch `arena/fac28f53-jata-aftercall`, working tree clean, **no** upstream tracking branch before this turn (the branch had never been pushed).
- Expected sequence verified in order and complete: `730c0c8` → `ac3381d` → `b849b70` → `f27e07f` → `1b8167d`. Full SHA of the reported final commit: `1b8167dcc1df50e9af049f364cb6990b2fe756a4`.
- No PR existed for this head (`gh pr list --head` returned empty), so a new PR was correct rather than a duplicate.
- **Difference found and reported before proceeding:** `main` has advanced 107 commits past this branch's base `77e35ce`. `77e35ce` *is* an ancestor of `main` (API compare: status `ahead`, `behind_by: 0`), so the PR diff contains only this branch's work — but the candidate has not been re-validated on top of current `main`, and the merge is **conflicted** (6 files: `app/b/[slug]/book/page.tsx`, `app/globals.css`, `components/BusinessPage.tsx`, `components/storefront/BookingClient.tsx`, `package.json`, `package-lock.json`), confirmed independently with `git merge-tree --write-tree`.

---

## B. Mandatory release gates

### B1 — React hydration error #418

| Check | Status | Evidence |
| --- | --- | --- |
| Mechanisms identified (not suppressed) | **PASS** | (1) runtime-locale/runtime-zone formatting across ~60 client call sites; (2) a client component deriving a value from the runtime clock during render plus `toISOString()` on local midnights |
| Deterministic formatter | **PASS** | `lib/dateFormat.ts` pins `en-KE` + `Africa/Nairobi`; `lib/format.ts` date/time helpers delegate to it (dashboard and POS boards fixed at the same time) |
| Runtime clock removed from the render path | **PASS** | `BookingClient` takes `today` from the server (`nairobiCalendarDay()`) and builds chips with pure `calendarDayList()`; this also fixed a real booking bug (in UTC+3 the old code booked the day *before* the one displayed) |
| Enforcement so it cannot return | **PASS** | Client components may not use `toISOString().slice(0, 10)` or ambient zone getters; `lib/format.ts` may not contain `toLocaleDateString`/`toLocaleTimeString`; theme boot-script invariant kept |
| Render-level parity | **PASS** | Identical HTML under `TZ=UTC`, `TZ=Africa/Nairobi`, `TZ=America/Los_Angeles` and across a simulated Nairobi-midnight crossing |
| **Real-browser confirmation** | **BLOCKED** | See Phase 4. No browser can be run here, and the preview is SSO-protected |
| Supplementary DOM hydration evidence | **PASS (not a browser)** | See Phase 4 — real `hydrateRoot` in jsdom with a **negative control that reproduces the failure** |
| Hydration suppression added | **PASS (none)** | Only the pre-existing `<html suppressHydrationWarning>` for the pre-paint theme script |

### B2 — Subscription payment failure at `tests/prisma/subscription-payment.test.ts:87`

| Check | Status | Evidence |
| --- | --- | --- |
| Root cause | **PASS** | `activateSubscriptionForPayment` refused any non-`PENDING` payment, so a verified success arriving after a local FAILED/CANCELLED/EXPIRED never settled |
| Fix | **PASS** | Single settleable rule in `lib/paymentVerification.ts`; refuses `PAYMENT_NOT_SETTLEABLE` outside it (REFUNDED never revivable); `PAYMENT_EVIDENCE_REQUIRED` for anything other than PENDING; CAS inside one transaction; `settledFrom` in the audit metadata; verify route re-checks stored settleable states; dev mock PENDING-only |
| Entitlement/authorization weakened | **PASS (no)** | Signature verification, webhook idempotency, evidence validation, tenant guards and plan checks untouched |
| The reported gap test | **PASS (tightened)** | `it.fails("KNOWN GAP …")` → real test asserting 200 + PAID + 1 subscription; two characterization tests corrected; one new refusal test |
| Settlement behaviour with a fake database | **PASS** | `tests/integration/subscription-payment-revival.test.ts` — 14 tests (12 revival/idempotency/refusal + 2 new lost-race) |
| **Compare-and-set, losing side** | **PASS (deterministic simulation)** | `1b92182`: forcing the CAS to match nothing while the row is already `PAID` returns `alreadySettled` and creates no second subscription/audit; forcing it while the row moved to `REFUNDED` throws `PAYMENT_STATE_CHANGED` and does not clobber the concurrent verdict. True parallelism/row locking remains the database suite's job (stated in the test and in `tests/helpers/posFakeDb.ts`) |
| `PAYMENT_EVIDENCE_REQUIRED` enforced | **PASS** | Pinned by `tests/integration/subscription-payment-revival.test.ts` (refusal + same call succeeding with the verified id) and `tests/unit/payment-settlement.test.ts` |
| REFUNDED never revived | **PASS** | Same suites, both refusal paths |
| PostgreSQL-backed confirmation (incl. line 87) | **BLOCKED** | Five independent causes: no `DATABASE_URL`; no Prisma engine (downloads blocked); no Postgres/docker; PR CI cannot start (below); `workflow_dispatch` 403 (below) |

### B3 — Dependency-security gate

| Check | Status | Evidence |
| --- | --- | --- |
| Named chain closed | **PASS** | `puppeteer-core` ^23.11.1 → ^25.13.0 removes `extract-zip`, `proxy-agent`, `basic-ftp`, `get-uri`; the single consumer script's 13 API calls were audited against the 25.x typings first |
| Production advisories | **PASS** | `npm audit --omit=dev` → **0** (fresh run at the pushed SHA) |
| Whole tree | **PASS (improved)** | 19 → **9** (7 high, 2 moderate, 0 critical); fresh run reproduced the report's numbers exactly |
| Lockfile integrity | **PASS** | `npm ci` on the pushed lockfile installs 502 packages with no peer/engine errors — the same step CI runs |
| Residual advisories | **BLOCKED (upstream)** | Phase 6 |

### B4 — Production payment-provider readiness

| Check | Status | Evidence |
| --- | --- | --- |
| Webhook authenticity | **PASS** | HMAC-SHA512 over the raw body, timing-safe compare; failures audited as `WEBHOOK_SIGNATURE_FAILED` |
| Idempotency | **PASS** | `processedWebhook` claimed in the same transaction as the state change; replays return `already_processed`/`already_paid` |
| Evidence validation | **PASS** | Reference, amount, currency and transaction id must match; mismatches audited and refused |
| Retry semantics | **PASS** | Unprocessable signed events return 503 so Paystack retries; unknown references are acknowledged once and audited |
| Refunds | **PASS** | Full refund → REFUNDED + subscription suspension (POS refund suspends POS, leaves AFTERCALL alone); partial refunds acknowledged once with a durable review audit |
| Readiness honesty | **PASS** | `lib/payments/config.ts` is the only credential reader; reports ready/mode/missing, never a secret; test mode only when no live connector exists; merchant capability stays at "payment instructions" without keys |
| Secrets never in the browser | **PASS** | `PAYSTACK_SECRET_KEY` is read only in server modules; no client-bundle exposure |
| Live readiness in Production | **BLOCKED — OWNER VERIFICATION REQUIRED** | Phase 5: the integration token cannot read Actions secrets/variables (403), and Vercel env vars are not accessible from here. Instructions supplied below |
| End-to-end live charge | **NOT TESTED** | Requires separate authorization (spending/production credentials) |

### B5 — Environment, secrets, monitoring, rollback

| Check | Status | Evidence |
| --- | --- | --- |
| Environment template | **PASS** | `.env.example` documents every variable the code reads, with fallbacks |
| Migration gated at build | **PASS** | `scripts/build.sh` → `scripts/migrate.sh`; with `DATABASE_URL` set, a failed `prisma migrate deploy` aborts the build |
| Health surface | **PASS** | `/health` probes the real database; without one it reports `degraded`/`unconfigured` rather than trusting the stub |
| Audit/monitoring trail | **PASS** | Signature failures, unknown references, transaction mismatches, partial-refund review, settlement (`settledFrom`) and refunds all write audit events |
| Rollback | **PASS** | §F.3; no migration is added by this branch, so a code rollback needs no database action |
| Real environment inspected / alerting configured | **NOT TESTED** | Not authorized and not accessible |

### B6 — Database migration compatibility

| Check | Status | Evidence |
| --- | --- | --- |
| Destructive statements | **PASS (none)** | 16 migrations re-scanned: zero `DROP TABLE`/`DROP COLUMN`, zero type changes, zero data-bearing renames |
| Expand-contract discipline | **PASS** | New tables/indexes/constraints; columns added with `IF NOT EXISTS`; the one backfill is guarded and idempotent |
| Schema ↔ migration drift | **PASS (static)** | All 73 models have a `CREATE TABLE` in the migration set |
| Migration needed by this branch | **PASS (none)** | Payment, hydration and design-system changes are code-only |
| `migrate status`/`diff` against a real database | **BLOCKED** | No engine and no database here; CI runs `prisma migrate deploy` on Postgres 16 once the merge ref exists |

---

## C. Global UX/UI and the design system

| Check | Status | Evidence |
| --- | --- | --- |
| Tooling installed where justified | **PASS** | motion 14.2.0, lucide-react 1.56.0, recharts 3.10.1, sonner 2.0.8, @tanstack/react-table 9.3.1 — each with a consumer |
| `shadcn@latest init` evaluated | **PASS (evaluated, not run)** | Registry hosts unreachable, and no `components.json` exists anywhere in the repo — **there is no shadcn layer to migrate or maintain**, contrary to the assumption in the brief. Primitives are hand-written on the existing `.jata-*` tokens |
| `npx v0 add <id>` evaluated | **PASS (evaluated, not run)** | No verified generation id exists; the placeholder must never be used |
| One enforceable design system, in code | **PASS** | `lib/designSystem.ts` contract + token layer in `app/globals.css` + `components/ui/*`, enforced by 30 source guards |
| Interaction/a11y standards | **PASS** | Required states, focus-visible ring, ≥44px touch targets, reduced motion, `aria-current`, one `main` landmark, one toast surface |
| Dashboard first-class | **PASS (code/tests)** | Rebuilt shell/overview with loading and error states; business status always through the shared pill |
| Studio products inherit the system through the real renderer | **PASS** | 768 published products (16 categories × 48 themes) rendered and asserted |
| Token reconciliation | **PASS** | `PRODUCT_THEME_TOKENS` (25 tokens) typed against each theme; drift now fails the typecheck |
| Visual/browser review, perf budget | **NOT TESTED** | No browser; `next build` shows 103 kB shared first-load JS but no budget is asserted |

---

## D. Package rollout verification

| Package | Status | Evidence |
| --- | --- | --- |
| Dashboard | **PASS (code/tests)**; browser **NOT TESTED** | Design-system guards; rebuild covered by tests |
| Website Studio | **PASS (offline)**; e2e **BLOCKED** | 768 rendered products; publish/version-guard/entitlement suites need Postgres (CI) |
| POS | **PASS (offline)**; e2e **BLOCKED** | Shared settleable rule + revival tests + POS isolation; POS journey needs the database |
| Subscriptions/payments | **PASS** | §B2/B4 |
| Analytics | **PASS (code)** | Shared lazily-loaded chart; privacy beacon unchanged |
| Auth/onboarding | **PASS (tests)** | Shared form language asserted |
| Shared modules | **PASS** | Single homes for formatting, status labels and next-action logic |
| AI Front Desk | **PASS (code/tests)**; Postgres entitlement suite **BLOCKED** | 5 tests need a database and run in CI |

---

## E. Verification ledger

### E.1 Phase 2 — push and pull request (executed)

| Step | Result |
| --- | --- |
| Push | `git push -u origin arena/fac28f53-jata-aftercall` — new branch created, non-force, no history rewritten |
| Remote SHA verified | `1b8167dcc1df50e9af049f364cb6990b2fe756a4` immediately after the push (exact match with local HEAD at the time); after this turn's two commits, `0fe55e4652a1f5dd1489634b04ffec937f081005` (also an exact match) |
| Pull request | **#45** created: https://github.com/POWERBot-1/Jata-Aftercall/pull/45 — base `main`, labelled **NOT APPROVED FOR PRODUCTION DEPLOYMENT**, body covers the changes, verification, gates, security findings and rollback |
| Merge performed | **No** |

### E.2 Phase 3 — CI

| Item | Status | Detail |
| --- | --- | --- |
| `Interactive Business E2E` (Postgres 16 + full suite + journeys) on `pull_request` | **DID NOT RUN** | The PR's merge ref cannot be built because the branch conflicts with `main` (`mergeable_state: "dirty"`, 6 files). GitHub created no run for this branch: `gh run list --branch arena/fac28f53-jata-aftercall` is empty. No run identifier exists |
| `Interactive Business E2E` via `workflow_dispatch` | **403** | `gh workflow run interactive-business-e2e.yml --ref arena/fac28f53-jata-aftercall` → `HTTP 403: Resource not accessible by integration` (the integration token lacks `actions:write`). Same result as the earlier session; a 403 is not a pass |
| Vercel (build of the pushed commit) | **PASS** | Commit status `Vercel | success`; deployment id `7044323662`, environment `Preview`, `sha 1b8167d…`, state `success`, created 2026-10-13T16:40:53Z |
| Local gates at the pushed code SHA | **PASS** | `tsc --noEmit` exit 0; `vitest run` 151 passed \| 10 skipped files, **1796 passed \| 95 skipped \| 0 failed** (1891); `next lint` 0 errors + 1 pre-existing warning; `next build` success; `npm ci` installs the pushed lockfile (502 packages) |

### E.3 Skipped tests — every one, and why

All 95 skips share one cause: no `DATABASE_URL`, no Prisma query/migration engine (downloads
blocked) and no Postgres. The CI workflow runs them against Postgres 16 and **fails if anything is
skipped**, so a green CI check is authoritative — and it has not run yet.

| File | Skipped | Blocks release? |
| --- | --- | --- |
| `tests/e2e/interactive-business-journey.test.ts` | 17 of 18 | Yes — customer journey evidence for the release candidate |
| `tests/e2e/business-pos-journey.test.ts` | 22 | Yes — POS journey evidence |
| `tests/prisma/storefront-checkout.test.ts` | 15 | Yes — checkout/payment integrity |
| `tests/prisma/payment-settlement.test.ts` | 12 | Yes — settlement against real SQL |
| `tests/prisma/checkout-commit.test.ts` | 6 | Yes — commit/idempotency |
| `tests/prisma/schema-constraints.test.ts` | 6 | Yes — schema constraints |
| `tests/prisma/subscription-payment.test.ts` | 5 (incl. the line-87 test) | Yes — the reported gate itself |
| `tests/integration/ai-front-desk-entitlement-postgres.test.ts` | 5 | Yes — entitlement enforcement |
| `tests/integration/payment-wallet-refunds-postgres.test.ts` | 4 | Yes — refund integrity |
| `tests/integration/payment-wallet-stk-receipt-postgres.test.ts` | 2 | Yes — receipt/STK integrity |
| `tests/integration/pos-refund-race-postgres.test.ts` | 1 | Yes — the only true race test (a refund race) |

### E.4 Other environmental blocks

- Prisma engine download (`binaries.prisma.sh`) fails; `prisma generate/validate/migrate` cannot run here. The checked-in client stubs allow typecheck and the non-database suites to run.
- No browser can be run: no Chrome/Chromium binary, no browser cache, **and no Chromium shared
  libraries anywhere on the filesystem** (`libnss3`, `libgbm`, `libasound`, `libatk`, `libcups`,
  `libxkbcommon` — none present), with no package-manager access to install them. Bundling a
  Chromium from the npm registry (e.g. `@sparticuz/chromium`) would therefore still fail to launch.
- The Vercel Preview is behind Deployment Protection (`/health` returns the Vercel SSO login page).
- Actions secrets/variables cannot be listed (`403`, integration token).

---

## Phase 4 — Real-browser hydration verification: **BLOCKED**

**What is needed (exact requirements):** a Chrome/Chromium binary *plus its shared libraries* in the
test environment (or a CI job on a runner that has them), and access to the deployment under test —
either Deployment Protection disabled for the preview, an authenticated Vercel session, or a
protection-bypass token. Neither is available here: no binary, no libraries, no package-manager
network, and the preview returns the Vercel SSO page.

**Preview URL for the owner's pass:** `https://jata-aftercall-jln4b4yv4-powerbot-1.vercel.app`
(Vercel Preview, `sha 1b8167d…`, SSO-protected).

**Manual script for the owner (10 minutes, no credentials to share).** Deployments are built per
commit, so the report's report-only commit also gets its own preview:

1. Open the preview URL from the PR's Vercel check (this one, or a newer one for the report commit) and log in to Vercel.
2. `/b/<slug>/book` for a published business with services: confirm the date chips start on **today in Nairobi** (not yesterday), that tapping "Wed, 14 Oct" submits `2026-10-14`, and that the owner's Bookings list shows the same day.
3. Do this between **21:00 and 24:00 UTC** (00:00–03:00 Nairobi) if possible — that is the window where the old code disagreed with itself.
4. Keep the console open: a hydration mismatch appears as `Warning: Text content did not match …` / "An error occurred during hydration". Reload 5–10 times; the failure was intermittent.
5. Check the dashboard bookings/orders lists and one POS date column (the shared formatter now renders Nairobi time).

**Supplementary evidence obtained (explicitly NOT browser evidence).** A temporary jsdom probe
(deleted after the run; `jsdom` installed with `--no-save`, `package.json`/lockfile verified
byte-identical afterwards) hydrated the **real** `BookingClient` with `react-dom/client`:

- **Negative control (proves the harness can see the bug):** a component reading the clock produced
  `Warning: Text content did not match. Server: "2026-10-12T20:59" Client: "2026-10-12T21:00"` and
  `Warning: An error occurred during hydration. The server HTML was replaced with client content in <div>`
  — i.e. the reported #418 mechanism reproduces under React 18 in a DOM.
- **Fixed component:** hydrating across the Nairobi midnight boundary (server 20:59 UTC, client
  21:00:30 UTC) produced **zero** console errors, with server HTML chips starting at `Mon, 12 Oct`.

This strengthens the case that the mechanism is gone, but jsdom is not a browser, a real engine, or
a network path — the gate stays BLOCKED until a browser pass exists.

---

## Phase 5 — Paystack configuration review: **BLOCKED — OWNER VERIFICATION REQUIRED**

Accessible from here: GitHub only. `GH_TOKEN` is an integration token whose permission set returns
`403 Resource not accessible by integration` for Actions secrets, variables and workflow dispatch;
Vercel configuration is not reachable at all, and no secret value may be read or printed in any case.
The repository does expose two GitHub **environments** (`Preview`, `Production`), which is a
GitHub Actions construct and says nothing about Vercel or Paystack.

**What the owner must confirm (no value needs to be pasted anywhere):**

| # | Check | How to confirm without exposing the secret |
| --- | --- | --- |
| 1 | Production `PAYSTACK_SECRET_KEY` is a **live** key | Vercel → Project → Settings → Environment Variables → Production scope: the value must begin `sk_live_`. Compare the prefix only |
| 2 | Production `PAYSTACK_PUBLIC_KEY` matches the same account/mode | Same screen: begins `pk_live_` |
| 3 | Production `JATA_PAYMENTS_TEST_MODE` is `off` or unset | Same screen. With a live key present the app reports a live connector; an explicit `on` would force test mode and must not be set in Production |
| 4 | Preview/Development scopes hold **test** keys only (`sk_test_`/`pk_test_`) | Same screen, Preview scope. Previews must never be able to charge live money |
| 5 | Paystack dashboard webhook points at production | Paystack → Settings → API Keys & Webhooks: `https://<production-domain>/api/paystack/webhook`, same account as the key (the repo's template names JATA ATLAS merchant 2006074) |
| 6 | URLs match the deployment | Production `PUBLIC_BASE_URL`/`NEXTAUTH_URL` = the production domain (they determine `callback_url` and receipt links) |
| 7 | Signature verification actually agrees | After a real (authorized) charge, `/health` stays green and no `WEBHOOK_SIGNATURE_FAILED` audit rows appear; every mismatch is logged and every success writes `WEBHOOK_CHARGE_SUCCESS` |

A first live transaction (even KES 1, immediately refunded) is the only way to prove the live path
end-to-end. That is **spending with production credentials** and needs its own explicit
authorization; it was not attempted.

---

## Phase 6 — Residual dependency advisories (fresh, at the pushed SHA)

| Scope | Fresh result | Notes |
| --- | --- | --- |
| Whole tree | **9** — 7 high, 2 moderate, 0 critical | Reproduces the report's numbers exactly |
| Production only (`--omit=dev`) | **0** | Confirms the claim |
| Directly in `package.json` | `eslint-config-next` only | Everything else is transitive |

**Residual chain (all dev-only build/watch tooling):**

| Package | Severity | Pulled in by | Published fix |
| --- | --- | --- | --- |
| `braces` | high | `chokidar@3` → `micromatch`/`fast-glob` | **None exists** — the advisory covers `<=3.0.3` and 3.0.3 is the latest release |
| `chokidar`, `micromatch` | high | `tailwindcss@3.4.19` | `tailwindcss@4.3.3` (major) |
| `@next/eslint-plugin-next`, `eslint-config-next`, `fast-glob` | high | `eslint-config-next@15.5.27` | npm suggests `eslint-config-next@14.2.35` — a **downgrade** incompatible with Next 15 |
| `postcss-nested`, `postcss-selector-parser` | moderate | `tailwindcss@3.4.19` | `tailwindcss@4.3.3` (major) |

**Narrower-remediation analysis (checked, not assumed):** `tailwindcss@3.4.19` is the newest 3.x, so
there is no in-range upgrade; `braces` has no patched release to override to; `micromatch@4.0.8`
and `fast-glob@3.3.3` (both latest) still depend on it. The only "narrow" options would be
out-of-range overrides (`chokidar@4/5` or `postcss-selector-parser@7` forced under `tailwindcss@3`
or `postcss-nested@8`), each of which changes the dev build/watch behaviour and would need its own
regression pass. **Reachability:** exploitation requires an attacker-controlled glob pattern inside
the developer's own build (Tailwind `content` globs / ESLint patterns), i.e. write access to the
repository.

**Recommendation (owner decision, not performed):** do not block the release on these dev-only
findings — production dependencies are at zero and the vulnerable code is the local build tool.
Schedule a separate, reviewed **Tailwind 4 migration** task (it clears most of the chain), and note
that the `eslint-config-next` branch only clears with **Next 16 + ESLint 9 flat config**, i.e. a
framework-level change. A Tailwind 4 migration was **not** started: it changes `globals.css`
structure, the token layer, PostCSS pipeline and the design-system source guards.

**Correction for the brief:** there are no shadcn components in this repository (no
`components.json`, no dependency, no imports), so a Tailwind 4 migration would not have to
reconcile a shadcn theme layer.

---

## Phase 7 — Owner decisions and existing policies

| Item | Status | Evidence |
| --- | --- | --- |
| **Sale-price policy** — is the implemented time-windowed policy the ratified one? | **PASS — no unresolved discrepancy** | `lib/sale-pricing.ts` states the approved policy (Option C): base price authoritative outside a window; sale applies only inside a start-inclusive/end-exclusive window; expiry is automatic; storage UTC, owner input Nairobi; window-less/inverted/non-discount sales never discount. Every previously divergent channel now calls it (`lib/ai-tools.ts`, `lib/cart.ts`, `lib/order.ts`, `lib/preorder.ts`, `app/api/cart/route.ts`, `lib/experience/pricing.ts`, `lib/pos/sales.ts`), the AI knowledge-conflict check compares against the price a customer pays now, and the dashboard label was corrected to "Sale price (KES, optional)". Owner notice exists (`OWNER_NOTICE_SALE_PRICES.md`). 50 policy tests pass at this SHA |
| **Media storage** | **PASS — remains deferred** | `STORAGE_DECISION.md` is still "proposed, not approved"; no storage dependency, credential or provider was added or activated; nothing was uploaded or provisioned |
| **Stale orders / refunds policy** | **OPEN — owner decision (no behaviour implemented)** | This candidate adds **no** cancellation or refund behaviour (the refund path is untouched). There is still **no documented policy proposal** in the repository for stale orders/auto-cancellation, and the brief requires one *before* implementing such behaviour. Not a blocker for the current scope |
| **Payment provider activation** | **PASS — none** | No provider switched on, no env change, no live transaction |
| **Branch currency vs `main`** | **OPEN — owner decision** | 107 commits behind with 6 conflicting files; re-validation on top of current `main` (or a merge/rebase decision) is required before any release merge |

**Genuinely unresolved owner decisions:** (1) branch currency/conflict resolution; (2) the residual
dev-only advisories and whether to schedule Tailwind 4 (and later Next 16/ESLint 9); (3) stale-order
cancellation/refund policy proposal; (4) media storage remains deferred by policy (already decided —
no action needed); (5) authorization for a live payment test.

---

## F. Release decision

### F.1 Status: **BLOCKED**

| # | Blocker | Evidence required | Responsible | Next action |
| --- | --- | --- | --- | --- |
| 1 | Database-backed suites have never run on this work (95 tests, incl. `subscription-payment.test.ts:87`) | A green `Interactive Business E2E` run on a commit that contains this work | Owner (resolution) + agent (re-run) | Resolve the 6-file conflict with `main` (or authorize a rebase/merge of `main` into the branch) — the PR's CI then starts automatically; alternatively dispatch the workflow from the Actions tab, or grant the integration `actions:write` |
| 2 | Hydration #418 not confirmed in a real browser | Browser pass on a preview (or a CI browser job) with the console inspected around 21:00–24:00 UTC; deployment protection must permit access | Owner | Run the 10-minute script in Phase 4 on the preview URL, or authorize a Playwright/Puppeteer CI job |
| 3 | Production payment configuration not verified | Owner confirmation of the Phase 5 table (live key mode, webhook URL, test-mode flag, scope separation) | Owner | Walk the 7-step checklist; no secret leaves the Vercel/Paystack dashboards |
| 4 | Live payment path never exercised end-to-end | One small real charge + refund | Owner | Explicit authorization for spending/production transaction |
| 5 | Branch is 107 commits behind `main` | Re-validation on top of current `main` | Owner | Decide merge/rebase strategy; the candidate was verified against its own base only |
| 6 | Residual dev-only advisories | Assessment above (complete) → decision needed | Owner | Accept for this release and schedule Tailwind 4, or authorize that migration now |

Items 1–5 are verification-authority blockers. **No in-scope gate fails**: the code-level gates
(settlement correctness, hydration determinism, dependency and migration safety, design-system
enforcement, authz/tenant/entitlement behaviour in the non-database suites) are green, and the
remaining uncertainty is exactly the evidence that cannot be produced from this environment.

### F.2 Scope buckets

- **Minimum safe initial-release scope:** the payment-settlement correction; the hydration
  determinism fixes; the dependency remediations; the design-system foundation, dashboard rebuild
  and published-product inheritance. All are internal/behavioural corrections with no new customer
  capability switched on.
- **Post-release improvements:** Tailwind 4 migration; a CI browser job; a payment reconciliation
  sweep for `PENDING` rows older than the provider's retry window; Next 16/ESLint 9 evaluation.
- **Disabled/deferred capabilities (unchanged by this work):** live payment providers are not
  activated; test mode remains under the deployment's explicit control; media/original storage
  stays deferred (no provider, no credentials, nothing uploaded); no AI vendor was activated; no
  cancellation/refund automation exists.

### F.3 Rollback

| Layer | Action | Effect |
| --- | --- | --- |
| Single change | `git revert <sha>` for `730c0c8`, `ac3381d`, `b849b70`, `f27e07f`, `1b92182` or the report commit | Each is independent |
| Whole candidate | Redeploy the previous Vercel deployment (Vercel → Deployments → Rollback) or `git revert` to the merge base | Instant |
| Database | **Nothing to roll back** — no migration in this branch | CI's test-database migrations are disposable |
| Dependencies | Revert `b849b70` | Restores `next@15.5.26`, `puppeteer-core@^23.11.1` and the 19 advisories; only if the bump proves harmful |
| Durable checkpoint | `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` | Untouched, fetchable |
| Detection after any rollback | `/health`; audit events `WEBHOOK_SIGNATURE_FAILED`, `WEBHOOK_TRANSACTION_MISMATCH`, `WEBHOOK_PARTIAL_REFUND_REVIEW_REQUIRED`, `SUBSCRIPTION_ACTIVATED` | Payment/database regressions visible without a code change |

### F.4 Authorization and non-actions record

- **Executed with authorization:** preflight inspection; a normal (non-force) push of the authorized
  branch; creation of PR #45; local test/build/lint runs; `npm ci`; fresh audits; read-only GitHub
  API inspection; one read-only fetch of the preview URL (which returned the Vercel login page);
  a temporary jsdom probe (deleted, `--no-save`, lockfile byte-identical); two test-only commits
  and this report committed to the authorized branch.
- **Not executed:** no merge into `main`, no deployment, no production env change, no migration, no
  provider activation, no real transaction, no spending, no production data change, no history
  rewrite, no force-push, no changes to any other branch or PR.
- **Tests were not weakened:** the line-87 gap test was tightened from `it.fails` to a real
  assertion; two characterization tests were corrected to the new contract; nothing was skipped,
  deleted or made lenient. Advisories were neither suppressed nor mislabelled.
- **Nothing was pushed to `main`;** the only remote ref written is
  `refs/heads/arena/fac28f53-jata-aftercall`.
