/**
 * Inventory integrity (§33, §57, test matrix N)
 *
 * Every stock change is a movement with a reason. Stock on hand is the sum of movements, so
 * nothing can be mutated without a trace, and a count can always be reconciled against the
 * ledger rather than against a mutable number someone typed.
 */

import { convertQuantity, roundQuantity } from "./units";
import type { InventoryMovementReason, PosConfiguration, SaleLineInput, UnitConversion } from "./types";

export const MOVEMENT_REASONS: { key: InventoryMovementReason; label: string; sign: 1 | -1 | 0; needsNote: boolean }[] = [
  { key: "OPENING", label: "Opening stock", sign: 1, needsNote: false },
  { key: "PURCHASE", label: "Stock bought in", sign: 1, needsNote: false },
  { key: "PURCHASE_RETURN", label: "Returned to supplier", sign: -1, needsNote: true },
  { key: "SALE", label: "Sold", sign: -1, needsNote: false },
  { key: "RETURN", label: "Customer return", sign: 1, needsNote: true },
  { key: "ADJUSTMENT", label: "Correction", sign: 0, needsNote: true },
  { key: "DAMAGE", label: "Damaged", sign: -1, needsNote: true },
  { key: "EXPIRY", label: "Expired", sign: -1, needsNote: true },
  { key: "WASTAGE", label: "Wastage", sign: -1, needsNote: true },
  { key: "COUNT", label: "Stock count", sign: 0, needsNote: true },
  { key: "TRANSFER_IN", label: "Transferred in", sign: 1, needsNote: false },
  { key: "TRANSFER_OUT", label: "Transferred out", sign: -1, needsNote: false },
  { key: "PRODUCTION_IN", label: "Production output", sign: 1, needsNote: false },
  { key: "PRODUCTION_OUT", label: "Materials used", sign: -1, needsNote: false },
];

const REASON_BY_KEY = new Map(MOVEMENT_REASONS.map((reason) => [reason.key, reason]));

export function isMovementReason(key: unknown): key is InventoryMovementReason {
  return typeof key === "string" && REASON_BY_KEY.has(key as InventoryMovementReason);
}

export function movementReasonLabel(key: string): string {
  return REASON_BY_KEY.get(key as InventoryMovementReason)?.label ?? key;
}

export function reasonNeedsNote(key: string): boolean {
  return REASON_BY_KEY.get(key as InventoryMovementReason)?.needsNote ?? true;
}

/** Reasons an owner may choose by hand; the rest are written by the system (§33). */
export function manualReasons(config: PosConfiguration): { key: InventoryMovementReason; label: string }[] {
  const allowed: InventoryMovementReason[] = ["OPENING", "ADJUSTMENT", "DAMAGE", "COUNT"];
  if (config.inventory.expiry) allowed.push("EXPIRY");
  if (config.capabilities.includes("wastage")) allowed.push("WASTAGE");
  if (config.inventory.transfers) allowed.push("TRANSFER_IN", "TRANSFER_OUT");
  if (config.sales.returns) allowed.push("RETURN");
  if (config.suppliers.enabled) allowed.push("PURCHASE", "PURCHASE_RETURN");
  if (config.inventory.manufacturing) allowed.push("PRODUCTION_IN", "PRODUCTION_OUT");
  return MOVEMENT_REASONS.filter((reason) => allowed.includes(reason.key)).map((reason) => ({ key: reason.key, label: reason.label }));
}

export type StockLine = {
  productId: string;
  name: string;
  branchId?: string | null;
  quantity: number;
  unitKey?: string;
  reorderLevel?: number;
  costKES?: number;
};

export function stockAfter(movements: { delta: number }[]): number {
  return movements.reduce((total, movement) => total + (Number.isFinite(movement.delta) ? movement.delta : 0), 0);
}

/** Signed quantity for a reason. A "COUNT" or "ADJUSTMENT" carries its own signed delta. */
export function movementDelta(reason: InventoryMovementReason, quantity: number): number {
  const definition = REASON_BY_KEY.get(reason);
  const amount = Number.isFinite(quantity) ? quantity : 0;
  if (!definition || definition.sign === 0) return Math.round(amount * 1000) / 1000;
  return Math.abs(Math.round(amount * 1000) / 1000) * definition.sign;
}

export function applyMovement(currentQuantity: number, reason: InventoryMovementReason, quantity: number, unitKey?: string): number {
  const next = currentQuantity + movementDelta(reason, quantity);
  return roundQuantity(next, unitKey ?? "piece");
}

export type AvailabilityResult = {
  ok: boolean;
  shortages: { productId: string; name: string; requested: number; available: number; unitKey?: string }[];
};

/**
 * Can this sale be fulfilled from stock? Services never block a sale, and a business that
 * does not track stock is never blocked either (§47: the POS keeps working).
 */
export function checkAvailability(
  config: PosConfiguration,
  lines: SaleLineInput[],
  stock: Record<string, number>,
): AvailabilityResult {
  if (!config.inventory.enabled || !config.capabilities.includes("stock_levels")) return { ok: true, shortages: [] };
  const shortages: AvailabilityResult["shortages"] = [];
  for (const line of lines) {
    if (line.kind === "SERVICE") continue;
    if (!line.productId) continue;
    const available = Number(stock[line.productId] ?? 0);
    const requested = Number(line.quantity ?? 0);
    if (!Number.isFinite(requested) || requested <= 0) continue;
    if (requested > available) {
      shortages.push({ productId: line.productId, name: line.name, requested, available, unitKey: line.unitKey });
    }
  }
  return { ok: shortages.length === 0, shortages };
}

