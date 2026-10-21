# Proposed `main` protection — awaiting owner approval

**Status:** PROPOSAL. No setting has been changed. Repository settings still read `protected: false`, `rulesets: []`.
**Date:** 2026-10-20 · **Repo state:** `main` @ `2575cf461d33476a6bf8edb44fc56dc63498152a`

---

## 1. Verified current state

| Item | Value | How |
|---|---|---|
| `main` protected | **`false`** | `GET /repos/…/branches/main` |
| Rulesets | **`[]`** | `GET /repos/…/rulesets` |
| Classic branch protection | **not readable** — `403 Resource not accessible by integration` | `GET …/branches/main/protection` |
| Required status checks | none | implied by `protected: false` |
| Environments | `Preview`, `Production` — both with **0 protection rules** | `GET /repos/…/environments` |
| Collaborators | `POWERBot-1` (admin, User), **`christine-kariuki` (write, User)** | `GET /repos/…/collaborators` |
| Owner type | **User** account, not an organisation | `GET /repos/…` |

**Two consequences that shape the proposal.** The repo is a *user* repo with exactly two collaborators, and `POWERBot-1` is the author of every open PR — GitHub forbids approving your own pull request, so a required-approval rule **only becomes workable because `christine-kariuki` exists**. And classic protection is unreadable with the current token, so the change should be made as a **ruleset**, which is readable and verifiable afterwards.

---

## 2. Proposed ruleset

| Setting | Value | Rationale |
|---|---|---|
| Target | Branch `main` (`refs/heads/main`) | exactly the release branch |
| **Require a pull request before merging** | On | no direct pushes |
| **Required approvals** | **1** | `christine-kariuki` must be the approver on `POWERBot-1` PRs |
| **Dismiss stale approvals on new commits** | On | a changed candidate is not the reviewed candidate |
| **Require approval of the most recent push** | On | prevents approve-then-push |
| **Require status checks** | On, **strict** (branch must be up to date) | checks must describe the exact merge candidate |
| **Block force pushes** | On | protects history |
| **Block deletions** | On | protects the branch |
| **Bypass list** | **empty** for routine work | no silent bypass |

### 2.1 Required status checks — staged, because a hard cutover would deadlock PR #49

The check runs produced by the gate on `e2a12a1` are:

```
Release gate (aggregate)
Static (install, generate, lint, typecheck, audit)
Migrations + schema on PostgreSQL 18
Production build path on PostgreSQL 18
Failure paths actually fail
Schema reconciliation proposal closes the drift
```

`release-validation.yml` **does not exist on PR #49's head** — verified with `git cat-file -e 5996229:.github/workflows/release-validation.yml` → absent. If those checks are made required today, **PR #49 stays permanently `BLOCKED`** because the workflow can never report on it. That is a legitimate use of required checks, but it is a release decision, not an infrastructure detail.

