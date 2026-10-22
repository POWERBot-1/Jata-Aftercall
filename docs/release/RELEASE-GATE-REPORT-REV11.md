# Jata Aftercall — Release Gate Report (Rev. 11: PR #52 Independent Safety Audit)

**Date:** 2026-10-21  
**Repository:** `POWERBot-1/Jata-Aftercall`  
**Audited Pull Request:** [`PR #52` (`schema: reconcile six divergences between migrations and schema.prisma`)](https://github.com/POWERBot-1/Jata-Aftercall/pull/52)  
**Session Branch:** `arena/8aab3ad5-jata-aftercall` (`base: main @ 66c4f33a2dd08f790b1daf4d8d80802ec27038e8`)  
**Historical Reports Status:** All **9** prior release reports (`RELEASE-GATE-REPORT.md`, `RELEASE-GATE-REPORT-REV4.md` through `RELEASE-GATE-REPORT-REV10.md`, and `FINAL-RELEASE-READINESS.md`) plus both canonical patch artifacts (`reconciliation.patch`, `reconciliation-tests.patch`) remain **byte-for-byte identical** to `origin/main` (`git diff --exit-code origin/main` verified).  
**Final Audit Verdict:** **`PASS — READY FOR OWNER REVIEW`** *(not merged; awaiting explicit owner merge authorization)*

---

## 1. Executive Summary & What Independent Audit Caught

Prior claims on `78ba755079685e10d9905941d13035874745ebbf` were audited from scratch against live GitHub REST API check runs, workflow step logs, branch protection/ruleset endpoints, open PRs (`#52`, `#51`, `#49`), committed migration SQL files, and every modified line in PR #52.

1. **All reported live GitHub checks on `78ba755079685e10d9905941d13035874745ebbf` verified true:** PR #52 was open, mergeable, `clean`, targeting `main` (`66c4f33a2dd08f790b1daf4d8d80802ec27038e8`), with **12/12** live check-run/status contexts passing on exact SHA `78ba755079685e10d9905941d13035874745ebbf` (`Release Validation` run `39593490037` 6/6, `Candidate migration rehearsal` run `39593490196` 2/2, `Interactive Business E2E` run `39593490032` 2/2, plus Vercel check run + commit status), **0** skipped jobs, and only the 4 `if: failure()` diagnostic dump steps skipped.
2. **Adversarial code audit identified one real pre-reconciliation classification bypass vector in `scripts/ci/rehearse-candidate-migrations.mjs` and closed it prior to owner review:**
   - **Defect found in `78ba7550…` (`scripts/ci/rehearse-candidate-migrations.mjs:93-101`):** `candidatePredatesReconciliation(candidateDir)` previously returned `true` whenever `(a)` `scripts/ci/schema-drift-baseline.json` did not exist in `candidateDir` unconditionally (meaning a post-reconciliation branch that deleted `schema-drift-baseline.json` while keeping `.github/workflows/release-validation.yml` would be misclassified as pre-reconciliation) **or** `(b)` `parsed.entries.length > 0` for *any* non-empty array (meaning a post-reconciliation branch adding any unrelated drift entry could trigger pre-reconciliation fallback).
   - **Fix applied (`scripts/ci/rehearse-candidate-migrations.mjs:138-167`, unit-tested in `scripts/__tests__/rehearse-candidate-migrations.test.mjs:277-315`):** `candidatePredatesReconciliation(candidateDir)` now returns `true` **iff**:
     1. `scripts/ci/schema-drift-baseline.json` is absent **and** `.github/workflows/release-validation.yml` is also absent (true pre-PR-#50 branches such as PR #49 `@ 59962291ec82d5ddbc8f323e3d057d6a5b15cf02`); **or**
     2. `sha256(candidate/scripts/ci/schema-drift-baseline.json)` equals `PRE_RECONCILIATION_BASELINE_SHA256` (`ffbdf47fb98964a455c6b1350d19cc35e1c8b7cd2ed61ee194933df54d6e81ee`, the exact SHA-256 of the historical `2026-10-20` baseline committed on `main` at `66c4f33a2dd08f790b1daf4d8d80802ec27038e8`).
3. **Migration citation precision verified against `prisma/migrations/`:** Earlier prose in historical `FINAL-RELEASE-READINESS.md` referred informally to `PosReceiptSequence_pkey` under `20261015000000_pos_full`; direct inspection of `prisma/migrations/` confirms the actual committed SQL definition lives at `prisma/migrations/20261005020000_pos_sale_refund_integrity/migration.sql:19-23` (`CONSTRAINT "PosReceiptSequence_pkey" PRIMARY KEY ("businessId")`). Historical reports remain untouched per standing non-rewrite discipline; exact `file:line` citations are recorded below.

---

## 2. Safety-Critical Code Audit Matrix (`file:line` Citations)

### 2.1 Schema Reconciliation (`prisma/schema.prisma`, `tests/unit/pos-schema.test.ts`, `prisma/migrations/`)

| # | Divergence | Committed Migration SQL Object (`file:line`) | Reconciled Datamodel / Test (`file:line`) | Live PG18 Verification | Status |
|---|---|---|---|---|---|
| 1 | `MediaAsset.updatedAt` server default | `prisma/migrations/20261004000000_website_studio_ai/migration.sql:19` (`ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`) | `prisma/schema.prisma:925` (`updatedAt DateTime @updatedAt @default(now())`) | `verify-reconciliation-justification.mjs:83-88,129-136` | **`PASS`** |
| 2 | `PaymentAttempt.businessId` `CASCADE` FK + inverse relation | `prisma/migrations/20261005000000_payment_wallet/migration.sql:278` (`ADD CONSTRAINT "PaymentAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE`) | `prisma/schema.prisma:125` (`paymentAttempts PaymentAttempt[]`) & `prisma/schema.prisma:1908` (`business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)`) | `verify-reconciliation-justification.mjs:89-103,140-151` | **`PASS`** |
| 3 | `PaymentDestination.capabilities` default | `prisma/migrations/20261005000000_payment_wallet/migration.sql:92` (`"capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`) | `prisma/schema.prisma:1787` (`capabilities String[] @default([])`) | `verify-reconciliation-justification.mjs:104-110,153-163` | **`PASS`** |
| 4 | `PaymentDestination` 63-byte truncated unique index identifier | `prisma/migrations/20261005000000_payment_wallet/migration.sql:107` (83-char identifier truncated by PostgreSQL `NAMEDATALEN = 64` to 63 chars `PaymentDestination_businessId_provider_providerDestinationId_pr`) | `prisma/schema.prisma:1803` (`@@unique([businessId, provider, providerDestinationId, providerAccountRef], map: "PaymentDestination_businessId_provider_providerDestinationId_pr")`) | `verify-reconciliation-justification.mjs:111-116,165-172` | **`PASS`** |
| 5 | `PaymentProviderConnection.capabilities` default | `prisma/migrations/20261005000000_payment_wallet/migration.sql:137` (`"capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`) | `prisma/schema.prisma:1820` (`capabilities String[] @default([])`) | `verify-reconciliation-justification.mjs:117-122,155-163` | **`PASS`** |
| 6 | `PosReceiptSequence.businessId` primary key | `prisma/migrations/20261005020000_pos_sale_refund_integrity/migration.sql:19-23` (`CONSTRAINT "PosReceiptSequence_pkey" PRIMARY KEY ("businessId")`) | `prisma/schema.prisma:1346` (`businessId String @id`) & `tests/unit/pos-schema.test.ts:165-166` (asserts `@id\b` and rejects `@id @unique`) | `verify-reconciliation-justification.mjs:123-126,174-179` | **`PASS`** |
| — | Zero migration files / zero DDL | `git diff --name-only origin/main -- prisma/migrations` returns empty; `prisma/schema.prisma` blob `25e45c3afe584c7ac35f51b558cc1b73183a1b09` (`SHA-256 = 440027c4fcb10e0f3d2de3f2c7ec1e540ffdc5d9b6283329bfb9af05988d8bfd`) | `.github/workflows/release-validation.yml:735-752` (`prisma migrate diff --exit-code` exits `0` against live PG18) | Both `migrations-pg18` and `schema-reconciliation-proposal` exit `0` | **`PASS`** |

### 2.2 Empty Drift Baseline & Negative Failure Controls

| Safety Check | Code Evidence (`file:line`) | Verification Verdict |
|---|---|---|
| Empty baseline enforces strict zero drift (`added.length > 0` exits `1`) | `scripts/ci/schema-drift-baseline.json:8` (`"entries": []`) paired with `scripts/ci/check-schema-drift.mjs:100,115-119` (`compareToBaseline(findings, baseline.entries ?? [])` -> `if (added.length > 0 \|\| removed.length > 0) process.exit(1)`) | **`PASS`** |
| Missing/unreadable diff log or baseline fails closed (`exit 2`, never `0`) | `scripts/ci/check-schema-drift.mjs:78-97` (`process.exit(2)` on missing argv, unreadable diff file, or invalid baseline JSON) | **`PASS`** |
| Live negative CI test rejects reintroduced schema drift on PostgreSQL 18 | `.github/workflows/release-validation.yml:641-673` (**Control 9** strips `@default(now())` from `MediaAsset.updatedAt` in `/tmp/drift-control.prisma`, verifies `prisma migrate diff --exit-code` returns `2` **and** `check-schema-drift.mjs` returns `1`, then verifies clean empty diff returns `0`) | **`PASS`** |
| No swallowed failures, warning downgrades, or `\|\| true` around drift checks | `.github/workflows/release-validation.yml:295-315,655-673,738-751` (explicit `PIPESTATUS[0]` / exit-code capture with `exit 1` on non-zero) | **`PASS`** |

### 2.3 Candidate Migration Rehearsal (`scripts/ci/rehearse-candidate-migrations.mjs`)

| Safety Check | Code Evidence (`file:line`) | Verification Verdict |
|---|---|---|
| Pre- vs post-reconciliation candidate distinction hardened against spoofing | `scripts/ci/rehearse-candidate-migrations.mjs:145-167` (`PRE_RECONCILIATION_BASELINE_SHA256 = "ffbdf47fb98964a455c6b1350d19cc35e1c8b7cd2ed61ee194933df54d6e81ee"` + `!existsSync(".github/workflows/release-validation.yml")` guard when baseline is absent; unit-tested across all 5 states in `scripts/__tests__/rehearse-candidate-migrations.test.mjs:277-315`) | **`PASS`** |
| Unrebased PR #49 candidate migration validation runs in full (never skipped) | `scripts/ci/rehearse-candidate-migrations.mjs:776-976` runs all 18 migrations (`prisma migrate deploy` + `psql -f` byte-identical catalog parity across 2,066 inventory lines + broken-migration control + 2,569 tests), applies `applyPreReconciliationFixes` (`lines 111-136`) to `/tmp/jata-candidate-recon-*/prisma/schema.prisma`, and requires live PG18 `prisma migrate diff --exit-code === 0` (`lines 941-961`) | **`PASS`** |
| Candidate migration failures remain hard failures | `scripts/ci/rehearse-candidate-migrations.mjs:784-798,973-976,1162-1171` (`fail(...)` sets `verdict = "FAIL"` and exits `1`; preconditions exit `2` `BLOCKED`) | **`PASS`** |
| Non-loopback / production database target refused by default | `scripts/ci/rehearse-candidate-migrations.mjs:662-668` (blocks unless `parsed.hostname` is `localhost`, `127.0.0.1`, or `::1`) & `.github/workflows/candidate-rehearsal.yml:75-93` (disposable runner `postgres:18` service container only) | **`PASS`** |
| Temporary scratch files cleaned deterministically; candidate tree untouched | `scripts/ci/rehearse-candidate-migrations.mjs:969-971` (`finally { rmSync(reconScratch, { recursive: true, force: true }); }`) & `lines 1150-1160` (verifies candidate migration manifest SHA-256 unchanged and `git status --porcelain=v1 -- prisma` clean) | **`PASS`** |

### 2.4 Workflow, Branch Protection, and Adjacent PR Assessment

| Area | Verified Fact (`file:line` / Live GitHub State) | Status |
|---|---|---|
| Workflow triggers & aggregate gate | `.github/workflows/release-validation.yml:29-34,855-898` runs on `pull_request: [main]`, `push: [main]`, `workflow_dispatch`; `Release gate (aggregate)` has `if: always()`, `needs: [static-checks, migrations-pg18, production-build, failure-path-controls, schema-reconciliation-proposal]`, and exits `1` unless all 5 equal `"success"` | **`PASS`** |
| Required check names preserved 1:1 | Exact check names match `docs/release/MAIN-PROTECTION-PROPOSAL.md` and `RELEASE-GATE-REPORT-REV10.md`: `Static`, `Migrations + schema on PostgreSQL 18`, `Production build path on PostgreSQL 18`, `Failure paths actually fail`, `Schema reconciliation proposal closes the drift`, `Release gate (aggregate)`, `Migration target guard`, `Journey against a real database`, `PR #49 candidate applies on a disposable PostgreSQL 18`, `D2 — build, audit and controls on the candidate tree` | **`PASS`** |
| Live GitHub `main` branch protection / ruleset | Live `GET /repos/POWERBot-1/Jata-Aftercall/branches/main` -> `protected: false`; `/rulesets` -> `[]`; `/rules/branches/main` -> `[]` (owner admin action still required to enforce server-side ruleset) | **`NOT APPLIED ON GITHUB`** *(owner governance prerequisite documented)* |
| Open PR #51 comparison (`arena/7f20108b-jata-aftercall @ d5ada1b2…`) | Left **OPEN and untouched**. Contains zero unique safety improvements needed by PR #52: same 7 schema hunks (`blob 25e45c3…`) and POS test hunk, **fails** `Candidate migration rehearsal` because it omits `rehearse-candidate-migrations.mjs`, and renames `Schema reconciliation proposal closes the drift` -> `Reconciled schema holds on PostgreSQL 18` (breaking check-name parity with `MAIN-PROTECTION-PROPOSAL.md`). Safe for owner to close manually once satisfied. | **`VERIFIED — NO UNIQUE CHANGES LOST`** |
| Open PR #49 status (`remediation/interactive-business-e2e-fixes @ 59962291…`) | Left **OPEN and completely untouched** at `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` (`136` files). Rebase onto `main` only **after** PR #52 merges, keeping both `updatedAt DateTime @updatedAt @default(now())` and `version Int @default(0)` in `model MediaAsset`. | **`PASS`** |
| Neon PITR / branch recovery drill (`R5`) & provider billing | No Neon API call, branch, snapshot, or restore executed in this audit | **`NOT TESTED`** *(owner-only boundary)* |
