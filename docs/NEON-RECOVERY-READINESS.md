# Neon recovery readiness

**Status:** documentation only. No snapshot, branch, restore or retention change has been made.
**Date:** 2026-10-20

---

## 1. Verified state

| # | Question | Answer | Label |
|---|---|---|---|
| R1 | Is `production` a root branch? | **Yes** — the branch listing showed no parent, and `production` is the default branch | **PASS** |
| R2 | Actual restore range and whether point-in-time queries are offered | Never observed. A plan allowance is not a reachable restore point | **BLOCKED** |
| R3 | Does a manual snapshot exist? | Never observed. History usage is not a snapshot | **BLOCKED** |
| R4 | History retention | **6 hours**, displayed in the console | **PASS** |
| R5 | Has a restore ever been rehearsed? | No | **NOT TESTED** |

**Provenance.** R1 and R4 are owner-provided console observations from 2026-10-20 and are time-sensitive. They are not the result of an independent check: the build environment has no Neon connector, `api.neon.tech` does not resolve from it, and no credential is configured.

---

## 2. What Neon offers on the current plan

| Mechanism | Extends beyond 6 h | Available on Free | Notes |
|---|---|---|---|
| Instant restore (PITR) | **No** | Yes — **root branches only** | Restores the **whole branch**, every database on it, to a timestamp or LSN |
| **Manual snapshot** | **Yes — never expires unless given an expiry** | **Yes — 1 per project** | Billed at $0.09/GB-month, **charged as a full snapshot** |
| Automated backup schedule | Yes (35-day default) | **No** — paid plans only | Scheduled snapshots are incremental after the first |
| Longer history window | Yes — 7 days (Launch) / 30 days (Scale) | Requires plan change | Billing change |

### Cost of the recommended safeguard

| Item | Value |
|---|---|
| Charged today on the Free plan | **$0.00** — the plan has no monthly cost |
| Storage consumed | Worst case 45.73 MB ≈ 4.6 % of the 1 GB/project allowance |
| List rate if ever billed | $0.09/GB-month × 0.0447 GB ≈ **$0.0041/month** |

---

## 3. Restore semantics you must know before relying on this

1. **A restore is whole-branch.** It cannot restore one table. Every legitimate write after the restore point — orders, payments, signups — is discarded.
2. **Restoring from a snapshot disables PITR on the resulting branch.** The sequence *snapshot → restore → PITR back* is not available.
3. **A restore automatically creates a backup branch** named `<branch>_old_<timestamp>`.
4. **That backup branch can be undeletable** when the restored branch was itself restored from another branch.
5. **One snapshot on Free.** Replacing it requires deleting the old one, and deleted snapshots cannot be recovered.
6. **A code rollback is not a schema rollback.** Vercel rollback re-points an alias; columns and tables stay.

**Consequence for this release.** Because both pending migrations are additive and `IF NOT EXISTS`-guarded, a forward fix is almost always preferable to a PITR restore. A restore is the remedy for *data* damage, not for a missing column.

---

## 4. Procedure

### 4.1 Verify (read-only, owner, ~2 minutes)

1. Neon Console → project `jata-aftercall` → branch `production` → **Postgres database → Backup & Restore**.
2. Record the earliest and latest selectable restore timestamps.
3. Record the snapshot list — identifier, timestamp, expiry — or "none".
4. Optional: **Preview data → Query data** at a past timestamp, run `SELECT 1;`. This proves reachability without changing anything.

### 4.2 Restore (destructive, owner only, separate authorization)

1. Confirm the target timestamp against the incident timeline, not against "roughly when it broke".
2. Prefer **Multi-step restore** — it creates a new branch and leaves production untouched until you switch.
3. Verify the restored branch before re-pointing the application.
4. Record the backup branch name that Neon creates.
5. Expect connections to be interrupted and the compute to wake.

### 4.3 What must never happen

- Restoring production to "test whether it works".
- Running `prisma migrate resolve` as part of a restore.
- Changing the history window or deleting a snapshot under pressure.

---

## 5. Owner actions still outstanding

| # | Action | Why it is needed |
|---|---|---|
| 1 | Read the restore range (R2) | Without it, "6 hours" is a plan promise, not a measured recovery point |
| 2 | Confirm whether a snapshot exists (R3) | Nothing can be assumed; a snapshot changes the recovery plan entirely |
| 3 | Decide on a pre-release snapshot (S1) | $0, and it removes the 6-hour detection deadline |
| 4 | Name a recovery owner with console access | During an incident there must be no ambiguity about who may restore |
| 5 | Accept or reject the residual risk | If no snapshot is taken, the 6-hour window is the only net |

---

## 6. What CI can and cannot prove

`release-validation.yml` runs migrations on a **disposable PostgreSQL 18 container**. That proves the SQL applies, the ledger is complete, and the schema matches `schema.prisma`.

It proves **nothing** about Neon: not branching, not point-in-time recovery, not the history window, not compute suspension, not provider-side DDL quirks. A container is not a Neon project, and no amount of green CI changes that.
