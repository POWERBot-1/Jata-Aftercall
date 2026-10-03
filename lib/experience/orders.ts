/**
 * Order stages (§28)
 *
 * Customers and owners should never see internal state-machine names. Owners work in the
 * language of their trade — NEW → ACCEPTED → READY → COMPLETED — while the platform keeps
 * one explicit state machine (lib/order.ts) and one set of valid transitions.
 *
 * Only the stages that make sense for a category are offered (§28).
 */

import { isValidStateTransition, type OrderState } from "../order";
import { getExperienceProfile } from "./categories";
import type { CategoryKey } from "./types";

export const ORDER_STAGES = ["NEW", "ACCEPTED", "PROCESSING", "READY", "COMPLETED", "CANCELLED", "REFUNDED"] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

/** Owner-facing stage → internal order state. */
export const STAGE_TO_ORDER_STATUS: Record<OrderStage, OrderState> = {
  NEW: "CONFIRMED",
  ACCEPTED: "PROCESSING",
  PROCESSING: "PROCESSING",
  READY: "READY",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
};

export const ORDER_STATUS_TO_STAGE: Record<string, OrderStage> = {
  DRAFT: "NEW",
  PENDING_CUSTOMER_CONFIRMATION: "NEW",
  PENDING_PAYMENT: "NEW",
  PAYMENT_PROCESSING: "NEW",
  PAYMENT_VERIFIED: "NEW",
  CONFIRMED: "NEW",
  PROCESSING: "ACCEPTED",
  READY: "READY",
  OUT_FOR_DELIVERY: "READY",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
};

export function stageToOrderStatus(stage: string): OrderState | null {
  return STAGE_TO_ORDER_STATUS[stage as OrderStage] || null;
}

export function orderStatusToStage(status: string): OrderStage {
  return ORDER_STATUS_TO_STAGE[status] || "NEW";
}

export function isOrderStage(value: unknown): value is OrderStage {
  return typeof value === "string" && (ORDER_STAGES as readonly string[]).includes(value);
}

/** Stages offered to this business type — a salon never sees "READY" (§28). */
export function orderStagesFor(categoryKey: CategoryKey | string | null | undefined): OrderStage[] {
  const profile = getExperienceProfile(categoryKey);
  const allowed = profile.orderStatuses.filter((status): status is OrderStage => isOrderStage(status));
  return allowed.length > 0 ? allowed : ["NEW", "ACCEPTED", "READY", "COMPLETED", "CANCELLED"];
}

export function isValidStageTransition(from: string, to: string): boolean {
  if (!isOrderStage(from) || !isOrderStage(to)) return false;
  if (from === to) return true;
  const fromStatus = STAGE_TO_ORDER_STATUS[from];
  const toStatus = STAGE_TO_ORDER_STATUS[to];
  if (fromStatus === toStatus) return true;
  return isValidStateTransition(fromStatus, toStatus);
}

const TERMINAL_STAGES = new Set<OrderStage>(["CANCELLED", "REFUNDED"]);

/** The next *progress* step for an order; cancelling is always available separately (§28). */
export function nextStageFor(categoryKey: CategoryKey | string | null | undefined, current: string): OrderStage | null {
  const stages = orderStagesFor(categoryKey);
  const index = stages.indexOf(current as OrderStage);
  if (index < 0) return stages[0] ?? null;
  const next = stages.slice(index + 1).find((stage) => !TERMINAL_STAGES.has(stage));
  return next ?? null;
}

export const STAGE_LABELS: Record<OrderStage, string> = {
  NEW: "New",
  ACCEPTED: "Accepted",
  PROCESSING: "Processing",
  READY: "Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Payment state is tracked separately from fulfilment state (§27). */
export const ORDER_PAYMENT_STATES = ["UNPAID", "PAID"] as const;
export type OrderPaymentState = (typeof ORDER_PAYMENT_STATES)[number];

export function isOrderPaymentState(value: unknown): value is OrderPaymentState {
  return typeof value === "string" && (ORDER_PAYMENT_STATES as readonly string[]).includes(value);
}

export function deriveOrderStage(order: { status?: string | null; paymentStatus?: string | null }): OrderStage {
  return orderStatusToStage(order.status || "CONFIRMED");
}

export function assertOrderStageTransition(
  currentStage: OrderStage,
  nextStageRaw: string,
): { ok: true; stage: OrderStage } | { ok: false; error: string } {
  if (!isOrderStage(nextStageRaw)) {
    return { ok: false, error: `Unknown order stage: ${nextStageRaw}` };
  }
  if (!isValidStageTransition(currentStage, nextStageRaw)) {
    return {
      ok: false,
      error: `Invalid order stage transition from ${currentStage} to ${nextStageRaw}`,
    };
  }
  return { ok: true, stage: nextStageRaw };
}

export function stageToPersistedStatus(
  stage: OrderStage,
  currentPaymentStatus?: string | null,
): { status: OrderState; paymentStatus?: string } {
  const status = stageToOrderStatus(stage) || "CONFIRMED";
  return {
    status,
    ...(currentPaymentStatus ? { paymentStatus: currentPaymentStatus } : {}),
  };
}
