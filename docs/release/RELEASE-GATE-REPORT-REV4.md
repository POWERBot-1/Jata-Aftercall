# Release gate — remediation report, Rev. 4

**Date:** 2026-10-21
**Repository:** `POWERBot-1/Jata-Aftercall` · `main` @ `2575cf461d33476a6bf8edb44fc56dc63498152a`
**Review branch:** `arena/7486dc85-jata-aftercall`
**Head at the time of writing:** `04a23fdc89b083fc28b33dcdd100974f11590db7` (+ this document)
**Supersedes:** Rev. 3 — `docs/release/RELEASE-GATE-REPORT.md`, SHA-256 `34517a4a77825f214e1e425431d0afddc8c4e8b32b2467417ab621c6b3055f7f`. Rev. 3 is preserved unmodified; this document does not replace it.
**PR #50:** open, head `04a23fd…`, base `main`, 31 files, not merged.
**PR #49:** open, head `59962291ec82d5ddbc8f323e3d057d6a5b15cf02`, base `main`, **untouched** — no commit, no rebase, no comment that changes it.

---

## 0. Verdict

# `BLOCKED — NOT APPROVED TO MERGE OR DEPLOY`

The gate is green on the current head. The candidate migration rehearsal is green. The E2E
journey is green. **None of that makes the release safe**, and the reasons are unchanged from
Rev. 3:

1. Two schema-side divergences from the six never got a migration; the reconciliation patch
   that closes all six exists and is proven, but it is not in any PR.
2. PR #49 still needs an owner decision — it has not been rebased, and no run of the release
   gate has ever executed on its head.
3. Branch protection is still `protected: false` with zero rulesets. Nothing forces any check
   to pass.
4. Recovery is documentation only: no restore has ever been rehearsed, no snapshot has been
   observed, and the production database has not been read by this review.
5. Production itself is unverified: the smoke workflow exists on this branch but has never run
   against production from here, and the production origin is unreachable from this sandbox.

---

## 1. What changed since Rev. 3

| Commit | What it does | Run that proves it |
|---|---|---|
| `b1c78ab` | D1 fixed (`set +e` capture + `summarise-audit.mjs` classifier, Controls 7–8); D6 fixed (manifest before/after the build); D3 `--from-url` → `--from-schema-datasource`; D4 `cp -a .` → `git archive`; D5 placeholder annotated at the use site | `39514949695` — 6/6 |
| `12032e7` | `production-smoke.yml` restored as a read-only workflow, with `scripts/ci/smoke-production.mjs` and 11 tests | `39515568308` — 6/6 |
| `88f6fe6` | PR #49 candidate rehearsal: workflow + `scripts/ci/rehearse-candidate-migrations.mjs` + 10 tests | `39516190207` — **load failure**, see §4 |
| `af59918` | fixes the YAML scalar that made GitHub reject the workflow | `39516374243` — job ran, failed on two harness bugs |
| `295cde2` | annotations for FAIL/BLOCKED/DIFF lines; uncaught errors become BLOCKED; installs `psql` if absent | `39516724250` — failed, but self-describing |
| `a500c18` | fixes the constraint query (`regclass` quoting) and classifies drift against the recorded baseline; prints failing test names | `39517037339` — down to two failures, both harness |
| `0aede82` | seeds the disposable database before suites; identifier-insensitive constraint comparison; workflow renamed so it registers under its declared name | `39518438957` — **PASS** |
| `04a23fd` | promotes the verdict counts and the load-bearing checks to annotations, so a green run is auditable | `39518712777` — **PASS**, 50 checks |

The last two commits are the difference between "the job was green" and "here is what it
checked".

---

## 2. Defect disposition — D1 to D7

Severity and evidence for each are in `docs/release/PR50-REVIEW.md`. That document is a
point-in-time review of `e2a12a1` and is preserved as written; this table is the current
disposition.

