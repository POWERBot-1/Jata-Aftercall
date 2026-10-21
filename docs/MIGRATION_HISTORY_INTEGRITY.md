# Migration history integrity — why applied migration files are never edited

Status: operational rule + record of a deliberate deviation from the recovered patch.
Owner: platform maintainers. Last updated: 2026-10-20.

## 1. Rule

A migration file that has ever been applied to a shared database is **immutable**.
It is not documentation. Its bytes are part of the migration's identity.

Prisma records a checksum for every applied migration in `_prisma_migrations`.
The checksum is derived from the migration file. Editing an applied migration —
even a comment — makes the file disagree with the recorded history.

What each command does with a modified applied migration:

| Command | Behaviour |
|---|---|
| `prisma migrate deploy` | Does **not** verify checksums of already-applied migrations. It will not fail, so it will not warn you either. |
| `prisma migrate dev` | Detects the modified migration and offers to reset the database. A reset is destructive. |
| `prisma migrate status` | Reports migration state; a modified applied migration is a history inconsistency even when the schema looks correct. |
| `prisma migrate diff` / shadow-database work | Builds from the migration directory; a difference here no longer describes the released history. |

Because `scripts/build.sh` runs `prisma migrate deploy` on every Vercel build
that has `DATABASE_URL` set, a silently modified migration would ship without
any failure signal. The absence of a failure is not approval.

## 2. The specific case

The recovered candidate patch changed the first line of two migrations released
on 2026-10-10:

| Migration | Original first line | Patch first line |
|---|---|---|
| `20261010000000_sale_price_windows` | `-- Sale-price windows for the catalogue (approved pricing policy C).` | `-- Sale-price window columns used by the current catalogue implementation; schema presence does not imply owner approval.` |
| `20261010000100_pos_sale_price_windows` | `-- Sale-price windows for POS products (approved pricing policy C, same rule as the catalogue).` | `-- Sale-price window columns used by the current POS implementation; schema presence does not imply owner approval.` |

Both are single-line, comment-only. The DDL below them is untouched. They are
still **rejected for this candidate**, because the correction they carry belongs
in documentation, not in released migration bytes.

Recorded SHA-256 of the released files (used to verify the candidate):

```
8238d9b5d8a2a7fe3e674431f29f59f90501d0f3971b1ad2a8a572352f78ff34  20261010000000_sale_price_windows/migration.sql
548238646d7c7432c3499bfade96cf1369c53b907be351ca64dc4392a8863a61  20261010000100_pos_sale_price_windows/migration.sql
```

Candidate resolution: both files are restored byte-identical to commit
`2575cf461d33476a6bf8edb44fc56dc63498152a`. The correction is carried by this
document and by `OWNER_NOTICE_SALE_PRICES.md`, which the patch already updates
with an explicit “draft only / not owner approval” status line.

## 3. What the correction actually says

The sale-window columns exist and are used by the current implementation. That
is a statement about code, not about consent. It does **not** establish that an
owner approved “pricing policy C”, and no such approval is claimed anywhere in
this candidate. The open owner decision is tracked in `RELEASE_BLOCKERS.md`
item 7, `RELEASE_DECISIONS.md` §2 and `OWNER_APPROVAL_REQUEST.md` G2.

## 4. Going forward

- Never edit an applied migration. Add a new migration, or add documentation.
- If a comment in an applied migration is misleading, write the correction in
  `docs/` and reference the migration by name.
- Before any future release, verify migration-file integrity against the
  previously released commit:

  ```bash
  git diff --stat <released-sha> -- prisma/migrations
  ```

  Any output for already-applied migrations is a release blocker until explained.
- Do not run `prisma migrate dev` against a shared database to “fix” history.

## 5. Not done here

No migration was executed. No database was contacted. No production history was
rewritten. The only change is that this candidate keeps the released bytes.
