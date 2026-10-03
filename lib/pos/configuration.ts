/**
 * Configuration engine (§7, §20, §22, §42, §47, §48, §49, §65)
 *
 * The questionnaire produces a persistent Business Operating Profile. That profile is the
 * authoritative artefact: capabilities, navigation, terminology, workflows, permissions,
 * reports and transaction rules are all read from it. Nothing downstream asks "what kind of
 * business is this?" — they ask "what does the configuration enable?" (§52).
 */

import { getBusinessType, readBusinessDescription, resolveBusinessType } from "./businessTypes";
import { CAPABILITY_LIBRARY, isCapabilityKey, normalizeCapabilities } from "./capabilities";
import { deriveDashboardCards, deriveQuickActions, deriveReports, availableModules } from "./presentation";
import { PERMISSIONS, resolveRoles } from "./permissions";
import {
  answeredBool, answeredList, answeredNumber, answeredText, creditEnabled,
  bigUnit, configurationReadiness, typeProfile,
} from "./questionnaire";
import { TERMINOLOGY_PRESETS, resolveTerminology } from "./terminology";
import { DEFAULT_CONVERSIONS, isUnitKey, sanitizeConversions } from "./units";
import { getWorkflow, initialState, resolveStates, workflowsForBusinessType } from "./workflow";
import {
  POS_CONFIG_SCHEMA_VERSION,
  type CapabilityKey, type ChannelKey, type CreditFrequency, type DashboardCardKey,
  type PosConfiguration, type PosModuleKey, type PosRoleConfig, type QuestionnaireAnswers,
  type ReportKey, type TerminologyEntityKey, type UnitConversion,
} from "./types";

export const POS_PLAN_KEY = "BUSINESS_POS";
export const POS_PLAN_NAME = "JATA AFTERCALL — Business POS";
export const POS_PLAN_PRICE_KES = 499;
export const POS_PLAN_DURATION_DAYS = 30;

const PAYMENT_METHOD_KEYS = ["cash", "mpesa", "bank", "card", "credit", "other"] as const;
const CHANNEL_KEYS: ChannelKey[] = ["walk_in", "phone", "whatsapp", "business_page", "online", "staff", "delivery", "other"];

// ── Safe baseline (§47) ───────────────────────────────────────────────────────

/**
 * The capabilities the universal fallback POS is made of (§47). `finalize` guarantees these for
 * any configuration that arrives with no capabilities of its own, so the screens a bare business
 * sees are: New Sale, Products/Services, Customers, Payments, Receipts, Sales History, Basic
 * Reports and Settings. Order matters — `normalizeCapabilities` prunes a capability whose
 * prerequisites are missing, so `customer_profiles` precedes `customer_history`.
 */
export const BASELINE_CAPABILITIES: CapabilityKey[] = [
  "pos_sale",
  "receipt",
  "cash",
  "mpesa",
  "catalogue",
  "customer_profiles",
  "customer_history",
  "daily_sales",
  "payment_breakdown",
];

/**
 * The minimum universal POS. Every configuration contains this, so configuration can never
 * fail into an unusable product: New Sale, Products/Services, Customers, Payments, Receipts,
 * Sales History, Basic Reports, Settings.
 */
export function baselineConfiguration(): PosConfiguration {
  const config: PosConfiguration = {
    schemaVersion: POS_CONFIG_SCHEMA_VERSION,
    business: { typeKey: "other", typeLabel: "Something else", otherDescription: "", name: "", branchName: "" },
    sales: {
      products: true, services: false, subscriptions: false, bookings: false, projects: false,
      contracts: false, customOrders: false, quotations: false, invoices: false, returns: false,
      refunds: false, discounts: false, promotions: false, deposits: false, partialPayments: false,
      splitPayments: false, customerPricing: false, wholesalePricing: false, retailPricing: true,
      bundles: false, tax: { enabled: false, ratePercent: 0, label: "Tax", inclusive: false },
    },
    payments: { cash: true, mpesa: true, bank: false, card: false, credit: false, other: false, otherLabels: [] },
    credit: {
      enabled: false, frequency: "never", limitKES: 0, termsDays: 30, staffCanApprove: false,
      depositsRequired: false, highlightOverdue: true, statements: false, qualifyingNote: "",
    },
    inventory: {
      enabled: false, units: ["piece"], conversions: [], variants: false, barcode: false,
      expiry: false, batches: false, serials: false, locations: false, transfers: false,
      manufacturing: false, assembly: false, valuation: false, lowStockAlerts: false,
      stockCounts: false, reorderLevels: false,
    },
    customers: {
      enabled: true,
      fields: { name: true, phone: true, email: false, location: false, customerNumber: false, notes: false },
      repeat: false, accounts: false, loyalty: false, segments: false, history: true,
    },
    suppliers: {
      enabled: false, credit: false, termsDays: 30, purchaseOrders: false, partialReceiving: false,
      reminders: false, statements: false, paymentMethods: ["cash", "mpesa"],
    },
    staff: { enabled: false, count: 1, roles: [], attribution: false, commissions: false, shifts: false, approvals: false },
    branches: { enabled: false, count: 1, perBranchStock: false },
    expenses: { enabled: false, categories: [] },
    delivery: { enabled: false, pickup: false, zones: false, feeKES: 0 },
    orders: { enabled: false, channels: ["walk_in"], workflowKey: "generic", states: [] },
    receipt: {
      businessName: "", showLogo: true, showContact: true, showCashier: true, showTaxBreakdown: false,
      showBalance: true, showCreditBalance: true, footerMessage: "Thank you — karibu tena.",
    },
    terminology: {},
    capabilities: [],
    navigation: [],
    dashboard: [],
    reports: [],
    roles: [],
    industry: { key: "other", modules: [] },
  };
  return finalize(config);
}

// ── Build from answers (§20) ──────────────────────────────────────────────────

export type BuildContext = {
  businessName?: string;
  branchName?: string;
  /** Legacy JATA AFTERCALL category, used when the questionnaire has not run yet (§80). */
  legacyCategory?: string;
};

