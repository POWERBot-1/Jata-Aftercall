# Release Gate Closeout Report — Revision 6 (Independent Baseline Audit & Control-Plane Verification)

**Date:** 2026-10-21 (Africa/Nairobi)  
**Repository:** `POWERBot-1/Jata-Aftercall`  
**Authorized Working Branch / PR:** `arena/7486dc85-jata-aftercall` — [PR #50](https://github.com/POWERBot-1/Jata-Aftercall/pull/50) (`OPEN`, base `main`)  
**Candidate Feature PR:** `remediation/interactive-business-e2e-fixes` — [PR #49](https://github.com/POWERBot-1/Jata-Aftercall/pull/49) (`OPEN`, head `59962291ec82d5ddbc8f323e3d057d6a5b15cf02`, **unmodified**)  
**`main` HEAD:** `2575cf461d33476a6bf8edb44fc56dc63498152a` (**unmodified**)  
**Prior PR #50 Baseline Verified on Entry:** `e768b52c15b7b430cc1011650a07bd10c9b177bb`  
**Overall Release Verdict:** **`BLOCKED — NOT APPROVED TO MERGE OR DEPLOY`**

---

## 1. Independent Verification of the Known Baseline (Step 1) — `PASS`

Before any file in the working tree was touched, all Git refs, GitHub PR states, CI run conclusions, and manifest digests were verified strictly read-only:

| Target | Expected Baseline | Live Verified Value | Status |
|---|---|---|---|
| `main` HEAD | `2575cf461d33476a6bf8edb44fc56dc63498152a` | `2575cf461d33476a6bf8edb44fc56dc63498152a` | **PASS** |
| [PR #49](https://github.com/POWERBot-1/Jata-Aftercall/pull/49) | `OPEN`, `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` | `OPEN`, `MERGEABLE`, base `main`, head `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` | **PASS** |
| [PR #50](https://github.com/POWERBot-1/Jata-Aftercall/pull/50) on entry | `OPEN`, `e768b52c15b7b430cc1011650a07bd10c9b177bb` | `OPEN`, `MERGEABLE`, base `main`, head `e768b52c15b7b430cc1011650a07bd10c9b177bb` (`git status --short` empty) | **PASS** |
| Run `39556807468` (*Release Validation*) | 6/6 jobs on `e768b52…` | `headSha: e768b52c15b7b430cc1011650a07bd10c9b177bb` · **6/6 jobs `completed/success`** | **PASS** |
| Run `39556807439` (*Candidate migration rehearsal*) | 2/2 jobs on `e768b52…` | `headSha: e768b52c15b7b430cc1011650a07bd10c9b177bb` · **2/2 jobs `completed/success`** | **PASS** |
| Run `39556807492` (*Interactive Business E2E*) | 2/2 jobs on `e768b52…` | `headSha: e768b52c15b7b430cc1011650a07bd10c9b177bb` · **2/2 jobs `completed/success`** | **PASS** |
| Prior evidence manifest on entry | 46/46 OK | `verify-evidence-manifest.mjs` **PASS** · `sha256sum -c` **46/46 OK** · self-tests **284/284 PASS** | **PASS** |

### Immutable Preservation of All Prior Reports (`PASS`)

Zero prior reports were overwritten or edited:

- `docs/release/RELEASE-GATE-REPORT.md` (Rev. 3): `34517a4a77825f214e1e425431d0afddc8c4e8b32b2467417ab621c6b3055f7f`
- `docs/release/RELEASE-GATE-REPORT-REV4.md` (Rev. 4): `711995df3eccd269230c17930faf0ab134084e57a79a40dd30392aeeafabc850`
- `docs/release/RELEASE-GATE-REPORT-REV5.md` (Rev. 5): `ba0ebc1b3470bc58072f4a48b528d6c23e04a7a9f0c84f9e685421ff5a1e1785`
- `docs/release/FINAL-RELEASE-READINESS.md` (Rev. 5 Closeout): `a67afa16d6c358177b407ce67ac2da92988bf81b5bc754d73ee91b776f12fcaf`

---

## 2. Read-Only Vercel Control-Plane Discoveries (New in Rev. 6)

Read-only inspection of the connected Vercel project metadata (`prj_mXn1031amrZQo4gyaVumKS4FltjW` / `jata-aftercall`; zero secret values accessed or recorded, zero deployments triggered, zero settings changed) established four material facts that directly govern release safety:

1. **Active Production Deployment (`PASS` — control plane verified):**
   - Deployment UID: **`dpl_5ngmfFB74AT1McoguZ2UfCM4eWB6`** (`state: "READY"`, `readySubstate: "PROMOTED"`, `target: "production"`, Node `24.x`, region `iad1`)
   - Exact deployed Git SHA: **`2575cf461d33476a6bf8edb44fc56dc63498152a`** (`main`, PR #48)
   - Verified domain: **`jata-aftercall.vercel.app`** (`verified: true`; sole domain assigned to the project)
   - Prior promoted deployments retained in history: `dpl_AF7xXZW7RHmZ4AbfVLh9659REYfj` (`01314455…`), `dpl_Ffu6wwt9BrGRd2DQZ8SP5S9U8xeW` (`8db6a9e4…`).
2. **Critical Finding — Vercel Preview Builds Are Intentionally Skipped on PRs (`PASS` discovery / architectural warning):**
   - Project setting `commandForIgnoringBuildStep` is configured as:
     `if [ "$VERCEL_ENV" == "production" ]; then exit 1; else exit 0; fi`
   - In Vercel's Ignored Build Step contract, `exit 0` cancels the build and `exit 1` proceeds. Consequently, **every pull-request preview deployment is immediately set to `readyState: "CANCELED"`** while reporting commit status `Vercel: success` on GitHub.
   - **Implication:** the green `Vercel` commit status on PR #49 (`5996229…`) does **not** execute `scripts/build.sh`, Prisma migrations, or `next build`. Only GitHub Actions (`Production build path on PostgreSQL 18` and `Candidate migration rehearsal`) validates the production build before `main` deploys. **Never treat or configure the `Vercel` check context as a build gate.**
3. **Deployment Protection Scope (`ssoProtection: all_except_custom_domains`):**
   - Standard protection covers `.vercel.app` hostnames (`all_except_custom_domains`), and no custom domain is attached (`jata-aftercall.vercel.app` only). An operator running unauthenticated `smoke-production.mjs` against `https://jata-aftercall.vercel.app` will immediately see if SSO challenges `/health` (`FAIL health: expected 200, received 401` / non-JSON body) rather than receiving a false pass.
4. **Confirmed Production Environment Key Gaps (`FAIL` / `BLOCKED` for unverified capabilities — key names only, zero values):**
   - Configured `production` environment variable keys (`15` keys): `AUTH_SECRET`, `PUBLIC_BASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `ADMIN_EMAILS`, `NODE_ENV`, `CLIENT_KEY`, `DATABASE_URL`, `PAYSTACK_MERCHANT_ID`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_CALLBACK_TOKEN`, `MPESA_ENV`.
   - **Confirmed absent in `production`:** **zero** SMTP/mailer environment keys and **zero** durable object/blob storage environment keys exist on the Vercel project.
   - **Speed Insights field telemetry:** `speedInsights.hasData: false` (**zero** Core Web Vitals samples collected).

---

## 3. Separate Schema-Reconciliation PR Readiness (Step 2) — Bundle `PASS` / Branch Push `BLOCKED`

Re-verified in an isolated temporary directory against `main@2575cf461d33476a6bf8edb44fc56dc63498152a` without duplicating changes into PR #49 or PR #50:

- `docs/schema-reconciliation/reconciliation.patch`: SHA-256 `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29` (base blob `398ecdd52335e322d434b149165667742b8c1eb2` → target blob `25e45c3afe584c7ac35f51b558cc1b73183a1b09`, patched schema SHA-256 `440027c4fcb10e0f3d2de3f2c7ec1e540ffdc5d9b6283329bfb9af05988d8bfd`, **0 DDL statements**).
- `docs/schema-reconciliation/reconciliation-tests.patch`: SHA-256 `c243200ae609452030a6530c4980566783d488c64e588f4d4adae676f8a4cbd6` (**0 DDL statements**; updates `tests/unit/pos-schema.test.ts` to assert `@id` and forbid `@id @unique` on `PosReceiptSequence.businessId`).
- Validated end-to-end on disposable PostgreSQL 18 (`39556189976`, `39556807468`): **13/13** catalog+datamodel assertions `PASS`, **`2382 passed, 0 failed, 0 skipped, 0 todo` across `192 passed` files**.
- **Environmental restriction (`BLOCKED`):** this session is locked to `arena/7486dc85-jata-aftercall` and cannot push `schema/reconcile-six-divergences`. Exact standard-checkout commands are ready in `docs/schema-reconciliation/PR-BUNDLE.md` §8.2 using `--body-file docs/schema-reconciliation/PR-BODY.md`.

---

## 4. Branch-Protection Readiness (Step 3) — Proposal `PASS` / Activation `BLOCKED`

- **Read-only live GitHub state:** `protected: false`, `rulesets: []`, `rules/branches/main: []`. **Zero changes applied.**
- **Why staging is mandatory:**
  - PR #49 (`59962291ec82d5ddbc8f323e3d057d6a5b15cf02`) currently produces only `Journey against a real database` (`success`) and `Migration target guard` (`success`) — `Release gate (aggregate)` does **not** exist on PR #49 until PR #50 merges to `main` and PR #49 is rebased onto `main`.
  - Requiring `Release gate (aggregate)` before that sequence would deadlock PR #49, and requiring `Vercel` would rely on a skipped preview build (`commandForIgnoringBuildStep`).
- **Prepared configuration:** `docs/release/MAIN-PROTECTION-PROPOSAL.md` Addendum 2 defines exact Stage 1 JSON (`Journey against a real database` + `Migration target guard`, `strict_required_status_checks_policy: false`, `bypass_actors: []`, 1 approval, stale-review dismissal, last-push approval, thread resolution), Stage 2 upgrade (`+ Release gate (aggregate)`), single-owner admin bypass disclosure, and pause/delete rollback commands.

---

## 5. External Verification & Neon Recovery Status (Step 4)

| Requirement | Status | Exact State / Missing Evidence |
|---|---|---|
| Live HTTPS Production Smoke (`https://jata-aftercall.vercel.app`) | **`NOT TESTED` / `BLOCKED`** | Sandbox TLS fails (`curl` exit `35`) and `workflow_dispatch` returns HTTP `403`. Operator must run `docs/release/PRODUCTION-SMOKE-PROCEDURE.md` from standard network access and record timestamp, status codes, and `/health` JSON (`{"status":"ok","db":"up"}`). |
| Neon R1 (enrolled prod target `br-cold-snow-ax606swa`) & R4 (6h baseline) | **`PASS`** | Verified in repository guard and plan documentation. |
| Neon R2 (live PITR window) & R3 (existing snapshots) | **`BLOCKED`** | Requires read-only inspection in Neon Console (`docs/NEON-RECOVERY-READINESS.md` §A). |
| Neon R5 (scratch-branch sentinel restore rehearsal) & Account Cost | **`NOT TESTED`** | Requires authorized scratch-branch rehearsal (`§B`) and billing/projection check (`§C`). Zero snapshots, branches, or costs incurred. |
| Durable media storage | **Unverified (`BLOCKED`)** | Confirmed **0** external storage env keys on Vercel project `prj_mXn1031amrZQo4gyaVumKS4FltjW`. |
| SMTP delivery & password-recovery | **Unverified (`BLOCKED`)** | Confirmed **0** SMTP/mailer env keys on Vercel project `prj_mXn1031amrZQo4gyaVumKS4FltjW`. |
| Live payment-provider flows (Paystack / M-PESA) | **Unverified (`NOT TESTED`)** | Env keys exist on Vercel `production`, but live provider round-trips, callbacks, and settlement have not been executed. |
| Physical-device acceptance | **Unverified (`NOT TESTED`)** | Only headless Chromium Playwright CI journeys executed. |
| Production Core Web Vitals | **Unverified (`NOT TESTED`)** | Vercel `speedInsights.hasData` is `false` (0 recorded samples). |

---

## 6. Single Safest Next Action

**From an authorized standard developer workstation (outside the single-branch sandbox), open the standalone zero-DDL schema-reconciliation PR from `main@2575cf461d33476a6bf8edb44fc56dc63498152a` using the verified two-patch command sequence in `docs/schema-reconciliation/PR-BUNDLE.md` (§8.2) — without merging it yet — while simultaneously running the read-only production smoke test (`node scripts/ci/smoke-production.mjs --base-url https://jata-aftercall.vercel.app`) to establish baseline live health before any merge touches `main`.**

---

## 7. Explicit Safety Attestation

In this session:

- **PR merges or closures performed:** **None**
- **Deployments triggered:** **None**
- **Production database migrations or data mutations executed:** **None**
- **Neon snapshots, branch creations, restores, or retention changes executed:** **None**
- **Paid / billable infrastructure actions incurred:** **None**
- **GitHub or Vercel repository/project settings modified:** **None**
- **Secrets, tokens, connection strings, ciphertexts, or bypass keys exposed:** **None**
