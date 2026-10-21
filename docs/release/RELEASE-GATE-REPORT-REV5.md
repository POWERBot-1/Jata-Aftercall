# Release gate — Rev. 5 closeout

**Date:** 2026-10-21
**Repository:** `POWERBot-1/Jata-Aftercall` · `main` @ `2575cf461d33476a6bf8edb44fc56dc63498152a` (unchanged all phase)
**Branch:** `arena/7486dc85-jata-aftercall`
**PR #49:** OPEN, head `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` — **untouched**: no commit, no rebase, no force-push, no modifying comment
**PR #50:** OPEN, base `main`
**Supersedes:** nothing. Rev. 3 (`docs/release/RELEASE-GATE-REPORT.md`) and Rev. 4 (`docs/release/RELEASE-GATE-REPORT-REV4.md`) are preserved byte-identically; this document is added alongside them.

---

## 0. Verdict

# `BLOCKED — NOT APPROVED TO MERGE OR DEPLOY`

The engineering state improved materially this phase: **D2 is closed with
candidate-specific evidence**, the schema reconciliation is now verified on both
sides of every divergence, and three defects were found in the checkers
themselves and fixed. The release remains blocked for the same four reasons, none
of which is an engineering task this session may perform:

1. **Schema reconciliation is not landed.** The patch is verified and green, but it
   lives in no pull request (§4).
2. **PR #49 still needs an owner decision.** No rebase is authorized; the gate has
   never run on its own head (§3).
3. **Branch protection is still off.** `protected: false`, zero rulesets (§5).
4. **Production is unverified.** The smoke workflow has never executed, and
   recovery is `BLOCKED` / `NOT TESTED` (§6).

A green gate is evidence about the gate, not about the release.

---

## 1. Verification of the prior evidence — what was actually checked

### 1.1 Repository state at the start of this phase

| Item | Reported in the order | Actually observed | Discrepancy |
|---|---|---|---|
| HEAD | `2f14f21` | **`2575cf4`** on the working tree, with all 33 changed files present as **untracked** | **yes** — the environment had reverted the checkout to `main` for the third time this project |
| Remote branch | `2f14f21` | **`2f14f21`** (`git ls-remote`) | none |
| Working tree | — | clean after recovery; nothing lost | none |

Recovery was performed without discarding anything: the 33 untracked files were
hashed and compared against `FETCH_HEAD` (all 33 byte-identical, 0 mismatched, 0
absent), a tar backup was written first, and only then was the branch ref moved
back to `2f14f21`. No `reset --hard`, no `clean`.

### 1.2 Workflow run IDs — every one re-queried against the API

| Run | Workflow | Conclusion | Tested commit | Matches the claim |
|---|---|---|---|---|
| `39512281670` | Release Validation | success | `093bf0e77` | yes |
| `39512621216` | Release Validation | success | `cb3e456da` | yes |
| `39514949695` | Release Validation | success | `b1c78ab02` | yes |
| `39515568308` | Release Validation | success | `12032e781` | yes |
| `39516724193` | Release Validation | success | `295cde2cd` | yes |
| `39517037522` | Release Validation | success | `a500c188a` | yes |
| `39518438870` | Release Validation | success | `0aede82d1` | yes |
| `39518712800` | Release Validation | success | `04a23fdc8` | yes |
| `39519971092` | Release Validation | success | `2f14f21c7` | yes |
| `39505559225` | Interactive Business E2E | success | `9ef3c08db` | yes |
| `39505943097` | Interactive Business E2E | **failure** | `47f5ed9ce` | yes — failed at *Hydration 418 controlled race reproduction*, steps 19–23 skipped |
| `39508574479` | Interactive Business E2E | success | `e2a12a1cb` | yes |
| `39515568217` | Interactive Business E2E | success | `12032e781` | yes |
| `39518712792` | Interactive Business E2E | success | `04a23fdc8` | yes |
| `39516190207` | candidate-migration-rehearsal.yml | failure | `88f6fe6ff` | yes — **0 jobs**, workflow never loaded |
| `39516374243` | Candidate migration rehearsal | failure | `af5991840` | yes |
| `39516724250` | Candidate migration rehearsal | failure | `295cde2cd` | yes |
| `39517037339` | Candidate migration rehearsal | failure | `a500c188a` | yes |
| `39518438957` | Candidate migration rehearsal | success | `0aede82d1` | yes |
| `39518712777` | Candidate migration rehearsal | success | `04a23fdc8` | yes |
| `39519971263` | Candidate migration rehearsal | success | `2f14f21c7` | yes |

