/**
 * Order Service (§12–§15, §34) — explicit state machine with server-side validation.
 * Every transition is validated server-side; frontend state changes are never trusted (§35).
 */

export const ORDER_STATES = [
  "DRAFT",
  "PENDING_CUSTOMER_CONFIRMATION",
  "PENDING_PAYMENT",
  "PAYMENT_PROCESSING",
  "PAYMENT_VERIFIED",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export function isValidStateTransition(from: OrderState, to: OrderState): boolean {
  const validTransitions: Record<OrderState, OrderState[]> = {
    DRAFT: ["PENDING_CUSTOMER_CONFIRMATION", "CANCELLED"],
    PENDING_CUSTOMER_CONFIRMATION: ["PENDING_PAYMENT", "CANCELLED"],
    PENDING_PAYMENT: ["PAYMENT_PROCESSING", "CANCELLED", "PENDING_PAYMENT"],
    PAYMENT_PROCESSING: ["PAYMENT_VERIFIED", "CANCELLED"],
    PAYMENT_VERIFIED: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["READY", "CANCELLED"],
    READY: ["OUT_FOR_DELIVERY", "CANCELLED"],
    OUT_FOR_DELIVERY: ["COMPLETED", "CANCELLED"],
    COMPLETED: ["REFUNDED"],
    CANCELLED: ["CANCELLED"], // Terminal; no exit
    REFUNDED: ["REFUNDED"], // Terminal
  };
  return (validTransitions[from] || []).includes(to);
}

export function formatOrderReference(datePrefix: string, sequence: number): string {
  const seqStr = String(sequence).padStart(6, "0");
  return `JATA-ORD-${datePrefix}-${seqStr}`;
}
