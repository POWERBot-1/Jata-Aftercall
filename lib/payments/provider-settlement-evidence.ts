export type ProviderSettlementEvidenceInput = {
  reference: string;
  providerConfirmedAt?: string | null;
};

/**
 * Fields that may be persisted only from the independently verified provider response.
 * Missing or malformed provider paid_at is deliberately represented by no timestamp;
 * local webhook receipt time is not a substitute for settlement time.
 */
export function providerSettlementEvidenceFields(input: ProviderSettlementEvidenceInput): {
  providerSettledAt?: Date;
  providerSettlementReference?: string;
} {
  const value = input.providerConfirmedAt;
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return {};
  const settledAt = new Date(value);
  if (!Number.isFinite(settledAt.getTime())) return {};
  if (!input.reference || input.reference.length > 100) return {};
  return {
    providerSettledAt: settledAt,
    providerSettlementReference: input.reference,
  };
}
