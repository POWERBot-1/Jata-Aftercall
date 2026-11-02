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
| Database time bounded: 5 s per read statement, 10 s per reconciliation statement, and 15 s for the whole reconciliation transaction (explicit, see below) | same file, `SET LOCAL statement_timeout` and `$transaction` options; constants in `lib/agents/referral-report-bounds.ts` |
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

## Owner visual review (recorded 2 Nov 2026)

- **Result:** PASS, by the owner. This is an **owner attestation only**. It is not an independent review.
- **Artifact:** `agent-reports-f8eccb3b91af22f437ff9d2e8b7a9cc892572786`, from journey run `41444083264` (success).
- **Commit linkage:** the artifact name uses `github.sha`, which for a `pull_request` run is the merge commit
  `f8eccb3b91af22f437ff9d2e8b7a9cc892572786` (parents `19f11d9` = main and `6d697681ca6c7827a7e3f2472a955b10cf33acb4` = PR head).
  Its tree `25e9b722b19b5430ca5fbe242ab81909b9d1e462` equals the PR head tree.
- **Agent inspection:** the agent could not download the artifact (blob EOF from `gh run download`), so the agent has
  not opened or inspected the screenshots. The PASS above is the owner's and is recorded as such.
- **Independent review:** still outstanding where the canonical criteria require it. This owner PASS does not satisfy it.

## 50,000-member scale evidence (disposable PostgreSQL, real route code)

File: `scripts/test-db/manual/agent-referral-revision-scale-50k.manual.ts`. It is gated by `JATA_SCALE_50K=1`, and it is kept
out of every vitest glob on purpose: a skipped test in the CI database run fails the release guard. The header gives the copy-run-delete command. It is **not** in the CI DB suite (count stays at 31). Report: `docs/agents/evidence/migration-20261127/scale-50k-timing.json`.
Sandbox timings, single run, synthetic data:

| Measurement | Result |
| --- | --- |
| Walk every page of a 50,000-member revision: 100 pages, each member exactly once | PASS |
| Slowest read page (500 members) | 111 ms (budget 5 s statement) |
| Reconcile unchanged at 50,000 (read-only) | 1.5 s, `UNCHANGED` |
| Reconcile after one addition (50,001) | refused, 409 `too_large`, no new revision |
| Reconcile write at the cap (49,999 + 1 = 50,000) | PASS, `RECONCILED` revision 2, 5.6 s |
| Read first page of revision 2 | 68 ms |

**Finding (fixed in this change).** Before the fix, the write at 50,000 failed with 503. The cause was not the 10 s
statement timeout. Prisma's interactive transaction defaults to 5,000 ms, and that budget expired during the write
(`Transaction already closed ... timeout for this transaction was 5000 ms`). The route fails closed, so no partial
revision was committed, but the 10 s statement bound alone did **not** hold for the reconciliation. The fix is an
explicit transaction budget: `timeout` 15 s and `maxWait` 5 s on the reconciliation transaction. The measured write
took 5.6 s, so 15 s leaves about 2.6x headroom. `tests/security/agent-referral-report-reconciliation.test.ts`
asserts the budget.

**Not established by this scale run.** This is one sandbox run. CI runners may be slower, so a 15 s budget could
fail closed there. The owner decides whether 50,000 is approved for production. Visual acceptance does not approve it.

## Migration rehearsal (disposable PostgreSQL, SQL level)

Script: `scripts/test-db/rehearse-revision-bounds.mjs`. Report: `docs/agents/evidence/migration-20261127/rehearsal-report.json`.
It starts a loopback embedded PostgreSQL (18.6), and never reads `DATABASE_URL` or `DIRECT_URL`. Result: **11/11 PASS**.

| Check | Result |
| --- | --- |
| R1 forward migration applies on the full committed history (58 migrations) and the cap is 50,000 | PASS |
| R6a 5,000 and 5,001 baselines accepted under the new cap | PASS |
| R2 rollback refused while any revision holds more than 5,000 members, with the message `Rollback refused: a revision holds more than 5,000 members`; no row changed | PASS |
| R5 evidence UPDATE and DELETE still refused after the migration | PASS |
| R6b 50,001 refused by the limit; 50,000 passes the limit and is refused only for membership mismatch | PASS |
| R3a existing evidence (fingerprint of every member and revision row) unchanged by forward migration | PASS |
| R3b rollback succeeds when no revision exceeds 5,000, and restores the 5,000 cap | PASS |
| R3c evidence unchanged by rollback | PASS |
| R4a after rollback, a 5,001 baseline refused again | PASS |
| R4b forward migration re-applied after rollback | PASS |

**Irreversibility point.** The rollback is available only while every stored revision holds at most 5,000 members.
Once the first revision above 5,000 members is written, the rollback is refused. Evidence rows cannot be deleted
because of the immutability triggers. Reverting after that point would need owner-approved data handling. Production
migration therefore requires owner approval before it runs.

## Not established

- **Screenshots were not opened by the agent.** The owner's PASS above is an attestation. The agent has not inspected the images.
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
