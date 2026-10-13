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
| Pull request | **#45** — https://github.com/POWERBot-1/Jata-Aftercall/pull/45 (open, not draft, base `main`, **12 commits, 65 changed files, head `fde6865…`, `mergeable: true`** after `main` was merged in under owner authorization — §G.13; labelled NOT APPROVED FOR PRODUCTION DEPLOYMENT; CI evidence comment `issuecomment-6151667650`) |
| CI on this branch | **`Interactive Business E2E` run `38439687233` — SUCCESS** at `fde686559f681ddad690ac66d023c7718554797c`: full native DB suite 2262 passed / 0 skipped, §66 journey 17, POS journey 22, booking SSR+midnight hydration 25, authenticated journey 428, motion 124, families 167, layout 7, immersive 22, raster 29, production audit 0 — §G.13.1 |
| Isolated integration candidate | `b5f058bfee2b87e53923e947c19017ee9c27f558` = `main 8db6a9e4…` + `7ec72c66…` with the six conflicts resolved; verified byte-identical (apart from this report) to the merge `fde6865` that was then applied to the branch and passed CI — §G.3/§G.13 |
| Branch vs `main` | **merged up to `main` on 2026-10-13** (merge `fde6865`, no force-push); the six conflicts were resolved and the merge target is now `mergeable: true` — §G.2/§G.13 |
| Recovery checkpoint | `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` — present, never moved |
| Environment | node v22.22.3, npm 10.9.8. No `DATABASE_URL`, no Prisma engine, no Postgres/docker, no Chrome/Chromium **and no way to run one** (see Phase 4). npm registry and github.com reachable; `binaries.prisma.sh` is not |
| Preview | Vercel Preview for `1b8167d`, deployment `7044323662`, state `success`, created 2026-10-13T16:40:53Z, **SSO-protected** |
| Merged? Deployed? | **No.** No merge, no production deploy, no migration run, no env change, no provider activation, no spending, no production data touched |
| Final status | **BLOCKED — owner-verification items only**; current gate table in **§G.13.3** (supersedes §G.10/§F.1). Every machine-verifiable gate is green at `fde6865` with CI run `38439687233` as evidence; what remains is the owner's Paystack verification, one live charge + refund authorization, and the development-advisory decision |

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

### F.1 Status: **BLOCKED** (as of the original report)

> **Superseded by §G.10.** After this section was written, `main`'s hydration programme was
> read in full, the six conflicts were inventoried and resolved in an isolated candidate
> (§G.2/§G.3), and the blocker list was reduced to four items with the CI mechanism
> identified (§G.5). The table below is kept as the record of what was believed at that
> time; the authoritative list is §G.10/§G.11.

| # | Blocker | Evidence required | Responsible | Next action |
| --- | --- | --- | --- | --- |
| 1 | Database-backed suites have never run on this work (95 tests, incl. `subscription-payment.test.ts:87`) | A green `Interactive Business E2E` run on a commit that contains this work | Owner (resolution) + agent (re-run) | Resolve the 6-file conflict with `main` (or authorize a rebase/merge of `main` into the branch) — the PR's CI then starts automatically; alternatively dispatch the workflow from the Actions tab, or grant the integration `actions:write` |
| 2 | Hydration #418 not confirmed in a real browser | Browser pass on a preview (or a CI browser job) with the console inspected around 21:00–24:00 UTC; deployment protection must permit access | Owner | Run the 10-minute script in Phase 4 on the preview URL, or authorize a Playwright/Puppeteer CI job |
| 3 | Production payment configuration not verified | Owner confirmation of the Phase 5 table (live key mode, webhook URL, test-mode flag, scope separation) | Owner | Walk the 7-step checklist; no secret leaves the Vercel/Paystack dashboards |
| 4 | Live payment path never exercised end-to-end | One small real charge + refund | Owner | Explicit authorization for spending/production transaction |
| 5 | Branch is 107 commits behind `main` | Re-validation on top of current `main` | Owner | **Addressed in §G**: the conflicts are resolved in candidate `b5f058b` (green type-check, 2188 tests, 0 failures) but it is unpushed; the remaining step is authorizing §G.4 option A or B |
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

---

## G. Directive 3 — PR #45 currency audit, six-file conflict resolution and release-gate completion (2026-10-13, later same day)

This section is the current state. It supersedes §F.1's blocker list and every earlier statement
about the conflict that predates the resolution recorded here. Nothing in it changed `main`, the
published branch, any deployment, or any production configuration.

### G.1 Verified state, re-read from the remote before any file was touched