export function buildConfiguration(answers: QuestionnaireAnswers, context: BuildContext = {}): PosConfiguration {
  const safe = answers && typeof answers === "object" ? answers : {};
  const profile = typeProfile(safe);
  const description = answeredText(safe, "business_other");
  const described = description ? readBusinessDescription(description) : { capabilities: [], answers: {}, matched: [] };

  const sellsList = answeredList(safe, "sells");
  // An explicit answer beats the trade's default (§22, §41): a salon that says "services only"
  // gets a services POS, and is not then blocked at the till by stock it never said it kept.
  const answeredSells = sellsList.length > 0;
  const sellsProducts = answeredSells ? sellsList.includes("products") : profile.capabilities.includes("product_sales");
  const sellsServices = answeredSells ? sellsList.includes("services") : profile.capabilities.includes("service_sales");
  const paymentMethods = answeredList(safe, "payment_methods");
  const keepsStock = answeredBool(safe, "keeps_stock") ?? (sellsProducts && profile.capabilities.includes("stock_levels"));
  const keepsCustomers = answeredBool(safe, "keeps_customers") ?? true;
  const hasStaff = answeredBool(safe, "has_staff") ?? false;
  const multiBranch = answeredBool(safe, "multi_branch") ?? false;
  const tracksExpenses = answeredBool(safe, "tracks_expenses") ?? profile.capabilities.includes("expenses");
  const hasSuppliers = answeredBool(safe, "has_suppliers") ?? (keepsStock && profile.capabilities.includes("suppliers"));
  const credit = creditEnabled(safe);
  const wantsOrders = answeredBool(safe, "orders") ?? profile.capabilities.includes("orders");
  const delivery = answeredBool(safe, "delivery") ?? profile.capabilities.includes("delivery");
  const pickup = answeredBool(safe, "pickup") ?? profile.capabilities.includes("pickup");
  const appointments = answeredBool(safe, "appointments") ?? profile.capabilities.includes("appointments");
  const manufacturing = answeredBool(safe, "manufacturing") ?? false;

  const units = sanitizeUnits(answeredList(safe, "units"), profile.units);
  const conversions = buildConversions(safe, units);

  const config: PosConfiguration = baselineConfiguration();
  config.business = {
    typeKey: profile.key,
    typeLabel: answeredText(safe, "business_custom") || profile.label,
    otherDescription: description.slice(0, 500),
    name: (context.businessName ?? "").slice(0, 120),
    branchName: (context.branchName ?? "").slice(0, 120),
  };

  config.sales = {
    products: sellsProducts,
    services: sellsServices,
    subscriptions: sellsList.includes("subscriptions") || answeredBool(safe, "recurring") === true,
    bookings: sellsList.includes("bookings") || appointments,
    projects: sellsList.includes("projects") || answeredBool(safe, "projects") === true,
    contracts: sellsList.includes("contracts"),
    customOrders: sellsList.includes("custom_orders") || profile.capabilities.includes("custom_orders"),
    quotations: answeredBool(safe, "quotations") ?? profile.capabilities.includes("quotation"),
    invoices: answeredBool(safe, "quotations") === true || credit || profile.capabilities.includes("invoice"),
    returns: keepsStock,
    refunds: keepsStock || profile.capabilities.includes("refunds"),
    discounts: answeredBool(safe, "discounts") ?? profile.capabilities.includes("discounts"),
    promotions: (answeredBool(safe, "discounts") ?? false) && profile.optionalCapabilities.includes("promotions"),
    deposits: answeredBool(safe, "deposits") ?? profile.capabilities.includes("deposits"),
    partialPayments: answeredBool(safe, "deposits") === true || credit || profile.capabilities.includes("partial_payments"),
    splitPayments: answeredBool(safe, "split_payments") ?? paymentMethods.length > 1,
    customerPricing: answeredBool(safe, "tiers") === true || profile.capabilities.includes("customer_pricing"),
    wholesalePricing: answeredBool(safe, "wholesale_pricing") ?? profile.capabilities.includes("wholesale_pricing"),
    retailPricing: sellsProducts,
    bundles: answeredBool(safe, "packages") === true || profile.capabilities.includes("service_packages") || profile.capabilities.includes("bundle_sales"),
    tax: {
      enabled: answeredBool(safe, "tax") === true,
      ratePercent: clamp(answeredNumber(safe, "tax_rate") ?? 16, 0, 100),
      label: "Tax",
      inclusive: false,
    },
  };

  config.payments = {
    cash: paymentMethods.includes("cash") || paymentMethods.length === 0,
    mpesa: paymentMethods.includes("mpesa") || paymentMethods.length === 0,
    bank: paymentMethods.includes("bank"),
    card: paymentMethods.includes("card"),
    credit: paymentMethods.includes("credit") || credit,
    other: paymentMethods.includes("other"),
    otherLabels: answeredText(safe, "payment_other_labels")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
      .slice(0, 6),
  };

  const frequency = (answeredText(safe, "credit_frequency") || (credit ? "sometimes" : "never")) as CreditFrequency;
  config.credit = {
    enabled: credit,
    frequency: (["never", "sometimes", "frequently", "most"] as CreditFrequency[]).includes(frequency) ? frequency : "sometimes",
    limitKES: Math.max(0, Math.round(answeredNumber(safe, "credit_limit") ?? 0)),
    termsDays: clamp(Math.round(answeredNumber(safe, "credit_terms_days") ?? 30), 1, 365),
    staffCanApprove: answeredBool(safe, "credit_staff_approve") ?? false,
    depositsRequired: answeredBool(safe, "credit_deposits") ?? false,
    highlightOverdue: credit,
    statements: credit && keepsCustomers,
    qualifyingNote: answeredText(safe, "credit_qualifies").slice(0, 240),
  };

  config.inventory = {
    enabled: keepsStock,
    units,
    conversions,
    variants: answeredBool(safe, "variants") ?? profile.capabilities.includes("variants"),
    barcode: answeredBool(safe, "barcode") ?? profile.capabilities.includes("barcodes"),
    expiry: answeredBool(safe, "expiry") ?? profile.capabilities.includes("expiry_tracking"),
    batches: answeredBool(safe, "batches") ?? profile.capabilities.includes("batch_tracking"),
    serials: answeredBool(safe, "serials") ?? profile.capabilities.includes("serial_numbers"),
    locations: multiBranch && (answeredBool(safe, "stock_by_branch") ?? true),
    transfers: multiBranch && keepsStock,
    manufacturing,
    assembly: manufacturing || answeredBool(safe, "bom") === true,
    valuation: keepsStock && sellsProducts,
    lowStockAlerts: keepsStock,
    stockCounts: answeredBool(safe, "stock_counts") ?? keepsStock,
    reorderLevels: keepsStock,
  };

  const customerFields = answeredList(safe, "customer_fields");
  config.customers = {
    enabled: keepsCustomers,
    fields: {
      name: customerFields.includes("name") || customerFields.length === 0,
      phone: customerFields.includes("phone") || customerFields.length === 0,
      email: customerFields.includes("email"),
      location: customerFields.includes("location"),
      customerNumber: customerFields.includes("number"),
      notes: customerFields.includes("notes") || profile.capabilities.includes("customer_notes"),
    },
    repeat: answeredBool(safe, "repeat_customers") ?? profile.capabilities.includes("customer_history"),
    accounts: credit || profile.capabilities.includes("customer_accounts"),
    loyalty: answeredBool(safe, "loyalty") ?? false,
    segments: answeredBool(safe, "tiers") === true || profile.capabilities.includes("customer_segments"),
    history: keepsCustomers,
  };

  const supplierMethods = answeredList(safe, "supplier_payment_methods");
  config.suppliers = {
    enabled: hasSuppliers,
    credit: answeredBool(safe, "supplier_credit") ?? profile.capabilities.includes("supplier_credit"),
    termsDays: clamp(Math.round(answeredNumber(safe, "supplier_terms_days") ?? 30), 1, 365),
    purchaseOrders: answeredBool(safe, "purchase_orders") ?? profile.capabilities.includes("purchase_orders"),
    partialReceiving: answeredBool(safe, "partial_receiving") ?? profile.capabilities.includes("partial_receiving"),
    reminders: answeredBool(safe, "supplier_credit") === true || answeredBool(safe, "purchase_orders") === true,
    statements: answeredBool(safe, "supplier_credit") === true,
    paymentMethods: sanitizeSupplierMethods(supplierMethods, config.payments),
  };

  const staffCount = clamp(Math.round(answeredNumber(safe, "staff_count") ?? (hasStaff ? 2 : 1)), 1, 500);
  config.staff = {
    enabled: hasStaff,
    count: staffCount,
    roles: answeredList(safe, "staff_roles").filter((role) => ROLE_KEYS.has(role)),
    attribution: answeredBool(safe, "sales_attribution") ?? hasStaff,
    commissions: answeredBool(safe, "commissions") ?? false,
    shifts: hasStaff && staffCount > 4,
    approvals: answeredBool(safe, "approvals") ?? false,
  };

  config.branches = {
    enabled: multiBranch,
    count: multiBranch ? clamp(Math.round(answeredNumber(safe, "branch_count") ?? 2), 2, 200) : 1,
    perBranchStock: multiBranch && keepsStock && (answeredBool(safe, "stock_by_branch") ?? true),
  };

  config.expenses = {
    enabled: tracksExpenses,
    categories: sanitizeExpenseCategories(answeredList(safe, "expense_categories")),
  };

  config.delivery = {
    enabled: delivery,
    pickup,
    zones: delivery && (answeredBool(safe, "routes") === true || profile.capabilities.includes("routes")),
    feeKES: 0,
  };

  const channels = sanitizeChannels(answeredList(safe, "order_channels"), { wantsOrders, delivery, pickup });
  const workflowKey = resolveWorkflowKey(safe, profile.key, profile.capabilities);
  config.orders = {
    enabled: wantsOrders || delivery || pickup || Boolean(channels.length > 1) || profile.capabilities.includes("orders"),
    channels,
    workflowKey,
    states: resolveStates({ orders: { enabled: true, channels, workflowKey, states: [] } }).map((state) => state.key),
  };

  config.receipt = {
    ...config.receipt,
    businessName: context.businessName ?? "",
    showTaxBreakdown: config.sales.tax.enabled,
    showCreditBalance: config.credit.enabled,
  };

  // Capabilities: the trade's set, adjusted by the owner's answers (§8, §18, §52).
  const capabilities = new Set<CapabilityKey>(profile.capabilities);
  for (const key of described.capabilities) capabilities.add(key);
  applyAnswerCapabilities(capabilities, config, safe);
  config.capabilities = normalizeCapabilities(capabilities);

  config.industry = {
    key: profile.key,
    modules: config.capabilities.filter((key) => CAPABILITY_LIBRARY.find((capability) => capability.key === key)?.industryOnly),
  };
  config.navigation = deriveNavigation(config, profile.navigation);
  // The trade's own cards are the starting point; `deriveDashboardCards` then drops any the
  // capabilities do not support and adds the baseline every business needs (§34). Seeding from the
  // profile matters: without it every business would see the same four generic cards.
  config.dashboard = deriveDashboardCards({ ...config, dashboard: profile.dashboard });
  config.reports = deriveReports(config);
  config.roles = resolveRoles(config);
  config.terminology = {};

  return finalize(config);
}

