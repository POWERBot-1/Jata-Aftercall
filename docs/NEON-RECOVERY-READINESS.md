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

---

## Addendum — 2026-10-21, closeout restatement

Nothing in this document changed. This section records what was *re-checked* in
the Rev. 5 closeout and what an authorized operator must still do. No snapshot
was taken, no restore was attempted, no retention was changed, no cost was
incurred, and no production database was read.

### What this environment can and cannot observe

| Attempt | Result |
|---|---|
| Neon connector tool | **`unsupported`** — no Neon connector is offered to this session |
| `api.neon.tech` from the sandbox | does not resolve |
| Neon credential in the environment | **none configured** |
| Console observation of the project | **not possible from here** — the earlier R1/R4 `PASS` labels came from owner-provided console observations, and remain labelled as such |

Consequence: every statement about the Neon project in this document is either
owner-supplied or absent. There is no independent verification of R2, R3 or R5,
and there is no way to obtain one from this sandbox.

### Labels, restated without softening

| # | Question | Label | Reason |
|---|---|---|---|
| R1 | Is `production` a root branch? | **PASS** | owner console observation, 2026-10-20 |
| R2 | Actual restore range / PITR offered | **BLOCKED** | never observed; a plan allowance is not a reachable restore point |
| R3 | Does a manual snapshot exist? | **BLOCKED** | never observed; history usage is not a snapshot |
| R4 | History retention | **PASS** | 6 hours, owner console observation |
| R5 | Has a restore been rehearsed? | **NOT TESTED** | no restore has ever been executed |

R2 and R3 are `BLOCKED`, not `FAIL`: a capability that was never examined is not
a capability that was found missing. R5 is `NOT TESTED` because nothing was
attempted — the distinction matters, since `FAIL` would imply an attempt.

### The $0 cost claim — corrected in wording

An earlier draft described the snapshot cost as `$0`. What was actually computed
is a **list-rate expectation**: `$0.09/GB-month × 0.0447 GB ≈ $0.0041/month`, and
the Free plan carries no monthly charge, so the expected charge is zero. That is
arithmetic against a published rate, not a verified invoice. No snapshot was
taken, so nothing was billed and nothing was proven about billing. The label is
**NOT TESTED**.

### What an authorized operator must verify in the Neon console

These are the only steps that can turn `BLOCKED` into `PASS` or `FAIL`:

1. **Restore points (R2).** Open the production branch → *Restore* and read the
   actual earliest restorable timestamp. Record it verbatim. Do not infer it
   from the plan table.
2. **Snapshot inventory (R3).** Open *Backups / Snapshots* and record whether any
   manual snapshot exists, its timestamp, and its size.
3. **Compute state.** Record whether the compute is suspended and what wakes it,
   since a suspended compute changes what a restore would cost in time.
4. **Restore rehearsal (R5) — destructive-adjacent, do this only on a scratch
   branch.** Restore a *branch* to a timestamp, confirm the data, then delete the
   scratch branch. Record the before/after branch IDs. A one-step restore keeps
   the name and URL but **changes the branch ID and disables PITR on the new
   branch** — so it is not a harmless operation and must not be pointed at
   production.
5. **Confirm ownership.** The connector is unavailable from this sandbox, so the
   operator is the only party who can authenticate.

### Explicitly out of scope for this closeout

No snapshot, no restore, no reset, no retention change, no branch creation, no
plan change, and no production credential was used or requested. The deployment
boundary in `docs/RELEASE-GATE-PROPOSAL.md` remains **PROPOSED**, not adopted.
