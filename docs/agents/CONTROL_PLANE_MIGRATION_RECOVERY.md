# Control-plane foundation migration and recovery notes

Status: **NOT VALIDATED / NOT APPLIED**. These notes are a review/runbook draft for PR #78; they do not authorize deployment, migration, production reads/writes, or account provisioning.

## Scope and safety properties

Candidate migration: `prisma/migrations/20261126000000_control_plane_foundation/migration.sql`.

It adds the dedicated `ControlRole` enum; explicit, per-grant permission and optional business scope rows; encrypted-TOTP credential storage; and append-only control audit storage. It creates **no** grant, admin, role mapping, user, password, production data, provider configuration, DNS change or financial activation. Existing `CUSTOMER`/`ADMIN` roles are untouched. App code must continue to fail closed until an independently reviewed grant exists.

The audit table rejects ordinary `UPDATE` and `DELETE`. Grant rows reject deletion and mutation; one transition from active to revoked with a nonempty reason is allowed, after which the record is immutable. Do not add a rollback that drops the audit table or deletes its history. The migration is additive; preserve it on application rollback and use a reviewed forward migration for any schema repair.

## Before any migration

1. Obtain owner approval of the role/action/scope matrix, MFA/recovery policy, grant-provisioning authority, audit retention and business-suspension semantics in `OWNER_DECISIONS_AND_ACCEPTANCE.md`.
2. Review migration SQL against the generated Prisma schema and a disposable PostgreSQL database. Run the migration test below; test both clean creation and rollback of an uncommitted DDL transaction, then forward re-apply in a scratch schema.
3. Capture the exact candidate commit, schema hash, Prisma version, database version, migration status and backup/restore evidence. Confirm the target is the intended environment and not production unless an explicit future authorization names that target and action.
4. No production test, migration, configuration update, role grant or data read is authorized by this candidate.

## Disposable PostgreSQL checks

Use only a disposable loopback database named `jata_ci`, `jata_recon`, `jata_e2e`, `jata_verify`, `jata_agent_test` or `jata_rehearsal_full`, and set `PRISMA_TEST_DATABASE_URL`. The test creates an isolated random schema, runs the candidate migration, and drops the schema afterward:

```sh
npx vitest run tests/prisma/control-plane-foundation-postgres.test.ts
```

The test covers no grant seeding, exact fixture-only grant creation, one-time revocation, grant immutability, audit update/delete rejection, rollback of an uncommitted scratch migration, and re-application. It is **not evidence** unless the configured disposable database exists and the test reports executed (not skipped). It was not executed in the current environment because no PostgreSQL client/server or disposable database URL is available.

## Rollback and recovery

- Before the migration commits: abort the transaction; verify none of the control-plane tables, enum, functions or triggers remain. The test's scratch-schema rollback should prove this on the target PostgreSQL major version.
- After a commit: roll back only application code if necessary. Keep the additive schema and all audit/grant records. Do not `DROP TABLE`, truncate, delete events, remove triggers, or reverse enum/type structures containing audit history.
- If the application and schema disagree: stop control actions and fail closed. Preserve database evidence, take an approved backup, inspect `_prisma_migrations`, and author a new forward-only repair migration. Test recovery in a disposable clone first; restore only from an approved backup with owner and database-operator authorization.
- If the audit writer fails during a business mutation or session revocation, the enclosing transaction must roll back the business/session change. Report the operation as failed; never claim success from an HTTP response alone.
- No break-glass account, recovery MFA secret, default role mapping, or production grant is provided. Owner approval and an independently reviewed provisioning process are blocking dependencies.

## Current evidence

- `PRISMA_SCHEMA_ENGINE_BINARY=$(command -v node) PRISMA_QUERY_ENGINE_LIBRARY=$(command -v node) DATABASE_URL='postgresql://validation_only:validation_only@127.0.0.1:5432/validation_only?schema=public' DIRECT_URL='postgresql://validation_only:validation_only@127.0.0.1:5432/validation_only?schema=public' npx prisma generate --no-engine` parsed the schema and generated Prisma Client v5.22.0 with `engine=none`; `npx tsx scripts/erp/check-models.ts` reported schema/client model consistency **163/163**. This is schema parsing/model agreement, not native `prisma validate`, a database connection, or SQL migration proof.
- Native Prisma validation/generation remains blocked because `binaries.prisma.sh` could not be reached. Relation semantics against PostgreSQL and native migration verification remain **NOT TESTED**.
- PostgreSQL disposable integration checks are present but **NOT RUN** (no configured test database).
- No migration has been applied to any environment. No production data or settings have been accessed or changed.
