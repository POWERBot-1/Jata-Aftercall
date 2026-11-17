# PostgreSQL 18 migration, backup and recovery evidence

Status: **PASS for the disposable candidate rehearsal only. NOT production approval.**

## Exact candidate and workflow

- Repository: `POWERBot-1/Jata-Aftercall`
- Branch: `remediation/owner-authorized-acceptance-v2-2026-11-16`
- Candidate SHA: `4cd6dd59b41a8f25e44820bf691a1394685bebc9`
- Workflow: Candidate migration rehearsal
- Workflow run: [44167665563](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/44167665563)
- Native migration job: `134337950621`
- Backup/restore job: `134337950950`
- PostgreSQL image: `postgres:18`; backup/restore client: PostgreSQL 18.7
- Environment: isolated GitHub Actions disposable PostgreSQL containers; synthetic records only; no production URL, credentials, data or provider calls.

## Native migration rehearsal

The exact candidate migration rehearsal completed successfully:

1. Candidate history contained 65 migration directories. The rehearsal verified the migration manifest and `migration_lock.toml` against the baseline; no existing migration was added, removed or rewritten in this candidate.
2. All 65 migrations applied in filename order to a fresh disposable PostgreSQL 18 database.
3. The Prisma migration ledger contained 65 completed rows, with no rolled-back or failed rows; names matched migration directories.
4. Promised database objects were checked against the candidate schema.
5. A second `prisma migrate deploy` applied no migrations and left the 65-row ledger unchanged (idempotence).
6. The migrated catalogue and `prisma/schema.prisma` agreed (empty schema diff).
7. A deliberately broken migration failed with a non-zero exit, recorded an unfinished/error ledger row, and caused `migrate status` to fail. The rehearsal reported `RESULT: PASS`.

The CI log also records the intentionally rejected duplicate/idempotency and invalid-constraint operations from the synthetic test suites. These are expected negative cases, not unhandled test failures.

## Full logical backup and restore

The exact candidate's full backup/restore job passed:

1. Verified `pg_dump` and `pg_restore` 18.7.
2. Created the disposable database, applied candidate migrations and seeded synthetic records.
3. Created a complete custom-format logical backup and verified its archive listing.
4. Restored that backup into a separate empty disposable database.
5. Compared normalized schema DDL and canonical CHECK-constraint expressions.
6. Compared row counts across all 194 user tables.
7. Compared migration-ledger rows and completed-state counts.

The job emitted:
- `PASS: complete custom-format logical backup created and archive list verified`
- `PASS: backup restored into a separate empty database`
- `PASS: normalized schema DDL and canonical CHECK constraint expressions match`
- `PASS: row counts match across all 194 user tables`
- `PASS: migration ledger rows and completed-state counts match`
- `RESULT: PASS — disposable full-database backup/restore, schema and row-count comparison`

## Non-reversible migration strategy

The migration policy for this application is **forward-only after commit**. A committed migration is not treated as reversible merely because an SQL down-script can be written.

1. **Classify before implementation.** Record whether a migration is additive, transactionally reversible before commit, or data-transforming/destructive and therefore non-reversible. Identify affected tables, constraints, indexes, application versions, data-retention obligations and the recovery path.
2. **Use expand/contract for incompatible changes.** First add nullable columns/tables/indexes or compatible constraints. Deploy code that can read both representations and, where necessary, dual-write. Backfill in bounded, restartable, idempotent batches. Verify counts, checksums, null/constraint violations and application compatibility before enforcing new constraints.
3. **Separate contraction.** Remove obsolete columns, enum values, tables or old write paths only in a later release after all deployed application versions and jobs have stopped using them and the backfill is independently verified. Never combine destructive contraction with the first expand deployment.
4. **Before any production migration.** Require explicit owner/operator authorization for the named environment; verify exact commit and migration checksums; take a full backup; verify the archive; restore it into a separate database; compare schema, constraints, row counts and migration ledger; record the backup identity and recovery operator. This CI rehearsal is not a production backup.
5. **Before commit.** If the migration is transactional and fails before commit, abort and verify the transaction left no partial DDL/data. If the migration is not safely transactional, use a disposable clone and a tested compensating/forward-repair plan; do not rely on rollback semantics that PostgreSQL or Prisma does not guarantee.
6. **After commit.** Roll back application code only when it remains compatible with the committed schema. Preserve migration history and audit/financial records. Correct defects with a new, reviewed, forward-only migration. Do not drop or rewrite committed migration directories or mark a failed migration applied without a separately reviewed recovery procedure.
7. **Catastrophic recovery.** Stop writes and scheduled workers, preserve logs and the source database, restore the verified backup into a new isolated database, validate schema/constraints/ledger/row counts and application compatibility, then perform a separately authorized cutover. Do not overwrite the original primary as an unreviewed first response.
8. **Evidence and approval.** Retain the exact commit, schema/migration hashes, PostgreSQL/Prisma versions, backup/archive identity, restore result, row-count comparison, migration ledger, test logs and operator approval. No production migration, restore, cutover, database configuration change or deployment is authorized by this document.

## Scope and limitations

- **PASS:** fresh PostgreSQL 18 migration history, ordered ledger, schema/object parity, idempotent second deploy, deliberate failure detection, full logical backup/restore and data-integrity comparison on the exact disposable candidate.
- **NOT TESTED:** production backup/restore, production RPO/RTO, production cutover, real customer-data recovery, provider or application operations after a production restore. No production database was accessed.
- This evidence closes the candidate's disposable backup/restore and documented non-reversible-migration strategy requirement only. It does not authorize a production migration or release.
