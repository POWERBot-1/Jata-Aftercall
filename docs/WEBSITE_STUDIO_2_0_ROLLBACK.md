# Website Studio 2.0 — rollback and recovery procedure

**Applies to:** P1 workspace/site foundation and P2 independent content/history data plane.
**Production status:** no production migration or deployment has been performed by these PRs.

## Design for rollback

Both phases are additive. The original `BusinessExperience` records remain intact and continue to be the compatibility source for the existing public Business Page and legacy Studio routes. P2 copies the legacy default-site content into `StudioWebsiteContent` and writes new per-site drafts/revisions to the new tables; it does not update or delete the legacy row.

The migration is intentionally not paired with a destructive down migration. Dropping the new tables would destroy owner content and revision history. Rollback is an application rollback that retains the additive tables.

## Application rollback after a future production release

1. Stop or disable new Studio 2.0 editor/publish writes at the application release layer. Do not delete site, content, revision, media or workspace records.
2. Re-deploy the last known-good JATA AFTERCALL application build that predates the Studio 2.0 cutover, using the approved Vercel release process.
3. Confirm the old public business page reads the unchanged `BusinessExperience` draft/published fields and that call, WhatsApp, catalogue, order, booking, payment, POS and Front Desk journeys remain operational.
4. Keep `StudioWorkspace*`, `StudioWebsite*` and their additive rows in PostgreSQL. The old application ignores them; a later forward-fix can resume without data reconstruction.
5. Preserve the failed deployment SHA, migration history, CI logs and database snapshot reference in the release record.

## Migration failure recovery

- Run migration rehearsal only against disposable PostgreSQL before production approval.
- If a migration fails in a disposable environment, discard that disposable database and fix the migration in a new commit; do not edit production migration history.
- For any future production migration failure, stop writes and take/retain a database snapshot. Inspect `_prisma_migrations` and the exact SQL effects before any recovery command.
- Never issue `prisma migrate resolve --rolled-back`, drop tables, or manually delete rows until the database state is inspected and the recovery procedure is approved by the owner/DB operator.
- Prefer a forward-only corrective migration if any part of an additive migration was committed.

## Verification evidence required before release

- `prisma migrate deploy` succeeds on a fresh disposable PostgreSQL database.
- P1/P2 integration tests prove the original `BusinessExperience` row is byte-for-byte unchanged after independent site draft save/restore.
- The migration guard rejects destructive `DROP TABLE` and `TRUNCATE` statements.
- The prior application can continue reading the legacy BusinessExperience shape because P1/P2 do not remove or rename it.
- Production rollback rehearsal must be completed against a production-like snapshot before the first production migration. It is NOT claimed complete by the current PRs.