| ID | Severity | Status | Evidence |
|---|---|---|---|
| **D1** — `npm audit` exiting 1 killed the step before the reporter ran, leaving an empty log exactly when it mattered | Medium | **FIXED** | `set +e` capture of the real exit code, `scripts/ci/summarise-audit.mjs` separating *completed with findings* (FAIL) from *could not run* (BLOCKED), plus Control 7 (findings ⇒ FAIL) and Control 8 (no result ⇒ BLOCKED). 13 unit tests. Verified in `39518712800` |
| **D2** — the gate cannot run on PR #49, whose head predates the workflow | High (release-blocking by design) | **MITIGATED, NOT CLOSED** | `candidate-rehearsal.yml` now executes PR #49's migrations, ledger, schema, failure control, typecheck and 2569 tests on a disposable PostgreSQL 18 (§3). It does **not** run the full gate (build path, audit, negative controls) on PR #49's tree, and it does not make PR #49's own head greener — it runs on the reviewing branch and checks the candidate out read-only |
| **D3** — the drift check passed the database credential in `argv` | Low | **FIXED** | `--from-schema-datasource prisma/schema.prisma` (4 call sites); the URL is read from the environment by Prisma, never from the command line |
| **D4** — Control 1 copied `node_modules` into a temp tree only to delete it | Low | **FIXED** | `git archive` of the tracked tree |
| **D5** — the placeholder `DATABASE_URL` in `static-checks` could be reused by a future step | Low | **FIXED** | annotated at the use site with an explicit "do not reuse; set your own real URL" note |
| **D6** — the build never named the migration history it built against | Medium | **FIXED** | `migration-manifest.mjs` records count + per-file SHA-256 + one digest before and after the build; the build job logs `16 migrations, manifest <sha>` and fails if the digest changes |
| **D7** — `scripts/ci/authorize-migration.mjs` is inert until adopted | Low | **DOCUMENTED, BY DESIGN** | the authorizer refuses by default, is tested (8 tests), and is deliberately not wired into `scripts/build.sh`; adoption is a separate owner decision (`docs/RELEASE-GATE-PROPOSAL.md`, 8 questions) |

No defect is reported as fixed without a run that exercised it.

---

## 3. New this phase — the PR #49 migration rehearsal

Full detail: **`docs/release/PR49-REHEARSAL-RESULTS.md`**.

Run [`39518712777`](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/39518712777) on
reviewing commit `04a23fd`, candidate `5996229…`, disposable `postgres:18`:

```
RESULT: PASS
50 PASS, 0 FAIL, 0 BLOCKED
PASS the ledger names match the directories exactly
PASS both application paths produce an identical catalog inventory — 2066 inventory lines
PASS the failure control is complete — non-zero deploy, recorded failure, non-zero status
PASS the candidate's drift is the recorded pre-existing debt and nothing else — 12 recorded finding(s)
PASS the candidate seed runs against the migrated database
PASS the candidate test suite passes — 2569 passed (2569)
```

What it establishes:

* the full 18-migration history applies in order on PostgreSQL 18 (candidate manifest
  `10548136…`, baseline `da3fe048…`, two added migrations with `migration.sql` SHA-256
  `209a1e29…` and `af197ddf…`);
* the ledger has one finished, non-rolled-back, log-free row per directory and no orphan rows;
* 15 declarative object expectations hold (9 columns, 1 table, 3 indexes, 1 PK, 1 FK with
  `ON DELETE CASCADE` / `ON UPDATE CASCADE`);
* applying the same files with `psql -f` reaches a byte-identical catalog (2066 inventory
  lines) — the result is a property of the SQL, not of the CLI;
* a deliberately broken migration exits non-zero, is recorded as failed with logs, and makes
  `migrate status` exit non-zero;
* the candidate still generates a client, seeds, typechecks and passes its own suite.

What it does **not** establish: anything about Neon (branching, PITR, compute), production
data volumes, browser journeys, payments, SMTP or storage. PR #49 still needs an owner
decision to rebase, and the rehearsal deliberately does not make it.