| Stage | Required checks | Effect on PR #49 |
|---|---|---|
| **Stage 1 (proposed now)** | `Journey against a real database`, `Migration target guard` | none — PR #49 already produces both, and both currently pass |
| **Stage 2 (after PR #50 merges and PR #49 is rebased)** | `Release gate (aggregate)` replaces the two above | PR #49 must be rebased and re-run before it can merge — which is required anyway |

Requiring only `Release gate (aggregate)` at Stage 2 is deliberate: it aggregates all five jobs, and `needs` marks it failed for any non-`success` result **including `skipped`**, so one stable check name carries the whole gate without five names to keep in sync when job titles change.

---

## 3. Risks of enabling this

| Risk | Consequence | Mitigation |
|---|---|---|
| **Single approver** | One person must approve every PR; if unavailable, nothing merges | Accepted — that is the point. Escape hatch is a deliberate, logged ruleset change, not a bypass |
| **Stage-2 deadlock on PR #49** | Required aggregate check never reports | Land Stage 2 only after the rebase is authorised and ready |
| **Strict "up to date"** | `main` moving forces every open PR to re-run | Correct behaviour; costs CI minutes |
| **Checks must have run recently** | A brand-new check name may be rejected when creating the rule | Do Stage 2 immediately after a green run on the merged gate |
| **User-repo limits** | Rulesets on user repos are more limited than org repos | Verified readable after creation; if a setting is rejected, fall back to classic protection and record the gap |
| **Bypass temptation** | Pressure to "just merge this one" | Bypass list stays empty; any bypass is itself a ruleset edit and therefore auditable |

---

## 4. What will be verified after implementation

1. `GET /repos/…/rulesets` lists the new ruleset with the expected `enforcement: active`.
2. `GET /repos/…/rules?refs=refs/heads/main` echoes the effective rules.
3. `GET /repos/…/branches/main` reports `protected: true`.
4. A test: confirm the merge button is blocked on a PR with a failing required check — **by observation, not by attempting a merge**.

**Protection is not claimed until step 1–3 are read back from the API.** A drafted ruleset that was never applied would leave `protected: false`, and that is exactly the mistake this section exists to prevent.

---

## 5. Authorization required

| # | Decision | Default if unchanged |
|---|---|---|
| 1 | Create the Stage 1 ruleset now? | **No action** — `main` stays unprotected |
| 2 | Approve 1 required review, with `christine-kariuki` as the approver? | **No action** — no review requirement |
| 3 | Confirm `christine-kariuki` is willing to be the required approver | **Unknown** — willingness has not been stated |
| 4 | Schedule the Stage 2 switch after the PR #49 rebase | **No action** |

**I have not created the ruleset.** The token has `admin: true`, so I *could*; the order requires owner approval first, and that is the correct ordering.

---

## Addendum — 2026-10-21, verified against the live API

Everything in this section was read from the GitHub API in this closeout. No
setting was changed.

### Current effective state

| Fact | Value | How |
|---|---|---|
| `main` protected | **`false`** | `GET /branches/main` → `protected: false` |
| Rulesets | **`[]`** (none) | `GET /rulesets` |
| Effective rules on `main` | **`[]`** (none) | `GET /rules/branches/main` |
| Classic protection API | **403** "Resource not accessible by integration" | `GET /branches/main/protection` |
| Environment `Preview` | **0** protection rules | `GET /environments` |
| Environment `Production` | **0** protection rules | `GET /environments` |

Nothing forces any check to pass on `main` today. A force-push can rewrite it.

The 403 on the classic endpoint is itself informative: it means the integration
cannot *read* classic protection, so "no classic protection exists" cannot be
fully distinguished from "this token cannot see it". The ruleset and effective-
rules endpoints both return empty, and `protected: false` is authoritative for
the branch object — so the conclusion holds, but the two mechanisms are not
equally observable. An owner inspecting the repository settings page is the only
way to close that last gap.

### The check inventory that constrains the proposal

This is the finding that changes the staging. The two open PRs do **not**
produce the same checks:

| Check | PR #50 head | PR #49 head |
|---|---|---|
| `Journey against a real database` | yes | **yes** (`39479231795`) |
| `Migration target guard` | yes | **yes** (`39479231795`) |
| `Release gate (aggregate)` | yes | **no** |
| `Static (install, generate, lint, typecheck, audit)` | yes | **no** |
| `Migrations + schema on PostgreSQL 18` | yes | **no** |
| `Production build path on PostgreSQL 18` | yes | **no** |
| `Failure paths actually fail` | yes | **no** |
| `Schema reconciliation proposal closes the drift` | yes | **no** |
| `PR #49 candidate applies on a disposable PostgreSQL 18` | yes | **no** |
| `D2 — build, audit and controls on the candidate tree` | yes | **no** |

`release-validation.yml` does not exist on PR #49's head — that PR predates it —
so no job from that workflow can report on it. Requiring any of those checks now
would make PR #49 permanently unmergeable: GitHub blocks a merge when a
**required** status is missing, and no rebase is authorized. That is a deadlock
created by the protection change itself.

### Staged proposal, corrected

**Stage 1 — safe to apply now (owner approval required).** Require only checks
that both open PRs already produce:

* `Journey against a real database`
* `Migration target guard`

Plus: require a pull request before merging, dismiss stale approvals, block
force-pushes and deletions. No PR is deadlocked by this, today.

**Stage 2 — after this branch merges to `main`.** `release-validation.yml` then
exists on the default branch, so every new PR produces its jobs. Add
`Release gate (aggregate)` — the aggregate only, not the five individual jobs,
so a renamed or split job does not silently unrequire the gate.

**Never require:**

* `PR #49 candidate applies on a disposable PostgreSQL 18` and
  `D2 — build, audit and controls on the candidate tree`. These inspect a
  *foreign* commit. They run on every PR to this repository, but their subject is
  PR #49, not the change under review. Requiring them means a PR can fail because
  an unrelated open PR changed.
* Any individual job of `release-validation.yml` other than the aggregate.

### What must be verified after an authorized change

The proposal is not the outcome. After any setting change, the owner must:

1. `GET /branches/main` → expect `protected: true`.
2. `GET /rules/branches/main` → expect the required-checks rule to be listed.
3. Re-read this table and record the *effective* state, not the requested one.
4. Confirm on PR #49 that its two existing checks are still reported, and that
   nothing required is missing.

Until step 1 returns `true`, this document does **not** claim protection is
enabled.

### Bypass surface, stated plainly

* The repository is owned by a **User** account, not an organization. There is no
  organization-level ruleset to backstop a repository-admin bypass, and the
  owner is by definition an administrator.
* `christine-kariuki` has **write**; `POWERBot-1` has **admin**.
* A ruleset with a bypass list is only as strong as that list. If admin bypass is
  permitted, the protection stops accidents, not a determined admin. This should
  be recorded rather than described as enforcement.
