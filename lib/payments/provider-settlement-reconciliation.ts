/**
 * Provider payout ↔ bank-credit reconciliation primitives.
 *
 * These functions deliberately perform evidence validation and deterministic matching only.
 * They do not import statements, create financial postings, mutate payment state or infer a bank
 * credit from a provider settlement report. Automatic matching requires an exact, unique reference,
 * currency and amount match; fuzzy candidates are surfaced as unresolved.
 */

export type ProviderSettlementEvidence = {
  provider: string;
  settlementReference: string;
  currency: string;
  grossMinor: number;
  feeMinor: number | null;
  taxMinor: number | null;
  /** Signed, provider-reported adjustments in minor units (positive adds to net). */
  adjustmentMinor: number | null;
  netMinor: number;
};

export type BankCreditEvidence = {
  statementLineId: string;
  reference: string;
  currency: string;
  creditMinor: number;
};

export type SettlementArithmeticResult =
  | { status: "VALID"; expectedNetMinor: number }
  | { status: "INCOMPLETE"; missing: string[] }
  | { status: "INVALID"; reason: "INVALID_AMOUNT" | "INVALID_CURRENCY" | "INVALID_REFERENCE" | "ARITHMETIC_MISMATCH" };

export type SettlementBankMatch =
  | { status: "MATCHED"; settlementReference: string; statementLineId: string; amountMinor: number; currency: string }
  | { status: "UNMATCHED"; reason: "INVALID_SETTLEMENT" | "NO_BANK_CREDIT" | "AMOUNT_OR_CURRENCY_MISMATCH" }
  | { status: "AMBIGUOUS"; reason: "DUPLICATE_SETTLEMENT_REFERENCE" | "DUPLICATE_BANK_REFERENCE" };

const safeMinor = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const currencyCode = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : null;

const reference = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 128
    ? value.trim()
    : null;

/** Validate a provider settlement's arithmetic without substituting missing values with zero. */
export function validateProviderSettlementEvidence(
  input: ProviderSettlementEvidence,
): SettlementArithmeticResult {
  const settlementReference = reference(input.settlementReference);
  if (typeof input.provider !== "string" || !/^[A-Z0-9_-]{2,40}$/i.test(input.provider.trim())) {
    return { status: "INVALID", reason: "INVALID_REFERENCE" };
  }
  if (!settlementReference) return { status: "INVALID", reason: "INVALID_REFERENCE" };
  if (!currencyCode(input.currency)) return { status: "INVALID", reason: "INVALID_CURRENCY" };
  if (!safeMinor(input.grossMinor) || !safeMinor(input.netMinor)) {
    return { status: "INVALID", reason: "INVALID_AMOUNT" };
  }

  const missing: string[] = [];
  if (input.feeMinor === null) missing.push("feeMinor");
  else if (!safeMinor(input.feeMinor)) return { status: "INVALID", reason: "INVALID_AMOUNT" };
  if (input.taxMinor === null) missing.push("taxMinor");
  else if (!safeMinor(input.taxMinor)) return { status: "INVALID", reason: "INVALID_AMOUNT" };
  if (input.adjustmentMinor === null) missing.push("adjustmentMinor");
  else if (typeof input.adjustmentMinor !== "number" || !Number.isSafeInteger(input.adjustmentMinor)) {
    return { status: "INVALID", reason: "INVALID_AMOUNT" };
  }
  if (missing.length) return { status: "INCOMPLETE", missing };

  const expectedNetMinor = input.grossMinor - input.feeMinor! - input.taxMinor! + input.adjustmentMinor!;
  if (!Number.isSafeInteger(expectedNetMinor) || expectedNetMinor < 0 || expectedNetMinor !== input.netMinor) {
    return { status: "INVALID", reason: "ARITHMETIC_MISMATCH" };
  }
  return { status: "VALID", expectedNetMinor };
}

/**
 * Match one provider settlement to a bank statement credit.
 * Exact reference uniqueness is mandatory; amount/currency must also match. No date/amount-only
 * or substring matching is permitted.
 */
export function matchProviderSettlementToBankCredit(
  settlement: ProviderSettlementEvidence,
  settlements: ProviderSettlementEvidence[],
  bankCredits: BankCreditEvidence[],
): SettlementBankMatch {
  const validation = validateProviderSettlementEvidence(settlement);
  if (validation.status !== "VALID") return { status: "UNMATCHED", reason: "INVALID_SETTLEMENT" };

  const key = reference(settlement.settlementReference)!;
  const sameProviderReference = settlements.filter((item) =>
    item.provider.toUpperCase() === settlement.provider.toUpperCase() &&
    reference(item.settlementReference) === key,
  );
  if (sameProviderReference.length !== 1) {
    return { status: "AMBIGUOUS", reason: "DUPLICATE_SETTLEMENT_REFERENCE" };
  }

  const candidates = bankCredits.filter((item) => reference(item.reference) === key);
  if (candidates.length > 1) return { status: "AMBIGUOUS", reason: "DUPLICATE_BANK_REFERENCE" };
  if (candidates.length === 0) return { status: "UNMATCHED", reason: "NO_BANK_CREDIT" };

  const bankCredit = candidates[0];
  if (!reference(bankCredit.statementLineId)) return { status: "UNMATCHED", reason: "NO_BANK_CREDIT" };
  if (
    currencyCode(bankCredit.currency) !== currencyCode(settlement.currency) ||
    !safeMinor(bankCredit.creditMinor) ||
    bankCredit.creditMinor !== settlement.netMinor
  ) {
    return { status: "UNMATCHED", reason: "AMOUNT_OR_CURRENCY_MISMATCH" };
  }

  return {
    status: "MATCHED",
    settlementReference: key,
    statementLineId: bankCredit.statementLineId,
    amountMinor: settlement.netMinor,
    currency: currencyCode(settlement.currency)!,
  };
}
