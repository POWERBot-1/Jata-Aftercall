/**
 * Offline-first POS — shared types (§6).
 *
 * A till must be able to record a sale when the network is down and have it reconciled
 * later, without ever treating an unconfirmed record as money received. Every offline
 * sale carries a durable, locally-generated identifier that doubles as the idempotency
 * key the server replays it with, so a retry after a crash or a second device syncing
 * the same basket cannot ring up the sale twice.
 *
 * The record is plain data so it survives a browser restart in IndexedDB (or localStorage
 * on a device without it). Nothing here is trusted by the server: the sync endpoint
 * re-derives prices, stock and permissions from authoritative records and only uses the
 * offline payload as the *shape* of what happened at the counter.
 */

import type { SaleRequest } from "@/lib/pos/sales";

/** Lifecycle of one offline sale, mirrored on the device and (for synced ones) in the audit log. */
export type OfflineSaleStatus = "queued" | "syncing" | "synced" | "failed" | "conflict";

/**
 * Whether funds were physically received at the counter while offline.
 *
 * `cash` — the customer handed over cash; the sale may settle immediately because money
 *          was physically exchanged, exactly as it would online.
 * `pending` — the customer used a method we cannot confirm offline (M-Pesa, card, bank).
 *          The sale is recorded but MUST NOT be treated as paid: at sync time the payment
 *          lines are stripped so the sale lands as PARTIALLY_PAID with the full balance
 *          outstanding, and the manual reference is preserved for later verification.
 */
export type OfflinePaymentKind = "cash" | "pending";

/**
 * One durable offline sale.
 *
 * `idempotencyKey` is `offline:<offlineId>` — stable, bounded, and derived from the local
 * identifier so the server's existing replay guard (`PosIdempotencyRecord`) suppresses
 * duplicates across retries and devices.
 */
export type OfflineSaleRecord = {
  offlineId: string;
  idempotencyKey: string;
  request: SaleRequest;
  branchId: string | null;
  /** ISO timestamp captured on the device when the sale was recorded. */
  recordedAt: string;
  paymentKind: OfflinePaymentKind;
  /** Manual reference (e.g. an M-Pesa confirmation code typed in while offline). */
  paymentReference: string | null;
  attempts: number;
  status: OfflineSaleStatus;
  lastError: string | null;
  syncedAt: string | null;
  syncedSaleId: string | null;
  syncedReceiptNumber: string | null;
};

/** Per-record outcome returned by the sync endpoint and mirrored back to the device. */
export type OfflineSyncResult = {
  offlineId: string;
  status: "synced" | "duplicate" | "conflict" | "rejected";
  saleId?: string;
  receiptNumber?: string;
  code?: string;
  error?: string;
  /** True when the sale was recorded but left unconfirmed (non-cash offline payment). */
  unconfirmedPayment?: boolean;
};

export type OfflineSyncSummary = {
  total: number;
  synced: number;
  duplicate: number;
  conflict: number;
  rejected: number;
};
