/**
 * Preview sandbox (§23, §44)
 *
 * The owner tries the real configured POS before paying. Nothing here touches the database:
 * a preview is not production, so the sandbox is generated deterministically from the
 * configuration and thrown away. Same screens, same navigation, same words — sample data.
 */

import { hasCapability } from "./capabilities";
import { buildNavigation, deriveDashboardCards, deriveQuickActions, cardLabel, emptyStateFor, orderChannelWords } from "./presentation";
import { resolveTerminology } from "./terminology";
import { buildReceipt, formatReceiptNumber, receiptPrefixFromBusinessName, receiptToText } from "./receipt";
import { calculateSale } from "./money";
import { resolveStates } from "./workflow";
import { paymentMethodOptions } from "./money";
import type { PosConfiguration, ReceiptDocument } from "./types";

/** Small deterministic PRNG so a preview does not flicker between renders. */
function seededRandom(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function hashSeed(config: PosConfiguration): number {
  const text = `${config.business.typeKey}:${config.capabilities.length}:${config.inventory.units.join(",")}`;
  let hash = 7;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 100000;
  return hash || 11;
}

type SampleItem = { name: string; priceKES: number; kind: "PRODUCT" | "SERVICE"; unit?: string; stock?: number; category?: string };

const SAMPLE_CATALOGUES: Record<string, SampleItem[]> = {
  restaurant: [
    { name: "Chicken Biryani", priceKES: 350, kind: "PRODUCT", unit: "piece", stock: 24, category: "Main" },
    { name: "Pilau", priceKES: 300, kind: "PRODUCT", unit: "piece", stock: 30, category: "Main" },
    { name: "Nyama Choma (½ kg)", priceKES: 900, kind: "PRODUCT", unit: "kilogram", stock: 8, category: "Main" },
    { name: "Chapati", priceKES: 50, kind: "PRODUCT", unit: "piece", stock: 60, category: "Sides" },
    { name: "Fresh juice", priceKES: 150, kind: "PRODUCT", unit: "litre", stock: 12, category: "Drinks" },
  ],
  food: [
    { name: "Chapati", priceKES: 50, kind: "PRODUCT", unit: "piece", stock: 40, category: "Snacks" },
    { name: "Samosa", priceKES: 60, kind: "PRODUCT", unit: "piece", stock: 25, category: "Snacks" },
    { name: "Tea", priceKES: 40, kind: "PRODUCT", unit: "piece", stock: 100, category: "Drinks" },
  ],
  hardware: [
    { name: "Cement (50kg)", priceKES: 780, kind: "PRODUCT", unit: "bag", stock: 40, category: "Building" },
    { name: "Roofing nail 3\"", priceKES: 320, kind: "PRODUCT", unit: "kilogram", stock: 18, category: "Fasteners" },
    { name: "PVC pipe ½\"", priceKES: 250, kind: "PRODUCT", unit: "metre", stock: 60, category: "Plumbing" },
    { name: "Wheelbarrow", priceKES: 6500, kind: "PRODUCT", unit: "piece", stock: 4, category: "Tools" },
    { name: "Sand (7 tonne tipper)", priceKES: 21000, kind: "PRODUCT", unit: "piece", stock: 2, category: "Building" },
  ],
  salon: [
    { name: "Braids — medium", priceKES: 2500, kind: "SERVICE", unit: "session", category: "Hair" },
    { name: "Haircut", priceKES: 500, kind: "SERVICE", unit: "visit", category: "Hair" },
    { name: "Manicure", priceKES: 800, kind: "SERVICE", unit: "session", category: "Nails" },
    { name: "Shampoo & treatment", priceKES: 1200, kind: "SERVICE", unit: "session", category: "Hair" },
    { name: "Hair oil 100ml", priceKES: 650, kind: "PRODUCT", unit: "piece", stock: 12, category: "Products" },
  ],
  garage: [
    { name: "Full service", priceKES: 4500, kind: "SERVICE", unit: "job", category: "Service" },
    { name: "Brake pads (front)", priceKES: 6800, kind: "PRODUCT", unit: "pair", stock: 6, category: "Parts" },
    { name: "Engine oil 5W-30", priceKES: 1450, kind: "PRODUCT", unit: "litre", stock: 20, category: "Parts" },
    { name: "Wheel alignment", priceKES: 2500, kind: "SERVICE", unit: "job", category: "Service" },
    { name: "Diagnostic scan", priceKES: 1000, kind: "SERVICE", unit: "visit", category: "Service" },
  ],
  farm: [
    { name: "Maize", priceKES: 4200, kind: "PRODUCT", unit: "bag", stock: 30, category: "Cereals" },
    { name: "Tomatoes", priceKES: 120, kind: "PRODUCT", unit: "kilogram", stock: 240, category: "Horticulture" },
    { name: "Milk", priceKES: 70, kind: "PRODUCT", unit: "litre", stock: 180, category: "Dairy" },
    { name: "Eggs", priceKES: 480, kind: "PRODUCT", unit: "crate", stock: 12, category: "Poultry" },
  ],
  retail: [
    { name: "Sugar 2kg", priceKES: 290, kind: "PRODUCT", unit: "pack", stock: 48, category: "Groceries" },
    { name: "Cooking oil 1L", priceKES: 320, kind: "PRODUCT", unit: "bottle", stock: 36, category: "Groceries" },
    { name: "Wheat flour 2kg", priceKES: 250, kind: "PRODUCT", unit: "pack", stock: 40, category: "Groceries" },
    { name: "Bar soap", priceKES: 90, kind: "PRODUCT", unit: "piece", stock: 60, category: "Household" },
  ],
  wholesale: [
    { name: "Soda 500ml (carton)", priceKES: 1080, kind: "PRODUCT", unit: "carton", stock: 60, category: "Beverages" },
    { name: "Wheat flour 2kg (carton)", priceKES: 1150, kind: "PRODUCT", unit: "carton", stock: 40, category: "Groceries" },
    { name: "Cooking oil 1L (carton)", priceKES: 3600, kind: "PRODUCT", unit: "carton", stock: 25, category: "Groceries" },
  ],
  professional: [
    { name: "Consultation (1 hour)", priceKES: 5000, kind: "SERVICE", unit: "hour", category: "Advisory" },
    { name: "Monthly retainer", priceKES: 45000, kind: "SERVICE", unit: "session", category: "Advisory" },
    { name: "Filing & compliance", priceKES: 12000, kind: "SERVICE", unit: "job", category: "Compliance" },
  ],
  laundry: [
    { name: "Wash & fold (per kg)", priceKES: 150, kind: "SERVICE", unit: "kilogram", category: "Wash" },
    { name: "Dry clean — suit", priceKES: 900, kind: "SERVICE", unit: "piece", category: "Dry clean" },
    { name: "Iron only", priceKES: 100, kind: "SERVICE", unit: "piece", category: "Pressing" },
  ],
  default: [
    { name: "Standard item", priceKES: 500, kind: "PRODUCT", unit: "piece", stock: 20, category: "General" },
    { name: "Service visit", priceKES: 1500, kind: "SERVICE", unit: "visit", category: "Services" },
    { name: "Premium item", priceKES: 2500, kind: "PRODUCT", unit: "piece", stock: 6, category: "General" },
  ],
};

const CATALOGUE_BY_TYPE: Record<string, string> = {
  restaurant: "restaurant", cafe: "food", bar: "food", bakery: "food", butchery: "retail", catering: "restaurant", hotel: "restaurant",
  grocery: "retail", supermarket: "retail", convenience_shop: "retail", retail: "retail", electronics: "retail", furniture: "retail",
  clothing: "retail", boutique: "retail", shoes: "retail", beauty_products: "retail", florist: "retail", pharmacy: "retail",
  hardware: "hardware", building_materials: "hardware", spare_parts: "hardware", wholesale: "wholesale",
  salon: "salon", barber: "salon", spa: "salon",
  garage: "garage", auto_repair: "garage", car_wash: "garage", workshop: "garage",
  farm: "farm", agribusiness: "farm",
  professional_services: "professional", consultancy: "professional", agency: "professional", real_estate: "professional", education: "professional",
  laundry: "laundry", cleaning_service: "laundry", tailor: "laundry", fashion_designer: "laundry", printing: "laundry",
  manufacturing: "wholesale", transport: "professional", courier: "laundry", events: "professional", photography: "professional",
  online_seller: "retail", marketplace_seller: "retail", subscription_business: "professional", membership_business: "professional",
};

export function sampleCatalogue(config: PosConfiguration): SampleItem[] {
  const family = CATALOGUE_BY_TYPE[config.business.typeKey] ?? "default";
  const base = SAMPLE_CATALOGUES[family] ?? SAMPLE_CATALOGUES.default;
  const wantsProducts = config.sales.products;
  const wantsServices = config.sales.services;
  const filtered = base.filter((item) => (item.kind === "PRODUCT" ? wantsProducts : wantsServices));
  const list = filtered.length ? filtered : SAMPLE_CATALOGUES.default;
  // A business without stock tracking should not see stock numbers in the preview (§23).
  return list.map((item) => (config.inventory.enabled ? item : { ...item, stock: undefined }));
}

export type PreviewCustomer = { id: string; name: string; phone: string; balanceKES: number; visits: number; segment?: string };
export type PreviewSale = {
  id: string; receiptNumber: string; at: string; customer: string; channel: string; items: number;
  totalKES: number; method: string; status: string; balanceKES: number;
};

const SAMPLE_NAMES = ["Jane Wanjiku", "Peter Otieno", "Amina Hassan", "Samuel Kariuki", "Grace Akinyi", "David Mwangi", "Fatuma Ali", "Brian Kipchoge"];
const SAMPLE_PHONES = ["0712 345 678", "0723 456 789", "0734 567 890", "0745 678 901", "0756 789 012", "0767 890 123"];

export type PreviewSandbox = {
  isPreview: true;
  businessName: string;
  headline: string;
  navigation: { key: string; label: string; href: string; icon: string }[];
  quickActions: { key: string; label: string; icon: string }[];
  dashboard: { key: string; label: string; value: string; hint?: string }[];
  catalogue: (SampleItem & { id: string })[];
  customers: PreviewCustomer[];
  sales: PreviewSale[];
  orders: { id: string; reference: string; customer: string; channel: string; state: string; totalKES: string; at: string }[];
  credit: { name: string; balanceKES: string; status: string; dueIn: string }[];
  suppliers: { name: string; balanceKES: string; terms: string }[];
  expenses: { category: string; amountKES: string; at: string }[];
  staff: { name: string; role: string; salesKES: string }[];
  inventory: { name: string; unit: string; quantity: number; status: string }[];
  reports: { key: string; label: string; blurb: string; group: string; basis: string }[];
  saleFlow: {
    prompt: string;
    steps: { label: string; value: string }[];
    paymentMethods: { key: string; label: string }[];
    totals: { subtotalKES: string; discountKES: string; taxKES: string; totalKES: string; paidKES: string; balanceKES: string };
  };
  receipt: ReceiptDocument;
  receiptText: string;
  emptyStates: { module: string; title: string; body: string; action: string }[];
  notice: string;
};

const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

/** Build the sandbox a business will be able to interact with (§23). */
export function buildPreviewSandbox(config: PosConfiguration, businessName?: string): PreviewSandbox {
  const terminology = resolveTerminology(config);
  const random = seededRandom(hashSeed(config));
  const basePath = "/preview";
  const name = (businessName || config.business.name || `${config.business.typeLabel || "My"} business`).trim();
  const catalogue = sampleCatalogue(config).map((item, index) => ({ ...item, id: `preview-item-${index + 1}` }));

  const customers: PreviewCustomer[] = config.customers.enabled
    ? SAMPLE_NAMES.slice(0, config.credit.enabled ? 6 : 4).map((customer, index) => ({
        id: `preview-customer-${index + 1}`,
        name: customer,
        phone: SAMPLE_PHONES[index % SAMPLE_PHONES.length],
        balanceKES: config.credit.enabled && index < 2 ? Math.round((1200 + random() * 4800) / 50) * 50 : 0,
        visits: 1 + Math.floor(random() * 9),
        segment: config.customers.segments ? (index % 2 === 0 ? "Regular" : "New") : undefined,
      }))
    : [];

  const channels = config.orders.channels.length ? config.orders.channels : ["walk_in"];
  const methods = paymentMethodOptions(config).filter((method) => method.key !== "credit");
  const sales: PreviewSale[] = Array.from({ length: 8 }, (_, index) => {
    const itemCount = 1 + Math.floor(random() * 3);
    const lines = Array.from({ length: itemCount }, () => {
      const item = catalogue[Math.floor(random() * catalogue.length)] ?? catalogue[0];
      return { name: item?.name ?? "Item", quantity: 1 + Math.floor(random() * 3), unitPriceKES: item?.priceKES ?? 500, kind: item?.kind ?? "PRODUCT" as const };
    });
    const calculation = calculateSale({ lines, tax: config.sales.tax, saleDiscountKES: config.sales.discounts && random() > 0.7 ? 50 : 0 });
    const method = methods.length ? methods[Math.floor(random() * methods.length)] : { key: "cash", label: "Cash" };
    const when = new Date(Date.now() - index * 3600_000 * (2 + Math.floor(random() * 6)));
    return {
      id: `preview-sale-${index + 1}`,
      receiptNumber: formatReceiptNumber(receiptPrefixFromBusinessName(name), 1000 + index),
      at: when.toISOString(),
      customer: config.customers.enabled ? customers[index % Math.max(1, customers.length)]?.name ?? "Walk-in" : "Walk-in",
      channel: channels[index % channels.length],
      items: itemCount,
      totalKES: calculation.totals.totalKES,
      method: method.label,
      status: "COMPLETED",
      balanceKES: 0,
    };
  });

  const todaySales = sales.filter((sale) => new Date(sale.at).toDateString() === new Date().toDateString());
  const todayTotal = todaySales.reduce((total, sale) => total + sale.totalKES, 0);
  const cashTotal = todaySales.filter((sale) => sale.method === "Cash").reduce((total, sale) => total + sale.totalKES, 0);
  const mpesaTotal = todaySales.filter((sale) => sale.method === "M-Pesa").reduce((total, sale) => total + sale.totalKES, 0);
  const creditTotal = customers.reduce((total, customer) => total + customer.balanceKES, 0);

  const dashboard = deriveDashboardCards(config).map((key) => {
    const value = (() => {
      switch (key) {
        case "today_sales": return money(todayTotal);
        case "cash": return money(cashTotal);
        case "mpesa": return money(mpesaTotal);
        case "credit_owed": return money(creditTotal);
        case "supplier_debt": return money(config.suppliers.credit ? 18400 : 0);
        case "orders": return String(2 + Math.floor(random() * 3));
        case "appointments": return String(3 + Math.floor(random() * 4));
        case "pending_jobs": return String(1 + Math.floor(random() * 3));
        case "pending_deliveries": return String(config.delivery.enabled ? 1 + Math.floor(random() * 3) : 0);
        case "stock_alerts": return String(config.inventory.enabled ? catalogue.filter((item) => (item.stock ?? 99) < 8).length : 0);
        case "expenses": return money(12400);
        case "inventory_value": return money(catalogue.reduce((total, item) => total + (item.stock ?? 0) * Math.round(item.priceKES * 0.6), 0));
        case "new_customers": return String(2);
        case "top_products": return catalogue[0]?.name ?? "—";
        case "kitchen_queue": return String(hasCapability(config, "kitchen_orders") ? 2 : 0);
        case "staff_performance": return config.staff.enabled ? `${SAMPLE_NAMES[0].split(" ")[0]} · ${money(3200)}` : "—";
        default: return "—";
      }
    })();
    return { key, label: cardLabel(key), value };
  });

  const states = resolveStates(config);
  const orders = config.orders.enabled
    ? Array.from({ length: 4 }, (_, index) => ({
        id: `preview-order-${index + 1}`,
        reference: `#${1040 + index}`,
        customer: customers[index % Math.max(1, customers.length)]?.name ?? "Walk-in",
        channel: channels[index % channels.length],
        state: states[Math.min(index, states.length - 1)]?.label ?? "New",
        totalKES: money(700 + index * 450),
        at: new Date(Date.now() - index * 5400_000).toISOString(),
      }))
    : [];

  const firstSaleItem = catalogue[0];
  const firstSaleLines = firstSaleItem
    ? [{ name: firstSaleItem.name, quantity: 2, unitPriceKES: firstSaleItem.priceKES, kind: firstSaleItem.kind, unitKey: firstSaleItem.unit }]
    : [];
  const firstSaleCalculation = calculateSale({ lines: firstSaleLines, tax: config.sales.tax });
  const receipt = buildReceipt({
    config,
    business: { name, phone: "0722 123 456", location: "Nairobi" },
    sale: {
      receiptNumber: formatReceiptNumber(receiptPrefixFromBusinessName(name), 1048),
      issuedAt: new Date(),
      channel: channels[0],
      cashierName: config.staff.enabled ? SAMPLE_NAMES[3] : undefined,
      customer: config.customers.enabled ? { name: customers[0]?.name ?? "Walk-in", phone: customers[0]?.phone } : { name: "Walk-in" },
      lines: firstSaleCalculation.lines.map((line) => ({
        name: line.name, quantity: line.quantity, unitKey: line.unitKey, unitPriceKES: line.unitPriceKES,
        discountKES: line.lineDiscountKES, taxKES: line.lineTaxKES, totalKES: line.lineTotalKES,
      })),
      subtotalKES: firstSaleCalculation.totals.subtotalKES,
      discountKES: firstSaleCalculation.totals.discountKES,
      taxKES: firstSaleCalculation.totals.taxKES,
      totalKES: firstSaleCalculation.totals.totalKES,
      payments: [{ method: methods[0]?.key ?? "mpesa", amountKES: firstSaleCalculation.totals.totalKES }],
      balanceKES: 0,
      creditBalanceKES: config.credit.enabled ? customers[0]?.balanceKES ?? 0 : 0,
    },
  });

  const modules = buildNavigation(config, basePath).map((item) => ({ key: item.key, label: item.label, href: item.href, icon: item.icon }));

  return {
    isPreview: true,
    businessName: name,
    headline: previewHeadline(config),
    navigation: modules,
    quickActions: deriveQuickActions(config, basePath).map((action) => ({ key: action.key, label: action.label, icon: action.icon })),
    dashboard,
    catalogue,
    customers,
    sales,
    orders,
    credit: customers.filter((customer) => customer.balanceKES > 0).map((customer) => ({
      name: customer.name,
      balanceKES: money(customer.balanceKES),
      status: customer.balanceKES > config.credit.limitKES && config.credit.limitKES > 0 ? "Over limit" : "Within terms",
      dueIn: `${Math.max(1, config.credit.termsDays - 6)} days`,
    })),
    suppliers: config.suppliers.enabled
      ? [
          { name: "Nairobi Suppliers Ltd", balanceKES: money(config.suppliers.credit ? 18400 : 0), terms: config.suppliers.credit ? `${config.suppliers.termsDays} days` : "On delivery" },
          { name: "Kamau Traders", balanceKES: money(config.suppliers.credit ? 6200 : 0), terms: config.suppliers.credit ? `${config.suppliers.termsDays} days` : "On delivery" },
        ]
      : [],
    expenses: config.expenses.enabled
      ? config.expenses.categories.slice(0, 4).map((category, index) => ({
          category: category.replace(/_/g, " "),
          amountKES: money(2000 + index * 1500),
          at: new Date(Date.now() - index * 86_400_000).toISOString(),
        }))
      : [],
    staff: config.staff.enabled
      ? SAMPLE_NAMES.slice(0, Math.min(config.staff.count, 4)).map((person, index) => ({
          name: person,
          role: config.staff.roles[index] ?? "CASHIER",
          salesKES: money(2400 + index * 900),
        }))
      : [],
    inventory: config.inventory.enabled
      ? catalogue.map((item) => ({
          name: item.name,
          unit: item.unit ?? config.inventory.units[0] ?? "piece",
          quantity: item.stock ?? 0,
          status: (item.stock ?? 0) <= 0 ? "Out of stock" : (item.stock ?? 0) < 8 ? "Low" : "In stock",
        }))
      : [],
    // Every report this business is configured for, grouped by the preview UI. Truncating to the
    // first few would show only the generic ones and hide the trade's own reports (§23, §35, §81).
    reports: config.reports.map((key) => {
      const definition = REPORT_LOOKUP[key];
      return { key, label: definition?.label ?? key, blurb: definition?.blurb ?? "", group: definition?.group ?? "Sales", basis: definition?.basis ?? "recorded" };
    }),
    saleFlow: {
      prompt: `What are you selling?`,
      steps: [
        { label: terminology.products, value: firstSaleItem?.name ?? "—" },
        { label: "Quantity", value: "2" },
        { label: terminology.customer, value: config.customers.enabled ? customers[0]?.name ?? "Walk-in" : "Walk-in" },
        { label: "Payment", value: methods[0]?.label ?? "Cash" },
        { label: "Amount", value: money(firstSaleCalculation.totals.totalKES) },
      ],
      paymentMethods: paymentMethodOptions(config).map((method) => ({ key: method.key, label: method.label })),
      totals: {
        subtotalKES: money(firstSaleCalculation.totals.subtotalKES),
        discountKES: money(firstSaleCalculation.totals.discountKES),
        taxKES: money(firstSaleCalculation.totals.taxKES),
        totalKES: money(firstSaleCalculation.totals.totalKES),
        paidKES: money(firstSaleCalculation.totals.totalKES),
        balanceKES: money(0),
      },
    },
    receipt,
    receiptText: receiptToText(receipt),
    emptyStates: ["products", "customers", "inventory", "suppliers", "expenses"]
      .filter((module) => modules.some((item) => item.key === module))
      .map((module) => {
        const state = emptyStateFor(config, module as never, basePath);
        return { module, title: state.title, body: state.body, action: state.action.label };
      }),
    notice: `Preview only — sample data for ${name}. Orders would arrive from ${orderChannelWords(config)}. Nothing here is saved.`,
  };
}

import { REPORT_CATALOGUE } from "./presentation";
const REPORT_LOOKUP: Record<string, (typeof REPORT_CATALOGUE)[number]> = Object.fromEntries(
  REPORT_CATALOGUE.map((report) => [report.key, report]),
);

/** One line that says what this POS was configured for (§21, §65). */
export function previewHeadline(config: PosConfiguration): string {
  const terminology = resolveTerminology(config);
  const bits: string[] = [];
  if (config.sales.products) bits.push(terminology.products);
  if (config.sales.services) bits.push(terminology.services);
  const payments = paymentMethodOptions(config).map((method) => method.label);
  return `${bits.join(" + ") || "Counter sales"} · ${payments.slice(0, 3).join(", ")}${config.credit.enabled ? ", credit" : ""}`;
}
