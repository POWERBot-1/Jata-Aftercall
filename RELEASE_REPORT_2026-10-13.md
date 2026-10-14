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
| Final status | **BLOCKED — owner-verification and owner-decision items only**; gate table **§G.13.3**, decision register **§H.11**, executed presentation fixes and the current held items **§H.13** (end of this document). Every machine-verifiable gate is green at `fde6865`/`d616ae6` with runs `38439687233` / `38445602486` as evidence; what remains is the owner's Paystack verification, the D-1/D-2/D-3 decisions, and explicit authorization for any live charge |

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
| Hydration #418 — real browser | **PASS (CI) at `fde6865`** — with an open item at the report-only commit | run `38439687233`: booking SSR/midnight hydration 25/25; #418 forced/control arms 0 errors; run `38441832430` (Markdown-only difference) failed earlier in the authenticated browser step and skipped this one — did not reproduce; run `38443603926` at `6a24c92` is green (428/0, hydration 25/25) — §G.14 | CI (+ optional triage) |
| Line-87 subscription payment gap | **PASS (PostgreSQL-verified)** | CAS at `lib/paystack.ts:160`; REFUNDED never settleable; revival 14/14 locally and the full DB suite green in CI with 0 skips | CI |
| Database CI — all previously skipped tests | **PASS** | run `38439687233`, **and again 2262 tests / 0 skipped in run `38441832430`**, at `fde6865` / `d5bd1eb` | CI |
| Payment-provider readiness (Paystack) | **BLOCKED — OWNER VERIFICATION REQUIRED** | §G.7 / "Phase 5" checklist; only the owner holds the dashboards | Owner |
| Live charge + refund exercise | **BLOCKED — OWNER AUTHORIZATION** | D-5; explicit spending authorization required | Owner |
| Dependency-security gate | **PASS (production) / FAIL (development, by design of main's gate)** | production 0 in CI and locally; 10 high development findings with staged remediation (D-2) | Owner (decision) |
| Environment, secrets, monitoring, rollback | **PASS** | §B5 + `DEPLOYMENT.md` §Rollback | Agent |
| Database migration compatibility | **PASS** | CI applied migrations to the disposable DB at this SHA; no migration in the branch | CI |
| Design system + published output | **PASS** | 21 design-system tests; categories × themes regression; family geometry 167/167 in CI | Agent/CI |
| Integration/conflict resolution | **PASS** | candidate tree == merged tree; CI green on the merged SHA | Agent/CI |

**Final status: BLOCKED — owner-verification and owner-decision items only.** (Directive 4's register in §H.11 is the current one.) Every machine-verifiable mandatory gate is
verified at `fde6865` with run `38439687233` as evidence (the database suite is green in both runs),
and the one CI-side anomaly is recorded and closed as intermittent in §G.14: the authenticated
browser step failed on one later Markdown-only commit, then passed 428/0 on the next run of the
same code, with the database suite green in every run. Three items remain, all requiring the owner:
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

**Update — the failure did not reproduce.** Run `38443603926` at `6a24c92d2d1ec09e79c8a9331d60bb50f83aaf56`
is **SUCCESS** with the identical code: full native DB suite **2262 passed / 0 skipped**, authenticated
journey **428 passed / 0 failed / 0 skipped**, booking SSR/midnight hydration **25/25**, motion 124,
immersive 22, layout 7, families 167, raster 29 — all green. `git diff --name-only d5bd1eb 6a24c92`
is this report file only, so the code, tests, lockfile and assets are the same as in the red run.
Two of three runs on identical code are therefore fully green, and the single failure in run #2 is
reclassified as an **intermittent CI-harness observation** rather than an unidentified defect.
> **Directive 4 update (§H.3):** *intermittent* describes the reproduction pattern, not an established
> cause. The failing check could not be named from this environment (logs, artifacts, annotations and
> re-runs are all blocked), so its status is **UNRESOLVED**, not "known flaky". The
failing check's name is still unread from here (same log-host limitation); triage is recommended when
convenient, but it is no longer an open release question, and the SHA-pinned green evidence at
`fde6865` (run `38439687233`) and `6a24c92` (run `38443603926`) stands.

**Smallest owner action:** in the repo's Actions tab, open run `38441832430` → job *Journey against a real database* → the failing step, and read the untruncated log (or use *Re-run failed jobs* and inspect the same step). One line — the failing check's name — is all that is needed to triage. The green evidence at `fde6865` (run `38439687233`, including the database suite and the booking-hydration browser step) stands on its own SHA and is unaffected.

---

## H. Release-gate closure and owner decision package (Directive 4, 2026-10-13 later)

Audit, investigation, evidence and decision-preparation only. **No code, test, dependency, configuration
or data change was made in this task.** No merge, no deploy, no live payment, no refund, no provider
activation, no production data or configuration touched, no spending.

### H.1 Verified repository and PR state (read from live GitHub, not assumed)

| Fact | Value |
| --- | --- |
| Repository / branch | `POWERBot-1/Jata-Aftercall` / `arena/fac28f53-jata-aftercall` |
| Task-branch tip (remote, verified) | `d616ae6b98642da3c22e306563164262f8b854da` — matches the reported HEAD |
| `main` (remote, verified) | `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` — unchanged; last main-push CI run `38415386548` (2026-10-13T14:40Z, success) |
| PR #45 | **OPEN**, not draft, base `main`, head `d616ae6…`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, 15 commits, 65 changed files, label **NOT APPROVED FOR PRODUCTION DEPLOYMENT**, updated 2026-10-13T18:32:06Z |
| PR checks | `Journey against a real database` **pass** (run `38445602486`), Vercel **pass**, Vercel Preview Comments **pass** |
| Runs on this branch | `38439687233` success @ `fde6865` · `38441832430` failure @ `d5bd1eb` · `38443603926` success @ `6a24c92` · `38445602486` success @ `d616ae6` — no new runs, no new commits |
| Candidate and report on the branch | `lib/dateFormat.ts`, `lib/designSystem.ts`, `lib/experience/bookingCalendar.ts`, `tests/integration/subscription-payment-revival.test.ts`, `RELEASE_REPORT_2026-10-13.md` all present at the tip |

**Environment discrepancy, disclosed.** The execution sandbox was re-created at 19:41 UTC (its reflog
shows a fresh `clone` and a checkout at the merge base `77e35ce`), so at the start of this task the local
git history ended at the merge base while the persisted *files* were the tip's content — reported by git
as 198 untracked/modified entries. Nothing was assumed or discarded: I staged everything and verified
`git diff --cached origin/arena/fac28f53-jata-aftercall` was **empty** (byte-identical), then reconciled the
local branch to its own published tip with a fast-forward `git reset --hard origin/arena/fac28f53-jata-aftercall`.
No remote ref was written, no history rewritten, no branch created, no file changed.

### H.2 Release evidence revalidated (verified now vs carried from the previous report)

| Evidence | Reported | Status after re-verification |
| --- | --- | --- |
| Full native DB suite | 2,262 passed / 0 skipped | **VERIFIED, and stronger**: the same figures appear in **all four** runs' evidence comments (`6151667650`, `6151900209`, `6152180791`, `6152451962`), i.e. including in the failing run and on the current tip |
| §66 experience journey | 17 passed | VERIFIED (all runs) |
| Business POS journey | 22 passed | VERIFIED (all runs) |
| Authenticated HTTP/browser/DB journey | 428 passed / 0 failed | VERIFIED in the three green runs (and on the tip `d616ae6`); the failed run reported 427/1 (see H.3) |
| Booking SSR + Nairobi-midnight hydration (real browser) | 25 passed | VERIFIED in the three green runs, including the tip |
| Hydration-race detector | works | VERIFIED: the synthetic arms reproduce #418/#423 by construction (2 and 1 errors) while the **real-app forced arm (8 iterations)** and **control arm (3 iterations)** show 0 #418 and 0 other errors |
| Migrations, seed, lint, TypeScript, production build | pass in CI | VERIFIED in CI; locally `tsc` reports **1** error, identical to plain `main`'s baseline (**1**), i.e. the offline-Prisma artifact and nothing introduced; lint has 0 errors and the one pre-existing `<img>` warning |
| Production audit | 0 findings | VERIFIED in CI and locally |
| Development audit | 10 high | VERIFIED locally and printed by CI (`FAIL full dependency audit: 10 findings (10 high)`), by design |
| Local re-run at the tip | — | targeted booking/timezone/payment/POS/publication suites **121 passed**; full suite **2188 passed / 114 skipped / 0 failed** |

### H.3 The authenticated-browser failure — investigation result: **cause UNRESOLVED** (not called flaky)

Every read-side avenue was attempted; each is blocked by a specific, recorded limit:

| Avenue | Result |
| --- | --- |
| Runner logs (`/actions/runs/{id}/logs`, job logs) | Blocked: the API redirects to `results-receiver.actions.githubusercontent.com`, outside this sandbox's allowed network (exact failure recorded) |
| Artifacts | The failed run has exactly one artifact, `hydration-raw-order-evidence` (19,526 B); downloading redirects to `productionresultssa5.blob.core.windows.net` — also outside the allowed network |
| Check-run annotations | Only `Process completed with exit code 1` (line 560) plus the Node-20 deprecation warning — no check name |
| The workflow's own failure comment | **Truncates itself**: the handler keeps the first and last 5,500 characters of each step log (source: `.github/workflows/interactive-business-e2e.yml`, `Report failing output to the pull request`). The failing check sits in the discarded middle — the comment even prints `…[47143 characters truncated]…` |
| Re-run | `gh run rerun --failed` → "run … cannot be rerun; its workflow file may be broken"; REST `rerun-failed-jobs` → **403 Resource not accessible by integration** (token has no `actions:write`) |

What the available evidence *does* narrow, without naming it:
- The harness stops at the **first** failure and says so: *"NOT RUN: remaining required provider-free scenarios after first failure; passing attempted checks are not complete journey acceptance."*
- The red run is the only one of four containing `Unique constraint failed on the fields: ('id')` from `AIQualityEvent.create()` (3 occurrences; **0** in all three green runs) — a lead, not a conclusion.
- Code-identical comparison: the red run is at `d5bd1eb`; the green tips `6a24c92`/`d616ae6` differ from it **only in `RELEASE_REPORT_2026-10-13.md`** (`git diff --name-only d5bd1eb 6a24c92` = that one file).

Verdict: **UNRESOLVED.** It is not labelled a flake merely because later runs passed, and it is not labelled
a regression because no code differs. Evidence for the release candidate at `d616ae6` is green on that step.
**Smallest owner action:** open run `38441832430` → job *Journey against a real database* → failing step
`Authenticated production HTTP browser journey` and read the log (or use *Re-run failed jobs* in the UI);
one line — the check's name — is what this package is missing. Optionally grant the integration token
`actions:write` so future triage can be done from here.

### H.4 D-1 — the booking date/time contract (decision required; nothing changed)

**As implemented today** (file references are to the current branch tip):

| Layer | Behaviour | Source |
| --- | --- | --- |
| Availability slots | naive `"HH:MM"` strings, default `09:00 … 17:00` | `lib/experience/booking.ts:45-59` |
| Booking instant | `new Date(year, month-1, day, hours, minutes)` → **server-local = UTC on Vercel** | `lib/experience/booking.ts:167` |
| Date chips | UTC date keys computed on the server from `now` | `lib/experience/bookingCalendar.ts`, `app/b/[slug]/book/page.tsx:68` |
| Dashboard board | `formatDateTime` → **Africa/Nairobi** | `components/dashboard/BookingBoard.tsx:98` → `lib/dateFormat.ts:26` |
| Customer booking page ("When") | `formatDateTime` → **Africa/Nairobi** | `app/b/[slug]/booking/[id]/page.tsx:33` |
| In-app notification message | `startAt.toLocaleString("en-KE")` → server zone (**UTC**) | `lib/experience/payments.ts:474` |

**Two behaviours demonstrated on this branch** (commands run, output verbatim):

1. A customer taps **09:00 on 14 Oct** → stored `2026-10-14T09:00:00.000Z` → the dashboard and the
   customer's booking page show **"14 Oct 2026, 12:00"**, while the owner's notification message says
   **"… on 14/10/2026, 09:00:00."** One booking, two different times, on customer-visible surfaces.
2. At `2026-10-12T21:30:00Z` (**00:30 on 13 Oct** in Nairobi) the first chip is **`2026-10-12 Mon, 12 Oct`**
   — the *previous* Nairobi day — and because every slot on that day is already in the past in UTC, tapping
   it yields "No times left on this day. Try another date." (The server correctly refuses; nothing wrong is
   booked.)

**Why this is a decision, not a bug report:** the stored instants are UTC-anchored *by construction*, so the
Nairobi-pinned display added by this branch is a +3 h shift relative to the wall-clock time the customer
tapped; before the branch, that page rendered UTC server-side and matched the tap by accident. Which clock
is authoritative is a product decision.

| Package | Content | Cost / risk | Tests required |
| --- | --- | --- | --- |
| **A — keep UTC-anchored bookings** (recommended interim) | Add a UTC-pinned booking wall-clock formatter (additive, next to the existing ones) and use it at the three booking display sites (dashboard board, customer booking page, notification message); keep the UTC-day chip list. Document "availability slots are UTC clock times" for owners | Presentation-only; no data change; existing bookings render exactly as they do today; leaves the underlying "12:00 EAT is the real appointment time" wart to be stated plainly | Instant construction under `TZ=UTC`/`Africa/Nairobi`; the three surfaces render the same string; chip list across the 21:00–24:00 UTC window; existing rows unchanged; EAT has no DST (assert the fixed +3 offset) |
| **B — declare bookings Nairobi-anchored** (product-correct) | Build booking instants from Nairobi wall clock (09:00 EAT = 06:00Z) in `validateBookingRequest`, `freeSlotsFor`, `openDays` and the calendar, keep Nairobi display, and define an explicit rule for rows already stored (no silent rewrite) | Business-semantics change touching availability, capacity and "future" checks; needs a stated migration/interpretation policy and owner sign-off | All of A plus: slot round-trip 09:00 EAT ⇒ stored 06:00Z ⇒ displayed 09:00; availability/capacity unchanged against a real PostgreSQL run; legacy rows' meaning pinned by a test; the 21:00–24:00 UTC chip window |

Nothing was implemented: per the directive, the product contract must be selected before implementation.

### H.5 D-3 — ambient-time-zone formatting: findings supersede the previous statement

- **Correction:** on the merged tip there is **no client component** that formats with `toLocale*` or
  constructs an `Intl` formatter (exhaustive scan of every `"use client"` file under `components/` and
  `app/`: zero hits). The earlier "8 client components" count was taken against `main`'s tree; those
  components now use this branch's deterministic formatters.
- **Residual:** **16 ambient-format call sites in 10 server components** (the widened sweep in §H.13.1 later found 7 more in the same class — 23 across 14 files, all converted) —
  `app/admin/customers/page.tsx:36`, `app/admin/payments/wallet/page.tsx:62,93,139,171`,
  `app/admin/subscriptions/page.tsx:21,22`, `app/b/[slug]/shop/page.tsx:64`,
  `app/dashboard/pos/[businessId]/credit/page.tsx:111`, `.../expenses/page.tsx:58`, `.../sales/page.tsx:49`,
  `app/dashboard/subscription/page.tsx:81,99`, `app/receipt/[token]/page.tsx:92,93,104` — displaying
  payment/order/subscription timestamps in the **server's** zone (UTC) to Nairobi staff and customers.
- **Classification:** presentation-consistency, **not** a hydration risk (server components are rendered
  once and are not re-rendered during hydration) and **not** a release blocker. It is not "8 confirmed
  defects"; it is one display-convention gap, plus the booking-instant case in H.4.
- **Minimal fix plan if authorised:** adopt the existing deterministic formatters at those 16 sites — for
  true instants (payments, orders, subscriptions) the Nairobi-pinned ones; for **booking** instants, the
  formatter chosen in D-1. No transaction timestamp, storage, settlement or business rule changes.
  Regression list: the hydration parity/determinism suites (must stay green), the receipt/admin pages'
  rendering, and a new test asserting the chosen convention at each of the three booking surfaces.
- **Not implemented** — the booking-related sites depend on the D-1 decision, and the rest share the same
  convention, so one decision covers both.

### H.6 Preview-sample timeouts — classification and impact

- **What the samples measure** (`scripts/browser/studio-authenticated.check.mjs`, ~line 680): the owner
  *draft preview* page (storefront inside the dashboard iframe) is loaded for all five representative
  categories, three attempts each, under `Emulation.setCPUThrottlingRate: 4`, waiting for the iframe body
  to contain the fixture marker; the sample then feeds the **M11 emission-order gate** (`order` must never
  start with `script`). The harness states its own tolerance: *"Load timeouts under throttle skip the sample
  and never fail the journey."*
- **Reproducibility:** identical in **all four runs** — 3 `ok:true` (retail) and 12 `ok:false`
  (`TimeoutError: Waiting failed: 25000ms exceeded`, food/salon/professional/technical × 3 attempts). It is
  not run-specific and not correlated with the one red run.
- **Classification: harness/environment limitation with full reproducibility — not a customer-facing
  performance or reliability signal.** The failure mode is a wait timeout on a throttled synthetic harness
  against a dev server, not an HTTP error, exception or console error; the same job's other browser suites
  (booking SSR/midnight 25/25, motion 124, families 167, layout 7, immersive 22) pass.
- **Impact on the initial release:** limited evidence coverage, not a product defect — the M11 order gate is
  exercised for only 1 of 5 categories in CI, while #418 itself is covered by the dedicated
  booking-SSR/midnight and race-detector steps. Recommended as a follow-up, not a blocker.
- **Next safe diagnostic (no timeout relaxation):** instrument the sample to report *which* wait failed and
  the iframe URL/`body` head (harness-only change), and/or reproduce locally on a non-throttled browser. If
  the marker genuinely never appears for those categories under throttle, investigate per-category preview
  load. Raising the timeout to buy a green run is explicitly rejected.

### H.7 D-2 — development-advisory decision (verified facts, no change made)

Ten high-severity findings, all **development-only**: `npm audit --omit=dev` is **0** in CI and locally. Two
root advisories, everything else is propagation:

| Chain | Path | Root advisory | Patched release? |
| --- | --- | --- | --- |
| Tailwind 3 tooling | `tailwindcss@3.4.19` → `chokidar@3.6.0` → `braces@3.0.3`; `fast-glob@3.3.3` → `micromatch@4.0.8` → `braces@3.0.3` | `braces` GHSA-vfj7-8cjw-p6xm (stack-exhaustion DoS via deeply nested patterns) | **None exists**: `braces` latest = 3.0.3 = installed; npm reports the affected range as `*` |
| ESLint/Next tooling | `eslint-config-next@15.5.27` → `@next/eslint-plugin-next@15.5.27` → `fast-glob@3.3.1` → `micromatch` → `braces` | same | **Cannot be cleared by upgrading**: the latest `@next/eslint-plugin-next` (**16.4.0**) *still* depends on `fast-glob@3.3.1` |
| Puppeteer (dev browser tooling) | `puppeteer-core@23.11.1` → `@puppeteer/browsers@2.6.1` → `extract-zip@2.0.1` | `extract-zip` GHSA-jmr9-qjv8-65gv and GHSA-7pqw-9j4j-h8q3 (symlink traversal / arbitrary writes) | **None exists**: `extract-zip` latest = 2.0.1 = installed. **Removable**: `puppeteer-core@25.13.0` → `@puppeteer/browsers@3.2.4` → `{yargs, modern-tar}` (verified: no `extract-zip`) |

- **Production exposure:** none of these packages is in the production dependency tree, and no production
  build output is affected (Tailwind's chain is a build-time inputs concern; a malicious glob pattern in
  config would have to be supplied by someone who can already edit the repository).
- **Option A — documented risk acceptance:** retain the current pins (which are `main`'s ratified posture),
  record severity/environment/no-fix status, a review date and continued monitoring; the CI production gate
  stays at 0 and the full-audit FAIL stays visible in every run. Consequence of deferring: the two root
  advisories remain permanently unfixable-by-upgrade until the tooling majors change; the risk is limited to
  the development/build environment.
- **Option B — staged, separately scoped remediation (two independent tracks):**
  *B1 (small, verifiable):* move `puppeteer-core` 23 → 25, which removes `@puppeteer/browsers` + `extract-zip`
  (3 findings) and restores the remediation this branch already validated. It **requires editing `main`'s
  ratified lock test** (`tests/unit/dependency-security-compat.test.ts` pins `puppeteer-core 23.11.1` and
  imports `basic-ftp`), so it needs owner approval as a deliberate re-ratification, plus confirmation that
  the browser QA scripts still launch (13 API members were audited previously).
  *B2 (larger, scheduled):* Tailwind 3 → 4 (`tailwindcss@4.3.3` has **no dependencies**, so it removes
  `tailwindcss`, `chokidar`, `micromatch`, `fast-glob` and `braces` from this tree) with visual-regression
  and bundle checks; the ESLint chain then remains until a stable Next/ESLint line drops `fast-glob` (only
  16.5 canaries exist today).
- **Recommendation:** Option B, track B1 first (cheap, restores a real security fix, independently
  verifiable), B2 scheduled as a migration with rollback; otherwise Option A with a written acceptance and
  review date. `npm audit fix --force` is not used and no ratified pin is changed without approval.

### H.8 Paystack production-configuration checklist (owner-executed; no secret may enter Arena, GitHub, or any report)

Facts from the code that the checklist verifies *against*: only `PAYSTACK_SECRET_KEY` (server-only) enables
the connector and signature verification — `mode` is `LIVE` iff it starts with `sk_live_`, else `TEST`;
`PAYSTACK_PUBLIC_KEY` is read for connector status; the Paystack base URL is hard-coded
`https://api.paystack.co` (not environment-configurable); Paystack signs with the same secret, so there is no
separate webhook secret; the test mock (`?mock=success`) is unreachable when `NODE_ENV === "production"` **or**
a secret is present.

1. **Project/environment:** confirm the Vercel project is the one attached to this repository and that you are
   editing the **Production** environment (not Preview/Development) for the project that serves the live domain.
2. **Key mode separation:** in Paystack's dashboard, confirm the **live** account/keys are the ones whose
   public/secret pair is installed in Vercel Production, and that no test key sits in Production (or a live
   key in Preview/Development).
3. **Secret storage:** confirm `PAYSTACK_SECRET_KEY` is set as a server-side environment variable (not
   `NEXT_PUBLIC_*`), is not exposed to the client bundle, and exists only in Vercel's encrypted env store.
4. **Webhook endpoint:** confirm the Paystack webhook URL is `https://<live-domain>/api/paystack/webhook`,
   delivered as POST with the raw JSON body, and that it is not behind an auth wall or rewrite.
5. **Signature verification:** confirm Paystack's dashboard shows recent successful deliveries (2xx). The app
   verifies `x-paystack-signature` with HMAC-SHA512 over the raw body and a constant-time compare; failures
   are logged as the audit event `WEBHOOK_SIGNATURE_FAILED` (a spike there means the secret in Vercel does
   not match the one signing the events).
6. **Server-side verification:** confirm the response/callback flow reaches `/api/paystack/verify` and that
   settlement requires provider evidence (`REFERENCE_MISMATCH` / `AMOUNT_MISMATCH` / `CURRENCY_MISMATCH`
   audits appear only for genuine mismatches), never a client-supplied status.
7. **Idempotency:** confirm the `processedWebhook` table is present in the production database and that a
   replayed event yields `already_paid` (or an ignored duplicate) rather than a second activation.
8. **State transitions:** confirm subscriptions activate on `charge.success`, POS payments settle the POS
   entitlement, refunds move a payment to `REFUNDED` and suspend the entitlement, and that `REFUNDED` is never
   revived (audit events: `SUBSCRIPTION_ACTIVATED`, `WEBHOOK_PARTIAL_REFUND_REVIEW_REQUIRED`).
9. **Logging/redaction:** confirm no secret or full provider payload is written to logs or to audit metadata
   (the code stores ids/status only). Never paste a key into chat, an issue, a PR, or this report.
10. **Rollback/incident:** know the Vercel rollback path (`Deployments → Rollback`), the kill-switch
    (remove/rotate `PAYSTACK_SECRET_KEY` stops verification and settlement), and how to review
    `/health` + the audit events above. Configuration review alone is **not** evidence that a real
    transaction succeeds — that is H.9, separately authorized.

### H.9 Bounded live-payment test plan (proposed — **NOT executed**; BLOCKED pending explicit owner authorization)

Marked **BLOCKED — EXPLICIT OWNER AUTHORIZATION REQUIRED** until the owner approves the exact scope. Nothing
in this plan may be executed on the basis of earlier approvals to implement or test payment code.

Owner must pre-agree, in writing: (1) the **test account** and environment (a test-mode first pass, then one
live charge in the production environment only if the owner wants production proof); (2) the **amount** —
the smallest amount Paystack's live rules permit for a card charge, with the fee schedule confirmed in the
dashboard (not assumed here) and the exact amount recorded before the run; (3) the **payment method** and the
**consenting participant** (owner's own card, owner present); (4) the **exact procedure** including the
reference naming convention; (5) **duplicate prevention** — one reference, one attempt, no retry on a
timeout without first checking the Paystack dashboard; (6) **refund** procedure and how it will be verified
(provider dashboard + the app's `REFUNDED`/suspension path); (7) the **expected evidence** — receipt page,
webhook delivery, audit events, notification, reconciliation row; (8) **failure handling, evidence capture
and stopping conditions** (stop immediately on any unexpected status, any second settlement, or any
deviation; capture timestamps and audit-event names, never keys or full payloads); (9) **production
deployment approval remains a separate decision** and is not implied by approving this test.

### H.10 Payment, POS and publishing invariants — confirmed preserved

Local runs at the tip: targeted booking/timezone/payment/POS/publication suites **121 passed**; full suite
**2188 passed / 114 skipped / 0 failed**; CI at the tip: DB suite 2262 / 0 skipped, POS journey 22, §66 17,
authenticated journey 428/0. Verified in code and tests: payment status is only ever settled from verified
provider evidence (`lib/paymentVerification.ts`, compare-and-set in `lib/paystack.ts`), tenant isolation and
authorization suites are green (`tests/security/*`), webhook processing is idempotent
(`processedWebhook` + CAS), receipts/reconciliation paths are unchanged, unpaid or unentitled businesses
cannot publish (`experience-publish`, `ai-entitlement*`), publication still requires verified payment behind a
valid subscription with the existing admin override, and **no new stale-order/refund behaviour was added** —
the documented policy proposal is still the precondition for any such change.

### H.11 Owner decision register (2026-10-13, Directive 4)

| Gate | Required outcome | Evidence | Status | Owner action | Next safe step |
| --- | --- | --- | --- | --- | --- |
| Paystack production configuration | Owner verification recorded, without exposing secrets | H.8 checklist + code facts (H.8) | **BLOCKED** | Walk the 10 checks in the Vercel/Paystack dashboards; report only pass/fail per line | Record the outcome in this report's register; any mismatch → fix in the dashboards, not in code |
| Live charge + refund exercise | Explicit scope approval; no transaction executed by this task | H.9 plan | **NOT AUTHORIZED** / BLOCKED | Approve the exact scope, amount, participant and stopping conditions | Execute only after approval, then record reference, receipt, webhook and audit evidence |
| D-2 development advisories | Owner selects risk acceptance or staged remediation | H.7 (verified: no patched `braces`/`extract-zip` exist; `puppeteer-core@25` and `tailwindcss@4` are the only removals) | **BLOCKED (decision)** | Choose A, or B with B1 first | B1: separate scoped change that also re-ratifies `main`'s lock test; B2: scheduled migration with visual regression |
| D-1 booking-date contract | Confirmed contract or explicit owner decision | H.4 (two demonstrated behaviours; three surfaces, two times) | **BLOCKED (decision)** | Choose Package A (keep UTC-anchored storage, align display) or Package B (Nairobi-anchored bookings) | Implement the chosen package with the listed tests; no silent semantics change |
| D-3 timezone presentation | Confirmed findings, safe fix plan, or owner decision | H.5 (no client-side ambient formatting remains; 16 server-component sites) | **RESOLVED (findings)** — fix optional | Approve the small presentation-consistency fix, ideally together with D-1 | Apply the deterministic formatters at those sites; keep hydration suites green |
| Preview-sample timeouts | Evidence-based classification or unresolved status | H.6 (identical in all four runs; harness-design tolerance; order gate covered 1/5) | **UNRESOLVED (cause of the timeouts) / harness limitation** | Allow a harness-only diagnostic change | Instrument which wait fails and the iframe URL/body head; do **not** raise the timeout |
| Authenticated-browser failure (run `38441832430`) | Named failing check | H.3 (logs/artifacts/annotations/re-run all blocked) | **UNRESOLVED** | Read the failing step's log in the Actions UI (or grant `actions:write`) | Record the check name here; only then decide whether it is environment or product |
| Media storage | Remains deferred | No storage code or provider in the branch | **NOT AUTHORIZED** (deferred) | — | Unchanged |
| PR #45 merge | Not authorized | PR open, `CLEAN`, label retained | **NOT AUTHORIZED** | Owner decision, separate from this package | — |
| Production deployment | Not authorized | No deploy performed | **NOT AUTHORIZED** | Owner decision after the gates above | — |

### H.12 What this task did and did not do

- **Did:** read-only verification of repository, remote refs, PR, checks and runs; a re-validated evidence
  matrix; a documented investigation of the red run with every accessible avenue exhausted; two demonstrated
  D-1 behaviours; a corrected D-3 inventory; a classification of the preview timeouts; verified dependency
  facts for D-2; the Paystack checklist and the bounded live-test plan; local re-runs of the targeted and
  full suites; this report section.
- **Did not:** no code, test, dependency, workflow, lockfile or configuration change; no merge, deploy,
  migration, provider activation, live payment, refund, spending or production data change; no new branch;
  no history rewrite; no test weakened, skipped or relabelled; no timeout relaxed; no secret read, printed
  or committed; no `npm audit fix --force`.

---

## H.13 Execution: D-1 Package A (interim) and the complete D-3 sweep — and two items held for explicit approval

The owner's "proceed" was applied to the two presentation-only items that §H.4/§H.5 pre-approved as
implementable without changing business behaviour. The two items that change **what is stored**
(booking anchoring) or a **ratified dependency pin** were deliberately **not** touched — see §H.13.4.

| Item | State before | State now |
| --- | --- | --- |
| D-1 booking **display** | Dashboard board and the customer booking page showed a booking made at "09:00" as **12:00**; the owner's notification said **09:00** | All three use `formatBookingDateTime` (**09:00**) — the slot the customer chose. Storage, routes and validation unchanged |
| D-1 booking **anchoring** (Package B) | undeclared | **still undeclared** — needs the owner (§H.13.4) |
| D-3 ambient formatting | 23 call sites across 14 files under `app/`+`components/` (16 found by the first sweep, 7 more by the widened one) | **0** — enforced by a new test |
| D-2 dependency posture | unchanged | **unchanged** — changing `main`'s ratified `puppeteer-core` pin needs explicit approval (§H.13.4) |

### H.13.1 What changed (commit `7b01a9459c53c0be014d1c4e61c10c2297eded58`, 19 files)

- **`lib/dateFormat.ts`** — added `JATA_BOOKING_TIME_ZONE = "UTC"` and `formatBookingDateTime`, the
  booking wall clock (documented as the interim convention, with the open decision named). `manualDate`
  gained an offset parameter (default unchanged) for the deterministic fallback.
- **`lib/format.ts`** — added `formatBookingDateTime` and `formatNumber` delegates, so call sites keep
  one import home.
- **D-1 Package A (3 booking surfaces):** `components/dashboard/BookingBoard.tsx`,
  `app/b/[slug]/booking/[id]/page.tsx`, and the owner notification in `lib/experience/payments.ts`
  (`notifyNewBooking`) — the message no longer prints the server clock beside a differently-formatted board.
- **D-3 (23 sites, 14 files):** `app/admin/page.tsx`, `app/admin/customers/page.tsx`,
  `app/admin/payments/page.tsx`, `app/admin/payments/wallet/page.tsx` (5 sites),
  `app/admin/subscriptions/page.tsx`, `app/b/[slug]/shop/page.tsx`,
  `app/dashboard/pos/[businessId]/{credit,expenses,sales}/page.tsx`, `app/dashboard/subscription/page.tsx`
  (4 sites), `app/page.tsx`, `app/receipt/[token]/page.tsx` (3 sites) — dates now use the
  deterministic formatters, amounts use `formatNumber`.
- **Tests:** new `tests/unit/booking-time-display.test.ts` (6 tests); the existing
  `tests/unit/hydration-determinism.test.ts` guard was **refined, not weakened**: it still requires
  every `Intl` date formatter in `lib/dateFormat.ts` to pin a declared zone constant, and it now also
  pins the *set* of declared zones, so a third zone cannot appear unnoticed.

### H.13.2 Verification (all commands run at this commit)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **1 error** — the pre-existing offline-Prisma artifact; `main`'s baseline is also 1, so **none introduced** |
| `npm run lint` | **0 errors**, 1 pre-existing `<img>` warning |
| Targeted (booking, hydration parity/determinism, booking-hydration, payment revival) | **49 passed** |
| Full suite locally | **175 files passed \| 13 skipped; 2194 passed \| 114 skipped \| 0 failed** (+6 tests, +1 file versus the previous tip) |
| Behaviour probe (3 server zones) | `formatBookingDateTime("2026-10-14T09:00:00Z")` → `14 Oct 2026, 09:00` under UTC, Africa/Nairobi and America/Los_Angeles; `formatDateTime` (payments) still `14 Oct 2026, 12:00` |
| CI run `38461133757` at `7b01a94` | **SUCCESS** — native DB suite **2268 passed / 0 skipped** (2262 + the 6 new), §66 17, POS 22, authenticated browser/DB journey **428/0**, booking SSR+midnight hydration **25/25**, motion 124, layout 7, families 167, immersive 22, raster 29, migrations/seed/lint/types/build passed, production audit 0 |
| Guard proof | `grep -rn "toLocale" app components` → **0 hits**; the new test fails if any returns |

### H.13.3 New finding while completing the sweep (reported, not changed)

The widened sweep exposed a class **outside** `app/`+`components/`: `lib/` helpers still format **dates**
in the ambient (server = UTC) zone for user-visible output — `lib/pos/reporting.ts` (5 sites: report rows,
daily closing, credit ageing, customer last-visit), `lib/pos/receipt.ts:142` (the printed/exported receipt's
issue time), `lib/payments/wallet.ts:559` (wallet health label). Numbers in `lib/` are unaffected: every one
passes `"en-KE"` explicitly, so they are locale-pinned and zone-independent.

- **Why it was not changed here:** these are **financial documents** (printed receipts, report exports,
  CSV-style reporting) rather than UI pages, and no test pins the current convention
  (`tests/unit/pos-money.test.ts` uses `issuedAt` only as fixture data), so a change would silently alter
  what a receipt prints and what a report row says about the day a sale belongs to. That deserves the
  owner's decision, like D-1's anchoring question — not a sweep.
- **Effect if left as-is:** a POS receipt printed for a 22:30 EAT sale shows `19:30` (UTC), and a report
  row for a 00:30 EAT sale appears under the previous day.
- **Recommended fix once approved:** the same one-line-per-site substitution with the business-zone
  formatters (`formatDateTime`/`formatDate`) — receipts and reports should show the business's clock, and
  unlike bookings there is no server-clock anchoring to preserve (POS rows are stored as true instants).
- The new guard is deliberately scoped to `app/`+`components/`; extending it to `lib/` should accompany
  the decision, since `lib/format.ts`'s own helpers legitimately call `toLocaleString` on numbers.

### H.13.4 Held for explicit approval (unchanged, with the exact ask)

| # | Held item | Exactly what approval would authorise |
| --- | --- | --- |
| **D-2** | Adopt `puppeteer-core@^25.13.0` (+ lockfile) and re-ratify `main`'s `tests/unit/dependency-security-compat.test.ts` (its `puppeteer-core 23.11.1` pin and its `basic-ftp` import section), removing the `extract-zip`/`@puppeteer/browsers` chain (3 of the 10 development findings). Verified: no patched `extract-zip` exists; `@puppeteer/browsers@3.2.4` uses `modern-tar`. This **changes a ratified pin**, which is why it is not done on a general "proceed" |
| **D-1 B** | Anchoring bookings to the Nairobi wall clock in `validateBookingRequest`/`freeSlotsFor`/`openDays`/`bookingCalendar`, with an explicit rule for rows already stored (no silent rewrite) |
| **D-3b** | §H.13.3 — POS receipt/report date convention |
| **Paystack / live payment** | §H.8 checklist (owner-executed) and §H.9 plan (still **NOT AUTHORIZED**) |

### H.13.5 Register rows updated (supersedes the corresponding rows of §H.11)

| Gate | Status now | Evidence |
| --- | --- | --- |
| D-1 booking-date contract — **display** | **PASS (implemented)** | §H.13.1/§H.13.2; three surfaces agree; new tests |
| D-1 booking-date contract — **anchoring (Package B)** | **BLOCKED (decision)** | §H.13.4 |
| D-3 timezone presentation (`app/`+`components/`) | **PASS (implemented + enforced)** | 23 sites converted, 0 remaining, guard test |
| D-3b `lib/` receipt/report dates | **UNRESOLVED (decision)** | §H.13.3 |
| D-2 development advisories | **BLOCKED (decision)** — explicit pin approval required | §H.13.4 |
| Paystack configuration | **BLOCKED** | §H.8 |
| Live charge/refund, media storage, merge, deploy | **NOT AUTHORIZED** | unchanged |

**Scope discipline:** this change touched no route that writes bookings or payments, no migration, no
schema, no production configuration, no workflow file, and no dependency; `main` remains
`8db6a9e4d0963241ad36e13cd9c946b76d1ef11a`; the PR keeps its NOT APPROVED label.

### H.14 Second red run (`38463216815`) — a different step, and clearly infrastructure

The report-only commit `42d787f` triggered run `38463216815`, which **failed in `Install dependencies`**
before any test, build or browser step ran (every later step is `skipped`, and the workflow's own failure
comment recorded `(no output captured)` for all 19 log sections). Nothing about the branch was exercised;
the same lockfile installed successfully minutes earlier in run `38461133757` and again later.

Failure pattern across the branch's eight runs:

| Step that failed | Runs |
| --- | --- |
| none (green) | `38439687233`, `38443603926`, `38445602486`, `38458008965`, `38461133757` |
| `Authenticated production HTTP browser journey` (427 passed / 1 failed, later steps skipped) | `38441832430` |
| `Install dependencies` (all later steps skipped) | `38463216815` |

Both red runs are on Markdown-only commits and fail in **different** steps, neither of which can be
attributed to a code difference (`git diff` between each red run and its neighbouring green run is the
report file alone). Both are therefore recorded as **intermittent CI-environment failures** — an
observation about this workflow's runner/registry stability, and explicitly **not** a claim that the
earlier browser-step failure is understood: its failing check still has no name (§H.3), and the smallest
owner action there is unchanged. `gh run rerun` / `rerun-failed-jobs` return **403** (the integration token
has no `actions:write`), so recovery from here means pushing a commit — which is what this section's
commit does; its run id and conclusion appear in the PR's comment thread.

## I. Directive 5 execution — owner decision on booking time (D-1 Package B, proposal only), the financial timezone policy split (D-3b), and the dependency decision (D-2)
**Date: 2026-10-14.** Branch `arena/fac28f53-jata-aftercall`, parent `d50ea2331c54710f2c961cc708e3cfdd43df7d42`.
Nothing in this section merges PR #45, deploys, changes production configuration or data, activates a
provider or storage, or performs a live charge or refund. §A–§H are unchanged and remain in force; where a
row of §H.11/§H.13.5 is superseded, the new value is stated here and the old row is left in place.

### I.1 D-1 Package B — what a booking time means (PROPOSAL ONLY; no storage or semantic change)

**Status: BLOCKED — OWNER DECISION REQUIRED.** No booking record, API contract or stored value was
touched. The display half (Package A) shipped earlier in `7b01a94`; this is the storage/contract half.

**What the code does today (verified by inspection).** `Booking.startAt`/`endAt` are `DateTime` in
PostgreSQL and are written from `new Date(\`${date}T00:00:00\`)`-style construction plus minute offsets
(`lib/experience/booking.ts:107`, `app/api/storefront/booking/route.ts:52,143`). A string with no zone
designator is parsed as the **host's ambient local time**, so the instant a customer books depends on the
zone the server process happens to run in (UTC on Vercel today, but nothing declares that). The wall-clock
intent ("10:00 on the 20th") is therefore stored only implicitly, and existing rows carry no record of
which zone produced them.

**The exact decision required.** Which of the following is the product contract for a booking time?

| Option | Meaning | Stored value | Note |
| --- | --- | --- | --- |
| **B1 (recommended)** | The business booking clock is **Africa/Nairobi** wall time, always | Convert the chosen wall time to an unambiguous UTC instant and store the instant | Kenya has a fixed +03:00 offset with no DST, so no ambiguous or nonexistent local times exist — no rejection rules are needed |
| **B2** | Bookings are UTC wall time | Store as today | Customers in Nairobi read 10:00 as 13:00; dashboards/notifications stay consistent because nothing shifts |
| **B3** | Per-business timezone column | Instant + a `timeZone` column on `Business` | Needed only if customers outside EAT are intended; larger migration (new column, backfill, UI, per-business conversion) |

**Ambiguous / nonexistent local times.** Under B1 this is a non-issue: `Africa/Nairobi` has been +03:00
year-round since 1940 (no DST), so every wall time maps to exactly one instant and vice versa. Under B3 the
chosen `timeZone` may have DST, and the contract must then state which rule applies (earlier/later offset for
ambiguous times; shift-to-next-valid for nonexistent ones). This can be decided later without re-deciding B1.

**Legacy rows — the proposed rule (do not silently rewrite).** Existing rows are **not** migrated. Proposal:
add a nullable `bookingTimeZone` marker (or equivalent documented constant) meaning "all bookings created
from date X onward are anchored per the decision above"; rows without it continue to be read exactly as they
are stored today. Interpretation of legacy rows: because production runs UTC and the offset is a constant
+03:00, an existing `10:00Z` row represents `13:00` Nairobi wall time — a fact to be **disclosed** to the
owner, not rewritten. If the owner prefers legacy rows to be re-anchored, that is a separate, explicitly
authorized data migration with a dry-run count and a rollback statement; it must never be silent.

**Safest migration strategy (if B1 is approved).** (1) Introduce one shared helper that converts
`(business-local date, time) → UTC instant` and its inverse, in a single module, with the zone as an explicit
constant; (2) switch write sites (`lib/experience/booking.ts`, `app/api/storefront/booking/route.ts`) and
read sites (booking dashboard, `app/b/[slug]/book/page.tsx:68`, notifications, rescheduling, cancellations,
reports) to the helper in the same change so no surface is half-converted; (3) add the marking rule for new
rows; (4) leave historical rows untouched and disclose them. No slot-generation logic,
availability windows, deposits or pricing semantics change — only the instant a wall time resolves to.

**Affected files.** `lib/experience/booking.ts` (107, 167), `lib/experience/bookingCalendar.ts`,
`app/api/storefront/booking/route.ts` (52, 143), `app/b/[slug]/book/page.tsx` (68), the booking dashboard
surface, and the notification/reschedule/cancel paths that read `startAt`.

**Regression tests to add with the implementation (not before the decision).** Wall time → instant → wall
time round-trip across the EAT midnight boundary; a server process forced to `UTC`, `Africa/Nairobi`,
`America/Los_Angeles` and `Pacific/Kiritimati` producing identical stored instants; `freeSlotsFor` and
`validateBookingRequest` unchanged for a given wall time; a legacy row read back verbatim; dashboard,
customer page and notification labels agreeing with each other.

### I.2 D-3b — financial-document timezone policy, split by field class

**Classification first, then action.** Every candidate site was classified as (a) event instant,
(b) business-local calendar date, (c) settlement/reconciliation date, or (d) canonical DB value. Class (d)
and all money, transaction-ID, provider-reference, payment-verification, settlement and reconciliation logic
were left untouched; the changed sites are all **(a)/(b) presentation labels only**.

**Implemented (presentation-only; commit in this section).**

| File | Site | Before | After |
| --- | --- | --- | --- |
| `lib/pos/receipt.ts` | 142, printed receipt issue time | `toLocaleString("en-KE", …)` — ambient zone | `formatDateTime` from `lib/dateFormat` — pinned zone |
| `lib/pos/reporting.ts` | 193, 215, 487 report row timestamps | `toLocaleString("en-KE")` — ambient | `formatDateTime` from `lib/format` — pinned zone |
| `lib/pos/reporting.ts` | 275 credit ageing date, 401 last-visit date | `toLocaleDateString("en-KE")` — ambient | `formatDate` from `lib/format` — pinned zone |
| `lib/payments/wallet.ts` | 559 "Last payment" label | `toLocaleString("en-KE")` — ambient | `formatDateTime` from `lib/format` — pinned zone |

The receipt keeps `lib/dateFormat`'s comma form ("14 Oct 2026, 22:30"); UI rows and tiles keep
`lib/format`'s middot form ("14 Oct 2026 · 22:30"). The two shapes were **not** unified — that is a
deliberate presentation choice, not a defect. No test parses a label back into a value (verified), so no
logic depended on the old strings. The ambient-zone hazard was real: the same stored instant printed a
different time depending on the server's zone.

**STOPPED — D-3b-2, accounting grouping (OWNER DECISION REQUIRED).** `lib/pos/reports.ts` derives report
period boundaries and daily buckets from the **ambient server day**: `dayRange` (51), `weekRange` (57),
`monthRange` (64), `dailySeries` (295). Under UTC these run `00:00:00Z`–`23:59:59.999Z`, so a sale at
**00:30 EAT on the 14th** (`2026-10-13T21:30:00Z`) falls in the **13th's** bucket. Making this Nairobi-local
would move sales between accounting days and between report periods — an accounting-semantics change
explicitly outside the presentation-only authority. Nothing in these functions was changed; the current
grouping is documented and pinned by the new test so the behaviour is explicit.

Exact decision required: **keep the ambient/UTC boundaries** (labels still read Nairobi, buckets stay UTC)
or **move calendar-day grouping and period boundaries to Africa/Nairobi** (a deliberate accounting change,
with the affected reports listed and an owner-visible cutover date).

**Evidence that transaction accounting is unchanged (suite run in this section):** POS money, POS engine,
POS schema, refund integrity, wallet-refund-stock, STK receipt (PostgreSQL), tenant isolation and booking
display suites — **149 passed / 2 skipped**; the new timezone suite — **8 passed**; full local suite —
**2203 passed / 114 skipped / 0 failed**.

### I.3 New test: `tests/unit/pos-financial-timezone.test.ts` (8 tests)

Pins the policy rather than describing it: `2026-10-14T19:30:00Z` must read **22:30 EAT** and
`2026-10-13T21:30:00Z` must read **00:30 EAT on the 14th**; both must render **byte-identically** when the
test process is forced to `UTC`, `Africa/Nairobi`, `America/Los_Angeles` and `Pacific/Kiritimati`
(`vi.resetModules` + dynamic import per zone); the UTC date differing from the Nairobi date must not change
the label; KES amounts, receipt numbers and provider references must pass through untouched; and the
current UTC-day grouping of `dayRange`/`summarizeSales`/`dailySeries` is asserted **as it is** so a future
grouping change cannot happen unnoticed.

### I.4 D-2 — puppeteer-core upgrade under the authorized scope (implemented on the task branch)

| Measure | Before | After |
| --- | --- | --- |
| `puppeteer-core` declaration | `^23.11.1` | `^25.13.0` |
| `basic-ftp` override | pinned `6.2.3` | removed (its consumer no longer exists) |
| `npm audit` high | **10** (all dev-only) | **7** (all dev-only) |
| `npm audit` production | 0 | 0 |
| Advisory chain (`extract-zip` 2.0.1 via `@puppeteer/browsers` 2.6.1, plus `basic-ftp`/`get-uri`/`pac-proxy-agent`/`proxy-agent`) | present | **absent** |
| Lockfile effect | — | 14 packages added, 55 removed, 10 changed |

**Why v25 and not a patched 23.x:** `extract-zip`'s latest release is still **2.0.1 (2023-03-04)** — no fixed
version exists on the 23.x line, so the advisory cannot be resolved by a patch bump; v25 is the only line
that drops the chain. **Node requirement:** v25 declares `engines >= 22.12.0`, so the e2e workflow's runner
moved `20 → 22` in the same change (the app's own `engines` field is untouched, and Node 22 is already inside
`^20.19.0 || >=22.12.0`). **API compatibility:** all consumed Puppeteer APIs are standard in v25; the scripts
pass an explicit `executablePath`, and `puppeteer.launch()` without one reports the expected
"`executablePath` or `channel` must be specified" — i.e. the module loads and reaches Chrome discovery. All
ten `scripts/browser/*.mjs` files pass `node --check`, and `tsc --noEmit` (which type-checks the browser
script against v25 types) reports **1 error — the same pre-existing `Prisma.BusinessUncheckedCreateInput`**
error present on `main`, no new ones.

**Compatibility test re-ratified (not weakened).** `tests/unit/dependency-security-compat.test.ts`:
the `basic-ftp` assertions were replaced, with a documented before/after header, by assertions that the whole
advisory chain is **absent** from the tree and that the replacement path is installed and loadable at the
declared major; the original security purpose (no unpatched advisory chain, dependencies loadable at the
declared contract) is preserved. **6 tests, 14 assertions passing.** The removed lines are exactly the
basic-ftp import assertions whose module no longer exists — nothing else was deleted, and no test was
skipped, weakened or reclassified. `npm audit fix --force` was not run, and no unrelated major was touched.

**Remaining decision.** The residual **7 high** are all **dev-only** (`braces` 3.0.3, `chokidar`,
`fast-glob`, `micromatch`, `tailwindcss` 3.4.19, `@next/eslint-plugin-next`/`eslint-config-next`) and all
have no patched release on their current line; clearing them requires a Tailwind 4 major or a downgrade of
the Next lint stack. Recommendation: **accept and document** the residual dev-only set, revisit with the
separately-staged Tailwind major. Owner decision required.

### I.5 The 114 skipped tests — what they are

Every one of the **114** is a suite gated by a declared environment flag, all in the same family, and none
is a failure or a silenced test:

| Skipped count | Files | Gate |
| --- | --- | --- |
| 22, 17 | `tests/e2e/business-pos-journey.test.ts`, `tests/e2e/interactive-business-journey.test.ts` | `skipIf(!enabled)` — `enabled = Boolean(process.env.DATABASE_URL?.trim())` |
| 15, 12, 8, 6, 6, 6, 5, 5 | `tests/prisma/*.test.ts` (storefront-checkout, payment-settlement, experience-boundary, checkout-commit, experience-art-direction, schema-constraints, professional-enquiries, subscription-payment) | `skipIf(!realPrismaConfigured)` — `realPrismaConfigured = Boolean(PRISMA_TEST_DATABASE_URL)` |
| 5, 4, 2, 1 | `tests/integration/*-postgres.test.ts` (AI front-desk entitlement, wallet refunds, wallet STK receipt, POS refund race) | `skipIf(!postgresEnabled)` — `Boolean(process.env.DATABASE_URL?.trim())` |

The local sandbox has no PostgreSQL, no `psql` and no Docker, so these suites cannot run here — they are
the **real-database** suites, and skipping is the honest outcome rather than a pass. In CI, where a database
is provisioned, the database workflow reports **2268 passed / 0 skipped** — i.e. the same suites run and
pass there, which is why the CI database run, not the local skip count, is the release-confidence evidence.
The **2,268** (CI, database provisioned) and the **114** (local, no database) are therefore **not**
contradictory and not an overlap: they describe the same suites under two environments. No test was removed
or weakened to reduce any count.

### I.6 CI anomalies (unchanged, UNRESOLVED)

Run `38441832430`: failure inside `Authenticated production HTTP browser journey` (427 passed / 1 failed).
The failing check still has **no name** — logs, artifacts and annotations remain inaccessible from here and
`gh run rerun` returns **403**. **UNRESOLVED; it is explicitly not recorded as a flake**, and the smallest
owner action (reading the failing step in the Actions UI) is unchanged. Run `38463216815` failed in
`Install dependencies` before any test on a Markdown-only commit — intermittent CI-environment behaviour
(§H.14), and it explains neither the browser-step failure nor any code. Green runs stand as listed in §H.14.

### I.7 Verification (commands and outcomes at this change set)

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/pos-financial-timezone.test.ts` | **8 passed** |
| Related regression (POS money/engine/schema, refund integrity, wallet-refund-stock, STK receipt pg, tenant isolation, booking display) | **149 passed / 2 skipped** |
| `npx vitest run tests/unit/dependency-security-compat.test.ts` | **14 passed** (6 tests) |
| Full local suite `npx vitest run` | **2203 passed / 114 skipped / 0 failed** (176 files; delta vs `d50ea23` is exactly the 8 new + 1 new compat assertion) |
| `npm run lint` | **0 errors**, 1 pre-existing `<img>` warning |
| `npx tsc --noEmit` | **1 error — the pre-existing `Prisma.BusinessUncheckedCreateInput` error that also exists on `main`**; no new errors |
| `npm run build` | **Build completed successfully** |
| `npm audit` | **7 high (dev-only) / 0 production** — before: 10 high (dev-only) / 0 production |
| Diff review | 7 modified files + 1 new test file; **no secret or DSN appears in the diff**; no new `skip`/`only`; the only deleted test lines are the documented `basic-ftp` assertions |

### I.8 What this section did and did not do

**Did:** implemented D-3b presentation labels; upgraded `puppeteer-core` and its lockfile under the
authorized scope; re-ratified the compatibility test; added and ran the timezone test suite; verified at
full-suite, lint, type-check and production-build level; recorded the skip explanation and the CI anomalies.

**Did not:** change stored booking semantics, any existing booking record, report grouping/period
boundaries, settlement or reconciliation logic, provider timestamps, transaction IDs or payment
verification; merge PR #45; deploy; change production configuration or data; activate media storage;
incur provider cost; or perform a live charge or refund.

### I.9 CI evidence for this change set (run `38470293452`, head `62b750b`) — RED, same pre-existing signature

The run is **not green**, and the failure is not in any gate this change set touches:

| Step | Outcome in `38470293452` |
| --- | --- |
| Install dependencies · Prisma generate · Lint and TypeScript · Apply migrations · Seed plans | passed (Node 22) |
| Full native DB suite (`npx vitest run --exclude tests/e2e`) | **187 files passed, 0 skipped** |
| §66 experience journey / Business POS journey | **17/17** · **22/22** |
| Production build · Production HTTP smoke · Bundle evidence | passed (bundle within baseline deltas) |
| **Authenticated production HTTP browser journey** | **`427 passed, 1 failed, 0 skipped.` — then `NOT RUN: remaining required provider-free scenarios after first failure`** |
| Booking SSR/hydration · Hydration #418 race · Motion/immersive/layout/family/media browser | not run (skipped after the failure) |

**This is the same signature as the earlier unresolved red run** (`38441832430`, whose checkout predates
this change set and still carried `puppeteer-core@23`): the same step, the same `427 passed, 1 failed,
0 skipped` line, the same `NOT RUN` tail. The step also passed **six** times in this branch's history, so
this remains intermittent in the same way §H.3/§H.14 describe.

**What the visible part of this run's log adds — and what it still cannot say.** The log window (the PR
comment carries the first and last ~5.5 k characters; the middle ~46.5 k is truncated) shows a real
`BROWSER RUNTIME ERROR … Minified React error #418 …` raised on the authenticated retail preview
(`/dashboard/businesses/cmv76yzwj000369hup2m83zid/preview` with the `/b/qa-retail-17e622e4` iframe),
immediately followed by the script's `M418 LIVE / TAIL / FRAME / OUTLINE / PARSE` diagnostic bundle, and
near the tail the same `prisma.aIQualityEvent.create()` unique-constraint error block the earlier red run
also carried. **The name of the one failing check sits inside the truncated middle**, so it still cannot be
stated. Log download, artifact download (`hydration-raw-order-evidence`, 19 KB, unexpired) and the
step-level jobs API all remain inaccessible from here (text/zip `EOF` from storage; `gh run rerun` 403),
and the two check-run annotation sets are empty. **Status: UNRESOLVED — explicitly not a flake**, and the
smallest owner action is unchanged: read the failing check in the Actions UI.

**Why this change set is not on that render path (evidence, not proof).** The three changed modules
(`lib/pos/receipt.ts`, `lib/pos/reporting.ts`, `lib/payments/wallet.ts`) are imported only by POS/payments
routes and components; the failing route's page imports `lib/experience/workspace`,
`components/dashboard/StudioTabs`, `components/dashboard/PreviewClient` and
`components/dashboard/EntitlementBanner` — none of which reach the changed modules — and the hydration
guard test that pins every date formatter to a declared zone passes locally. React #418 is the hydration
mismatch class this project has tracked since §H, and its own workflow comment states the inherited expected
failure is **preserved, not fixed**.

**No attempt was made to make this step green** by relaxing, skipping, retrying-around or reclassifying
anything. The remediation paths are unchanged: owner reads the failing check, or the underlying #418
mismatch is fixed under its own authorization.

### I.10 Follow-up run for the §I.9 report commit — GREEN, and the intermittency statistic

Run **`38472070001`** (head `fd8080286a2468e079ae6461ce9452fbaa413fff`, the §I.9 report commit; the code
tree is byte-identical to `62b750b`) is **SUCCESS**:

| Evidence | Value at `fd80802` |
| --- | --- |
| Full native DB suite | **187 files passed · 2277 tests passed · 0 skipped** (`2277 = 2268 + 9`: this change set's 8 new timezone tests plus the 1 new compatibility assertion — the new tests run and pass in CI, and **no skip was added**) |
| §66 experience journey / Business POS journey | 17/17 · 22/22 |
| Authenticated production HTTP/browser/native-DB journey | **`428 passed, 0 failed, 0 skipped`** |
| Production HTTP isolation smoke | 9 passed, 0 failed, 0 skipped |
| Dependency audit | production **0 findings**; full audit **7 findings, all high, all dev-only** (the residual set of §I.4) |
| Booking SSR/hydration, #418 race, Motion/immersive/layout/family/media browser steps | ran (workflow reached the success path) |

Branch run history for this workflow is now **7 green / 3 red**. The three reds are: `38441832430` (head
`d5bd1eb`, puppeteer-core **23**, i.e. **before** this dependency change), `38463216815` (`Install
dependencies`, infrastructure, §H.14) and `38470293452` (§I.9). Both browser-step reds carry the identical
`427 passed, 1 failed, 0 skipped` summary and the same `NOT RUN` tail; the failing check's name is still
inside the truncated middle of the log in both, and both predate or straddle the dependency change. **The
failure is therefore intermittent in observation but remains UNRESOLVED as to cause — not a flake, and not
attributed to this change set.** The workflow's own PR comment is the evidence channel for any later run on
this branch; §I is not extended per push.

## J. Directive 6 execution — booking-time contract implemented, dependency remediation evidenced, Paystack verification classified, live exercise scoped
**Date: 2026-10-14.** Branch `arena/fac28f53-jata-aftercall`, parent `0f402acb87ddbe4a1b62ed36138d00be1b24991e`. §A–§I are unchanged and remain in force. Nothing here merges PR #45, deploys, changes production configuration or data, activates a provider or storage, or performs a live charge or refund.

### J.1 D-1 Package B — the `Africa/Nairobi` booking-time contract (IMPLEMENTED)

**Decision executed (owner, 2026-10-14):** a new business booking's date + time are Nairobi wall-clock values, converted to an unambiguous UTC instant before storage; **existing rows are not reinterpreted or rewritten**.

**What the contract is now.** One module, `lib/experience/bookingTime.ts`, owns the conversion:

| Input | Result |
| --- | --- |
| `2026-10-14` + `09:00` (Nairobi) | `2026-10-14T06:00:00.000Z` |
| `2026-10-14` + `00:30` | `2026-10-13T21:30:00.000Z` (the instant is on the previous UTC day) |
| `2026-10-14` + `23:30`, 60 min duration | ends `2026-10-14T21:30:00.000Z` = **15 Oct 00:30** on the business clock |

The stored column keeps holding an instant, so every existing query, index, ordering and comparison keeps its meaning. `new Date(\`${date}T${time}\`)` — which anchored to whatever zone the host ran in — is gone from the write path; the anchor is a named zone resolved through `Intl`, never the ambient one. Nairobi has been UTC+3 all year since 1940, so no wall time is ambiguous or nonexistent; the helper still validates the round trip, so a future per-business zone cannot silently accept a time a DST transition deleted.

**Files changed**

| File | Change |
| --- | --- |
| `lib/experience/bookingTime.ts` **(new)** | wall-clock ⇄ instant conversion, calendar-day arithmetic, business-day window, legacy marker resolution |
| `lib/experience/booking.ts` | `validateBookingRequest`, `freeSlotsFor`, `openDays` anchor to the contract; re-exports the contract helpers |
| `lib/experience/bookingCalendar.ts` | the customer picker offers **business** days (it built UTC days before: at 22:30 Nairobi it offered "today" as a day that had already ended) |
| `app/api/storefront/booking/route.ts` | availability and overlap windows use the business day; `bookingTimeZone: contractBookingMarker()` on create |
| `lib/dateFormat.ts` | `JATA_BOOKING_TIME_ZONE` = `Africa/Nairobi`; new `LEGACY_BOOKING_TIME_ZONE` = `UTC`; `formatBookingDateTime(value, fallback, timeZone)` |
| `lib/format.ts` | `formatBookingDateTime(value, timeZone?)` passthrough |
| `app/api/bookings/route.ts`, `app/dashboard/businesses/[id]/bookings/page.tsx`, `components/dashboard/BookingBoard.tsx`, `app/b/[slug]/booking/[id]/page.tsx` | each row renders on its own clock |
| `prisma/schema.prisma` + `prisma/migrations/20261014000000_booking_time_zone_marker/` | one nullable marker column |

**Legacy treatment (no silent rewrite).** `Booking.bookingTimeZone` is `NULL` for every row written before the contract and holds `"Africa/Nairobi"` for rows written after it. `bookingRowTimeZone()` trusts **only** that marker; anything else (NULL, empty, a future version's value, junk) reads on the legacy `UTC` clock. So a pre-contract row keeps its stored instant *and* keeps printing the time it was entered with, while a new row prints the time the customer chose:

| Stored instant | Marker | Board / customer page / notification |
| --- | --- | --- |
| `2026-10-14T09:00:00Z` | `NULL` (legacy) | `14 Oct 2026, 09:00` |
| `2026-10-14T06:00:00Z` | `Africa/Nairobi` | `14 Oct 2026, 09:00` |

No backfill runs, no `UPDATE` exists in the migration, and no historical instant is rewritten. **Rescheduling:** there is no "move booking" endpoint — a reschedule is cancel + rebook, both of which now go through the contract, and the board/customer/notification display path is shared, so the three surfaces cannot disagree.

**Migration safety.** `ALTER TABLE "Booking" ADD COLUMN "bookingTimeZone" TEXT;` — additive, nullable, no default, no table rewrite, no data change, no `NOT NULL`. The previous application version never selects or writes the column, so it keeps working before and after the deploy (expand-only; there is no contract step). Deployment order: **apply the migration first, then deploy the app** (the app writes the marker). Rollback needs no DDL: redeploy the previous version, which ignores the column; dropping it later would discard only the marker, never a `startAt`/`endAt`. **It has not been applied to any database by this change set** — it is staged for review, and production migration remains a separately authorized step. The only database that runs it is CI's disposable test database (`prisma migrate deploy` in the workflow), and the guard test `tests/unit/repair-guards.test.ts` now admits it in the authorized-migration allowlist with the additivity invariants (no `DROP`, no `UPDATE`, no `ALTER COLUMN`) still enforced.

**Tests.** New `tests/unit/booking-time-contract.test.ts` — **22 tests**, one describe block per required category: (1) creation at representative Nairobi times incl. `00:00`, `00:30`, `23:00`; (2) a booking crossing midnight; (3) start/end validation and duration floor; (4) availability, overlap, capacity, past-slot and closed-day rules; (5) rescheduling + board/customer/notification label agreement; (6) explicit time-zone behaviour with the host forced to **UTC, Africa/Nairobi, America/Los_Angeles and Pacific/Kiritimati**; (7) legacy records unchanged (marker mapping, migration shape, no legacy clock on new rows); (8) concurrency protection and tenant isolation, with the DB-gated suites named as the real PostgreSQL evidence. Updated coherently (each previously pinned the *old* anchor): `booking-time-display.test.ts` (now pins both clocks), `hydration-determinism.test.ts` (three declared zones, same "no ambient zone" invariant), `experience-operations.test.ts`, `booking-hydration.test.ts` (leap-day/year boundary on the business clock), `integration/storefront-booking.test.ts` (stored fixtures built on the contract clock), `repair-guards.test.ts` (authorized migration).

### J.2 D-2 — the seven remaining development-only findings, per finding

Reproduced at this HEAD: **7 high, 0 moderate, 0 critical; production `--omit=dev` audit = 0**. All seven are dev-only and reachable through exactly four paths:

```
eslint-config-next@15.5.27 → @next/eslint-plugin-next@15.5.27 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3
tailwindcss@3.4.19 → fast-glob@3.3.3 → micromatch@4.0.8 → braces@3.0.3
tailwindcss@3.4.19 → micromatch@4.0.8 → braces@3.0.3
tailwindcss@3.4.19 → chokidar@3.6.0 → braces@3.0.3
```

| Package | Status | Evidence |
| --- | --- | --- |
| `braces` | **NO SUPPORTED FIX EXISTS** | GHSA-vfj7-8cjw-p6xm (HIGH, published 2026-09-18): vulnerable `<= 3.0.3`, **first patched version: NONE PUBLISHED**; 3.0.3 is the highest published version. Verified against GitHub's advisory API, not just npm's report |
| `micromatch` | **NO SUPPORTED FIX EXISTS** | latest 4.0.8 requires `braces@^3.0.3` → the vulnerable version. No release avoids braces |
| `fast-glob` | **NO SUPPORTED FIX EXISTS** | 3.x is the only line (no 4.x); latest 3.3.3 requires micromatch. The lint plugin pins `fast-glob@3.3.1` exactly |
| `@next/eslint-plugin-next` | **NO SUPPORTED FIX EXISTS** | our 15.5.27 is the highest 15.5.x; **even Next 16.4.0 (latest) still depends on `fast-glob@3.3.1`** → micromatch → braces |
| `eslint-config-next` | **NO SUPPORTED FIX EXISTS** | highest 15.5.x = 15.5.27 (installed). npm's only suggested "fix" is a **downgrade** to 14.2.35, a Next-14 lint stack mismatched with Next 15.5.27; dropping the package would weaken lint, which is prohibited |
| `tailwindcss` | **REMEDIABLE ONLY VIA A MAJOR** (staged, awaiting approval) | highest 3.x = 3.4.19 (no patch exists); `tailwindcss@4.3.3` has **zero dependencies**, which removes this finding and `chokidar` |
| `chokidar` | **REMEDIABLE ONLY VIA THE SAME MAJOR** | tailwind 3 requires `chokidar@^3.6.0` (braces); chokidar 4 dropped braces but is outside that range — a cross-major override would be unsupported *and* would break tailwind's watcher |

**Conclusion, stated plainly: full 7/7 remediation is not achievable today by any supported change.** Five findings have no fix in any published version of the packages involved. Two more would be cleared only by adopting Tailwind 4 — a major that does not clear the other five, because they hang off Next's own ESLint plugin. No `npm audit fix --force` was run, no package was removed to make a finding disappear from a report, no advisory was suppressed or reclassified, and the compatibility test is unchanged in this directive.

**Staged Tailwind 4 plan (measured, not guessed) — needs owner approval to execute.**
Blast radius in this repository: one stylesheet (`app/globals.css`, 2170 lines) with the three `@tailwind` directives and **zero `@apply`**; theme customisation is a single font stack in `tailwind.config.ts`; no Tailwind plugins; four files use a utility renamed in v4 (`shadow-sm` ×3, `outline-none` ×1, `ring-1` ×2, bare `rounded` ×47 to re-check). Required steps: `tailwindcss@^4` + `@tailwindcss/postcss`, replace the directives with `@import "tailwindcss"`, move `content` globs to `@source` and the font family to `@theme`, drop `autoprefixer` (v4 handles it), rename the utilities above, then verify. **The verification I cannot produce here is the blocker**: the directive asks for baseline screenshots or equivalent UI checks across dashboard, Website Studio, AI Front Desk, POS, checkout and generated business pages, and this environment has no browser (the browser gates run only in CI). Executing it half-verified would be exactly the "claim remediation without verification" this report must not do. It also clears only 2 of 7 findings.

**Compensating control while the residual stands (facts, not a dismissal).** Both chains are `devDependencies`: they are absent from the deployed bundle, and the production audit is 0. The `braces` advisory is a stack-exhaustion DoS triggered by deeply nested *glob patterns*; in this repository those patterns come from source-controlled configuration (`tailwind.config.ts` content globs, the ESLint ignore list) — no customer or provider input reaches those globbers. That reduces likelihood; it does not change the severity classification, and this is recorded as an accepted-for-now risk, not a fix.

### J.3 Paystack production-configuration verification — status, without secrets

**Access reality:** Arena offers no Vercel or Paystack connector (both report `unsupported`), so dashboard-side verification from here is impossible and **no secret was requested, entered, printed or committed**. Items that can be verified from the code are verified below; dashboard-only items are **BLOCKED** with the exact owner navigation.

| Checklist item | Status | Non-sensitive evidence |
| --- | --- | --- |
| Test/live credential separation | **VERIFIED (code)** | `lib/payments/config.ts:90-106` derives `mode: "TEST" \| "LIVE" \| "NONE"` from the key prefix (`sk_live_` ⇒ LIVE); `:145-155` refuses test mode when the deployment switches it off and reports "no live connector configured" explicitly |
| Server-only secret storage | **VERIFIED (code)** | `PAYSTACK_SECRET_KEY` is read only in server modules; **zero** `NEXT_PUBLIC_PAYSTACK*`/`NEXT_PUBLIC_*SECRET` references; no `"use client"` file references the secret |
| Transaction initialization + server-side verification | **VERIFIED (code + tests)** | `lib/paystack.ts` `initializeTransaction`/`verifyTransaction`; `lib/experience/payments.ts:342` verifies the provider transaction before settling; `lib/payments/providers/paystack.ts:103` calls `/transaction/verify/:ref` |
| Webhook endpoint, signature validation, idempotency | **VERIFIED (code + tests)** | `app/api/payments/webhooks/paystack/route.ts` verifies `x-paystack-signature` (HMAC-SHA512 over the raw body) with `crypto.timingSafeEqual` before the payload is believed, and caps the body at 128 KB |
| Duplicate events / repeated callbacks | **VERIFIED (code + tests)** | `lib/payments/webhooks.ts` dedupes on `providerEventId` (unique lookup ⇒ `already_processed` with HTTP 200, and a `DUPLICATE` status when the engine reports one) |
| Subscription and POS payment-state transitions | **VERIFIED (tests)** | `lib/payments/states.ts` + engine; covered by the payments/POS/entitlement suites (198 passed in this run) |
| Failure, cancellation, timeout, retry | **VERIFIED (code)** | 15 s/20 s `AbortSignal.timeout` on provider calls; explicit `retryable` flags; a refund with an unknown outcome is flagged `outcomeUnknown` rather than retried blind |
| Logging, redaction, secret exposure prevention | **VERIFIED (code)** | zero `console.*` calls in `lib/payments/config.ts`, `lib/paystack.ts`, `lib/payments/providers/paystack.ts`; destinations/phones are masked before storage (`lib/payments/money.ts` `maskDestination`/`maskPhone`) |
| Reconciliation, receipts, rollback/incident response | **VERIFIED (code) / BLOCKED (procedure)** | `lib/payments/reconciliation.ts` records matched and exception outcomes and the engine surfaces them; receipts use tokenised links. The operational rollback/incident *runbook* is a dashboard/ops artefact, not in the repository → BLOCKED |
| Correct Vercel project + production environment | **BLOCKED — OWNER ACTION** | Requires dashboard access |

**Owner navigation for the BLOCKED rows (no value may be pasted into Arena, GitHub, this report or the chat).** Vercel → the JATA project → **Settings → Environment Variables → Production**: confirm `PAYSTACK_SECRET_KEY` exists and its **prefix** is the intended one (`sk_test_` vs `sk_live_`) — note only *which* prefix, never the value; confirm no Paystack secret is scoped to Preview/Development unless intended; confirm `PAYSTACK_PUBLIC_KEY` is the matching mode. Paystack dashboard → **Settings → API Keys & Webhooks**: confirm the webhook URL points at the JATA production endpoint, that the webhook signing secret matches the deployed one, and that live mode is enabled only if live payments are intended. Record only VERIFIED/FAILED per item.

### J.4 Live charge/refund exercise — scope proposed, **NOT executed**

**Status: NOT EXECUTED — awaiting the exact scope confirmation below.** No live key was used, no provider call was made, no charge or refund exists, and the production-configuration items in §J.3 must be VERIFIED first. The owner's approval is in principle; the transaction itself is only authorized once the exact details are confirmed, and the smallest amount the provider supports will be used.

**The exact details required before execution (owner to supply or approve each):**

1. **Authorized merchant/account** — the production Paystack account (mode LIVE) the charge is to be made on.
2. **Consenting participant + payment method** — who pays, and by which method (card / M-PESA STK / etc.).
3. **Test amount + fees** — the explicit amount in KES and the acknowledgement that provider fees apply and are not refunded.
4. **Charge operation + unique reference** — the exact endpoint/path used (subscription checkout or POS sale) and the reference JATA will emit, so a duplicate can be recognised.
5. **Refund operation + permitted amount** — full or partial, and the maximum permitted.
6. **Duplicate prevention** — the idempotency guarantee already in code (durable idempotency record + `providerEventId` dedupe) plus the rule that a possibly-successful charge is **never** retried before its reference and status are checked.
7. **Observation plan** — how payment verification, the webhook, the receipt, the owner notification and the reconciliation record will be observed (screens/records, no secrets).
8. **Refund verification** — how the provider's refund status is matched back to the JATA transaction record.
9. **Stopping conditions + evidence retention** — stop if amount, account, payment status or refund status differs from this plan; retain the reference list and status evidence.

**Lifecycle to be executed once confirmed (single cycle):** initialized → provider confirms → JATA verifies server-side → correct subscription/POS state recorded → notification + receipt → reconciles → refund initiated within the approved scope → provider refund status and JATA record verified → evidence and discrepancies documented. **Authorization to run this exercise is not authorization to merge or deploy.**

### J.5 D-3b-2 — accounting calendar boundaries (decision note; unchanged)

`lib/pos/reports.ts` `dayRange`/`weekRange`/`monthRange`/`dailySeries` are untouched, as directed.

- **Option A — keep the UTC-based boundaries and grouping (status quo).** Daily totals, weekly/monthly reports, ageing buckets and every historical re-run stay exactly as they are today; a report re-run for a past range returns the same numbers it returned before. The cost is that a Nairobi business day is `03:00–03:00` local, so a sale at 00:30 EAT belongs to the previous bucket — which is what the owner sees today, and what the new timezone test pins so the behaviour is explicit rather than accidental.
- **Option B — define business reporting periods and daily buckets in `Africa/Nairobi`.** Periods and buckets match the business's wall clock and agree with the printing/label policy from §I.2; but **every historical report changes when it is re-run** (the same closed range produces different totals), ageing day-counts shift near midnight, and comparisons against provider settlement/statement dates need a policy of their own.

**Impact summary:** daily totals and historical reports — A: unchanged; B: restated. Ageing views — A: unchanged; B: up to one day different per entry near the boundary. Reconciliation — neither option changes the stored instant, the provider reference or the matching logic; only which *bucket* a matched payment is reported under moves.

**Recommendation (safer): Option A for this release**, because it changes no number anyone has already seen, while the label policy from §I.2 already gives staff the correct local time on every row. If the business wants Nairobi-day totals, take **Option B as a deliberate, dated policy change** with a written note that reports re-run for earlier ranges will read differently, so an auditor can distinguish a policy change from a data error. Final choice stays with the owner.

### J.6 Authenticated-browser CI failure — the failing check is identified; the root cause is not

**Identified (code + log-window evidence, this time positively).** The failing check is
**`no uncaught browser runtime errors`** — `scripts/browser/studio-authenticated.check.mjs:739`
(`check("no uncaught browser runtime errors", errors.length === 0, …)`), the last gate before the run
is marked complete. The evidence chain: the run reports `428 = 427 passed + 1 failed`, and that check is
the final one; the visible log shows a recorded `BROWSER RUNTIME ERROR … React error #418 …` on the
authenticated retail preview (`/dashboard/businesses/…/preview` with the `/b/qa-retail-…` iframe),
immediately followed by the script's `M418` diagnostic bundle; the catch path prints
`FAIL authenticated journey: <check name>`, then the last 3,500 characters of the server log (the Prisma
`aIQualityEvent.create()` block the comment's tail begins with), then the `finally` cleanup lines and the
summary — exactly the shape of the red comment. Green runs have no `BROWSER RUNTIME ERROR` line and
report `428 passed, 0 failed`. This also explains §H.3's unnamed failing check: it is the same gate, and
the earlier red run's `427 passed, 1 failed` signature matches (its truncated window simply did not
display the pageerror line, so it is recorded as *consistent with*, not *conclusively matched to*, this
mechanism).

**Mechanism:** an uncaught React `#418` hydration mismatch raised during the authenticated retail
journey. **Root cause of that mismatch: UNRESOLVED.** The frozen evidence that would name the mismatching
node (`m418-evidence.json` / `results.json` `errors[]`) is inside the run's artifact, whose download from
here fails with a storage `EOF` (retried), `gh run rerun` returns **403**, and the M418 bundle sits in the
elided middle of the comment. **Exact missing evidence: the `errors[]` entry (message + stack) and the
frozen pre-hydration snapshot for the failing load in `hydration-raw-order-evidence` for run
`38470293452`, or the middle of that run's `step-authenticated-browser.log`.** It is **not** recorded as a
flake, and no later green run is treated as proof it is fixed.

**Two changes made so the next failure names itself (diagnostics only; pass/fail, retries and coverage
are unchanged):**
1. `scripts/browser/studio-authenticated.check.mjs` now prints `FAILED CHECK: <name>` immediately before
   the end-of-run summary, which survives the comment's middle-elision.
2. `.github/workflows/interactive-business-e2e.yml`'s failure reporter now posts a
   **"Failure signatures (never elided)"** section first: every `FAIL`/`FAILED CHECK`/`BROWSER RUNTIME
   ERROR`/`M418-RECORDED` line from the captured step logs, bounded, outside the head/tail windows.

### J.7 Verification at this change set

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/booking-time-contract.test.ts` | **22 passed** (new contract suite) |
| Booking/timezone/calendar/legacy group (`booking-time-contract`, `booking-time-display`, `booking-hydration`, `hydration-determinism`, `experience-operations`) | **64 passed / 0 failed** |
| POS · payments · wallet · refund · reconciliation · dependency-security group (13 files) | **188 passed / 0 failed** |
| Tenant isolation · authorization · publication/entitlement (`tests/security`, 14 files) | **198 passed / 0 failed** |
| Integration booking suite (`tests/integration/storefront-booking.test.ts`) | **3 passed** (fixtures rebuilt on the contract clock) |
| Migration guard (`tests/unit/repair-guards.test.ts`) | passed (authorized migration admitted; additivity invariants enforced) |
| Full local suite `npx vitest run` | **2225 passed / 114 skipped / 0 failed** (+22 vs `0f402ac` = the new contract tests; the 114 environment-gated real-DB skips are unchanged and explained in §I.5) |
| `npm run lint` | **0 errors** (1 pre-existing `<img>` warning) |
| `npx tsc --noEmit` | **1 error — the pre-existing `Prisma.BusinessUncheckedCreateInput` (stale generated client offline), identical to `main`**; no new errors. Note: `prisma generate` cannot run in this environment (binaries.prisma.sh is not reachable); CI generates the client, and `lib/db.ts` types the client as `any`, so the marker write introduces no type error here |
| `npm run build` | **Build completed successfully** |
| `npm audit` | production **0**; full **7 high, all dev-only** (§J.2) |
| Diff review | 18 modified + 3 new paths; **no secret, DSN or key in the diff**; no new `skip`/`only`; the only removed test lines are the 12 assertions in the two files rewritten in §J.1, each replaced in the same file by the contract-clock equivalent; no financial/POS/payment logic touched |

### J.8 What §J did and did not do

**Did:** implemented and documented the Nairobi booking-time contract with an explicit legacy rule and an
additive migration (staged, unapplied); added 22 contract tests and updated six test files that pinned the
superseded anchor; reproduced and classified all seven development findings with a per-finding no-fix
demonstration and a measured staged plan; verified every code-level Paystack checklist item and listed the
BLOCKED dashboard items with owner navigation; wrote the live-exercise scope and stopped before it; wrote
the D-3b-2 decision note; identified the failing CI check and made the next failure self-identifying.

**Did not:** merge PR #45; deploy; run any production migration; modify any production or historical
booking record; backfill, rewrite or reinterpret a stored instant; change report periods, daily buckets,
ageing or settlement semantics; run `npm audit fix --force`; remove, weaken, skip or reclassify a test or
advisory; install a major; execute a live charge or refund; activate media storage or any provider; or
request, print or commit a secret.

### J.11 CI evidence for `4b15429` — every database gate passed; one reporter bug found and fixed

Run **`38500660586`** (head `4b15429`) is **red in exactly one place**, and it is not a gate this change
set touches. Step conclusions, in order:

| # | Step | Result |
| --- | --- | --- |
| 5 | Install dependencies | success |
| 6 | Production advisory gate and full-audit findings | success (production 0; full audit reports the 7 dev-only findings of §J.2 and stays FAIL by design) |
| 7-8 | Generate Prisma client · Lint and TypeScript | success |
| **9** | **Apply migrations** | **success — the new `20261014000000_booking_time_zone_marker` applied cleanly to the disposable test database** |
| 10-11 | Seed plans · unit/integration/security suites against the database | success |
| 12-13 | §66 experience journey · Business POS journey | success |
| 14-15 | Production build against the isolated test DB · harness isolation and bundle evidence | success |
| **16** | **Authenticated production HTTP browser journey** | **failure — the pre-existing React `#418` gate of §J.6** |
| 17-19 | Booking SSR/hydration · #418 race · Motion/immersive/layout/family/media | skipped (after the failure) |
| 22 | **Report failing output to the pull request** | **failure — this change set's own bug, fixed below** |

So the contract itself passed the real-database gates in CI: the migration deploys, and the DB-gated
booking, POS, journey and security suites are green at `4b15429`. The only red is the same authenticated
browser check the branch has failed intermittently since before this work, whose root cause remains
UNRESOLVED (§J.6).

**The reporter bug (mine, found and fixed in this change set).** Step 22 failed because the new
"Failure signatures" block referenced `const signatures` in the body mapping that runs *before* the
declaration — a temporal-dead-zone `ReferenceError`, which prevented the failure comment from posting at
all. The job's own annotation names it exactly: `failure: Unhandled error: ReferenceError: Cannot access
'signatures' before initialization`. The block was moved above the body array, and the reporter was then
**executed locally in a harness** (the workflow's script body run with stub `context`/`github` against
synthetic step logs, including the 20 000-character middle that used to hide the answer):

```
comment length: 12692
step-authenticated-browser.log: BROWSER RUNTIME ERROR {"...","message":"Minified React error #418"}
step-authenticated-browser.log: FAIL authenticated journey: no uncaught browser runtime errors
step-authenticated-browser.log: M418-RECORDED {"...","path":"/dashboard/businesses/x/preview"}
step-authenticated-browser.log: FAILED CHECK: no uncaught browser runtime errors
```

That is the outcome this section wanted: a failure now names its check in a section the comment's elision
cannot reach. Also noted for future forensic work: the job annotation API answered for this run (it
returned the `ReferenceError` above) even though the run log and artifacts still fail with a storage
`EOF`, so annotations are a usable channel when the log download is not.

**No test, step or assertion was weakened to get here.** The script change adds one log line; the reporter
change adds one section. Pass/fail semantics, retries and coverage are unchanged.

### J.12 Final CI state for the directive (run `38501689310`, head `0ed7463`) — GREEN

| Evidence | Value at `0ed7463` |
| --- | --- |
| Full native DB suite | **188 files · 2299 tests · 0 skipped** (`2299 = 2277 + 22` — the new booking-time contract tests run and pass **against the real database** in CI, and no skip was added) |
| §66 experience journey · Business POS journey | 17/17 · 22/22 |
| Authenticated production HTTP/browser/native-DB journey | **428 passed, 0 failed, 0 skipped** |
| Production HTTP isolation smoke | 9 passed, 0 failed, 0 skipped |
| Migration step | applied (new marker migration) |
| Production build · bundle evidence · harness isolation | passed |
| Dependency audit | production **0**; full **7 high, all dev-only** (§J.2) — unchanged, and reported as unresolved rather than waived |

Branch run history for this workflow is now **9 green / 4 red**: the reds are the two pre-existing
authenticated-browser `#418` failures (`38441832430`, `38470293452`), the infrastructure failure in
`Install dependencies` (`38463216815`, §H.14), and `38500660586` (§J.11), whose only non-browser failure
was the reporter bug fixed in `0ed7463`. **The green run is not evidence that the `#418` mismatch is
fixed**: the same gate passed six times before it failed twice, which is exactly why §J.6 keeps its status
as UNRESOLVED rather than calling it a flake. The never-elided failure section is proven by the local
harness in §J.11; it did not render in this run because the run passed.

**Final state of this directive:** task-branch HEAD `0ed7463` (remote-verified, clean tree); `main`
`8db6a9e4` untouched; PR #45 open with the `NOT APPROVED FOR PRODUCTION DEPLOYMENT` label; no merge, no
deploy, no production migration or data change, no provider activation, no live charge or refund.

## K. Directive 7 execution — the staged Tailwind 4 migration (D-2) and the accounting-period decision recorded (D-3b-2 Option A)

### K.1 The two owner decisions, as recorded

| Decision | Owner's choice | What it authorises here |
| --- | --- | --- |
| **D-2** — staged Tailwind 4 remediation (§J.2 plan) | **APPROVED** | The Tailwind toolchain migration only, on the task branch |
| **D-3b-2** — accounting calendar boundaries (§J.5) | **OPTION A SELECTED** — retain the existing UTC-based reporting-period boundaries and daily report buckets | Recording the decision and pinning it with tests; **no** financial period or daily-aggregation boundary was converted to Nairobi time |

Both are scoped to this branch. They do **not** authorise a merge, a deployment, a production-data or
configuration change, media-storage activation or any live transaction — none of which happened (§K.13).

### K.2 What changed, file by file

| File | Change |
| --- | --- |
| `package.json` | `tailwindcss` `^4.3.3`, `@tailwindcss/postcss` `^4.3.3` (both current stable); `autoprefixer` removed; `postcss-selector-parser` `7.1.6` re-declared as an explicit devDependency (§K.6) |
| `package-lock.json` | Regenerated for those three changes only |
| `postcss.config.js` | Now runs `@tailwindcss/postcss` alone, with a comment recording the removal rationale |
| `tailwind.config.ts` | **Deleted** — its single `content` array and its only theme key (`fontFamily.sans`) are migrated CSS-first |
| `app/globals.css` | `@import "tailwindcss" source(none)` + three `@source` globs + `@theme { --font-sans: … }` + the six-rule v3 compatibility shim (§K.3). Every `--jata-*` / `--eb-*` token and all authored CSS below are untouched |
| 10 `.tsx` files | 55 token-accurate class renames (§K.4) |

`source(none)` is deliberate: it disables v4's automatic content detection so the class scan is exactly
what the deleted `content` array declared. The package/version pins for React, Prisma, Next, Motion,
`puppeteer-core` and the Node `engines` field are unchanged.

### K.3 Behaviour preservation — what the migration would otherwise have changed silently

The v3-to-v4 preflights were **diffed file against file** (`tailwindcss@3.4.19`
`lib/css/preflight.css` vs `tailwindcss@4.3.3` `preflight.css`) instead of relying on the published
upgrade notes. **Seven rules** were required. Four were anticipated by the §J.2 plan — border colour,
ring colour, button cursor, placeholder colour. The file-to-file diff added three more that a summary of
the upgrade notes would not have caught: the `:disabled` companion to the button-cursor rule,
`button, select { text-transform: none }`, and the `[type='search']` normalisation. Each is restored in
`@layer base` in `app/globals.css` **with the v3 value verbatim**:

| # | v3 default | v4 behaviour if unrestored | Restored as |
| --- | --- | --- | --- |
| 1 | universal border-colour `gray-200` | `border: 0 solid` → `currentColor`; every bare `border` / `divide-y` would take the text colour | `border-color: #e5e7eb` |
| 2 | default `--tw-ring-color` `blue-500/50` | `currentColor` | `--tw-ring-color: rgb(59 130 246 / 0.5)` |
| 3 | `button, [role="button"] { cursor: pointer }` | **removed** — buttons fall back to the arrow cursor (a UX change, not styling) | `button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer }` |
| 4 | `:disabled { cursor: default }` | **removed** | `:disabled { cursor: default }` |
| 5 | `input::placeholder { color: gray-400; opacity: 1 }` | `color-mix(… currentcolor 50% …)` — reads differently on coloured surfaces | `::placeholder { color: #9ca3af; opacity: 1 }` |
| 6 | `button, select { text-transform: none }` | **removed** — an uppercased ancestor would leak into controls | `button, select { text-transform: none }` |
| 7 | `[type='search'] { -webkit-appearance: textfield; outline-offset: -2px }` | **removed** — Safari draws its native rounded search field; three real inputs affected (`components/pos/RecordBoard.tsx`, `components/pos/TillClient.tsx`, `components/storefront/CatalogueClient.tsx`) | restored verbatim |

Items 3 and 4 are two rules for one v3 area — the button cursor and its `:disabled` companion. Items 5–7
were **not** in the §J.2 plan: they were found by the diff rather than assumed. The test file below pins all
seven rules.

**The layer is the point.** v4 emits `@layer properties, theme, base, components, utilities`, so a `base`
rule loses to every utility: a bare `border`, `ring-1`, `placeholder-*` or `cursor-*` class still wins, and
the app's own unlayered `.jata-*` / `.eb-*` rules still win over both — the same ordering v3 produced.

**Deliberately not shimmed, because the emitted CSS is equivalent (verified, not assumed):**

- `list-style: none` is **identical** in both preflights (`menu,ol,ul{list-style:none}` in both builds).
- v3's per-element margin zeroing (`h1…h6`, `p`, `pre`, `figure`, `fieldset`, `legend`, `dialog`) and
  `body{margin:0}` are covered by v4's broader `*,::backdrop,:after,:before{margin:0;padding:0}`.
- The v3 `body { line-height: inherit }` is covered by v4 setting `line-height: 1.5` on `html`.
- `::before/::after { --tw-content: '' }` was dropped by v4, but the repository uses **no**
  pseudo-element utilities and no authored CSS references `--tw-content` (both checked).
- **The html font family was verified end-to-end** because it is the one difference that could have
  restyled the entire product: the built CSS resolves `:host,html{font-family:var(--default-font-family,…)}`
  and `--default-font-family: var(--font-sans)` with `--font-sans: Inter,ui-sans-serif,…`. The app still
  renders in Inter.

### K.4 The class renames, and the proof that they are the whole diff

v4 kept the three affected utility names but changed their meaning, so a rename is required and a missed
rename is silent:

| v3 | v4 | Occurrences |
| --- | --- | --- |
| `rounded` (0.25 rem) | `rounded-sm` | 49 |
| `shadow-sm` | `shadow-xs` | 4 (including `hover:shadow-sm`) |
| `outline-none` (2 px transparent offset ring) | `outline-hidden` | 2 (including `focus:outline-none`) |

All 55 changes are inside `className` attributes; no prose or design-token text was touched. The claim was
then **proved rather than asserted**: every removed/added line pair was normalised and compared, and all
55 pairs are explained by those three renames and nothing else (`.tsx` added 55 lines / deleted 55 lines,
delta 0). Values were verified in both builds: v3 `.rounded` = `.25rem` and v4 `.rounded-sm` =
`var(--radius-sm)` = `.25rem`; v4 `.shadow-xs` emits the same `0 1px 2px 0 rgb(0 0 0/0.05)`; v4
`.outline-hidden` emits v3's exact `outline:2px solid #0000; outline-offset:2px`. A resource-wide scan of
every `className` attribute found **zero** missing utilities after the migration.

### K.5 Dependency audit, before and after — exact findings

| | Before (`52abdb0`) | After (`f67b632`) |
| --- | --- | --- |
| Full audit (`npm audit`) | 7 high, 0 moderate, 0 critical | **5 high, 0 moderate, 0 critical** |
| Production audit (`npm audit --omit=dev`) | 0 | **0** |
| Advisories cleared | — | **`tailwindcss`, `chokidar`** |
| Advisories remaining | 7 | 5 — `@next/eslint-plugin-next`, `braces`, `eslint-config-next`, `fast-glob`, `micromatch` |

`tailwindcss@4.3.3` has **zero dependencies** (asserted by the test), so the v3 chain
`tailwindcss → chokidar → braces` and `tailwindcss → fast-glob/micromatch → braces` cannot exist: the
string `chokidar` now appears **0 times** in the lockfile.

**The two expected findings did disappear, and this is not complete remediation.** The five that remain
are one development-only chain that hangs off Next's own ESLint plugin:

```
eslint-config-next@15.5.27 → @next/eslint-plugin-next@15.5.27 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3
```

`braces` (GHSA-vfj7-8cjw-p6xm, high, vulnerable `<= 3.0.3`) still has **no published patched version** —
3.0.3 is the highest release — and the only `fixAvailable` npm offers for all five is a **major downgrade to
`eslint-config-next@14.2.35`**, a Next-14 lint stack against Next 15.5.27. That is out of the authorised
scope, so it was **not** done. No advisory was suppressed or reclassified, no security test was removed or
loosened, `npm audit fix --force` was not run, and no override was introduced. **Full remediation is not
claimed, because five findings remain.**

### K.6 One unexpected but necessary finding: `postcss-selector-parser`

Removing Autoprefixer removed `postcss-selector-parser` from the tree entirely — it had been present only
as Autoprefixer's transitive dependency. That broke the ratified security test
`tests/unit/dependency-security-compat.test.ts`, which **imports** the package and pins it at `7.1.6`
(asserting selector round-tripping for adversarial selectors, the ReDoS-class check).

Deleting that import and assertion would have removed a security assertion, which is prohibited. The
package was therefore re-added as an **explicit devDependency at the already-reviewed `7.1.6`** — a
re-declaration of the same reviewed version, not a new or upgraded dependency. It brings `cssesc@3.0.0`
and `util-deprecate@1.0.2`, both dev-only; the audit totals were re-checked afterwards and are unchanged
(§K.5). The ratified pin test was updated in the same way and for the same reason:
`tailwindcss` `3.4.19` → `4.3.3`, plus structural assertions that v4 stays dependency-free, Autoprefixer is
absent, and the removed chain cannot return unnoticed. No existing assertion was weakened.

### K.7 Autoprefixer — removed only after checking what it was contributing

There is **no `browserslist` configuration** in this repository, so Autoprefixer had been running its own
legacy defaults. Comparing the two builds declaration by declaration:

- **Uniquely Autoprefixer-era prefixes that v4 does not emit** target browsers outside any plausible
  support baseline here: `-o-object-fit` (Opera Presto), `-o-tab-size`, `-moz-tab-size`,
  `-moz-columns`, `-moz-column-gap`, `-moz-column-break-inside` (Firefox < 52). The app's only use of
  that group is `object-cover` (8 occurrences), whose unprefixed `object-fit` is supported everywhere
  modern.
- **v4's Lightning CSS still prefixes for the modern baseline** — it *adds* `-webkit-backdrop-filter`,
  `-webkit-hyphens`, `-webkit-text-decoration*`, `-moz-focusring`, `-moz-orient`.
- The remaining difference is v4's own preflight being rewritten to the standard `appearance` and
  `::file-selector-button`, which numbers 3, 4 and 7 in §K.3 already cover.

### K.8 D-3b-2 Option A — recorded, and now a contract rather than an accident

Option A is recorded in §K.1: **the accounting period stays the server's day, UTC in production, i.e.
03:00–03:00 Nairobi.** No financial reporting period or daily aggregation boundary was changed, no
historical report is reinterpreted, and `lib/pos/reports.ts` is untouched by this change set.

New file `tests/unit/pos-reporting-period-policy.test.ts` (5 tests) makes the policy explicit:

1. exact UTC bounds for the day, Monday-first week and calendar-month periods in the production zone;
2. that every boundary derives from the **ambient server day** rather than Nairobi, asserted in a
   zone-agnostic form so it holds wherever the suite runs;
3. determinism — the same instant always yields the same period, a period never depends on when the
   report is run, and a recomputed daily series is identical;
4. the label/period separation the decision rests on, worked through at all three granularities: a
   00:30 EAT sale is counted in the previous UTC bucket while printing `14 Oct 2026 · 00:30`; a sale at
   00:30 EAT on 1 November is accounted in **October**; a Monday-morning sale is accounted in the
   previous week;
5. the accepted consequence, asserted rather than described — a Nairobi business day is 03:00–03:00 in
   accounting terms, so its first three hours belong to the previous period. Changing that now requires a
   deliberate, visible change to this file.

Nairobi presentation is unchanged and stays separate from period mathematics (`lib/pos/receipt.ts`,
`lib/pos/reporting.ts`, `lib/payments/wallet.ts` keep their business-clock labels). Existing coverage in
`pos-financial-timezone.test.ts` is untouched and still passes alongside it.

### K.9 Verification — exact commands and outcomes at `f67b632`

| Gate | Command | Outcome |
| --- | --- | --- |
| Dependency audit (full) | `npm audit` | **5 high / 0 moderate / 0 critical**, all dev-only (§K.5) |
| Dependency audit (production) | `npm audit --omit=dev` | **0** |
| Production build | `npx next build` | **exit 0**, all routes compiled; built CSS **100,688 B** (v3 baseline 90,963 B) |
| Full test suite | `npx vitest run` | **179 files passed / 13 skipped (192); 2234 tests passed / 114 skipped (2348); 0 failures** |
| POS / payments group | `npx vitest run tests/unit/pos tests/unit/payments tests/e2e/business-pos-journey.test.ts` | **8 files passed / 1 skipped; 166 passed / 22 skipped** |
| Lint | `npx next lint` | **exit 0**, one pre-existing warning (`components/storefront/CartProvider.tsx:210`, `<img>`), untouched by this change set |
| TypeScript | `npx tsc --noEmit` | **1 error**, the known offline Prisma baseline: `tests/prisma/experience-boundary.test.ts(34,19)` — `BusinessUncheckedCreateInput` missing. The file is **byte-identical to `main`**, the error comes from `node_modules/.prisma/client` being un-generated here (`prisma generate` cannot reach `binaries.prisma.sh`), and CI runs `npx prisma generate` before type-checking. **Not introduced by this change set** |

**Skip accounting (exact).** 114 skipped tests = 97 in the 13 wholly-skipped database suites + 17 in
`tests/e2e/interactive-business-journey.test.ts`. Every skipped file is gated on
`DATABASE_URL` / `PRISMA_TEST_DATABASE_URL`, neither of which exists in this environment (no Postgres, no
Docker). **No test was skipped or weakened to obtain a green result**; the database gates run in CI, which
provisions a database, and are reported from CI rather than from here.

**CSS parity checks performed on the built artefacts.** All seven shim declarations are present in the
final minified CSS; no v3-meaning utility is emitted (`outline-none` 0, `shadow-sm` 0); the 41 `@property`
blocks and the layer order `properties, theme, base, components, utilities` are as expected. The CSS grew
90,963 → 100,688 B (+10.7 %); the growth is v4's `@property` scaffolding (41 blocks, 2,540 B) plus the
per-theme variable set, not duplicated utilities.

### K.10 Visual verification — stated as a limitation, not satisfied

**No browser or Chromium exists in this environment**, so **no screenshot was taken and no
visual-equivalence claim is made.** Baseline evidence recorded before the migration was: the green CI runs
at `0ed7463` / `52abdb0`, the existing component and design-system tests, the v3 production build and its
built CSS, and the v3 preflight source. Post-migration UI evidence is limited to: the production build, the
selector/declaration diff of the built CSS against the v3 build, the CSS-reading component tests
(`design-system`, `lime-spark-contrast`, `product-themes`, `storefront-motion` — 66 tests, all passing),
and the CI browser gates (§K.11).

Accordingly the **authenticated-browser visual gate remains UNRESOLVED** and is not closed by this
section. Dashboard, Website Studio, AI Front Desk, POS, checkout, auth/onboarding and generated
business-page rendering were **not** visually inspected here; a passing build is not proof of visual
correctness. A human or CI-browser pass over those surfaces against this HEAD is still required before any
deployment decision.

### K.11 What §K did and did not do

**Did:** execute the approved staged Tailwind 4 migration; preserve the six v3 defaults that v4 changed
or dropped, with evidence; rename the three re-meaning utilities token-accurately and prove the diff is
exactly that; clear the two expected advisories and report the remaining five individually; record
D-3b-2 Option A and pin it with tests; re-ratify the `tailwindcss` pin and keep the
`postcss-selector-parser` security assertion meaningful.

**Did not:** merge anything into `main`; deploy; change any production data, configuration, environment
variable or provider setting; activate media storage; run or authorise any live payment; upgrade any
dependency outside the Tailwind toolchain; use `npm audit fix --force`; suppress an advisory; remove,
skip or weaken a test; convert any financial reporting period or aggregation boundary to Nairobi time.
No secret was requested, printed or committed at any point.

### K.12 CI evidence for this change set

| Run | Head | Result |
| --- | --- | --- |
| `38516401106` | `e5fce60` (the migration) | **RED** — step 16 only (authenticated browser journey), see below |
| `38516677923` | `f67b632` (migration + policy tests) | **GREEN** |
| **`38516766371`** | **`8bc4e4e` (migration + tests + this report)** | **GREEN — all 22 steps** |

Evidence from the green run at `8bc4e4e`, as posted to PR #45 (comment `6161757860`):

| Gate | Result |
| --- | --- |
| Full native DB suite (against a provisioned PostgreSQL) | **190 files · 2308 tests · 0 skipped** |
| §66 experience journey | 17 passed |
| Business POS journey | 22 passed |
| Production HTTP isolation smoke | 9 passed, 0 failed, 0 skipped |
| Authenticated production HTTP/browser/DB journey | passed — hydration samples `ok:true`, `rawStatus:200`, no uncaught browser runtime error |
| Production advisory gate and full-audit findings | success |
| Lint and TypeScript | success |
| Migrations · seed · production build · harness isolation and bundle evidence | success |

**Local-versus-CI reconciliation (exact).** CI reports 2308 tests in its suite step because the two
journey files run as their own steps (18 and 22 tests). `2308 + 18 + 22 = 2348`, which is exactly the
local total, and CI's 0 skipped against this environment's 114 is entirely the database gate: CI
provisions PostgreSQL, this environment has none. **The Tailwind migration is exercised end-to-end in
CI** — the production build at step 14 compiles the v4 stylesheet and the browser journey at step 16
loads the real pages. That is functional, not visual, evidence (§K.10).

**The one red run, reported rather than explained away.** `38516401106` failed **only** at step 16, the
authenticated browser journey, on a React #418 hydration mismatch (`args[]=HTML`) on the Website Studio
preview route. **This is not called a flake and is not attributed to the migration**: the signature is
byte-identical to the pre-migration failure in `38470293452` (13 Oct, before any Tailwind change), the
same route and the same `args[]=HTML` argument, and the two subsequent runs on the same migrated code
were green. Being green twice afterwards does not establish a cause. **§H.3 / §J.6 keep their status:
UNRESOLVED, cause unknown.** The gate remains intermittent, and the browser-verification limitation in
§K.10 is unaffected by the green result.

**Branch run history is now 17 runs: 12 green, 5 red** — the five reds are the pre-existing browser
failures (`38441832430`, `38470293452`, `38500660586`, `38516401106`) and the infrastructure failure in
`Install dependencies` (`38463216815`).

### K.13 Final state of this directive

| Item | Value |
| --- | --- |
| Verified code state | **`8bc4e4e`** — remote-verified, clean tree, and the head the CI run below was executed against. The commit carrying this §K text is its immediate successor and changes documentation only |
| Commits added by this directive | `e5fce60` (Tailwind 4 migration) · `f67b632` (period-policy tests) · `8bc4e4e` (report §K.1–§K.11) · the report-only successor that carries §K.12–§K.13 |
| `main` | `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` — **untouched** |
| PR #45 | **open**, MERGEABLE, head `8bc4e4e`, `NOT APPROVED FOR PRODUCTION DEPLOYMENT` retained |
| Dependency audit | full **5 high (all dev-only)**; production **0** — **not** complete remediation, the five remaining findings are named in §K.5 |
| Tailwind | `4.3.3` + `@tailwindcss/postcss` `4.3.3`; `tailwind.config.ts` removed; Autoprefixer removed (§K.7) |
| D-3b-2 | **Option A recorded** (§K.1, §K.8) with tests; no boundary or bucket converted to Nairobi |
| Visual verification | **NOT PERFORMED — no browser in this environment** (§K.10); the authenticated-browser `#418` gate remains UNRESOLVED (§K.12) |
| Merge · deploy · production data or config change · media-storage activation · live transaction | **none performed, none authorised** |

**Stopping here, as directed.** The scoped migration, its verification and this report update are
complete. Merging, deploying, changing production data, activating media storage or running any live
financial transaction requires separate, explicit owner authorisation — and on the evidence above, the
remaining five advisories, the unresolved `#418` gate and the missing visual verification should each be
resolved or consciously accepted first.

## L. Directive 8 execution — #418 isolated to the framework's reconciler, browser QA executed, advisories re-verified (2026-10-14)

This section appends to §A–§K. Nothing above is rewritten, and every evidence item recorded earlier
stays as recorded, including the statements it corrects.

### L.1 Scope, verified starting state, and what this section does not claim

Directive 8 has three workstreams: (A) diagnose and fix the React #418 hydration failure, (B) perform
real browser visual/functional QA, (C) re-verify and resolve the five remaining dev-only advisories.

Verified start: branch `arena/fac28f53-jata-aftercall` at
**`28a52c7571e3b9cf64c9c8b592bccbe03e1c481c`** (local = remote, clean tree), PR #45 open with
`NOT APPROVED FOR PRODUCTION DEPLOYMENT`, `main` = `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` —
**untouched before and after this section**. The Tailwind 4 migration was not undone and no ratified
booking, payment, POS or reporting contract was altered.

**The most consequential change to this report's earlier positions is that browser verification is no
longer unavailable.** §K.10 recorded visual verification as NOT PERFORMED "no browser in this
environment". That is no longer true: a real Chromium 153 launches here, the repository's own browser
checks run against a server this environment controls, and their screenshots were opened and inspected
(§L.4). The hydration gate nevertheless stays **UNRESOLVED**, for a different and now precisely named
reason (§L.2).

Still unavailable here, and therefore still evidence of nothing: `DATABASE_URL` / PostgreSQL, and with it
the authenticated studio journey, every `tests/prisma/*` and `tests/e2e/*` suite, and all POS and
dashboard surfaces (§L.4.4).

### L.2 Workstream A — the #418 root cause is isolated to the vendored React reconciler, and its fix is a framework decision the owner must make

**What the failing signature means — verified in the shipped code, not inferred.** `args[]=HTML` is the
second argument of React's `throwOnHydrationMismatch(fiber, isText)`, which the App Router runtime calls
as `formatProdErrorMessage(418, isText ? "text" : "HTML")` in
`node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js` (Next 15.5.27). `HTML`
therefore means an **element** mismatch against the expected `nextHydratableInstance`. It is not a text
mismatch, and not an ambient-clock label difference — which rules out that whole class for this
signature, including the booking-calendar defect that was already fixed and proven in the earlier
investigation document.

**The app runtime's React is Next's vendored React, not the app's `react` package — proven locally.** A
temporary diagnostic route (created, probed, deleted; never committed) rendered
`{"reactVersion":"19.2.0-canary-0bdb9206-20250818","hasReactCache":"function","requestCacheIsIdentity":false}`
while `node_modules/react` is `18.3.1`. Two consequences follow. First, the M11 request-cache
deduplication in `lib/request-cache.ts` is genuinely active in the app runtime rather than silently
falling back to its identity wrapper. Second, installing a different `react`/`react-dom` **cannot** change
hydration here: only the framework's vendored build can.

**The mechanism reproduces deterministically in a real browser.** `scripts/browser/hydration-race.check.mjs`
on HeadlessChrome 153.0.8010.0:

| Arm | Variable | Result |
| --- | --- | --- |
| `synthetic-leading-scripts` | two `<script>` nodes precede the expected body child | **2 × #418** |
| `synthetic-parse-frontier` | the expected child is absent at hydration time | **#418 + #423** |
| `synthetic-control` | correct order | **0 errors** |

The only difference between arms is the DOM React is handed, so the precondition named in M11/M14 is
causal and still live. Stated rather than glossed: these arms bundle the repository's own `react-dom`
(18.3.1), so they demonstrate the invariant the reconciler enforces, not the production React 19
signature. The forced-timing arms over the real production `/login` document (React 19, `next start`)
produced **0/8 forced and 0/3 control** — without the authenticated retail journey (which requires a
database) the production trigger did not reproduce here.

**The root cause, located in the shipped bytes of two framework builds.** Read-only comparison of two
published packages; nothing was patched:

| | Next 15.5.27 (current) | Next 16.4.0 (`latest`) |
| --- | --- | --- |
| vendored `react-dom` peer | `19.2.0-canary-0bdb9206-20250818` | `19.3.0-canary-278794d7-20261002` |
| `case 5:` in the unwind/replay switch | `resetHooksOnUnwind(next);` then straight to `default:` | `resetHooksOnUnwind(next); var fiber = next; fiber === hydrationParentFiber && (isHydrating ? (popToNextHostParent(fiber), 5 === fiber.tag && null != fiber.stateNode && (nextHydratableInstance = fiber.stateNode)) : (popToNextHostParent(fiber), (isHydrating = !0)));` |

In 15.5.27's reconciler the **hydration cursor is not restored when a host fiber is replayed**; in
16.4.0's it is — `nextHydratableInstance = fiber.stateNode`, with `isHydrating` re-armed. That is exactly
the mechanism M14 named from runtime stacks (react-dom creating and inserting host nodes during the
hydration attempt) and the fix M15's upstream research identified as react#35494 + react#35518, shipped
in React 19.3.0 only. The two independent lines of evidence agree: a reconciler that replays a host fiber
without rewinding the cursor finds script nodes where the tree expects a `div`, and throws #418 — the
signature in the red runs.

**Next 15.5.27 is the tip of its line.** `npm view next dist-tags` reports `backport: 15.5.27` (no
15.5.28 exists) and `latest: 16.4.0`; the vendored React only moves with the major line. Obtaining the
fix therefore means one of: **(a) a Next 16.x upgrade** (major), **(b) a `patch-package` patch to
`next/dist/compiled/react-dom`** (framework internals), or **(c) accepting the intermittent failure with
monitoring plus the prepared upstream issue** in `docs/WEBSITE_STUDIO_HYDRATION_UPSTREAM_ISSUE.md`.
Directive 8 requires (a) and (b) to be reported for owner decision before execution, and forbids
suppressing the symptom.

**A fresh reproduction arrived while this section was being written, and it matches the analysis.** CI run
`38523812584` (the run for §L.3's commits, head `70628ffe`) failed at **step 16, "Authenticated production
HTTP browser journey"**, with:

- `BROWSER RUNTIME ERROR … "Minified React error #418; … args[]=HTML"` on
  `/dashboard/businesses/cmv7qxhir004bsm3csw8sdxd7/preview` inside frame `/b/qa-salon-e2328a2d` — the
  **authenticated draft-preview storefront iframe**, i.e. exactly the trigger condition M14 isolated, not
  a new surface;
- the stack resolves through `4bd1b696-100b9d70ed4e49c1.js` — **byte-for-byte the same framework chunk
  name my local build produced in §L.2**, so the local code-level analysis is aimed at the same bundle
  that fails in CI;
- the M14 mutation stack capture is **empty** in this capture (`firstScriptInsert` / `firstScriptMove` /
  `firstBodyReorder` all blank, with only `insertBefore: 7` / `appendChild: 15` counted), so this
  particular reproduction does **not** re-capture the mover's call site. It is consistent with a
  non-rewound hydration cursor, and it is not presented as an independent confirmation of it.

This is **not** attributed to the diff that triggered the run: that diff is one unit-test file and this
report section, neither of which the authenticated browser journey loads. It is also **not called a
flake**, and the two preceding green runs (`38516677923`, `38516766371`) do not establish that anything
was fixed — on the standing rule that a later pass never closes this gate. **Branch run history is now
18 runs: 12 green, 6 red.**

**Gate status: UNRESOLVED — blocked on that decision.** No `suppressHydrationWarning`, no framework
patch, no test skip or rename, and no change to authentication, tenant isolation, entitlements, payment
state or SSR was applied. §H.3 / §J.6 / §K.12 keep that status.

### L.3 Workstream A (continued) — a calendar-dependent test that would have failed this branch permanently from 15 October 2026

Found by running the full suite rather than trusting the result recorded in §K.12.

`tests/unit/booking-time-contract.test.ts` block 4 pinned `DAY = "2026-10-14"` — the day it was written —
and called `freeSlotsFor` without its `now` parameter, while `freeSlotsFor`
(`lib/experience/booking.ts`) drops every slot whose instant has passed
(`if (start < now.getTime()) return false`). At 09:37 Africa/Nairobi on the 14th the 09:00 slot had
passed, and the suite failed **3 failed / 2231 passed / 114 skipped**.

That it is a date bomb and not a product defect is shown by a negative control: with the process clock
shifted +400 days through a scratch `--import` preload, the **original** file fails **3 failed /
19 passed**. Because `freeSlotsFor` never offers a slot that has started, from 2026-10-15 the same three
tests fail on every runner, CI included — on code that never changed. The file's own `futureNairobiDay()`
helper and `tests/unit/experience-operations.test.ts`'s relative `futureDate()` dates already avoid this
hazard; block 4 simply did not use them.

**Fix:** the five availability/capacity calls now pass the clock the API already accepts
(`now: BEFORE_OPEN`). Every assertion, the `DAY` anchor and the dedicated clock test ("hides a slot once
its Nairobi instant has passed") are unchanged, so the tests assert the contract instead of the calendar:
**22/22 at the real clock, 22/22 at +400 days, 22/22 at −400 days.** This corrects §K.12 — the
"0 failures" recorded there was clock-dependent, and on 13 October it passed only because `DAY` was still
in the future.

### L.4 Workstream B — browser visual/functional QA, executed

#### L.4.1 How it became possible

§K.10's blocker was environmental, not a permission: no browser could be launched. Working route found
and documented in `/home/user/browser-env/README.md` (outside the repository; these are third-party
binaries and must never be committed):

- Chromium 153 binaries via npm `@sparticuz/chromium@153.0.0` (extracts to `/tmp/chromium`), driven by
  `puppeteer-core@25.13.0`.
- Its three missing direct shared libraries are supplied from npm tarballs: the **2018 NSS** set from
  `chrome-aws-lambda@10.1.0`'s brotli-compressed `bin/aws.tar.br` (provides `NSS_3.39`; Chromium needs
  only `NSS_3.30`), plus only the **NSPR trio** from `@achingbrain/nss@0.0.1` — that package's 2016 NSS
  must not be allowed to overwrite the 2018 files.
- Verified launch: `HeadlessChrome/153.0.8010.0`, a real render captured and visually inspected.
- Routes that do **not** work here and should not be retried: `apt-get` (permission-denied lists
  directory), Electron release assets (redirected off `github.com`), GitHub Actions artifact downloads
  (storage `EOF`), and browser-layer repositories (no libs, or no releases).

Every result below comes from the repository's own committed check scripts, unmodified, against a server
started in this environment. Servers were local (ports 4100/4200); no production environment, no
production data and no provider was contacted.

#### L.4.2 QA matrix

| Surface | Viewport | Scenario | Evidence (command) | Result |
| --- | --- | --- | --- | --- |
| Fixture layout (`/dev/immersive-preview`) | 360×740, 1280×800, reduced-motion | no horizontal overflow, `h1` visible and non-empty, product image visible | `npm run test:browser:layout` — **7 passed, 0 failed, 0 skipped** | PASS |
| Immersive 3D preview | desktop + phone | eligibility (WebGL, low memory, Save-Data, reduced motion, opt-in), model-load failure, unsafe/compressed graph, context loss, 8-second draw budget, keyboard and touch orbit | `npm run test:browser:immersive` — **22 passed, 0 failed, 0 skipped**; 4 screenshots | PASS |
| Generated business pages — 20 families | 360×740 (no-JS and JS) + desktop | semantic HTML without JavaScript, heading/price/phone/WhatsApp/shop present, `overflow=0`, local imagery only, 20/20 structurally distinct | `npm run test:browser:families` — **167 passed, 0 failed, 0 skipped**; 5 screenshots | PASS |
| Touch cart (marketplace, interactive-showroom, minimal) | 360×740 touch | cart opens with the authoritative KES 149 subtotal, closes, no uncaught errors | included in the families run | PASS |
| Motion / reduced-motion / slow network | phone + desktop | Save-Data and 3G stay Lite, active effects cancelled, content and exact price remain readable, no residual animations, React scope unmount cancels | `npm run test:browser:motion` — **124 passed, 0 failed, 0 skipped**; 2 screenshots | PASS |
| Local media pipeline | n/a | EXIF 1–8 rotation/mirroring, PNG alpha, >5 MB source, MIME lie, cancel, monotonic progress, blocked provider mutations | `npm run test:browser:media-local` — **29 passed, 0 failed, 0 skipped** | PASS |
| Quick-action bar geometry | 360×740 | element overlaps, escapes from the bar and viewport, touch-target size, console errors | own read-only probe against the running fixture | PASS, with **DEF-1** (pre-existing) |
| Tailwind 4 preflight restorations | built CSS artefact | the six restored v3 defaults are present in the minified production CSS | byte check of `.next/static/css/9047531062c71c71.css` | PASS |
| POS + storefront search inputs | — | `[type="search"]` normalisation present in the production CSS; the three inputs exist at `components/pos/RecordBoard.tsx:196`, `components/pos/TillClient.tsx:349`, `components/storefront/CatalogueClient.tsx:85` | source + built-CSS inspection | CSS PASS; **browser interaction NOT PERFORMED** — needs the dashboard/DB |
| Authenticated dashboard, Website Studio create/edit/preview/publish, AI Business Front Desk, POS and transaction states, subscription/checkout/receipts, auth/registration/password recovery, onboarding, analytics, inventory, reports | — | — | — | **NOT PERFORMED — see §L.4.4** |

Local browser total: **349 checks passed, 0 failed, 0 skipped** across five committed scripts.
**Defects found: one (DEF-1), pre-existing, not caused by the Tailwind 4 migration.**

#### L.4.3 What inspection actually found

**DEF-1 — quick-action bar labels paint outside their buttons at 360 px (pre-existing).** Measured on
`/dev/motion-preview` at 360×740: no element overlaps, nothing escapes the bar's content box or the
viewport, `document.scrollWidth = 360`, every action is a 44 px-tall touch target, and there are no
console errors — but the "WhatsApp" (83 px) and "Directions" (87 px) labels are wider than their 74 px
pill buttons, so with `overflow: visible` the text paints across the neighbouring control. Mechanism:
`.eb-scope.eb-btn--upper .eb-btn` uppercases at `0.85rem` with `0.06em` letter-spacing while
`.eb-actionbar .eb-btn` gives each of four actions `flex: 1 1 0` of a 360 px bar.

**This is not a migration regression, and that is proven rather than asserted:** `ActionBar.tsx` is not
among the files the migration touched, and its governing rules are byte-identical before and after
(`git show 52abdb0:app/globals.css` vs the working tree produced no diff for `.eb-actionbar*` /
`.eb-btn*`). It is a real legibility defect on 4-action storefront bars at phone width; fixing it changes
generated-page visual design, so it is reported for an owner decision rather than restyled here.

**Deliberately not claimed:** no pre-migration screenshots exist, so **no pixel comparison and no claim
of pixel parity** is made anywhere in this section. What is verified is that the built CSS carries every
restored v3 rule (§L.4.2), the same rules the earlier migration analysis derived from the two preflight
files.

#### L.4.4 NOT PERFORMED, and exactly what would be required

The authenticated surfaces in the matrix above are **not performed**, not "passed by inference". They
need the same things CI has and this environment does not:

1. a reachable PostgreSQL and a `DATABASE_URL` for the app plus `PRISMA_TEST_DATABASE_URL` for the
   DB-backed suites (CI uses a `postgres:16` service container);
2. a seeded, authenticated session for the retail journey that `studio-authenticated.check.mjs` drives
   (the run that failed in `38516401106` on step 16);
3. for the POS till and record-board search inputs specifically, the dashboard/DB context in which those
   routes render.

Also not performed anywhere in this section: physical-device testing, real payment providers, real
uploads or media-storage activation, and production performance metrics. Those remain out of scope by
standing policy, not merely unavailable.

### L.5 Workstream C — the five dev-only advisories, re-verified against live metadata before any conclusion

Re-run at this change set. **Production remains clean: `npm audit --omit=dev` reports 0 findings of every
severity.** (Directive 8 requires production and development results to be kept separate; they are.)

**Development-inclusive: 5 high, 0 moderate, 0 critical, 0 low** — one chain, all reached through
`eslint-config-next@15.5.27` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`:

| Package | Version | Advisory | Environment | Fix offered by npm |
| --- | --- | --- | --- | --- |
| `braces` | 3.0.3 | `GHSA-vfj7-8cjw-p6xm` | dev only | `eslint-config-next@14.2.35` (`isSemVerMajor: true`) — a **downgrade** |
| `micromatch` | 4.0.8 | via `braces` | dev only | same |
| `fast-glob` | (nested) | via `micromatch` | dev only | same |
| `@next/eslint-plugin-next` | 15.5.27 | via `fast-glob` | dev only | same |
| `eslint-config-next` | 15.5.27 | via the above | dev only | same |

**The `braces` "NONE PUBLISHED" claim is re-verified — and confirmed — against live authoritative
metadata**, as Directive 8 requires rather than on the strength of the earlier reading. GitHub's advisory
API for `GHSA-vfj7-8cjw-p6xm`: severity HIGH, published 2026-09-18, updated 2026-10-02, **not withdrawn**,
package `NPM/braces`, vulnerable range **`<= 3.0.3`**, `firstPatchedVersion` **`NONE PUBLISHED`**. npm
registry: `braces` latest is still `3.0.3`, last modified 2024-09-18 — no release since the advisory.
There is therefore **no supported patched version to move to**, and the only remediation npm can offer is
the semver-major downgrade of `eslint-config-next`, which Directive 6/8 forbid.

**Disposition: explicitly UNRESOLVED, individually demonstrated, not suppressed and not "fixed".**
Exploitability context: the advisory is a stack-exhaustion denial of service on deeply nested brace
patterns; here `braces` is reached only by the ESLint toolchain matching **developer-controlled**
filenames and committed glob patterns during lint, never by request-time input, and it is absent from the
production dependency graph. Interim controls: lint globs stay static and committed, no untrusted pattern
source is introduced, and the upstream release is the trigger to revisit. The earlier finding that
`tailwindcss` and `chokidar` cleared (0 occurrences in the lockfile) still holds.

### L.6 Verification record

| Check | Command | Result |
| --- | --- | --- |
| Full local suite | `npx vitest run` | **179 files passed, 13 skipped (192); 2234 passed, 114 skipped (2348); 0 failed; exit 0** |
| Booking-time contract | `npx vitest run tests/unit/booking-time-contract.test.ts` | **22 passed (22)**; 22/22 also at ±400-day clock shifts |
| Lint | `npx next lint` | exit 0; one pre-existing warning (`<img>` at `components/storefront/CartProvider.tsx:210`, unchanged from the §K baseline) |
| TypeScript | `npx tsc --noEmit` | exit 2 with **exactly one** error: `tests/prisma/experience-boundary.test.ts(34,19) TS2694 … 'BusinessUncheckedCreateInput'` — the known offline-Prisma error (the client at `node_modules/.prisma/client/index.d.ts` is a 3,989-byte stub because `prisma generate` cannot reach `binaries.prisma.sh` here); that test file is untouched by this session and CI's `prisma generate` succeeds |
| Production build | `npx next build` | exit 0; `.next/static/css/9047531062c71c71.css` = **100,688 B** (identical to §K.12's build) |
| Browser suites | the five `npm run test:browser:*` scripts above | **349 passed, 0 failed, 0 skipped** |
| Hydration mechanism | `npm run test:browser:hydration-race` | 2×#418 / #418+#423 / 0 across the three arms; forced 0/8, control 0/3 |
| Production audit | `npm audit --omit=dev` | 0 findings |
| Development audit | `npm audit` | 5 high, dev-only (§L.5) |
| Advisory metadata | GitHub advisory API + npm registry | `firstPatchedVersion: NONE PUBLISHED` confirmed |
| CI, commits of this section | run **`38523812584`** @ `70628ffe` | **FAILED at step 16** (authenticated browser journey, React `#418 args[]=HTML`, §L.2). Steps 1–15 **passed** — including the database-backed unit/integration/security suites, the §66 journey, the POS journey and the production build — and steps **17, 18 and 19 were SKIPPED** as a consequence (booking SSR/hydration regression, the controlled #418 race reproduction, and the motion/immersive browser regressions). Those three are **not** passes and this run provides no coverage from them |
| CI, immediately preceding | `38518147628` @ `28a52c7`, `38516766371` @ `8bc4e4e`, `38516677923` @ `f67b632` | success, 0 failed steps |

**The 114 local skips are unchanged and are entirely the database gate** — 97 across 13 fully
database-gated files (8 under `tests/prisma/*`, 4 `tests/integration/*-postgres.test.ts`, and
`tests/e2e/business-pos-journey.test.ts`) plus 17 inside the otherwise-passing
`tests/e2e/interactive-business-journey.test.ts` — because this environment has no `DATABASE_URL`. They
are **not** passes and **not** failures; CI runs those suites with a provisioned PostgreSQL and 0 skips
(latest green run `38518147628`). No test was skipped, renamed, weakened or deleted to reach any result
in this section; one test file was made *more* deterministic (§L.3).

### L.7 Not performed, and not authorised

No merge into `main`, no deployment, no production configuration or environment-variable change, no
production data change, no database migration, no media-storage activation, and no live financial
transaction — including any Paystack charge or refund. `main` is still
`8db6a9e4d0963241ad36e13cd9c946b76d1ef11a`. PR #45 stays open with its label. The nine live
charge/refund details and the Paystack/Vercel dashboard walk remain open owner inputs, and no credential
was requested, printed or committed anywhere in this section.

### L.8 Owner decisions required

1. **The #418 fix (§L.2)** — choose one: authorise a **Next 16.x major upgrade**; authorise a
   `patch-package` patch to the vendored reconciler; or accept the intermittent authenticated-preview
   failure with monitoring plus submitting the prepared upstream issue. Until then the gate stays
   UNRESOLVED. Note the upgrade also carries the framework's own migration surface for the app.
2. **DEF-1 (§L.4.3)** — whether to restyle the quick-action bar labels at phone width. It is
   pre-existing and cosmetic; fixing it changes generated-page design.
3. **The five dev-only advisories (§L.5)** — accept as unpatchable-and-dev-only with the interim controls
   recorded, or authorise replacing the ESLint stack (which would move a ratified pin).
4. **Merge and deployment** — still separately authorised and not performed.

### L.9 Final state of this directive

| Item | Value |
| --- | --- |
| `main` | `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` — **untouched** |
| PR #45 | **open**, `NOT APPROVED FOR PRODUCTION DEPLOYMENT` retained |
| Tailwind 4 migration | intact; no ratified booking, payment, POS or reporting contract altered |
| D-3b-2 | **Option A still in force**; no boundary or bucket converted to Nairobi |
| Hydration #418 | **UNRESOLVED** — cause named at code level (§L.2); fix blocked on decision 1 |
| Browser visual QA | **PERFORMED locally** (349 checks, 11 screenshots inspected); authenticated surfaces **NOT PERFORMED** (§L.4.4) |
| Dependency audit | production **0**; development **5 high**, all dev-only, explicitly unresolved (§L.5) |
| Test suite | 2234 passed / 114 skipped / 0 failed locally; skips are the database gate only |
| Merge · deploy · production config or data · media activation · live transaction | **none performed, none authorised** |

**Stopping here, as directed.** Correcting §K.10 is the headline: browser verification happened, and it
found one pre-existing defect and no migration regression. The hydration gate is not closed, and the
honest summary of this directive is that Workstream B succeeded, Workstream C confirmed an upstream dead
end, and Workstream A produced the exact cause of #418 together with the framework decision that now
belongs to the owner.
