-- Ledger line integrity — every journal line must belong to a journal that exists.
--
-- WHY THIS EXISTS
-- `ErpJournalLine.journalId` is a bare `String` in prisma/schema.prisma with only an index, and the
-- POS/ERP PRO migration created it without a reference. Nothing stopped a line from pointing at a
-- journal id that does not exist (or was never committed), which is exactly the "orphaned journal
-- line" case the integrity view cannot repair on its own.
--
-- Additive only: one constraint. No column is altered, no row is rewritten or deleted, and the
-- file contains no `DROP`, no `UPDATE "<Table>"` and no `DELETE FROM`.
--
-- NOT VALID is deliberate. On a database that already holds orphans, a validating constraint would
-- make `prisma migrate deploy` fail — turning a data-repair job into a failed deploy on a live
-- system. `NOT VALID` enforces the rule for every new insert and update immediately, while leaving
-- existing rows to be cleaned and then validated by an operator:
--
--   1. inspect:   SELECT l.id FROM "ErpJournalLine" l
--                 LEFT JOIN "ErpJournal" j ON j.id = l."journalId" WHERE j.id IS NULL;
--   2. repair:    an orphan is a line whose journal never committed; delete it with an audit note
--                 (it is not part of any posted ledger and cannot balance one).
--   3. validate:  ALTER TABLE "ErpJournalLine" VALIDATE CONSTRAINT "ErpJournalLine_journalId_fkey";
--
-- ON DELETE RESTRICT matches the delete guard in 20261127000001: a journal with lines is never
-- deleted, so a cascade here would silently contradict it.
--
-- WHAT THIS DOES AND DOES NOT GUARANTEE — read before claiming integrity:
--   • `NOT VALID` enforces the reference for every NEW insert and every UPDATE of journalId.
--   • It does NOT scan existing rows. `pg_constraint.convalidated = false` therefore means "unknown
--     for historical rows", not "clean". No existing-data integrity claim may be made from this
--     migration alone.
--   • `scripts/verify/mjengo-postgres-verify.mjs` reports `convalidated` explicitly and counts
--     pre-existing orphans separately, so the two states cannot be confused in the report.
--   • The constraint stays NOT VALID until an operator has run step 1–3 below and the count is zero.
--     Validation is a deliberate, separate, downtime-free step: `VALIDATE CONSTRAINT` takes only a
--     SHARE UPDATE EXCLUSIVE lock.
--
-- Rollback: ALTER TABLE "ErpJournalLine" DROP CONSTRAINT "ErpJournalLine_journalId_fkey";

ALTER TABLE "ErpJournalLine"
  ADD CONSTRAINT "ErpJournalLine_journalId_fkey"
  FOREIGN KEY ("journalId") REFERENCES "ErpJournal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;