const ROLE_KEYS = new Set([
  "MANAGER", "CASHIER", "SALESPERSON", "INVENTORY", "ACCOUNTANT",
  "TECHNICIAN", "WAITER", "STYLIST", "DELIVERY",
]);

function applyAnswerCapabilities(capabilities: Set<CapabilityKey>, config: PosConfiguration, answers: QuestionnaireAnswers): void {
  const add = (...keys: CapabilityKey[]) => keys.forEach((key) => capabilities.add(key));
  const remove = (...keys: CapabilityKey[]) => keys.forEach((key) => capabilities.delete(key));

  if (!config.sales.products) remove("product_sales", "catalogue", "products", "menu", "produce");
  if (!config.sales.services) remove("service_sales", "services", "appointments", "stylists");
  if (!config.inventory.enabled) {
    remove("stock_levels", "stock_adjustments", "stock_counts", "stock_transfers", "low_stock_alerts",
      "reorder_levels", "inventory_valuation", "inventory_value", "slow_movers", "expiry_tracking",
      "batch_tracking", "serial_numbers", "variants", "sizes_colours", "barcodes", "skus",
      "manufacturing", "assembly", "raw_materials", "bill_of_materials", "finished_goods",
      "work_orders", "production_costs", "ingredients", "recipes", "wastage", "multi_location");
  }
  if (!config.customers.enabled) remove("customer_profiles", "customer_history", "customer_notes", "loyalty", "customer_segments", "customer_activity");
  if (!config.credit.enabled) remove("customer_credit", "credit_limits", "receivables", "statements", "outstanding_credit", "customer_accounts");
  if (!config.suppliers.enabled) remove("suppliers", "supplier_accounts", "supplier_credit", "supplier_balances", "payables", "supplier_debt", "purchases", "purchase_orders", "supplier_payments", "procurement_history");
  if (!config.suppliers.purchaseOrders) remove("purchase_orders", "partial_receiving");
  if (!config.suppliers.credit) remove("supplier_credit", "payables", "supplier_debt", "supplier_statements");
  if (!config.staff.enabled) remove("employee_profiles", "roles", "permissions", "shifts", "sales_attribution", "commissions", "staff_performance", "stylists", "technicians", "instructors", "sales_reps");
  if (!config.staff.attribution) remove("sales_attribution", "commissions", "staff_performance");
  if (!config.staff.commissions) remove("commissions");
  if (!config.staff.approvals) remove("approval_workflows");
  if (!config.branches.enabled) remove("multi_location", "stock_transfers", "warehouses");
  if (!config.expenses.enabled) remove("expenses", "expenses_report");
  if (!config.delivery.enabled) remove("delivery", "routes", "pending_deliveries");
  if (!config.delivery.pickup) remove("pickup");
  if (!config.orders.enabled) remove("orders", "walkin_orders", "phone_orders", "whatsapp_orders", "business_page_orders", "online_orders", "order_status", "fulfilment", "cancellation", "channel_attribution", "kitchen_orders", "garments", "production_status");
  if (!config.sales.discounts) remove("discounts", "promotions");
  if (!config.sales.deposits) remove("deposits", "payment_schedules");
  if (!config.sales.quotations) remove("quotation", "estimates");
  if (!config.sales.tax.enabled) remove("tax");
  if (!config.sales.projects) remove("projects", "retainers", "events");
  if (!config.sales.subscriptions) remove("subscriptions", "recurring_billing");

  // Answers that switch things on.
  if (config.sales.products) add("product_sales", "catalogue");
  if (config.sales.services) add("service_sales");
  if (config.inventory.enabled) add("products", "stock_levels", "stock_adjustments", "low_stock_alerts", "reorder_levels", "units_of_measure");
  if (config.inventory.variants) add("variants", "skus");
  if (config.inventory.barcode) add("barcodes", "skus");
  if (config.inventory.expiry) add("expiry_tracking");
  if (config.inventory.batches) add("batch_tracking");
  if (config.inventory.serials) add("serial_numbers");
  if (config.inventory.stockCounts) add("stock_counts");
  if (config.inventory.valuation) add("inventory_valuation", "inventory_value");
  if (config.inventory.conversions.length) add("unit_conversions");
  if (config.inventory.locations) add("multi_location");
  if (config.inventory.transfers) add("stock_transfers");
  if (config.inventory.manufacturing) add("manufacturing", "raw_materials", "finished_goods");
  if (answeredBool(answers, "bom") === true) add("bill_of_materials");
  if (answeredBool(answers, "work_orders") === true) add("work_orders");
  if (answeredBool(answers, "production_costs") === true) add("production_costs");
  if (answeredBool(answers, "wastage") === true) add("wastage");
  if (config.customers.enabled) add("customer_profiles", "customer_history");
  if (config.customers.loyalty) add("loyalty");
  if (config.customers.segments) add("customer_segments");
  if (config.credit.enabled) add("customer_accounts", "customer_credit", "credit_limits", "receivables", "statements", "outstanding_credit", "credit_payments");
  if (config.suppliers.enabled) add("suppliers", "supplier_accounts", "purchases", "supplier_payments");
  if (config.suppliers.credit) add("supplier_credit", "payables", "supplier_debt", "supplier_balances");
  if (config.suppliers.purchaseOrders) add("purchase_orders");
  if (config.suppliers.partialReceiving) add("partial_receiving");
  if (config.suppliers.statements) add("supplier_statements");
  if (config.staff.enabled) add("employee_profiles", "roles", "permissions");
  if (config.staff.attribution) add("sales_attribution", "staff_performance");
  if (config.staff.commissions) add("commissions");
  if (config.staff.shifts) add("shifts");
  if (config.staff.approvals) add("approval_workflows");
  if (config.expenses.enabled) add("expenses", "expenses_report");
  if (config.orders.enabled) add("orders", "order_status", "fulfilment", "cancellation", "channel_attribution");
  if (config.delivery.enabled) add("delivery");
  if (config.delivery.pickup) add("pickup");
  if (config.sales.discounts) add("discounts");
  if (config.sales.promotions) add("promotions");
  if (config.sales.deposits) add("deposits");
  if (config.sales.partialPayments) add("partial_payments");
  if (config.sales.splitPayments) add("split_payments");
  if (config.sales.quotations) add("quotation");
  if (config.sales.invoices) add("invoice");
  if (config.sales.returns) add("returns");
  if (config.sales.refunds) add("refunds");
  if (config.sales.tax.enabled) add("tax");
  if (config.sales.wholesalePricing) add("wholesale_pricing", "bulk_pricing");
  if (config.sales.customerPricing) add("customer_pricing", "customer_tiers");
  if (config.sales.bundles) add("bundle_sales", "service_packages");
  if (config.sales.projects) add("projects");
  if (config.sales.subscriptions) add("subscriptions");
  if (config.sales.bookings) add("bookings", "appointments");
  if (config.sales.customOrders) add("custom_orders");
  for (const method of PAYMENT_METHOD_KEYS) {
    if (config.payments[method]) add(method === "credit" ? "credit_payments" : method);
  }

  // Trade modules the owner confirmed (§18).
  const tradeToggles: Record<string, CapabilityKey[]> = {
    restaurant_tables: ["tables"],
    restaurant_kitchen: ["kitchen_orders"],
    menu_modifiers: ["modifiers"],
    recipes: ["recipes", "ingredients"],
    appointments: ["appointments"],
    stylists: ["stylists"],
    packages: ["service_packages", "event_packages"],
    vehicles: ["vehicles"],
    job_cards: ["job_cards", "labour"],
    estimates: ["estimates", "quotation"],
    technicians: ["technicians"],
    parts: ["parts_consumption"],
    harvests: ["harvests", "produce"],
    seasons: ["seasonal_records"],
    buyers: ["buyers"],
    tiers: ["customer_tiers", "customer_pricing"],
    minimums: ["minimum_quantities"],
    routes: ["routes"],
    warehouses: ["warehouses", "multi_location"],
    bom: ["bill_of_materials"],
    work_orders: ["work_orders"],
    production_costs: ["production_costs"],
    projects: ["projects"],
    retainers: ["retainers"],
    time_tracking: ["time_tracking"],
    recurring: ["recurring_billing", "subscriptions"],
    properties: ["properties"],
    tenants: ["tenants"],
    landlords: ["landlords"],
    rent: ["rent"],
    payment_plans: ["payment_plans", "partial_payments"],
    courses: ["courses"],
    fees: ["fees"],
    instructors: ["instructors"],
    events: ["events"],
    payment_schedules: ["payment_schedules", "deposits"],
    garments: ["garments"],
    service_types: ["service_types"],
    artwork: ["artwork"],
    production_status: ["production_status"],
    wholesale_pricing: ["wholesale_pricing"],
  };
  for (const [questionId, keys] of Object.entries(tradeToggles)) {
    const value = answeredBool(answers, questionId);
    if (value === true) add(...keys);
    if (value === false) remove(...keys);
  }

  // Reporting follows from what exists (§35) — never advertise a report with no data behind it.
  add("daily_sales", "weekly_sales", "monthly_sales", "payment_breakdown", "financial_summaries", "income");
  if (config.customers.history) add("customer_activity");
  if (config.inventory.enabled) add("best_sellers");
  if (config.sales.refunds) add("refunds_report");
}

