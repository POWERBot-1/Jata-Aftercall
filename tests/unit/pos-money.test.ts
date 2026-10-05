/**
 * Money, stock, credit and receipts (§27, §30, §31, §32, §33, §35, §54, §57).
 *
 * Pure engine tests: no database. They pin the arithmetic a Kenyan SME depends on — whole
 * shillings, one rounding, payments validated against the configuration, stock movements that
 * always carry a reason, and the two credit ledgers that must never meet.
 */

import { describe, expect, it } from "vitest";
import { buildConfiguration, finalize } from "@/lib/pos/configuration";
import { initialAnswers, pruneAnswers } from "@/lib/pos/questionnaire";
import {
  calculateSale,
  discountFromPercent,
  isCreditMethod,
  paymentMethodOptions,
  sanitizeAmountKES,
  splitEvenly,
  validatePayments,
  validateRefund,
} from "@/lib/pos/money";
import {
  applyMovement,
  checkAvailability,
  countAdjustment,
  inventoryValueKES,
  isMovementReason,
  manualReasons,
  movementsForReturn,
  movementsForSale,
  movementsForTransfer,
  reasonNeedsNote,
  sanitizeAdjustment,
  stockAlerts,
} from "@/lib/pos/inventory";
import {
  ageingBucket,
  balanceFromEntries,
  buildStatement,
  decideCredit,
  daysOverdue,
  PAYABLE,
  RECEIVABLE,
  toCreditEntries,
  validateRepayment,
} from "@/lib/pos/credit";
import { buildReceipt, formatReceiptNumber, receiptPrefixFromBusinessName, receiptToText } from "@/lib/pos/receipt";
import { bestSellers, channelAttribution, dailyClosing, dayRange, paymentBreakdown, profitability, summarizeSales } from "@/lib/pos/reports";
import type { PosConfiguration, QuestionnaireAnswers, SaleLineInput } from "@/lib/pos/types";

function configFor(answers: QuestionnaireAnswers, name = "Test Business"): PosConfiguration {
  return finalize(buildConfiguration(pruneAnswers(answers), { businessName: name }));
}

const cashShop = configFor({
  business_type: "retail",
  sells: ["products"],
  payment_methods: ["cash", "mpesa"],
  keeps_stock: true,
  keeps_customers: false,
});

const creditShop = configFor({
  business_type: "hardware",
  sells: ["products"],
  payment_methods: ["cash", "mpesa", "credit"],
  credit_frequency: "sometimes",
  credit_limit: 10000,
  credit_terms_days: 30,
  keeps_stock: true,
  keeps_customers: true,
  has_suppliers: true,
  supplier_credit: true,
});

const taxedShop = configFor({
  business_type: "retail",
  sells: ["products"],
  payment_methods: ["cash"],
  tax: true,
  tax_rate: 16,
  discounts: true,
  split_payments: true,
  keeps_stock: false,
});

const lines = (overrides: Partial<SaleLineInput> = {}): SaleLineInput[] => [
  { name: "Flour 2kg", kind: "PRODUCT", quantity: 2, unitPriceKES: 150, ...overrides },
];

