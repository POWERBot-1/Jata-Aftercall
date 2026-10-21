# Schema reconciliation — independent PR bundle

**Status:** ready to land as its own pull request. **Not applied anywhere.** No production DDL.

---

## 1. Why there is a bundle and not a PR

The order asks for a dedicated branch and a separate PR. This session is bound to a single branch (`arena/7486dc85-jata-aftercall`) by the platform, so a second branch cannot be created from here. Rather than skip Phase 3, the change is packaged so that it can be opened as its own PR with three commands, and so that a reviewer can verify it without trusting this branch.

**Precisely what the limitation is (verified 2026-10-21).** It is a session-policy
constraint, not a permissions one. The authenticated identity has `admin: true`
and `push: true` on the repository, and `git push --dry-run origin
HEAD:refs/heads/schema-reconciliation-probe` reported `* [new branch]` — the
credential could create the branch. This session is instructed to work only on
its own branch, so it does not. Recording the distinction matters: a reader who
sees "BLOCKED" should know whether the obstacle is capability or instruction.

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

---

## 7. Addendum — 2026-10-21, independent re-verification

Everything below was re-checked from scratch in this closeout, not copied from
the previous report.

| Check | Command | Result |
|---|---|---|
| Patch SHA-256 | `sha256sum docs/schema-reconciliation/reconciliation.patch` | `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29` — **matches** |
| Size / shape | `wc -c`, `grep -c '^@@'` | 3,311 bytes, **7 hunks**, **1 file** |
| Base blob matches the patch header | `git show 2575cf4:prisma/schema.prisma \| git hash-object --stdin` | `398ecdd52335e322d434b149165667742b8c1eb2` = the `index 398ecdd..` in the header |
| Applies to `main@2575cf4` | `patch -p1 --dry-run` | **PASS**, no fuzz, no rejects |
| Result blob matches the patch header | `git hash-object` after applying | `25e45c3afe584c7ac35f51b558cc1b73183a1b09` = the `..25e45c3` in the header |
| Result schema SHA-256 | `sha256sum` | `440027c4fcb10e0f3d2de3f2c7ec1e540ffdc5d9b6283329bfb9af05988d8bfd` |
| No hidden edits | `diff base result \| grep -c '^[<>]'` | exactly the 7 hunks; no unrelated change |
| No DDL | scan for `CREATE`/`ALTER`/`DROP` | none — model-only |

The blob identities are the important line: the patch's header claims *which*
files it transforms, and both hashes reproduce exactly. A patch that silently
touched a second line would not.

### 7.1 What "zero drift" does and does not prove

`prisma migrate diff` returning nothing proves the datamodel and the migrated
catalog now agree. It does **not** prove the agreement is correct: a patch can
silence a diff by describing an object the database does not have.

`scripts/ci/verify-reconciliation-justification.mjs` therefore checks both sides
of all six divergences, and runs in the reconciliation job *after* the patch is
applied:

| # | Database side (must exist) | Datamodel side (must assert) |
|---|---|---|
| 1 | `MediaAsset.updatedAt` default is `CURRENT_TIMESTAMP` | `@updatedAt @default(now())` |
| 2 | `PaymentAttempt.businessId` FK → `Business(id)` `ON DELETE CASCADE` | `business Business @relation(…, onDelete: Cascade)` |
| 3 | `PaymentDestination.capabilities` default `ARRAY[]::TEXT[]` | `@default([])` |
| 4 | unique index named `…providerDestinationId_pr` (63 chars) | `@@unique([…], map: "…providerDestinationId_pr")` |
| 5 | `PaymentProviderConnection.capabilities` default `ARRAY[]::TEXT[]` | `@default([])` |
| 6 | `PosReceiptSequence` PRIMARY KEY on `businessId` | `businessId String @id` (and not additionally `@unique`) |

Result: **PASS** — gate run `39545282950`, job
`Schema reconciliation proposal closes the drift`, on `3c541a1`. Thirteen
checks (seven model-side, six database-side), each able to fail independently;
seven unit tests exercise each one failing.

### 7.2 One defect in the gate itself, found by this work

The D2 job migrated PR #49's 18-migration history successfully, then
`verify-migrations.mjs` rejected the result. The cause was in the verifier, not
the candidate: `conrelid::regclass::text` renders a mixed-case table as
`"PasswordResetToken"` — quotes included — so the only constraint expectation in
the repository never matched. It was dormant because that migration is not on
`main`.

That means **the gate would have gone red on PR #49 the first time it was
rebased**, and the failure would have read as "the foreign key is missing".
Fixed in `50e9e0e` (join `pg_class`, use the unquoted `relname`) with a
quote-insensitive comparison and two regression tests.

### 7.3 Still required before the reconciliation PR can merge

The bundle is verified, but the PR itself must still go green on its own head:

1. `npx prisma generate` on the reconciled schema — the model changes affect the
   generated client's types.
2. `npm run typecheck` and `npm run test` against PostgreSQL 18 with the six
   divergences reconciled.
3. Confirmation that the four application effects are intended: `MediaAsset`
   inserts no longer need an explicit `updatedAt`; `PaymentAttempt` gains a
   traversable `business` relation; the two `capabilities` arrays default to
   empty rather than being required; `PosReceiptSequence` keeps one key instead
   of two.