function deriveNavigation(config: PosConfiguration, preferred: PosModuleKey[]): PosModuleKey[] {
  const available = new Set(availableModules(config));
  const ordered = preferred.filter((key) => available.has(key));
  for (const key of available) if (!ordered.includes(key)) ordered.push(key);
  // `dashboard`, `reports` and `settings` always exist (§47).
  for (const key of ["dashboard", "reports", "settings"] as PosModuleKey[]) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

function resolveWorkflowKey(answers: QuestionnaireAnswers, typeKey: string, capabilities: CapabilityKey[]): string {
  const chosen = answeredText(answers, "order_workflow");
  const offered = workflowsForBusinessType(typeKey, capabilities);
  if (chosen && offered.some((workflow) => workflow.key === chosen)) return chosen;
  return getWorkflow(offered[0]?.key ?? "generic").key;
}

function sanitizeUnits(chosen: string[], fallback: string[]): string[] {
  const clean = chosen.filter((unit) => isUnitKey(unit) || unit.startsWith("custom:"));
  const list = clean.length ? clean : fallback.filter((unit) => isUnitKey(unit));
  return [...new Set(list.length ? list : ["piece"])].slice(0, 12);
}

function buildConversions(answers: QuestionnaireAnswers, units: string[]): UnitConversion[] {
  const factor = answeredNumber(answers, "unit_conversion_factor");
  const big = bigUnit(answers);
  const conversions: UnitConversion[] = [];
  if (factor && factor > 1 && big && units.includes("piece")) {
    conversions.push({ fromUnit: big, toUnit: "piece", factor: Math.round(factor) });
  }
  return sanitizeConversions(conversions);
}

function sanitizeSupplierMethods(chosen: string[], payments: PosConfiguration["payments"]): PosConfiguration["suppliers"]["paymentMethods"] {
  const methods = new Set<PosConfiguration["suppliers"]["paymentMethods"][number]>();
  for (const entry of chosen) {
    if (entry === "mixed") {
      if (payments.cash) methods.add("cash");
      if (payments.mpesa) methods.add("mpesa");
      if (payments.bank) methods.add("bank");
      continue;
    }
    if ((PAYMENT_METHOD_KEYS as readonly string[]).includes(entry) && entry !== "other") {
      methods.add(entry as never);
    }
  }
  if (!methods.size) {
    if (payments.cash) methods.add("cash");
    if (payments.mpesa) methods.add("mpesa");
  }
  return [...methods];
}

function sanitizeChannels(chosen: string[], flags: { wantsOrders: boolean; delivery: boolean; pickup: boolean }): ChannelKey[] {
  const channels = new Set<ChannelKey>(["walk_in"]);
  for (const entry of chosen) {
    if ((CHANNEL_KEYS as string[]).includes(entry)) channels.add(entry as ChannelKey);
  }
  if (flags.delivery) channels.add("delivery");
  if (flags.wantsOrders) channels.add("staff");
  return [...channels];
}

function sanitizeExpenseCategories(chosen: string[]): string[] {
  const clean = chosen
    .map((entry) => entry.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40))
    .filter(Boolean);
  return [...new Set(clean)].slice(0, 24);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Last step of every build: normalize capabilities and re-derive the interface from them, so
 * a stored configuration and a freshly built one always agree (§20, §48).
 */
export function finalize(config: PosConfiguration): PosConfiguration {
  const normalized = { ...config };
  normalized.schemaVersion = POS_CONFIG_SCHEMA_VERSION;
  normalized.capabilities = normalizeCapabilities(normalized.capabilities ?? []);
  if (!normalized.capabilities.includes("pos_sale")) {
    // The universal baseline must survive any edit (§47): a business that has not answered the
    // questionnaire yet — or whose stored profile could not be parsed — still gets a till, a
    // catalogue, customers, payments, receipts, sales history, basic reports and settings. This
    // floor only fires when a configuration has no capabilities of its own, so it never adds a
    // screen to a business that was configured without one (§23).
    normalized.capabilities = normalizeCapabilities([...normalized.capabilities, ...BASELINE_CAPABILITIES]);
  }
  normalized.navigation = deriveNavigation(normalized, normalized.navigation ?? []);
  normalized.dashboard = deriveDashboardCards(normalized);
  normalized.reports = deriveReports(normalized);
  normalized.roles = resolveRoles(normalized);
  normalized.orders = {
    ...normalized.orders,
    workflowKey: getWorkflow(normalized.orders?.workflowKey).key,
    states: resolveStates(normalized).map((state) => state.key),
  };
  return normalized;
}

// ── Reading a stored configuration (§20, §48) ─────────────────────────────────

/**
 * Defensive parse of persisted JSON. Unknown capability keys are dropped, missing sections
 * fall back to the safe baseline, and the result is always a usable configuration (§47).
 */
export function normalizeConfiguration(raw: unknown): PosConfiguration {
  const base = baselineConfiguration();
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Record<string, any>;
  const merged: PosConfiguration = {
    ...base,
    ...pickObject(input, base),
    business: { ...base.business, ...(isObject(input.business) ? sanitizeStrings(input.business, ["typeKey", "typeLabel", "otherDescription", "name", "branchName"]) : {}) },
    sales: { ...base.sales, ...(isObject(input.sales) ? input.sales : {}), tax: { ...base.sales.tax, ...(isObject(input.sales?.tax) ? input.sales.tax : {}) } },
    payments: { ...base.payments, ...(isObject(input.payments) ? input.payments : {}), otherLabels: stringArray(input.payments?.otherLabels).slice(0, 6) },
    credit: { ...base.credit, ...(isObject(input.credit) ? input.credit : {}) },
    inventory: {
      ...base.inventory,
      ...(isObject(input.inventory) ? input.inventory : {}),
      units: sanitizeUnits(stringArray(input.inventory?.units), base.inventory.units),
      conversions: sanitizeConversions(input.inventory?.conversions),
    },
    customers: {
      ...base.customers,
      ...(isObject(input.customers) ? input.customers : {}),
      fields: { ...base.customers.fields, ...(isObject(input.customers?.fields) ? input.customers.fields : {}) },
    },
    suppliers: {
      ...base.suppliers,
      ...(isObject(input.suppliers) ? input.suppliers : {}),
      paymentMethods: sanitizeSupplierMethods(stringArray(input.suppliers?.paymentMethods), base.payments),
    },
    staff: { ...base.staff, ...(isObject(input.staff) ? input.staff : {}), roles: stringArray(input.staff?.roles).filter((role) => ROLE_KEYS.has(role)) },
    branches: { ...base.branches, ...(isObject(input.branches) ? input.branches : {}) },
    expenses: { ...base.expenses, ...(isObject(input.expenses) ? input.expenses : {}), categories: sanitizeExpenseCategories(stringArray(input.expenses?.categories)) },
    delivery: { ...base.delivery, ...(isObject(input.delivery) ? input.delivery : {}) },
    orders: {
      ...base.orders,
      ...(isObject(input.orders) ? input.orders : {}),
      channels: sanitizeChannels(stringArray(input.orders?.channels), { wantsOrders: true, delivery: false, pickup: false }),
    },
    receipt: { ...base.receipt, ...(isObject(input.receipt) ? input.receipt : {}) },
    terminology: sanitizeTerminology(input.terminology),
    capabilities: stringArray(input.capabilities).filter(isCapabilityKey),
    navigation: stringArray(input.navigation) as PosModuleKey[],
    dashboard: stringArray(input.dashboard) as DashboardCardKey[],
    reports: stringArray(input.reports) as ReportKey[],
    roles: sanitizeRoles(input.roles),
    industry: {
      key: typeof input.industry?.key === "string" ? input.industry.key.slice(0, 40) : base.industry.key,
      modules: stringArray(input.industry?.modules).filter(isCapabilityKey),
    },
  };
  return finalize(merged);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickObject(input: Record<string, any>, base: PosConfiguration): Partial<PosConfiguration> {
  return { schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : base.schemaVersion };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function sanitizeStrings(input: Record<string, unknown>, keys: string[]): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const key of keys) {
    if (typeof input[key] === "string") clean[key] = (input[key] as string).slice(0, 240);
  }
  return clean;
}

function sanitizeTerminology(input: unknown): Partial<Record<TerminologyEntityKey, string>> {
  const clean: Partial<Record<TerminologyEntityKey, string>> = {};
  if (!isObject(input)) return clean;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, 40);
    if (!trimmed) continue;
    const known = resolveTerminology(null);
    if (key in known) clean[key as TerminologyEntityKey] = trimmed;
  }
  return clean;
}

