/**
 * Dashboard cards (§34)
 *
 * The configuration decides which cards exist; this module decides what they say. A salon never
 * sees "In the kitchen" and a restaurant never sees "Jobs in progress" — not because the code
 * branches on the trade, but because the capability behind each card is switched off.
 *
 * Every number comes from recorded transactions in this tenant. Where a card would need data the
 * business has not recorded, it says so instead of showing a misleading zero (§35).
 */

import { formatKES } from "@/lib/format";
import { hasCapability } from "./capabilities";
import { inventoryValueKES } from "./inventory";
import { cardLabel } from "./presentation";
import { dayRange, monthRange, summarizeSales, inRange } from "./reports";
import * as store from "./store";
import { isTerminal } from "./workflow";
import type { DashboardCardKey, PosConfiguration } from "./types";

export type DashboardCard = {
  key: DashboardCardKey;
  label: string;
  value: string;
  hint: string;
  href: string;
  tone: "neutral" | "info" | "warn" | "success";
};

type CardSources = {
  sales: any[];
  orders: any[];
  customersOwing: number;
  suppliersOwing: number;
  lowStock: number;
  monthExpenses: number;
  stockValue: number;
  newCustomers: number;
};

/** Loads only what the configured cards actually need (§34 — no metric for every business). */
export async function loadCardSources(
  businessId: string,
  config: PosConfiguration,
  cards: DashboardCardKey[],
  options: { branchId?: string | null } = {},
): Promise<CardSources> {
  const wanted = new Set(cards);
  const today = dayRange();
  const month = monthRange();
  // A staff member bound to a location sees that location's numbers; an unbound actor sees the
  // whole business (§16, §75). Credit and supplier balances are party-level, not location-level.
  const branchId = options.branchId ?? null;
  const needsSales = ["today_sales", "cash", "mpesa", "staff_performance", "top_products"].some((key) => wanted.has(key as DashboardCardKey));
  const needsOrders = ["orders", "appointments", "pending_jobs", "pending_deliveries", "kitchen_queue"].some((key) => wanted.has(key as DashboardCardKey));

  const [sales, orders, customerParties, supplierParties, lowStock, expenses, stock, newCustomers] = await Promise.all([
    needsSales ? store.salesForReport(businessId, { from: today.from, to: today.to }, undefined, { branchId }) : Promise.resolve([]),
    needsOrders ? store.ordersForReport(businessId, { from: new Date(Date.now() - 30 * 86_400_000), to: new Date() }, undefined, { branchId }) : Promise.resolve([]),
    wanted.has("credit_owed") ? store.partiesWithBalances(businessId, "CUSTOMER") : Promise.resolve([]),
    wanted.has("supplier_debt") ? store.partiesWithBalances(businessId, "SUPPLIER") : Promise.resolve([]),
    wanted.has("stock_alerts") && config.inventory.enabled ? store.lowStock(businessId, undefined, { branchId }) : Promise.resolve([]),
    wanted.has("expenses") ? store.expensesForReport(businessId, { from: month.from, to: month.to }, undefined, { branchId }) : Promise.resolve([]),
    wanted.has("inventory_value") ? store.stockWithProducts(businessId, undefined, { branchId }) : Promise.resolve([]),
    wanted.has("new_customers")
      ? store.countNewCustomers(businessId, today.from)
      : Promise.resolve(0),
  ]);

  const sum = (rows: any[]) => rows.reduce((total, row) => total + Math.max(0, Number(row.balanceKES ?? 0)), 0);

  return {
    sales: sales as any[],
    orders: orders as any[],
    customersOwing: sum(customerParties as any[]),
    suppliersOwing: sum(supplierParties as any[]),
    lowStock: (lowStock as any[]).length,
    monthExpenses: (expenses as any[]).reduce((total, row) => total + Number(row.amountKES ?? 0), 0),
    stockValue: inventoryValueKES(
      (stock as any[]).map((item) => ({ quantity: Number(item.quantity ?? 0), costKES: item.product?.costKES })),
    ),
    newCustomers: Number(newCustomers ?? 0),
  };
}

