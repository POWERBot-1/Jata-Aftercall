# Whole-platform remediation — batch 1 (2026-11-17)

**Branch:** `arena/a3de1985-jata-aftercall`, branched from main/Production `09a4aa059b227f8fbb9dbece6faaa0fd32fe91e7`.
**Inputs reconciled:** PR #125 head `ed3d561` (fast-forwarded), PR #117 `eb7d507` (merged), PR #112 `3214fc5` (merged with fixes), and the 2026-11-17 whole-platform assessment (`WHOLE_PLATFORM_ASSESSMENT_AND_REMEDIATION_PLAN_2026-11-17.md`).
**Release verdict: NOT READY.** Nothing here was deployed or merged to `main`. No Production env, DB, DNS, payment credential or customer record was read for mutation or changed. `CONTROL_ROLE_ACCESS_ENABLED` stays `false`, and the 90-cell Control DENY matrix is unchanged.

Status vocabulary follows RELEASE-001. Finding status is PENDING / IN PROGRESS / BLOCKED / IMPLEMENTED / VERIFIED. Evidence is PASS / FAIL / BLOCKED / NOT TESTED. "Local" means this sandbox: no Docker, no Prisma engine download, and Chromium 153 for diagnosis only. Local results are not CI evidence, and CI evidence comes from the exact-head PR run.

## 1. Traceability matrix (finding → root cause → fix → regression test → evidence)