function sanitizeRoles(input: unknown): PosRoleConfig[] {
  if (!Array.isArray(input)) return [];
  const clean: PosRoleConfig[] = [];
  for (const entry of input) {
    if (!isObject(entry)) continue;
    const key = typeof entry.key === "string" ? entry.key.trim().slice(0, 40) : "";
    if (!key) continue;
    clean.push({
      key,
      name: typeof entry.name === "string" ? entry.name.trim().slice(0, 60) : key,
      permissions: stringArray(entry.permissions).filter((permission) => PERMISSION_KEYS.has(permission)),
      builtIn: entry.builtIn === true,
    });
  }
  return clean.slice(0, 24);
}

const PERMISSION_KEYS = new Set<string>(PERMISSIONS.map((permission) => permission.key));

// ── Validation (§42, §56) ─────────────────────────────────────────────────────

export type ConfigurationIssue = { code: string; message: string; severity: "error" | "warning" };

export function validateConfiguration(config: PosConfiguration | null | undefined): { ok: boolean; issues: ConfigurationIssue[] } {
  const issues: ConfigurationIssue[] = [];
  if (!config) return { ok: false, issues: [{ code: "MISSING", message: "There is no configuration for this business yet.", severity: "error" }] };

  if (!config.sales.products && !config.sales.services && !config.sales.projects && !config.sales.subscriptions) {
    issues.push({ code: "NOTHING_TO_SELL", message: "Choose at least one thing you sell — products, services, projects or subscriptions.", severity: "error" });
  }
  const paymentMethods = enabledPaymentMethods(config);
  if (!paymentMethods.length) {
    issues.push({ code: "NO_PAYMENT_METHOD", message: "Choose at least one way customers pay you.", severity: "error" });
  }
  if (config.credit.enabled && !paymentMethods.includes("credit")) {
    issues.push({ code: "CREDIT_METHOD_MISSING", message: "Credit is on but is not listed as a payment method.", severity: "warning" });
  }
  if (config.credit.enabled && config.credit.limitKES <= 0) {
    issues.push({ code: "CREDIT_LIMIT_MISSING", message: "Set a credit limit, even a small one, so staff know where the line is.", severity: "warning" });
  }
  if (config.inventory.enabled && config.inventory.units.length === 0) {
    issues.push({ code: "NO_UNITS", message: "Choose how you measure what you sell.", severity: "error" });
  }
  if (config.suppliers.enabled && config.suppliers.credit && config.suppliers.termsDays <= 0) {
    issues.push({ code: "SUPPLIER_TERMS_MISSING", message: "How many days do your suppliers give you to pay?", severity: "warning" });
  }
  if (config.staff.enabled && config.staff.roles.length === 0) {
    issues.push({ code: "NO_ROLES", message: "Choose what your staff do so each person gets the right permissions.", severity: "warning" });
  }
  if (config.branches.enabled && config.branches.count < 2) {
    issues.push({ code: "BRANCH_COUNT", message: "How many locations do you operate?", severity: "warning" });
  }
  if (config.business.typeKey === "other" && !config.business.otherDescription.trim()) {
    issues.push({ code: "OTHER_DESCRIPTION", message: "Tell us briefly what your business does.", severity: "error" });
  }
  if (!config.capabilities.includes("pos_sale")) {
    issues.push({ code: "NO_SALE_CAPABILITY", message: "The POS must be able to record a sale.", severity: "error" });
  }
  return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}