/** Builds the cards, in the order the configuration chose (§34). */
export function buildDashboardCards(
  config: PosConfiguration,
  basePath: string,
  cards: DashboardCardKey[],
  sources: CardSources,
): DashboardCard[] {
  const today = dayRange();
  const summary = summarizeSales(
    sources.sales.map((sale) => ({
      id: sale.id,
      createdAt: sale.createdAt,
      status: sale.status,
      subtotalKES: Number(sale.subtotalKES ?? 0),
      discountKES: Number(sale.discountKES ?? 0),
      taxKES: Number(sale.taxKES ?? 0),
      totalKES: Number(sale.totalKES ?? 0),
      paidKES: Number(sale.paidKES ?? 0),
      balanceKES: Number(sale.balanceKES ?? 0),
      refundedKES: Number(sale.refundedKES ?? 0),
      channel: sale.channel,
      staffName: sale.staffName,
      payments: (sale.payments ?? []).map((payment: any) => ({ method: payment.method, amountKES: Number(payment.amountKES ?? 0) })),
      items: (sale.items ?? []).map((item: any) => ({ name: item.name, quantity: Number(item.quantity ?? 0), totalKES: Number(item.totalKES ?? 0) })),
    })),
    today,
  );

  const methodTotal = (method: string) =>
    sources.sales.reduce((total, sale) => {
      if (!inRange(sale.createdAt, today)) return total;
      if ((sale.status ?? "").toUpperCase() === "VOIDED") return total;
      return total + (sale.payments ?? [])
        .filter((payment: any) => String(payment.method).toLowerCase() === method && payment.direction !== "OUT")
        .reduce((sum: number, payment: any) => sum + Number(payment.amountKES ?? 0), 0);
    }, 0);

  const openOrders = sources.orders.filter((order) => !isTerminal(order.workflowKey, order.stateKey));
  const inState = (...keys: string[]) => openOrders.filter((order) => keys.includes(String(order.stateKey).toUpperCase())).length;
  const byWorkflow = (key: string) => openOrders.filter((order) => order.workflowKey === key).length;

  const staffToday = new Map<string, number>();
  for (const sale of sources.sales) {
    if (!inRange(sale.createdAt, today)) continue;
    const name = sale.staffName ?? "Unassigned";
    staffToday.set(name, (staffToday.get(name) ?? 0) + Number(sale.totalKES ?? 0));
  }
  const topStaff = [...staffToday.entries()].sort((a, b) => b[1] - a[1])[0];

  const soldToday = new Map<string, number>();
  for (const sale of sources.sales) {
    if (!inRange(sale.createdAt, today)) continue;
    for (const item of sale.items ?? []) {
      soldToday.set(item.name, (soldToday.get(item.name) ?? 0) + Number(item.quantity ?? 0));
    }
  }
  const topProduct = [...soldToday.entries()].sort((a, b) => b[1] - a[1])[0];

  const builders: Record<DashboardCardKey, () => DashboardCard | null> = {
    today_sales: () => ({
      key: "today_sales",
      label: cardLabel("today_sales"),
      value: formatKES(summary.netKES),
      hint: `${summary.count} sale${summary.count === 1 ? "" : "s"}${summary.outstandingKES > 0 ? ` · ${formatKES(summary.outstandingKES)} still owed` : ""}`,
      href: `${basePath}/sales`,
      tone: "success",
    }),
    orders: () => ({
      key: "orders",
      label: cardLabel("orders"),
      value: String(openOrders.length),
      hint: openOrders.length ? "Waiting to be finished" : "Nothing open",
      href: `${basePath}/orders`,
      tone: openOrders.length ? "info" : "neutral",
    }),
    cash: () => ({
      key: "cash",
      label: cardLabel("cash"),
      value: formatKES(methodTotal("cash")),
      hint: "Count this against the drawer",
      href: `${basePath}/reports?report=daily_closing`,
      tone: "neutral",
    }),
    mpesa: () => ({
      key: "mpesa",
      label: cardLabel("mpesa"),
      value: formatKES(methodTotal("mpesa")),
      hint: "Check against your M-Pesa statements",
      href: `${basePath}/reports?report=payment_breakdown`,
      tone: "neutral",
    }),
    credit_owed: () => ({
      key: "credit_owed",
      label: cardLabel("credit_owed"),
      value: formatKES(sources.customersOwing),
      hint: sources.customersOwing > 0 ? "Collect these" : "Everyone is square",
      href: `${basePath}/customers?credit=1`,
      tone: sources.customersOwing > 0 ? "warn" : "success",
    }),
    supplier_debt: () => ({
      key: "supplier_debt",
      label: cardLabel("supplier_debt"),
      value: formatKES(sources.suppliersOwing),
      hint: sources.suppliersOwing > 0 ? "Due to your suppliers" : "Nothing owing",
      href: `${basePath}/suppliers`,
      tone: sources.suppliersOwing > 0 ? "warn" : "success",
    }),
    stock_alerts: () => ({
      key: "stock_alerts",
      label: cardLabel("stock_alerts"),
      value: String(sources.lowStock),
      hint: sources.lowStock ? "At or below the reorder level" : "Everything is stocked",
      href: `${basePath}/inventory`,
      tone: sources.lowStock ? "warn" : "success",
    }),
    expenses: () => ({
      key: "expenses",
      label: cardLabel("expenses"),
      value: formatKES(sources.monthExpenses),
      hint: "This month so far",
      href: `${basePath}/expenses`,
      tone: "neutral",
    }),
    appointments: () => ({
      key: "appointments",
      label: cardLabel("appointments"),
      value: String(byWorkflow("appointment")),
      hint: byWorkflow("appointment") ? "Booked and not yet finished" : "No appointments waiting",
      href: `${basePath}/orders`,
      tone: "info",
    }),
    pending_jobs: () => ({
      key: "pending_jobs",
      label: cardLabel("pending_jobs"),
      value: String(byWorkflow("garage") + byWorkflow("project")),
      hint: "In the workshop now",
      href: `${basePath}/orders`,
      tone: "info",
    }),
    pending_deliveries: () => ({
      key: "pending_deliveries",
      label: cardLabel("pending_deliveries"),
      value: String(openOrders.filter((order) => String(order.fulfilment ?? "").toUpperCase() === "DELIVERY").length),
      hint: "Out for delivery or waiting to go",
      href: `${basePath}/orders`,
      tone: "info",
    }),
    staff_performance: () => ({
      key: "staff_performance",
      label: cardLabel("staff_performance"),
      value: topStaff ? formatKES(topStaff[1]) : formatKES(0),
      hint: topStaff ? `${topStaff[0]} today` : "No sales attributed today",
      href: `${basePath}/reports?report=staff_performance`,
      tone: "neutral",
    }),
    inventory_value: () => ({
      key: "inventory_value",
      label: cardLabel("inventory_value"),
      value: formatKES(sources.stockValue),
      hint: hasCapability(config, "inventory_valuation") ? "At cost price" : "Add cost prices to make this exact",
      href: `${basePath}/reports?report=inventory_value`,
      tone: "neutral",
    }),
    new_customers: () => ({
      key: "new_customers",
      label: cardLabel("new_customers"),
      value: String(sources.newCustomers),
      hint: "Added today",
      href: `${basePath}/customers`,
      tone: "neutral",
    }),
    top_products: () => ({
      key: "top_products",
      label: cardLabel("top_products"),
      value: topProduct ? String(topProduct[1]) : "—",
      hint: topProduct ? `${topProduct[0]} sold today` : "Nothing sold yet today",
      href: `${basePath}/reports?report=best_sellers`,
      tone: "neutral",
    }),
    kitchen_queue: () => ({
      key: "kitchen_queue",
      label: cardLabel("kitchen_queue"),
      value: String(inState("PREPARING", "COOKING", "IN_PROGRESS")),
      hint: "Being prepared right now",
      href: `${basePath}/orders`,
      tone: "info",
    }),
  };

  return cards.map((key) => builders[key]?.() ?? null).filter((card): card is DashboardCard => Boolean(card));
}
