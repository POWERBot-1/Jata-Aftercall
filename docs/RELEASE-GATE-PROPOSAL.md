# Separating production migrations from Vercel builds — proposal

**Status:** PROPOSAL. Nothing in this document has been implemented in `scripts/build.sh` or in any Vercel setting.
**Date:** 2026-10-20
**Scope:** `POWERBot-1/Jata-Aftercall`, preserving the existing Vercel + Neon + Next.js + Prisma architecture.

---

## 1. What happens today (verified, not inferred)

| Fact | Evidence |
|---|---|
| `scripts/build.sh` runs `scripts/migrate.sh` whenever `DATABASE_URL` is non-empty | `scripts/build.sh` step 1 |
| `scripts/migrate.sh` consults the migration target guard, then runs `npx prisma migrate deploy` | `scripts/migrate.sh` |
| Vercel Production defines `DATABASE_URL` | build log of `dpl_5ngmfFB74AT1McoguZ2UfCM4eWB6`: `[build] DATABASE_URL detected — invoking migration gate` |
| The guard fails closed: `production` requires an enrolled fingerprint | `scripts/lib/migration-target-guard.mjs`, `OK_ENROLLED_PRODUCTION` / `REFUSED_PRODUCTION_UNKNOWN_TARGET` |
| `MIGRATION_GUARD_MODE=off` **disables the checks but still migrates** | guard source; this is not a skip switch |
| A failed migration is recorded as failed, and every later build then fails at `migrate deploy` until `prisma migrate resolve` | Prisma semantics + `_prisma_migrations` |

**The consequence.** Merging a pull request to `main` migrates the production database as a side effect of building. There is no separate authorization, no verification point between "migration applied" and "new code serving", and no way to deploy a commit without also having offered to migrate for it.

That is not a defect in the guard — the guard does exactly what it was built to do, and it is the reason this is a proposal rather than an incident. It is a *coupling* problem: two operations with different risk profiles, blast radii, and rollback semantics share one trigger.

---

## 2. What we are optimising for

1. An ordinary Vercel build of an arbitrary commit must never migrate production.
2. A migration must be attributable to a specific, reviewed commit.
3. Deployment must still be able to follow a migration immediately, so the window where schema and code disagree stays short.
4. Nothing may be removed from the existing protection: the guard, the allowlist, the fail-closed posture, and the no-credential-in-logs property all stay.
5. Rollback must be a configuration change, not a code rewrite.

---

## 3. Options considered

| Option | Change | Verdict |
|---|---|---|
| **A. Status quo** | none | Rejected — the coupling is the problem being solved |
| **B. Explicit `MIGRATE_ON_BUILD` switch + authorized migration job** | one guard clause in `build.sh`, one workflow, one Vercel variable | **Recommended** — smallest change that separates the two operations |
| C. A dedicated "migration" Vercel deployment | second project or build hook | Rejected — new infrastructure, new credential surface, more moving parts |
| D. External migration runner / Accelerate | architecture change | Rejected — violates the "preserve the architecture" constraint |
| E. Remove the guard and migrate manually | deletes the protection | Rejected outright |

---

## 4. Recommended design (B)

### 4.1 The switch

`scripts/build.sh` gains one clause, written so the **default preserves today's behaviour**:

```bash
# Default "true" keeps current behaviour. Flipping the Vercel Production
# variable to "false" is the entire adoption step, and flipping it back is the
# entire rollback.
if [ -n "${DATABASE_URL:-}" ] && [ "${MIGRATE_ON_BUILD:-true}" = "true" ]; then
  echo "[build] DATABASE_URL detected — invoking migration gate"
  bash scripts/migrate.sh
else
  echo "[build] migration gate not invoked (MIGRATE_ON_BUILD=${MIGRATE_ON_BUILD:-true})"
fi
```

With the variable absent or `true`, every build behaves exactly as it does today. **Nothing changes until someone deliberately sets `MIGRATE_ON_BUILD=false` in Vercel Production.**

### 4.2 The authorized migration job

A new `workflow_dispatch`-only workflow, protected by a GitHub **Environment** with required reviewers. It:

1. checks out a **named commit SHA**, never a branch;
2. refuses unless `MIGRATION_AUTHORIZATION` is exactly `sha:<that SHA>` — `scripts/ci/authorize-migration.mjs`, already written and tested on this branch;
3. runs the migration target guard in production mode **before** Prisma, so the enrolled-fingerprint check still applies;
4. runs `prisma migrate deploy`, then `prisma migrate status`, then `scripts/ci/verify-migrations.mjs` against production **read-only introspection**;
5. prints sanitised output only.

The authorizer's refusal paths are covered by eight tests (`scripts/__tests__/authorize-migration.test.mjs`): missing token, malformed token, SHA mismatch, unknown build SHA, non-production environment. All refuse.

### 4.3 The controlled sequence

```
1. Validate the exact candidate          .github/workflows/release-validation.yml (this branch)
2. Rehearse migrations in isolation      Neon temporary branch (owner-authorized) or disposable PG18
3. Authorize                             workflow_dispatch + sha:<candidate> + environment approval
4. Migrate + verify                      guard → migrate deploy → migrate status → verify-migrations
5. Deploy the matching candidate         Vercel promotion of that same SHA
6. Post-deployment smoke                 existing checks
```