export function enabledPaymentMethods(config: PosConfiguration): string[] {
  const methods: string[] = [];
  if (config.payments.cash) methods.push("cash");
  if (config.payments.mpesa) methods.push("mpesa");
  if (config.payments.bank) methods.push("bank");
  if (config.payments.card) methods.push("card");
  if (config.payments.credit || config.credit.enabled) methods.push("credit");
  for (const label of config.payments.otherLabels) methods.push(label);
  return methods;
}

// ── Human-readable output (§21, §42, §65, §66) ────────────────────────────────

export type SummaryGroup = { label: string; value: string };

/** The "Configuration ready" panel (§42) — business, sales, payment, inventory, … models. */
export function configurationSummary(config: PosConfiguration): SummaryGroup[] {
  const terminology = resolveTerminology(config);
  const type = getBusinessType(config.business.typeKey);
  return [
    { label: "Business model", value: config.business.typeKey === "other" && config.business.otherDescription
      ? `${config.business.typeLabel || "Other"} — ${config.business.otherDescription}`
      : config.business.typeLabel || type.label },
    { label: "Sales model", value: salesModelWords(config) },
    { label: "Payment model", value: paymentWords(config) },
    { label: "Inventory model", value: config.inventory.enabled
      ? `Tracked in ${config.inventory.units.map((unit) => unitWord(unit)).join(", ")}`
      : "No stock tracking" },
    { label: "Customer model", value: config.customers.enabled
      ? `${terminology.customers}${config.customers.repeat ? " · repeat customers" : ""}${config.credit.enabled ? " · credit accounts" : ""}`
      : "No customer records" },
    { label: "Supplier model", value: config.suppliers.enabled
      ? `${terminology.suppliers}${config.suppliers.credit ? ` · ${config.suppliers.termsDays}-day credit` : " · paid on delivery"}`
      : "Not tracked" },
    { label: "Staff model", value: config.staff.enabled
      ? `${config.staff.count} ${config.staff.count === 1 ? "person" : "people"}${config.staff.attribution ? " · sales attributed" : ""}${config.staff.commissions ? " · commissions" : ""}`
      : "Just you" },
    { label: "Order model", value: config.orders.enabled
      ? `${getWorkflow(config.orders.workflowKey).label}: ${resolveStates(config).map((state) => state.label).join(" → ")}`
      : "Counter sales only" },
  ];
}

