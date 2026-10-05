/**
 * Reporting (§35, §71)
 *
 * Reports read recorded transactions and clearly separate recorded figures from calculated
 * ones. Nothing here invents a prediction: where the data is not sufficient, the report says
 * so instead of guessing (§35, §71).
 */

import { hasCapability } from "./capabilities";
import { deriveReports, REPORT_CATALOGUE, type ReportDefinition } from "./presentation";
import type { PosConfiguration, ReportKey } from "./types";

export type SaleRecord = {
  id: string;
  receiptNumber?: string | null;
  createdAt: Date | string;
  status?: string;
  channel?: string | null;
  branchId?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  subtotalKES: number;
  discountKES: number;
  taxKES: number;
  totalKES: number;
  paidKES: number;
  balanceKES: number;
  refundedKES?: number;
  costKES?: number;
  payments?: { method: string; amountKES: number }[];
  items?: { name: string; quantity: number; totalKES: number; costKES?: number | null }[];
};

export type ExpenseRecord = { id: string; createdAt: Date | string; categoryKey: string; amountKES: number; method?: string | null; branchId?: string | null };

/** A settled row of the till's payment ledger — the only record of money in and out of the drawer. */
export type PaymentLedgerRecord = {
  id: string;
  createdAt: Date | string;
  direction: string;
  purpose: string;
  method: string;
  amountKES: number;
  branchId?: string | null;
};

export type DateRange = { from: Date; to: Date };

export function dayRange(now: Date = new Date()): DateRange {
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 86_400_000 - 1);
  return { from, to };
}

export function weekRange(now: Date = new Date()): DateRange {
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const day = (from.getDay() + 6) % 7; // Monday first
  from.setDate(from.getDate() - day);
  return { from, to: new Date(from.getTime() + 7 * 86_400_000 - 1) };
}

