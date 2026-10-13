# JATA AFTERCALL — Production release report (2026-10-13)

Consolidated, evidence-based report for the P0 implementation directive. Every check carries one of
**PASS**, **FAIL**, **BLOCKED** (cannot be executed in this environment) or **NOT TESTED** (not
executed at all), with the exact evidence behind it. Nothing here is inferred from installation, a
document, or an earlier SHA.

| Field | Value |
| --- | --- |
| Canonical baseline | `main` = `8db6a9e4d0963241ad36e13cd9c946b76d1ef11a` (untouched) |
| Work branch | `arena/fac28f53-jata-aftercall` (based on `77e35ce`) |
| Release-candidate SHA | `f27e07fc580bc704ade57cfdf0461739fb7e2b21` |
| Recovery checkpoint | `9c36bd1026e50a5ab6e66f7446ae730c71f5963a` — fetchable, never moved |
| Branch pushed? | **No.** `git ls-remote origin` has no `refs/heads/arena/fac28f53-jata-aftercall`; pushing needs owner authorization |
| Environment | node v22.22.3, npm 10.9.8. No `DATABASE_URL`, no `PAYSTACK_SECRET_KEY`, no Chrome/Chromium, `binaries.prisma.sh` unreachable. npm registry reachable |
| Deployed? | **No.** No Vercel deploy, no production env change, no migration run, no production data touched |
| Final status | **BLOCKED — not yet READY FOR OWNER APPROVAL.** See §F |

---

