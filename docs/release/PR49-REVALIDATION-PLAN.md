# PR #49 revalidation — plan and static pre-checks

**Status:** PLAN. PR #49 has **not** been rebased, modified or pushed to. Head remains `59962291ec82d5ddbc8f323e3d057d6a5b15cf02`.
**Why this matters:** a CI result for an earlier commit does not validate a changed candidate. Rebasing PR #49 changes its head, which invalidates run `39479231795` and the 0-review status quo.

---

## 1. What was verified statically (no DB, no CI, no rebase)

| # | Claim | Evidence | Label |
|---|---|---|---|
| 1 | PR #49 head is `5996229…`, tree `7b3c8cd5…` | `git rev-parse`, PR API | **PASS** |
| 2 | Both required migrations are present | `prisma/migrations/20261017000000_media_asset_version`, `…20261018000000_password_reset_security` | **PASS** |
| 3 | Migration count on the candidate | **18** (16 on `main` + 2) | **PASS** |
| 4 | `release-validation.yml` is on the candidate | **ABSENT** | **FAIL (by design)** |
| 5 | Candidate schema declares what the migrations create | `MediaAsset.version Int @default(0)`, `User.sessionVersion Int @default(0)`, `User.passwordResetRequestedAt DateTime?`, `model PasswordResetToken` | **PASS** |
| 6 | Gate expectations that would apply | **13** across the two migrations — 8 columns, 1 table, 3 indexes, 1 constraint | **PASS** |
| 7 | Migrations run on PostgreSQL 18 | — | **NOT TESTED** |
| 8 | Prisma generate / typecheck / lint / suites on the candidate | — | **NOT TESTED** |

*Method note:* an earlier check of item 4 returned "absent" for the wrong reason — the commit object was not in the local clone, so `git cat-file` failed on the object rather than the path. It was re-run after fetching the branch, and the conclusion holds on valid evidence.

### Migration identity

| Migration | `migration.sql` SHA-256 |
|---|---|
| `20261017000000_media_asset_version` | `209a1e2965f54ddace0be07036a5f8a223180209e4b5b1237b8c37132ffadddd` |
| `20261018000000_password_reset_security` | `af197ddfae04c94d7b998e144f295f909c3028c6e79a4f8dbe547d1aa5371b39` |

### Does the candidate's schema agree with its migrations?

Reading the model declarations against the SQL:

| Migration creates | Schema declares | Agree |
|---|---|---|
| `"version" INTEGER NOT NULL DEFAULT 0` | `version Int @default(0)` | yes |
| `"sessionVersion" INTEGER NOT NULL DEFAULT 0` | `sessionVersion Int @default(0)` | yes |
| `"passwordResetRequestedAt" TIMESTAMP(3)` (nullable) | `passwordResetRequestedAt DateTime?` | yes |
| `CREATE TABLE "PasswordResetToken"` | `model PasswordResetToken` | yes |
| `UNIQUE (userId)` | `userId String @unique` | yes |
| `UNIQUE (tokenHash)` | `tokenHash String @unique` | yes |
| `INDEX (expiresAt)` | `@@index([expiresAt])` | yes |
| FK → `User(id)` `ON DELETE CASCADE` | `onDelete: Cascade` | yes |
| `"createdAt" … DEFAULT CURRENT_TIMESTAMP` | `createdAt DateTime @default(now())` | yes |

**No new divergence is introduced by PR #49 in these objects.** The six pre-existing divergences are in unrelated tables, so the recorded baseline would still describe reality after a rebase.

---

## 2. The blocker

The gate **cannot evaluate PR #49 today**: the workflow file does not exist on its head, so its checks would never report. Two ways forward, both requiring owner authorization because both change the candidate:

| Option | Action | Consequence |
|---|---|---|
| **A — rebase onto the gate** | Rebase `remediation/interactive-business-e2e-fixes` onto `main` after PR #50 merges | New head, new tree, `39479231795` no longer describes it; full re-review required; 136-file diff re-verified |
| **B — land the gate first, then rebase** | Identical, but sequenced so the rebase happens once, on the final `main` | Same, fewer re-runs |

**A rebase is not a merge of code into PR #49** — it replays the same 136-file change on a new base. But it *does* produce a different tree if `main` moved, so the diff must be re-read, not assumed identical.

---

## 3. Execution plan (after authorization)

```bash
# 0. preconditions
#    - PR #50 merged (or the gate otherwise on main)
#    - schema reconciliation landed, baseline emptied
#    - owner has authorized a rebase of PR #49
git fetch origin main remediation/interactive-business-e2e-fixes

# 1. rebase on a scratch branch — never touch the PR branch until the diff is reviewed
git switch -c tmp/pr49-rebase origin/remediation/interactive-business-e2e-fixes
git rebase origin/main

# 2. record the new identity BEFORE pushing
git rev-parse HEAD                       # new candidate SHA
git rev-parse HEAD^{tree}                # new tree
git diff --binary origin/main...HEAD > /tmp/pr49-new.diff
sha256sum /tmp/pr49-new.diff

# 3. prove the change is the same change, not a different one
git diff origin/remediation/interactive-business-e2e-fixes...HEAD --stat   # expect: only rebase noise

# 4. only if step 3 is clean
git push --force-with-lease origin tmp/pr49-rebase:remediation/interactive-business-e2e-fixes
```

`--force-with-lease` rather than `--force`: if the branch moved since the fetch, the push is refused instead of overwriting someone's work.

### Checks that must run on the new head

| Check | Required |
|---|---|
| `static-checks` (generate, lint, typecheck, audit) | yes |
| `migrations-pg18` — 18 migrations on PostgreSQL 18 | yes |
| `production-build` | yes |
| `failure-path-controls` | yes |
| `schema-reconciliation-proposal` | yes |
| `Journey against a real database` (inherited) | yes |
| Both candidate migrations verified by `verify-migrations.mjs` | yes — expectations rise from 13 to 13 (unchanged), but now actually asserted against a database |

### What cannot be run here and needs infrastructure

| Check | Blocker |
|---|---|
| Neon-branch rehearsal | no Neon connector, `api.neon.tech` unresolvable |
| Neon recovery verification | same |
| Production migration rehearsal | requires a production decision this plan does not grant |

---

## 4. Acceptance for the rebased candidate

1. New head and diff checksum recorded in the report.
2. Full 136-file diff re-read — a rebase that changes any file beyond conflict resolution is a new candidate, not a rebase.
3. All jobs green **on the new head**, not on `39479231795`.
4. `verify-migrations.mjs` confirms the ledger and the 13 declarative expectations against PostgreSQL 18.
5. Re-review: rebasing invalidates the previous review, and PR #49 currently has **0 reviews** to invalidate — but it must have one before merge under the proposed ruleset.

**Until then, PR #49's migrations remain `NOT TESTED` on PostgreSQL 18.** The static evidence in §1 is strong but it is not a rehearsal, and this plan does not pretend otherwise.
