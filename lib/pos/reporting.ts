/**
 * Running the reports (§35, §71)
 *
 * Reports read recorded transactions from this tenant only, and they say what kind of number
 * they are showing: `recorded` (a fact from the ledger), `calculated` (derived from facts) or
 * `estimate` (an input is missing, so the figure is labelled and flagged `partial`). Where the
 * data does not exist yet — a harvest log this release does not keep, for example — the report
 * says so instead of inventing a number (§35, §71: analytical, never predictive).
 */

import { formatKES } from "@/lib/format";
import { hasCapability } from "./capabilities";
import { ageingBucket, daysOverdue } from "./credit";
import { inventoryValueKES, stockAlerts } from "./inventory";
import { reportDefinitions, type ReportDefinition } from "./presentation";
import {
  bestSellers,
  channelAttribution,
  dailyClosing,
  dailySeries,
  dayRange,
  monthRange,
  paymentBreakdown,
  profitability,
  slowMovers,
  staffPerformance,
  summarizeExpenses,
  summarizeSales,
  weekRange,
  type DateRange,
  type ExpenseRecord,
  type PaymentLedgerRecord,
  type SaleRecord,
} from "./reports";
import * as store from "./store";
import { resolveTerminology } from "./terminology";
import { isTerminal, stateLabel } from "./workflow";
import type { PosConfiguration, ReportKey } from "./types";

export type ReportRow = Record<string, string | number | null>;

export type ReportPayload = {
  key: ReportKey;
  label: string;
  blurb: string;
  basis: ReportDefinition["basis"];
  /** False when this business has no data source for the report — never a made-up number. */
  available: boolean;
  /** True when some inputs were missing, so a calculated figure is an estimate (§35). */
  partial: boolean;
  notice: string | null;
  range: { from: string; to: string };
  summary: { label: string; value: string }[];
  rows: ReportRow[];
  series: { label: string; value: number }[];
};

function toSaleRecords(rows: any[]): SaleRecord[] {
  return rows.map((row) => ({
    id: row.id,
    receiptNumber: row.receiptNumber,
    createdAt: row.createdAt,
    status: row.status,
    channel: row.channel,
    branchId: row.branchId,
    staffId: row.staffId,
    staffName: row.staffName,
    customerId: row.customerId,
    customerName: row.customerName,
    subtotalKES: Number(row.subtotalKES ?? 0),
    discountKES: Number(row.discountKES ?? 0),
    taxKES: Number(row.taxKES ?? 0),
    totalKES: Number(row.totalKES ?? 0),
    paidKES: Number(row.paidKES ?? 0),
    balanceKES: Number(row.balanceKES ?? 0),
    refundedKES: Number(row.refundedKES ?? 0),
    costKES: row.costKES == null ? undefined : Number(row.costKES),
    payments: (row.payments ?? [])
      .filter((payment: any) => payment.direction !== "OUT")
      .map((payment: any) => ({ method: payment.method, amountKES: Number(payment.amountKES ?? 0) })),
    items: (row.items ?? []).map((item: any) => ({
      name: item.name,
      quantity: Number(item.quantity ?? 0),
      totalKES: Number(item.totalKES ?? 0),
      costKES: item.costKES == null ? null : Number(item.costKES),
    })),
  }));
}

function toExpenseRecords(rows: any[]): ExpenseRecord[] {
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.occurredAt ?? row.createdAt,
    categoryKey: row.categoryKey,
    amountKES: Number(row.amountKES ?? 0),
    method: row.method ?? null,
    branchId: row.branchId,
  }));
}

function toPaymentLedgerRecords(rows: any[]): PaymentLedgerRecord[] {
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    direction: String(row.direction ?? "IN"),
    purpose: String(row.purpose ?? "SALE"),
    method: String(row.method ?? "cash"),
    amountKES: Number(row.amountKES ?? 0),
    branchId: row.branchId ?? null,
  }));
}

function payload(definition: ReportDefinition, range: DateRange, extra: Partial<ReportPayload> = {}): ReportPayload {
  return {
    key: definition.key,
    label: definition.label,
    blurb: definition.blurb,
    basis: definition.basis,
    available: true,
    partial: false,
    notice: null,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    summary: [],
    rows: [],
    series: [],
    ...extra,
  };
}