---

## 4. Two failures worth keeping in the record

The rehearsal workflow failed three times before it passed, and none of those failures was a
defect in PR #49:

* **`39516190207`** — GitHub refused the workflow file at load time (0 jobs): an unquoted YAML
  scalar meant `CANDIDATE_LABEL: ${{ … 'PR #49' }}` was truncated at the `#`, so the closing
  `}}` was commented out. A generic YAML parser accepted the file. A valid parse is not a
  valid workflow.
* **`39516724250` / `39517037339`** — the checker accused the candidate of missing constraints
  (it was matching against `"PasswordResetToken"` *with* quotes, because `conrelid::regclass`
  quotes mixed-case identifiers) and of failing tests (the rehearsal had not seeded the
  database the tests assert against).

Both are recorded in §4 of the rehearsal results document. They are the reason the workflow
now promotes its verdict to annotations: the log artifact uploaded by run `39516374243` could
not be downloaded from this environment, and a failure nobody can read is a failure nobody can
act on.

---

## 5. Work completed and tested (evidence, not claims)

| Item | Evidence | Label |
|---|---|---|
| Release gate green on the current head, 6/6 jobs | run `39518712800` on `04a23fd` | **PASS** |
| Release gate green on the previous three heads | `39518438870`, `39517037522`, `39516724193` | **PASS** |
| Interactive Business E2E green on the current head | run `39518712792`, 10m37s | **PASS** |
| PR #49 rehearsal green, reproducible on two heads | `39518712777`, `39518438957` | **PASS** |
| Failure control: a broken migration fails, is recorded, and is reported | rehearsal section 7 | **PASS** |
| Gate self-tests | 261 assertions across 11 files (`node --test scripts/__tests__/*.test.mjs`), all passing locally and in `39518712800` | **PASS** |
| CI work does not touch production | every `DATABASE_URL` is a service container; no secret is present; `permissions: contents: read` | **PASS** |

**Hydration flake, restated:** the E2E run failed at the Hydration 418 step on `39505943097`
and passed on `39505559225`, `39508574479` and now `39518712792`. That is a flake, not a fix.
It is recorded, not explained away.

---

## 6. Proposed, not implemented

| Item | State | Why it is not done |
|---|---|---|
| Schema reconciliation PR (closes all six divergences) | patch `docs/schema-reconciliation/reconciliation.patch`, 3,311 B, 7 hunks, SHA-256 `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29`; proven to produce zero drift on PG18 by job `schema-reconciliation-proposal` | this session can push only to its own branch; a separate PR needs a second branch and an owner to open it. The three-command procedure is in `docs/schema-reconciliation/PR-BUNDLE.md` |
| Production smoke workflow | `production-smoke.yml` exists on this branch, registered and active (workflow `375640098`), GET-only, 11 tests | it has never run against production from here: the production origin is unreachable from this sandbox (`curl` exit 35). It is **NOT TESTED** against production, and it must not be described as active protection until it has run |
| Migration authorizer adoption | `docs/RELEASE-GATE-PROPOSAL.md`, eight questions, 8 tests, fails closed | an owner decision about how a schema change is authorised; deliberately not wired in |
| Branch protection | `docs/release/MAIN-PROTECTION-PROPOSAL.md` | requires explicit approval to change repository settings; see §7 |

---

## 7. Branch protection — unchanged, pending approval

Verified state (learned by API, not assumed): `protected: false`; rulesets `[]`; the classic
protection endpoint returns 403; environments `Preview` and `Production` carry **0** rules;
collaborators are `POWERBot-1` (admin) and `christine-kariuki` (write); the repository owner is
a **User** account.

Proposal, unchanged:

* **Stage 1 — now:** require `Journey against a real database` and `Migration target guard`
  (both exist on the current head and on `main` after the E2E history). Require a pull request,
  disallow force-push and deletion.
