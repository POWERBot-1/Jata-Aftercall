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
