/**
 * Money (§31, §54, §57)
 *
 * Kenyan shillings are handled as whole integers end to end: the client never supplies a
 * total, a tax figure or a balance, and nothing is rounded twice. A sale's arithmetic lives
 * here so the API, the preview sandbox and the tests all agree to the cent.
 */

import type { PosConfiguration, SaleLineInput, SalePaymentInput, SaleTotals } from "./types";

export const MIN_AMOUNT_KES = 0;
export const MAX_AMOUNT_KES = 100_000_000;

export function sanitizeAmountKES(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.round(parsed), MIN_AMOUNT_KES), MAX_AMOUNT_KES);
}

export function sumKES(values: number[]): number {
  return values.reduce((total, value) => total + sanitizeAmountKES(value), 0);
}

export type SaleLine = SaleLineInput & {
  lineSubtotalKES: number;
  lineDiscountKES: number;
  lineTaxKES: number;
  lineTotalKES: number;
};

export type SaleCalculationInput = {
  lines: SaleLineInput[];
  /** Whole-sale discount, applied after line discounts (§8 discounts). */
  saleDiscountKES?: number;
  tax?: { enabled: boolean; ratePercent: number; inclusive?: boolean; label?: string };
  payments?: SalePaymentInput[];
  /** Delivery or other configured fee added to the sale. */
  feeKES?: number;
};

export type NormalizedPayment = { method: string; amountKES: number; reference?: string };

export type SaleCalculation = {
  lines: SaleLine[];
  totals: SaleTotals;
  payments: NormalizedPayment[];
  taxLabel: string;
  taxRatePercent: number;
  feeKES: number;
};

/**
 * The one place a sale is priced. Line totals are rounded once, the whole-sale discount is
 * shared across lines so refunds and returns always add up to what was charged (§54).
 */
export function calculateSale(input: SaleCalculationInput): SaleCalculation {
  const tax = input.tax ?? { enabled: false, ratePercent: 0, inclusive: false };
  const rate = clampRate(tax.ratePercent);
  const rawLines: SaleLine[] = (input.lines ?? []).map((line) => {
    const quantity = sanitizeQuantityValue(line.quantity);
    const unitPrice = sanitizeAmountKES(line.unitPriceKES);
    const requestedDiscount = sanitizeAmountKES(line.discountKES);
    const lineSubtotalKES = quantity * unitPrice;
    const lineDiscountKES = Math.min(requestedDiscount, lineSubtotalKES);
    return {
      ...line,
      quantity,
      unitPriceKES: unitPrice,
      discountKES: lineDiscountKES,
      lineSubtotalKES,
      lineDiscountKES,
      lineTaxKES: 0,
      lineTotalKES: lineSubtotalKES - lineDiscountKES,
    };
  });

  const subtotalKES = sumKES(rawLines.map((line) => line.lineSubtotalKES));
  const lineDiscountKES = sumKES(rawLines.map((line) => line.lineDiscountKES));
  const saleDiscountKES = Math.min(sanitizeAmountKES(input.saleDiscountKES), Math.max(0, subtotalKES - lineDiscountKES));
  const feeKES = sanitizeAmountKES(input.feeKES);

  // Share the whole-sale discount proportionally so each line stays refundable on its own.
  const discountableBase = Math.max(0, subtotalKES - lineDiscountKES);
  const lines = rawLines.map((line) => {
    const share = discountableBase > 0 ? Math.round((line.lineTotalKES / discountableBase) * saleDiscountKES) : 0;
    const totalDiscount = Math.min(line.lineDiscountKES + share, line.lineSubtotalKES);
    const netKES = line.lineSubtotalKES - totalDiscount;
    return {
      ...line,
      lineDiscountKES: totalDiscount,
      discountKES: totalDiscount,
      lineTotalKES: netKES,
    };
  });
  // Rounding residue goes to the largest line so totals always reconcile exactly.
  const allocated = sumKES(lines.map((line) => line.lineDiscountKES));
  const residue = lineDiscountKES + saleDiscountKES - allocated;
  if (residue !== 0 && lines.length) {
    const largest = lines.reduce((best, line) => (line.lineSubtotalKES > best.lineSubtotalKES ? line : best), lines[0]);
    largest.lineDiscountKES = Math.max(0, largest.lineDiscountKES + residue);
    largest.discountKES = largest.lineDiscountKES;
    largest.lineTotalKES = largest.lineSubtotalKES - largest.lineDiscountKES;
  }

  const discountKES = sumKES(lines.map((line) => line.lineDiscountKES));
  const netGoodsKES = Math.max(0, subtotalKES - discountKES);
  const taxLabel = tax.label || "Tax";

  let taxKES = 0;
  let taxableKES = netGoodsKES;
  if (tax.enabled && rate > 0) {
    if (tax.inclusive) {
      // Prices already include tax: extract it rather than adding it on top.
      taxKES = Math.round(netGoodsKES - netGoodsKES / (1 + rate / 100));
      taxableKES = netGoodsKES - taxKES;
    } else {
      taxableKES = netGoodsKES;
      taxKES = Math.round((netGoodsKES + feeKES) * (rate / 100));
    }
  }

  const totalKES = Math.max(0, netGoodsKES + feeKES + (tax.inclusive ? 0 : taxKES));
  if (tax.enabled && rate > 0) {
    // Share tax across lines so a partial refund carries its share of tax (§54).
    let remaining = taxKES;
    lines.forEach((line, index) => {
      const isLast = index === lines.length - 1;
      const share = isLast
        ? remaining
        : totalKES > 0 ? Math.round((line.lineTotalKES / Math.max(1, netGoodsKES + feeKES)) * taxKES) : 0;
      line.lineTaxKES = Math.max(0, Math.min(share, remaining));
      remaining -= line.lineTaxKES;
    });
  }

  const payments = (input.payments ?? []).map((payment) => ({
    method: String(payment.method ?? "cash").slice(0, 40),
    amountKES: sanitizeAmountKES(payment.amountKES),
    reference: typeof payment.reference === "string" ? payment.reference.slice(0, 100) : undefined,
  }));
  const tenderedKES = sumKES(payments.filter((payment) => !isCreditMethod(payment.method)).map((payment) => payment.amountKES));
  const creditTenderedKES = sumKES(payments.filter((payment) => isCreditMethod(payment.method)).map((payment) => payment.amountKES));
  const paidKES = tenderedKES + creditTenderedKES;
  const balanceKES = Math.max(0, totalKES - paidKES);
  const changeKES = Math.max(0, tenderedKES - totalKES);

  return {
    lines,
    payments,
    taxLabel,
    taxRatePercent: rate,
    feeKES,
    totals: {
      subtotalKES,
      discountKES,
      taxableKES,
      taxKES,
      totalKES,
      paidKES,
      balanceKES,
      changeKES,
    },
  };
}

