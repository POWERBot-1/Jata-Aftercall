# PR #49 migration rehearsal — execution results

**Date:** 2026-10-21
**Candidate:** `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` — "test(e2e): align the §66 journey with the approved media contract"
**Target:** disposable `postgres:18` service container (never Neon, never production)
**Verdict:** `PASS` — 50 checks passed, 0 failed, 0 blocked
**PR #49 was not modified.** Its head is byte-identical before and after: `5996229…`, base `main`.

This document records what was executed, not what was intended. Every number below
comes from the run's own output, promoted to annotations by the workflow so it can be
audited after the fact.

---

## 1. Why this rehearsal exists

`release-validation.yml` validates the migration history of the branch it runs on. PR #49
lives on a different branch and its head predates that workflow entirely, so the 18-migration
history PR #49 proposes had never been executed by this review — only read. A static read
cannot establish that the history applies in order, that the ledger ends complete, that the
objects the application selects exist, or that a failure halfway through is reported as a
failure.

The rehearsal closes that gap without rebasing, merging or touching PR #49:

| Path | Purpose |
|---|---|
| `.github/workflows/candidate-rehearsal.yml` | checks the candidate commit out into a second directory, installs its own lockfile, runs the rehearsal against a disposable PostgreSQL 18 |
| `scripts/ci/rehearse-candidate-migrations.mjs` | the rehearsal itself — 9 sections, explicit PASS/FAIL/BLOCKED per check, exit 0/1/2 |
| `scripts/__tests__/rehearse-candidate-migrations.test.mjs` | 11 unit tests for the checker (the checker is not taken on trust either) |

The script refuses any host that is not loopback, only creates databases named
`jata_rehearsal_*`, and rehashes the candidate migrations at the end to prove the run was
read-only.

---

## 2. What ran

