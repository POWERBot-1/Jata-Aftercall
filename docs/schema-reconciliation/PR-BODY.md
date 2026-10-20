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

- Patch applies cleanly to `main` @ `2575cf4`
- On PostgreSQL 18, `prisma migrate diff --exit-code` returns **0** after applying (`schema-reconciliation-proposal` job, run `39508574563`)
- `prisma validate` passes

**Still required on this branch before merge:** Prisma Client generation, typecheck, lint, and the unit/integration/security suites on PG18 — the same checks the release gate runs.

## Merge-order note

`scripts/ci/schema-drift-baseline.json` records these exact strings and the gate fails when one disappears. Whichever of this PR and #50 merges second must **empty the baseline entries**. Emptying it first would be a change that hides drift rather than resolving it.

## Risk if not adopted

The generated Prisma Client describes a database that does not exist in these six places. Latent today; a runtime error the moment code relies on the `PaymentAttempt` cascade, `Business.paymentAttempts`, or a `capabilities` default.
