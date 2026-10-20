# Schema reconciliation — six divergences

**Status:** PROPOSAL. Nothing here has been applied to `prisma/schema.prisma`, to any database, or to the release gate's baseline.
**Evidence date:** 2026-10-20 · **Discovered by:** release gate run `39505165659`, reproduced in the green run `39505943905`
**Artifact:** `reconciliation.patch` (3,311 bytes, applies cleanly to `prisma/schema.prisma` at `2575cf4`)

---

## 1. Counting: 12 diff lines, 7 findings, 6 divergences, 5 tables

`prisma migrate diff` printed **12 lines** for this drift: **5 table headers** plus **7 findings**. Those 7 findings describe **6 independent divergences**, because `PosReceiptSequence` produces two lines (`[-] Dropped the primary key` + `[+] Added unique index`) for a single difference in how the key is represented.

The summary in the release-gate report collapsed the two `capabilities` defaults into one bullet, which is why it read as six bullets over five tables. The mapping below is the precise one.

| # | Table | Divergence |
|---|---|---|
| 1 | `MediaAsset` | `updatedAt` default |
| 2 | `PaymentAttempt` | foreign key on `businessId` present in the database, absent from the schema |
| 3 | `PaymentDestination` | `capabilities` default |
| 4 | `PaymentDestination` | unique index name |
| 5 | `PaymentProviderConnection` | `capabilities` default |
| 6 | `PosReceiptSequence` | primary key vs unique index |

---

## 2. Dispositions

### 1 — `MediaAsset.updatedAt`

| | |
|---|---|
| **Database** | `updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| **Schema** | `updatedAt DateTime @updatedAt` — no database default |
| **Evidence** | `prisma/migrations/20261004000000_website_studio_ai/migration.sql:19` adds the column *with* `DEFAULT CURRENT_TIMESTAMP` |
| **Classification** | **Migration defect** — the DDL declares a default the model does not |
| **Effect** | None on existing rows. `@updatedAt` is applied by the client on every write, so the database default is only reachable by raw SQL inserts |
| **Smallest safe correction** | `@default(now())` in the schema — **no DDL**, the database is already correct |
| **Risk** | None. Deleting the database default instead would be a production `ALTER COLUMN`, for no benefit |

### 2 — `PaymentAttempt` foreign key

| | |
|---|---|
| **Database** | `CONSTRAINT "PaymentAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE` |
| **Schema** | `businessId String` — no relation field, and no back-relation on `Business` |
| **Evidence** | `prisma/migrations/20261005000000_payment_wallet/migration.sql:278`. `PaymentTransaction` already carries `attempts PaymentAttempt[]`, so `attempts` is *not* a free name on `Business` |
| **Classification** | **Schema representation defect** — the migration enforces tenant integrity the schema never declares |
| **Effect** | Real. The database cascades attempts when a business is deleted; Prisma has no idea, so `business` is not queryable from an attempt and the FK is invisible to the client. No orphan risk today — the database is stricter than the schema |
| **Smallest safe correction** | Declare the relation: `business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)` plus `paymentAttempts PaymentAttempt[]` on `Business` — **no DDL**, the constraint already exists with Prisma's conventional name |
| **Risk** | Adds a `paymentAttempts` field to the generated `Business` type. Additive; nothing selects it |
| **Alternative rejected** | Dropping the FK would make the diff clean by *removing* an integrity guarantee |

### 3 — `PaymentDestination.capabilities`

| | |
|---|---|
| **Database** | `TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` |
| **Schema** | `capabilities String[]` — no default |
| **Evidence** | `20261005000000_payment_wallet/migration.sql:92` |
| **Classification** | **Migration defect** — default present in DDL, absent from the model |
| **Effect** | Only for raw SQL inserts that omit the column; Prisma always supplies a value |
| **Smallest safe correction** | `@default([])` — **no DDL** |
| **Risk** | None |

### 4 — `PaymentDestination` unique index name

