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
| Base tables row-count + content digest | 194 | 194 | Match |
| Total rows across base tables | 1,007 | 1,007 | Match |
| View definitions | 1 | 1 | Match |
| Database object inventory | — | — | Identical |
| User rows | 13 | 13 | Match |
| Business rows | 17 | 17 | Match |
| Payment rows | 21 | 21 | Match |
| Subscription rows | 1 | 1 | Match |
| POS orders | 0 | 0 | Match |
| POS sales | 0 | 0 | Match |
| Voice calls | 0 | 0 | Match |
| Prisma migration ledger rows | 66 | 66 | Match |

A full read-only comparison was subsequently completed across all 194 base tables. For each table, the exercise compared exact row counts and a deterministic SHA-256-independent MD5 aggregate of sorted per-row MD5 hashes derived from `to_jsonb(row)::text`; all 194 table digests and counts matched, covering 1,007 rows in total. The single non-system view definition digest also matched. The hash is an integrity comparison for this restore exercise, not a cryptographic attestation signed by Neon. The comparison was performed in bounded batches of 24 tables, using read-only SQL on both branches.

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
- Full base-table row-count and content-digest parity (194 tables / 1,007 rows): PASS
- View-definition parity (1 view): PASS
- Historical PITR selection: NOT TESTED
- Scheduled backup policy: BLOCKED
- Adopted 15-minute RPO: BLOCKED
- Measured four-hour RTO: BLOCKED
- Overall ADMIN-014 recovery requirement: BLOCKED

Evidence source: live Neon provider metadata and read-only SQL observations captured 2026-11-20T17:39Z. No credentials or connection strings are included.