function unavailable(definition: ReportDefinition, range: DateRange, notice: string): ReportPayload {
  return payload(definition, range, { available: false, partial: true, notice, basis: definition.basis });
}

/** Which range a report covers when the owner did not choose one. */
export function defaultRangeFor(key: ReportKey, now: Date = new Date()): DateRange {
  if (key === "daily_sales" || key === "refunds") return dayRange(now);
  if (key === "weekly_sales") return weekRange(now);
  if (key === "monthly_sales") return monthRange(now);
  return dayRange(now);
}

/**
 * Runs one report for one business. `businessId` is resolved by the caller from the session and
 * the URL, so this function cannot be pointed at another tenant (§5, §75).
 */
export async function runReport(
  businessId: string,
  config: PosConfiguration,
  key: ReportKey,
  range: DateRange = defaultRangeFor(key),
  options: { branchId?: string | null } = {},
): Promise<ReportPayload> {
  // Staff bound to a location only read that location's figures (§16, §75); an unbound actor
  // (owner, admin) reads the whole business.
  const branchId = options.branchId ?? null;
  const definitions = reportDefinitions(config);
  const definition = definitions.find((entry) => entry.key === key);
  if (!definition) {
    // A report this business is not configured for is refused rather than answered with zeros.
    return unavailable(
      { key, label: key, blurb: "", group: "Sales", capability: null, basis: "recorded" },
      range,
      "That report is not part of how your POS is set up.",
    );
  }
  const terminology = resolveTerminology(config);

  switch (key) {
    case "daily_sales":
    case "weekly_sales":
    case "monthly_sales":
    case "gross_sales":
    case "net_sales": {
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const summary = summarizeSales(sales, range);
      const series = dailySeries(sales, 7, range.to);
      return payload(definition, range, {
        summary: [
          { label: terminology.sales, value: String(summary.count) },
          { label: "Gross", value: formatKES(summary.grossKES) },
          { label: "Discounts", value: formatKES(summary.discountKES) },
          { label: "Net", value: formatKES(summary.netKES) },
          { label: "Collected", value: formatKES(summary.paidKES) },
          { label: "Still owed", value: formatKES(summary.outstandingKES) },
          { label: "Average sale", value: formatKES(summary.averageKES) },
        ],
        rows: sales
          .filter((sale) => sale.status !== "VOIDED")
          .slice(-200)
          .reverse()
          .map((sale) => ({
            receipt: sale.receiptNumber ?? "",
            when: new Date(sale.createdAt).toLocaleString("en-KE"),
            customer: sale.customerName ?? "—",
            staff: sale.staffName ?? "—",
            total: formatKES(sale.totalKES),
            balance: sale.balanceKES > 0 ? formatKES(sale.balanceKES) : "—",
          })),
        series: series.map((point) => ({ label: point.date, value: point.netKES })),
        notice: summary.count === 0 ? `No ${terminology.sales.toLowerCase()} recorded in this period yet.` : null,
      });
    }

    case "refunds": {
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const refunded = sales.filter((sale) => Number(sale.refundedKES ?? 0) > 0 || sale.status === "VOIDED");
      const totalKES = refunded.reduce((sum, sale) => sum + Number(sale.refundedKES ?? 0), 0);
      return payload(definition, range, {
        summary: [
          { label: "Refunded sales", value: String(refunded.length) },
          { label: "Money returned", value: formatKES(totalKES) },
        ],
        rows: refunded.map((sale) => ({
          receipt: sale.receiptNumber ?? "",
          when: new Date(sale.createdAt).toLocaleString("en-KE"),
          status: sale.status ?? "",
          sold: formatKES(sale.totalKES),
          refunded: formatKES(Number(sale.refundedKES ?? 0)),
        })),
        notice: refunded.length === 0 ? "No refunds or returns in this period." : null,
      });
    }

    case "payment_breakdown": {
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const methods = paymentBreakdown(sales, range);
      const total = methods.reduce((sum, method) => sum + method.amountKES, 0);
      return payload(definition, range, {
        summary: [{ label: "Collected", value: formatKES(total) }],
        rows: methods.map((method) => ({
          method: method.method,
          transactions: method.count,
          amount: formatKES(method.amountKES),
          share: total ? `${Math.round((method.amountKES / total) * 100)}%` : "—",
        })),
        series: methods.map((method) => ({ label: method.method, value: method.amountKES })),
        notice: methods.length === 0 ? "No payments recorded in this period." : null,
      });
    }

    case "outstanding_credit":
    case "supplier_debt": {
      const partyType = key === "supplier_debt" ? "SUPPLIER" : "CUSTOMER";
      if (partyType === "SUPPLIER" && !config.suppliers.credit) {
        return unavailable(definition, range, "Supplier credit is switched off for this business.");
      }
      if (partyType === "CUSTOMER" && !config.credit.enabled) {
        return unavailable(definition, range, "Customer credit is switched off for this business.");
      }
      const parties = await store.partiesWithBalances(businessId, partyType);
      const owing = parties
        .filter((party: any) => Number(party.balanceKES ?? 0) > 0)
        .sort((a: any, b: any) => new Date(a.oldestEntryAt ?? Date.now()).getTime() - new Date(b.oldestEntryAt ?? Date.now()).getTime());
      const termsDays = partyType === "SUPPLIER" ? config.suppliers.termsDays : config.credit.termsDays;
      const totalKES = owing.reduce((sum: number, party: any) => sum + Number(party.balanceKES ?? 0), 0);
      const buckets = new Map<string, number>();
      for (const party of owing) {
        const bucket = ageingBucket(daysOverdue(party.oldestEntryAt, termsDays));
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + Number(party.balanceKES ?? 0));
      }
      return payload(definition, range, {
        summary: [
          { label: partyType === "SUPPLIER" ? "You owe" : "Owed to you", value: formatKES(totalKES) },
          { label: "Accounts", value: String(owing.length) },
          ...["CURRENT", "1-30", "31-60", "61-90", "90+"].map((bucket) => ({
            label: bucket === "CURRENT" ? "Not due yet" : `${bucket} days`,
            value: formatKES(buckets.get(bucket) ?? 0),
          })),
        ],
        rows: owing.map((party: any) => ({
          name: party.name,
          phone: party.phone ?? "—",
          balance: formatKES(Number(party.balanceKES ?? 0)),
          limit: party.creditLimitKES != null ? formatKES(Number(party.creditLimitKES)) : "—",
          oldest: party.oldestEntryAt ? new Date(party.oldestEntryAt).toLocaleDateString("en-KE") : "—",
          ageing: ageingBucket(daysOverdue(party.oldestEntryAt, termsDays)),
        })),
        notice: owing.length === 0 ? "Nothing outstanding. Everyone is square." : null,
      });
    }

    case "expenses": {
      const expenses = toExpenseRecords(await store.expensesForReport(businessId, range, undefined, { branchId }));
      const summary = summarizeExpenses(expenses, range);
      return payload(definition, range, {
        summary: [
          { label: "Total spent", value: formatKES(summary.totalKES) },
          { label: "Entries", value: String(expenses.length) },
        ],
        rows: summary.byCategory.map((entry) => ({
          category: entry.categoryKey,
          amount: formatKES(entry.amountKES),
          share: summary.totalKES ? `${Math.round((entry.amountKES / summary.totalKES) * 100)}%` : "—",
        })),
        series: summary.byCategory.map((entry) => ({ label: entry.categoryKey, value: entry.amountKES })),
        notice: expenses.length === 0 ? "No expenses recorded in this period." : null,
      });
    }

    case "profitability": {
      const [sales, expenses] = await Promise.all([
        store.salesForReport(businessId, range, undefined, { branchId }),
        store.expensesForReport(businessId, range, undefined, { branchId }),
      ]);
      const result = profitability(toSaleRecords(sales), toExpenseRecords(expenses), range);
      return payload(definition, range, {
        basis: "calculated",
        partial: result.partial,
        notice: result.partial
          ? "Some items have no cost price, so profit is an estimate. Add cost prices to make it exact."
          : null,
        summary: [
          { label: "Net sales", value: formatKES(result.netSalesKES) },
          { label: "Cost of goods", value: formatKES(result.costOfGoodsKES) },
          { label: "Gross profit", value: formatKES(result.grossProfitKES) },
          { label: "Expenses", value: formatKES(result.expensesKES) },
          { label: "Net profit", value: formatKES(result.netProfitKES) },
          { label: "Margin", value: `${result.marginPercent}%` },
        ],
      });
    }

    case "inventory_value": {
      const items = await store.stockWithProducts(businessId, undefined, { branchId });
      const withCost = items.map((item: any) => ({ quantity: Number(item.quantity ?? 0), costKES: item.product?.costKES }));
      const missingCost = withCost.filter((item) => item.costKES == null).length;
      const value = inventoryValueKES(withCost);
      const alerts = stockAlerts(
        items.map((item: any) => ({
          productId: item.productId,
          name: item.product?.name ?? "Item",
          quantity: Number(item.quantity ?? 0),
          reorderLevel: Number(item.product?.reorderLevel ?? 0),
          unitKey: item.product?.unitKey,
        })),
      );
      return payload(definition, range, {
        basis: "calculated",
        partial: missingCost > 0,
        notice: missingCost > 0
          ? `${missingCost} item${missingCost === 1 ? "" : "s"} have no cost price, so the value shown is partial.`
          : null,
        summary: [
          { label: "Stock at cost", value: formatKES(value) },
          { label: "Items tracked", value: String(items.length) },
          { label: "Needs attention", value: String(alerts.length) },
        ],
        rows: items
          .map((item: any) => ({
            item: item.product?.name ?? "Item",
            unit: item.product?.unitKey ?? "",
            onHand: Number(item.quantity ?? 0),
            cost: item.product?.costKES != null ? formatKES(Number(item.product.costKES)) : "—",
            value: item.product?.costKES != null ? formatKES(Number(item.product.costKES) * Number(item.quantity ?? 0)) : "—",
          }))
          .sort((a: any, b: any) => b.onHand - a.onHand)
          .slice(0, 200),
      });
    }

    case "best_sellers": {
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const top = bestSellers(sales, 20, range);
      return payload(definition, range, {
        rows: top.map((item) => ({ item: item.name, sold: item.quantity, revenue: formatKES(item.revenueKES) })),
        series: top.slice(0, 8).map((item) => ({ label: item.name, value: item.revenueKES })),
        notice: top.length === 0 ? "Nothing sold in this period yet." : null,
      });
    }

    case "slow_movers": {
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const items = await store.stockWithProducts(businessId, undefined, { branchId });
      const names = items.map((item: any) => String(item.product?.name ?? ""));
      const slow = slowMovers(sales, names, range, 20);
      return payload(definition, range, {
        basis: "calculated",
        rows: slow.map((name) => ({ item: name, status: "No sales in this period" })),
        notice: slow.length === 0 ? "Everything on your shelf sold in this period." : null,
      });
    }

    case "customer_activity": {
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const byCustomer = new Map<string, { visits: number; revenueKES: number; lastVisit: Date }>();
      for (const sale of sales) {
        const name = sale.customerName ?? "Walk-in";
        const entry = byCustomer.get(name) ?? { visits: 0, revenueKES: 0, lastVisit: new Date(sale.createdAt) };
        entry.visits += 1;
        entry.revenueKES += sale.totalKES;
        const when = new Date(sale.createdAt);
        if (when.getTime() > entry.lastVisit.getTime()) entry.lastVisit = when;
        byCustomer.set(name, entry);
      }
      const rows = [...byCustomer.entries()]
        .map(([name, entry]) => ({
          customer: name,
          visits: entry.visits,
          spent: formatKES(entry.revenueKES),
          average: formatKES(entry.visits ? Math.round(entry.revenueKES / entry.visits) : 0),
          lastVisit: entry.lastVisit.toLocaleDateString("en-KE"),
        }))
        .sort((a, b) => b.visits - a.visits);
      return payload(definition, range, {
        summary: [
          { label: terminology.customers, value: String(byCustomer.size) },
          { label: "Repeat visits", value: String(rows.filter((row) => row.visits > 1).length) },
        ],
        rows: rows.slice(0, 200),
        notice: rows.length === 0 ? `No ${terminology.customers.toLowerCase()} served in this period yet.` : null,
      });
    }

    case "staff_performance":
    case "commissions": {
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const staff = await store.listStaff(businessId, { activeOnly: false });
      const byName: Record<string, number> = {};
      for (const member of staff) byName[String(member.name)] = Number(member.commissionPercent ?? 0);
      const rows = staffPerformance(sales, byName, range);
      return payload(definition, range, {
        basis: key === "commissions" ? "calculated" : "recorded",
        partial: key === "commissions" && rows.some((row) => !byName[row.staffName]),
        notice: key === "commissions" && rows.some((row) => !byName[row.staffName])
          ? "Some staff have no commission rate set, so their commission shows as zero."
          : rows.length === 0
            ? "No sales attributed to staff in this period."
            : null,
        rows: rows.map((row) => ({
          person: row.staffName,
          sales: row.sales,
          revenue: formatKES(row.revenueKES),
          ...(key === "commissions" ? { commission: formatKES(row.commissionKES), rate: `${byName[row.staffName] ?? 0}%` } : {}),
        })),
      });
    }

    case "channel_attribution": {
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const rows = channelAttribution(sales, range);
      const total = rows.reduce((sum, row) => sum + row.revenueKES, 0);
      return payload(definition, range, {
        summary: [{ label: "Channels used", value: String(rows.length) }],
        rows: rows.map((row) => ({
          channel: row.channel.replace(/_/g, " "),
          sales: row.count,
          revenue: formatKES(row.revenueKES),
          share: total ? `${Math.round((row.revenueKES / total) * 100)}%` : "—",
        })),
        series: rows.map((row) => ({ label: row.channel, value: row.revenueKES })),
        notice: rows.length === 0 ? "No sales recorded in this period." : null,
      });
    }

    case "ingredient_usage": {
      const movements = await store.movementsForReport(businessId, range, undefined, { branchId });
      const used = movements.filter((movement: any) => ["SALE", "DAMAGE", "EXPIRY", "WASTAGE"].includes(movement.reason));
      const byItem = new Map<string, { name: string; unit: string; quantity: number; wasted: number }>();
      for (const movement of used) {
        const name = String(movement.product?.name ?? "Item");
        const entry = byItem.get(name) ?? { name, unit: movement.product?.unitKey ?? "", quantity: 0, wasted: 0 };
        entry.quantity += Math.abs(Number(movement.delta ?? 0));
        if (movement.reason !== "SALE") entry.wasted += Math.abs(Number(movement.delta ?? 0));
        byItem.set(name, entry);
      }
      const rows = [...byItem.values()].sort((a, b) => b.quantity - a.quantity);
      return payload(definition, range, {
        basis: "calculated",
        summary: [
          { label: terminology.stock, value: String(rows.length) },
          { label: "Lost to waste", value: String(rows.filter((row) => row.wasted > 0).length) },
        ],
        rows: rows.slice(0, 200).map((row) => ({
          item: row.name,
          used: `${row.quantity} ${row.unit}`.trim(),
          wasted: row.wasted ? `${row.wasted} ${row.unit}`.trim() : "—",
        })),
        notice: rows.length === 0 ? "Nothing was used from stock in this period." : null,
      });
    }

    case "production": {
      const movements = await store.movementsForReport(businessId, range, undefined, { branchId });
      const rows = movements.filter((movement: any) => ["PRODUCTION_IN", "PRODUCTION_OUT"].includes(movement.reason));
      return payload(definition, range, {
        rows: rows.slice(-200).reverse().map((movement: any) => ({
          when: new Date(movement.createdAt).toLocaleString("en-KE"),
          item: movement.product?.name ?? "Item",
          direction: movement.reason === "PRODUCTION_IN" ? "Output" : "Materials used",
          quantity: `${Math.abs(Number(movement.delta ?? 0))} ${movement.product?.unitKey ?? ""}`.trim(),
          note: movement.note ?? "—",
        })),
        notice: rows.length === 0 ? "No production recorded in this period." : null,
      });
    }

    case "job_profitability": {
      const orders = await store.ordersForReport(businessId, range, undefined, { branchId });
      const jobs = orders.filter((order: any) => !isTerminal(order.workflowKey, order.stateKey) || order.stateKey !== "CANCELLED");
      const sales = toSaleRecords(await store.salesForReport(businessId, range, undefined, { branchId }));
      const saleById = new Map(sales.map((sale) => [sale.id, sale]));
      const rows = jobs.map((order: any) => {
        const sale = order.saleId ? saleById.get(order.saleId) : null;
        const revenue = Number(sale?.totalKES ?? order.totalKES ?? 0);
        const cost = sale?.costKES ?? (sale?.items ?? []).reduce((sum, item) => sum + Number(item.costKES ?? 0) * Number(item.quantity ?? 0), 0);
        return {
          job: order.reference,
          customer: order.customerName ?? "—",
          state: stateLabel(order.workflowKey, order.stateKey),
          revenue: formatKES(revenue),
          cost: cost ? formatKES(cost) : "—",
          profit: cost ? formatKES(revenue - cost) : "—",
        };
      });
      return payload(definition, range, {
        basis: "calculated",
        partial: rows.some((row) => row.cost === "—"),
        notice: rows.some((row) => row.cost === "—")
          ? "Some jobs have no cost recorded, so their profit is not shown. Add cost prices or parts to see it."
          : rows.length === 0
            ? `No ${terminology.orders.toLowerCase()} in this period.`
            : null,
        rows: rows.slice(-200).reverse(),
      });
    }

    case "projects": {
      const orders = await store.ordersForReport(businessId, range, undefined, { branchId });
      const projects = orders.filter((order: any) => order.workflowKey === "project");
      const deposits = projects.reduce((sum: number, order: any) => sum + Number(order.depositKES ?? 0), 0);
      const balances = projects.reduce((sum: number, order: any) => sum + Math.max(0, Number(order.totalKES ?? 0) - Number(order.depositKES ?? 0)), 0);
      return payload(definition, range, {
        summary: [
          { label: terminology.orders, value: String(projects.length) },
          { label: "Deposits held", value: formatKES(deposits) },
          { label: "Still to collect", value: formatKES(balances) },
        ],
        rows: projects.slice(-200).reverse().map((order: any) => ({
          project: order.reference,
          customer: order.customerName ?? "—",
          stage: stateLabel(order.workflowKey, order.stateKey),
          value: formatKES(Number(order.totalKES ?? 0)),
          deposit: formatKES(Number(order.depositKES ?? 0)),
          balance: formatKES(Math.max(0, Number(order.totalKES ?? 0) - Number(order.depositKES ?? 0))),
        })),
        notice: projects.length === 0 ? "No projects recorded in this period." : null,
      });
    }

    case "produce":
      return unavailable(
        definition,
        range,
        "Harvest records are not part of your POS yet. What you sell appears in Daily sales, and stock you use appears in Ingredient usage.",
      );

    case "rent":
      return unavailable(
        definition,
        range,
        "Rent collection is not part of your POS yet. Rent you invoice appears in Sales, and unpaid balances appear in Outstanding credit.",
      );

    default:
      return unavailable(definition, range, "That report is not available yet.");
  }
}

