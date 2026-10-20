# Release gate — remediation report, Rev. 3

**Repository:** `POWERBot-1/Jata-Aftercall`
**Branch:** `arena/7486dc85-jata-aftercall` @ **`093bf0e77510755089dc3299647127f8128b6e18`**
**`main`:** `2575cf461d33476a6bf8edb44fc56dc63498152a` (unchanged)
**PR #50:** `OPEN`, head `093bf0e…`, 20 files — gate **6/6 green** on this exact head (run `39512281670`)
**PR #49:** `OPEN`, head `59962291ec82d5ddbc8f323e3d057d6a5b15cf02` — **untouched**
**Timestamp:** 2026-10-20T23:05Z

---

## 0. Verdict

# `BLOCKED — NOT APPROVED TO MERGE OR DEPLOY`

| Phase | Outcome |
|---|---|
| 1 — Protect `main` | **PROPOSED, awaiting approval** — nothing changed |
| 2 — Review PR #50 | **PASS (self-review)** — 7 defects, none fail-open |
| 3 — Schema reconciliation PR | **BLOCKED (session constraint)** — packaged as a ready-to-open bundle, validated on PG18 |
| 4 — Revalidate PR #49 | **PLAN ONLY** — rebase needs authorization; static checks pass |
| 5 — Recovery / deployment boundary | **BLOCKED** (recovery) / **PROPOSED** (boundary) |
| 6 — Evidence | **PASS** — this document |

---

## 1. Work completed

| Item | Evidence |
|---|---|
| Release-validation gate: 5 jobs + aggregate, 6/6 green | runs `39505943905`, `39508574563`, `39512281670` |
| 38 gate self-tests | `scripts/__tests__/*.test.mjs` |
| Six schema divergences classified and patched | `docs/schema-reconciliation/` |
| Reconciliation proven to yield **zero drift on PG18** | job `schema-reconciliation-proposal` |
| PR #50 reviewed | `docs/release/PR50-REVIEW.md` |
| `main` protection proposal | `docs/release/MAIN-PROTECTION-PROPOSAL.md` |
| PR #49 static pre-checks + rebase plan | `docs/release/PR49-REVALIDATION-PLAN.md` |
| Recovery readiness + migration boundary docs | `docs/NEON-RECOVERY-READINESS.md`, `docs/RELEASE-GATE-PROPOSAL.md` |

## 2. Work tested successfully

| Check | Result |
|---|---|
| Gate on `093bf0e` | **PASS** — 6/6, 23:02:30Z → 23:04:32Z |
| PostgreSQL 18 migration rehearsal | **PASS** — 18.6, 16/16 |
| Negative controls (5) + positive control (1) | **PASS** |
| Reconciliation patch → zero drift on PG18 | **PASS** |
| Patch applies to `main` @ `2575cf4` | **PASS** |
| Six schema divergences classified | **PASS** |

## 3. Work proposed but not implemented

- `main` ruleset (Phase 1) — **PROPOSED**
- Schema reconciliation PR (Phase 3) — **BUNDLED, not opened**
- PR #49 rebase (Phase 4) — **PLANNED**
- `MIGRATE_ON_BUILD` boundary (Phase 5) — **PROPOSED**

## 4. Work blocked

| Item | Blocker |
|---|---|
| Neon recovery verification (R2/R3) | no Neon connector; `api.neon.tech` unresolved |
| Neon migration rehearsal | requires a console-created branch |
| Separate reconciliation PR | session is bound to one branch |
| PR #49 revalidation | rebase requires owner authorization |

---

## 5. Phase 1 — `main` protection

### Verified state

| Item | Value |
|---|---|
| `main.protected` | **`false`** |
| Rulesets | **`[]`** |
| Classic protection | unreadable — `403 Resource not accessible by integration` |
| Environments | `Preview`, `Production` — both **0 protection rules** |
| Collaborators | `POWERBot-1` (admin), **`christine-kariuki` (write)** |
| Owner type | User account |

### Proposal (detail in `docs/release/MAIN-PROTECTION-PROPOSAL.md`)

Two-stage rollout, because a hard cutover deadlocks PR #49:

| Stage | Required checks | Effect on PR #49 |
|---|---|---|
| 1 (now) | `Journey against a real database`, `Migration target guard` | none — it already produces both |
| 2 (after rebase) | `Release gate (aggregate)` | blocks until rebased — which is required anyway |

Plus: 1 required approval, dismiss stale approvals, require approval of the most recent push, strict up-to-date checks, block force pushes and deletions, **empty bypass list**.

**Correction to an earlier claim:** PR #49 does not have `release-validation.yml`. My first check of this was invalid — the commit object was missing from the local clone, so `git cat-file` failed on the object, not the path. Re-run after `git fetch`, the conclusion holds on valid evidence.

