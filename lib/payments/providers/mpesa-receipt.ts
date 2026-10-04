/**
 * Safaricom M-PESA receipt numbers are ten ASCII letters/digits. Normalizing at the boundary
 * keeps malformed callback values out of the transaction record and reversal API.
 */
export function normalizeMpesaReceipt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const receipt = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(receipt) ? receipt : null;
}
