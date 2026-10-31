import { describe, expect, it } from "vitest";
import { reconcileCommissionSnapshots, type CommissionEntrySnapshot, type PaymentReconciliationSnapshot } from "@/lib/agents/commission-reconciliation";

// All amounts and rules are fictional test data; no owner policy is implied.
const payment: PaymentReconciliationSnapshot = { paymentId: "p1", reference: "ref1", localStatus: "PAID", localCurrency: "KES", localAmountMinor: BigInt(10000), verifiedProvider: { reference: "ref1", transactionId: "test-tx-1", status: "success", currency: "KES", amountMinor: BigInt(10000) } };
const accrual: CommissionEntrySnapshot = { id: "entry1", paymentId: "p1", agentId: "agent1", kind: "ACCRUAL", amountMinor: BigInt(1234), currency: "KES", reversesEntryId: null, sourceEventId: "source1" };
const reversal: CommissionEntrySnapshot = { id: "entry2", paymentId: "p1", agentId: "agent1", kind: "REVERSAL", amountMinor: BigInt(-1234), currency: "KES", reversesEntryId: "entry1", sourceEventId: "refund1" };
const codes = (p: PaymentReconciliationSnapshot[], e: CommissionEntrySnapshot[]) => reconcileCommissionSnapshots(p, e).map((x) => x.code);

describe("commission reconciliation diagnostics (not entitlement)", () => {
  it("compares independently supplied provider evidence without inventing eligibility", () => {
    expect(codes([payment], [accrual])).toEqual([]);
    expect(codes([{ ...payment, verifiedProvider: null }], [accrual])).toContain("PROVIDER_VERIFICATION_UNAVAILABLE");
    const provider = payment.verifiedProvider!;
    expect(codes([{ ...payment, verifiedProvider: { ...provider, reference: "wrong", amountMinor: BigInt(9999), currency: "USD", status: "failed" } }], [accrual])).toEqual(expect.arrayContaining(["PROVIDER_REFERENCE_MISMATCH", "PROVIDER_AMOUNT_MISMATCH", "PROVIDER_CURRENCY_MISMATCH", "PAYMENT_STATUS_MISMATCH"]));
  });
  it("flags duplicate payment, provider transaction, entry, source and conflicting accruals", () => {
    expect(codes([payment, payment], [accrual, accrual])).toEqual(expect.arrayContaining(["DUPLICATE_OR_INVALID_PAYMENT", "DUPLICATE_OR_INVALID_ENTRY"]));
    expect(codes([payment, { ...payment, paymentId: "p2" }], [accrual, { ...accrual, id: "entry3" }])).toEqual(expect.arrayContaining(["DUPLICATE_PROVIDER_TRANSACTION", "DUPLICATE_PAYMENT_REFERENCE", "DUPLICATE_OR_INVALID_SOURCE", "MULTIPLE_ACCRUALS_REVIEW"]));
  });
  it("checks refund reversals, ownership, linkage and exact arithmetic", () => {
    expect(codes([{ ...payment, localStatus: "REFUNDED" }], [accrual, reversal])).toEqual(expect.arrayContaining(["PROVIDER_REFUND_VERIFICATION_REQUIRED", "REVERSAL_EVIDENCE_REVIEW"]));
    expect(codes([{ ...payment, localStatus: "REFUNDED" }], [accrual])).toContain("REFUND_REVERSAL_REVIEW");
    expect(codes([payment], [accrual, { ...reversal, amountMinor: BigInt(-1235) }])).toContain("OVER_REVERSED");
    expect(codes([payment], [accrual, { ...reversal, agentId: "other" }])).toContain("REVERSAL_REFERENCE_MISMATCH");
    expect(codes([payment], [accrual, { ...reversal, reversesEntryId: "missing" }])).toContain("REVERSAL_REFERENCE_MISMATCH");
  });
  it("does not treat untrusted or malformed entries as valid ledger evidence", () => {
    expect(codes([], [accrual])).toContain("PAYMENT_NOT_FOUND");
    expect(codes([{ ...payment, localStatus: "FAILED" }], [accrual])).toContain("ACCRUAL_ON_UNPAID_PAYMENT");
    expect(codes([payment], [{ ...accrual, amountMinor: BigInt(-1) }, { ...reversal, amountMinor: BigInt(1) }])).toEqual(expect.arrayContaining(["INVALID_ACCRUAL", "INVALID_REVERSAL"]));
    const huge = BigInt("9007199254740993000000000000000000000");
    expect(codes([payment], [{ ...accrual, amountMinor: huge }, { ...reversal, amountMinor: -huge }])).not.toContain("OVER_REVERSED");
  });
});