## A. Audit and scope discipline

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Audit before implementation (payment state machine, theme/token layers, dependency tree, migration set, CI gates) | **PASS** | This report; the per-section evidence below |
| A2 | Small, reviewable commits — one concern each | **PASS** | `730c0c8` payments, `ac3381d` hydration, `b849b70` dependencies, `f27e07f` design-system reconciliation. 4 commits, 23 files, +1135/−894 since `1ce74cf` |
| A3 | No destructive git operations, no history rewrite, `main` untouched | **PASS** | No reset/rebase/force-push; `main` still `8db6a9e4…`; checkpoint `9c36bd10…` still fetchable |
| A4 | Baseline preserved: parallel work (5 other branches, PRs #16/#20/#41/#42/#44) left alone | **PASS** | No PRs merged, closed, or edited; no other branch created, switched to, or pushed |
| A5 | Scope split into release blockers / post-release / still-disabled capabilities | **PASS** | §F.2 lists the three buckets explicitly |
| A6 | No manufactured approval, no capability switched on | **PASS** | No provider activated, no test-mode flag changed, no env var set, no spending |

---

## B. Mandatory release gates

### B1 — Intermittent React hydration error #418

| Check | Status | Evidence |
| --- | --- | --- |
| Mechanism identified and reproduced (not suppressed) | **PASS** | Two mechanisms: (1) ~60 call sites formatting dates/numbers with the runtime locale/time zone (`1ce74cf`); (2) a client component deriving a value from the runtime clock during render, plus `toISOString()` on local midnights. `tests/unit/hydration-render-parity.test.ts` reproduces mechanism 2 exactly and asserts the historical computation *is* time-zone dependent and off by one day |
| Fix 1 — deterministic formatter used by rendered output | **PASS** | `lib/dateFormat.ts` (locale `en-KE`, zone `Africa/Nairobi`); `lib/format.ts` date/time helpers now delegate to it, so dashboard `BookingBoard`/`OrderBoard` and POS `InventoryClient`/`PurchasesClient` cannot render UTC on the server and Nairobi in the browser |
| Fix 2 — no runtime clock in the render path | **PASS** | `components/storefront/BookingClient.tsx` takes `today` (computed server-side by `nairobiCalendarDay()`) and builds chips with pure `calendarDayList()`; the same change fixes a real booking bug: in UTC+3 the old arithmetic named the day *before* the one displayed |
| Fix 3 — footer year and date inputs | **PASS** | `StorefrontShell` footer uses the Nairobi year; `RecordBoard` date inputs open on the Nairobi day |
| Enforcement so it cannot come back | **PASS** | New guards: no client component may use `toISOString().slice(0, 10)` or ambient zone getters; `lib/format.ts` may not contain `toLocaleDateString`/`toLocaleTimeString`; `ProductThemeBootScript` + `<html suppressHydrationWarning>` invariant preserved |
| Render-level parity proof | **PASS** | The real `BookingClient` renders byte-identical HTML under `TZ=UTC`, `TZ=Africa/Nairobi`, `TZ=America/Los_Angeles`, and across a simulated Nairobi-midnight boundary (fake clocks 20:59 vs 21:00 UTC) |
| Real-browser confirmation | **BLOCKED** | No Chrome/Chromium in this environment and it cannot be downloaded; there is no Playwright/Puppeteer browser gate for the dashboard in CI. This is the directive's own open item 8 |
| Hydration warning suppression anywhere | **PASS (none added)** | Only the pre-existing `<html suppressHydrationWarning>` for the pre-paint theme script, which is unchanged and guarded by test |

### B2 — Subscription payment failure at `tests/prisma/subscription-payment.test.ts:87`

| Check | Status | Evidence |
| --- | --- | --- |
| Root cause found | **PASS** | `activateSubscriptionForPayment` refused any payment whose stored state was not `PENDING`, so a provider-confirmed success that arrived after a local FAILED/CANCELLED/EXPIRED record never settled — the customer paid and got nothing |
| Fix | **PASS** | `lib/paymentVerification.ts` holds the single settleable rule (`SETTLEABLE_PAYMENT_STATES`, `isSettleablePaymentStatus`); `lib/paystack.ts` settles any settleable state, refuses `PAYMENT_NOT_SETTLEABLE` outside it (REFUNDED is never revivable), requires verified provider evidence (`PAYMENT_EVIDENCE_REQUIRED`) for anything other than PENDING, writes through a compare-and-set inside one transaction, and records `settledFrom` in the audit metadata. `lib/pos/settlement.ts` and `lib/experience/payments.ts` share the same rule |
| Verify route | **PASS** | Stored settleable states are re-checked with Paystack instead of being repeated back; REFUNDED and other terminal states are reported as stored; the dev mock path is PENDING-only; a still-failing provider verdict leaves the payment failed |
| Entitlement/authorization weakened? | **PASS (no)** | Nothing was relaxed: webhook signature verification, idempotency (`processedWebhook`), evidence validation (reference/amount/currency/id), tenant guards and plan checks are untouched; the settlement gate gained a test, not lost one |
| The reported gap test | **PASS (tightened)** | `it.fails("KNOWN GAP …")` became a real test asserting 200 + PAID + 1 subscription; two characterization tests now assert the corrected behaviour; one new test pins "a provider verdict that is still a failure changes nothing". No test was skipped, deleted, or downgraded |
| Behavioural coverage without a database | **PASS** | `tests/integration/subscription-payment-revival.test.ts` — 12 tests: FAILED/EXPIRED/CANCELLED revival, PENDING regression, the evidence gate, webhook idempotency, no double-extend, REFUNDED refusal, context/currency/plan refusals, POS revival isolated from AFTERCALL |
| PostgreSQL-backed confirmation | **BLOCKED** | No `DATABASE_URL` and no Prisma query engine here, so `tests/prisma/subscription-payment.test.ts` self-skips (5 tests). CI (`.github/workflows/interactive-business-e2e.yml`) runs it against Postgres 16 and fails if anything is skipped — it needs the branch to be pushed, which requires owner authorization. Reported as BLOCKED, not PASS |

### B3 — Dependency-security gate

| Check | Status | Evidence |
| --- | --- | --- |
| Named chain (extract-zip / @puppeteer/browsers / puppeteer-core) closed | **PASS** | `puppeteer-core` ^23.11.1 → ^25.13.0 removes `extract-zip`, `proxy-agent`, `basic-ftp`, `get-uri` and the old `@puppeteer/browsers`; the only consumer (`scripts/browser/immersive-preview.check.mjs`) was audited first — all 13 Puppeteer members it calls exist in the 25.x type surface and the module loads |
| Production advisories | **PASS** | `npm audit --omit=dev` → **0 vulnerabilities** (was 1 high `source-map-js` + 1 moderate `next`). `next` 15.5.26 → 15.5.27 and matching `eslint-config-next`, both patch-level |
| Whole-tree count | **PASS (improved)** | 16 high + 3 moderate (19) → **7 high + 2 moderate (9)**; no critical before or after. Also fixed by in-range overrides: `source-map-js` 1.2.2, `brace-expansion` 1.1.21 (minimatch<4) and 5.0.12 (minimatch≥9) |
| Residual advisories | **BLOCKED (upstream)** | The remaining 9 are dev-only and all sit in the Tailwind 3 build/watch chain (`braces` — **every published version is affected and 3.0.3 is the latest**, via `chokidar`/`micromatch`/`fast-glob`, plus `postcss-nested`/`postcss-selector-parser`) and `eslint-config-next`'s `fast-glob`. They are not reachable from untrusted input (exploitation needs attacker-controlled glob patterns inside the developer's own build). Their only published fix is `tailwindcss@4`, a major framework change = owner decision. Recorded, not suppressed and not misclassified |
| Lockfile integrity | **PASS** | `npm install` only; no lockfile replacement, no `--force`, no `--legacy-peer-deps`; every override pins a version inside the parent's declared range |

