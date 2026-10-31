# Owner instruction register workflow

`ADMIN_BUILDING_INSTRUCTIONS.md` is append-only. Read the full current register and owner directive before assigning the next global three-digit section number and the next sequential ID within its namespace (for example `ADMIN-016` or `MOTION-005`). Append at the end; do not edit the template or prior entries. Record the original instruction or durable source, date, owner approval, business purpose, functional and security/privacy requirements, UI/UX, affected paths/data/integrations, acceptance tests, dependencies, conflicts, status, evidence and implementation commit. Never place credentials or sensitive contact information in the document.

A correction is itself a new numbered requirement. Retain the old text verbatim and include `**Correction of:** ADMIN-001` (replace with the actual earlier ID), `**Change:**`, `**Approval:**` and `**Original retained:**`, with substantive explanations. If the owner has not resolved a conflict, record the conflict and do not implement the conflicting behavior. A status or evidence update is also an appended entry, never an edit to an earlier entry. Tests or a commit alone do not imply VERIFIED.

Before committing, run:

```sh
node scripts/admin/check-building-instructions.mjs
node --test scripts/admin/tests/instruction-integrity.test.mjs
```

After committing, run `node scripts/admin/check-building-instructions.mjs --ci`. The CI mode requires the file to match the committed candidate and rejects uncommitted additions. `.github/workflows/admin-instructions.yml` fetches complete history and runs both checks on pull requests. Shallow history is rejected; a local shallow checkout can fetch complete history before checking. The checker validates sequential IDs, required fields, structural correction references and append-only history from the earliest reachable introduction. It cannot prove that Git history was never rewritten outside its view, that a summary faithfully captures an owner message, or that a claimed owner approval is genuine. Human review against the original source is still mandatory.
