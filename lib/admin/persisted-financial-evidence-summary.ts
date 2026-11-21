/**
 * Pure, read-only summary of persisted financial evidence.
 *
 * Deliberately does not match Paystack settlement IDs to bank statement references,
 * mutate evidence, or infer bank receipt. Snapshot repeats are surfaced explicitly.
 */
export type PersistedSettlementSnapshot = {
  provider: string;
  providerSettlementId: string;
  status: string;
  currency: string | null;
  grossProcessedMinor: bigint | null;
  providerFeeMinor: bigint | null;
  effectiveNetMinor: bigint | null;
  deductionsMinor: bigint | null;
  sourceSnapshotHash: string;
};
export type PersistedSettlementTransaction = { snapshotId: string; paymentReference: string | null; status: string | null };
export type PersistedBankCredit = { reference: string; currency: string; creditMinor: bigint };

export type FinancialEvidenceException =
  | "INCOMPLETE_SETTLEMENT_FIELDS"
  | "UNSUPPORTED_SETTLEMENT_STATUS"
  | "DUPLICATE_SETTLEMENT_IDENTITY"
  | "DUPLICATE_SETTLEMENT_REFERENCE"
  | "TRANSACTION_EVIDENCE_MISSING"
  | "BANK_REFERENCE_DUPLICATE"
  | "BANK_CREDIT_WITHOUT_REFERENCE";

export type FinancialEvidenceReport = {
  snapshots: number;
  transactionRows: number;
  bankCreditRows: number;
  exceptions: Record<FinancialEvidenceException, number>;
  scope: "EVIDENCE_INVENTORY_ONLY";
};

const fieldsPresent = (row: PersistedSettlementSnapshot) =>
  row.currency !== null && row.grossProcessedMinor !== null &&
  row.providerFeeMinor !== null && row.effectiveNetMinor !== null &&
  row.deductionsMinor !== null;

export function summarizePersistedFinancialEvidence(
  snapshots: PersistedSettlementSnapshot[],
  transactions: PersistedSettlementTransaction[],
  bankCredits: PersistedBankCredit[],
): FinancialEvidenceReport {
  const exceptions: FinancialEvidenceReport["exceptions"] = {
    INCOMPLETE_SETTLEMENT_FIELDS: 0,
    UNSUPPORTED_SETTLEMENT_STATUS: 0,
    DUPLICATE_SETTLEMENT_IDENTITY: 0,
    DUPLICATE_SETTLEMENT_REFERENCE: 0,
    TRANSACTION_EVIDENCE_MISSING: 0,
    BANK_REFERENCE_DUPLICATE: 0,
    BANK_CREDIT_WITHOUT_REFERENCE: 0,
  };
  const settlementCounts = new Map<string, number>();
  const snapshotIds = new Set<string>();
  for (const row of snapshots) {
    const identity = row.provider + ":" + row.providerSettlementId;
    settlementCounts.set(identity, (settlementCounts.get(identity) ?? 0) + 1);
    snapshotIds.add(row.sourceSnapshotHash);
    if (!fieldsPresent(row)) exceptions.INCOMPLETE_SETTLEMENT_FIELDS++;
    if (row.status !== "success") exceptions.UNSUPPORTED_SETTLEMENT_STATUS++;
  }
  for (const count of settlementCounts.values()) {
    if (count > 1) exceptions.DUPLICATE_SETTLEMENT_IDENTITY += count - 1;
  }
  // Different providers reusing a settlement ID/reference-like identifier is surfaced too.
  const idProviders = new Map<string, Set<string>>();
  for (const row of snapshots) {
    const providers = idProviders.get(row.providerSettlementId) ?? new Set<string>();
    providers.add(row.provider);
    idProviders.set(row.providerSettlementId, providers);
  }
  for (const providers of idProviders.values()) {
    if (providers.size > 1) exceptions.DUPLICATE_SETTLEMENT_REFERENCE++;
  }
  const transactionSnapshotIds = new Set(transactions.map((row) => row.snapshotId));
  for (const row of snapshots) {
    if (!transactionSnapshotIds.has(row.sourceSnapshotHash)) exceptions.TRANSACTION_EVIDENCE_MISSING++;
  }
  const bankReferenceCounts = new Map<string, number>();
  for (const row of bankCredits) {
    const reference = row.reference.trim();
    if (!reference) exceptions.BANK_CREDIT_WITHOUT_REFERENCE++;
    bankReferenceCounts.set(reference, (bankReferenceCounts.get(reference) ?? 0) + 1);
  }
  for (const count of bankReferenceCounts.values()) {
    if (count > 1) exceptions.BANK_REFERENCE_DUPLICATE += count - 1;
  }
  return {
    snapshots: snapshots.length,
    transactionRows: transactions.length,
    bankCreditRows: bankCredits.length,
    exceptions,
    scope: "EVIDENCE_INVENTORY_ONLY",
  };
}