### B4 — Production payment-provider readiness

| Check | Status | Evidence |
| --- | --- | --- |
| Webhook authenticity | **PASS** | HMAC-SHA512 over the raw body with a timing-safe compare (`verifyWebhookSignature`); unsigned/invalid events are rejected 401 and audited (`WEBHOOK_SIGNATURE_FAILED`) |
| Idempotency | **PASS** | `processedWebhook` claimed inside the same transaction as the state change; replays return `already_processed`/`already_paid` and never extend a subscription twice (tested) |
| Evidence validation | **PASS** | Reference, amount, currency and provider transaction id must match the stored payment before any settlement; mismatches are audited and refused |
| Failure/retry semantics | **PASS** | Unprocessable signed events return 503 so Paystack retries; unknown references are acknowledged once and audited; `charge.failed` only marks a PENDING payment failed |
| Refunds | **PASS** | Full refund → `REFUNDED` + subscription suspension (POS refund suspends POS entitlement/configuration and leaves the AFTERCALL plan alone); partial refunds are acknowledged once with a durable manual-review audit instead of a silent full refund |
| Readiness honesty | **PASS** | `lib/payments/config.ts` is the only reader of connector credentials, reports `ready/mode/missing` without ever returning a secret, and keeps merchant capability at "payment instructions" when keys are absent; `readTestMode()` only enables test mode when no live connector is configured |
| Secrets in the browser | **PASS** | The "no `--ui-`/competing token vocabulary" and client-bundle checks pass; `PAYSTACK_SECRET_KEY` is read only in server modules (`lib/paystack.ts`, `lib/payments/config.ts`) and never sent to a client |
| Live readiness in the production deployment | **BLOCKED** | This environment has no keys, so it can only report `mode: NONE` / test mode. Owner action: confirm in Vercel that `PAYSTACK_SECRET_KEY` is an `sk_live_…` key, `PAYSTACK_PUBLIC_KEY` is set, the dashboard webhook points at `https://<PUBLIC_BASE_URL>/api/paystack/webhook`, and `JATA_PAYMENTS_TEST_MODE` is `off` (or absent with a live key present) |
| End-to-end live charge against Paystack | **NOT TESTED** | Requires owner authorization (spending + production credentials). The test-mode journey runs in CI without a secret via the app's own test-settlement branch |

### B5 — Environment, secrets, monitoring, rollback

| Check | Status | Evidence |
| --- | --- | --- |
| Environment template completeness | **PASS** | `.env.example` documents every variable the code reads (database, auth, Paystack, admin, AI providers), including which are optional and what the fallback is |
| Migrations gated at build | **PASS** | `scripts/build.sh` → `scripts/migrate.sh`: with `DATABASE_URL` present, `prisma migrate deploy` failure aborts the build; without it, the gate is skipped and says so |
| Health/monitoring surface | **PASS** | `/health` probes the real database and reports `db: "up" | "down"`; without a database it reports `degraded`/`unconfigured` instead of trusting the offline stub. Every payment path writes an audit event (signature failures, unknown references, mismatches, settlement, refunds, partial-refund review) |
| Rollback plan documented and rehearsable | **PASS** | `DEPLOYMENT.md` §Rollback (Vercel instant rollback, or `git revert <commit> && git push`); per-artifact rollback in §F.3. No migration was added by this release, so a code rollback needs no database rollback |
| Secret leakage in logs/requests | **PASS** | No secret is logged or echoed; migration script captures output without printing the URL; connector readiness never returns the key |
| Real Vercel environment inspected / alerting configured | **NOT TESTED** | Requires owner authorization; not attempted |

### B6 — Database migration compatibility