Steps 1 and 2 are reproducible and CI-enforced. Step 3 is a human decision recorded in an audit trail. Steps 4–6 become one continuous action instead of a build side effect.

---

## 5. What this changes, and what it does not

| Item | Before | After (once adopted) |
|---|---|---|
| Who can migrate production | anyone who can merge | a reviewer-approved, SHA-bound workflow run |
| Build of an arbitrary commit | migrates if `DATABASE_URL` is set | never migrates |
| Guard | before Prisma | **unchanged** |
| Allowlist / enrolled fingerprint | required for production | **required, unchanged** |
| Credentials in logs | prohibited | **prohibited, plus an explicit leak check in CI** |
| Rollback | — | set `MIGRATE_ON_BUILD=true`; no code change |
| Vercel project settings | — | **one variable added**, nothing removed |

---

## 6. Failure modes and what they mean

| Situation | Result | Operator action |
|---|---|---|
| Migration workflow refuses (no/mismatched authorization) | nothing migrated, build unaffected | correct the authorization; never "fix" it by migrating from a build |
| Migration fails mid-way | `_prisma_migrations` records it failed; nothing else migrated | reviewed forward fix; `prisma migrate resolve` only under a separate incident authorization |
| Migration succeeds, deploy fails | schema ahead of code | safe **only while migrations are additive**; re-run the deploy |
| Code deployed, schema older than expected | runtime errors (`P2021`/`P2022`) | run the authorized migration job, then redeploy |

**Standing precondition:** every migration must stay additive and backward compatible, or the ordering assumption in this design stops holding. `release-validation.yml` asserts the resulting schema matches `schema.prisma`, which catches drift but cannot judge compatibility — that remains a review duty.

---

## 7. What must be true before adoption

| # | Requirement | Status |
|---|---|---|
| 1 | Authorizer implemented and unit-tested | **DONE** — `scripts/ci/authorize-migration.mjs`, 8 tests |
| 2 | Authorizer never grants by default | **DONE** — tested; also exercised as CI negative control 6 |
| 3 | `build.sh` clause preserves current behaviour by default | **NOT IMPLEMENTED** — must not be, until this proposal is approved |
| 4 | Dry run against a disposable database with `VERCEL_ENV=production` | **NOT TESTED** |
| 5 | Rehearsal on a Neon branch | **BLOCKED** — no Neon access from the build environment |
| 6 | Vercel Production variable change | **NOT AUTHORIZED** |
| 7 | Post-adoption verification that a normal build no longer migrates | **NOT TESTED** |

Items 4–7 are why this is a proposal. The switch is trivially reversible, but "trivially reversible" is not "tested", and this repository has been burned by assuming the two were the same.

---

## 8. Recommendation

Adopt B **only after** items 4–7 are satisfied in order, and only with the Vercel variable changed in a supervised window. Until then, keep the current coupling: it is understood, guarded, and log-verified. An untested replacement of a working gate is a worse risk than the coupling it removes.

---

## 9. Operating model — the eight questions this proposal must answer

| Question | Answer under proposal B |
|---|---|
| **Who or what may execute a production migration?** | Only `.github/workflows/production-migrate.yml`, a `workflow_dispatch`-only workflow bound to a GitHub **Environment** with required reviewers. No human runs `prisma migrate deploy` from a laptop against production, and no Vercel build does it once `MIGRATE_ON_BUILD=false` is set |
| **How are the exact candidate and migration artifacts verified?** | The workflow takes a **commit SHA**, not a branch. It checks out that SHA, records it, and runs `prisma migrate status` before mutating anything. The migration files are whatever that SHA contains — verified by the same `release-validation.yml` gate that rehearsed them on PostgreSQL 18 |
| **How is the migration step authorized?** | `MIGRATION_AUTHORIZATION` must be exactly `sha:<the SHA being deployed>`. Anything else refuses (`scripts/ci/authorize-migration.mjs`, 8 tests). The existing migration-target guard still runs first, so the enrolled-fingerprint check remains |
| **How do failures halt subsequent deployment steps?** | Migration and deploy are separate workflows. A non-zero exit in the migration workflow means no deploy is triggered — promotion is a manual or explicitly chained step that never runs on failure |
| **How is application/schema compatibility maintained during rollout?** | Every migration must be **additive and backward compatible**: expand, deploy, contract later. The old deployment keeps serving during the migration window, and it must keep working against the newer schema |
| **What evidence confirms migration completion?** | `prisma migrate status` reporting up to date, `scripts/ci/verify-migrations.mjs` confirming the ledger is complete and finished, and sanitised workflow output archived as an artifact |
| **What if migration succeeds but deployment fails?** | Schema is ahead of code. That is safe **only** under the additive rule: re-run the deployment of the same SHA. Never "fix" it by reverting the migration |
| **How are rollback and forward recovery handled?** | Code rollback = Vercel alias re-point; it does **not** touch schema. Schema problems are fixed forward with a new reviewed migration. A Neon restore is a whole-branch, destructive, last-resort action for **data** damage — never for a missing column, and never as an undo for DDL |

### What remains unproven

Everything in §9 is a design, not a measurement. The authorizer is implemented and tested; the workflow is **not written**, the Vercel variable is **not set**, and nothing has been rehearsed. Adopting it requires the four preconditions in §7, in order.
