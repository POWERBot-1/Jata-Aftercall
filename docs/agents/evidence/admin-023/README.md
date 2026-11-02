# ADMIN-023 evidence record

Status recorded in `docs/agents/PROGRAMME_READINESS.json`: **NOT_TESTED (unchanged)**.
The ledger is not updated to PASS because the screenshots have not been inspected (see "Not established").

## What the §028 criterion requires

Own-agent immutable revision reads (`GET /api/agents/reports/referrals/reconcile`) with a bounded
event-ID cursor and a next-page marker, plus own-agent snapshot pagination, malformed and cross-tenant
rejection, PostgreSQL evidence and browser evidence.

## What is implemented

| Area | Evidence |
| --- | --- |
| Per-revision ceiling raised from 5,000 to 50,000 (refuse, never truncate) | `prisma/migrations/20261127000000_agent_referral_report_bounded_pages/migration.sql`; the cap is in `lib/agents/referral-report-bounds.ts` |
| Read page of 500 members, `nextCursor` only when more remain | `app/api/agents/reports/referrals/reconcile/route.ts` (`GET`) |
| Database time bounded: 5 s read, 10 s reconciliation | same file, `SET LOCAL statement_timeout` |
| Reconciliation above 5,000 members, written in chunks of 1,000 inside the same transaction (write fence applies) | same file, `POST` |
| Malformed, duplicated, over-long and unknown-parameter requests refused before any row is read | `EVENT_CURSOR_PATTERN` and the parameter checks in `GET` |
| Rollback, documented and self-guarding (refuses if any revision exceeds 5,000) | `docs/agents/migrations/20261127000000-bounded-pages-rollback.sql` |
| Revision reader in the UI: 44 px "Load more evidence", source and day only, no event IDs, names or phone numbers | `components/agents/AgentRevisionEvidence.tsx`, rendered by `components/agents/AgentReferralReports.tsx` |

## Automated evidence

| Check | Where | Result on this head |
| --- | --- | --- |
| Real PostgreSQL, 11 tests: 5,001-member baseline paged exactly once; next-page marker at 500 and 501; cursor replay; forged well-formed cursor cannot widen scope; malformed cursors; reconciliation beyond 5,000 with idempotent replay; write fence; rollback of partial reconciliation; database refusal above the cap and at the cap; concurrent reconciliation | `tests/db/agent-referral-revision-pages.test.ts`, run by `.github/workflows/db-suite.yml` (expects 31 tests across three files) | Database suite on the previous head (`05f5b33`, run `41441483430`): success. Current head: see the final CI report. |
| Snapshot pagination, cross-tenant isolation on real PostgreSQL | `tests/db/agent-referral-report-pagination.test.ts` | same run |
| Browser journey on the real route, real PostgreSQL, six viewports: refusals, snapshot pagination, the 5,001-member revision with a next-page marker, a full walk of every page at 390 px, probes for another agent's revision (404) and a malformed cursor (400), loading and error states | `scripts/browser/agent-reports.check.mjs`, `.github/workflows/agent-reports-e2e.yml` | Journey run `41441483303` on `05f5b33`: success |
| Mocked route tests (bounds, pagination, legacy and over-cap refusal) | `tests/security/agent-referral-report-reconciliation.test.ts` | pass locally and in CI |
| Migration allowlist and destructive-SQL guard | `tests/unit/repair-guards.test.ts` (migration registered with its scope) | pass |

The journey walks every page at 390 px only. Other viewports check the first 500-member page, the
next-page marker, the touch target, overflow and a screenshot. The reason is the 30-per-minute
per-agent limit on revision reads. The rate limit was not changed.

## Performance finding and fix

The first revision read on a 5,001-member revision took about 2.8 s, and every later page took the same time,
because the evidence-drift check ran the full comparison on every request. The correlated `NOT EXISTS`
comparison was the cost. Its cost grows with the square of the membership when statistics are stale, and
the 5 s statement timeout would fail it on a loaded runner (one CI job returned 503 for this reason).

The comparison is now a single full outer join on (eventId, source, eventCreatedAt) in
`lib/agents/referral-report-drift.ts`. Measured on the same embedded PostgreSQL: a 5,001-member test fell from
32.5 s to 2.0 s, and the reconciliation test fell from 46.5 s to 3.1 s. The drift statuses are unchanged and
are asserted in `tests/db/agent-referral-revision-pages.test.ts`, which covers late, changed and removed evidence and restoration.

`tests/prisma/agent-report-versions-postgres.test.ts` covers the same states, but its guard accepts only
named disposable databases (`/jata_ci` and similar). It is not run by the DB suite runner, so it is not counted here.

## Not established

- **Screenshots are not visually reviewed.** The journey writes six first-page and six all-pages
  screenshots to the `agent-reports-<sha>` artifact. The artifact cannot be downloaded from the
  sandbox, so no visual PASS is claimed.
- **Independent review.** The owner's criterion requires independent inspection. This record is not an
  independent review.
- **Runner Chrome path.** The journey needs a Chrome binary on the runner. Its pass on the CI runner is
  the only evidence that it ran.
- **Production.** Nothing here has been run against production. The migration has not been applied to
  any production database. Its rollback has not been rehearsed against a backup.
- **Concurrency under load.** The concurrency test has two overlapping reconciliations. It is not a load test.
- **Expired cursors.** Cursors do not expire. A cursor is a bare event ID with no authority, and the
  revision it reads is immutable, so an old cursor only filters the same agent's own revision. Expiry
  would need a signed-cursor design that is not in scope.
