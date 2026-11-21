/** Pure retry policy shared by queue workers and unit tests. */
export function paymentRecoveryRetryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("PAYMENT_RECOVERY_ATTEMPT_INVALID");
  return Math.min(30_000 * 2 ** Math.min(attempt - 1, 10), 6 * 60 * 60 * 1000);
}
