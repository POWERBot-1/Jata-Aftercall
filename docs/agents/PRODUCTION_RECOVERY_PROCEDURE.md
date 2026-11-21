# Production recovery procedure and evidence

**Status: BLOCKED for production recovery acceptance.** This is a runbook and read-only provider observation. No production restore, snapshot creation, retention change, branch switch, or plan upgrade has been performed.

## 1. Current provider observation

Read-only Neon account inspection on 2026-11-20 identified:

| Property | Observed value |
|---|---|
| Project | jata-aftercall |
| Project ID | damp-forest-92941163 |
| Region / engine | aws-us-east-2 / PostgreSQL 18 |
| Production branch | production |
| Branch ID | br-cold-snow-ax606swa |
| Branch state | ready |
| Root / default | Yes |
| Branch protection | Disabled |
| History retention | 21,600 seconds (6 hours) |
| Provider snapshot listing | Empty (no snapshots returned) |
| Actual selectable PITR timestamp range | Not returned by the inspected API |
| Restore rehearsal against Neon | Not performed |

A ready branch and six-hour history retention do not prove a reachable restore point. An empty snapshot listing means no provider-native snapshot was visible to this inspection. Do not describe the production database as recoverable until the actual selectable PITR window and a separate restore drill are evidenced.

## 2. Recovery targets and trigger

Owner-approved targets: RPO ≤ 15 minutes for authoritative payment, subscription and ledger data; RTO ≤ 4 hours for the core customer-facing service. Current observed six-hour history retention does not demonstrate the RPO target. Raise a recovery-readiness incident if provider-native selectable history cannot cover the approved RPO or if the last known good point is older than the incident's maximum acceptable data loss.

## 3. Incident procedure — production remains untouched until separately authorized

1. Declare incident, record UTC start, affected services, suspected corruption window and incident commander.
2. Freeze application writes only under the incident commander's separately approved change plan. Do not improvise SQL, migration resolution or branch switching.
3. In Neon Console, select project jata-aftercall, branch production, then Backup & Restore. Record the earliest/latest selectable PITR timestamps and every available snapshot identifier, creation time and expiry. Save a timestamped screenshot/export with the incident record.
4. Select a recovery point from the incident timeline and confirm it satisfies the approved RPO. If it does not, stop and escalate; do not silently choose the nearest timestamp.
5. Prefer a multi-step restore to a new isolated branch. Never overwrite or switch production merely to test recoverability.
6. On the isolated restored branch, verify PostgreSQL connectivity; schema and Prisma migration ledger; row counts; latest settled payment, subscription and immutable ledger references; tenant ownership boundaries; and application smoke tests. Reconcile critical financial rows by immutable provider identifiers.
7. Preserve the original production branch and record the provider-generated backup branch. Record elapsed restore and validation time.
8. Obtain explicit owner approval for any production cutover. A separate operator must review the evidence and approve the change. Only then may a separately authorized runbook execute the cutover.
9. After cutover, verify canonical domain health, authenticated customer journeys, payment webhook health and financial reconciliation. Continue monitoring and retain the incident evidence.

## 4. Prohibitions

- Never restore production to test a procedure.
- Never treat a code rollback as a schema or data rollback.
- Never run prisma migrate resolve as an improvised recovery step.
- Never delete or replace a snapshot under pressure without an approved recovery decision.
- Never expose connection strings, passwords, provider credentials or customer records in evidence.
- Never claim PITR or RPO acceptance from a disposable PostgreSQL container test.

## 5. Required acceptance evidence

Production recovery remains BLOCKED until the following are recorded with exact timestamps and source references:

- Provider-native selectable PITR range and snapshot inventory.
- Isolated Neon restore rehearsal with provider run/branch identifiers.
- Integrity report for schema, migration ledger, critical financial rows and tenant isolation.
- Application smoke-test results on the restored isolated branch.
- Timed RPO/RTO result and independent evidence review.
- Confirmed recovery owner and approved incident/cutover authority.

No production restore or cutover is included in this procedure's current execution.