/**
 * Is this tender "pay later" rather than money now? A business may label its own credit method
 * ("Deni", "On account"), and it must still behave as credit: it leaves a balance, needs a
 * customer, and is checked against the credit limit (§30, §31).
 */
const CREDIT_WORDS = ["credit", "on credit", "on account", "account", "pay later", "later", "deni", "madeni", "tab", "mkopo"];

export function isCreditMethod(method: string): boolean {
  const value = String(method ?? "").trim().toLowerCase();
  return CREDIT_WORDS.includes(value);
}

export function clampRate(rate: unknown): number {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100);
}

function sanitizeQuantityValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.round(parsed * 1000) / 1000, 1_000_000);
}

/**
 * Flat result shape — this project compiles with `strictNullChecks` off, where a union
 * discriminated on a boolean does not narrow, so callers could not read `code`/`message`.
 */
export type PaymentValidation = {
  ok: boolean;
  balanceKES: number;
  creditKES: number;
  changeKES: number;
  code?: string;
  message?: string;
};

function paymentProblem(code: string, message: string): PaymentValidation {
  return { ok: false, code, message, balanceKES: 0, creditKES: 0, changeKES: 0 };
}

/**
 * Payment rules come from the configuration (§31). A browser can never declare a sale paid:
 * this decides what was tendered, what is still owed and whether credit may absorb it.
 *
 * `walletSettlement` marks the one deliberate exception: the JATA payment engine settling a sale
 * after the customer's wallet payment reached CONFIRMED on the provider. "wallet" is not a till
 * payment method — it is the settlement record of a provider-confirmed wallet transaction, and it
 * is accepted only when the engine passes this flag. No POS route may pass it (§30, §112).
 */