---

## 6. Phase 2 — PR #50 review

Full review in `docs/release/PR50-REVIEW.md`. Summary:

| ID | Defect | Severity |
|---|---|---|
| D1 | `npm audit` aborts the step under `bash -e` before the reporter can print why | **Medium** |
| D2 | Required checks cannot run on PR #49 | **High (by design)** |
| D6 | Build job never says which migration history it exercised | **Medium** |
| D3 | `--from-url` puts the credential in `argv` | Low |
| D4 | Control 1 copies `node_modules` only to delete it | Low |
| D5 | Placeholder `DATABASE_URL` may mislead a future step | Low |
| D7 | `authorize-migration.mjs` is inert until adopted | Low |

**D1 reproduced locally:** `bash -e` with a failing `npm audit` exits before the reporter, leaving `/tmp/step-audit.log` empty exactly when it matters.

**No fail-open path found.** Every unavailable dependency produces an explicit `BLOCKED` and a non-zero exit.

**E2E evidence preserved** (both runs, with corrected durations from `/actions/runs/{id}/jobs`):

| Run | Commit | Result | Duration |
|---|---|---|---|
| `39505559225` | `9ef3c08` | success | 9m37s |
| **`39505943097`** | `47f5ed9` | **failure**, step 18; 19–27 skipped | 8m7s |
| `39508574479` | `e2a12a1` | success | 11m15s |

`hydration-race.check.mjs` exits 1 **only** under `HYDRATION_RACE_ASSERT=clean`, which CI does not set — so the step can only exit 0 or 2, and 2 means the harness could not run. **Infrastructure, not a hydration regression.** The exact cause (server timeout, browser launch, bundling) is **NOT TESTED** — the runner log is unreachable from here.

**Review limitation:** I wrote PR #50. This is a self-review and does not satisfy the independent-review requirement. PR #50 has **0 reviews**.

---

## 7. Phase 3 — schema reconciliation

| Item | Value |
|---|---|
| Patch | `docs/schema-reconciliation/reconciliation.patch` |
| SHA-256 | `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29` |
| Size / hunks | 3,311 B / **7 hunks, 1 file** |
| Applies to `main` @ `2575cf4` | **PASS** |
| Zero drift after applying (PG18) | **PASS** — CI |
| Production DDL required | **none** |

**All six corrections are schema-side.** Rejected: dropping the FK, renaming the truncated index, dropping the primary key — each removes a guarantee or touches production for cosmetics.

**Not opened as a PR:** this session is bound to one branch. Packaged with a three-command procedure and a ready PR body in `docs/schema-reconciliation/PR-BUNDLE.md`.

**Merge-order constraint:** the drift baseline records these strings and the gate fails on a *disappearing* entry. Whichever of #50 / reconciliation merges second must empty the baseline in the same change.

---

## 8. Phase 4 — PR #49

Static verification on a properly fetched object:

| Check | Result |
|---|---|
| Both migrations present | **PASS** |
| Migration count | **18** (16 + 2) |
| Candidate schema matches what the migrations create — 9 attributes checked | **PASS** |
| `release-validation.yml` on the candidate | **ABSENT** |
| PostgreSQL 18 rehearsal | **NOT TESTED** |
| Generate / typecheck / lint / suites | **NOT TESTED** |

Migration hashes: `209a1e29…` and `af197ddf…`. Gate expectations that would apply: **13** (8 columns, 1 table, 3 indexes, 1 constraint).

**Blocker:** the gate cannot report on PR #49 until it is rebased, and a rebase changes the candidate. Plan in `docs/release/PR49-REVALIDATION-PLAN.md`, including `--force-with-lease` and the rule that a rebase which changes any file beyond conflict resolution is a new candidate.

---

## 9. Phase 5 — recovery and deployment boundary

### Recovery — `BLOCKED`

| Item | Status |
|---|---|
| R1 root branch | **PASS** |
| R4 6-hour history window | **PASS** |
| R2 restore range | **BLOCKED** |
| R3 snapshot existence | **BLOCKED** |
| R5 drill | **NOT TESTED** |
| Safeguard (manual snapshot, $0.00 on Free) | **BLOCKED** — unauthorized |

### Deployment boundary — `PROPOSED`

`docs/RELEASE-GATE-PROPOSAL.md` answers the eight required questions. **Not implemented, not tested.** Preconditions unmet.

### New finding — the post-deployment smoke workflow is orphaned

`production-smoke.yml` ("Production smoke (read-only)") is **registered and `active`** in Actions (id `375640098`), last ran 2026-10-05 on `arena/01a10b8d-jata-aftercall` (2 runs, both success). **The file exists on no live branch** — not on `main`, not on PR #49, not on PR #50.

