/**
 * Append-only persistence primitives for provider settlement and bank-credit evidence.
 *
 * Callers must complete authentication/authorization before invoking these functions. This module
 * does not call Paystack, fetch files, reconcile balances, create journals or mutate Payment rows.
 */
import { createHash } from "node:crypto";
import prisma from "@/lib/db";
import type {
  PaystackSettlementPage,
  PaystackSettlementQuery,
  PaystackSettlementRecord,
  PaystackSettlementTransaction,
} from "./providers/paystack-settlements";
import {
  parseCanonicalBankStatementCsv,
  type CanonicalBankCredit,
} from "./bank-statement-csv";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeActorId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const actorId = value.trim();
  return actorId.length >= 1 && actorId.length <= 128 && !/[\\u0000-\\u001f\\u007f]/.test(actorId)
    ? actorId
    : null;
}

function assertPageMeta(page: { page: number; perPage: number }) {
  if (!Number.isSafeInteger(page.page) || page.page < 1 || page.page > 10_000 ||
      !Number.isSafeInteger(page.perPage) || page.perPage < 1 || page.perPage > 100) {
    throw new Error("FINANCIAL_EVIDENCE_INVALID_PAGE");
  }
}

function assertMinor(value: number | null, field: string) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error("FINANCIAL_EVIDENCE_INVALID_" + field.toUpperCase());
  }
}

function assertOptionalCurrency(value: string | null) {
  if (value !== null && !/^[A-Z]{3}$/.test(value)) {
    throw new Error("FINANCIAL_EVIDENCE_INVALID_CURRENCY");
  }
}

function assertOptionalDate(value: string | null, field: string) {
  if (value !== null && (!Number.isFinite(new Date(value).getTime()))) {
    throw new Error("FINANCIAL_EVIDENCE_INVALID_" + field.toUpperCase());
  }
}