export function monthRange(now: Date = new Date()): DateRange {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

export function inRange(value: Date | string, range: DateRange): boolean {
  const time = new Date(value).getTime();
  return time >= range.from.getTime() && time <= range.to.getTime();
}

/** A void or cancelled sale is never revenue (§54). */
function countsAsRevenue(sale: SaleRecord): boolean {
  const status = (sale.status ?? "COMPLETED").toUpperCase();
  return status !== "VOIDED" && status !== "CANCELLED";
}

export type SalesSummary = {
  count: number;
  grossKES: number;
  discountKES: number;
  taxKES: number;
  netKES: number;
  paidKES: number;
  outstandingKES: number;
  refundedKES: number;
  averageKES: number;
  basis: "recorded";
};

export function summarizeSales(sales: SaleRecord[], range?: DateRange): SalesSummary {
  const scoped = (range ? sales.filter((sale) => inRange(sale.createdAt, range)) : sales).filter(countsAsRevenue);
  const grossKES = scoped.reduce((total, sale) => total + num(sale.subtotalKES), 0);
  const discountKES = scoped.reduce((total, sale) => total + num(sale.discountKES), 0);
  const taxKES = scoped.reduce((total, sale) => total + num(sale.taxKES), 0);
  const netKES = scoped.reduce((total, sale) => total + num(sale.totalKES), 0);
  const paidKES = scoped.reduce((total, sale) => total + num(sale.paidKES), 0);
  const outstandingKES = scoped.reduce((total, sale) => total + num(sale.balanceKES), 0);
  const refundedKES = scoped.reduce((total, sale) => total + num(sale.refundedKES), 0);
  return {
    count: scoped.length,
    grossKES,
    discountKES,
    taxKES,
    netKES,
    paidKES,
    outstandingKES,
    refundedKES,
    averageKES: scoped.length ? Math.round(netKES / scoped.length) : 0,
    basis: "recorded",
  };
}

export type MethodBreakdown = { method: string; amountKES: number; count: number }[];

export function paymentBreakdown(sales: SaleRecord[], range?: DateRange): MethodBreakdown {
  const scoped = (range ? sales.filter((sale) => inRange(sale.createdAt, range)) : sales).filter(countsAsRevenue);
  const totals = new Map<string, { amountKES: number; count: number }>();
  for (const sale of scoped) {
    const payments = sale.payments?.length ? sale.payments : [{ method: "unspecified", amountKES: num(sale.paidKES) }];
    for (const payment of payments) {
      const key = (payment.method || "unspecified").toLowerCase();
      const entry = totals.get(key) ?? { amountKES: 0, count: 0 };
      entry.amountKES += num(payment.amountKES);
      entry.count += 1;
      totals.set(key, entry);
    }
  }
  return [...totals.entries()]
    .map(([method, entry]) => ({ method, ...entry }))
    .sort((a, b) => b.amountKES - a.amountKES);
}

export type ProductPerformance = { name: string; quantity: number; revenueKES: number }[];

export function bestSellers(sales: SaleRecord[], limit = 10, range?: DateRange): ProductPerformance {
  const scoped = (range ? sales.filter((sale) => inRange(sale.createdAt, range)) : sales).filter(countsAsRevenue);
  const byName = new Map<string, { quantity: number; revenueKES: number }>();
  for (const sale of scoped) {
    for (const item of sale.items ?? []) {
      const entry = byName.get(item.name) ?? { quantity: 0, revenueKES: 0 };
      entry.quantity += num(item.quantity);
      entry.revenueKES += num(item.totalKES);
      byName.set(item.name, entry);
    }
  }
  return [...byName.entries()]
    .map(([name, entry]) => ({ name, ...entry }))
    .sort((a, b) => b.revenueKES - a.revenueKES || b.quantity - a.quantity)
    .slice(0, limit);
}

export function slowMovers(sales: SaleRecord[], stockNames: string[], range?: DateRange, limit = 10): string[] {
  const sold = new Set(bestSellers(sales, 1000, range).map((entry) => entry.name));
  return stockNames.filter((name) => !sold.has(name)).slice(0, limit);
}

export type StaffPerformance = { staffName: string; sales: number; revenueKES: number; commissionKES: number }[];

export function staffPerformance(
  sales: SaleRecord[],
  commissionPercentByStaff: Record<string, number> = {},
  range?: DateRange,
): StaffPerformance {
  const scoped = (range ? sales.filter((sale) => inRange(sale.createdAt, range)) : sales).filter(countsAsRevenue);
  const byStaff = new Map<string, { sales: number; revenueKES: number }>();
  for (const sale of scoped) {
    const name = sale.staffName ?? "Unassigned";
    const entry = byStaff.get(name) ?? { sales: 0, revenueKES: 0 };
    entry.sales += 1;
    entry.revenueKES += num(sale.totalKES);
    byStaff.set(name, entry);
  }
  return [...byStaff.entries()]
    .map(([staffName, entry]) => ({
      staffName,
      ...entry,
      commissionKES: Math.round(entry.revenueKES * (num(commissionPercentByStaff[staffName]) / 100)),
    }))
    .sort((a, b) => b.revenueKES - a.revenueKES);
}

export function channelAttribution(sales: SaleRecord[], range?: DateRange): { channel: string; count: number; revenueKES: number }[] {
  const scoped = (range ? sales.filter((sale) => inRange(sale.createdAt, range)) : sales).filter(countsAsRevenue);
  const byChannel = new Map<string, { count: number; revenueKES: number }>();
  for (const sale of scoped) {
    const channel = (sale.channel || "walk_in").toLowerCase();
    const entry = byChannel.get(channel) ?? { count: 0, revenueKES: 0 };
    entry.count += 1;
    entry.revenueKES += num(sale.totalKES);
    byChannel.set(channel, entry);
  }
  return [...byChannel.entries()].map(([channel, entry]) => ({ channel, ...entry })).sort((a, b) => b.revenueKES - a.revenueKES);
}

export function summarizeExpenses(expenses: ExpenseRecord[], range?: DateRange): { totalKES: number; byCategory: { categoryKey: string; amountKES: number }[] } {
  const scoped = range ? expenses.filter((expense) => inRange(expense.createdAt, range)) : expenses;
  const byCategory = new Map<string, number>();
  for (const expense of scoped) {
    byCategory.set(expense.categoryKey, (byCategory.get(expense.categoryKey) ?? 0) + num(expense.amountKES));
  }
  return {
    totalKES: scoped.reduce((total, expense) => total + num(expense.amountKES), 0),
    byCategory: [...byCategory.entries()].map(([categoryKey, amountKES]) => ({ categoryKey, amountKES })).sort((a, b) => b.amountKES - a.amountKES),
  };
}

export type ProfitabilitySummary = {
  netSalesKES: number;
  costOfGoodsKES: number;
  grossProfitKES: number;
  expensesKES: number;
  netProfitKES: number;
  marginPercent: number;
  basis: "calculated";
  /** True when cost data is missing, so the UI can label the figure an estimate (§35). */
  partial: boolean;
};

export function profitability(sales: SaleRecord[], expenses: ExpenseRecord[], range?: DateRange): ProfitabilitySummary {
  const summary = summarizeSales(sales, range);
  const scoped = (range ? sales.filter((sale) => inRange(sale.createdAt, range)) : sales).filter(countsAsRevenue);
  const costOfGoodsKES = scoped.reduce((total, sale) => {
    if (sale.costKES !== undefined && sale.costKES !== null) return total + num(sale.costKES);
    return total + (sale.items ?? []).reduce((line, item) => line + num(item.costKES) * num(item.quantity), 0);
  }, 0);
  const hasCostData = scoped.some((sale) => sale.costKES != null || (sale.items ?? []).some((item) => item.costKES != null));
  const expensesKES = summarizeExpenses(expenses, range).totalKES;
  const grossProfitKES = summary.netKES - costOfGoodsKES;
  const netProfitKES = grossProfitKES - expensesKES;
  return {
    netSalesKES: summary.netKES,
    costOfGoodsKES,
    grossProfitKES,
    expensesKES,
    netProfitKES,
    marginPercent: summary.netKES ? Math.round((netProfitKES / summary.netKES) * 1000) / 10 : 0,
    basis: "calculated",
    partial: !hasCostData,
  };
}

/** Daily closing (§8 finance): cash, M-Pesa, credit and expenses in one place. */
export type DailyClosing = {
  date: string;
  sales: SalesSummary;
  methods: MethodBreakdown;
  expensesKES: number;
  /** Cash the ledger says the drawer should hold: every settled cash movement, in and out. */
  expectedCashKES: number;
  cashInKES: number;
  cashOutKES: number;
  basis: "recorded";
};

/**
 * Daily closing (§8 finance, §57).
 *
 * The drawer figure is read from the till's payment ledger — the single record of money
 * physically in and out — not from a category label:
 *
 *   expected = Σ settled cash IN  (sales, deposits, credit repayments)
 *            − Σ settled cash OUT (refunds, supplier payments, expenses)
 *
 * A sale paid by M-Pesa never touches the drawer, a cash refund empties it, and an expense
 * paid by bank transfer is visible in the expense total without moving the drawer at all.
 */
export function dailyClosing(sales: SaleRecord[], expenses: ExpenseRecord[], payments: PaymentLedgerRecord[] = [], now: Date = new Date()): DailyClosing {
  const range = dayRange(now);
  const summary = summarizeSales(sales, range);
  const methods = paymentBreakdown(sales, range);
  const expensesKES = summarizeExpenses(expenses, range).totalKES;
  const cashInKES = payments
    .filter((row) => inRange(row.createdAt, range) && row.direction === "IN" && String(row.method).toLowerCase() === "cash")
    .reduce((total, row) => total + num(row.amountKES), 0);
  const cashOutKES = payments
    .filter((row) => inRange(row.createdAt, range) && row.direction === "OUT" && String(row.method).toLowerCase() === "cash")
    .reduce((total, row) => total + num(row.amountKES), 0);
  return {
    date: range.from.toISOString().slice(0, 10),
    sales: summary,
    methods,
    expensesKES,
    expectedCashKES: cashInKES - cashOutKES,
    cashInKES,
    cashOutKES,
    basis: "recorded",
  };
}

/** Series for a simple trend chart (§71 — analytical, never predictive). */
export function dailySeries(sales: SaleRecord[], days = 7, now: Date = new Date()): { date: string; netKES: number; count: number }[] {
  const series: { date: string; netKES: number; count: number }[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(now.getTime() - index * 86_400_000);
    const range = dayRange(day);
    const summary = summarizeSales(sales, range);
    series.push({ date: range.from.toISOString().slice(0, 10), netKES: summary.netKES, count: summary.count });
  }
  return series;
}

export function reportsForConfiguration(config: PosConfiguration): ReportDefinition[] {
  const enabled = new Set<ReportKey>(deriveReports(config));
  return REPORT_CATALOGUE.filter((report) => enabled.has(report.key));
}

export function canRunReport(config: PosConfiguration, key: ReportKey): boolean {
  const report = REPORT_CATALOGUE.find((entry) => entry.key === key);
  if (!report) return false;
  if (!report.capability) return true;
  return hasCapability(config, report.capability);
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