All 22 claims hold. The E2E failure claim was verified at **step level**, not from
the workflow configuration: step 18 failed, steps 19–23 skipped, steps 1–17
succeeded.

### 1.3 Logs and artifacts — the standing limitation, restated with evidence

| Retrieval path | Result |
|---|---|
| `gh run view 39519971092 --log` | **EOF** from `results-receiver.actions.githubusercontent.com` |
| `gh run download 39519971263 -n candidate-rehearsal-logs` | **EOF** from `productionresultssa0.blob.core.windows.net` |
| Checks API annotations | **works** |

The log and artifact channels are unreachable from this sandbox (blob-storage
egress), which is not a permissions problem and is not fixable from here.
Everything load-bearing in this report therefore comes either from the **checks
API** or from **recomputation in the workspace** — never from a log that was
assumed rather than read. Where a conclusion is inferred from workflow
configuration rather than observed output, it is labelled as such (§3.2).

### 1.4 Checksums — recomputed, all 13 match

Rev. 4's evidence index was re-validated by recomputing every SHA-256 from the
files in the commit: **13 of 13 MATCH**. Rev. 3 was separately proven
byte-identical to its original blob (`3181aef6…` at `cb3e456` and at HEAD).

Rev. 4 correctly declined to state its own digest. That gap is now closed
properly, without a self-reference: `docs/release/EVIDENCE-MANIFEST.sha256` lists
every artifact **except itself**, and

```
sha256sum -c docs/release/EVIDENCE-MANIFEST.sha256
node scripts/ci/verify-evidence-manifest.mjs
```

both verify it. The verifier additionally knows which artifacts are *required*
(so a manifest that quietly lost an entry fails), rejects duplicates, and
**rejects a manifest that lists itself** — the exact fixed-point problem being
avoided. Nine unit tests cover it.

---

## 2. D2 — closed, with candidate-specific evidence

D2 was the one defect a passing run on `main` could never close, because PR #49's
head predates `release-validation.yml` entirely.