function toBigInt(value: number | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeFilters(filters: PaystackSettlementQuery) {
  const from = filters.from ?? null;
  const to = filters.to ?? null;
  if ((from && !Number.isFinite(new Date(from).getTime())) ||
      (to && !Number.isFinite(new Date(to).getTime())) ||
      (from && to && new Date(from).getTime() > new Date(to).getTime())) {
    throw new Error("FINANCIAL_EVIDENCE_INVALID_DATE_FILTER");
  }
  return {
    status: filters.status ?? null,
    from,
    to,
  };
}

export type PersistedPageResult = {
  received: number;
  inserted: number;
};

export type PersistedSettlementPageResult = PersistedPageResult & {
  snapshots: Array<{ id: string; providerSettlementId: string; sourceSnapshotHash: string }>;
};

/** Persist normalized settlement summaries only. Duplicate source snapshots are idempotently skipped. */
export async function persistPaystackSettlementSummaries(
  page: PaystackSettlementPage<PaystackSettlementRecord>,
  filters: PaystackSettlementQuery = {},
  fetchedByActorId?: string,
): Promise<PersistedSettlementPageResult> {
  const actorId = safeActorId(fetchedByActorId);
  if (fetchedByActorId !== undefined && !actorId) {
    throw new Error("FINANCIAL_EVIDENCE_INVALID_FETCH_ACTOR");
  }
  assertPageMeta(page);
  if (filters.status && !["success", "processing", "pending", "failed"].includes(filters.status)) {
    throw new Error("FINANCIAL_EVIDENCE_INVALID_STATUS");
  }
  const sourceFilter = normalizeFilters(filters);
  const data = page.records.map((record) => {
    if (record.provider !== "PAYSTACK" || !/^[0-9]{1,20}$/.test(record.providerSettlementId) ||
        !["success", "processing", "pending", "failed", "UNKNOWN"].includes(record.status)) {
      throw new Error("FINANCIAL_EVIDENCE_INVALID_SETTLEMENT");
    }
    assertOptionalCurrency(record.currency);
    assertMinor(record.grossProcessedMinor, "gross_amount");
    assertMinor(record.providerFeeMinor, "provider_fee");
    assertMinor(record.effectiveNetMinor, "net_amount");
    assertMinor(record.deductionsMinor, "deductions");
    assertOptionalDate(record.settlementDate, "settlement_date");
    const evidence = {
      provider: record.provider,
      providerSettlementId: record.providerSettlementId,
      status: record.status,
      currency: record.currency,
      grossProcessedMinor: record.grossProcessedMinor,
      providerFeeMinor: record.providerFeeMinor,
      effectiveNetMinor: record.effectiveNetMinor,
      deductionsMinor: record.deductionsMinor,
      settlementDate: record.settlementDate,
      sourceEndpoint: "/settlement",
      sourcePage: page.page,
      sourcePerPage: page.perPage,
      sourceFilter,
    };
    return {
      ...evidence,
      grossProcessedMinor: toBigInt(record.grossProcessedMinor),
      providerFeeMinor: toBigInt(record.providerFeeMinor),
      effectiveNetMinor: toBigInt(record.effectiveNetMinor),
      deductionsMinor: toBigInt(record.deductionsMinor),
      settlementDate: record.settlementDate ? new Date(record.settlementDate) : null,
      sourceFilter,
      sourceSnapshotHash: sha256(canonicalJson(evidence)),
      fetchedByActorId: actorId,
    };
  });

  if (data.length === 0) return { received: 0, inserted: 0, snapshots: [] };
  const result = await prisma.$transaction(async (tx: any) => {
    const inserted = await tx.providerSettlementSnapshot.createMany({ data, skipDuplicates: true });
    const snapshots = await tx.providerSettlementSnapshot.findMany({
      where: { sourceSnapshotHash: { in: data.map((row) => row.sourceSnapshotHash) } },
      select: { id: true, providerSettlementId: true, sourceSnapshotHash: true },
    });
    return { inserted: inserted.count, snapshots };
  });
  return { received: data.length, inserted: result.inserted, snapshots: result.snapshots };
}

/** Attach one normalized transaction page to the exact persisted settlement snapshot. */
export async function persistPaystackSettlementTransactions(
  snapshotId: string,
  settlementId: string,
  page: PaystackSettlementPage<PaystackSettlementTransaction>,
): Promise<PersistedPageResult> {
  if (!snapshotId.trim() || !/^[0-9]{1,20}$/.test(settlementId)) {
    throw new Error("FINANCIAL_EVIDENCE_INVALID_SETTLEMENT_IDENTITY");
  }
  assertPageMeta(page);

  const data = page.records.map((record) => {
    if (record.provider !== "PAYSTACK") throw new Error("FINANCIAL_EVIDENCE_INVALID_PROVIDER");
    if (!record.providerTransactionId && !record.reference) {
      throw new Error("FINANCIAL_EVIDENCE_MISSING_TRANSACTION_IDENTITY");
    }
    if (record.providerTransactionId !== null && !/^[0-9]{1,20}$/.test(record.providerTransactionId)) {
      throw new Error("FINANCIAL_EVIDENCE_INVALID_TRANSACTION_ID");
    }
    if (record.reference !== null && (record.reference.length < 1 || record.reference.length > 128 ||
        /[\\u0000-\\u001f\\u007f]/.test(record.reference))) {
      throw new Error("FINANCIAL_EVIDENCE_INVALID_PAYMENT_REFERENCE");
    }
    if (record.status !== null && (record.status.trim().length === 0 || record.status.length > 40)) {
      throw new Error("FINANCIAL_EVIDENCE_INVALID_TRANSACTION_STATUS");
    }
    assertMinor(record.amountMinor, "transaction_amount");
    assertMinor(record.providerFeeMinor, "transaction_fee");
    assertOptionalCurrency(record.currency);
    assertOptionalDate(record.paidAt, "paid_at");
    const evidence = {
      snapshotId,
      settlementId,
      providerTransactionId: record.providerTransactionId,
      paymentReference: record.reference,
      status: record.status,
      amountMinor: record.amountMinor,
      currency: record.currency,
      providerFeeMinor: record.providerFeeMinor,
      paidAt: record.paidAt,
      sourcePage: page.page,
      sourcePerPage: page.perPage,
    };
    return {
      snapshotId,
      providerTransactionId: record.providerTransactionId,
      paymentReference: record.reference,
      status: record.status,
      amountMinor: toBigInt(record.amountMinor),
      currency: record.currency,
      providerFeeMinor: toBigInt(record.providerFeeMinor),
      paidAt: record.paidAt ? new Date(record.paidAt) : null,
      sourceRowHash: sha256(canonicalJson(evidence)),
      sourcePage: page.page,
      sourcePerPage: page.perPage,
    };
  });

  if (data.length === 0) return { received: 0, inserted: 0 };
  const inserted = await prisma.$transaction(async (tx: any) => {
    const snapshot = await tx.providerSettlementSnapshot.findUnique({
      where: { id: snapshotId },
      select: { providerSettlementId: true, provider: true },
    });
    if (!snapshot || snapshot.provider !== "PAYSTACK" || snapshot.providerSettlementId !== settlementId) {
      throw new Error("FINANCIAL_EVIDENCE_SETTLEMENT_SNAPSHOT_MISMATCH");
    }
    const result = await tx.providerSettlementTransactionEvidence.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  });
  return { received: data.length, inserted };
}

export type BankStatementImportResult = {
  importBatchId: string;
  rowCount: number;
  inserted: boolean;
};

/**
 * Persist canonicalized credits and a digest of the original file, never the raw statement.
 * An operator identity is mandatory; an identical file digest is idempotently returned.
 */
export async function importCanonicalBankStatement(
  csvText: string,
  importedByActorId: string,
): Promise<BankStatementImportResult> {
  const actorId = safeActorId(importedByActorId);
  if (!actorId) throw new Error("FINANCIAL_EVIDENCE_ACTOR_REQUIRED");
  const parsed = parseCanonicalBankStatementCsv(csvText);
  const sourceFileSha256 = sha256(csvText);
  const credits = parsed.rows as CanonicalBankCredit[];

  try {
    return await prisma.$transaction(async (tx: any) => {
      const existing = await tx.bankStatementImportBatch.findUnique({
        where: { sourceFileSha256 },
        select: { id: true, rowCount: true },
      });
      if (existing) {
        if (existing.rowCount !== credits.length) {
          throw new Error("FINANCIAL_EVIDENCE_IMPORT_HASH_CONFLICT");
        }
        return { importBatchId: existing.id, rowCount: existing.rowCount, inserted: false };
      }

      const batch = await tx.bankStatementImportBatch.create({
        data: {
          sourceFileSha256,
          schemaVersion: "canonical-v1",
          importedByActorId: actorId,
          rowCount: credits.length,
        },
        select: { id: true },
      });
      await tx.bankStatementCreditEvidence.createMany({
        data: credits.map((credit) => ({
          importBatchId: batch.id,
          statementLineId: credit.statementLineId,
          bookingDate: new Date(credit.bookingDate),
          reference: credit.reference,
          currency: credit.currency,
          creditMinor: BigInt(credit.creditMinor),
        })),
      });
      return { importBatchId: batch.id, rowCount: credits.length, inserted: true };
    });
  } catch (error) {
    // A concurrent import of the same digest may win the unique-key race. Re-read only after
    // the failed transaction has rolled back; never attempt to update the existing evidence.
    if (typeof error === "object" && error !== null && "code" in error &&
        (error as { code?: unknown }).code === "P2002") {
      const existing = await prisma.bankStatementImportBatch.findUnique({
        where: { sourceFileSha256 },
        select: { id: true, rowCount: true },
      });
      if (existing && existing.rowCount === credits.length) {
        return { importBatchId: existing.id, rowCount: existing.rowCount, inserted: false };
      }
    }
    throw error;
  }
}