| Check | Status | Evidence |
| --- | --- | --- |
| Destructive statements | **PASS (none)** | 16 migrations scanned: **zero** `DROP TABLE` / `DROP COLUMN`, zero column type changes, zero data-bearing renames |
| Additive/expand-contract discipline | **PASS** | New tables, indexes and constraints; columns added with `IF NOT EXISTS`; the only backfill is guarded and idempotent (`UPDATE "Service" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL` before `SET NOT NULL`) |
| Schema ↔ migration drift | **PASS (static)** | All 73 models in `prisma/schema.prisma` have a `CREATE TABLE` in the migration set |
| Migration needed for this release? | **PASS (none required)** | The payment, hydration and design-system changes add no schema object |
| `prisma migrate status` / `migrate diff` against a real database | **BLOCKED** | Both need the Prisma query/migration engines, which cannot be downloaded here (`binaries.prisma.sh` unreachable), and a database. CI runs `prisma migrate deploy` on Postgres 16 for every pull request and push to `main`, which is where this becomes a real PASS |

---

## C. Global UX/UI and the design system (P0)

| Check | Status | Evidence |
| --- | --- | --- |
| `motion`, `lucide-react`, `recharts`, `sonner`, `@tanstack/react-table` installed where justified | **PASS** | motion 14.2.0 (`motion/react`), lucide-react 1.56.0, recharts 3.10.1, sonner 2.0.8, @tanstack/react-table 9.3.1; each has a consumer in `components/ui/*` or the dashboard shell, and each is imported only where used (recharts lazily from the dashboard) |
| `npx shadcn@latest init` evaluated | **PASS (evaluated, not run)** | Cannot reach the registry hosts from this environment; running it would also introduce a second style vocabulary next to the existing `.jata-*` tokens. Shared primitives were written on the existing token system instead. No shadcn success is claimed |
| `npx v0 add <generation-id>` evaluated | **PASS (evaluated, not run)** | No real, verified generation id exists for this project and the placeholder must never be used, so it was not run. No v0 success is claimed |
| One enforceable design system, in code | **PASS** | `lib/designSystem.ts` (machine-readable contract: platform tokens, product foundation tokens, required states, template contract, audits) + the token layer in `app/globals.css` + `components/ui/{Button,Card,Metric,StatusPill,PageHeader,StateBlocks,ErrorState,Reveal,DataTable,AnalyticsChart,Toaster}.tsx`; 30 source-guard assertions enforce it (`tests/unit/design-system.test.ts` and friends) |
| Interaction and accessibility standards | **PASS** | Required interaction states (hover, focus-visible, pressed, disabled, loading, empty, error, success) asserted; focus-visible ring, ≥44px touch targets in generated products, reduced-motion handling, `aria-current` navigation, one `main` landmark, one toast surface, loading/error/empty states for the dashboard shell |
| Dashboard as the first-class rollout target | **PASS (code + tests)** | Dashboard shell, overview (metrics, response chart, sortable comparison table, per-business cards, exactly one next step per business, status pills), plus `app/dashboard/loading.tsx` and `app/dashboard/error.tsx`; test-enforced that business status renders through the shared pill and never a raw enum |
| Website Studio products inherit the design system through the real renderer | **PASS** | The Theme Engine (`lib/experience/themes.ts#themeCss`) emits the shared foundation for every theme and category, and `tests/unit/published-product-design-system.test.ts` renders the actual product page (`ExperienceSite`, the component `app/b/[slug]/page.tsx` renders after publish) for **16 categories × 48 themes = 768 published products**, asserting the contract root class, every foundation token, one main landmark, no undescribed images, and category-specific routes |
| Token reconciliation (`lib/productThemes.ts`) | **PASS** | The two product themes had drifted (Lime Spark missing `--color-brand-secondary`, Emerald Ink missing `--color-brand-structure`, so those `var()`s resolved empty). `PRODUCT_THEME_TOKENS` (25 tokens) is now the single contract and each theme's map is typed against it, so drift fails the typecheck |
| Visual/browser review and bundle-budget measurement | **NOT TESTED** | No browser here. `npx next build` succeeds with 103 kB shared first-load JS (dashboard routes 106–116 kB), but no performance budget was asserted and no human review of the rendered UI happened |

---

## D. Package rollout verification