| Fact | Value |
| --- | --- |
| `main` | `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` — **unchanged** from the previous report (no new main-side commits) |
| Task branch | `7ec72c6688fac596655c226fb621f837f015d61d` (10 commits), remote ref verified with `git ls-remote` |
| Merge base | `77e35ce` (task branch HEAD == merge base at creation; `main` is 107 commits ahead) |
| PR **#45** | open, not draft, base `main`, head `7ec72c66…`, 10 commits, 67 files, `mergeable: false`, `mergeable_state: "dirty"`, updated 2026-10-13T16:52:40Z |
| PR #45 checks | Vercel ✓ and Vercel Preview Comments ✓ only — **no GitHub CI run exists for this branch**, because a `pull_request` run needs a buildable merge ref and the merge ref is conflicted |
| Other open PRs overlapping these files | #42 (open, base `77e35ce`: `app/globals.css` +25−0, `package.json` motion) and #41 (draft, merge-base `a622a8c`: `app/b/[slug]/book/page.tsx` +11−2); #44 owns none of the six; #20/#16 unrelated. Both #41 and #42 still carry the line-87 `it.fails` marker, i.e. no parallel PR lands the payment fix |
| Workflows on the default branch | `Interactive Business E2E` (present, active) and `Production smoke (read-only)` (active, but its file is absent from the repo). Branch-protection inspection returns 403 with this token |
| Checkpoint | `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` — present, unmoved |
| Did any of the six files change on `main` since the last report? | **No.** `main`'s SHA is identical, so the conflict inventory below was already current |

`main`'s 107 commits are an M11–M15 investigation programme into hydration #418 that *independently*
touched the same booking code our branch fixed. That is why the same six files conflict, and why the
resolution below is by mechanism, not by side.

### G.2 Six-file conflict inventory — what each side did, and the resolution

Read from the merge base (`77e35ce`), not from conflict markers. `+x−y` are lines changed since the base.

| File | Ours | `main` | Overlap | Behaviour to preserve, both sides | Risk if mis-resolved | Resolution & verification |
| --- | --- | --- | --- | --- | --- | --- |
| `app/b/[slug]/book/page.tsx` | +2−0 — pass the server's Nairobi day: `today={nairobiCalendarDay()}` | +25−5 — per-request shared load (`requestCache`, `generateMetadata` shares the storefront load), professional-workflow routing (enquiry redirects, `notFound()` on dummy products), `calendar={bookingCalendar(new Date())}` | **Semantic duplicate**: both remove the render-path clock from the booking page | main's enquiry/professional routing and single-load caching; the server-computed day list; `force-dynamic` | Keeping our two lines would drop main's routing + request-cache work and leave the page inconsistent with main's browser checks | **main's version.** Our guarantee survives as the adapted parity test (§G.3). Verified: candidate's `BookingClient` takes `calendar`; hydration test files 49/49 pass |
| `components/storefront/BookingClient.tsx` | +14−11 — `today` prop + `calendarDayList()`; removes `new Date()`/`toISOString()` from render | +12−16 — `calendar: readonly BookingDay[]` prop + `calendar.slice(0,10)`, `key={day.date}` | **Semantic duplicate**: same defect, two contracts | No ambient clock in the render path; chip keys and labels identical server/browser | Two parallel clients would keep the ambient-clock bug or diverge in key/label formatting | **main's version** (`calendar` prop, `lib/experience/bookingCalendar.ts`). Verified: parity test asserts byte-identical HTML across `UTC`/`Africa/Nairobi`/`America/Los_Angeles`, unchanged across a fake Nairobi-midnight crossing, and no `new Date()` in the component. **Residual (owner decision D-1):** between 21:00–24:00 UTC main's first chip is the previous Nairobi day, whose slots are already past — cosmetic, since the server validates slots; recorded, not changed |
| `app/globals.css` | +451−0 — one appended design-system block at EOF (tokens, status tones, skeletons, offline state, POS) | +119−26 — three in-file regions: focus-visible atoms, template-family recipe/density rules | **Textual** (EOF vs in-file) only | Both blocks | Taking one side silently deletes the other's styling | **main's file + our appended block.** Verified: 27 `eb-scope`+family/recipe markers and 11 `jata-surface`-family markers present; base had 7 duplicated top-level selectors, merged has 9 — the two new ones are `.jata-btn` (main sets geometry at line 191; ours adds a token transition at 1929 — later rule wins, additive) and `.pos-nav-link[data-active="true"]` (main 1264 vs ours 2146, ours wins with a token background). Recorded as a follow-up cleanup; not altered |
| `components/BusinessPage.tsx` | +2−1 — `formatNumber(priceFrom)` from the deterministic formatter | +1−1 — `toLocaleString("en-KE")` | Same symptom (locale-dependent digits), different mechanisms | Deterministic price text on a hydration-relevant surface | Keeping the runtime-locale call re-opens the ICU-dependence this branch removed | **ours** (`formatNumber`). The file is a client component, so a runtime-locale call is exactly the defect class removed here, and the helper is the tested one used across the rebuilt surfaces. **Residual (D-3):** main still formats dates with ambient-time-zone `toLocaleString("en-KE")` in 8 client components (POS/preview/dashboard) — see §G.6. Verified: design-system 21/21, full suite green |
| `package.json` | +16−4 — 4 UI libraries, `puppeteer-core ^25.13.0`, override reshape | +20−5 — three browser-check scripts, `motion ^14.1.0`, next/eslint-config-next 15.5.27, overrides (`source-map-js`, `brace-expansion@1`, `brace-expansion@5`, `basic-ftp`, `postcss-selector-parser`) | **Semantic conflict in dependency posture** | main's QA scripts, motion, Next/ESLint patches and override set; our four UI libraries (each imported by our components) | main's `tests/unit/dependency-security-compat.test.ts` pins `puppeteer-core 23.11.1` and imports `basic-ftp`; our v25 upgrade **removes** that module, so the file fails to load on the candidate if our bump wins | **main's version + our 4 UI deps** (`@tanstack/react-table ^9.3.1`, `lucide-react ^1.56.0`, `recharts ^3.10.1`, `sonner ^2.0.8`). Our `puppeteer-core` bump is *not* applied — see D-2. Verified: dependency-security test 13/13 on the candidate |
| `package-lock.json` | +874−864 | +124−63 | Regenerated as a whole | A lock consistent with the resolved `package.json` | Hand-merging a lock is how silent version shifts happen | **main's lock + the 4 UI deps**, regenerated with `npm install` (not hand-edited). Verified invariants: next 15.5.27, eslint-config-next 15.5.27, motion 14.1.0, puppeteer-core 23.11.1, basic-ftp 6.2.3, source-map-js 1.2.2, postcss-selector-parser 7.1.6, brace-expansion 1.1.21 (nested 5.0.12) |