export function validatePayments(
  config: PosConfiguration,
  calculation: SaleCalculation,
  options?: { walletSettlement?: boolean },
): PaymentValidation {
  const { totals } = calculation;
  const payments = calculation.payments ?? [];
  const allowed = allowedMethods(config);
  const creditAllowed = config.payments.credit || config.credit.enabled;
  const walletSettlement = options?.walletSettlement === true;

  if (totals.totalKES <= 0) {
    return paymentProblem("EMPTY_SALE", "Add something to the sale first.");
  }

  let tendered = 0;
  let credit = 0;
  for (const payment of payments) {
    const amount = sanitizeAmountKES(payment.amountKES);
    if (amount <= 0) continue;
    const method = String(payment.method ?? "").trim().toLowerCase();
    if (walletSettlement) {
      // The settlement amount is exactly the provider-confirmed amount and it is wallet money,
      // full stop: no remapping to another method, no other method at all (§112).
      if (method !== "wallet") {
        return paymentProblem("METHOD_NOT_ALLOWED", "A confirmed wallet payment can only settle as wallet.");
      }
      tendered += amount;
      continue;
    }
    if (!allowed.has(method) && !allowed.has(String(payment.method ?? ""))) {
      return paymentProblem("METHOD_NOT_ALLOWED", `${payment.method} is not one of your payment methods.`);
    }
    if (isCreditMethod(method)) {
      if (!creditAllowed) {
        return paymentProblem("CREDIT_NOT_CONFIGURED", "Credit is not switched on for this business.");
      }
      credit += amount;
      continue;
    }
    tendered += amount;
  }

  const paid = tendered + credit;
  const balance = Math.max(0, totals.totalKES - paid);
  // Credit is a *payment method* here, not an unpaid balance: a credit sale names a customer and
  // puts the money on their account (§30). A balance may only be left where the business actually
  // configured deposits or part payments — otherwise the till would hand out goods owing money to
  // nobody, invisible to the credit ledger and to the outstanding-credit report (§31, §35).
  const canLeaveBalance = config.sales.partialPayments || config.sales.deposits;
  if (balance > 0 && !canLeaveBalance) {
    return paymentProblem(
      "SHORT_PAYMENT",
      creditAllowed
        ? `The sale is short by KES ${balance.toLocaleString("en-KE")}. Take the rest now, or put it on the customer's account.`
        : `The sale is short by KES ${balance.toLocaleString("en-KE")}.`,
    );
  }
  if (credit > 0 && balance === 0 && tendered === 0 && !creditAllowed) {
    return paymentProblem("CREDIT_NOT_CONFIGURED", "Credit is not switched on for this business.");
  }
  const change = Math.max(0, tendered - totals.totalKES);
  if (change > 0 && !config.sales.splitPayments && payments.length > 1) {
    // Splitting is allowed only when configured; otherwise a single tender must be exact or over.
    return { ok: true, balanceKES: balance, creditKES: credit, changeKES: change };
  }
  return { ok: true, balanceKES: balance, creditKES: credit, changeKES: change };
}

/** Payment methods this configuration accepts, including owner-defined labels (§31). */
export function allowedMethods(config: PosConfiguration): Set<string> {
  const methods = new Set<string>();
  if (config.payments.cash) methods.add("cash");
  if (config.payments.mpesa) methods.add("mpesa");
  if (config.payments.bank) methods.add("bank");
  if (config.payments.card) methods.add("card");
  if (config.payments.credit || config.credit.enabled) methods.add("credit");
  for (const label of config.payments.otherLabels) {
    methods.add(label.toLowerCase());
    methods.add(label);
  }
  if (config.payments.other) methods.add("other");
  return methods;
}

export type MethodOption = { key: string; label: string; needsReference: boolean };

export function paymentMethodOptions(config: PosConfiguration): MethodOption[] {
  const options: MethodOption[] = [];
  if (config.payments.cash) options.push({ key: "cash", label: "Cash", needsReference: false });
  if (config.payments.mpesa) options.push({ key: "mpesa", label: "M-Pesa", needsReference: true });
  if (config.payments.bank) options.push({ key: "bank", label: "Bank transfer", needsReference: true });
  if (config.payments.card) options.push({ key: "card", label: "Card", needsReference: true });
  if (config.payments.credit || config.credit.enabled) options.push({ key: "credit", label: "Credit (pay later)", needsReference: false });
  for (const label of config.payments.otherLabels) options.push({ key: label, label, needsReference: true });
  return options;
}

/** Even split helper for the sale screen ("split between two people"). */
export function splitEvenly(totalKES: number, ways: number): number[] {
  const count = Math.max(1, Math.min(Math.round(ways) || 1, 10));
  const base = Math.floor(totalKES / count);
  const shares = Array.from({ length: count }, () => base);
  let remainder = totalKES - base * count;
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) shares[index % count] += 1;
  return shares;
}

/** A refund may never exceed what was actually paid for the sale (§54). */
export type RefundValidation = { ok: boolean; amountKES: number; message?: string };

/** A refund never exceeds what was actually paid, and never rewrites the original sale (§54). */
export function validateRefund(paidKES: number, alreadyRefundedKES: number, requestedKES: number): RefundValidation {
  const requested = sanitizeAmountKES(requestedKES);
  const refundable = Math.max(0, sanitizeAmountKES(paidKES) - sanitizeAmountKES(alreadyRefundedKES));
  if (requested <= 0) return { ok: false, amountKES: 0, message: "Enter an amount to refund." };
  if (requested > refundable) {
    return { ok: false, amountKES: 0, message: `Only KES ${refundable.toLocaleString("en-KE")} of this sale is left to refund.` };
  }
  return { ok: true, amountKES: requested };
}

/** Percentage discount → shillings, capped at the line or sale value (§8). */
export function discountFromPercent(baseKES: number, percent: number): number {
  const rate = clampRate(percent);
  return Math.min(Math.round((sanitizeAmountKES(baseKES) * rate) / 100), sanitizeAmountKES(baseKES));
}