* **Stage 2 — after this branch merges:** additionally require `Release gate (aggregate)`. That
  check exists only once `release-validation.yml` is on `main`; requiring it before then
  deadlocks every PR.
* **Do not require** `PR #49 candidate applies on a disposable PostgreSQL 18`. It is a review
  aid that inspects a foreign commit, it is expected to change when PR #49 changes, and it is
  not a gate on the change under review.
* Administrators/bypassers: with a User-owned repository there is no organization ruleset to
  backstop an admin bypass. The transition must therefore be inspected after the change
  (`GET /branches/main/protection`), and "not enforced" must be reported as such if it is what
  the API returns.

No settings were changed in this phase.

---

## 8. Recovery checklist and deployment boundary — restated

`docs/NEON-RECOVERY-READINESS.md` holds the detail. Current labels, unchanged:

| # | Question | Label |
|---|---|---|
| R1 | Is `production` a root branch? | **PASS** (owner console observation) |
| R2 | Actual restore range / PITR availability | **BLOCKED** — never observed |
| R3 | Does a manual snapshot exist? | **BLOCKED** — never observed |
| R4 | History retention | **PASS** — 6 hours, console |
| R5 | Has a restore ever been rehearsed? | **NOT TESTED** |

The deployment boundary proposal asks eight questions
(`docs/RELEASE-GATE-PROPOSAL.md`) and is **PROPOSED**, not adopted. Two things must not be
misstated:

* the **$0 snapshot expectation is a list-rate calculation** ($0.09/GB-month × a worst-case
  45.73 MB), not a verified charge. No snapshot was taken, so nothing was billed and nothing
  was proven about billing;
* a restore changes the branch ID and **disables PITR on the restored branch**; that is a
  property of the mechanism, not a recommendation to restore.

---

## 9. Evidence index

| Path | What it is | SHA-256 |
|---|---|---|
| `docs/release/RELEASE-GATE-REPORT.md` | **Rev. 3**, preserved unmodified | `34517a4a77825f214e1e425431d0afddc8c4e8b32b2467417ab621c6b3055f7f` |
| `docs/release/RELEASE-GATE-REPORT-REV4.md` | this document | (computed at commit) |
| `docs/release/PR49-REHEARSAL-RESULTS.md` | PR #49 rehearsal evidence | `d8fb6c4b4ed3fec9ef1d8ab06610890e7021465f609743dd77a07c66899aa52d` |
| `docs/release/PR50-REVIEW.md` | point-in-time review of PR #50 at `e2a12a1` | `9f0595f017d28f3fd53811cc7ae1d656e5b5180e58e57270c9c9ee1379e17aad` |
| `docs/release/MAIN-PROTECTION-PROPOSAL.md` | Stage 1/Stage 2 protection proposal | `77d1dae3570261626953921cdeb38ec3e00a7e54897362eec483ff35e8d77f18` |
| `docs/release/PR49-REVALIDATION-PLAN.md` | rebase plan and static pre-checks | `85f82947beddf8e315296082f4e1218f2d35b023c7f1b8a1280cf0824c23f535` |
| `docs/schema-reconciliation/reconciliation.patch` | 7-hunk reconciliation, applies to `main`@`2575cf4` | `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29` |
| `docs/schema-reconciliation/PR-BUNDLE.md` | three-command procedure to open the reconciliation PR | `b0ac370640b216e747993c5534fb6d32d428aad7424890a056e8523a6f5e8dda` |
| `scripts/ci/rehearse-candidate-migrations.mjs` | the rehearsal | `50e1e52aae33368de1b835504eb828ea5bea4d60a4dbffaf5731e49b3aabca3c` |
| `scripts/__tests__/rehearse-candidate-migrations.test.mjs` | 11 tests for the rehearsal | `a19b96d439d3905dbff2d3eec5abf6102873026c0b4f26de5a073c152aace339` |
| `.github/workflows/candidate-rehearsal.yml` | the rehearsal workflow | `636c288e8ec3cd124d22e86c6b04dd58c4eba4bc4928c78e816929a46117c4b0` |
| `.github/workflows/release-validation.yml` | the gate, 6 jobs | `72328bfcb68ae9cbfbc47c135525369849aee19e758ae2c5925138b4f4863b70` |
| `.github/workflows/production-smoke.yml` | read-only production smoke (never run against production) | `2368c9b1b0531fffe4295376c7795dfc951361e5d25aeefa29f96d5fe5823cf8` |
| `scripts/ci/schema-drift-baseline.json` | the six recorded divergences | `ffbdf47fb98964a455c6b1350d19cc35e1c8b7cd2ed61ee194933df54d6e81ee` |