| ID | Pri | Finding / source | Root cause | Fix (commit) | Regression test | Evidence | Status |
|---|---|---|---|---|---|---|---|
| R-OTP-01 | P0 | PG18 `agent-applications-postgres` OTP race assertion failed on PR #125 CI | Under READ COMMITTED, two concurrent correct submissions both read the pre-verification row, so the loser reported a failure instead of `already` | `settled()` re-reads the committed application (`2fbe9aa`) | `tests/unit/agent-phone-verification-race.test.ts` (4) — fails without the fix | Local PASS. **CI PASS** on PG18 (`358afc0`, release-validation run 44193862666; the suite step rejects skipped tests) | IMPLEMENTED |
| R-MAN-01 | P0 | Static step 10 failed: evidence manifest MISMATCH | `PROGRAMME_READINESS.json` was edited after the manifest was generated | Manifest regenerated as the last step. The verifier is unchanged | `scripts/__tests__/verify-evidence-manifest.test.mjs` (existing) | **CI PASS**: Static step (run 44193862666) | IMPLEMENTED |
| R-CAP-01 | P1 | Motion capture `BLOCKED TimeoutError 12000ms` (route-behaviour-evidence.mjs:205); the 12 constrained rows never ran | (a) The fixture renders **17** targets, but the harness hard-coded 18. (b) Playback is visibility-gated, and viewport-relative sections left only 2–5 targets in view, so ≥8 played was impossible. (c) The harness counted Web Animations (~2 per element), while the controller bounds concurrent **elements** (`MAX_ACTIVE_REVEALS = 8`) | Dev-only compact layout puts every stress target in view. The harness reads N from the DOM (N > 8 required) and requires exactly 8 started and N−8 queued early, all N complete, and max 8 concurrently animating elements (`51d9d37`). The gate is not weakened | The harness itself is the browser regression | Local Chromium 3/3 PASS: 17 targets, 8 started, 9 queued, maxActive 8, maxAnimations 16. **CI PASS** in Chrome 157 with identical numbers; `initialConstraintRowsPass: true`; 48/48 rows (motion-evidence run 44193862679) | IMPLEMENTED |
| R-WS-01 | P1 | **New, found by inspecting rendered pixels:** editorial and cardless-immersive section headings invisible on dark themes (measured 1.1:1 on Graphite) at all 6 viewports, motion and reduced | `276756e` hard-coded `rgb(26 26 26)` ink, assuming those sections paint on white. They are transparent and paint on `--eb-bg` | Use `var(--eb-heading)`, which `themeCss()` already contrast-corrects against `--eb-bg` (`ab4d905`) | `tests/unit/storefront-contrast-and-specificity.test.ts`: token used, no fixed ink, and every theme (light and dark) clears AA. Fails without the fix (2) | Local Chromium sweep: 20 families × 6 viewports × motion/reduced = 240 renders. 30 flagged before the fix (all this defect), 0 after for the affected families | IMPLEMENTED |
| R-MJ-01 | P1 | #115: MJENGO settlement used nonexistent `Payment.planKey`; storage shared with ERP | See #112 | #112's isolated MJENGO/ERP PRO tables (merge `b0cd8dc`) | `mjengo-settlement` (19), `mjengo-storage-isolation`, `mjengo-feature-flag` | Local PASS. **CI PASS**: POS/ERP Migrations and PostgreSQL suite (run 44193862727) | IMPLEMENTED |
| R-MJ-02 | P0 | #112 migration `20261112090000` would sort before 15 applied production migrations | Timestamp predates the applied history | Renamed to `20261202000000_mjengo_isolated_entitlements` (after #116's n8n migrations) (`b0cd8dc`). The re-runnable `IF NOT EXISTS` DDL required by `migration-verify.sh` is kept, plus a shape guard that aborts the deploy if a same-named existing table lacks a column or a unique `businessId` index. A first attempt at plain DDL failed CI's re-run gate (PR #126 run 44190973120) and was corrected | `repair-guards`, `mjengo-storage-isolation` (pins IF NOT EXISTS, the guard and its position) | PGlite (Postgres WASM): apply + re-apply OK, correct backfill routing, wrong shape aborts, duplicate businessId aborts with rows preserved. **CI PASS**: re-run gate (run 44193862727), PG18 migrations + idempotent re-deploy (run 44193862666), exact-candidate rehearsal and backup/restore (run 44193862594) | IMPLEMENTED |
| R-MJ-03 | P1 | Journey (a): `/login?next=/dashboard/mjengo` dropped the destination | Login used a two-entry allowlist without MJENGO; register ignored `next` | `lib/post-auth-destination.ts` exact-token allowlist with open-redirect protection, carried across login⇄register (`713f750`). Repeated `next` refused (`6b45b45`) | `mjengo-customer-journey` (14), `tests/security/agent-login-redirect` | Local PASS | IMPLEMENTED |
| R-MJ-04 | P1 | Journey (b): NONE/CANCELLED/EXPIRED got 403, a dead end because checkout is offered only on 402 | Denial status ignored `nextAction` | `mjengoDenialStatus`: pay/renew/setup → 402; SUSPENDED/pending → 403, so no second checkout (`b75da0a`) | `mjengo-customer-journey`, `mjengo-branding-and-journal` | Local PASS | IMPLEMENTED |
| R-MJ-05 | P1 | Journey (c): every business reported as "configured" | `findUnique(...).then(() => true)` is true even when the row is `null` | `hasMjengoConfiguration` returns `Boolean(row)` and fails closed (`d982863`) | `mjengo-configured-lifecycle` (5) — 3 fail without the fix | Local PASS | IMPLEMENTED |
| R-MJ-06 | P1 | Journey (d): multi-business picker showed raw ids | Rendered ids only | Tenant-scoped `findMany` of the owner's businesses; names shown (`713f750`) | `mjengo-customer-journey` source check | Local PASS | IMPLEMENTED |
| R-MJ-07 | P0 | Journey (e): journal/branding APIs checked ownership only, not entitlement | Ownership was treated as entitlement | `assertMjengoEntitled` after the ownership check on journal POST/GET and branding POST (`b75da0a`) | `mjengo-branding-and-journal` (+6) | Local PASS | IMPLEMENTED |
| R-DEP-01 | P0 | Audit: 7 moderate + 11 high (main) | `next` advisory; old typescript-eslint pinned minimatch <11 through a forced override | next 16.4.6 (from #125); typescript-eslint 8.73.0 → minimatch 11.0.9 natively; forced `minimatch@>=7 <11` override **removed** (`e08e585`) | `npm audit` in release-validation | Full tree: **0 moderate, 16 high**. `--omit=dev`: **0** | IMPLEMENTED |
| R-DEP-02 | P0 | Historical 16 high findings attributed to GHSA-fc5q-39xc-vjpf picomatch ≤4.0.7 | GitHub withdrew the advisory on 2026-11-18, stating it is not a security issue. Exact-head lockfile contains picomatch 2.3.2 and 4.0.7 only as dev dependencies; no forced picomatch override. | Release Validation run 44742454584: `npm audit --omit=dev` exit 0; `npm audit` exit 0; summarizer reports 0 production and 0 full-tree findings. | No suppression, override, downgrade or lockfile workaround. | RESOLVED — advisory withdrawn; audits clean |
| R-CI-01 | P1 | `programme-completeness` red on every head | 21 programme requirements BLOCKED (owner/external) and 3 NOT_TESTED (MOTION-003/004/005) | None, by design: the gate fails closed and is not weakened | `node scripts/admin/check-programme-readiness.mjs` → `NOT READY (24)`, exit 1 | Same result locally and in CI at `4da71bc`, `6f79353`, `1244caf` and `66d8b08` (§7) | BLOCKED |
| R-MJ-08 | P1 | **New, found by the real-DB journey test:** a refunded MJENGO workspace got 402 and a second checkout, not SUSPENDED 403 | `deriveMjengoEntitlement` evaluated the unpaid branch before SUSPENDED. A full refund moves the payment PAID → REFUNDED and suspends both MJENGO rows, so no PAID evidence remained and SUSPENDED was unreachable | SUSPENDED is decided before payment evidence in `lib/mjengo/entitlement.ts` (`0e666c1`) | `tests/prisma/mjengo-journey-postgres.test.ts` (11; real checkout route + real HMAC webhook; only Paystack HTTP, DB handle and session mocked) — 10/11 before the fix; `mjengo-customer-journey` (+1) | Local PGlite 11/11. **CI PASS** on PostgreSQL 18 ("Migrations + schema on PostgreSQL 18"; `check-test-output.mjs` rejects skipped tests, so a pass proves it executed) at `6f79353`, `1244caf`, `66d8b08` | IMPLEMENTED |
| R-MJ-09 | P1 | Public "Get MJENGO OS" hero CTA sent signed-in owners to `/dashboard/subscription` (which never sells MJENGO OS) and signed-out visitors to a bare `/login` | CTA target hard-coded per auth state | Every CTA uses one entry (`eedacca`; target moved to `/mjengo` by R-MJ-11 in `66d8b08`) | `tests/unit/mjengo-public-cta.test.tsx` (rendered markup, signed in/out/refused plan) | Local PASS. Incomplete in a real browser until R-MJ-11 | IMPLEMENTED |
| R-MJ-10 | P1 | No authenticated browser evidence for the MJENGO journey (§3 said NOT TESTED) | No browser check existed | `scripts/browser/mjengo-authenticated.check.mjs` + guard + Premium Screenshots step (`6f79353`, wait fix `1244caf`, `/mjengo` entry `66d8b08`). Pay is never pressed; the paid state is written only into the disposable CI DB, and the script says so | `tests/unit/mjengo-browser-guard.test.ts` (14: guard refusals, guard before PrismaClient, no pay API, workflow step present) | **CI PASS** at `66d8b08` (run 44249281884, job 134615718227, step 16 success). Failed at `6f79353` (script timing) and at `1244caf`, where it found R-MJ-11 | IMPLEMENTED |
| R-MJ-11 | P1 | **New, found by R-MJ-10 in real Chrome** (run 44247022065): signed-out visitors clicking "Get MJENGO OS" settled on `/login` with no `next`, so sign-in lost MJENGO | `app/dashboard/layout.tsx` redirects every signed-out `/dashboard/*` request to a bare `/login` before the child page runs; a layout cannot see the child path, so the page's `/login?next=mjengo` never won. Page-only unit tests could not see it | Public entry `app/mjengo/page.tsx` outside the dashboard layout (signed out → `/login?next=mjengo`, signed in → `/dashboard/mjengo`); all public CTAs point to it. `proxy.ts` (matcher `/dashboard/mjengo*` only, no DB) redirects cookie-less deep links to `/login?next=mjengo`; any cookie passes through unchanged (`66d8b08`) | `tests/unit/mjengo-entry-route.test.ts` (6: entry both states, proxy redirect/pass-through/matcher/cookie name); 4 tests fail on the previous CTA targets | Local: full unit suite 294 files / 3,377 PASS; `next build --webpack` lists `ƒ /mjengo` and `ƒ Proxy (Middleware)`; `next start` curl: `/mjengo`, `/dashboard/mjengo`, `/dashboard/mjengo/biz_1` → 307 `/login?next=mjengo`, `/dashboard` unchanged. **CI PASS** in real Chrome (soft CTA + three hard navigations) at `66d8b08` | IMPLEMENTED |

## 1a. Exact-head CI and release acceptance (deliverable 10) — `358afc0f52e6a7a6bd24c7bf5ed53a3610f6cf69`

Draft PR #126 (not merged). **21 checks PASS, 0 FAIL on technical gates.** They include:
- Static (install, generate, lint, typecheck, audit);
- PG18 migrations, idempotent re-deploy, and the full suite against PostgreSQL 18;
- exact-candidate rehearsal and full logical backup/restore on PG18;
- journey against a real database;
- POS/ERP migrations and PostgreSQL suite;
- real-Chrome six-viewport capture;
- motion `capture` (48/48);
- full-suite, instruction-integrity, Voice and Release gate (aggregate).

Two checks are red, and neither is a code defect:
- `programme-completeness`: fail-closed by design while 21 requirements are BLOCKED and 3 NOT_TESTED. It is not weakened.
- Vercel Preview: the fail-closed preview-isolation guard refused to build because this branch has no branch-scoped Preview env (isolated staging DB URLs, auth secrets, base URLs). **Owner action:** scope the existing Preview-only staging variables to this branch in Vercel. The agent did not copy secrets.

Artifacts were uploaded but could not be downloaded into the agent sandbox (storage egress), so independent pixel review of CI artifacts is still outstanding.

## 2. Security and dependency audit (deliverable 4)

- Production dependency audit (`npm audit --omit=dev`): **0 vulnerabilities** on PR #126 exact head `651a40b9a3c96444a6b53b3599227a268f9aea00`.
- Full tree audit (`npm audit`): **0 vulnerabilities** on the same exact head. GitHub withdrew GHSA-fc5q-39xc-vjpf on 2026-11-18, explicitly stating that it is not a security issue. The lockfile retains transitive picomatch 2.3.2 and 4.0.7 only under `dev: true`; no direct production dependency or unsafe override was introduced. Release Validation run `44742454584`, job `136309375507`, records both audit commands exiting 0 and the summarizer reporting zero findings. No suppression, downgrade, arbitrary override or lockfile workaround was used.
- Open-redirect hardening: post-auth destinations accept exact tokens only. Arbitrary URLs, protocol-relative URLs, traversal, query-suffixed values, `__proto__`/`constructor`, and repeated parameters all resolve to `/dashboard`.
- Not done in this batch (still P0 and open): the full two-tenant authorization matrix on PostgreSQL, the Paystack Preview sandbox suite (signature, idempotency, concurrency, out-of-order, refund, subscription, POS entitlement, reconciliation), and ledger idempotency proof. PR #125 recorded a sandbox journey PASS; the remaining cases are NOT TESTED.

## 3. Product journey (deliverable 6) — MJENGO OS

Public page `/products/mjengo-os` → CTA `/dashboard/mjengo` → unauthenticated `/login?next=mjengo` → sign-in or registration preserves the destination → picker by business name → `[businessId]` gate:

- no entitlement → 402, and checkout is offered at KES 2,000 / 30 days;
- PAID but pending, or SUSPENDED → 403, with no second checkout;
- entitled → workspace;
- APIs enforce the same entitlement.

Pricing is unchanged: Business Page KES 149/30d and KES 999/365d, Business POS KES 499/30d, MJENGO OS KES 2,000/30d. MJENGO keeps its own identity and tables and is not merged with POS. Evidence: unit and source tests PASS locally. A browser journey with a real session and DB is **NOT TESTED** in this batch.

**Update (batch 2, `66d8b08`):** the authenticated browser journey is now **CI PASS** (R-MJ-10, Premium Screenshots run 44249281884). The public CTAs now enter at `/mjengo`, not `/dashboard/mjengo` (R-MJ-11). The verified path is: public page `/products/mjengo-os` → hero CTA `/mjengo` → `/login?next=mjengo` → real sign-in → own workspace unpaid (402 shell, stored-plan checkout link, journal API 402, no subscription row) → checkout review renders (pay never pressed, no payment row) → ACTIVE MJENGO rows written in the disposable DB → workspace and journal/branding APIs 200 → another tenant's workspace refused without leaking its name, APIs 403. Six-viewport overflow is checked at each stage. Provider payment and webhook settlement are proven separately, on PostgreSQL 18, by `tests/prisma/mjengo-journey-postgres.test.ts`. A live Paystack payment stays **NOT TESTED**.

## 4. Website Studio visual acceptance (deliverable 8)

The local Chromium sweep covered `/dev/motion-preview` for all 20 template families × {320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768} × {motion, reduced}. Screenshots were inspected, not just counted. Checks were horizontal overflow, h1 clipping, h1/action-bar overlap, heading contrast < 3:1, and render mode.

- **Found:** R-WS-01 (above).
- **Expected and not a defect:** `minimal` renders `lite`, because the owner chose lite for that family (`owner-lite`).
- Limits: the fixture uses a single dark theme. Light themes are covered by the token-level test across every theme, not by pixels. This is local diagnosis only; CI artifacts are the acceptance evidence.

## 5. Not covered in this batch (remain open; see the register)

PG18/Neon staging migration of this head; backup/restore rehearsal against RPO ≤15 min / RTO ≤4 h (PG18 PASS on #125, Neon PITR NOT TESTED); R2 durability; DNS/TLS/mail (BLOCKED, owner); suspected test-mode production Paystack key (BLOCKED, owner, read-only); admin reporting (MRR/ARR/gross/refunds/net) acceptance; commission accrual (disabled, with rates NOT CONFIGURED pending the owner's numeric policy); the remaining 16-item test programme; and modules beyond MJENGO, Website Studio, motion and agents.

## 6. External blockers and owner actions (deliverable 11)

1. picomatch GHSA-fc5q-39xc-vjpf: **closed as withdrawn by GitHub on 2026-11-18**; exact-head production and full npm audits both return zero findings. No override or replacement tooling required.
2. Production Paystack key mode: owner to confirm the live key through read-only inspection.
3. DNS/TLS/mail for `jataaftercall.co.ke`: owner to obtain authoritative records from the registrar or host.
4. Commission policy: owner to supply numeric rates and payout terms before accrual or payout is enabled.
5. Release authorization: separate and explicit. This branch must not be merged or deployed to Production without it.

## 7. Batch 2 — MJENGO real-database and real-browser evidence (2026-11-17/18)

Heads in order: `4da71bc` → `0e666c1` (R-MJ-08) → `eedacca` (R-MJ-09) → `6f79353` (R-MJ-10) → `1244caf` (browser wait fix) → `66d8b08` (R-MJ-11). This report update is a later docs-only commit, so its own head's CI is recorded in the PR, not here.

**Local engine vs CI engine.** Locally, the Prisma suite ran on PGlite (Postgres compiled to WASM) through the driver-adapter WASM client with `@prisma/adapter-pg` and a single-connection pool, because the native engine download is blocked here (`docs/prisma-integration-tests.md`). That is diagnosis. CI runs the native Prisma engine against a real PostgreSQL 18 service container, and that is the evidence.

### 7.1 Exact-head CI

| Head | Pass / fail / skipped | Technical gates | Red checks | Key runs |
|---|---|---|---|---|
| `4da71bc` | 21 / 2 / 1 | all PASS | programme-completeness (R-CI-01), Vercel isolation guard | Release Validation 44196388239; screenshots 44196388132 |
| `6f79353` | 21 / 3 / 1 | **Real-Chrome FAIL**; rest PASS (PG18 suite incl. R-MJ-08 journey test, run 44245202570) | + programme-completeness, Vercel `dpl_3LbFUaCPMU7TZpSS7R9NRc3p91So` | Real-Chrome 44245202604: script read the URL at the intermediate soft-navigation history entry (`got /dashboard/mjengo`). Script defect, fixed in `1244caf` |
| `1244caf` | 21 / 3 / 1 | **Real-Chrome FAIL**; rest PASS (PG18 44247022072; Release gate PASS) | + programme-completeness 44247021966, Vercel `dpl_7AAjkcMm3wmnfzSobVbPHefpfBdG` | Real-Chrome 44247022065: `settled at /login` with no `next`. **Product defect R-MJ-11** |
| `66d8b08` | **21 / 2 / 1** | **all PASS**, including Real-Chrome (run 44249281884; MJENGO step 16 success), PG18 migrations + suite (44249282074), POS/ERP PostgreSQL suite, exact-candidate + backup/restore (44249281892), real-DB journey (44249282132), capture, full-suite, Release gate (aggregate) | programme-completeness 44249281939 (`NOT READY (24)`), Vercel `dpl_J39cDALcSaeYT1BuGwhFWy7npzp7` (`[preview-isolation] BLOCKED`: DATABASE_URL, DIRECT_URL, JATA_STAGING_DATABASE_HOST, AUTH_SECRET, NEXTAUTH_SECRET, PUBLIC_BASE_URL, NEXTAUTH_URL missing for this branch) | Evidence summary `PASS=595 FAIL=0` |

The CI job log and artifact downloads are unreachable from the agent sandbox (storage egress). The MJENGO step result comes from the Actions jobs API (per-step conclusion and head SHA). The script is linear: it throws on the first failed assertion, and the step exits with the script's own status. So a successful step means every stage listed in §3 passed.

### 7.2 Residual risks (open, not hidden)

- `proxy.ts` sees only whether a session cookie is present. A request with an expired or forged cookie passes through, and the dashboard layout then redirects it to a bare `/login`. Access is still refused, but the MJENGO destination is lost for that case. Public CTAs are unaffected because they use `/mjengo`, which checks the real session.
- Other `/dashboard/*` deep links (outside MJENGO) still lose their destination on sign-in. That is pre-existing, outside this batch, and **NOT TESTED**.

### 7.3 Still not covered (unchanged from §5)

Neon staging migration and PITR (NOT TESTED); R2 durability (NOT TESTED); the full two-tenant authorization matrix on PostgreSQL (MJENGO-only cross-tenant denial is now CI PASS; the platform-wide matrix is NOT TESTED); the Paystack Preview sandbox suite (BLOCKED on the Preview env); admin reporting acceptance (NOT TESTED); modules beyond MJENGO, Website Studio, motion and agents (NOT TESTED). **Release verdict: NOT READY.**

## 8. Batches 3–4 — return paths, two-tenant authorization, role-required writes, admin reporting (2026-11-17/18)

Heads in order: `7d36ea0` → `d36f119` (R-RT-01, R-TI-01, R-TI-02) → `18d471e` (R-ADM-01/02) → `cc33999` (R-RT-02) → `1230e3a` (R-TI-03, R-ADM-03) → `e94f2f3` (R-TI-04, MJENGO Chrome assertion) → `275e117` (return-path harness: wait for rendered content, positive refusal in E, Studio-aware cleanup). This report update is a later docs-only commit; its own CI is recorded in the PR.

### 8.1 Traceability

| ID | Pri | Finding / root cause | Change | Regression test | Commit | Environment | Status |
|---|---|---|---|---|---|---|---|
| R-RT-01 | P1 | Every `/dashboard/*` deep link lost its destination on sign-in. Causes: the dashboard layout's bare `redirect("/login")` raced page redirects, and `/dashboard/ai` used an ignored `callbackUrl`. | `proxy.ts` forwards the requested path in `x-jata-dashboard-path` (always overwritten); `lib/dashboard-login-redirect.ts` is used by every dashboard redirect; `lib/post-auth-destination.ts` accepts only `^/dashboard(/[A-Za-z0-9_-]{1,80}){1,6}$` (≤400 chars) | `dashboard-return-path` (unit), `mjengo-entry-route`, real-Chrome `dashboard-return-path.check.mjs` A–E | `d36f119` | unit local + CI; Chrome CI | **PASS** · unit + real Chrome A–E at `275e117` (run 44275702188, job 134703138252) |
| R-RT-02 | P2 | The owner AI-page preview (`/b/<slug>/ai?preview=true`) sent signed-out owners to `/login?callbackUrl=…`, which is ignored | `ai-preview:<slug>` token (slug regex as `lib/slug.ts`); the page re-checks ownership | unit + Chrome cases F/G | `cc33999` | as above | **PASS** · unit + real Chrome F/G at `275e117` (job 134703138252) |
| R-TI-01 | P0 | No platform-wide two-tenant proof | `tests/prisma/tenant-isolation-matrix-postgres.test.ts`: every app/api route handler × owner A / owner B / anonymous / guessed IDs, with row fingerprints of all 154 business-scoped tables | the test itself | `d36f119` | PG18 native engine (CI) | **PASS** — routes 187, calls 979, import errors 0; owner-A GET 2xx 80, owner B refused on 67, the rest self-scoped or public by design |
| R-TI-02 | P1 | `DELETE /api/offer` returned 500 cross-tenant (unhandled TenantError) | handled and mapped to 403 | matrix + `role-required-writes` | `d36f119` | PG18 CI | **PASS** |
| R-TI-03 | P0 | Membership-only writes. `guardTenantMutation` defaulted to the "read" level and many writes used `canAccessBusiness`/`assertBusinessOwnership` alone, so a VIEWER could `PATCH /api/business` (rename, redirect phone/WhatsApp), `POST /api/products` (201), edit the website draft and post MJENGO journals. `services DELETE` threw 500 cross-tenant. Found by the phase 3 in-tenant sweep. | the action level is now **required** (no default); new `canMemberPerform`; every write states its level: configure (catalogue, offer, services, website draft), manage_settings (settings, MJENGO branding), manage_orders (orders, bookings, preorders), operate (notifications, leads, cart, intelligence events), edit_knowledge, high_risk (manual journal) | `tests/security/role-required-writes.test.ts` (static scan of >30 write handlers, one justified allowlist entry: read-only `ai/chat` preview; behavioural `it.each` on the real guards); phase 3 of the matrix | `1230e3a` | PG18 native engine (CI run 44271000133, job 134687283429) | **PASS** — viewer-A writes 169, changed data tables none; staff-A GET 2xx 60/80; staff-A writes changed only audit/quality logs; owner-level tables unchanged |
| R-TI-04 | P1 | Server actions not swept. `bootstrapWorkspaceAction` (ERP) ran behind `WORKSPACE_READ`, held by every member including VIEWER, yet it creates the ERP configuration and re-creates default tax rules, templates and channels | requires `MANAGE_SETTINGS`, matching `saveBusinessProfileAction` | `tests/security/erp-server-action-permissions.test.ts` (58: every exported action names a permission, `WORKSPACE_READ` only on a justified allowlist, unreviewed `"use server"` files fail, behavioural run on the real ERP role matrix; 6 fail on the old code) | `e94f2f3` | unit (mocked session, real role matrix); CI full-suite | **PASS** (unit, mocked session; full-suite job 134703139488 at `275e117`). Not exercised against a real DB |
| R-ADM-01 | P1 | Admin dashboard mixed subscription revenue with customer payments, summed currencies, and showed 0 on failed reads | `lib/admin/platform-figures.ts`; subscription revenue split from customer payments; other currencies counted, never converted; failed reads show "Unavailable"; renewals = ACTIVE + EXPIRING | `admin-platform-figures` (unit) | `18d471e` | unit | IMPLEMENTED · PASS |
| R-ADM-02 | P1 | No reconciliation of admin figures against the database | SQL reconciliation of every tile | `tests/prisma/admin-reporting-reconciliation-postgres.test.ts` | `18d471e` | PGlite local; PG18 CI full-suite step success at `1230e3a` | **PASS** (job-level; per-file log unreachable from the sandbox) |
| R-ADM-03 | P1 | `syncPosEntitlement` ran on every POS request and reset `activatedAt` to now, so the admin "activated" date was wrong, and even a denied cross-tenant POS request rewrote tenant A's entitlement row | keep `activatedAt` while status is unchanged; skip the write when nothing changed | `tests/unit/pos-entitlement-sync.test.ts` (fails on old code) + matrix phase 3 | `1230e3a` | unit + PG18 CI | **PASS** |

### 8.2 Correction: real-Chrome was red from `d36f119` to `1230e3a`

The real-Chrome job failed on `d36f119` (134673736479), `18d471e` (134677501179), `cc33999` (134681015325) and `1230e3a` (run 44271000019, job 134687281971). These heads were not polled at the time, and earlier notes wrongly implied the browser evidence was intact. The cause: the MJENGO step still asserted the R-MJ-11 rule that every MJENGO path signs in via `/login?next=mjengo`, while R-RT-01 deliberately keeps the exact validated deep link (`/dashboard/mjengo/<id>` → `/login?next=/dashboard/mjengo/<id>`; already pinned in unit tests and return-path case C). The product behaved as R-RT-01 intended; the browser assertion was stale. The [businessId] layout re-checks ownership and entitlement after sign-in, so the deep link grants nothing.

Exact-head evidence after the correction:

| Head | Result | Real-Chrome | Notes |
|---|---|---|---|
| `e94f2f3` | 21 pass / 2 fail / 1 skip | **FAIL** (run 44273128170, job 134694452004) | MJENGO step PASS. The return-path step ran for the first time and failed in case A: sign-in returned to `/dashboard/businesses/<id>`, but the script read the page while the `app/dashboard/loading.tsx` `aria-busy` skeleton was still shown (harness timing). Cleanup also hit `StudioWorkspace_ownerUserId_fkey`, because opening the page runs `ensureDefaultStudioWebsite` |
| `275e117` | **21 pass / 1 fail / 1 skip** (+ Vercel status failure) | **PASS** (run 44275702188, job 134703138252): MJENGO, return paths A–G, agent application at six viewports, ERP at seven viewports; evidence `PASS=595 FAIL=0` | Harness waits for no `aria-busy` and a rendered `<h1>`; case E now requires a positive refusal (not-found or moved off A's path), not just an absent name; Studio rows are removed by exact fixture ids. Red: programme-completeness (job 134703137753, fail-closed, R-CI-01); Vercel `dpl_GMLr1xLGRgoxfTYSAbQ1tRzedhSH` (isolation guard) |

Other `275e117` jobs, all success: PG18 migrations + suite + R-TI summary (run 44275702104, job 134703138309), Release gate aggregate (134705132088), exact-candidate apply (44275701919/134703137719), logical backup/restore (134703137961), real-DB journey (44275702382/134703139076), POS/ERP PostgreSQL suite (44275702016/134704706257), Prisma tenant tests and build (44275702296/134703137792), Static/audit (134703138442), capture (44275702081/134703138206), full-suite (44275702389/134703139488), voice (44275702264/134703138872), and `instruction-integrity` (44275702031/134703137069), which is a separate job from `programme-completeness`.

Consequence (before `e94f2f3`): the MJENGO step failed first, so the return-path step (cases A–G, R-RT-01/02), the agent-application step and the ERP seven-viewport step were **skipped** on those heads. They were **NOT TESTED** in CI until `275e117`. `e94f2f3` updates the MJENGO assertion (deep link expects its own path; the token entry runs last, so sign-in still proves `next=mjengo` resolves the single owned business).

### 8.3 Module matrix (R-TI-01 + R-TI-03, PG18)

Owner-A GET 2xx / refused to owner B: AI Front Desk/Voice 8/7 · Admin 2/2 · Autopilot 5/5 · Business Page 19/15 · ERP-Pro and BOS (BOS is ERP-Pro branding) 3/3 · Files 1/1 · MJENGO 1/1 · Notifications 2/2 · POS 22/22 · Website Studio 9/9 · Payments 6/0 (public by design: storefront checkout, Paystack return/webhook). **TAPNET: NOT PRESENT** in this codebase. The gaps (B GET 2xx without A's identifiers) are self-scoped resources (`account/team-access`, `agents/application`, `business` list/create) or public pages; a leak is A's identifiers in B's response, and none were found.

Not covered: page components (server-rendered pages are not swept by the route matrix; ownership checks are in layouts and `requireErpAccess`/`requirePosAccess`), and cron routes beyond "refused without the cron secret" (503). Both are **NOT TESTED** beyond that.

### 8.4 Blocked (unchanged; owner or upstream action)

- **Vercel Preview** (every head through `275e117`): `[preview-isolation] BLOCKED`. The 7 variables (DATABASE_URL, DIRECT_URL, JATA_STAGING_DATABASE_HOST, AUTH_SECRET, NEXTAUTH_SECRET, PUBLIC_BASE_URL, NEXTAUTH_URL) are scoped to the Preview branch `remediation/owner-authorized-acceptance-v2-2026-11-16`, not to `arena/a3de1985-jata-aftercall`. Confirmed in build events for `dpl_8apUDh2UzH1fmSrmq274ZnUsCyhq` (`cc33999`) and `dpl_AThRzWLwz2zB3mtXxSVCf4Ydai5K` (`1230e3a`); no other build error precedes the guard. Owner action: add the same 7 for Preview on this branch (or for all Preview branches) using staging values only.
- **Paystack Preview sandbox acceptance**: BLOCKED behind Preview (`JATA_RUN_STAGING_ACCEPTANCE=false`). Real-PostgreSQL tests with the provider mocked cover signatures, amount checks, replay, concurrency, refunds, cross-tenant, settlement and abandoned checkout. Provider-backed evidence exists only from PR #125.
- **Neon native PITR**: NOT TESTED / BLOCKED. Logical backup and restore into a disposable PG18 passes in CI; that is not provider PITR.
- **R2 durability**: BLOCKED. Preview credentials are not readable from this environment and Preview does not build.
- **R-DEP-02 picomatch** GHSA-fc5q-39xc-vjpf: GitHub withdrew the advisory on 2026-11-18, stating it is not a security issue. The exact-head full and production npm audits both pass with zero findings. RESOLVED; no suppression or dependency override.
- **programme-completeness**: `NOT READY (24)`, fail-closed by design (R-CI-01). This is separate from `instruction-integrity`, which passes.

**Release verdict: NOT READY.**