Two files of **our own** test suite needed adaptation so that the merged contract is still guarded —
both strengthen or preserve intent, neither deletes an assertion without replacement:

- `tests/unit/hydration-render-parity.test.ts` — the prop changed from `today` to `calendar`; the
  invariants are unchanged (identical HTML in three server time zones, identical across a fake
  Nairobi-midnight crossing, the day list comes from the server, and the component contains no
  `new Date()`).
- `tests/unit/design-system.test.ts` — one substring now matches the merged shell's two-argument
  `themeRootClassName(theme, familyClasses)` call; the contract itself (one stylesheet, tokens,
  storefront root classes) is untouched.

### G.3 Isolated integration candidate — created, green, and (at the time) not published

> **Update:** the candidate was applied to the published branch on 2026-10-13 under the owner's
> "proceed" authorization, as merge `fde6865` — see **§G.13**. The text below describes the state
> before that push.

Because the directive forbids rewriting the published branch without authorization and forbids
unilateral branch creation, the experiment ran in a **detached git worktree** (no branch, no push,
`main` untouched):

| Step | Value |
| --- | --- |
| Base | `main` = `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` |
| Second parent | our branch tip = `7ec72c6688fac596655c226fb621f837f015d61d` |
| Method | `git merge --no-commit` then resolutions per §G.2, then a detached commit — **no branch was created, nothing was pushed** |
| Candidate SHA | `b5f058bfee2b87e53923e947c19017ee9c27f558` (local object only; reproducible from the two published SHAs plus this section) |
| Integrity | our branch changed 67 files; the candidate's delta vs `main` is those 67 **minus two** — `app/b/[slug]/book/page.tsx` and `components/storefront/BookingClient.tsx`, where `main`'s later fix is the equivalent superset. No file beyond ours appears, i.e. no `main` work was overwritten |
| Type check | `tsc --noEmit`: 1 error — main's pre-existing "Prisma client not generated (offline)" artifact. Baseline plain `main` on this machine: the same 1 error. **Zero merge-introduced type errors** |
| Full suite | **174 files passed | 13 skipped, 2188 tests passed | 114 skipped | 0 failed** (green includes main's 107 commits of tests and our 65 changed files together) |
| Payment suites on the candidate | `tests/integration/subscription-payment-revival.test.ts` 14/14; payment unit suites green |
| Audits on the candidate | 10 high (all development-only), **0 production** — identical to `main`; our 4 UI libraries add no finding |
| Not done | no branch, no push, no PR, no deploy, no migration, no production configuration, no spending |

The 114 skips are ours (95, ledger §E.3) plus 19 that are main's own database-backed files
(`experience-art-direction` 6, `experience-boundary` 8, `professional-enquiries` 5). Skipped is not
passed; they are still **NOT TESTED** against a database.

### G.4 Branch currency and integration strategy — recommendation

The published branch is 107 commits behind and cannot produce CI in its current state. Three options:

| Option | Effect | Authorization needed | Assessment |
| --- | --- | --- | --- |
| **A. Merge `main` into the published task branch** (ordinary merge commit, no force-push, no history rewrite) | PR #45's head updates to the integrated tree; GitHub can build the merge ref; `pull_request` CI starts (Postgres + Chrome) | Owner approval to change PR #45's contents by merging | **Recommended.** Preserves the published branch and its PR, avoids a duplicate PR, and is the only route that makes main's database and browser CI run against the integrated tree |
| B. Separate integration branch from `main` with the same resolution | Isolated; a second PR would be needed | Owner approval to **create a new branch** | Adequate but creates a duplicate review surface; the directive already forbids creating a second PR |
| C. Leave as-is | No CI can ever run on this work | none | Not viable |

The candidate in §G.3 **is** the resolution option A would apply (identical content), so the decision
is procedural, not technical.

### G.5 Database-backed CI (Phase 5): **BLOCKED at the time — RESOLVED in §G.13** (run `38439687233`, 2262 passed / 0 skipped)

- The mechanism exists on `main`: `Interactive Business E2E` runs on `pull_request → main`,
  `push → main` and manual dispatch; the job provisions a disposable **`postgres:16` service**
  (`DATABASE_URL` and `PRISMA_TEST_DATABASE_URL` point at it — no deployment secret), runs
  `prisma migrate`, seeds plans, then `npx vitest run --exclude "tests/e2e/**"` and **fails the job
  if any test was skipped**, then the §66 journey and the POS journey, a production build, and the
  browser steps.
- Limiting factor, exactly: **PR #45 is `dirty`**, so GitHub cannot build the merge ref and no
  `pull_request` run exists. `gh workflow run --ref` returns **403** (the integration token has no
  `actions:write`), and this environment has no `DATABASE_URL`, no Postgres and no docker
  (`prisma generate` cannot even reach `binaries.prisma.sh`).
- Consequence: all 95 previously skipped tests (names and reasons in §E.3) remain **NOT TESTED
  against a database** on this work. No protection or permission was bypassed, and no skipped test
  is presented as passing.
- Smallest authorized action that unblocks it: approve option A or B in §G.4. After the push, the
  run id, the tested SHA and the pass/fail/skip counts must be recorded here before the release gate
  can close.

### G.6 Real-browser hydration (Phase 6): **BLOCKED at the time — RESOLVED in §G.13** (booking SSR/midnight hydration 25/25 in run `38439687233`)

- This sandbox has no Chrome/Chromium binary and no way to obtain the shared libraries (`apt-get`
  is unavailable), so no real browser can be launched here; the Vercel preview is SSO-protected and
  was not probed. jsdom evidence (§B1) stays jsdom evidence — it is **not** browser proof.
- The real-browser checks that would settle it exist on `main` and run in CI
  (`test:browser:studio-hydration`, `test:browser:hydration-race`, plus motion/immersive/layout/
  families/media-local), and they will only run for this work through §G.4 → §G.5.
- New residual risk found while resolving the conflicts: `main`'s remaining client components still
  format dates with the ambient time zone — `toLocaleString("en-KE")` in 8 client components
  (`components/dashboard/PreviewClient.tsx:146`, `components/pos/*Client.tsx`, …), which renders one
  string on a UTC server and another in a Nairobi browser between 21:00–24:00 UTC. This is the same
  class of divergence this branch removed for the surfaces it rebuilt. It was **not** changed in the
  candidate (out of scope for conflict resolution) — owner decision **D-3**.
- Smallest owner action: authorize §G.4 (CI then produces browser evidence on the candidate SHA), or
  run the 10-minute script in "Phase 4" above between 21:00–24:00 UTC with 5–10 reloads.

### G.7 Payment-provider (Paystack) gate — **BLOCKED — OWNER VERIFICATION REQUIRED** (unchanged)

No authorized access exists from here, and no secret was requested, read, copied or logged. The
7-step checklist in "Phase 5 — Paystack configuration review" is unchanged and still needs the owner:
live vs test key mode in the correct Vercel environment and preview/test separation, the webhook URL
`/api/paystack/webhook` with real signature verification, the base URLs (`PAYSTACK_BASE_URL`) used
consistently by server-side verification, and one small real charge + refund before go-live
(the last needs explicit spending authorization). The code-side guarantees are verified: HMAC-SHA512
signature check with `WEBHOOK_SIGNATURE_FAILED` audit, evidence validation
(`REFERENCE_MISMATCH`/`AMOUNT_MISMATCH`/`CURRENCY_MISMATCH`), `WEBHOOK_TRANSACTION_MISMATCH`, and a
provider-independent reference so a forged callback cannot settle anything.

### G.8 Dependency audits re-measured today (Phase 8)

| Tree | All findings | Production (`--omit=dev`) |
| --- | --- | --- |
| `main` @ `8db6a9e4` | 10 high / 0 moderate / 0 critical | **0** |
| Candidate @ `b5f058b` | 10 high / 0 moderate / 0 critical — same package set | **0** |
| Our branch @ `7ec72c66` | 9 (7 high, 2 moderate) | **0** |

Findings sit in these chains: `@puppeteer/browsers` + `extract-zip` + `puppeteer-core` (development
browser tooling); `braces` + `micromatch` + `fast-glob` + `chokidar` + `tailwindcss` +
`@next/eslint-plugin-next` + `eslint-config-next` (Tailwind 3 / ESLint tooling).

Assessment (no automatic upgrade, per directive): our branch's only reduction lever is
`puppeteer-core` 23 → 25, which deletes the `extract-zip`/`@puppeteer/browsers` chain entirely — but
`main`'s ratified lock test pins `puppeteer-core` 23.11.1 *and* imports `basic-ftp`, so adopting our
posture **requires editing that main-side test** ("puppeteer-core 23.11.1" pin + the whole
`basic-ftp` API section). That is an owner decision (**D-2**), not a conflict-resolution action.
For the other chain there is no narrow fix in range: `braces` has no patched release at any version,
`eslint-config-next@14.2.35` is a downgrade incompatible with Next 15, and Tailwind 4 alone does not
clear the findings. Recommendation: land the integration with `main`'s posture (production stays at
zero) and schedule the Next/ESLint/Tailwind 4 evaluation as a separate authorized migration. Nothing
was suppressed, downgraded, or reclassified.