| | |
|---|---|
| **Database** | `PaymentDestination_businessId_provider_providerDestinationId_pr` (63 characters) |
| **Schema** | unnamed `@@unique([...])` → Prisma expects `…_providerAccountRef_key` (**83 characters**) |
| **Evidence** | `20261005000000_payment_wallet/migration.sql:107` creates the 83-character name; PostgreSQL truncates identifiers to 63 bytes. Verified: `full_name[:63] == observed_name` |
| **Classification** | **Schema representation difference** — not a defect in either direction, a limit of the engine |
| **Effect** | None at runtime. The constraint exists and enforces the same four columns |
| **Smallest safe correction** | `@@unique([...], map: "PaymentDestination_businessId_provider_providerDestinationId_pr")` — **no DDL** |
| **Alternative rejected** | Renaming the index for tidiness is exactly the "rename a production object to make a diff appear clean" that this remediation forbids. A rename buys nothing and touches production |

### 5 — `PaymentProviderConnection.capabilities`

| | |
|---|---|
| **Database** | `TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` |
| **Schema** | `capabilities String[]` — no default |
| **Evidence** | `20261005000000_payment_wallet/migration.sql:137` |
| **Classification** | **Migration defect** — same as #3 |
| **Smallest safe correction** | `@default([])` — **no DDL** |
| **Risk** | None |

### 6 — `PosReceiptSequence` primary key

| | |
|---|---|
| **Database** | `CONSTRAINT "PosReceiptSequence_pkey" PRIMARY KEY ("businessId")`, plus index `PosReceiptSequence_businessId_idx` |
| **Schema** | `businessId String @unique` + `@@index([businessId])` — a unique *index*, not a primary key |
| **Evidence** | `20261005020000_pos_sale_refund_integrity/migration.sql:19–26` |
| **Classification** | **Schema representation defect** — the table has one row per business; a primary key is the honest model, and the schema understates it |
| **Effect** | None on rows or uniqueness — a primary key is strictly stronger. The application uses `upsert({ where: { businessId } })` and `findUnique({ where: { businessId } })`, both of which work identically with `@id` |
| **Smallest safe correction** | `businessId String @id`, keeping `@@index([businessId])` to describe the existing secondary index — **no DDL** |
| **Alternative rejected** | Dropping the primary key and adding a unique index would be a destructive production DDL whose only purpose is to satisfy a differ |

---

## 3. Why the correction is schema-side, and why it is not applied here

**Every one of the six is resolved by describing reality in `prisma/schema.prisma`.** Not one requires a `CREATE`/`ALTER`/`DROP` on production. That is the smallest safe correction by construction: the database is already right, or at least stricter, in all six cases.

It is **not applied** in this branch for two reasons:

1. **Scope.** `reconciliation.patch` changes the generated Prisma Client surface (`Business.paymentAttempts`, `PosReceiptSequence` identity). That belongs in its own reviewed change, not stapled to a CI pull request.
2. **Sequencing.** Applying it would empty the drift baseline, which must then be emptied in the same commit — a two-part change that deserves its own review rather than being bundled with CI infrastructure.

---

## 4. How the proposal is validated

A dedicated job in `.github/workflows/release-validation.yml` (`schema-reconciliation-proposal`) does this on PostgreSQL 18, on every push:

1. applies the complete migration history to a disposable database;
2. confirms the drift **equals the recorded baseline** (if this fails, the baseline is stale and the gate is lying);
3. `git apply` the patch in the runner workspace;
4. `npx prisma validate` — the reconciled schema must be valid;
5. `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --exit-code` — must exit **0**;
6. restores `prisma/schema.prisma` so the job cannot leak the change into another step.

Exit 0 at step 5 is the claim: *applying this patch makes the migration history and the schema agree exactly.* The job fails loudly if it does not.

---

## 5. After adoption

| Step | Action |
|---|---|
| 1 | Apply `reconciliation.patch` in the reconciliation pull request |
| 2 | Empty `scripts/ci/schema-drift-baseline.json` `entries` in the **same** commit |
| 3 | The gate then requires **zero** drift, with no baseline to hide behind |
| 4 | No production migration is required for this reconciliation — verify that claim on a disposable database before believing it |

**Residual risk if this is not adopted:** the Prisma Client will keep describing a database that does not exist in these six places. Today that is latent; it becomes a runtime error the moment code touches `Business.paymentAttempts`, relies on the `PaymentAttempt` cascade, or assumes `capabilities` has no default.