/** Closing the day (§8 finance): one screen with the numbers to count against the till. */
export async function runDailyClosing(businessId: string, config: PosConfiguration, now: Date = new Date(), options: { branchId?: string | null } = {}) {
  // The same branch rule as every other report (§16, §75).
  const branchId = options.branchId ?? null;
  const range = dayRange(now);
  const [sales, expenses, payments] = await Promise.all([
    store.salesForReport(businessId, range, undefined, { branchId }),
    store.expensesForReport(businessId, range, undefined, { branchId }),
    store.paymentsForReport(businessId, range, undefined, { branchId }),
  ]);
  const closing = dailyClosing(toSaleRecords(sales), toExpenseRecords(expenses), toPaymentLedgerRecords(payments), now);
  return {
    ...closing,
    summary: [
      { label: "Sales", value: String(closing.sales.count) },
      { label: "Net sales", value: formatKES(closing.sales.netKES) },
      { label: "Collected", value: formatKES(closing.sales.paidKES) },
      { label: "Still owed", value: formatKES(closing.sales.outstandingKES) },
      { label: "Expenses", value: formatKES(closing.expensesKES) },
      { label: "Expected in the drawer", value: formatKES(closing.expectedCashKES) },
    ],
    rows: closing.methods.map((method) => ({ method: method.method, transactions: method.count, amount: formatKES(method.amountKES) })),
    canCloseDay: hasCapability(config, "daily_closing"),
  };
}

/** The catalogue of reports this business is configured for, grouped for the screen (§35). */
export function reportCatalogueFor(config: PosConfiguration) {
  const definitions = reportDefinitions(config);
  const groups = new Map<string, ReportDefinition[]>();
  for (const definition of definitions) {
    const list = groups.get(definition.group) ?? [];
    list.push(definition);
    groups.set(definition.group, list);
  }
  return [...groups.entries()].map(([group, reports]) => ({ group, reports }));
}
