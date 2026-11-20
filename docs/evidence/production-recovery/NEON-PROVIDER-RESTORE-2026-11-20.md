# Neon production provider-native restore evidence — 2026-11-20

**Assessment:** Provider snapshot creation and isolated restore: PASS. Overall production recovery objective: BLOCKED pending retention/RPO/RTO and scheduled-backup policy.

## Source environment

- Neon project: `jata-aftercall` (`damp-forest-92941163`)
- PostgreSQL: 18
- Source branch: `production` (`br-cold-snow-ax606swa`), default branch
- Database: `neondb`
- Observed history retention: 21,600 seconds (6 hours)
- Snapshot schedule before this exercise: empty
- Provider snapshots before this exercise: none
- Source branch protection at time of inspection: disabled

## Provider-native exercise

1. Created manual snapshot `snap-snowy-block-ax3dald2` at 2026-11-20T17:39:09Z.
2. Restored it with `finalize=false` into isolated branch `recovery-acceptance-20261120` (`br-young-glade-axtyktor`).
3. Neon reported `restore_status=restored`, `current_state=ready`, and `restored_from=snap-snowy-block-ax3dald2`.
4. The source production branch remained the default branch. No production branch replacement or restore was performed.

## Integrity comparison

Read-only inspection of source and restored `neondb`:

| Check | Production | Restored | Result |
|---|---:|---:|---|
| Tables and views | 195 | 195 | Match |
| Database object inventory | — | — | Identical |
| User rows | 13 | 13 | Match |
| Business rows | 17 | 17 | Match |
| Payment rows | 21 | 21 | Match |
| Subscription rows | 1 | 1 | Match |
| POS orders | 0 | 0 | Match |
| POS sales | 0 | 0 | Match |
| Voice calls | 0 | 0 | Match |
| Prisma migration ledger rows | 66 | 66 | Match |

The comparison is a schema-inventory and critical-table row-count check. It is not a full row-by-row checksum of all 195 tables.

## Remaining recovery blockers

- Provider history retention is six hours; the adopted payment/subscription/ledger RPO is 15 minutes. The current setting does not prove that RPO.
- No automatic snapshot schedule was configured at inspection time.
- A point-in-time restore from a selected historical timestamp/LSN was not exercised; this test used a newly created manual snapshot.
- RTO ≤4 hours has not been measured end-to-end against a documented service restoration and application validation procedure.
- No production restore, branch swap, schema migration, or data mutation was performed.

## Release classification

- Provider-native snapshot: PASS
- Isolated provider-native restore: PASS
- Restored branch readiness: PASS
- Critical-table count parity and full table/view inventory: PASS
- Full row-level checksum parity: NOT TESTED
- Historical PITR selection: NOT TESTED
- Scheduled backup policy: BLOCKED
- Adopted 15-minute RPO: BLOCKED
- Measured four-hour RTO: BLOCKED
- Overall ADMIN-014 recovery requirement: BLOCKED

Evidence source: live Neon provider metadata and read-only SQL observations captured 2026-11-20T17:39Z. No credentials or connection strings are included.