### G.9 Preservation checklist on the candidate (Phase 9)

| Must be preserved | Evidence on `b5f058b` | Result |
| --- | --- | --- |
| Auth and tenant isolation | main's suites + our suites in the green full run | PASS (non-database suites) |
| Payment verification, idempotency, reconciliation | `activateSubscriptionForPayment` (`lib/paystack.ts:160`) is a real compare-and-set guarded by the settleable states with a `changed.count !== 1` lost-race path; `settleOrderPayment`/`failOrderPayment` unchanged; revival suite 14/14 | PASS |
| Entitlements and safe publication | `experience-publish`, `ai-entitlement*`, `published-product-design-system` suites green | PASS |
| Website Studio, POS, customer-generated products | full suite green (main's 107 commits + our 65 files together) | PASS (non-browser) |
| Shared design tokens + typed contract | `lib/designSystem.ts` `TEMPLATE_CONTRACT`; 21 design-system tests | PASS |
| Published-output regression: categories × themes | `published-product-design-system.test.ts` asserts `CATEGORY_KEYS.length × EXPERIENCE_THEMES.length` renders | PASS |
| Architecture (Next.js/Prisma/Neon/Vercel) | only 4 additive UI libraries; no framework, Tailwind, Next or ESLint upgrade applied | PASS |
| Rollback / recovery | `DEPLOYMENT.md` §Rollback; per-commit `git revert`; nothing published by this phase | PASS |
| Media storage stays deferred | no storage/upload/provider code in the candidate's delta | PASS |
| No new cancellation/refund behaviour pre-policy | none appears in the candidate's delta | PASS |
| No hydration suppression added | `suppressHydrationWarning` count identical to `main` (1, pre-existing in `app/layout.tsx:24`) | PASS |
| Build success ≠ correct journeys | production build not run locally (offline Prisma engine); CI covers it | NOTE |

### G.10 Gate table and final status (as of the pre-integration audit — **superseded by §G.13.3**)

| Gate | Status | Evidence | Responsible |
| --- | --- | --- | --- |
| Hydration #418 — code | **PASS** | `calendar` contract on the candidate; parity/determinism/booking-hydration 49 tests; no suppression | Agent |
| Hydration #418 — real browser | **BLOCKED** | no browser here; CI path exists (§G.4/§G.5); residual ambient-TZ formatting in main's client components (D-3) | Owner + CI |
| Line-87 subscription payment gap | **PASS (code, offline)** / **NOT TESTED (Postgres)** | CAS at `lib/paystack.ts:160`; REFUNDED never settleable; revival 14/14; the database file itself self-skips here | CI |
| Database CI, all 95 previously skipped tests | **BLOCKED** | merge ref unbuildable; dispatch 403; no local Postgres | Owner (authorize §G.4), then CI |
| Dependency-security gate | **FAIL (development) / PASS (production)** | 10 high dev vs 0 production on the candidate; staged remediation | Owner (D-2) |
| Payment-provider readiness | **BLOCKED — OWNER VERIFICATION REQUIRED** | §G.7 / "Phase 5" checklist | Owner |
| Environment, secrets, monitoring, rollback | **PASS** | §B5 + `DEPLOYMENT.md` | Agent |
| Database migration compatibility | **PASS** | no migration in this work; §B6 | Agent |
| Design system + published output | **PASS** | 21 design-system tests; categories × themes regression | Agent |
| Integration/conflict resolution | **PASS locally / NOT TESTED on CI** | green candidate `b5f058b` (§G.3) | Owner (authorize), then CI |

**Final status: BLOCKED.** Four precise blockers, each with a ready next action:
(1) no authorized integration push, so CI has never run (database and browser evidence);
(2) production Paystack configuration unverified;
(3) development-advisory posture needs an owner decision;
(4) the live charge/refund path has never been exercised (owner, spending authorization).
No in-scope code gate fails on the evidence available.

### G.11 Owner decisions still required (as of the pre-integration audit — **superseded by §G.13.4**)

| # | Decision | Options | Why it matters |
| --- | --- | --- | --- |
| D-1 | First booking chip between 21:00–24:00 UTC | keep `main`'s UTC-day calendar (current candidate) **or** start the list on the Nairobi day | UX only; the server still validates slots. Changing it means altering `lib/experience/bookingCalendar.ts` + its browser test |
| D-2 | Dependency posture | adopt our `puppeteer-core ^25` + override reshape **and edit main's lock test** (removes the `extract-zip`/`@puppeteer/browsers` chain: 10 → fewer dev findings) **or** keep `main`'s pins (10 dev findings, production 0) | Cannot be done inside conflict resolution; it changes a main-side ratified test |
| D-3 | Ambient-time-zone date formatting in main's remaining client components (8 files) | fix now (touches POS/preview surfaces) **or** schedule with a browser check at 21:00–24:00 UTC | Same defect class as #418; today only detectable in a real browser |
| D-4 | Integration path (§G.4) | A: merge `main` into PR #45's branch (recommended) **or** B: authorize a separate integration branch | Unlocks database + browser CI; the code content is identical either way |
| D-5 | Live charge + refund exercise | authorize or defer | The only evidence that the production provider is wired end-to-end |
| D-6 | Media storage | keep deferred | Unchanged; no provider, credentials or uploads |

### G.12 What this phase did and did not do

- **Did:** read-only remote/preflight verification; a full six-file conflict inventory from the merge
  base; an **isolated, unpushed** integration candidate with type-check, full-suite and audit
  evidence; re-verification of the payment fix; a fresh audit comparison; this report update.
- **Did not:** no merge into `main`, no force-push, no history rewrite, no new branch, no second PR,
  no push of the candidate, no deploy, no migration, no production env var, no provider activation,
  no real transaction, no spending, no production data change, no dependency upgrade, no test
  weakened (two of our tests adapted to the merged contract with their invariants kept), no advisory
  suppressed, no secret read or logged.

---

## G.13 Integration executed on the published branch — and the database/browser CI evidence (2026-10-13, same day)

**Authorization.** The owner replied "proceed" to the request in §G.4/§G.11 D-4, i.e. **option A**: merge
`main` into the published task branch. Executed exactly as recommended; nothing else was authorized or done.

| Item | Value |
| --- | --- |
| Merge commit | `fde686559f681ddad690ac66d023c7718554797c` — parents `8714f8ff` (branch tip) + `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` (`main`). Ordinary merge commit: **no force-push, no history rewrite, no branch created** |
| Resolution provenance | Before the commit existed, the staged index was verified **byte-identical to the already-tested candidate `b5f058b` except `RELEASE_REPORT_2026-10-13.md`** (`git diff --cached b5f058b` = 1 file). So the tested candidate *is* the merge that was pushed |
| Push | `8714f8f..fde6865 arena/fac28f53-jata-aftercall` (non-force); the remote ref was re-read and confirmed afterwards |
| PR #45 after the push | `mergeable: true`, `mergeable_state: "unstable"`, 12 commits, 65 changed files, head `fde6865…`, label **NOT APPROVED FOR PRODUCTION DEPLOYMENT** retained |
| Local re-verification on the branch itself | `tsc`: 1 error = main's pre-existing offline-Prisma artifact (identical to main's baseline, **0 introduced**). `vitest`: **174 files passed / 2188 tests passed / 114 skipped / 0 failed** (skips are the DB files that self-skip without `DATABASE_URL`) |

