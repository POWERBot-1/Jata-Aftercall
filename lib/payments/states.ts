/**
 * The payment state machine (§31, §67, §98) — never a boolean.
 *
 *   CREATED → PAYMENT_REQUESTED → PENDING → PROCESSING → CONFIRMED → PAID
 *   failure:  FAILED · EXPIRED · CANCELLED · REVERSED
 *   partial:  PARTIALLY_PAID · PARTIALLY_REFUNDED · FULLY_REFUNDED
 *
 * Only authoritative provider confirmation may move a payment to CONFIRMED/PAID (§30). This
 * module is deliberately pure: no database, no HTTP, no clock. Every state change in the system
 * goes through `canTransition`/`assertTransition`, so an "impossible state" (a payment that was
 * failed becoming paid, a refunded payment silently paid again) is refused by the same code that
 * the tests exercise (§63 "impossible-state detection").
 */

export const PAYMENT_STATUSES = [
  "CREATED",
  "PAYMENT_REQUESTED",
  "PENDING",
  "PROCESSING",
  "CONFIRMED",
  "PAID",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REVERSED",
  "PARTIALLY_PAID",
  "PARTIALLY_REFUNDED",
  "FULLY_REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ["PAYMENT_REQUESTED", "PENDING", "CANCELLED", "FAILED", "EXPIRED"],
  PAYMENT_REQUESTED: ["PENDING", "PROCESSING", "CONFIRMED", "FAILED", "EXPIRED", "CANCELLED"],
  PENDING: ["PROCESSING", "CONFIRMED", "FAILED", "EXPIRED", "CANCELLED"],
  // A provider may report "processing" and later send the confirmation (§99).
  PROCESSING: ["PENDING", "CONFIRMED", "FAILED", "EXPIRED", "CANCELLED"],
  // CONFIRMED means "the provider said so and JATA verified it"; PAID means the sale is settled.
  CONFIRMED: ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED", "REVERSED", "FAILED"],
  PAID: ["PARTIALLY_REFUNDED", "FULLY_REFUNDED", "REVERSED"],
  PARTIALLY_PAID: ["PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED", "REVERSED"],
  PARTIALLY_REFUNDED: ["FULLY_REFUNDED", "REVERSED", "PARTIALLY_REFUNDED"],
  // A payment JATA stopped *waiting* for is not a payment the provider failed: a delayed
  // confirmation may still arrive and must still settle (§68, §97). A definitive provider
  // failure is terminal, and a late confirmation for it becomes a reconciliation exception
  // rather than a silent re-payment.
  EXPIRED: ["CONFIRMED", "PAID"],
  // Terminal states. Nothing else returns to life (§114: history is never rewritten).
  FULLY_REFUNDED: [],
  REVERSED: [],
  FAILED: [],
  CANCELLED: [],
};

export class PaymentStateError extends Error {
  from: PaymentStatus;
  to: PaymentStatus;
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`A payment cannot move from ${from} to ${to}.`);
    this.name = "PaymentStateError";
    this.from = from;
    this.to = to;
  }
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true; // idempotent no-op (a duplicate event re-asserting the same state)
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): PaymentStatus {
  if (!canTransition(from, to)) throw new PaymentStateError(from, to);
  return to;
}

export function nextStates(from: PaymentStatus): PaymentStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

/** States where the money has actually arrived — as far as JATA can prove (§30). */
const PAID_STATES: PaymentStatus[] = ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED", "REVERSED"];

export function isConfirmedStatus(status: PaymentStatus): boolean {
  return status === "CONFIRMED" || isPaidStatus(status);
}

export function isPaidStatus(status: PaymentStatus): boolean {
  return PAID_STATES.includes(status);
}

/** Still waiting: the POS shows PENDING, never PAID (§23, §68). */
export function isOpenStatus(status: PaymentStatus): boolean {
  return ["CREATED", "PAYMENT_REQUESTED", "PENDING", "PROCESSING"].includes(status);
}

export function isTerminalStatus(status: PaymentStatus): boolean {
  return ["FAILED", "EXPIRED", "CANCELLED", "REVERSED", "FULLY_REFUNDED"].includes(status);
}

/**
 * Still reconcilable against a real confirmation. EXPIRED belongs here on purpose: expiry means
 * JATA stopped *waiting*, not that the money is closed off — a late confirmation must reach
 * reconciliation rather than be discarded (§67, §68).
 */
export function canStillBeConfirmed(status: PaymentStatus): boolean {
  return isOpenStatus(status) || status === "EXPIRED" || status === "CONFIRMED";
}

export function canBeRefunded(status: PaymentStatus): boolean {
  return ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "CONFIRMED"].includes(status);
}

/** Merchant-facing words. Never "C2B confirmation callback processed" (§110). */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  CREATED: "Preparing",
  PAYMENT_REQUESTED: "Requested",
  PENDING: "Waiting for confirmation",
  PROCESSING: "Processing",
  CONFIRMED: "Confirmed",
  PAID: "Paid",
  FAILED: "Not completed",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  REVERSED: "Reversed",
  PARTIALLY_PAID: "Partially paid",
  PARTIALLY_REFUNDED: "Partially refunded",
  FULLY_REFUNDED: "Refunded",
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, "neutral" | "warn" | "success" | "danger"> = {
  CREATED: "neutral",
  PAYMENT_REQUESTED: "neutral",
  PENDING: "warn",
  PROCESSING: "warn",
  CONFIRMED: "success",
  PAID: "success",
  FAILED: "danger",
  EXPIRED: "danger",
  CANCELLED: "neutral",
  REVERSED: "danger",
  PARTIALLY_PAID: "warn",
  PARTIALLY_REFUNDED: "warn",
  FULLY_REFUNDED: "neutral",
};

export function paymentStatusLabel(status: string): string {
  return isPaymentStatus(status) ? PAYMENT_STATUS_LABELS[status] : "Unknown";
}

/**
 * The POS-side headline for a payment (§25, §85): what a cashier sees on the till right now.
 */
export function paymentHeadline(status: PaymentStatus): string {
  switch (status) {
    case "PAID":
    case "CONFIRMED":
      return "PAYMENT RECEIVED";
    case "PARTIALLY_PAID":
      return "PART OF THE PAYMENT RECEIVED";
    case "PENDING":
    case "PROCESSING":
    case "PAYMENT_REQUESTED":
    case "CREATED":
      return "PAYMENT PENDING";
    case "FAILED":
      return "PAYMENT NOT COMPLETED";
    case "EXPIRED":
      return "PAYMENT EXPIRED";
    case "CANCELLED":
      return "PAYMENT CANCELLED";
    case "REVERSED":
      return "PAYMENT REVERSED";
    case "PARTIALLY_REFUNDED":
    case "FULLY_REFUNDED":
      return "PAYMENT REFUNDED";
    default:
      return "PAYMENT";
  }
}
