## Summary

Reconciles the six divergences between the committed migration history and `prisma/schema.prisma`, discovered by the release gate on 2026-10-20.

**Every correction is schema-side. This PR contains no DDL and requires no production migration, because in all six cases the database is already correct — or stricter than the schema.**

## The six

| # | Object | Divergence | Fix |
|---|---|---|---|
| 1 | `MediaAsset.updatedAt` | DB has `DEFAULT CURRENT_TIMESTAMP`; schema declares none | `@default(now())` |
| 2 | `PaymentAttempt.businessId` | DB has a `CASCADE` FK to `Business`; schema declares no relation | declare relation + `Business.paymentAttempts` |
| 3 | `PaymentDestination.capabilities` | DB default `ARRAY[]::TEXT[]` | `@default([])` |
| 4 | `PaymentDestination` unique index | PostgreSQL truncated the 83-char name to 63 | `map:` the existing name |
| 5 | `PaymentProviderConnection.capabilities` | DB default `ARRAY[]::TEXT[]` | `@default([])` |
| 6 | `PosReceiptSequence.businessId` | DB has a primary key; schema said `@unique` | `@id` |

## Rejected alternatives

Dropping the foreign key, renaming the truncated index, and dropping the primary key would each make the diff clean by **removing a guarantee** or by touching production for cosmetics. None is included.

## Verification

### Patch integrity — recomputed, not quoted

| Check | Result |
|---|---|
| SHA-256 of `reconciliation.patch` | `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29` |
| SHA-256 of `reconciliation-tests.patch` | `c243200ae609452030a6530c4980566783d488c64e588f4d4adae676f8a4cbd6` |
| Size / shape | 3,311 bytes (`prisma/schema.prisma`, **7 hunks**) + companion assertion strengthening (`tests/unit/pos-schema.test.ts`, **1 hunk**) · **0 DDL statements** |
| Base blob vs the patch header (`398ecdd`) | `398ecdd52335e322d434b149165667742b8c1eb2` — **matches** |
| Result blob vs the patch header (`25e45c3`) | `25e45c3afe584c7ac35f51b558cc1b73183a1b09` — **matches** |
| Resulting schema SHA-256 | `440027c4fcb10e0f3d2de3f2c7ec1e540ffdc5d9b6283329bfb9af05988d8bfd` |
| `patch -p1 --dry-run` on `main@2575cf4` | clean, no fuzz, no rejects |

The two blob identities are the load-bearing line: a patch that silently touched
one extra line could not reproduce them.

### On PostgreSQL 18, in the release gate

| Check | Result | Where |
|---|---|---|
| Recorded baseline still describes reality before the patch | **PASS** | job `schema-reconciliation-proposal` |
| `prisma validate` on the reconciled schema | **PASS** | same job |
| `prisma migrate diff --exit-code` returns **0** after applying | **PASS** | same job |
| **Both sides of all six divergences** — the database has each object *and* the patched model asserts it | **PASS** — 13 checks | same job, step *Every edit describes an object the database already has* |
| Prisma Client generated **from the reconciled schema** | **PASS** | same job |
| `npm run typecheck` against that client | **PASS** | same job |
| Unit / integration / security suites (`vitest run --exclude "tests/e2e/**"`) | **PASS** | same job |
| Suite did not pass by skipping | **PASS** — `check-test-output.mjs` | same job |

Run demonstrating the full end-to-end execution on PostgreSQL 18: **`39556189976`**
(head `5490396`, 6/6 gate jobs `success`), recording all **13/13** justification
`PASS` lines and **`2382 passed, 0 failed, 0 skipped, 0 todo` across `192 passed`
test files** verbatim in check-run annotations. **This PR must still go green on
its own head** — the evidence above proves the *patch*, not the *branch*.

### Why "zero drift" alone was not enough