### G.13.1 CI run `38439687233` — `Interactive Business E2E`, `SUCCESS`

Event `pull_request`, head `fde686559f681ddad690ac66d023c7718554797c`, job "Journey against a real database",
all steps green (the only skipped step is the failure-reporting step, which correctly did not run).
The workflow published its own evidence to PR #45 as `issuecomment-6151667650`:

| Step | Evidence |
| --- | --- |
| Full native DB suite (`npx vitest run --exclude "tests/e2e/**"`) against the disposable `postgres:16` | **185 files / 2262 tests passed, 0 failed, 0 skipped.** The step fails the job if any test is skipped, so the 95 previously skipped tests of §E.3 — including `tests/prisma/subscription-payment.test.ts` and the line-87 case — genuinely executed against real PostgreSQL |
| §66 experience journey | 17 passed |
| Business POS journey | 22 passed (plus the 1 non-DB case in that file, matching the local ledger) |
| Production HTTP isolation smoke | 9 passed |
| Authenticated production HTTP/browser/DB journey | 428 passed |
| **Booking SSR timezone + midnight hydration regression (real browser)** | **25 passed, 0 failed, 0 skipped** — the browser evidence that §G.6/Phase 4 could not produce from this machine |
| Hydration #418 controlled race reproduction | The synthetic arms reproduce #418/#423 **by construction** (positive control — the detector works); the **forced arm (8 iterations) and control arm (3 iterations) show 0 #418 and 0 other errors** on the real app |
| Motion / immersive / layout / registered-family / raster browser regressions | 124 / 22 / 7 / 167 / 29 passed, 0 skipped |
| Migrations, seed, lint, types, production build on the isolated DB | passed |
| Lint and TypeScript | passed |
| Production dependency audit | **PASS — 0 production findings**; full audit still **FAIL — 10 findings (10 high)**, exactly as measured locally in §G.8 (decision D-2 unchanged) |