function salesModelWords(config: PosConfiguration): string {
  const words: string[] = [];
  if (config.sales.products) words.push("products");
  if (config.sales.services) words.push("services");
  if (config.sales.bookings) words.push("bookings");
  if (config.sales.projects) words.push("projects");
  if (config.sales.subscriptions) words.push("subscriptions");
  if (config.sales.customOrders) words.push("custom orders");
  const extras: string[] = [];
  if (config.sales.discounts) extras.push("discounts");
  if (config.sales.deposits) extras.push("deposits");
  if (config.sales.quotations) extras.push("quotations");
  if (config.credit.enabled) extras.push("credit");
  const base = words.length ? words.join(" + ") : "counter sales";
  return extras.length ? `${base} · ${extras.join(", ")}` : base;
}

function paymentWords(config: PosConfiguration): string {
  const labels: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", bank: "Bank", card: "Card", credit: "Credit" };
  const methods = enabledPaymentMethods(config).map((method) => labels[method] ?? titleCase(method));
  return methods.length ? methods.join(" + ") : "Not set yet";
}

function unitWord(key: string): string {
  if (key.startsWith("custom:")) return titleCase(key.slice(7));
  return titleCase(key);
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

/** "You can: ✓ …" (§65) — the confidence message shown before payment. */
export function describeConfiguration(config: PosConfiguration): string[] {
  const terminology = resolveTerminology(config);
  const lines: string[] = [];
  const capabilityLines = new Map<CapabilityKey, string>();
  for (const capability of CAPABILITY_LIBRARY) {
    if (config.capabilities.includes(capability.key)) capabilityLines.set(capability.key, capability.label);
  }
  const push = (line: string) => { if (line && !lines.includes(line)) lines.push(line); };

  if (config.sales.products && config.sales.services) push(`Sell both ${terminology.products.toLowerCase()} and ${terminology.services.toLowerCase()}`);
  else if (config.sales.products) push(`Sell ${terminology.products.toLowerCase()}`);
  else if (config.sales.services) push(`Sell ${terminology.services.toLowerCase()}`);

  if (config.inventory.units.length) {
    push(`Measure in ${config.inventory.units.map((unit) => unitWord(unit)).join(", ")}`);
  }
  if (config.inventory.conversions.length) {
    push(`Convert units (${config.inventory.conversions.length} rule${config.inventory.conversions.length === 1 ? "" : "s"})`);
  }
  for (const method of enabledPaymentMethods(config)) push(`Accept ${titleCase(method)}`);
  if (config.credit.enabled) {
    push(`Sell to ${terminology.customers.toLowerCase()} on credit`);
    push("Track customer balances");
    if (config.credit.statements) push("Send customer statements");
  }
  if (config.suppliers.enabled) push(`Manage ${terminology.suppliers.toLowerCase()}`);
  if (config.suppliers.credit) push("Track supplier balances");
  if (config.suppliers.purchaseOrders) push("Order stock before it arrives");
  if (config.inventory.enabled) push("Manage stock");
  if (config.expenses.enabled) push("Record expenses");
  if (config.delivery.enabled) push("Track deliveries");
  if (config.delivery.pickup) push("Track collections");
  if (config.staff.enabled) push("Manage staff and permissions");
  if (config.branches.enabled) push(`Run ${config.branches.count} locations`);
  for (const key of ["menu", "kitchen_orders", "tables", "appointments", "job_cards", "vehicles", "projects", "produce", "harvests", "manufacturing", "work_orders", "properties", "rent", "courses", "fees", "events", "garments", "artwork", "loyalty", "commissions"]) {
    if (capabilityLines.has(key as CapabilityKey)) push(capabilityLines.get(key as CapabilityKey)!);
  }
  push("View sales reports");
  return lines.slice(0, 16);
}

/** One paragraph an owner can read aloud (§21, §65). */
export function configurationHeadline(config: PosConfiguration): string {
  const type = getBusinessType(config.business.typeKey);
  const bits = [type.label];
  if (config.orders.enabled) bits.push(getWorkflow(config.orders.workflowKey).label.toLowerCase());
  if (config.delivery.enabled) bits.push("delivery");
  if (config.credit.enabled) bits.push("credit");
  return bits.join(" · ");
}

// ── Versioning and safe evolution (§48, §49) ──────────────────────────────────

export type ConfigurationChange = {
  path: string;
  label: string;
  from: string;
  to: string;
  kind: "added" | "removed" | "changed";
};

/**
 * Compare two configurations in words an owner understands. Historical transactions keep
 * their meaning because the change is recorded as a new version, never a rewrite (§48, §54).
 */
export function diffConfigurations(before: PosConfiguration, after: PosConfiguration): ConfigurationChange[] {
  const changes: ConfigurationChange[] = [];
  const beforeSet = new Set(before.capabilities);
  const afterSet = new Set(after.capabilities);
  for (const key of after.capabilities) {
    if (!beforeSet.has(key)) {
      changes.push({ path: `capabilities.${key}`, label: capabilityTitle(key), from: "", to: "On", kind: "added" });
    }
  }
  for (const key of before.capabilities) {
    if (!afterSet.has(key)) {
      changes.push({ path: `capabilities.${key}`, label: capabilityTitle(key), from: "On", to: "Off", kind: "removed" });
    }
  }
  const scalarPaths: [string, string, (config: PosConfiguration) => unknown][] = [
    ["business.typeKey", "Business type", (config) => getBusinessType(config.business.typeKey).label],
    ["sales.tax.ratePercent", "Tax rate", (config) => `${config.sales.tax.ratePercent}%`],
    ["credit.limitKES", "Credit limit", (config) => `KES ${config.credit.limitKES.toLocaleString("en-KE")}`],
    ["credit.termsDays", "Credit period", (config) => `${config.credit.termsDays} days`],
    ["suppliers.termsDays", "Supplier period", (config) => `${config.suppliers.termsDays} days`],
    ["staff.count", "Staff", (config) => String(config.staff.count)],
    ["branches.count", "Locations", (config) => String(config.branches.count)],
    ["orders.workflowKey", "Order stages", (config) => getWorkflow(config.orders.workflowKey).label],
  ];
  for (const [path, label, read] of scalarPaths) {
    const from = String(read(before) ?? "");
    const to = String(read(after) ?? "");
    if (from !== to) changes.push({ path, label, from, to, kind: "changed" });
  }
  const paymentLabels = (config: PosConfiguration) => enabledPaymentMethods(config).map(titleCase).join(", ");
  if (paymentLabels(before) !== paymentLabels(after)) {
    changes.push({ path: "payments", label: "Payment methods", from: paymentLabels(before), to: paymentLabels(after), kind: "changed" });
  }
  const unitLabels = (config: PosConfiguration) => config.inventory.units.map(unitWord).join(", ");
  if (unitLabels(before) !== unitLabels(after)) {
    changes.push({ path: "inventory.units", label: "Units", from: unitLabels(before), to: unitLabels(after), kind: "changed" });
  }
  return changes;
}

function capabilityTitle(key: string): string {
  return CAPABILITY_LIBRARY.find((capability) => capability.key === key)?.label ?? titleCase(key);
}

/**
 * Questions that must be answered before a requested change is applied (§49: identify,
 * explain, ask, preview, confirm, migrate safely).
 */
export function followUpQuestionsForChange(before: PosConfiguration, after: PosConfiguration): { questionId: string; title: string }[] {
  const followUps: { questionId: string; title: string }[] = [];
  if (!before.credit.enabled && after.credit.enabled) {
    if (after.credit.limitKES <= 0) followUps.push({ questionId: "credit_limit", title: "What is the most one customer may owe you?" });
    if (!after.credit.termsDays) followUps.push({ questionId: "credit_terms_days", title: "How many days do customers have to pay?" });
    if (after.staff.enabled && !after.credit.staffCanApprove) {
      followUps.push({ questionId: "credit_staff_approve", title: "Can your staff approve a credit sale?" });
    }
  }
  if (!before.inventory.enabled && after.inventory.enabled && after.inventory.units.length === 0) {
    followUps.push({ questionId: "units", title: "What do you sell by?" });
  }
  if (!before.suppliers.credit && after.suppliers.credit && after.suppliers.termsDays <= 0) {
    followUps.push({ questionId: "supplier_terms_days", title: "How many days do suppliers give you to pay?" });
  }
  if (!before.branches.enabled && after.branches.enabled && after.branches.count < 2) {
    followUps.push({ questionId: "branch_count", title: "How many locations?" });
  }
  if (!before.staff.enabled && after.staff.enabled && after.staff.roles.length === 0) {
    followUps.push({ questionId: "staff_roles", title: "What do your staff do?" });
  }
  if (!before.delivery.enabled && after.delivery.enabled && !after.orders.enabled) {
    followUps.push({ questionId: "orders", title: "Do customers order ahead?" });
  }
  return followUps;
}

/**
 * Apply an edit-mode patch (§22). Plain-language toggles arrive as a partial configuration;
 * anything the owner did not touch is preserved and the result is re-derived and validated.
 */
export function applyConfigurationPatch(config: PosConfiguration, patch: Record<string, unknown>): PosConfiguration {
  const merged = mergePatch(structuredCloneSafe(config), patch);
  return finalize(merged as PosConfiguration);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergePatch(target: Record<string, any>, patch: Record<string, unknown>): Record<string, any> {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (isObject(value) && isObject(target[key]) && !Array.isArray(value)) {
      mergePatch(target[key] as Record<string, any>, value);
      continue;
    }
    target[key] = value;
  }
  return target;
}

/** Stable fingerprint used to decide whether a change deserves a new version (§48). */
/**
 * Owner word overrides (§46). Presentation only: the entity behind the word never changes
 * shape, so a renamed "Guest" is still a customer record with the same fields and history.
 * Unknown keys are dropped rather than stored.
 */
export function applyTerminologyOverrides(
  config: PosConfiguration,
  overrides: Record<string, string> | null | undefined,
): PosConfiguration {
  if (!overrides || typeof overrides !== "object") return config;
  const known = resolveTerminology(null);
  const clean: Partial<Record<TerminologyEntityKey, string>> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== "string") continue;
    const trimmed = value.replace(/[<>]/g, "").trim().slice(0, 40);
    if (!trimmed) continue;
    if (!(key in known)) continue;
    clean[key as TerminologyEntityKey] = trimmed;
  }
  return { ...config, terminology: { ...config.terminology, ...clean } };
}