| Package | Status | Evidence |
| --- | --- | --- |
| Dashboard | **PASS (code/tests)**, browser **NOT TESTED** | Rebuilt on the shared primitives; design-system tests assert the shell, states, pills and one notification surface |
| Website Studio | **PASS (offline)**, e2e **BLOCKED** | 768 rendered products verified; draft/publish lifecycle, version guard and entitlement gating covered by `tests/e2e/interactive-business-journey.test.ts`, which runs against Postgres in CI and is skipped here (no database) |
| POS | **PASS (offline)**, e2e **BLOCKED** | POS navigation/tabs on the shared token and icon language; POS payment settlement shares the settleable rule and its revival/isolation is tested; `tests/e2e/business-pos-journey.test.ts` needs the database (CI) |
| Subscriptions / payments | **PASS** | Gate B2; refunds, wallet and POS suspension paths unchanged and covered |
| Analytics | **PASS (code)** | Shared `AnalyticsChart` (recharts) lazily loaded from the dashboard; the privacy-preserving beacon is unchanged |
| Auth / onboarding | **PASS (tests)** | Login and onboarding asserted to use the shared Field/Button form language |
| Shared modules | **PASS** | `lib/dateFormat.ts`, `lib/statusLabels.ts`, `lib/nextAction.ts` are the only homes for their concerns; no competing token or formatter vocabulary exists (test-enforced) |
| AI Front Desk | **PASS (code/tests)**, Postgres-backed entitlement suite **BLOCKED** | `tests/integration/ai-front-desk-entitlement-postgres.test.ts` (5 tests) needs a database and runs in CI |

---

## E. Verification ledger

### E.1 Commands and results at `f27e07f`

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 (clean) |
| `npx vitest run` | **151 passed \| 10 skipped files (161); 1794 passed \| 95 skipped tests (1889)** |
| `npx next lint` | 0 errors; 1 pre-existing warning (`components/storefront/CartProvider.tsx:210`, next/image) |
| `npx next build` | success at `next@15.5.27` with the new overrides; full route table, 103 kB shared first-load JS |
| `npm audit` / `npm audit --omit=dev` | 9 (7 high, 2 moderate) / **0** |
| Baseline for comparison | at `77e35ce`: 146 files, 1740 tests; at `1ce74cf`: 148 files, 1768 tests |
| Tests added this session | 25: payments 12, hydration parity 10, published-product design system 3 |

### E.2 Skipped tests — every one, and why

All skips are the same environmental cause: no `DATABASE_URL` and no Prisma query engine in this
environment (95 tests). The CI workflow runs them against Postgres 16 and **fails if anything is
skipped**, so a green CI check is the authoritative result.

| File | Skipped | Reason |
| --- | --- | --- |
| `tests/e2e/interactive-business-journey.test.ts` | 17 of 18 | Needs a migrated, seeded Postgres (1 always-on test states this) |
| `tests/e2e/business-pos-journey.test.ts` | 22 | Same |
| `tests/prisma/storefront-checkout.test.ts` | 15 | Same |
| `tests/prisma/payment-settlement.test.ts` | 12 | Same |
| `tests/prisma/checkout-commit.test.ts` | 6 | Same |
| `tests/prisma/schema-constraints.test.ts` | 6 | Same |
| `tests/prisma/subscription-payment.test.ts` | 5 (incl. the line-87 test) | Same |
| `tests/integration/ai-front-desk-entitlement-postgres.test.ts` | 5 | Same |
| `tests/integration/payment-wallet-refunds-postgres.test.ts` | 4 | Same |
| `tests/integration/payment-wallet-stk-receipt-postgres.test.ts` | 2 | Same |
| `tests/integration/pos-refund-race-postgres.test.ts` | 1 | Same |

### E.3 Other environmental blocks (not test skips)