describe("money is whole shillings and rounded once (§31, §57)", () => {
  it("sanitizes anything a browser might send", () => {
    expect(sanitizeAmountKES("1,250.60")).toBe(1251);
    expect(sanitizeAmountKES(-500)).toBe(0);
    expect(sanitizeAmountKES("KES 300")).toBe(300);
    expect(sanitizeAmountKES(null)).toBe(0);
    expect(sanitizeAmountKES("not a number")).toBe(0);
    expect(Number.isInteger(sanitizeAmountKES(99.9))).toBe(true);
  });

  it("prices a sale from the lines, never from a client total", () => {
    const calculation = calculateSale({ lines: lines(), tax: cashShop.sales.tax });
    expect(calculation.totals.subtotalKES).toBe(300);
    expect(calculation.totals.totalKES).toBe(300);
    // A client-supplied total is not an input at all.
    expect(Object.keys(calculation.totals)).not.toContain("clientTotalKES");
  });

  it("applies a whole-sale discount across the lines so refunds add up (§54)", () => {
    const calculation = calculateSale({
      lines: [
        { name: "A", kind: "PRODUCT", quantity: 1, unitPriceKES: 100 },
        { name: "B", kind: "PRODUCT", quantity: 1, unitPriceKES: 300 },
      ],
      saleDiscountKES: 40,
    });
    expect(calculation.totals.discountKES).toBe(40);
    expect(calculation.totals.totalKES).toBe(360);
    const lineTotals = calculation.lines.reduce((total, line) => total + line.lineTotalKES, 0);
    expect(lineTotals).toBe(360);
  });

  it("caps a discount at the value of what was sold", () => {
    const calculation = calculateSale({ lines: lines(), saleDiscountKES: 99999 });
    expect(calculation.totals.totalKES).toBeGreaterThanOrEqual(0);
    expect(calculation.totals.discountKES).toBeLessThanOrEqual(300);
  });

  it("calculates tax from the configuration rate", () => {
    const calculation = calculateSale({ lines: lines(), tax: taxedShop.sales.tax });
    expect(taxedShop.sales.tax.enabled).toBe(true);
    expect(calculation.totals.taxKES).toBe(Math.round((300 * 16) / 100));
    expect(calculation.taxRatePercent).toBe(16);
  });

  it("converts a percentage discount into shillings", () => {
    expect(discountFromPercent(1000, 10)).toBe(100);
    expect(discountFromPercent(1000, 0)).toBe(0);
    expect(discountFromPercent(1000, 250)).toBe(1000);
    expect(discountFromPercent(999, -5)).toBe(0);
  });

  it("splits a bill evenly without losing a shilling", () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(splitEvenly(100, 2)).toEqual([50, 50]);
    // A nonsense split never loses money: the whole amount stays as one share.
    expect(splitEvenly(100, 0).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("payments are validated against the configuration (§31, §56)", () => {
  it("accepts only the methods this business takes", () => {
    const calculation = calculateSale({ lines: lines(), payments: [{ method: "cash", amountKES: 300 }] });
    expect(validatePayments(cashShop, calculation).ok).toBe(true);

    const card = calculateSale({ lines: lines(), payments: [{ method: "card", amountKES: 300 }] });
    const refused = validatePayments(cashShop, card);
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("METHOD_NOT_ALLOWED");
    expect(refused.message).toBeTruthy();
  });

  it("refuses a short payment unless partial payment or credit is configured", () => {
    const short = calculateSale({ lines: lines(), payments: [{ method: "cash", amountKES: 100 }] });
    const result = validatePayments(cashShop, short);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("SHORT_PAYMENT");
  });

  it("leaves a balance only where the configuration allows it", () => {
    const partial = configFor({
      business_type: "retail",
      sells: ["products", "services"],
      payment_methods: ["cash"],
      quotations: true,
      deposits: true,
      keeps_stock: false,
    });
    expect(partial.sales.deposits).toBe(true);
    const deposit = calculateSale({ lines: lines(), payments: [{ method: "cash", amountKES: 100 }] });
    const result = validatePayments(partial, deposit);
    expect(result.ok).toBe(true);
    expect(result.balanceKES).toBe(200);
  });

  it("never lets a browser declare credit where credit is off", () => {
    const onCredit = calculateSale({ lines: lines(), payments: [{ method: "credit", amountKES: 300 }] });
    const refused = validatePayments(cashShop, onCredit);
    expect(refused.ok).toBe(false);
    // Either the method is not one of theirs, or credit is not switched on — both are refusals.
    expect(["METHOD_NOT_ALLOWED", "CREDIT_NOT_CONFIGURED"]).toContain(refused.code);
    expect(refused.message).toBeTruthy();
    expect(isCreditMethod("credit")).toBe(true);
    expect(isCreditMethod("on account")).toBe(true);
    // A business may call it what it likes; "Deni" still behaves as credit (§30).
    expect(isCreditMethod("Deni")).toBe(true);
    expect(isCreditMethod("mpesa")).toBe(false);
    expect(isCreditMethod("cash")).toBe(false);
  });

  it("refuses an empty sale", () => {
    const empty = calculateSale({ lines: [], payments: [{ method: "cash", amountKES: 0 }] });
    expect(validatePayments(cashShop, empty).code).toBe("EMPTY_SALE");
  });

  it("offers exactly the configured methods, with reference rules", () => {
    const options = paymentMethodOptions(creditShop);
    const keys = options.map((option) => option.key);
    expect(keys).toContain("cash");
    expect(keys).toContain("mpesa");
    expect(keys).toContain("credit");
    expect(keys).not.toContain("card");
    expect(options.find((option) => option.key === "mpesa")?.needsReference).toBe(true);
    expect(options.find((option) => option.key === "cash")?.needsReference).toBe(false);
  });
});

describe("refunds never exceed what was paid (§54)", () => {
  it("refuses more than the refundable amount", () => {
    expect(validateRefund(1000, 0, 500).ok).toBe(true);
    expect(validateRefund(1000, 400, 700).ok).toBe(false);
    expect(validateRefund(1000, 1000, 10).ok).toBe(false);
    expect(validateRefund(1000, 0, 0).ok).toBe(false);
    expect(validateRefund(1000, 0, 1000).amountKES).toBe(1000);
  });
});

describe("stock only moves with a reason (§33)", () => {
  it("knows every reason and which ones need an explanation", () => {
    expect(isMovementReason("SALE")).toBe(true);
    expect(isMovementReason("BECAUSE")).toBe(false);
    expect(reasonNeedsNote("DAMAGE")).toBe(true);
    expect(reasonNeedsNote("SALE")).toBe(false);
    expect(manualReasons(creditShop).length).toBeGreaterThan(2);
  });

  it("writes a signed movement for a sale and the opposite for a return", () => {
    const sale = movementsForSale(lines({ productId: "p1" }), { saleId: "s1", branchId: null });
    expect(sale).toHaveLength(1);
    expect(sale[0].delta).toBe(-2);
    expect(sale[0].reason).toBe("SALE");
    expect(sale[0].refId).toBe("s1");

    const back = movementsForReturn(lines({ productId: "p1" }), { saleId: "s1", branchId: null });
    expect(back[0].delta).toBe(2);
    expect(back[0].reason).toBe("RETURN");
  });

  it("never moves stock for a service", () => {
    expect(movementsForSale([{ name: "Haircut", kind: "SERVICE", quantity: 1, unitPriceKES: 500 }], { saleId: "s1" })).toHaveLength(0);
  });

  it("moves stock in both directions for a transfer, so they cancel out", () => {
    const transfer = movementsForTransfer({ productId: "p1", quantity: 5, fromBranchId: "a", toBranchId: "b", transferId: "t1" });
    expect(transfer).toHaveLength(2);
    expect(transfer.reduce((total, movement) => total + movement.delta, 0)).toBe(0);
    expect(movementsForTransfer({ productId: "p1", quantity: 5, fromBranchId: "a", toBranchId: "a", transferId: "t1" })).toHaveLength(0);
  });

  it("records a count as the difference, not a new absolute number", () => {
    expect(countAdjustment(18, 20)).toBe(-2);
    expect(countAdjustment(25, 20)).toBe(5);
    expect(countAdjustment(20, 20)).toBe(0);
    expect(applyMovement(20, "COUNT", -2)).toBe(18);
  });

  it("blocks a sale that stock cannot fulfil, and never blocks a service business", () => {
    const blocked = checkAvailability(creditShop, lines({ productId: "p1" }), { p1: 1 });
    expect(blocked.ok).toBe(false);
    expect(blocked.shortages[0].requested).toBe(2);
    expect(blocked.shortages[0].available).toBe(1);

    const fine = checkAvailability(creditShop, lines({ productId: "p1" }), { p1: 10 });
    expect(fine.ok).toBe(true);

    const noStock = configFor({ business_type: "salon", sells: ["services"], payment_methods: ["cash"], keeps_stock: false });
    expect(checkAvailability(noStock, lines({ productId: "p1" }), {}).ok).toBe(true);
  });

  it("refuses a browser adjustment without an item, a reason or a quantity", () => {
    expect(sanitizeAdjustment({}).ok).toBe(false);
    expect(sanitizeAdjustment({ productId: "p1" }).ok).toBe(false);
    expect(sanitizeAdjustment({ productId: "p1", reason: "MADE_UP", quantity: 3 }).ok).toBe(false);
    expect(sanitizeAdjustment({ productId: "p1", reason: "DAMAGE", quantity: 3 }).error).toBeTruthy();
    const valid = sanitizeAdjustment({ productId: "p1", reason: "DAMAGE", quantity: 3, note: "Broken in transit" });
    expect(valid.ok).toBe(true);
    expect(valid.quantity).toBe(3);
  });

  it("flags stock that is out or low, and values the rest at cost", () => {
    const alerts = stockAlerts([
      { productId: "a", name: "Sugar", quantity: 0, reorderLevel: 5 },
      { productId: "b", name: "Salt", quantity: 2, reorderLevel: 5 },
      { productId: "c", name: "Rice", quantity: 40, reorderLevel: 5 },
    ]);
    expect(alerts.map((alert) => alert.severity)).toEqual(["out", "low"]);
    expect(inventoryValueKES([{ quantity: 3, costKES: 100 }, { quantity: 2, costKES: null }])).toBe(300);
  });
});

describe("customer credit and supplier credit stay apart (§30)", () => {
  const customer = { balanceKES: 4000, limitKES: 10000, partyType: RECEIVABLE } as const;

  it("allows credit inside the limit and refuses above it", () => {
    const allowed = decideCredit({ config: creditShop, party: customer, amountKES: 2000, roleKey: "OWNER" });
    expect(allowed.allowed).toBe(true);
    expect(allowed.newBalanceKES).toBe(6000);

    const refused = decideCredit({ config: creditShop, party: customer, amountKES: 9000, roleKey: "OWNER" });
    expect(refused.allowed).toBe(false);
    expect(refused.code).toBe("OVER_LIMIT");
    expect(refused.reason).toMatch(/limit/i);
    expect(refused.reason).not.toMatch(/limitKES|capability/i);
  });

  it("needs a customer, and refuses where credit is off", () => {
    expect(decideCredit({ config: creditShop, party: null, amountKES: 500 }).code).toBe("NO_CUSTOMER");
    expect(decideCredit({ config: cashShop, party: customer, amountKES: 500 }).code).toBe("CREDIT_DISABLED");
  });

  it("can never absorb a sale into a supplier account", () => {
    const supplier = { balanceKES: 0, limitKES: 100000, partyType: PAYABLE } as const;
    const decision = decideCredit({ config: creditShop, party: supplier, amountKES: 500 });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("WRONG_PARTY");
  });

  it("asks for a manager when staff may not approve credit (§36)", () => {
    const strict = configFor({
      business_type: "hardware",
      sells: ["products"],
      payment_methods: ["cash", "credit"],
      credit_frequency: "sometimes",
      credit_limit: 10000,
      credit_staff_approve: false,
      keeps_stock: true,
      keeps_customers: true,
    });
    const cashier = decideCredit({ config: strict, party: customer, amountKES: 500, roleKey: "CASHIER" });
    expect(cashier.allowed).toBe(true);
    expect(cashier.requiresApproval).toBe(true);
    const owner = decideCredit({ config: strict, party: customer, amountKES: 500, roleKey: "OWNER" });
    expect(owner.requiresApproval).toBe(false);
  });

  it("ages a balance against the configured terms", () => {
    const now = new Date("2026-10-01T09:00:00Z");
    expect(daysOverdue(new Date("2026-09-25T09:00:00Z"), 30, now)).toBe(0);
    expect(daysOverdue(new Date("2026-08-01T09:00:00Z"), 30, now)).toBe(31);
    expect(ageingBucket(0)).toBe("CURRENT");
    expect(ageingBucket(45)).toBe("31-60");
    expect(ageingBucket(400)).toBe("90+");
  });

  it("separates the two ledgers even when the rows are stored in one table", () => {
    const customerRows = [
      { id: "1", partyId: "c1", direction: "DEBIT", amountKES: 1000, createdAt: new Date("2026-09-01") },
      { id: "2", partyId: "c1", direction: "CREDIT", amountKES: 400, createdAt: new Date("2026-09-05") },
    ];
    const supplierRows = [
      { id: "3", partyId: "s1", direction: "DEBIT", amountKES: 5000, createdAt: new Date("2026-09-02") },
    ];
    expect(balanceFromEntries(toCreditEntries(customerRows, RECEIVABLE), RECEIVABLE)).toBe(600);
    expect(balanceFromEntries(toCreditEntries(supplierRows, PAYABLE), PAYABLE)).toBe(5000);
    // A supplier row can never be read as a receivable, and vice versa.
    expect(balanceFromEntries(toCreditEntries(supplierRows, RECEIVABLE), PAYABLE)).toBe(0);
    const statement = buildStatement(toCreditEntries(customerRows, RECEIVABLE), RECEIVABLE);
    expect(statement.lines).toHaveLength(2);
    expect(statement.closingBalanceKES).toBe(600);
    expect(statement.lines[1].balanceKES).toBe(600);
  });

  it("refuses a repayment larger than the balance", () => {
    expect(validateRepayment(1000, 400).ok).toBe(true);
    expect(validateRepayment(1000, 400).newBalanceKES).toBe(600);
    expect(validateRepayment(1000, 1500).ok).toBe(false);
    expect(validateRepayment(0, 100).ok).toBe(false);
    expect(validateRepayment(1000, 0).ok).toBe(false);
  });
});

describe("receipts are configured, not hardcoded (§32)", () => {
  const sale = {
    receiptNumber: "MW-000012",
    issuedAt: new Date("2026-10-01T10:00:00Z"),
    channel: "walk_in",
    cashierName: "Jane",
    customer: { name: "Peter", phone: "0712345678" },
    lines: [{ name: "Flour 2kg", quantity: 2, unitKey: "piece", unitPriceKES: 150, discountKES: 0, totalKES: 300 }],
    subtotalKES: 300,
    discountKES: 0,
    taxKES: 0,
    totalKES: 300,
    payments: [{ method: "mpesa", amountKES: 300, reference: "QGH7X1" }],
    balanceKES: 0,
  };

  it("numbers receipts per business in a readable form", () => {
    expect(receiptPrefixFromBusinessName("Mwangi Hardware")).toBe("MH");
    expect(receiptPrefixFromBusinessName("Nyumbani")).toBe("NYUM");
    expect(receiptPrefixFromBusinessName("Mary's Beauty Studio")).toBe("MB");
    expect(receiptPrefixFromBusinessName("")).toBe("JATA");
    expect(formatReceiptNumber("MH", 12)).toBe("MH-000012");
    expect(formatReceiptNumber("", 1)).toBe("JATA-000001");
  });

  it("renders the business's own words and payment labels", () => {
    const receipt = buildReceipt({ config: { ...creditShop, receipt: { ...creditShop.receipt, businessName: "" } }, business: { name: "Mwangi Hardware", phone: "0722000000" }, sale });
    expect(receipt.businessName).toBe("Mwangi Hardware");
    // A trading name the owner set on the receipt wins over the registered business name.
    const branded = buildReceipt({
      config: { ...creditShop, receipt: { ...creditShop.receipt, businessName: "Mwangi Hardware & Agrovets" } },
      business: { name: "Mwangi Holdings Ltd" },
      sale,
    });
    expect(branded.businessName).toBe("Mwangi Hardware & Agrovets");
    expect(receipt.receiptNumber).toBe("MW-000012");
    expect(receipt.payments[0].method).toMatch(/M-Pesa/i);
    const text = receiptToText(receipt);
    expect(text).toContain("Flour 2kg");
    expect(text).toContain("300");
    expect(text).toContain("QGH7X1");
  });

  it("hides what the configuration says to hide", () => {
    const noCashier = buildReceipt({
      config: { ...creditShop, receipt: { ...creditShop.receipt, showCashier: false, showContact: false } },
      business: { name: "Mwangi Hardware", phone: "0722000000" },
      sale,
    });
    expect(noCashier.cashier).toBeUndefined();
    expect(noCashier.contact).toEqual([]);
  });

  it("shows a credit balance only where credit exists", () => {
    const withCredit = buildReceipt({
      config: creditShop,
      business: { name: "Mwangi Hardware" },
      sale: { ...sale, balanceKES: 0, creditBalanceKES: 4500, payments: [{ method: "credit", amountKES: 300 }] },
    });
    expect(withCredit.creditBalanceKES).toBe(4500);

    const withoutCredit = buildReceipt({
      config: cashShop,
      business: { name: "Corner Shop" },
      sale: { ...sale, creditBalanceKES: 4500 },
    });
    expect(withoutCredit.creditBalanceKES).toBeUndefined();
  });
});

describe("reports separate recorded from calculated (§35)", () => {
  const sales = [
    {
      id: "1", createdAt: new Date("2026-10-01T09:00:00Z"), status: "COMPLETED", channel: "walk_in", staffName: "Jane",
      subtotalKES: 1000, discountKES: 100, taxKES: 0, totalKES: 900, paidKES: 900, balanceKES: 0, refundedKES: 0, costKES: 400,
      payments: [{ method: "cash", amountKES: 900 }],
      items: [{ name: "Flour", quantity: 4, totalKES: 900, costKES: 100 }],
    },
    {
      id: "2", createdAt: new Date("2026-10-01T14:00:00Z"), status: "VOIDED", channel: "whatsapp", staffName: "Jane",
      subtotalKES: 500, discountKES: 0, taxKES: 0, totalKES: 500, paidKES: 0, balanceKES: 500, refundedKES: 0,
      payments: [], items: [],
    },
  ];

  it("counts a voided sale as no revenue at all (§54)", () => {
    const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-01T23:59:59Z") };
    const summary = summarizeSales(sales, range);
    expect(summary.count).toBe(1);
    expect(summary.netKES).toBe(900);
    expect(summary.basis).toBe("recorded");
  });

  it("breaks payments down by method and attributes channels", () => {
    const range = dayRange(new Date("2026-10-01T12:00:00Z"));
    expect(paymentBreakdown(sales, range)).toEqual([{ method: "cash", amountKES: 900, count: 1 }]);
    const channels = channelAttribution(sales, range);
    expect(channels).toHaveLength(1);
    expect(channels[0].channel).toBe("walk_in");
  });

  it("flags profit as partial when cost data is missing", () => {
    const range = dayRange(new Date("2026-10-01T12:00:00Z"));
    const withCosts = profitability(sales, [], range);
    expect(withCosts.basis).toBe("calculated");
    expect(withCosts.partial).toBe(false);
    expect(withCosts.grossProfitKES).toBe(500);

    const withoutCosts = profitability([{ ...sales[0], costKES: undefined, items: [{ name: "Flour", quantity: 4, totalKES: 900, costKES: null }] }], [], range);
    expect(withoutCosts.partial).toBe(true);
  });

  it("lists best sellers by quantity", () => {
    const range = dayRange(new Date("2026-10-01T12:00:00Z"));
    expect(bestSellers(sales, 5, range)).toEqual([{ name: "Flour", quantity: 4, revenueKES: 900 }]);
  });

  it("closes the day with what should be in the drawer", () => {
    // The drawer figure is read from the till's payment ledger — cash in (the 900 sale) minus
    // cash out (the 200 expense) — not from the expense's category label (§57).
    const payments = [
      { id: "pay1", createdAt: new Date("2026-10-01T10:30:00Z"), direction: "IN", purpose: "SALE", method: "cash", amountKES: 900 },
      { id: "pay2", createdAt: new Date("2026-10-01T11:00:00Z"), direction: "OUT", purpose: "EXPENSE", method: "cash", amountKES: 200 },
    ];
    const closing = dailyClosing(
      sales,
      [{ id: "e1", createdAt: new Date("2026-10-01T11:00:00Z"), categoryKey: "food", amountKES: 200, method: "cash" }],
      payments,
      new Date("2026-10-01T18:00:00Z"),
    );
    expect(closing.sales.count).toBe(1);
    expect(closing.expectedCashKES).toBe(700);
    expect(closing.cashInKES).toBe(900);
    expect(closing.cashOutKES).toBe(200);
    expect(closing.basis).toBe("recorded");
  });

  it("keeps money that never touched the drawer out of the drawer figure", () => {
    // An M-Pesa sale and a bank-transfer supplier payment are in the ledger, but neither one
    // emptied or filled the till, so the drawer stays at what the cash rows say (§57).
    const payments = [
      { id: "pay1", createdAt: new Date("2026-10-01T09:00:00Z"), direction: "IN", purpose: "SALE", method: "mpesa", amountKES: 2500 },
      { id: "pay2", createdAt: new Date("2026-10-01T10:00:00Z"), direction: "IN", purpose: "SALE", method: "cash", amountKES: 300 },
      { id: "pay3", createdAt: new Date("2026-10-01T11:00:00Z"), direction: "OUT", purpose: "SUPPLIER", method: "bank_transfer", amountKES: 1000 },
      { id: "pay4", createdAt: new Date("2026-10-01T12:00:00Z"), direction: "OUT", purpose: "REFUND", method: "cash", amountKES: 50 },
    ];
    const closing = dailyClosing(sales, [], payments, new Date("2026-10-01T18:00:00Z"));
    expect(closing.expectedCashKES).toBe(250);
    expect(closing.cashInKES).toBe(300);
    expect(closing.cashOutKES).toBe(50);
  });
});

describe("the baseline POS exists for every business (§47)", () => {
  it("gives even an unconfigured business a sale, items, customers, payments, receipts, history, reports and settings", () => {
    const bare = configFor({ business_type: "other", business_other: "Something nobody has seen before" });
    expect(bare.sales.products || bare.sales.services).toBe(true);
    expect(bare.capabilities).toContain("pos_sale");
    expect(bare.capabilities).toContain("receipt");
    expect(paymentMethodOptions(bare).length).toBeGreaterThan(0);
    const navigation = bare.navigation;
    expect(navigation).toContain("dashboard");
    expect(navigation).toContain("sell");
    expect(navigation).toContain("settings");
    expect(initialAnswers("other").business_type).toBe("other");
  });
});
