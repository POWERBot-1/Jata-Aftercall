# Offline-First POS — Phase 2 Increment (§6)

**Branch:** `arena/faf57251-jata-aftercall` · **Base:** `main` @ `e9dd0f3` · **Date:** 2026-10-25
**Status:** implementation complete, tests passing, PR opened — **no merge, no deployment.**

## What this adds

A till can now record a sale when the network is down and have it reconciled later, without ever
treating an unconfirmed record as money received. It is built **additively** on the existing sale
engine (`createSale`), the existing replay guard (`PosIdempotencyRecord`), and the existing audit
log — no second stock source, no duplicate POS, no schema migration.

## Design

```
Browser (till)                          Server
─────────────────                       ────────────────────────────────────
submitSaleOfflineFirst()               POST /api/pos/[businessId]/sync
  ├─ online? ──POST /sales──────────►  │  handlePosRequest(CREATE_SALE)
  │   ok  → receipt (normal path)      │  for each offline record:
  │   refusal → error (no queue)       │    createSale(idempotency:
  ├─ offline / network error            │      key=offline:<id>,
  │   → enqueue (IndexedDB)            │      actorIdOverride="offline-sync")
  └─                                   │    payment safety + provenance
flushOfflineQueue()                     │    → per-record result
  ├─ POST /sync { records } ──────────►│
  └─ update local queue to match ◄────── results[] + summary
```

### Key decisions

1. **Reuse `createSale`.** Offline sales replay through the exact same code path as online
   checkout, so prices, tax, discounts, credit, stock, receipts and audit are identical. The server
   re-derives everything from authoritative records; the offline payload is only the *shape* of what
   happened at the counter.
2. **Cross-actor idempotency.** The existing replay guard is scoped to `(businessId, actorId, …)`.
   An offline basket can be replayed by a *different* cashier after a shift handover, so the claim
   and its `saleId` completion now accept an `actorIdOverride` (`"offline-sync"`) — a stable,
   non-user identifier. The sale and its audit trail are still attributed to the real syncing actor.
   Additive change to `createSale`; the online path (no override) is unchanged.
3. **Payment safety.** An offline sale records `paymentKind`: `cash` (handed over at the counter →
   may settle) or `pending` (M-Pesa/card/bank captured offline → **unconfirmed**). On sync, pending
   payment lines are stripped, so the sale lands `PARTIALLY_PAID` with the full balance outstanding;
   the manual reference survives in the sale notes and the audit metadata. A cash sale settles to
   `COMPLETED` exactly as it would online.
4. **Provenance.** Every replayed sale gets an `[offline offlineId=… recordedAt=… payment=… ref=…]`
   marker in its notes and a `POS_OFFLINE_SYNC` audit event with the original recording time and
   payment kind.
5. **Durability.** The queue is written to IndexedDB (localStorage fallback, memory for tests),
   survives a browser restart, is bounded (`pruneTo`), and never silently resets on corruption.

## Files

| File | Purpose |
|---|---|
| `lib/pos/offline/types.ts` | `OfflineSaleRecord`, results, summary |
| `lib/pos/offline/queueStore.ts` | durable queue: IndexedDB/localStorage/memory backends, enqueue/list/update/prune |
| `lib/pos/offline/syncClient.ts` | `submitSaleOfflineFirst`, `flushOfflineQueue`, `fetchSyncedOfflineIds` |
| `lib/pos/offline/useOfflineSync.ts` | React hook: queue state, auto-sync on reconnect, recovery actions |
| `lib/pos/offline/index.ts` | public surface |
| `app/api/pos/[businessId]/sync/route.ts` | `POST` batch replay + `GET` reconcile status |
| `components/pos/OfflineSyncPanel.tsx` | sync status + recovery UI |
| `components/pos/TillClient.tsx` | offline fallback in `complete()` + offline confirmation view |
| `app/dashboard/pos/[businessId]/sell/page.tsx` | renders the sync panel |
| `lib/pos/sales.ts` | additive `idempotency.actorIdOverride` + `duplicateOfSaleId`/`duplicateRequestHashMatches` on `SaleOutcome` |

## API

- `POST /api/pos/[businessId]/sync` — body `{ records: OfflineSaleRecord[] }` (≤100). Returns
  `{ results: OfflineSyncResult[], summary }`. Requires `CREATE_SALE` + live subscription.
- `GET /api/pos/[businessId]/sync` — returns `{ syncedOfflineIds: string[] }` for cross-device
  reconciliation. Requires `VIEW_SALES`.

## Schema / migrations

**None.** Provenance is encoded in sale notes + the existing audit log; the `PosIdempotencyRecord`
table already exists. A dedicated `PosSale.offlineRecorded` column is a recommended follow-up
(deferred) if a first-class queryable marker is needed.

## Environment variables

**None.** No new secrets or providers. The offline path uses the existing cookie session.

## Tests (all passing)

- `tests/unit/pos-offline-queue.test.ts` (10) — durable queue, dedup, prune, recovery.
- `tests/unit/pos-offline-sync-client.test.ts` (8) — online/offline/network-failure, flush state.
- `tests/integration/pos-offline-sync.test.ts` (9) — cash sync + stock, duplicate replay (same &
  cross-actor), unconfirmed payment → `PARTIALLY_PAID`, tenant isolation, auth, status.

Regression: `pos-api-routes`, `pos-journey`, `pos-sale-idempotency`, `pos-permissions`,
`pos-tenant-isolation`, `pos-anonymous-access` all pass (166 tests). Typecheck clean for all
changed files (the 4 remaining repo-wide type errors are pre-existing, caused by the Prisma client
not being generated in this offline sandbox — they resolve in CI where `prisma generate` runs).

## Acceptance coverage (§20, offline)

| Test | Evidence |
|---|---|
| Sell with internet disconnected | `submitSaleOfflineFirst` offline path + queue unit tests |
| Restart while unsynced | durable IndexedDB queue; `listOfflineSales` after fresh backend |
| Restore connectivity and sync | `flushOfflineQueue` + integration sync test |
| Retry without duplicates | duplicate replay test (same + cross-actor) |
| Unconfirmed payment ≠ paid | `PARTIALLY_PAID` integration test |
| Clear synced/failed/unsynced indicators | `OfflineSyncPanel` + sync-client status tests |

## Known limitations / follow-ups (not done this branch)

- No service worker / true PWA offline shell (manifest already exists); the queue is app-level.
- No full conflict-resolution UI for stale price/stock (per-record rejection is implemented; the
  recovery panel lists failures for manual retry).
- No device revocation / local-cache encryption; queue is plain IndexedDB on the device.
- Multi-terminal concurrent sync of the *same* offline record across devices is not possible by
  design (each device owns its queue); the cross-actor replay guard covers shift handover.
- Offline sales are attributed to the syncing actor (recorded in audit metadata as the original
  recording time); a per-sale `recordedBy` column is a possible follow-up.

## Non-actions (§1)

No merge, no deployment, no production migration, no live config change, no webhook change, no
GitHub credentials touched.