A second job was added to `candidate-rehearsal.yml`. It checks PR #49's commit
out **read-only** into a separate directory, copies the checking scripts in as
untracked files (so they resolve the candidate's own `node_modules`), and runs the
build path, the audit and the controls **against that tree**.

**Run `39544687883` on `50e9e0e` — both jobs `success`.** The D2 job, step by step:

| Step | Result |
|---|---|
| Assert the checked-out commit is the one the run names | PASS — `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` |
| `npm ci` from the candidate's own lockfile, client generated | PASS |
| `npm audit --omit=dev` with the exit code captured under `set +e` | PASS — exit 0, report written |
| Classify the audit | `production tree: PASS — 0 findings`; `full tree (reported, not gating): FAIL — 6 findings: 6 high` |
| Controls 7/8 — findings ⇒ FAIL, unreadable report ⇒ BLOCKED, missing exit code ⇒ BLOCKED | PASS |
| **Production build** (`build.sh`: guard → migrate → generate → next build) | PASS — exit 0 |
| Build log proves the gate ran on *this* history | PASS — guard allow code, **18 migrations applied**, no password in the log |
| Ledger + 13 declarative expectations against the build's own database | PASS — 18 rows, verifier exit 0 |
| Build artifact present | PASS — `.next/BUILD_ID`, `.next/server` |
| Control 1 — broken migration must fail the build | PASS — non-zero, never printed "Build completed successfully", migrations byte-identical afterwards |
| Control 2 — verifier refuses an unmigrated schema | PASS |
| Control 3 — guard refuses a Production claim on an unenrolled target | PASS — `REFUSED_PRODUCTION_UNKNOWN_TARGET`, prisma never invoked |
| Control 4 — guard allows the same database as CI | PASS — the refusal is not simply always-red |
| The candidate tree was not modified | PASS — no tracked file changed |

**Disposition: `CLOSED` for the migrations, build path, audit and controls on
PR #49's exact tree.** What it does **not** cover, and still does not: the E2E
browser journey has not run on PR #49's head, and PR #49's own status is still
whatever its last run said. This is evidence *about* `5996229`, not a green
check on PR #49.

### 2.1 Three defects this closed — all in the harness, none in PR #49

| # | Symptom | Real cause | Fixed in |
|---|---|---|---|
| 1 | `verify-migrations.mjs` rejected a correctly migrated candidate database | `conrelid::regclass::text` renders `"PasswordResetToken"` **with quotes**, so the only constraint expectation in the repository never matched. Dormant on `main` because that migration is absent there | `50e9e0e` |
| 2 | The D2 step died with "exit code 1" and no reason | the step relied on `pipefail` to abort, discarding the output | `50e9e0e` |
| 3 | The justification check failed with no annotation | the reconciliation job never ran `prisma generate`, so the check could not import `@prisma/client` | `75be6b9` |

**The first one is the most consequential finding of this phase.** After a rebase,
the release gate would have gone red on PR #49 and the failure would have read
"the foreign key is missing" — sending the next person to inspect correct SQL.
Two regression tests now pin both directions.

---

## 3. The candidate migration rehearsal — independently re-verified

`39519971263` (`2f14f21`) and `39518438957` (`0aede82d1`) both `success`.

### 3.1 Direct evidence (observed, not inferred)

From the checks API on `39518712777` and `39519971263`:

```
RESULT: PASS
50 PASS, 0 FAIL, 0 BLOCKED
PASS the ledger names the directories exactly
PASS both application paths produce an identical catalog inventory — 2066 inventory lines
PASS the failure control is complete — non-zero deploy, recorded failure, non-zero status
PASS the candidate's drift is the recorded pre-existing debt and nothing else — 12 recorded finding(s)
PASS the candidate seed runs against the migrated database
PASS the candidate test suite passes — 2569 passed (2569)
```

Each of the eight points the order asks about:

| Claim | Verdict | Basis |
|---|---|---|
| The exact candidate SHA was tested | **PASS** | the workflow asserts `git rev-parse HEAD == CANDIDATE_SHA` before anything runs and fails otherwise; step "Assert the rehearsal is about the intended commit" = success |
| PostgreSQL version and isolation documented | **PASS** | `postgres:18` service container, database `jata_ci`, destroyed with the runner; the script refuses any non-loopback host and only creates `jata_rehearsal_*` |
| All 18 migration directories correspond to the ledger | **PASS** | named check: "the ledger names match the directories exactly"; manifest `10548136…` (18) vs baseline `da3fe048…` (16) |
| `migrate deploy` and the independent catalog comparison executed | **PASS** | two separate sections; the second replays the same 18 files with `psql -f` |
| The 2,066 inventory lines came from the documented command | **PASS** | `canonicalInventory()` over `SNAPSHOT_SQL`; equal line counts both ways |
| The negative control fails for the intended reason | **PASS** | three independent conditions: non-zero deploy, failed row with logs, non-zero `migrate status` saying "failed". A wrong-reason failure cannot satisfy all three |
| 12 pre-existing drift findings, no new drift | **PASS** | parsed with the repository's own `check-schema-drift.mjs` against the committed baseline: 12 matched, 0 new, 0 absent |
| 2,569 test passes came from the candidate tree | **PASS** | `npm run test` executed with `cwd=candidate` after `npm run seed`; the rehearsal re-hashes the candidate migrations at the end to prove it was read-only |

### 3.2 Inferred, not observed — labelled as such

* The **step timings and ordering** come from the jobs API (observed).
* The **contents of `/tmp/*.log`** were never read; the counts above come from
  annotations the workflow promotes specifically because artifacts are
  unreachable. This is a deliberate design decision, now documented in the
  workflow, and it is why the numbers are quotable at all.
* The rehearsal's claim that the database is disposable rests on the service
  container definition plus the script's loopback guard. Both are visible in the
  source; neither was independently audited by a third party.

### 3.3 Discrepancy corrected in a dated addendum

`PR49-REHEARSAL-RESULTS.md` §5 previously said the candidate's own harness
(`scripts/test-local-postgres-migrations.mjs`) was "NOT TESTED" for lack of a
hand-initialised cluster. That stands. What is added: the harness requires
`data_directory` to equal `<cwd>/.cache/audit-tools/pgdata` — a literal path
comparison — so a service container cannot satisfy it by construction, not merely
by accident. The rehearsal above is also strictly broader: it applies the whole
18-migration chain and checks the ledger, which the candidate harness does not.

---

## 4. Schema reconciliation — verified; PR still not opened

### 4.1 Patch integrity, recomputed from scratch

| Check | Result |
|---|---|
| SHA-256 | `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29` — **matches** |
| Size / shape | 3,311 bytes, **7 hunks**, **1 file**, no DDL |
| Base blob vs header (`398ecdd`) | `398ecdd52335e322d434b149165667742b8c1eb2` — **matches** |
| Applies to `main@2575cf4` | `patch -p1 --dry-run` — **PASS**, no fuzz |
| Result blob vs header (`25e45c3`) | `25e45c3afe584c7ac35f51b558cc1b73183a1b09` — **matches** |
| Result SHA-256 | `440027c4fcb10e0f3d2de3f2c7ec1e540ffdc5d9b6283329bfb9af05988d8bfd` |

Both blob identities in the patch header reproduce exactly. A patch that silently
touched one extra line could not do that.

### 4.2 Zero drift does not conceal anything — now actually tested

The gate previously proved only that `migrate diff` returns nothing after the
patch. That is satisfiable by a patch that *invents* an object the database does
not have. `scripts/ci/verify-reconciliation-justification.mjs` now checks both
sides of all six divergences — the database must contain the object, and the
patched datamodel must assert it — and runs **after** the patch is applied.

**Result: PASS**, gate `39545282950` on `3c541a1`. Ten of the thirteen checks are
visible as annotations, quoted verbatim:

```
PASS 1. MediaAsset.updatedAt has a database default of the current time
PASS 2. PaymentAttempt.businessId has a CASCADE foreign key to Business
PASS 3. PaymentDestination.capabilities has a database default
PASS 4. PaymentDestination's unique index declares the database's truncated name
PASS 5. PaymentProviderConnection.capabilities carries @default([])
PASS 6. PosReceiptSequence.businessId is @id (the database's primary key)
PASS 1. MediaAsset.updatedAt carries @default(now())
PASS 2. PaymentAttempt declares the business relation to Business
PASS 3. PaymentDestination.capabilities carries @default([])
PASS 6b. PosReceiptSequence no longer also declares @unique on the same column
```

(The two lists are the database side and the datamodel side respectively; the
fourth datamodel-side check, item 4's `map:`, is covered by the run's PASS but
was beyond the annotation cap.)

Application-level effects, stated as effects and not as approvals:

| Edit | Effect on application code |
|---|---|
| `MediaAsset.updatedAt @default(now())` | inserts no longer need an explicit `updatedAt`; existing behaviour unchanged |
| `PaymentAttempt.business` relation | the generated client gains a traversable `business` field; no column change |
| `capabilities @default([])` ×2 | the field becomes optional on create; existing code that always passes it is unaffected |
| unique-index `map:` | client-side index name only; the database is unchanged |
| `PosReceiptSequence.businessId @id` | the client's `findUnique` target is the same column that is already the primary key |

### 4.3 Status of the PR itself

**Not opened.** The limitation is **session policy, not permission**, and the
distinction was verified rather than assumed: the authenticated identity has
`admin: true` and `push: true`, and `git push --dry-run origin
HEAD:refs/heads/schema-reconciliation-probe` reported `* [new branch]`. This
session is instructed to work only on its own branch, so it does not create
another.

Consequently `docs/schema-reconciliation/PR-BUNDLE.md` carries the exact
three-command procedure and the complete PR body (`PR-BODY.md`), re-verified this
phase with the addendum in §7 of that file.

**Still required before that PR can merge** (it must go green on its own head):
`prisma generate`, `typecheck`, and the full suite against PostgreSQL 18 with the
six divergences reconciled.

---

## 5. Branch protection — still off; the staging changed

Re-verified against the live API this phase. **No setting was changed.**

| Fact | Value |
|---|---|
| `main` protected | **`false`** |
| Rulesets | **`[]`** |
| Effective rules on `main` | **`[]`** |
| Classic protection endpoint | **403** — cannot read it with this integration |
| Environment `Preview` / `Production` | **0** rules each |

**The finding that changes the proposal.** PR #49's head predates
`release-validation.yml`, so it produces only `Journey against a real database`
and `Migration target guard`. Requiring `Release gate (aggregate)` now would
deadlock it permanently: a missing required check blocks a merge, and no rebase is
authorized.

Corrected staging:

* **Stage 1 (safe today):** require only the two checks **both** open PRs already
  produce; require a pull request; block force-push and deletion.
* **Stage 2 (after this branch merges):** add `Release gate (aggregate)` — the
  aggregate only.
* **Never require:** `PR #49 candidate applies…` and `D2 — build, audit and
  controls…`. They inspect a *foreign* commit; requiring them means a PR can fail
  because an unrelated open PR changed.

Until `GET /branches/main` returns `protected: true`, this report does **not**
claim protection is enabled. A User-owned repository has no organization ruleset
to backstop an admin bypass; the proposal says so.

---

## 6. Production smoke and recovery

### 6.1 The four states the order asks to distinguish

| State | Verdict | Evidence |
|---|---|---|
| Workflow file present on a live branch | **PASS** (branch only) | present on `arena/7486dc85-jata-aftercall`; **404 on `main`** |
| Configured with the intended trigger | **PASS** | `deployment_status` + `workflow_dispatch`, `permissions` read-only, GET-only |
| Successful execution | **NOT TESTED** | **zero runs** for the current file (`2368c9b1…`) |
| Successful verification against production | **NOT TESTED** | never |

The two historical runs on 2026-10-05 (`37346581033`, `37346850939`) are **not**
evidence for this file: they belong to a *different* file (`5084de11…`) on a now-
deleted branch (`arena/01a10b8d-jata-aftercall`), triggered by `push`. They do
show that a read-only production probe succeeded from a GitHub runner 16 days
ago — useful context, not a current result.

### 6.2 Why it cannot be run from here (two independent blockers)

1. **Network.** `curl` to `https://jata-aftercall.vercel.app/` fails with
   `SSL_ERROR_SYSCALL` (exit 35) in 0.05 s. This sandbox has no TLS path to
   `*.vercel.app`. It is a sandbox boundary, not a production outage — and per
   the order it was probed **once**, error preserved, and not repeated.
2. **Dispatch.** `gh workflow run production-smoke.yml` returns **HTTP 403**:
   `Resource not accessible by integration`. GitHub only dispatches
   `workflow_dispatch` workflows that exist on the **default branch**, and the
   token lacks `actions:write` regardless. The workflow is registered and
   `active`, but not dispatchable from a feature branch.

**Required external verification:** an owner runs it from `main` after this
branch merges, or from the Actions UI (`workflow_dispatch`, GET-only). Until
then it must not be described as active protection.

Latest production deployment remains `7154099992` (Production, `2575cf46`,
2026-10-18) — i.e. production runs `main`, not either PR.

### 6.3 Recovery — unchanged, and honestly labelled

| # | Question | Label |
|---|---|---|
| R1 | `production` is a root branch | **PASS** (owner console observation) |
| R2 | Actual restore range / PITR | **BLOCKED** — never observed |
| R3 | Manual snapshot exists | **BLOCKED** — never observed |
| R4 | History retention | **PASS** — 6 hours (owner console observation) |
| R5 | Restore ever rehearsed | **NOT TESTED** |

No snapshot was created, no restore attempted, no retention changed, no cost
incurred. The Neon connector is `unsupported` for this session, `api.neon.tech`
does not resolve, and no credential exists — so no independent verification is
possible from here.

**The `$0` claim is corrected in wording.** What exists is a list-rate
calculation (`$0.09/GB-month × 0.0447 GB ≈ $0.0041/month`, Free plan has no
monthly charge) — arithmetic against a published rate, never an observed invoice.
Label: **NOT TESTED**.

The console steps an authorized operator must perform are listed in
`docs/NEON-RECOVERY-READINESS.md` (addendum, 2026-10-21).

---

## 7. What this phase changed, with the run that proves each

| Commit | Change | Evidence |
|---|---|---|
| `d1ec6a4` | D2 job: build path, audit, four controls on PR #49's tree; `check-workflow-expressions.mjs` + 8 tests wired into the gate | `39544687883` (both jobs success) |
| `77f982e` | reconciliation justification check (both sides of six divergences) + 7 tests | `39545282950` |
| `50e9e0e` | **gate defect fixed**: constraint tables compared without identifier quoting + 2 regression tests | `39544687883`, `39545282950` |
| `75be6b9` `3c541a1` `f7b924a` | generate the client before the justification check; failures and passes both promoted to annotations | `39545282950` (6/6), `f7b924a` gate success |
| `03ef35a` | bundle / protection / recovery addenda | docs only |
| this commit | Rev. 5 report, `EVIDENCE-MANIFEST.sha256`, manifest verifier + generator, 9 manifest tests | see §8 |

Gate self-tests: **277 tests across 14 files**, all passing locally and in CI
(was 251 at Rev. 4, 38 when the gate was first delivered).

---

## 8. Evidence index

`docs/release/EVIDENCE-MANIFEST.sha256` is the authoritative checksum record and
deliberately **does not list itself**. Verify with either:

```
sha256sum -c docs/release/EVIDENCE-MANIFEST.sha256
node scripts/ci/verify-evidence-manifest.mjs
```

The manifest covers Rev. 3, Rev. 4, this report, the rehearsal results, the
PR #50 review, the protection proposal, the PR #49 plan, the whole
`docs/schema-reconciliation/` set, the recovery readiness document, the gate
proposal, all three workflows, and the `scripts/ci/*` artifacts that carry the
claims — **28 files**. It is generated by
`scripts/ci/generate-evidence-manifest.mjs` from the verifier's own
`REQUIRED_ARTIFACTS` list, so the manifest and the verifier cannot drift apart,
and `--check` mode fails when an artifact changes without regeneration. The gate
runs that check, which is how this document's own edits are kept honest.

Two digests are quoted here because they are externally checkable and do not
depend on this file:

* Rev. 3 report — `34517a4a77825f214e1e425431d0afddc8c4e8b32b2467417ab621c6b3055f7f`
* reconciliation patch — `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29`

Run IDs used by this report: gate `39545031422` (failed), `39545282950` (6/6),
`39544687911` (failed); rehearsal/D2 `39544372752` (cancelled),
`39544687883` (both jobs success); E2E `39544687931`. Earlier runs are
tabulated in §1.2, and each was re-queried against the API rather than taken
from the previous report.

---

## 9. Remaining owner decisions

1. **PR #49** — authorize a rebase (procedure in `docs/release/PR49-REVALIDATION-PLAN.md`), close it, or merge as-is. This review recommends none of the three; it reports that the migrations, build path, audit and controls are now proven on that exact tree, and that the E2E journey is not.
2. **Schema reconciliation** — open the PR from `docs/schema-reconciliation/PR-BUNDLE.md` and let it go green on its own head (§4.3).
3. **Branch protection** — approve Stage 1 now, Stage 2 after merge (§5).
4. **Production smoke** — run it from `main` after merge, or record it as `NOT TESTED` for this release (§6).
5. **Deployment boundary** — answer the eight questions in `docs/RELEASE-GATE-PROPOSAL.md`.
6. **Recovery** — decide whether R2/R3/R5 stay `BLOCKED` for this release, or authorize a scratch-branch restore rehearsal (§6.3).

---

## 10. No-change confirmation

This phase did not: merge, close, rebase, force-push or modify PR #49 or PR #50;
push to `main`; deploy; run a production migration; read or mutate production
data; take a snapshot; change retention; change any repository setting,
protection rule, environment rule or collaborator; weaken or skip a required
check; suppress a vulnerability; force an audit exit code; edit the migration
ledger or the drift baseline; create a branch other than to verify that the
credential could.

Unverified capabilities remain unverified and are not to be claimed: durable
media storage, SMTP delivery and password recovery, live payment-provider flows,
physical-device acceptance, and production Core Web Vitals.
