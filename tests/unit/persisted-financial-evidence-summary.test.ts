import { describe, expect, it } from "vitest";
import { summarizePersistedFinancialEvidence } from "@/lib/admin/persisted-financial-evidence-summary";

const base = {
  id: "snapshot-1",
  provider: "PAYSTACK",
  providerSettlementId: "1001",
  status: "success",
  currency: "KES",
  grossProcessedMinor: BigInt(10000),
  providerFeeMinor: BigInt(250),
  effectiveNetMinor: BigInt(9750),
  deductionsMinor: BigInt(0),
  sourceSnapshotHash: "hash-1",
};

describe("summarizePersistedFinancialEvidence", () => {
  it("reports evidence inventory without implying bank reconciliation", () => {
    const report = summarizePersistedFinancialEvidence([base], [{ snapshotId: base.id, paymentReference: "JATA-1", status: "success" }], []);
    expect(report).toEqual({
      snapshots: 1,
      transactionRows: 1,
      bankCreditRows: 0,
      exceptions: {
        INCOMPLETE_SETTLEMENT_FIELDS: 0,
        UNSUPPORTED_SETTLEMENT_STATUS: 0,
        DUPLICATE_SETTLEMENT_IDENTITY: 0,
        DUPLICATE_SETTLEMENT_ID_ACROSS_PROVIDERS: 0,
        TRANSACTION_EVIDENCE_MISSING: 0,
        BANK_REFERENCE_DUPLICATE: 0,
        BANK_CREDIT_WITHOUT_REFERENCE: 0,
      },
      scope: "EVIDENCE_INVENTORY_ONLY",
    });
  });

  it("flags incomplete summaries, duplicate snapshots, cross-provider ID reuse and missing transaction pages", () => {
    const duplicate = { ...base, id: "snapshot-2", sourceSnapshotHash: "hash-2" };
    const incomplete = { ...base, id: "snapshot-3", provider: "OTHER", currency: null, status: "pending", sourceSnapshotHash: "hash-3" };
    const report = summarizePersistedFinancialEvidence(
      [base, duplicate, incomplete],
      [{ snapshotId: base.id, paymentReference: null, status: "success" }],
      [{ reference: "R1", currency: "KES", creditMinor: BigInt(100) }, { reference: "R1", currency: "KES", creditMinor: BigInt(100) }, { reference: "", currency: "KES", creditMinor: BigInt(20) }],
    );
    expect(report.exceptions.DUPLICATE_SETTLEMENT_IDENTITY).toBe(1);
    expect(report.exceptions.DUPLICATE_SETTLEMENT_ID_ACROSS_PROVIDERS).toBe(1);
    expect(report.exceptions.INCOMPLETE_SETTLEMENT_FIELDS).toBe(1);
    expect(report.exceptions.UNSUPPORTED_SETTLEMENT_STATUS).toBe(1);
    expect(report.exceptions.TRANSACTION_EVIDENCE_MISSING).toBe(2);
    expect(report.exceptions.BANK_REFERENCE_DUPLICATE).toBe(1);
    expect(report.exceptions.BANK_CREDIT_WITHOUT_REFERENCE).toBe(1);
  });

  it("counts all snapshots missing transaction evidence when none exists", () => {
    const report = summarizePersistedFinancialEvidence([base], [], []);
    expect(report.exceptions.TRANSACTION_EVIDENCE_MISSING).toBe(1);
  });
});
