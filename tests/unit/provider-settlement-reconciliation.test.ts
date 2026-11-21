import { describe, expect, it } from "vitest";
import { parseCanonicalBankStatementCsv } from "@/lib/payments/bank-statement-csv";
import {
  matchProviderSettlementToBankCredit,
  validateProviderSettlementEvidence,
  type BankCreditEvidence,
  type ProviderSettlementEvidence,
} from "@/lib/payments/provider-settlement-reconciliation";

const settlement: ProviderSettlementEvidence = {
  provider: "PAYSTACK",
  settlementReference: "STL-2026-001",
  currency: "KES",
  grossMinor: 100_000,
  feeMinor: 1_500,
  taxMinor: 0,
  adjustmentMinor: 0,
  netMinor: 98_500,
};

const bankCredit: BankCreditEvidence = {
  statementLineId: "statement-line-1",
  reference: "STL-2026-001",
  currency: "KES",
  creditMinor: 98_500,
};

describe("validateProviderSettlementEvidence", () => {
  it("accepts complete provider arithmetic with explicit zero fee/tax/adjustment", () => {
    expect(validateProviderSettlementEvidence(settlement)).toEqual({
      status: "VALID",
      expectedNetMinor: 98_500,
    });
  });

  it("does not treat missing fee, tax or adjustment as zero", () => {
    expect(validateProviderSettlementEvidence({
      ...settlement,
      feeMinor: null,
      taxMinor: null,
      adjustmentMinor: null,
    })).toEqual({
      status: "INCOMPLETE",
      missing: ["feeMinor", "taxMinor", "adjustmentMinor"],
    });
  });

  it("rejects arithmetic that does not reconcile to provider-reported net", () => {
    expect(validateProviderSettlementEvidence({ ...settlement, netMinor: 98_499 })).toEqual({
      status: "INVALID",
      reason: "ARITHMETIC_MISMATCH",
    });
  });

  it("rejects an invalid provider identity", () => {
    expect(validateProviderSettlementEvidence({ ...settlement, provider: " " })).toEqual({
      status: "INVALID",
      reason: "INVALID_PROVIDER",
    });
  });

  it("rejects unsafe and negative monetary values", () => {
    expect(validateProviderSettlementEvidence({ ...settlement, feeMinor: -1 })).toEqual({
      status: "INVALID",
      reason: "INVALID_AMOUNT",
    });
    expect(validateProviderSettlementEvidence({ ...settlement, grossMinor: Number.MAX_SAFE_INTEGER + 1 })).toEqual({
      status: "INVALID",
      reason: "INVALID_AMOUNT",
    });
  });
});

describe("matchProviderSettlementToBankCredit", () => {
  it("matches only a unique exact reference, currency and net amount", () => {
    expect(matchProviderSettlementToBankCredit(settlement, [settlement], [bankCredit])).toEqual({
      status: "MATCHED",
      settlementReference: "STL-2026-001",
      statementLineId: "statement-line-1",
      amountMinor: 98_500,
      currency: "KES",
    });
  });


  it("matches a canonical parsed bank statement credit against the provider settlement", () => {
    const parsed = parseCanonicalBankStatementCsv(
      "statement_line_id,booking_date,reference,currency,credit_minor\\nline-77,2026-11-21,STL-2026-001,KES,98500\\n",
    );
    expect(matchProviderSettlementToBankCredit(settlement, [settlement], parsed.rows)).toEqual({
      status: "MATCHED",
      settlementReference: "STL-2026-001",
      statementLineId: "line-77",
      amountMinor: 98_500,
      currency: "KES",
    });
  });

  it("does not match on amount alone when the reference is absent", () => {
    expect(matchProviderSettlementToBankCredit(
      settlement,
      [settlement],
      [{ ...bankCredit, reference: "OTHER-REF" }],
    )).toEqual({ status: "UNMATCHED", reason: "NO_BANK_CREDIT" });
  });

  it("flags duplicate provider settlement references as ambiguous", () => {
    expect(matchProviderSettlementToBankCredit(settlement, [settlement, settlement], [bankCredit])).toEqual({
      status: "AMBIGUOUS",
      reason: "DUPLICATE_SETTLEMENT_REFERENCE",
    });
  });

  it("flags duplicate bank references as ambiguous", () => {
    expect(matchProviderSettlementToBankCredit(settlement, [settlement], [bankCredit, bankCredit])).toEqual({
      status: "AMBIGUOUS",
      reason: "DUPLICATE_BANK_REFERENCE",
    });
  });

  it("refuses currency and amount mismatches", () => {
    expect(matchProviderSettlementToBankCredit(
      settlement,
      [settlement],
      [{ ...bankCredit, currency: "USD" }],
    )).toEqual({ status: "UNMATCHED", reason: "AMOUNT_OR_CURRENCY_MISMATCH" });
    expect(matchProviderSettlementToBankCredit(
      settlement,
      [settlement],
      [{ ...bankCredit, creditMinor: 98_499 }],
    )).toEqual({ status: "UNMATCHED", reason: "AMOUNT_OR_CURRENCY_MISMATCH" });
  });

  it("does not match incomplete provider settlement evidence", () => {
    expect(matchProviderSettlementToBankCredit(
      { ...settlement, taxMinor: null },
      [{ ...settlement, taxMinor: null }],
      [bankCredit],
    )).toEqual({ status: "UNMATCHED", reason: "INVALID_SETTLEMENT" });
  });
});