- `npx prisma validate` / `generate` / `migrate`: migration and query engines cannot be downloaded (`binaries.prisma.sh` unreachable). The generated client in `node_modules` is present, which is why typecheck and the suite run.
- Real-browser checks (hydration #418, dashboard and storefront visuals, immersive preview): no Chrome/Chromium and it cannot be downloaded; `npm run test:browser:immersive` requires `CHROME_PATH` and exits 2 without it.
- Live payment provider, Vercel environment inspection, deployment, and any production data operation: not authorized, therefore not performed.

### E.4 CI status

- This branch is **not pushed**, so no CI has run on `f27e07f`. Pushing is an owner-authorized action.
- Existing open PRs are untouched by this work: #44 (draft), #42 (open; its database job is currently failing), #41 (draft), #20, #16.

---

## F. Release decision

### F.1 Status: **BLOCKED** (not yet READY FOR OWNER APPROVAL)

All work that this environment and the standing authorizations permit is complete and green. The
remaining items cannot be resolved from inside the sandbox, and none of them may be assumed:

1. **Database-backed verification** — the 95 skipped tests, including the line-87 test itself, must run once on these SHAs. Requires pushing the branch so CI (`.github/workflows/interactive-business-e2e.yml`) applies migrations to Postgres 16, seeds, and runs the full suite + both journeys.
2. **Real-browser confirmation of the hydration fix** — needs a Chrome/Chromium gate, or a manual pass by the owner on a deployed preview. The render-level parity proof is strong evidence but is not a browser.
3. **Production payment-provider readiness** — owner must confirm the live Paystack key, public key, webhook URL and test-mode flag in Vercel (checklist in B4). Readiness can only report `NONE` from this environment.
4. **Owner decision on the 9 residual dev-only advisories** — closing them means migrating `tailwindcss` 3 → 4 (major, architecture-level) and waiting on an upstream `braces` release that does not exist. Recommendation: request the Tailwind 4 migration as a separate, reviewed task; do not block this release on it, since production dependencies are at zero.
5. **Pre-existing owner decisions still open from earlier reports** — `RELEASE_BLOCKERS.md` items 6 (binary media storage in Neon) and 7 (sale-price rule conflict) are unchanged by this work and remain owner decisions.

Nothing in this release fails a gate that was in scope. The blocker is verification authority, not a
known defect.

### F.2 Scope buckets

- **Release blockers (all closed in code):** hydration #418 mechanisms and their enforcement; the subscription-payment settlement gap; the named dependency chain; production advisories; the migration-compatibility audit.
- **Post-release improvements:** Tailwind 4 migration (closes the residual dev advisories); browser-based visual/performance budget in CI; a reconciliation sweep for `PENDING` payments older than the provider's retry window.
- **Capabilities that must remain disabled:** live payment providers are not switched on by this work; test mode stays under the deployment's explicit control; no provider, storage backend or AI vendor was activated; `JATA_PAYMENTS_TEST_MODE` was not changed.

### F.3 Rollback plan

| Layer | Action | Effect |
| --- | --- | --- |
| Individual change | `git revert <sha>` for any of `730c0c8` (payments), `ac3381d` (hydration), `b849b70` (dependencies), `f27e07f` (design system) | Each commit is independent; reverting one does not touch the others |
| Whole release | Deploy the previous Vercel deployment (Vercel → Deployments → Rollback), or `git revert` the branch tip | Instant, no database action needed |
| Database | **Nothing to roll back** — this release adds no migration and no schema change | Migrations applied by CI to a test database are unaffected |
| Dependencies | `git revert b849b70` restores `next@15.5.26`, `puppeteer-core@^23.11.1` and the old overrides | Also restores the 19 advisories; use only if the bump is found to break tooling |
| Detection | `/health` (`db: up/down`), audit events (`WEBHOOK_SIGNATURE_FAILED`, `WEBHOOK_UNKNOWN_REFERENCE`, `WEBHOOK_TRANSACTION_MISMATCH`, `WEBHOOK_PARTIAL_REFUND_REVIEW_REQUIRED`, `SUBSCRIPTION_ACTIVATED`) | Payment and database regressions are visible without a code change |

### F.4 Owner actions required to move from BLOCKED to READY

1. Authorize the push of `arena/fac28f53-jata-aftercall` and the opening of a pull request against `main`.
2. Let CI run the database-backed suites and both journeys; attach the run URL to the approval record.
3. Run (or authorize) one browser pass over a Vercel preview: dashboard, a published product, and the booking flow (the #418 gate).
4. Confirm the production payment environment (B4 checklist) — no agent action required, but the gate cannot close without it.
5. Decide on the two standing owner items (media storage, sale-price rule) and on whether to schedule the Tailwind 4 migration.

### F.5 Authorization and non-actions record

- The test at `tests/prisma/subscription-payment.test.ts:87` was **tightened, not weakened** (a known-gap `it.fails` became a real assertion; two characterization tests moved to the corrected contract; one new refusal test added). No test was skipped, deleted, or made lenient to obtain a green run.
- No hydration error was suppressed, no SSR/hydration validation was weakened, and no framework internals were patched.
- No dependency advisory was suppressed, ignored, or reclassified; the residual set is stated with its reachability analysis.
- No push, merge, deploy, migration, env change, provider activation, or production data operation was performed.