**Consequence:** there is currently **no post-deployment smoke test** in the live pipeline, despite the Actions UI listing one. Any recovery/deployment runbook that assumes it exists is wrong. This is a genuine gap in the Phase 5 material.

---

## 10. Evidence-loss event

`/home/user/recovery/` was wiped during this session — the **second occurrence** (the first wiped Phase 3–5 artifacts). Lost: `PR49-PREMERGE-SAFETY-REPORT.md` Rev. 6 (`936107b0…`), its Rev. 5 archive (`5229dbbc…`), `PR49-CANDIDATE-DIFF-5996229.diff` (`f5cc8f69…`, 881,733 B), and `RELEASE-GATE-IMPLEMENTATION-REPORT` Rev. 1–2.

**Mitigation:** `recovery/` was recreated and this report written to it, **and** committed into the repository at `docs/release/RELEASE-GATE-REPORT.md` so it survives. Checksums of the lost files are recorded above so their identity is not lost with the bytes.

Everything in the repository survived: `git status` clean at `093bf0e`, all docs and scripts present.

---

## 11. Risk register

| ID | Risk | Severity | Consequence | Mitigation | Owner |
|---|---|---|---|---|---|
| R-1 | Six schema divergences unadopted | **High** | Client types disagree with the DB; latent runtime errors | patch proven on PG18; adopt in its own PR | owner |
| R-2 | Recovery unverified (R2/R3) | **High** | No confirmed restore point | read-only console check + $0 snapshot | owner |
| R-3 | Merge migrates production | **High** | A merge silently mutates the schema | proposal B; not implemented | owner |
| R-9 | **`main` unprotected** | **High** | Nothing at the platform level prevents a direct push or a merge with red checks | Stage 1 ruleset | owner |
| R-10 | **No live post-deployment smoke** | **Medium** | A bad deploy is detected only by the manual monitoring window | restore `production-smoke.yml` or retire the registration | owner |
| R-4 | Hydration step cannot assert | Medium | A green step proves the harness started, not that hydration is clean | set `HYDRATION_RACE_ASSERT=clean` | owner |
| R-5 | PR #49 not covered by the gate | Medium | Its migrations have never run on PG18 | approved rebase | owner |
| R-11 | Gate reviewed only by its author | Medium | Conflict of interest; defects may be missed | `christine-kariuki` review (0 today) | owner |
| R-6 | `braces@3.0.3` (dev-only) | Low–Med | Availability DoS, lint-time | documented; reassess 2026-11-20 | owner |
| R-8 | Drift baseline could normalise drift | Low | Accepted strings could mask a variant | exact-match; new **and** stale fail | owner |

**Correction to the previous report:** R-7 ("single-owner monitoring/recovery, no second person") is **downgraded**. `christine-kariuki` holds **write** access and can be the required approver. Whether she has accepted monitoring or recovery duties is still unstated — that remains an open decision, not an absence of people.

---

## 12. Owner decisions required

| # | Decision | Default if declined |
|---|---|---|
| 1 | **Create the Stage 1 `main` ruleset** (2 required checks, 1 approval, no bypass) | `main` stays unprotected |
| 2 | **Confirm `christine-kariuki` as required approver** | Rule 1 cannot be enabled |
| 3 | **Approve or reject PR #50**, after an independent review | Gate not adopted |
| 4 | **Open the schema reconciliation PR** (bundle ready) | Six divergences stay live |
| 5 | **Authorize the PR #49 rebase** after #50 and reconciliation land | PR #49 stays outside the gate |
| 6 | **Authorize the $0 manual snapshot** | 6-hour window stays the only net |
| 7 | **Restore or retire `production-smoke.yml`** | No post-deployment verification |
| 8 | **Decide the migration/deployment boundary** (proposal B) | Merge keeps migrating production |

---

## 13. No-change confirmation

| Item | State |
|---|---|
| `main` | `2575cf4…` — no push, no merge |
| PR #49 | `OPEN`, head `5996229…`, unmodified |
| Repository settings | **unchanged** — `protected: false`, rulesets `[]` |
| Production DB / Neon / Vercel | no connection, no migration, no snapshot, no setting change |
| Dependencies | unchanged |
| Guard / allowlist / tests | intact |

**Commits this phase:** `093bf0e` — four review documents and one correction. Six commits total on this branch, all pushed. One PR (#50).

---

**Verdict: `BLOCKED — NOT APPROVED TO MERGE OR DEPLOY`.**
The gate is built and green. The remaining work is decisions, not code: protection, review, adoption, and a rebase — plus the two things this environment cannot reach, production recovery and a Neon rehearsal.