`prisma migrate diff` returning nothing proves the datamodel and the catalog
agree. It does **not** prove the agreement is correct: a patch can silence a diff
by describing an object the database does not have. The justification check
therefore asserts both directions, and each of its 13 checks can fail
independently (seven unit tests exercise exactly that).

## Merge-order note

`scripts/ci/schema-drift-baseline.json` records these exact strings and the gate fails when one disappears. Whichever of this PR and #50 merges second must **empty the baseline entries**. Emptying it first would be a change that hides drift rather than resolving it.

## Risk if not adopted

The generated Prisma Client describes a database that does not exist in these six places. Latent today; a runtime error the moment code relies on the `PaymentAttempt` cascade, `Business.paymentAttempts`, or a `capabilities` default.

---

## Independent review checklist

Tick every line before approving. Each is checkable from this PR alone.

### Integrity

- [ ] `sha256sum docs/schema-reconciliation/reconciliation.patch` equals
      `228edaf23857c28d1490e521e5ffe986c0189f6f4a10a34504f53351b9e44e29`.
- [ ] `git diff main --name-only` shows **only the two expected files**: `prisma/schema.prisma` and `tests/unit/pos-schema.test.ts` (and `scripts/ci/schema-drift-baseline.json` if PR #50 has already merged before this PR).
- [ ] The diff contains **no** `CREATE`, `ALTER`, `DROP`, `UPDATE`, `DELETE`.
- [ ] Applying the patch to `main`'s schema reproduces blob `25e45c3…`.

### Correctness, one divergence at a time

For each row: the database is right and the schema was wrong. Confirm that is the
direction of the fix, not the reverse.

- [ ] **(1)** `MediaAsset.updatedAt` — migration `20261004000000_website_studio_ai`
      declares `DEFAULT CURRENT_TIMESTAMP`; the model gains `@default(now())`.
      Confirm no existing insert relied on supplying `updatedAt` explicitly.
- [ ] **(2)** `PaymentAttempt.businessId` — migration
      `20261005000000_payment_wallet` declares the FK with `ON DELETE CASCADE`;
      the model adds the relation **and** the back-relation on `Business`.
      Confirm no orphan `PaymentAttempt` rows exist that would now be reachable.
- [ ] **(3)** / **(5)** `capabilities` — both migrations declare
      `DEFAULT ARRAY[]::TEXT[]`; the models gain `@default([])`. Confirm this
      makes the field optional on create, and that nothing depended on it being
      required.
- [ ] **(4)** `PaymentDestination` unique index — the **existing** 63-character
      name is mapped, not renamed. Confirm the PR does not rename the index: a
      rename would be DDL against production for cosmetics.
- [ ] **(6)** `PosReceiptSequence.businessId` — the migration declares
      `CONSTRAINT "PosReceiptSequence_pkey" PRIMARY KEY ("businessId")`; the model
      moves from `@unique` to `@id`. Confirm `@unique` is not left alongside
      `@id`.

### Evidence

- [ ] The gate job `schema-reconciliation-proposal` is green on **this** PR's head.
- [ ] The justification step's 13 `PASS` lines are present in that job's summary.
- [ ] `prisma generate` succeeded **after** the patch was applied, not before.
- [ ] The suite summary shows a non-zero test count and no skips.

### Behaviour

- [ ] `npm run typecheck` passes on the generated client.
- [ ] The unit/integration/security suites pass on PostgreSQL 18.
- [ ] Any code that constructs `MediaAsset`, `PaymentDestination`,
      `PaymentProviderConnection`, `PaymentAttempt` or `PosReceiptSequence` still
      compiles without a new required argument.
- [ ] No production database was touched by this PR. (It contains no DDL, so it
      cannot migrate anything; confirm that is still true.)

### Merge mechanics

- [ ] Merged **after** the release gate workflow is on `main`, so this PR's own
      head can produce `Release gate (aggregate)`.
- [ ] Merged **before** PR #49 is rebased — otherwise the gate goes red on PR #49
      for a divergence that belongs here.
- [ ] No required check was weakened to obtain green.