### G.13.2 Caveats recorded, not hidden

1. **Dashboard-preview samples timed out for 4 of 5 categories** in the authenticated browser journey:
   `food`, `salon`, `professional`, `technical` returned `ok:false — TimeoutError: Waiting failed: 25000ms
   exceeded` on all three attempts each (retail succeeded). The step passes because it does not require
   those samples, and **no #418 appears in them**. This is an unresolved triage item (throttled 4× preview
   load latency), reported as an observation — not presented as a pass and not evidence for or against #418.
2. CI's browser harness is Chrome-on-Linux with synthetic fixtures and a disposable database; it is **not**
   a physical-device, provider-payment, storage or production-Core-Web-Vitals proof.
3. The workflow's closing sentence "Inherited expected failure is preserved, not fixed" is **boilerplate in
   the workflow's comment template**, not a computed fact. On this head it is inaccurate: the repository
   now contains **zero** `it.fails`/`.fails(` markers (only a comment quoting the removed marker). Flagged
   for the owner; main's workflow file was not edited.
4. This report-only push triggers exactly one further run on an identical tree; its id and result appear in
   the PR's comment thread and in the hand-off summary. A green result there re-verifies the same tree.

### G.13.3 Current gate table (supersedes §G.10)

| Gate | Status | Evidence | Responsible |
| --- | --- | --- | --- |
| Hydration #418 — code | **PASS** | merged contract + parity/determinism/booking-hydration suites; no suppression added | Agent |
| Hydration #418 — real browser | **PASS (CI) at `fde6865`** — with an open item at the report-only commit | run `38439687233`: booking SSR/midnight hydration 25/25; #418 forced/control arms 0 errors; run `38441832430` (Markdown-only difference) failed earlier in the authenticated browser step and skipped this one — §G.14 | CI + owner (read the untruncated log) |
| Line-87 subscription payment gap | **PASS (PostgreSQL-verified)** | CAS at `lib/paystack.ts:160`; REFUNDED never settleable; revival 14/14 locally and the full DB suite green in CI with 0 skips | CI |
| Database CI — all previously skipped tests | **PASS** | run `38439687233`, **and again 2262 tests / 0 skipped in run `38441832430`**, at `fde6865` / `d5bd1eb` | CI |
| Payment-provider readiness (Paystack) | **BLOCKED — OWNER VERIFICATION REQUIRED** | §G.7 / "Phase 5" checklist; only the owner holds the dashboards | Owner |
| Live charge + refund exercise | **BLOCKED — OWNER AUTHORIZATION** | D-5; explicit spending authorization required | Owner |
| Dependency-security gate | **PASS (production) / FAIL (development, by design of main's gate)** | production 0 in CI and locally; 10 high development findings with staged remediation (D-2) | Owner (decision) |
| Environment, secrets, monitoring, rollback | **PASS** | §B5 + `DEPLOYMENT.md` §Rollback | Agent |
| Database migration compatibility | **PASS** | CI applied migrations to the disposable DB at this SHA; no migration in the branch | CI |
| Design system + published output | **PASS** | 21 design-system tests; categories × themes regression; family geometry 167/167 in CI | Agent/CI |
| Integration/conflict resolution | **PASS** | candidate tree == merged tree; CI green on the merged SHA | Agent/CI |

**Final status: BLOCKED — owner-verification items only.** Every machine-verifiable mandatory gate is
verified at `fde6865` with run `38439687233` as evidence (the database suite is green in both runs),
and one CI-side open item is recorded in §G.14 (the authenticated browser step failed on the later
Markdown-only commit; cause unidentified, no code difference between the two runs). Three items remain, all requiring the owner:
production Paystack configuration verification (§G.7), authorization for one live charge + refund (D-5),
and the development-advisory decision (D-2). No code gate fails; nothing is merged into `main`, nothing is
deployed, and the PR keeps its NOT-APPROVED label.

### G.13.4 Owner decisions — update (supersedes §G.11 where noted)

| # | Decision | State |
| --- | --- | --- |
| D-1 | First booking chip between 21:00–24:00 UTC | open (cosmetic; unchanged) |
| D-2 | Dependency posture (our `puppeteer-core ^25` vs main's pin + 10 dev findings) | open; CI now confirms production 0 and the 10 development findings |
| D-3 | Ambient-time-zone date formatting in main's remaining client components | open; the browser regression suites pass, so no failure is observed today |
| D-4 | Integration path | **EXECUTED — option A** (§G.13); PR #45 is now `mergeable: true` |
| D-5 | Live charge + refund exercise | open (owner authorization) |
| D-6 | Media storage | unchanged: deferred |


---

## G.14 Report-only follow-up run — `38441832430` FAILED in the authenticated browser step (open item)

The push of §G.13 (a **Markdown-only** change; `fde6865` → `d5bd1eb`) triggered one further CI run, exactly as §G.13.2 caveat 4 anticipated.

| Item | Run `38439687233` (green) | Run `38441832430` (red) |
| --- | --- | --- |
| Head | `fde686559f681ddad690ac66d023c7718554797c` | `d5bd1eb5cc58753ae5ef305502ecb991382f8f2f` |
| Tree difference | — | only `RELEASE_REPORT_2026-10-13.md` |
| Full native DB suite | 2262 passed / 0 skipped | 2262 passed / 0 skipped |
| §66 + POS journeys | 17 + 22 passed | see note 1 |
| Authenticated production HTTP/browser/DB journey | **428 passed, 0 failed** | **427 passed, 1 failed** — step failed, so the steps after it were skipped |
| Booking SSR/midnight hydration (real browser) | **25 passed, 0 failed** | **skipped** (blocked by the step above) |
| #418 controlled race reproduction | 0 #418 in forced/control arms | skipped |

**What can be stated from evidence:** the two runs differ by **one Markdown file**, so the failure is **not attributable to any code change in this branch**; it originates inside the authenticated browser step's own harness/environment. **What cannot be stated:** the identity and cause of the failing check. The workflow's failure report truncates the middle of its comment (the per-check `FAIL` line fell inside the truncated region), and the CI log/artifact host is not reachable from this environment (a sandbox network-policy limit, not a repo limit). `gh run rerun --failed` was refused: *"run 38441832430 cannot be rerun; its workflow file may be broken"*.

Context that makes this step strained rather than clean: in the green run itself, the dashboard-preview samples for four of five categories already timed out at 25 s under the harness's 4× CPU throttle (§G.13.2 caveat 1), and run #2 emitted a series of `Unique constraint failed on the fields: ('id')` Prisma errors from `AIQualityEvent.create()` before the step's summary. Neither is yet explained.

**Classification: NOT TESTED — cause unidentified.** This is recorded as an open item; it is not called a flake and not called a regression.

**Smallest owner action:** in the repo's Actions tab, open run `38441832430` → job *Journey against a real database* → the failing step, and read the untruncated log (or use *Re-run failed jobs* and inspect the same step). One line — the failing check's name — is all that is needed to triage. The green evidence at `fde6865` (run `38439687233`, including the database suite and the booking-hydration browser step) stands on its own SHA and is unaffected.
