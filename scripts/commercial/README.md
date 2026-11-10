# scripts/commercial — Phase 0 inventory pack (PREPARED, NOT EXECUTED)

SQL for the §41.2 read-only production audit and the approval-gated catalogue migration.
**Nothing in this directory has been executed against production.**

| Script | Purpose | Status |
|---|---|---|
| `phase0_readonly_inventory.sql` | Read-only production inventory (catalogue, subscriptions, entitlements, payments, anomalies, protected populations, canaries) | VALIDATED (below) — **awaiting owner/operator run** |
| `01_extend_front_desk_catalogue.sql` | Idempotent guarded insert of the three new Front Desk tiers + Starter display-name change | PREPARED — execution requires §41.11 approval |
| `02_rollback_front_desk_catalogue.sql` | Deactivate exactly the three new tiers | PREPARED — execution requires §41.11 approval |
| `03_reconcile.sql` | B-1…B-6 before/after reconciliation report (SELECTs only) | PREPARED — run before and after execution |

---

## Validation record — `phase0_readonly_inventory.sql` (2026-11-05)

Validation performed mechanically against the file and `prisma/schema.prisma`:

1. **Statement inventory:** 16 statements after comment stripping — **16/16 are `SELECT`**;
   0 non-SELECT statements (scripted split on `;` + parse of leading keyword).
2. **Write-keyword scan:** zero occurrences of `INSERT | UPDATE | DELETE | ALTER | DROP |
   TRUNCATE | CREATE | GRANT | REVOKE | COPY | MERGE | CALL | BEGIN | COMMIT | ROLLBACK |
   SET | DO` and no `SELECT … INTO`. The file cannot write even if executed verbatim.
3. **Schema cross-check:** every table (`PlanConfig`, `Subscription`, `Payment`,
   `AIPackageEntitlement`, `ProcessedWebhook`, `PosSubscription`, `AutopilotSubscription`,
   `User`) and every column referenced exists in `prisma/schema.prisma` with matching case
   (quoted identifiers) and nullability handling (LEFT JOINs for nullable `planId`/`businessId`).
   Enum columns (`status`) are compared as text — valid on PostgreSQL.
4. **Reconciliation baseline encoded:** query B expects `plan_rows = 8` (owner-verified
   2026-10-29); after approved execution it must read 11.

Verdict: **read-only confirmed; run-safe against the production schema.**

---

## Exact instructions — executing the inventory against the production Neon branch

**Who:** the owner or an authorised operator (read-only task). **What:** the file above, unmodified.
**Target:** the enrolled production Neon branch (project `damp-forest-92941163`, database
`neondb`) — the same branch verified by the 2026-10-29 owner query.

### Option A — Neon SQL Editor (no client install)

1. Sign in to the Neon console → project → **production branch** → **SQL Editor**.
2. Paste this session guard first (harmless if the editor splits statements; it makes every
   statement in the session refuse writes at the database level):
   ```sql
   SET default_transaction_read_only = on;
   ```
3. Paste the **entire contents of `phase0_readonly_inventory.sql`** and run it.
   If the editor runs statements one at a time, run the guard once, then run the file.
4. Export **every result grid** (queries A … J, 16 grids) — Neon's *Download CSV* per query, or
   copy all rows. Do not trim rows.
5. Record: timestamp (with timezone), Neon branch id/name, and the editor account used.

### Option B — `psql` from an operator machine

```bash
PGOPTIONS="-c default_transaction_read_only=on" \
  psql "$READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/commercial/phase0_readonly_inventory.sql \
  -o phase0_inventory_output.txt
```

`PGOPTIONS` forces every transaction in the session read-only at the database level — a second
independent guarantee on top of the file's SELECT-only content. Any write attempt (there is none
in the file) would be rejected by PostgreSQL itself.

### Returning the evidence

- Return the **raw output verbatim** (all 16 grids / the `psql` output file) through the agreed
  **private** channel (owner's records or a private issue/DM) — **never commit raw production
  customer data to this repository: it is PUBLIC.**
- The customer migration register (`docs/commercial/06_CUSTOMER_MIGRATION_REGISTER.md`) is then
  populated **only** from that verbatim output, using pseudonymous `businessId`s and **masked
  emails** (`j***@example.com`); full emails stay in the owner's private inventory copy.
- No row may be hand-authored, inferred or invented (register §1).

### What unblocks

Supplying this output unblocks deliverable **#3** (customer entitlement inventory), the
BEFORE snapshot of `03_reconcile.sql`, and the populated register — the last data prerequisite
before the §41.11 approval request can be finalised (see `docs/commercial/07_RELEASE_READINESS.md`).