export function configurationFingerprint(config: PosConfiguration): string {
  const material = {
    type: config.business.typeKey,
    capabilities: [...config.capabilities].sort(),
    payments: enabledPaymentMethods(config).sort(),
    units: [...config.inventory.units].sort(),
    credit: { enabled: config.credit.enabled, limit: config.credit.limitKES, terms: config.credit.termsDays },
    suppliers: { enabled: config.suppliers.enabled, credit: config.suppliers.credit, terms: config.suppliers.termsDays },
    staff: { enabled: config.staff.enabled, count: config.staff.count, roles: [...config.staff.roles].sort() },
    branches: { enabled: config.branches.enabled, count: config.branches.count },
    expenses: { enabled: config.expenses.enabled },
    orders: { enabled: config.orders.enabled, workflow: config.orders.workflowKey },
    tax: config.sales.tax,
    terminology: config.terminology,
  };
  return stableStringify(material);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Questions still needed before this configuration can generate a POS (§42). */
export function configurationGaps(answers: QuestionnaireAnswers): { questionId: string; title: string }[] {
  return configurationReadiness(answers).missing.map((issue) => ({ questionId: issue.questionId, title: issue.title }));
}

/** Quick actions for the generated home screen (§24). */
export function quickActions(config: PosConfiguration, basePath: string) {
  return deriveQuickActions(config, basePath);
}

/** Terminology for a stored configuration, including the trade preset (§46). */
export function terminologyFor(config: PosConfiguration) {
  return resolveTerminology(config);
}

/** Terminology presets available to a business type, used by the editor (§22). */
export function terminologyPresetFor(typeKey: string): Partial<Record<TerminologyEntityKey, string>> {
  return TERMINOLOGY_PRESETS[typeKey] ?? {};
}

/** The order state a new order starts in, taken from the configured workflow (§29). */
export function initialOrderState(config: PosConfiguration): string {
  return initialState(config.orders?.workflowKey);
}

/** Convenience for tests and previews: build from a legacy JATA category (§80). */
export function configurationFromLegacyCategory(category: string, businessName?: string): PosConfiguration {
  const profile = resolveBusinessType(category);
  return buildConfiguration({ business_type: profile.key, ...profile.answers }, { businessName });
}

/** Default unit conversions offered to a configuration (§13). */
export function defaultConversions(): UnitConversion[] {
  return [...DEFAULT_CONVERSIONS];
}