| Field | Value |
|---|---|
| Run | [39518712777](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/39518712777) |
| Workflow | `Candidate migration rehearsal` (`.github/workflows/candidate-rehearsal.yml`) |
| Reviewing commit | `04a23fdc89b083fc28b33dcdd100974f11590db7` |
| Candidate commit | `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` (asserted before anything ran) |
| Server | `PostgreSQL 18` service container, database `jata_ci`, destroyed with the runner |
| Node / Prisma CLI | `22.22.3` / `5.22.0` (the candidate's own pinned CLI) |
| Baseline history | 16 migrations, manifest `da3fe04823b850ea6daa6ea6a1da2c5aaa410626a0b9db125b85b253f43a9ba3` |
| Candidate history | 18 migrations, manifest `105481365a4c20cc6e7e400a6ae25c1d2ca9ab4dcf48756699281c45bf98b291` |

Added by the candidate:

| Migration | `migration.sql` SHA-256 |
|---|---|
| `20261017000000_media_asset_version` | `209a1e2965f54ddace0be07036a5f8a223180209e4b5b1237b8c37132ffadddd` |
| `20261018000000_password_reset_security` | `af197ddfae04c94d7b998e144f295f909c3028c6e79a4f8dbe547d1aa5371b39` |

An earlier run of the same workflow passed as well (`39518438957`, reviewing commit
`0aede82d1`), so the result is reproducible across two runs, not a single sample.

---

## 3. Results, section by section

The script prints one line per check. These are the load-bearing ones, quoted from the
run's annotations.

| # | Section | Result |
|---|---|---|
| 1 | Complete history via `prisma migrate deploy` | `PASS` — exit 0, 18 "Applying migration" lines, both candidate names appear in the log |
| 2 | Migration ledger | `PASS` — 18 rows, all finished, none rolled back, none carrying error logs, names match the directories exactly |
| 3 | Objects promised by the two migrations | `PASS` — 15 declarative expectations: 9 columns, 1 table, 3 indexes, 1 primary key, 1 foreign key with `ON DELETE CASCADE` / `ON UPDATE CASCADE` |
| 4 | Same files applied with `psql -f` | `PASS` — identical catalog inventory, `2066` lines, both directions |
| 5 | Second `migrate deploy` | `PASS` — applies nothing, ledger unchanged |
| 6 | Migrated catalog vs `prisma/schema.prisma` | `PASS` — the drift is the recorded pre-existing debt and nothing else (`12` recorded findings matched, `0` new) |
| 7 | Negative control: a broken migration | `PASS` — non-zero deploy, failed row recorded with logs, `migrate status` non-zero and says "failed" |
| 8 | Candidate still builds and tests | `PASS` — `prisma generate`, `npm run seed`, `tsc --noEmit`, `vitest run`: `2569 passed (2569)` |
| 9 | Run was read-only | `PASS` — candidate manifest unchanged after the rehearsal; `git status` clean under `prisma/` |

Totals from the run: **50 PASS, 0 FAIL, 0 BLOCKED — `RESULT: PASS`**.

### 3.1 The failure control, in full

This is the check that makes the rest meaningful. A scratch history was built from 17 of the
18 migrations plus a control that cannot apply (`ALTER TABLE "NoSuchTableForRehearsal" …`).
The rehearsal required all three of:

1. `prisma migrate deploy` exits **non-zero** — a failed migration must never read as a
   successful build;
2. the ledger records the failure as **unfinished with error logs** — a failure nobody can
   diagnose after the fact is not recorded;
3. `prisma migrate status` exits **non-zero** and contains "failed".

All three held. The control is rerun on every invocation.

### 3.2 Schema drift

`prisma migrate diff --exit-code` reports drift in both directions. The rehearsal parses it
with the repository's existing `check-schema-drift.mjs` and compares it against
`schema-drift-baseline.json`:

* observed findings match the recorded entries **exactly** (`MediaAsset.updatedAt`,
  `PaymentAttempt` foreign key and the four related definitions);
* **no new drift** is introduced by the two migrations;
* no recorded finding disappears.

PR #49 therefore neither adds to nor fixes the pre-existing divergence. That divergence
remains `FAIL` in its own right — a recorded baseline is debt with a name on it, not an
approval — and the reconciliation proposal in `docs/schema-reconciliation/` is still the
remedy.

---

## 4. Findings about the harness (recorded because they changed the verdict)

The first three runs of this workflow failed. Neither failure was a defect in PR #49, and
both would have been misreported without the annotations added in `04a23fd`:

| Run | What failed | Cause | Fix |
|---|---|---|---|
| `39516190207` | workflow never loaded — 0 jobs, name reported as the file path | `CANDIDATE_LABEL: ${{ … 'PR #49' }}` in an unquoted YAML scalar; the space before `#` began a comment, so the `}}` was commented out and GitHub refused the file | scalars quoted, and every workflow file checked for a `${{` that does not close on its line |
| `39516724250` | `FAIL constraint p/f on PasswordResetToken — missing; constraints: (none)` | the checker used `conrelid::regclass::text`, which renders a mixed-case table as `"PasswordResetToken"` **with quotes**, so no constraint matched | the snapshot joins `pg_class` and uses the unquoted `relname` |
| `39517037339` | `FAIL the candidate test suite passes` — three AI-plan pricing/entitlement tests | the rehearsal did not seed the database before running suites that assert on seeded pricing; the release gate does seed | `npm run seed` runs first; if the seed cannot run, the suite is `BLOCKED`, not `FAIL` |
| `39517037339` | `FAIL constraint PasswordResetToken_pkey — definition PRIMARY KEY (id) lacks PRIMARY KEY ("id")` | PostgreSQL quotes identifiers only when needed | comparisons strip quotes and collapse whitespace; both renderings are pinned by a unit test |

This is why the verdict is a set of named checks rather than a green tick: each of these was
a false accusation against the candidate, and each was caught by the check itself reporting
which expectation failed.

---

## 5. What this does not prove

* **A container is not Neon.** Nothing here exercises branching, PITR, compute suspension,
  connection pooling or any provider-side behaviour. Those remain `BLOCKED` in
  `docs/NEON-RECOVERY-READINESS.md`.
* **No production data.** The rehearsal runs on an empty schema with synthetic rows only.
  It cannot say how the two `ALTER TABLE … ADD COLUMN … DEFAULT 0` statements behave on the
  real table sizes; the statements are additive and defaulted, but "cheap" is not measured.
* **No application acceptance.** The vitest suite passes; the browser journeys, payments,
  SMTP delivery, storage and M-PESA flows are untouched by this rehearsal and remain as
  stated in the release report.
* **The candidate's own harness was not executed.** `scripts/test-local-postgres-migrations.mjs`
  on PR #49 requires a server whose `data_directory` is literally
  `<cwd>/.cache/audit-tools/pgdata`, listening on `127.0.0.1:55432` as role `jata` — a
  hand-initialised local cluster. A service container cannot satisfy that precondition, so it
  is **NOT TESTED**, and it is not evidence either way. It is also narrower than this
  rehearsal: it applies the two migrations to a throwaway schema with hand-built tables, not
  the 18-migration chain, and it never runs the ledger.

---

## 6. Reproducing it

```bash
# Rehearse whatever PR #49 currently points at (this is the default):
gh workflow run candidate-rehearsal.yml --repo POWERBot-1/Jata-Aftercall

# Or a different candidate:
gh workflow run candidate-rehearsal.yml --repo POWERBot-1/Jata-Aftercall \
  -f candidate_commit=<40-char sha> -f candidate_label="PR #49 @ <sha>"
```

It also runs on every pull request to `main` in this repository, so a failure is visible
before anyone asks for a rebase.

Local reproduction needs only a disposable PostgreSQL 18 and the candidate's dependencies:

```bash
git worktree add /tmp/candidate <sha>
cd /tmp/candidate && npm ci
node <this-repo>/scripts/ci/rehearse-candidate-migrations.mjs \
  --candidate-dir /tmp/candidate \
  --baseline-dir <this-repo>/prisma/migrations \
  --admin-url postgresql://user:pass@localhost:5432/postgres
```

---

## 7. Disposition

| Question | Answer |
|---|---|
| Do both migrations apply on PostgreSQL 18, in order, with the preceding history? | **Yes** — verified twice |
| Is the ledger complete and correct? | **Yes** |
| Do the promised columns, indexes, PK and FK exist with the promised shape? | **Yes** |
| Does a failed migration fail loudly and get recorded? | **Yes** — negative control passes |
| Does the candidate still build, typecheck and test? | **Yes** — 2569 tests pass on a seeded, migrated database |
| Does the candidate introduce new schema drift? | **No** |
| Does this authorise merging or rebasing PR #49? | **No.** That is an owner decision and is still `BLOCKED` pending authorization |
