# ADMIN-023 evidence record

Status recorded in `docs/agents/PROGRAMME_READINESS.json`: **NOT_TESTED (unchanged)**.

## What is implemented and verified

| Area | Evidence |
| --- | --- |
| Own-agent snapshot list, keyset cursor (`GET /api/agents/reports/referrals?cursor=`) | `app/api/agents/reports/referrals/route.ts`, `lib/agents/referral-report-cursor.ts` |
| Malformed, forged and non-canonical cursors refused before any database access | `tests/unit/agent-referral-report-cursor.test.ts`, `tests/security/agent-referral-reports.test.ts` |
| Cross-tenant isolation and total ordering on real PostgreSQL (105 own rows, tie on `endExclusive`, another agent's rows absent, forged cursor, no active agent denied) | `tests/db/agent-referral-report-pagination.test.ts`; database suite run via `scripts/test-db/run-db-suite.mjs` and `scripts/test-db/assert-db-suite.mjs` |
| Negative control: ignoring the cursor makes the PostgreSQL pagination test fail | Run locally during the change; file restored and verified byte-identical |
| Page access control (anonymous, ADMIN without an agent application, suspended or inactive agent, feature off, lookup failure) | `app/agents/reports/page.tsx`, `tests/security/agent-reports-page-access.test.ts` |
| Real-route browser journey in Chrome against the production build and a disposable PostgreSQL 16 service: refusals at 320 to 430 px, sign-in redirect, populated pagination without duplicates, cross-tenant absence, loading and error states, a 44 px load target, no unexpected console errors | `scripts/browser/agent-reports.check.mjs`, `.github/workflows/agent-reports-e2e.yml` |

Browser journey run that exited 0 and printed `RESULT: PASS`: GitHub Actions run `41431847046` on head `d9410f9949d1fe182fdddd245a0678874d97b94b`. Per-check output is in that run's job log.

## What the criterion requires that is NOT established

The §028 criterion in `docs/ADMIN_BUILDING_INSTRUCTIONS.md` is about **own-agent immutable revision reads** (`GET /api/agents/reports/referrals/reconcile`) with a bounded event-ID cursor and next-page marker.

- The `nextCursor` marker is only produced when a revision has more than `MAX_MEMBERS` (5,000) members.
- The baseline database trigger refuses any snapshot whose membership exceeds 5,000 (`referral report baseline exceeds membership limit`), so that marker cannot be produced by any valid fixture without changing the database limit.
- Lifting that limit is the "bounded processing beyond 5,000 members" work in §028, which is still in progress. It is a database and product decision that belongs to the owner.

Therefore the browser journey does not exercise the revision next-page marker, and ADMIN-023 cannot be recorded as PASS.

## Scope notes

- The page reads only the signed-in active agent's own snapshots. No administrator read path was added.
- Counts only. No names, phone numbers, application identifiers or payment data are shown.
- Fictional agents only, in a disposable database. No messages, payments or live automation.
- The screenshots written by the browser journey are uploaded as the `agent-reports-<sha>` CI artifact. They have not been visually reviewed in this record, so no visual PASS is claimed.