/** The movements a completed sale writes (§33: Stock − quantity sold). */
export function movementsForSale(
  lines: SaleLineInput[],
  context: { saleId: string; branchId?: string | null; conversions?: UnitConversion[]; baseUnitKey?: string },
): { productId: string; delta: number; reason: InventoryMovementReason; branchId: string | null; refId: string; unitKey?: string }[] {
  const movements: ReturnType<typeof movementsForSale> = [];
  for (const line of lines) {
    if (line.kind === "SERVICE" || !line.productId) continue;
    const delta = inBaseUnits(line.quantity, line.unitKey, context.baseUnitKey, context.conversions ?? []);
    if (!delta) continue;
    movements.push({
      productId: line.productId,
      delta: -Math.abs(delta),
      reason: "SALE",
      branchId: context.branchId ?? null,
      refId: context.saleId,
      unitKey: line.unitKey,
    });
  }
  return movements;
}

/** A return puts stock back with its own reason — the sale itself is never rewritten (§54). */
export function movementsForReturn(
  lines: SaleLineInput[],
  context: { saleId: string; branchId?: string | null; conversions?: UnitConversion[]; baseUnitKey?: string },
): { productId: string; delta: number; reason: InventoryMovementReason; branchId: string | null; refId: string }[] {
  return movementsForSale(lines, context).map((movement) => ({ ...movement, delta: Math.abs(movement.delta), reason: "RETURN" as InventoryMovementReason }));
}

/** A transfer is always two movements that cancel out (§33). */
export function movementsForTransfer(params: {
  productId: string;
  quantity: number;
  fromBranchId: string;
  toBranchId: string;
  transferId: string;
  unitKey?: string;
}): { productId: string; delta: number; reason: InventoryMovementReason; branchId: string; refId: string }[] {
  const quantity = Math.abs(Number(params.quantity) || 0);
  if (!quantity || params.fromBranchId === params.toBranchId) return [];
  return [
    { productId: params.productId, delta: -quantity, reason: "TRANSFER_OUT", branchId: params.fromBranchId, refId: params.transferId },
    { productId: params.productId, delta: quantity, reason: "TRANSFER_IN", branchId: params.toBranchId, refId: params.transferId },
  ];
}

/** Stock count writes the difference, never a new absolute number (§33). */
export function countAdjustment(counted: number, systemQuantity: number): number {
  return roundQuantity((Number(counted) || 0) - (Number(systemQuantity) || 0), "piece");
}

/** Quantities are stored in the product's base unit; sold units are converted on the way in. */
export function inBaseUnits(
  quantity: number,
  soldUnitKey: string | undefined,
  baseUnitKey: string | undefined,
  conversions: UnitConversion[],
): number {
  const amount = Number(quantity) || 0;
  if (!soldUnitKey || !baseUnitKey || soldUnitKey === baseUnitKey) return roundQuantity(amount, baseUnitKey);
  const converted = convertQuantity(amount, soldUnitKey, baseUnitKey, conversions);
  return converted === null ? roundQuantity(amount, baseUnitKey) : converted;
}

export function isLowStock(line: { quantity: number; reorderLevel?: number | null }): boolean {
  const reorder = Number(line.reorderLevel ?? 0);
  if (!reorder || reorder <= 0) return false;
  return Number(line.quantity ?? 0) <= reorder;
}

export function isOutOfStock(line: { quantity: number }): boolean {
  return Number(line.quantity ?? 0) <= 0;
}

/** Stock value at cost — a calculated figure, labelled as such in reports (§35). */
export function inventoryValueKES(items: { quantity: number; costKES?: number | null }[]): number {
  return items.reduce((total, item) => total + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.costKES) || 0), 0);
}

export type StockAlert = { productId: string; name: string; quantity: number; reorderLevel: number; severity: "out" | "low" };

export function stockAlerts(items: StockLine[], limit = 20): StockAlert[] {
  if (!items?.length) return [];
  return items
    .filter((item) => isOutOfStock(item) || isLowStock(item))
    .map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      reorderLevel: Number(item.reorderLevel ?? 0),
      severity: isOutOfStock(item) ? ("out" as const) : ("low" as const),
    }))
    .sort((a, b) => (a.severity === b.severity ? a.quantity - b.quantity : a.severity === "out" ? -1 : 1))
    .slice(0, limit);
}

/** Sanitize a stock adjustment request from the browser (§56: input validation). */
/** Flat result shape (see money.ts): readable under `strictNullChecks: false`. */
export type AdjustmentInput = {
  ok: boolean;
  error?: string;
  productId: string;
  reason: InventoryMovementReason | null;
  quantity: number;
  note: string;
  branchId: string | null;
};

function adjustmentProblem(message: string): AdjustmentInput {
  return { ok: false, error: message, productId: "", reason: null, quantity: 0, note: "", branchId: null };
}

export function sanitizeAdjustment(input: Record<string, unknown>): AdjustmentInput {
  const source = input ?? {};
  const productId = typeof source.productId === "string" ? source.productId.trim().slice(0, 60) : "";
  if (!productId) return adjustmentProblem("Choose the item you are adjusting.");
  const reason = typeof source.reason === "string" ? source.reason.trim().toUpperCase() : "";
  if (!isMovementReason(reason)) return adjustmentProblem("Choose a reason for this adjustment.");
  const quantity = Math.abs(Number(source.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) return adjustmentProblem("Enter a quantity greater than zero.");
  const note = typeof source.note === "string" ? source.note.replace(/[<>]/g, "").trim().slice(0, 240) : "";
  if (reasonNeedsNote(reason) && !note) return adjustmentProblem("This adjustment needs a short reason.");
  const branchId = typeof source.branchId === "string" && source.branchId.trim() ? source.branchId.trim().slice(0, 60) : null;
  return { ok: true, productId, reason: reason as InventoryMovementReason, quantity: Math.min(quantity, 1_000_000), note, branchId };
}