Run IDs referenced by this report: gate `39512281670`, `39512621216`, `39514949695`,
`39515568308`, `39516724193`, `39517037522`, `39518438870`, `39518712800`; E2E `39505559225`,
`39505943097` (fail), `39508574479`, `39515568217` (superseded), `39518712792`; rehearsal
`39516190207` (load failure), `39516374243`, `39516724250`, `39517037339`, `39518438957`,
`39518712777`.

---

## 10. Risk register (carried forward, updated)

| Risk | Impact | State |
|---|---|---|
| Schema drift unresolved (6 divergences) | client types disagree with the database in six places | **OPEN** — patch proven, not landed |
| PR #49 unvalidated on its own head | merge would ship migrations nobody has run through the full gate | **OPEN** — rehearsal covers migrations + suite, not the gate |
| No branch protection | any force-push can rewrite `main`; no check is required | **OPEN** — proposal ready, needs approval |
| Recovery unproven | a bad deploy has no rehearsed restore path | **OPEN** — R2/R3/R5 BLOCKED/NOT TESTED |
| Hydration flake in E2E | a real regression could be mistaken for the flake, or vice versa | **OPEN** — 1 failure, 3 passes, no root cause |
| `braces@3.0.3` advisory, dev-only, no patched release | DoS in a build-time dependency | **ADVISORY** — reassess 2026-11-20 |
| Test harnesses can lie | six defects this phase were in the checkers, not the code | **MITIGATED** — 11 unit tests for the rehearsal, failure controls in the gate |

---

## 11. Owner decisions required

1. **PR #49** — authorize a rebase (procedure and acceptance criteria in
   `docs/release/PR49-REVALIDATION-PLAN.md`), or close it, or merge it as is. This review does
   not recommend any of the three; it reports that no decision has been made.
2. **Schema reconciliation** — open the separate PR from `docs/schema-reconciliation/PR-BUNDLE.md`
   and approve landing it before PR #49.
3. **Branch protection** — approve Stage 1, then Stage 2 after merge (§7).
4. **Smoke** — approve a first run of `production-smoke.yml` against production (`workflow_dispatch`,
   GET-only, no writes), or defer and record it as NOT TESTED.
5. **Deployment boundary** — answer the eight questions in `docs/RELEASE-GATE-PROPOSAL.md`.
6. **Recovery** — authorize a snapshot and a restore rehearsal in a scratch branch, and decide
   whether R2/R3/R5 stay BLOCKED for this release.

---

## 12. No-change confirmation

In this phase the review did **not**:

* push to `main`, or merge or close PR #49 or PR #50;
* rebase, comment on, or modify PR #49 in any way;
* deploy, migrate production, mutate a production database, or take a snapshot;
* change any repository setting, protection rule, environment rule or collaborator;
* weaken, skip or soften a required check to obtain green CI;
* suppress a vulnerability, force an audit exit code, or pass on missing audit results;
* delete, edit or empty `schema-drift-baseline.json`, or edit the migration ledger;
* claim any unverified capability — durable media storage, SMTP delivery and password recovery,
  live payment-provider flows, physical-device acceptance and production Core Web Vitals remain
  **unverified**.
