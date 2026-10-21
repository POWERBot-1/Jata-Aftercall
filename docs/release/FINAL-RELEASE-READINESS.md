# Jata Aftercall — Final Remediation and Release Readiness Report

**Date:** 2026-10-21 (Africa/Nairobi)  
**Repository:** `POWERBot-1/Jata-Aftercall`  
**Active Remediation Branch / PR:** `arena/7486dc85-jata-aftercall` — [PR #50](https://github.com/POWERBot-1/Jata-Aftercall/pull/50) (`OPEN`, base `main`)  
**Candidate Feature PR:** `remediation/interactive-business-e2e-fixes` — [PR #49](https://github.com/POWERBot-1/Jata-Aftercall/pull/49) (`OPEN`, head `59962291ec82d5ddbc8f323e3d057d6a5b15cf02`, **unmodified**)  
**`main` HEAD:** `2575cf461d33476a6bf8edb44fc56dc63498152a` (**unmodified**)  
**Verdict:** **`BLOCKED — NOT APPROVED TO MERGE OR DEPLOY`**

---

## Executive Summary

All safe engineering work, two-sided schema-reconciliation validation (including full application generation, seeding, typechecking, and PostgreSQL 18 test execution), migration-verifier identifier normalization, smoke-script loopback verification, staged branch-protection ruleset specification, and Neon recovery operator checklists are complete, committed, verified in CI on PostgreSQL 18, and sealed by an external SHA-256 manifest (`docs/release/EVIDENCE-MANIFEST.sha256`, **46** tracked artifacts, self-reference forbidden).

The release decision remains **`BLOCKED — NOT APPROVED TO MERGE OR DEPLOY`** for **four explicit owner/external boundaries** that this session cannot and may not cross unilaterally:

1. **Separate schema-reconciliation PR not yet opened on GitHub (`BLOCKED` — platform single-branch lock, not GitHub permissions):** ready-to-run two-patch bundle (`reconciliation.patch` + `reconciliation-tests.patch`) and review checklist are committed and proven green against PostgreSQL 18 on run **`39556189976`** (**13/13** catalog+datamodel assertions and **2,382/2,382** passing tests across **192** files, **0 skipped**).
2. **PR #49 rebase / merge sequence undecided (`BLOCKED` — owner decision):** PR #49 (`59962291ec82d5ddbc8f323e3d057d6a5b15cf02`) remains untouched per standing order.
3. **Branch protection on `main` is inactive (`BLOCKED` — awaits explicit owner approval):** verified live as `protected: false`, `rulesets: []`, `rules/branches/main: []`. Stage 1 JSON ruleset + rollback commands are ready in `docs/release/MAIN-PROTECTION-PROPOSAL.md`.
4. **Live production smoke execution and Neon account-level recovery checks remain unverified (`NOT TESTED` / `BLOCKED`):** sandbox egress to `*.vercel.app` fails TLS handshake (`curl` exit `35`) and `workflow_dispatch` returns HTTP `403`; Neon console metrics R2/R3 are `BLOCKED` and scratch-branch restore rehearsal R5 is `NOT TESTED`.

---

## 1. Recovery Protection & Historical Report Integrity — `PASS`

### 1.1 Environment reset investigation & lossless ref restoration

On session entry, the working directory had experienced a sandbox ref reset (`HEAD` at `main` `2575cf461d33476a6bf8edb44fc56dc63498152a` with **42** untracked paths). Before altering any ref or file:

1. Backed up all 42 untracked paths to `/tmp/prerestore2/untracked-061450.tgz` (`115,335` bytes).
2. Fetched `origin/arena/7486dc85-jata-aftercall` (`cec387907edd433cc58fd949d336b8280465e259`).
3. Hashed all 42 untracked files with `sha256sum` against `git show cec3879:<path>`: **`checked=42 mismatched=0 absent=0`**, and `diff` confirmed exact set equality between `remote \ main` and local untracked files.
4. Restored `refs/heads/arena/7486dc85-jata-aftercall` via `git update-ref` + `git reset --mixed` (zero destructive commands; no `reset --hard`, no `git clean`, zero bytes lost).

### 1.2 Byte-identical preservation of prior reports

| Historical Report | Git Blob SHA-1 | SHA-256 Checksum | Status |
|---|---|---|---|
| `docs/release/RELEASE-GATE-REPORT.md` (Rev. 3, introduced `cb3e456`) | `3181aef679350dcf68956f51687922341f14eaca` | `34517a4a77825f214e1e425431d0afddc8c4e8b32b2467417ab621c6b3055f7f` | **PASS** — unchanged since `cb3e456` |
| `docs/release/RELEASE-GATE-REPORT-REV4.md` (Rev. 4, corrected `2f14f21`) | `548bcce57bf43038697f889c7e4df06bbe234357` | `711995df3eccd269230c17930faf0ab134084e57a79a40dd30392aeeafabc850` | **PASS** — unchanged since `2f14f21` |
| `docs/release/RELEASE-GATE-REPORT-REV5.md` (Rev. 5, introduced `cec3879`) | `032dc8fb92487bf54e1d1c8d714b6c949fc103a8` | `ba0ebc1b3470bc58072f4a48b528d6c23e04a7a9f0c84f9e685421ff5a1e1785` | **PASS** — unchanged since `cec3879` |

### 1.3 Self-test suite & manifest verification

- Manifest verifier self-tests (`scripts/__tests__/verify-evidence-manifest.test.mjs`): **9/9 PASS** (`MISMATCH`, `MISSING`, `NOT_LISTED`, `SELF_REFERENCE`, `DUPLICATE`, malformed line, unreadable file, positive fixture, live repository manifest).
- Full gate self-test suite (`node --test scripts/__tests__/*.test.mjs`): **284/284 PASS** (up from 277: +2 structural datamodel-independence tests on `verify-migrations.mjs`, +5 live HTTP loopback tests on `smoke-production.mjs`).

---

## 2. Schema-Reconciliation Validation & PR Bundle — Engineering `PASS` / PR Creation `BLOCKED`

### 2.1 Patch & blob integrity (`PASS`)

| Artifact | SHA-256 | Verified Property |
|---|---|---|
| `docs/schema-reconciliation/reconciliation.patch` | `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29` | 3,311 bytes · **7 hunks** · `prisma/schema.prisma` only · **0 DDL statements** |
| Source blob (`2575cf4:prisma/schema.prisma`) | — (git blob `398ecdd52335e322d434b149165667742b8c1eb2`) | Exact match with patch header `index 398ecdd..25e45c3` |
| Target blob (patched `prisma/schema.prisma`) | `440027c4fcb10e0f3d2de3f2c7ec1e540ffdc5d9b6283329bfb9af05988d8bfd` | Git blob `25e45c3afe584c7ac35f51b558cc1b73183a1b09` — exact match with header |
| `docs/schema-reconciliation/reconciliation-tests.patch` | `c243200ae609452030a6530c4980566783d488c64e588f4d4adae676f8a4cbd6` | Companion update to `tests/unit/pos-schema.test.ts` (`@unique` → `@id`, forbids `@id @unique`) |

### 2.2 Two real blockers caught and resolved during full application execution

Running the full application lifecycle against the reconciled schema on PostgreSQL 18 uncovered two defects that static diff validation could never detect:

1. **Test pinning divergence #6 (`run 39554627253`, failed step 12):** `tests/unit/pos-schema.test.ts:159` asserted `/businessId\s+String\s+@unique/`. Because migration `20261015000000_pos_full` created `CONSTRAINT "PosReceiptSequence_pkey" PRIMARY KEY ("businessId")`, that test locked the old model bug in place. Captured cleanly as `docs/schema-reconciliation/reconciliation-tests.patch` so the unreconciled gate stays green while the separate reconciliation PR carries both files together.
2. **Real-PostgreSQL suites skipping without `PRISMA_TEST_DATABASE_URL` (`run 39555282816`, failed step 16):** `schema-reconciliation-proposal` set `DATABASE_URL` without `PRISMA_TEST_DATABASE_URL`, causing the 9 `realPrismaConfigured`-gated Postgres suites to skip; `check-test-output.mjs` refused the skip (`exit 1`). Fixed in commit `5490396`.

### 2.3 Complete PostgreSQL 18 verification (`run 39556189976` on `5490396` — `PASS`)

All 18 steps in `Schema reconciliation proposal closes the drift` succeeded on disposable PostgreSQL 18, publishing verbatim check-run annotations (`check-run 119075966828`):

- `prisma migrate deploy` (16 baseline migrations) + pre-patch drift baseline check: **PASS** (exit `0`)
- `git apply reconciliation.patch` + `reconciliation-tests.patch` + `prisma validate`: **PASS** (exit `0`)
- `prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code`: **PASS** (exit `0`, zero drift, zero DDL)
- Two-sided catalog + datamodel check (`verify-reconciliation-justification.mjs`): **PASS** (**13/13** checks verbatim in annotations — every database object confirmed in PostgreSQL system catalogs AND every model assertion confirmed in `schema.prisma`)
- `npx prisma generate` + `npm run seed` + `npm run typecheck`: **PASS** (exit `0`)
- `npx vitest run --exclude "tests/e2e/**"` + `check-test-output.mjs`: **PASS** — verbatim annotation:  
  `reconciled suite — [test-output] tests: 2382 passed, 0 failed, 0 skipped, 0 todo | [test-output] files: 192 passed, 0 failed, 0 skipped`

### 2.4 Why the separate PR is `BLOCKED` here (capability vs. session policy)

- **GitHub token capability (`PASS`):** `gh api repos/POWERBot-1/Jata-Aftercall --jq '.permissions'` returns `{"admin":true,"maintain":true,"pull":true,"push":true,"triage":true}`, and `git push --dry-run origin HEAD:refs/heads/schema-reconcile-six-divergences` succeeded (`* [new branch]`, creating no remote ref).
- **Platform session constraint (`BLOCKED`):** Arena binds this agent session strictly to `arena/7486dc85-jata-aftercall` (PR #50) and forbids creating, switching to, or pushing any second branch.
- **Ready-to-submit command sequence & PR body:** complete copy-paste commands verifying both SHA-256 digests before commit are in `docs/schema-reconciliation/PR-BUNDLE.md` §8.2, and the full PR description + independent review checklist are in `docs/schema-reconciliation/PR-BODY.md`.

---

## 3. Migration-Verifier Identifier Normalization Fix — `PASS`

- **Commit:** introduced in `50e9e0e`, structural datamodel-independence tests added on `arena/7486dc85-jata-aftercall` (`f46a23b` → current `HEAD`).
- **Root cause fixed:** PostgreSQL's `conrelid::regclass::text` formats mixed-case identifiers with quotes (`"PasswordResetToken"`), which previously failed exact string comparison against unquoted expectation metadata (`table: "PasswordResetToken"`). `scripts/ci/verify-migrations.mjs` now joins `pg_class k ON k.oid = c.conrelid` (`k.relname AS table_name`) and strips surrounding quotes consistently in `migration-expectations.mjs`.
- **Verified properties (`scripts/__tests__/migration-expectations.test.mjs`, 15/15 PASS):**
  1. Quoted mixed-case `regclass` table names match unquoted expectations (`PASS`).
  2. Expected foreign key `PasswordResetToken_userId_fkey` (`FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE`) passes when present (`PASS`).
  3. Missing constraint, wrong table, or missing `ON DELETE CASCADE` fails the verifier (`PASS`).
  4. `verify-migrations.mjs` **never reads `prisma/schema.prisma`** — pinned structurally by source inspection test (`the verifier never reads prisma/schema.prisma`) and empty-snapshot negative test (`a model that claims an object the database lacks is not enough`) (`PASS`).
  5. Verified live on disposable PostgreSQL 18 against **both** the 16-migration `main` history (`Release Validation` run `39556189976`) **and** PR #49's exact 18-migration candidate tree `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` (`Candidate migration rehearsal` runs `39544687883`, `39545860075`, `39556189828`).

---

## 4. Branch-Protection Readiness — Proposal `PASS` / Repo Enforcement `BLOCKED`

- **Live GitHub state verified (`2026-10-21`):**
  - `GET /repos/POWERBot-1/Jata-Aftercall/branches/main` → `protected: false`
  - `GET /repos/POWERBot-1/Jata-Aftercall/rulesets` → `[]` (`0` rulesets)
  - `GET /repos/POWERBot-1/Jata-Aftercall/rules/branches/main` → `[]` (`0` active branch rules)
- **Actual checks produced by PR #49 (`59962291ec82d5ddbc8f323e3d057d6a5b15cf02`):**
  - `Journey against a real database` — `completed/success` (`118823126143`)
  - `Migration target guard` — `completed/success` (`118823126588`)
  - `Vercel Preview Comments` (`118823156104`) and commit status `Vercel` (`success`)
  - `Release gate (aggregate)` — **absent on PR #49** (cannot be required prior to PR #50 landing + rebase).
- **Staged configuration (`docs/release/MAIN-PROTECTION-PROPOSAL.md` Addendum 2):**
  - **Stage 1 (applicable immediately upon owner approval):** requires `Journey against a real database` + `Migration target guard`, `strict_required_status_checks_policy: false` (prevents forced rebase of PR #49 without authorization), `required_approving_review_count: 1`, `dismiss_stale_reviews_on_push: true`, `require_last_push_approval: true`, `required_review_thread_resolution: true`, `deletion`, `non_fast_forward`, `bypass_actors: []`.
  - **Stage 2 (only after PR #50 lands on `main` and open candidate PRs carry the workflow):** adds `Release gate (aggregate)`.
  - **Admin bypass disclosure:** on a single-user-owned repository (`POWERBot-1`), `bypass_actors: []` blocks accidental/direct pushes even by the admin, though the repository owner retains control-plane permission to edit or disable the ruleset itself.
  - **Rollback:** `gh api -X PUT repos/POWERBot-1/Jata-Aftercall/rulesets/<id> -f enforcement=disabled` (pause) or `gh api -X DELETE repos/POWERBot-1/Jata-Aftercall/rulesets/<id>` (remove).
  - **No repository settings were changed.** Status remains **`BLOCKED`** pending explicit owner authorization.

---

## 5. Production Smoke-Test Readiness — Script & Loopback `PASS` / Live Origin `NOT TESTED` (`BLOCKED`)

- **Read-only audit (`PASS`):** `scripts/ci/smoke-production.mjs` issues **only `GET`** requests to `/`, `/health`, and optional `/b/<slug>`. Zero writes, auth calls, mutations, or payment triggers.
- **Controlled non-production execution (`PASS` — commits `0d38abb` & `ac1d674`):** tested both manually against a live local Node HTTP server mirroring `app/health/route.ts` and permanently in `scripts/__tests__/smoke-production-e2e.test.mjs` (**5/5 PASS**, wired into CI):
  - Healthy endpoint (`status:"ok", db:"up"`) → **exit `0`** (`PASS: 2/2 read-only checks succeeded`)
  - Degraded stub (`status:"degraded", db:"unconfigured"`) → **exit `1`** (`FAIL health: db:unconfigured`)
  - Partial degraded (`status:"ok", db:"down"`) → **exit `1`** (`FAIL health: db:down`)
  - Unreachable port → **exit `2`** (`BLOCKED: the deployment could not be reached at all`)
  - Method spy → exclusively `["GET"]`
- **Preserved external failure evidence (not repeated, TLS never bypassed):**
  - `curl https://jata-aftercall.vercel.app/` → **exit `35`** (`OpenSSL SSL_connect: SSL_ERROR_SYSCALL`)
  - `gh workflow run production-smoke.yml` → **HTTP `403`** (`Resource not accessible by integration`, and workflow file is not yet on `main`)
- **Manual operator procedure:** documented in `docs/release/PRODUCTION-SMOKE-PROCEDURE.md` with required recording table (UTC ISO timestamp, operator, target URL, run ID/command, exit code, HTTP statuses, `/health` JSON fields, verdict). Live production health remains **`NOT TESTED`**.

---

## 6. Neon Recovery Readiness — Checklist `PASS` / Account State `BLOCKED` & `NOT TESTED`

| Item | Requirement | Status | Basis |
|---|---|---|---|
| **R1** | Enrolled production target branch identity (`br-cold-snow-ax606swa`) | **PASS** | Verified in `scripts/ci/authorize-migration.mjs` & PR #48 enrollment record |
| **R2** | Actual earliest/latest PITR recovery timestamps in Neon console | **BLOCKED** | No Neon console/API access in review environment |
| **R3** | Whether any manual or scheduled snapshot actually exists | **BLOCKED** | No Neon console/API access; zero snapshots created here |
| **R4** | Documented plan retention baseline (6-hour window) | **PASS** | Recorded; must still be compared against business RPO |
| **R5** | End-to-end scratch-branch restore rehearsal | **NOT TESTED** | Scratch-branch sentinel procedure prepared in `docs/NEON-RECOVERY-READINESS.md` |
| **Cost** | Account-specific cost verification vs. published `$0.09/GB-month` list rate | **NOT TESTED** | Earlier `$0` wording withdrawn; zero snapshots, restores, or plan changes performed |

---

## 7. Complete Disposition Matrix (All 7 PR #50 Defect Areas + Gate Items)

| ID / Area | Requirement | Status | Exact Evidence (Commit · Run · Exit Code) |
|---|---|---|---|
| **D0 / Workflow & Baseline** | Unclosed `${{` expression guard + drift baseline integrity | **PASS** | `check-workflow-expressions.mjs` (4 workflows PASS, 8 unit tests) · `check-schema-drift.mjs` (8 unit tests) · run `39556189976` exit `0` |
| **D1 / Audit Gate** | Production audit separated from dev tree; `FAIL` vs `BLOCKED` distinct; `braces@3.0.3` (`GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687`, CVSS 8.7, dev-only, no patch, reassess `2026-11-20`) disclosed | **PASS** | `summarise-audit.mjs` (10 unit tests + CI negative controls) · PR #49 prod audit `0` findings (`39544687883`, `39556189828`) |
| **D2 / Candidate Build & Controls** | Exact PR #49 SHA `5996229…` production build, 18 migrations, prod audit, negative & positive guard controls, candidate tree untouched | **PASS** | `.github/workflows/candidate-rehearsal.yml` · runs `39544687883`, `39545860075`, `39556189828` (`completed/success`, exit `0`) |
| **D3 / Test Skip Guard** | Skipped, zero-test, or missing test logs fail/block the gate | **PASS** | `check-test-output.mjs` (11 unit tests + Controls 3–5 + caught live skip in `39555282816`) |
| **D4 / Smoke Script** | Read-only GET smoke checker distinguishing `PASS` (`0`), `FAIL` (`1`), `BLOCKED` (`2`) | **PASS** (code) / **NOT TESTED** (live prod) | `smoke-production.mjs` (11 unit + 5 live loopback E2E tests = 16 tests PASS) · `docs/release/PRODUCTION-SMOKE-PROCEDURE.md` |
| **D5 / Evidence Integrity** | External SHA-256 manifest, self-reference forbidden, prior reports byte-preserved | **PASS** | `verify-evidence-manifest.mjs` (9 unit tests) + `EVIDENCE-MANIFEST.sha256` (46 files OK) |
| **D6 / Migration Guard & Verifier** | Broken migration fails build; unknown prod target refused; `regclass` identifier quoting normalized; verifier independent of `schema.prisma` | **PASS** | `authorize-migration.mjs` (8 tests) · `verify-migrations.mjs` (15 expectation + 8 manifest tests) · runs `39556189976`, `39556189828` |
| **Schema Reconciliation PR** | Two-sided catalog+model proof + `generate`/`seed`/`typecheck`/PG18 suite (`2,382` tests) | **PASS** (validation) / **BLOCKED** (separate branch/PR) | Run `39556189976` (`5490396`, 13/13 checks + 2,382 tests PASS) · `docs/schema-reconciliation/PR-BUNDLE.md` & `PR-BODY.md` |
| **Branch Protection (`main`)** | Staged check ruleset matching PR #49's actual checks | **BLOCKED** | Live state `protected: false`; Stage 1/2 JSON & rollback in `docs/release/MAIN-PROTECTION-PROPOSAL.md` |
| **Neon Recovery (R1–R5)** | Console recovery window, snapshots, cost verification, scratch restore | **BLOCKED** (R2/R3) / **NOT TESTED** (R5, cost) | Checklist in `docs/NEON-RECOVERY-READINESS.md` |

---

## 8. Mandatory Unverified Capabilities Disclosure

Regardless of CI gate status, the following five capabilities have **not** been verified end-to-end in production in this review and remain explicitly unverified:

1. **Durable media storage** (production object persistence, permissions, lifecycle, CDN delivery)
2. **SMTP delivery & password-recovery** (real outbound email delivery, inbox placement, live token round-trip)
3. **Live payment-provider flows** (real M-PESA Daraja / provider credentials, live STK push, real callback ingress & settlement)
4. **Physical-device acceptance** (real mobile hardware, Safari/Chrome mobile viewport & network conditions)
5. **Production Core Web Vitals** (live field/synthetic LCP, INP, CLS against production infrastructure)

---

## 9. Remaining Owner Decisions Required Before Release

1. **Merge sequence & separate reconciliation PR:** run the exact commands in `docs/schema-reconciliation/PR-BUNDLE.md` §8.2 from a normal checkout to open `schema/reconcile-six-divergences` against `main`, decide merge order with PR #50 (emptying `scripts/ci/schema-drift-baseline.json` in whichever of the two merges second), and never merge red.
2. **PR #49 disposition:** authorize rebasing PR #49 (`59962291ec82d5ddbc8f323e3d057d6a5b15cf02`) onto `main` after PR #50 and the schema reconciliation PR land so PR #49 produces `Release gate (aggregate)` on its own head.
3. **Branch protection activation:** approve applying Stage 1 ruleset JSON (`docs/release/MAIN-PROTECTION-PROPOSAL.md` Addendum 2) now, verify effective settings via API, and promote to Stage 2 once PR #50 is on `main`.
4. **Production smoke execution:** execute `docs/release/PRODUCTION-SMOKE-PROCEDURE.md` from an environment with normal HTTPS access (and from `main` via `workflow_dispatch` post-merge) and record the result table.
5. **Neon console & scratch restore sign-off:** complete Sections A–D of `docs/NEON-RECOVERY-READINESS.md` on a scratch branch without touching `production`.

**Final Release Gate Verdict:** **`BLOCKED — NOT APPROVED TO MERGE OR DEPLOY`**
