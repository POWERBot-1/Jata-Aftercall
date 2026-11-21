import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    providerSettlementSnapshot: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    providerSettlementTransactionEvidence: {
      createMany: vi.fn(),
    },
    bankStatementImportBatch: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    bankStatementCreditEvidence: {
      createMany: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(),
  };
  return { tx, prisma };
});

vi.mock("@/lib/db", () => ({ default: mocks.prisma }));

import {
  importCanonicalBankStatement,
  persistPaystackSettlementSummaries,
  persistPaystackSettlementTransactions,
} from "@/lib/payments/financial-evidence-store";

const settlementPage = {
  records: [{
    provider: "PAYSTACK" as const,
    providerSettlementId: "3090024",
    status: "success" as const,
    currency: "KES",
    grossProcessedMinor: 100_000,
    providerFeeMinor: 1_500,
    effectiveNetMinor: 98_500,
    deductionsMinor: null,
    settlementDate: "2026-11-20T00:00:00.000Z",
  }],
  page: 2,
  perPage: 25,
  total: 1,
  pageCount: 1,
};

describe("financial evidence persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) =>
      callback(mocks.tx),
    );
  });

  it("stores reduced settlement summaries as idempotent evidence", async () => {
    mocks.tx.providerSettlementSnapshot.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.providerSettlementSnapshot.findMany.mockResolvedValue([{
      id: "snapshot-1",
      providerSettlementId: "3090024",
      sourceSnapshotHash: "a".repeat(64),
    }]);
    const result = await persistPaystackSettlementSummaries(
      settlementPage,
      { page: 2, perPage: 25, status: "success", from: "2026-11-01", to: "2026-11-30" },
      "owner-user-1",
    );

    expect(result).toEqual({
      received: 1,
      inserted: 1,
      snapshots: [{
        id: "snapshot-1",
        providerSettlementId: "3090024",
        sourceSnapshotHash: "a".repeat(64),
      }],
    });
    const call = mocks.tx.providerSettlementSnapshot.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0]).toMatchObject({
      provider: "PAYSTACK",
      providerSettlementId: "3090024",
      sourceEndpoint: "/settlement",
      sourcePage: 2,
      sourcePerPage: 25,
      fetchedByActorId: "owner-user-1",
      grossProcessedMinor: BigInt("100000"),
      providerFeeMinor: BigInt("1500"),
      effectiveNetMinor: BigInt("98500"),
      deductionsMinor: null,
      sourceFilter: { status: "success", from: "2026-11-01", to: "2026-11-30" },
    });
    expect(call.data[0].sourceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("attaches transaction rows only to the exact Paystack settlement snapshot", async () => {
    mocks.tx.providerSettlementSnapshot.findUnique.mockResolvedValue({
      providerSettlementId: "3090024",
      provider: "PAYSTACK",
    });
    mocks.tx.providerSettlementTransactionEvidence.createMany.mockResolvedValue({ count: 1 });
    const result = await persistPaystackSettlementTransactions("snapshot-1", "3090024", {
      records: [{
        provider: "PAYSTACK",
        providerTransactionId: "2067030515",
        reference: "jata-ref-1",
        status: "success",
        amountMinor: 10_000,
        currency: "KES",
        providerFeeMinor: 390,
        paidAt: "2026-11-20T10:00:00.000Z",
      }],
      page: 1,
      perPage: 50,
      total: 1,
      pageCount: 1,
    });

    expect(result).toEqual({ received: 1, inserted: 1 });
    const call = mocks.tx.providerSettlementTransactionEvidence.createMany.mock.calls[0][0];
    expect(call.data[0]).toMatchObject({
      snapshotId: "snapshot-1",
      providerTransactionId: "2067030515",
      paymentReference: "jata-ref-1",
      amountMinor: BigInt("10000"),
      providerFeeMinor: BigInt("390"),
      sourcePage: 1,
      sourcePerPage: 50,
    });
    expect(call.skipDuplicates).toBe(true);
  });

  it("rejects transaction rows attached to a different settlement", async () => {
    mocks.tx.providerSettlementSnapshot.findUnique.mockResolvedValue({
      providerSettlementId: "different-settlement",
      provider: "PAYSTACK",
    });
    await expect(persistPaystackSettlementTransactions("snapshot-1", "3090024", {
      records: [{
        provider: "PAYSTACK",
        providerTransactionId: "2067030515",
        reference: "jata-ref-1",
        status: "success",
        amountMinor: 10_000,
        currency: "KES",
        providerFeeMinor: 390,
        paidAt: "2026-11-20T10:00:00.000Z",
      }],
      page: 1,
      perPage: 50,
      total: 1,
      pageCount: 1,
    })).rejects.toThrow("FINANCIAL_EVIDENCE_SETTLEMENT_SNAPSHOT_MISMATCH");
    expect(mocks.tx.providerSettlementTransactionEvidence.createMany).not.toHaveBeenCalled();
  });

  it("imports canonical credits atomically with file digest and mandatory actor attribution", async () => {
    mocks.tx.bankStatementImportBatch.findUnique.mockResolvedValue(null);
    mocks.tx.bankStatementImportBatch.create.mockResolvedValue({ id: "batch-1" });
    mocks.tx.bankStatementCreditEvidence.createMany.mockResolvedValue({ count: 1 });
    const csv = "statement_line_id,booking_date,reference,currency,credit_minor\nline-1,2026-11-20,STL-001,KES,98500\n";
    const result = await importCanonicalBankStatement(csv, "finance-user-1");

    expect(result).toEqual({ importBatchId: "batch-1", rowCount: 1, inserted: true });
    expect(mocks.tx.bankStatementImportBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schemaVersion: "canonical-v1",
        importedByActorId: "finance-user-1",
        rowCount: 1,
        sourceFileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      select: { id: true },
    });
    const credits = mocks.tx.bankStatementCreditEvidence.createMany.mock.calls[0][0];
    expect(credits.data).toEqual([expect.objectContaining({
      importBatchId: "batch-1",
      statementLineId: "line-1",
      reference: "STL-001",
      currency: "KES",
      creditMinor: BigInt("98500"),
    })]);
    expect(JSON.stringify(credits, (_key, value) => typeof value === "bigint" ? value.toString() : value)).not.toContain(csv);
  });

  it("returns an existing batch without duplicating credits when the file digest repeats", async () => {
    mocks.tx.bankStatementImportBatch.findUnique.mockResolvedValue({ id: "batch-existing", rowCount: 1 });
    const csv = "statement_line_id,booking_date,reference,currency,credit_minor\nline-1,2026-11-20,STL-001,KES,98500\n";
    const result = await importCanonicalBankStatement(csv, "finance-user-1");

    expect(result).toEqual({ importBatchId: "batch-existing", rowCount: 1, inserted: false });
    expect(mocks.tx.bankStatementImportBatch.create).not.toHaveBeenCalled();
    expect(mocks.tx.bankStatementCreditEvidence.createMany).not.toHaveBeenCalled();
  });

  it("rejects control characters in importer identity before touching the database", async () => {
    await expect(importCanonicalBankStatement(
      "statement_line_id,booking_date,reference,currency,credit_minor\nline-1,2026-11-20,STL-001,KES,98500\n",
      "finance-user-1\nforged",
    )).rejects.toThrow("FINANCIAL_EVIDENCE_ACTOR_REQUIRED");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects control characters in provider payment references before persistence", async () => {
    await expect(persistPaystackSettlementTransactions("snapshot-1", "3090024", {
      records: [{
        provider: "PAYSTACK",
        providerTransactionId: "2067030515",
        reference: "jata-ref-\u0000-1",
        status: "success",
        amountMinor: 10_000,
        currency: "KES",
        providerFeeMinor: 390,
        paidAt: "2026-11-20T10:00:00.000Z",
      }],
      page: 1,
      perPage: 50,
      total: 1,
      pageCount: 1,
    })).rejects.toThrow("FINANCIAL_EVIDENCE_INVALID_PAYMENT_REFERENCE");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects missing actor identity before touching the database", async () => {
    await expect(importCanonicalBankStatement(
      "statement_line_id,booking_date,reference,currency,credit_minor\nline-1,2026-11-20,STL-001,KES,98500\n",
      "",
    )).rejects.toThrow("FINANCIAL_EVIDENCE_ACTOR_REQUIRED");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
