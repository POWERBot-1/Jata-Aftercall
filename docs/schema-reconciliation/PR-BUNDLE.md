# Schema reconciliation — independent PR bundle

**Status:** ready to land as its own pull request. **Not applied anywhere.** No production DDL.

---

## 1. Why there is a bundle and not a PR

The order asks for a dedicated branch and a separate PR. This session is bound to a single branch (`arena/7486dc85-jata-aftercall`) by the platform, so a second branch cannot be created from here. Rather than skip Phase 3, the change is packaged so that it can be opened as its own PR with three commands, and so that a reviewer can verify it without trusting this branch.

---

## 2. Artifact identity

| Item | Value |
|---|---|
| Patch | `docs/schema-reconciliation/reconciliation.patch` |
| **SHA-256** | **`228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29`** |
| Size | **3,311 bytes** |
| Hunks | **7** (in **1** file) |
| Files touched | `prisma/schema.prisma` only |
| Diffstat | `8 insertions(+), 6 deletions(-)` |
| Applies to `main` @ `2575cf4…` | **verified** with `git apply --check` in a detached worktree |

*Correction:* an earlier draft of `README.md` described this as "8 hunks". It is **7 hunks**; the eighth grep hit was the `diff --git` header.

---

## 3. Opening the PR

```bash
git fetch origin main
git switch -c schema/reconcile-six-divergences origin/main
git apply docs/schema-reconciliation/reconciliation.patch   # run from the new worktree
git commit -am "schema: reconcile six divergences with the migration history

... message in §5 ..."
git push -u origin schema/reconcile-six-divergences
gh pr create --base main --head schema/reconcile-six-divergences \
  --title "schema: reconcile six divergences between migrations and schema.prisma" \
  --body-file docs/schema-reconciliation/PR-BODY.md
```

The patch is generated against `main`'s `prisma/schema.prisma`, so it applies there directly — no rebase needed while PR #50 is unmerged, because the two changes touch disjoint files.

---

## 4. Validation already performed

| Check | Result | Where |
|---|---|---|
| Applies cleanly to `main` @ `2575cf4` | **PASS** | local detached worktree, `git apply --check` |
| Touches only `prisma/schema.prisma` | **PASS** | `git diff --name-only` |
| Introduces no DDL | **PASS** | patch contains no `ALTER`/`CREATE`/`DROP` |
| After applying, `migrate diff` returns **0** on PostgreSQL 18 | **PASS** | CI job `schema-reconciliation-proposal`, run `39508574563` |
| `prisma validate` on the reconciled schema | **PASS** | same job |

**Not yet performed, and required before merge:** Prisma Client generation and the full application suite against the reconciled schema on PostgreSQL 18. That is precisely what the PR itself is for — the branch must go green on its own.

---

## 5. The six changes, and why each is schema-side

| # | Change | Effect on the generated client | Production DDL |
|---|---|---|---|
| 1 | `MediaAsset.updatedAt` → `@default(now())` | none | **none** |
| 2 | `PaymentAttempt.business` + `Business.paymentAttempts` | new relation field on `Business` and `PaymentAttempt` | **none** |
| 3 | `PaymentDestination.capabilities` → `@default([])` | none | **none** |
| 4 | `PaymentDestination` unique → explicit `map:` | none | **none** |
| 5 | `PaymentProviderConnection.capabilities` → `@default([])` | none | **none** |
| 6 | `PosReceiptSequence.businessId` → `@id` | `@id` instead of `@unique` | **none** |

Only **#2** and **#6** change the generated types at all. Both are additive or strictly stronger, and neither changes any SQL.

---

## 6. Merge-order constraint — the part that is easy to get wrong

`scripts/ci/schema-drift-baseline.json` (PR #50) records these divergences by exact string. `check-schema-drift.mjs` fails when a recorded entry **disappears**, by design.

Therefore:

| Order | What must happen |
|---|---|
| Reconciliation merges **first** | PR #50 must then **empty the baseline `entries`** in the same change that rebases onto it, or the gate goes red on "stale baseline" |
| PR #50 merges **first** | the reconciliation PR empties the baseline in its own diff |

Either is fine; doing neither leaves `main` red. **The baseline must be emptied only after the reconciliation has been validated on the branch that carries it** — which is why this bundle does not pre-emptively blank it here.

---

## 7. Preserved evidence

The original divergence report is unchanged and remains the record of what existed:

- `docs/schema-reconciliation/README.md` — count reconciliation (12 lines → 7 findings → 6 divergences → 5 tables) and per-object classification.
- `recovery/jata-aftercall-2026-10-20/RELEASE-GATE-IMPLEMENTATION-REPORT.md` — the divergence as first found, labelled **FAIL**.

Resolved items will be checked off in the PR body, not by rewriting that history.
