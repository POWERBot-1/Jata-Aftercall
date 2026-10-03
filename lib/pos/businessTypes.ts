/**
 * Business type registry (§10, §18, §51, §52)
 *
 * One platform, many business models. Every entry here is *data*: the capabilities a trade
 * normally needs, the words it uses, the modules it wants to see, the order lifecycle that
 * fits it and the extra questions worth asking. The engine executes whatever this registry
 * plus the owner's answers produce — there is no `if (restaurant)` anywhere in the product
 * (§52), and adding a fifty-sixth trade means adding one object.
 *
 * The list is deliberately not exhaustive: `other` always exists and maps a free-text
 * description onto existing capabilities (§19).
 */

import type {
  BusinessTypeKey, CapabilityKey, DashboardCardKey, PosModuleKey,
  QuestionnaireAnswers, TerminologyEntityKey, UnitKey,
} from "./types";

export type BusinessTypeGroup =
  | "Food & drink"
  | "Shops & retail"
  | "Trade & supply"
  | "Beauty & personal care"
  | "Motoring"
  | "Everyday services"
  | "Health & care"
  | "Farming"
  | "Making & building"
  | "Professional"
  | "Property & education"
  | "Events & creative"
  | "Online"
  | "Other";

export type BusinessTypeProfile = {
  key: BusinessTypeKey;
  label: string;
  group: BusinessTypeGroup;
  /** Short, human line shown under the card. Never technical (§3). */
  blurb: string;
  icon: string;
  /** Words this trade uses (§46). Owner overrides still win. */
  terminology: Partial<Record<TerminologyEntityKey, string>>;
  /** Capabilities switched on for this trade, including industry modules (§8, §18). */
  capabilities: CapabilityKey[];
  /** Industry capabilities offered as *optional* extras by the questionnaire (§18). */
  optionalCapabilities: CapabilityKey[];
  /** Preferred navigation order; unavailable modules are filtered out (§24). */
  navigation: PosModuleKey[];
  dashboard: DashboardCardKey[];
  workflowKey: string;
  units: UnitKey[];
  /** Extra questions this trade answers (§18, §40). */
  focusQuestions: string[];
  /** Sensible starting answers so the questionnaire is short (§9, §41). */
  answers: QuestionnaireAnswers;
  /** Template this trade starts from (§51). */
  templateKey: string;
  aliases: string[];
};

/**
 * The universal baseline (§47): every business can sell, take payment, give a receipt, keep
 * customers and read basic reports. Capabilities are added on top of this, never instead of it.
 */
export const BASELINE_CAPABILITIES: CapabilityKey[] = [
  "pos_sale", "receipt", "customer_profiles", "cash", "mpesa",
  "daily_sales", "weekly_sales", "monthly_sales", "payment_breakdown",
  "best_sellers", "financial_summaries",
];

export const BASELINE_NAVIGATION: PosModuleKey[] = [
  "dashboard", "sell", "products", "customers", "reports", "settings",
];

export const BASELINE_DASHBOARD: DashboardCardKey[] = ["today_sales", "cash", "mpesa"];

type Preset = {
  key: BusinessTypeKey;
  label: string;
  group: BusinessTypeGroup;
  blurb: string;
  icon: string;
  templateKey: string;
  aliases?: string[];
  /** What the trade sells; drives product_sales / service_sales and the catalogue modules. */
  sells?: ("products" | "services")[];
  capabilities?: CapabilityKey[];
  optionalCapabilities?: CapabilityKey[];
  terminology?: Partial<Record<TerminologyEntityKey, string>>;
  navigation?: PosModuleKey[];
  dashboard?: DashboardCardKey[];
  workflowKey?: string;
  units?: UnitKey[];
  focusQuestions?: string[];
  answers?: QuestionnaireAnswers;
};

const PRODUCT_SALES: CapabilityKey[] = ["product_sales", "catalogue", "products", "stock_levels", "inventory_valuation", "low_stock_alerts", "reorder_levels", "stock_adjustments", "slow_movers", "inventory_value", "customer_history"];
const SERVICE_SALES: CapabilityKey[] = ["service_sales", "services", "customer_history"];
const STOCK_TRADE: CapabilityKey[] = ["units_of_measure", "stock_counts", "purchases", "suppliers", "supplier_accounts", "supplier_payments", "expenses", "expenses_report", "income"];
const CREDIT_TRADE: CapabilityKey[] = ["customer_accounts", "customer_credit", "credit_limits", "receivables", "statements", "outstanding_credit", "customer_notes"];
const ORDER_TRADE: CapabilityKey[] = ["orders", "walkin_orders", "phone_orders", "order_status", "fulfilment", "cancellation", "channel_attribution"];

function defineType(preset: Preset): BusinessTypeProfile {
  const sells = preset.sells ?? ["products"];
  const sellsCapabilities: CapabilityKey[] = [
    ...(sells.includes("products") ? PRODUCT_SALES : []),
    ...(sells.includes("services") ? SERVICE_SALES : []),
  ];
  const capabilities = normalize([
    ...BASELINE_CAPABILITIES,
    ...sellsCapabilities,
    ...(preset.capabilities ?? []),
  ]);
  const navigation = preset.navigation ?? defaultNavigation(capabilities);
  return {
    key: preset.key,
    label: preset.label,
    group: preset.group,
    blurb: preset.blurb,
    icon: preset.icon,
    terminology: preset.terminology ?? {},
    capabilities,
    optionalCapabilities: normalize(preset.optionalCapabilities ?? []),
    navigation,
    dashboard: preset.dashboard ?? BASELINE_DASHBOARD,
    workflowKey: preset.workflowKey ?? "generic",
    units: preset.units ?? ["piece"],
    focusQuestions: preset.focusQuestions ?? [],
    answers: {
      sells,
      ...(preset.answers ?? {}),
    },
    templateKey: preset.templateKey,
    aliases: preset.aliases ?? [],
  };
}

function normalize(keys: CapabilityKey[]): CapabilityKey[] {
  return [...new Set(keys)];
}

function defaultNavigation(capabilities: CapabilityKey[]): PosModuleKey[] {
  const nav: PosModuleKey[] = ["dashboard", "sell"];
  if (capabilities.includes("orders")) nav.push("orders");
  if (capabilities.includes("menu")) nav.push("menu");
  if (capabilities.includes("appointments")) nav.push("appointments");
  if (capabilities.includes("job_cards")) nav.push("jobs");
  if (capabilities.includes("projects")) nav.push("projects");
  if (capabilities.includes("produce")) nav.push("produce");
  nav.push("products");
  if (capabilities.includes("services")) nav.push("services");
  nav.push("customers");
  if (capabilities.includes("customer_credit")) nav.push("credit");
  if (capabilities.includes("stock_levels")) nav.push("inventory");
  if (capabilities.includes("suppliers")) nav.push("suppliers");
  if (capabilities.includes("purchases")) nav.push("purchases");
  if (capabilities.includes("expenses")) nav.push("expenses");
  if (capabilities.includes("employee_profiles")) nav.push("staff");
  if (capabilities.includes("multi_location")) nav.push("branches");
  nav.push("reports", "settings");
  return [...new Set(nav)];
}

/** ── Food & drink (§18 RESTAURANTS) ─────────────────────────────────────────── */
const FOOD: BusinessTypeProfile[] = [
  defineType({
    key: "restaurant", label: "Restaurant", group: "Food & drink", icon: "🍽️",
    blurb: "Menu, kitchen orders, tables, takeaway and delivery.",
    templateKey: "RESTAURANT", sells: ["products"],
    capabilities: [
      "menu", "ingredients", "recipes", "kitchen_orders", "tables", "modifiers", "wastage",
      "delivery", "pickup", ...ORDER_TRADE, "units_of_measure", "stock_levels", "stock_adjustments",
      "expenses", "expenses_report", "suppliers", "purchases", "employee_profiles", "roles",
      "permissions", "sales_attribution", "staff_performance", "profitability", "customer_notes",
    ],
    optionalCapabilities: ["discounts", "deposits", "split_payments", "customer_credit", "loyalty", "reservations", "commissions"],
    terminology: { customer: "Guest", customers: "Guests", product: "Dish", products: "Menu", sale: "Bill", sales: "Bills", stock: "Ingredients", inventory: "Ingredients" },
    dashboard: ["today_sales", "orders", "kitchen_queue", "cash", "mpesa", "stock_alerts", "expenses"],
    workflowKey: "restaurant", units: ["piece", "kilogram", "litre"],
    focusQuestions: ["restaurant_tables", "restaurant_kitchen", "menu_modifiers", "recipes", "wastage", "delivery", "pickup"],
    answers: { keeps_stock: true, keeps_customers: false, repeat_customers: false },
  }),
  defineType({
    key: "cafe", label: "Café", group: "Food & drink", icon: "☕",
    blurb: "Quick counter service with a menu and takeaway.",
    templateKey: "RESTAURANT", sells: ["products"],
    capabilities: ["menu", "modifiers", "pickup", ...ORDER_TRADE, "units_of_measure", "stock_levels", "expenses", "expenses_report", "suppliers", "employee_profiles", "roles", "permissions"],
    optionalCapabilities: ["delivery", "kitchen_orders", "loyalty", "discounts", "customer_credit"],
    terminology: { customer: "Guest", customers: "Guests", products: "Menu", product: "Item", sale: "Bill", sales: "Bills", stock: "Ingredients" },
    dashboard: ["today_sales", "orders", "cash", "mpesa", "stock_alerts"],
    workflowKey: "restaurant", units: ["piece", "litre", "kilogram"],
    focusQuestions: ["menu_modifiers", "pickup", "delivery"],
    answers: { keeps_stock: true, keeps_customers: false },
  }),
  defineType({
    key: "bar", label: "Bar", group: "Food & drink", icon: "🍺",
    blurb: "Drinks by the bottle or glass, with stock control.",
    templateKey: "RETAIL_CREDIT", sells: ["products"],
    capabilities: ["menu", "units_of_measure", "unit_conversions", "stock_levels", "stock_counts", "expiry_tracking", "batch_tracking", "wastage", "expenses", "expenses_report", "suppliers", "purchases", "employee_profiles", "roles", "permissions", ...ORDER_TRADE],
    optionalCapabilities: ["tables", "kitchen_orders", "delivery", "customer_credit", "discounts"],
    terminology: { customer: "Guest", customers: "Guests", product: "Drink", products: "Drinks list", sale: "Bill", sales: "Bills" },
    dashboard: ["today_sales", "cash", "mpesa", "stock_alerts", "expenses"],
    workflowKey: "restaurant", units: ["bottle", "piece", "crate", "litre"],
    focusQuestions: ["restaurant_tables", "units", "expiry", "batches"],
    answers: { keeps_stock: true, keeps_customers: false },
  }),
  defineType({
    key: "bakery", label: "Bakery", group: "Food & drink", icon: "🥖",
    blurb: "Bakes by the piece, with ingredient stock and pre-orders.",
    templateKey: "RETAIL_BASIC", sells: ["products"],
    capabilities: ["ingredients", "recipes", "wastage", "expiry_tracking", "units_of_measure", "stock_levels", "stock_counts", "custom_orders", "deposits", "expenses", "expenses_report", "suppliers", "purchases", "employee_profiles", ...ORDER_TRADE, "pickup"],
    optionalCapabilities: ["delivery", "kitchen_orders", "customer_credit", "discounts"],
    terminology: { product: "Item", products: "Bakes", stock: "Ingredients" },
    dashboard: ["today_sales", "orders", "cash", "mpesa", "stock_alerts"],
    workflowKey: "generic", units: ["piece", "dozen", "kilogram"],
    focusQuestions: ["orders", "expiry", "recipes"],
    answers: { keeps_stock: true },
  }),
  defineType({
    key: "butchery", label: "Butchery", group: "Food & drink", icon: "🥩",
    blurb: "Sold by weight, tracked to the kilo.",
    templateKey: "RETAIL_BASIC", sells: ["products"],
    capabilities: ["units_of_measure", "unit_conversions", "stock_levels", "expiry_tracking", "batch_tracking", "wastage", "stock_counts", "expenses", "expenses_report", "suppliers", "purchases", "employee_profiles", "roles", "permissions"],
    optionalCapabilities: ["delivery", "customer_credit", "discounts", "barcodes"],
    terminology: { stock: "Meat stock" },
    dashboard: ["today_sales", "cash", "mpesa", "stock_alerts"],
    units: ["kilogram", "gram", "piece"],
    focusQuestions: ["expiry", "batches", "wastage"],
    answers: { keeps_stock: true },
  }),
  defineType({
    key: "catering", label: "Catering", group: "Food & drink", icon: "🍲",
    blurb: "Events, packages, deposits and ingredient stock.",
    templateKey: "EVENTS", sells: ["products", "services"],
    capabilities: ["events", "event_packages", "payment_schedules", "quotation", "invoice", "deposits", "partial_payments", "ingredients", "recipes", "projects", "expenses", "expenses_report", "suppliers", "purchases", "employee_profiles", "roles", "permissions", "customer_accounts"],
    optionalCapabilities: ["delivery", "stock_levels", "commissions", "customer_credit"],
    terminology: { customer: "Client", customers: "Clients", order: "Event", orders: "Events", sale: "Invoice", sales: "Invoices", quote: "Proposal" },
    navigation: ["dashboard", "orders", "projects", "products", "customers", "suppliers", "expenses", "staff", "reports", "settings"],
    dashboard: ["orders", "today_sales", "credit_owed", "expenses", "pending_deliveries"],
    workflowKey: "project", units: ["piece", "kilogram"],
    focusQuestions: ["events", "events", "payment_schedules", "quotations"],
    answers: { keeps_stock: true, keeps_customers: true, quotations: true },
  }),
  defineType({
    key: "hotel", label: "Hotel", group: "Food & drink", icon: "🏨",
    blurb: "Rooms, guests, reservations and incidental bills.",
    templateKey: "SERVICE_BUSINESS", sells: ["products", "services"],
    capabilities: ["reservations", "bookings", "appointments", "tables", "menu", "deposits", "partial_payments", "customer_accounts", "customer_credit", "receivables", "statements", "expenses", "expenses_report", "suppliers", "employee_profiles", "roles", "permissions", "sales_attribution", "stock_levels", ...ORDER_TRADE],
    optionalCapabilities: ["delivery", "loyalty", "commissions", "inventory_valuation"],
    terminology: { customer: "Guest", customers: "Guests", product: "Room / service", products: "Rooms & services", order: "Reservation", orders: "Reservations" },
    navigation: ["dashboard", "orders", "appointments", "products", "customers", "credit", "inventory", "suppliers", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "appointments", "orders", "credit_owed", "cash", "mpesa", "expenses"],
    workflowKey: "appointment", units: ["day", "piece"],
    focusQuestions: ["appointments", "deposits", "credit_frequency"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
];

/** ── Shops & retail ─────────────────────────────────────────────────────────── */
const RETAIL: BusinessTypeProfile[] = [
  defineType({
    key: "retail", label: "Retail shop", group: "Shops & retail", icon: "🛍️",
    blurb: "Counter sales, stock and receipts.",
    templateKey: "RETAIL_BASIC", sells: ["products"],
    capabilities: [...STOCK_TRADE, "returns", "refunds", "discounts", "barcodes", "skus"],
    optionalCapabilities: ["customer_credit", "delivery", "variants", "loyalty", "wholesale_pricing"],
    dashboard: ["today_sales", "cash", "mpesa", "stock_alerts", "expenses"],
    units: ["piece", "box", "pack"],
    answers: { keeps_stock: true },
  }),
  defineType({
    key: "grocery", label: "Grocery", group: "Shops & retail", icon: "🥬",
    blurb: "Fast counter sales with weights, expiry and stock.",
    templateKey: "RETAIL_BASIC", sells: ["products"],
    capabilities: [...STOCK_TRADE, "returns", "discounts", "expiry_tracking", "batch_tracking", "unit_conversions", "barcodes"],
    optionalCapabilities: ["delivery", "customer_credit", "loyalty"],
    dashboard: ["today_sales", "cash", "mpesa", "stock_alerts"],
    units: ["piece", "kilogram", "gram", "litre", "pack"],
    focusQuestions: ["expiry", "delivery"],
    answers: { keeps_stock: true },
  }),
  defineType({
    key: "supermarket", label: "Supermarket", group: "Shops & retail", icon: "🛒",
    blurb: "Many products, barcodes, branches and stock counts.",
    templateKey: "RETAIL_CREDIT", sells: ["products"],
    capabilities: [...STOCK_TRADE, ...CREDIT_TRADE, "returns", "refunds", "discounts", "promotions", "barcodes", "skus", "variants", "stock_transfers", "multi_location", "unit_conversions", "serial_numbers", "employee_profiles", "roles", "permissions", "shifts", "sales_attribution", "cash_drawer", "daily_closing", "reconciliation", "approval_workflows", "supplier_credit", "payables", "supplier_debt", "purchase_orders", "partial_receiving"],
    optionalCapabilities: ["delivery", "loyalty", "commissions", "manufacturing", "assembly"],
    dashboard: ["today_sales", "cash", "mpesa", "credit_owed", "stock_alerts", "supplier_debt", "expenses"],
    units: ["piece", "box", "carton", "kilogram", "litre", "pack"],
    focusQuestions: ["multi_branch", "barcode", "stock_counts", "supplier_credit", "purchase_orders"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "convenience_shop", label: "Convenience shop", group: "Shops & retail", icon: "🏪",
    blurb: "Small shop, quick sales, simple stock.",
    templateKey: "RETAIL_BASIC", sells: ["products"],
    capabilities: [...STOCK_TRADE, "returns", "discounts", "unit_conversions"],
    optionalCapabilities: ["customer_credit", "delivery", "barcodes"],
    dashboard: ["today_sales", "cash", "mpesa", "stock_alerts"],
    units: ["piece", "pack", "bottle"],
    answers: { keeps_stock: true, keeps_customers: false },
  }),
  defineType({
    key: "electronics", label: "Electronics", group: "Shops & retail", icon: "🔌",
    blurb: "Serial numbers, warranties and instalments.",
    templateKey: "RETAIL_CREDIT", sells: ["products", "services"],
    capabilities: [...STOCK_TRADE, ...CREDIT_TRADE, "serial_numbers", "barcodes", "skus", "returns", "refunds", "deposits", "partial_payments", "split_payments", "quotation", "invoice", "employee_profiles", "roles", "permissions", "supplier_credit", "payables", "purchase_orders"],
    optionalCapabilities: ["delivery", "job_cards", "commissions"],
    dashboard: ["today_sales", "credit_owed", "stock_alerts", "cash", "mpesa", "supplier_debt"],
    units: ["piece", "box", "pair"],
    focusQuestions: ["serials", "credit_frequency", "deposits"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "furniture", label: "Furniture", group: "Shops & retail", icon: "🪑",
    blurb: "Big-ticket sales with deposits and delivery.",
    templateKey: "RETAIL_CREDIT", sells: ["products", "services"],
    capabilities: [...STOCK_TRADE, ...CREDIT_TRADE, "deposits", "partial_payments", "quotation", "invoice", "delivery", "custom_orders", "variants", ...ORDER_TRADE, "employee_profiles", "roles", "permissions"],
    optionalCapabilities: ["assembly", "manufacturing", "commissions"],
    terminology: { product: "Item", products: "Furniture", customer: "Client", customers: "Clients" },
    dashboard: ["today_sales", "orders", "credit_owed", "pending_deliveries", "cash", "mpesa"],
    workflowKey: "generic", units: ["piece", "pair", "metre"],
    focusQuestions: ["deposits", "delivery", "orders"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "clothing", label: "Clothing", group: "Shops & retail", icon: "👕",
    blurb: "Sizes, colours, stock and returns.",
    templateKey: "BOUTIQUE", sells: ["products"],
    capabilities: [...STOCK_TRADE, "sizes_colours", "variants", "skus", "barcodes", "returns", "refunds", "discounts", "promotions", "customer_history", "loyalty"],
    optionalCapabilities: ["customer_credit", "delivery", "custom_orders"],
    terminology: { product: "Item", products: "Clothing", customer: "Client", customers: "Clients" },
    dashboard: ["today_sales", "cash", "mpesa", "stock_alerts", "top_products"],
    units: ["piece", "pair", "dozen"],
    focusQuestions: ["variants", "barcode"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "boutique", label: "Boutique", group: "Shops & retail", icon: "👗",
    blurb: "Collections, sizes, colours and client history.",
    templateKey: "BOUTIQUE", sells: ["products"],
    capabilities: [...STOCK_TRADE, "sizes_colours", "variants", "skus", "barcodes", "returns", "discounts", "customer_history", "customer_notes", "loyalty", "deposits", "custom_orders"],
    optionalCapabilities: ["delivery", "customer_credit", "appointments"],
    terminology: { product: "Item", products: "Collections", customer: "Client", customers: "Clients" },
    dashboard: ["today_sales", "cash", "mpesa", "new_customers", "top_products"],
    units: ["piece", "pair"],
    focusQuestions: ["variants", "deposits"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "shoes", label: "Shoe shop", group: "Shops & retail", icon: "👟",
    blurb: "Sizes and pairs, with stock per size.",
    templateKey: "BOUTIQUE", sells: ["products"],
    capabilities: [...STOCK_TRADE, "sizes_colours", "variants", "skus", "barcodes", "returns", "discounts"],
    optionalCapabilities: ["customer_credit", "delivery", "loyalty"],
    terminology: { product: "Pair", products: "Shoes", customer: "Client", customers: "Clients" },
    units: ["pair", "piece", "box"],
    focusQuestions: ["variants"],
    answers: { keeps_stock: true },
  }),
  defineType({
    key: "beauty_products", label: "Beauty products", group: "Shops & retail", icon: "💄",
    blurb: "Shades, batches and expiry dates.",
    templateKey: "RETAIL_BASIC", sells: ["products"],
    capabilities: [...STOCK_TRADE, "variants", "sizes_colours", "barcodes", "skus", "expiry_tracking", "batch_tracking", "returns", "discounts", "loyalty", "customer_history"],
    optionalCapabilities: ["appointments", "service_sales", "delivery", "customer_credit"],
    dashboard: ["today_sales", "cash", "mpesa", "stock_alerts", "top_products"],
    units: ["piece", "millilitre", "gram", "pack"],
    focusQuestions: ["expiry", "variants"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "florist", label: "Florist", group: "Shops & retail", icon: "💐",
    blurb: "Arrangements, deliveries and occasion orders.",
    templateKey: "RETAIL_BASIC", sells: ["products", "services"],
    capabilities: [...STOCK_TRADE, "custom_orders", "deposits", "delivery", "expiry_tracking", "wastage", ...ORDER_TRADE],
    optionalCapabilities: ["events", "customer_credit", "loyalty"],
    terminology: { product: "Arrangement", products: "Bouquets" },
    dashboard: ["today_sales", "orders", "pending_deliveries", "cash", "mpesa", "stock_alerts"],
    units: ["piece", "dozen", "bottle"],
    focusQuestions: ["delivery", "orders", "expiry"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "pharmacy", label: "Pharmacy", group: "Health & care", icon: "💊",
    blurb: "Medicines with batches, expiry and careful records.",
    templateKey: "RETAIL_CREDIT", sells: ["products", "services"],
    capabilities: [...STOCK_TRADE, ...CREDIT_TRADE, "batch_tracking", "expiry_tracking", "serial_numbers", "barcodes", "skus", "stock_counts", "returns", "employee_profiles", "roles", "permissions", "approval_workflows", "supplier_credit", "payables", "purchase_orders"],
    optionalCapabilities: ["delivery", "appointments", "commissions"],
    terminology: { customer: "Patient", customers: "Patients", product: "Medicine", products: "Medicines" },
    dashboard: ["today_sales", "cash", "mpesa", "stock_alerts", "credit_owed"],
    units: ["piece", "pack", "bottle", "millilitre", "gram"],
    focusQuestions: ["batches", "expiry", "stock_counts"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
];

/** ── Trade & supply (§18 HARDWARE, WHOLESALE) ───────────────────────────────── */
const TRADE: BusinessTypeProfile[] = [
  defineType({
    key: "hardware", label: "Hardware shop", group: "Trade & supply", icon: "🔨",
    blurb: "Pieces, boxes and metres — with credit for contractors.",
    templateKey: "HARDWARE", sells: ["products"],
    capabilities: [
      ...STOCK_TRADE, ...CREDIT_TRADE, "wholesale_pricing", "retail_pricing", "unit_conversions",
      "quotation", "invoice", "delivery", "returns", "discounts", "supplier_credit", "payables",
      "supplier_debt", "purchase_orders", "partial_receiving", "supplier_statements",
      "employee_profiles", "roles", "permissions", "sales_attribution", "stock_counts",
    ],
    optionalCapabilities: ["multi_location", "stock_transfers", "barcodes", "promotions", "commissions"],
    terminology: { product: "Item", products: "Stock items", quote: "Quotation" },
    dashboard: ["today_sales", "credit_owed", "supplier_debt", "cash", "mpesa", "stock_alerts", "pending_deliveries"],
    units: ["piece", "box", "metre", "kilogram", "bag", "sack", "roll", "dozen"],
    focusQuestions: ["units", "credit_frequency", "supplier_credit", "purchase_orders", "delivery", "wholesale_pricing"],
    answers: { keeps_stock: true, keeps_customers: true, credit_frequency: "sometimes", has_suppliers: true, purchase_orders: true },
  }),
  defineType({
    key: "building_materials", label: "Building materials", group: "Trade & supply", icon: "🧱",
    blurb: "Bulk supply to contractors, with credit and delivery.",
    templateKey: "HARDWARE", sells: ["products"],
    capabilities: [...STOCK_TRADE, ...CREDIT_TRADE, "wholesale_pricing", "bulk_pricing", "customer_tiers", "minimum_quantities", "unit_conversions", "quotation", "invoice", "delivery", "routes", "supplier_credit", "payables", "supplier_debt", "purchase_orders", "partial_receiving", "warehouses", "multi_location", "stock_transfers", "employee_profiles", "roles", "permissions", "sales_reps", "sales_attribution"],
    optionalCapabilities: ["multi_location", "commissions", "promotions"],
    terminology: { product: "Material", products: "Materials", customer: "Contractor", customers: "Contractors" },
    dashboard: ["today_sales", "credit_owed", "supplier_debt", "pending_deliveries", "stock_alerts"],
    units: ["bag", "sack", "piece", "metre", "kilogram", "box", "roll"],
    focusQuestions: ["wholesale_pricing", "credit_frequency", "delivery", "warehouses"],
    answers: { keeps_stock: true, keeps_customers: true, credit_frequency: "sometimes" },
  }),
  defineType({
    key: "wholesale", label: "Wholesale / distribution", group: "Trade & supply", icon: "📦",
    blurb: "Bulk pricing, stockists, routes and credit.",
    templateKey: "WHOLESALE", sells: ["products"],
    capabilities: [...STOCK_TRADE, ...CREDIT_TRADE, "wholesale_pricing", "bulk_pricing", "customer_tiers", "minimum_quantities", "unit_conversions", "invoice", "delivery", "routes", "warehouses", "multi_location", "stock_transfers", "purchase_orders", "partial_receiving", "supplier_credit", "payables", "supplier_debt", "sales_reps", "sales_attribution", "employee_profiles", "roles", "permissions", "commissions", "customer_segments"],
    optionalCapabilities: ["promotions", "multi_location", "daily_closing"],
    terminology: { customer: "Stockist", customers: "Stockists", sale: "Invoice", sales: "Invoices" },
    navigation: ["dashboard", "sell", "orders", "products", "customers", "credit", "inventory", "branches", "suppliers", "purchases", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "credit_owed", "supplier_debt", "orders", "pending_deliveries", "stock_alerts"],
    units: ["carton", "box", "piece", "sack", "bag", "dozen", "kilogram", "litre"],
    focusQuestions: ["wholesale_pricing", "tiers", "minimums", "credit_frequency", "routes", "warehouses"],
    answers: { keeps_stock: true, keeps_customers: true, credit_frequency: "sometimes", has_suppliers: true },
  }),
  defineType({
    key: "spare_parts", label: "Spare parts", group: "Motoring", icon: "⚙️",
    blurb: "Part numbers, stock and trade customers.",
    templateKey: "AUTO_PARTS", sells: ["products"],
    capabilities: [...STOCK_TRADE, "skus", "barcodes", "serial_numbers", "variants", ...CREDIT_TRADE, "quotation", "returns", "supplier_credit", "payables", "purchase_orders", "employee_profiles", "roles", "permissions"],
    optionalCapabilities: ["job_cards", "delivery", "wholesale_pricing"],
    terminology: { product: "Part", products: "Spare parts", customer: "Customer", customers: "Customers" },
    dashboard: ["today_sales", "stock_alerts", "credit_owed", "cash", "mpesa"],
    units: ["piece", "pair", "box", "litre"],
    focusQuestions: ["barcode", "serials", "credit_frequency"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "marketplace_seller", label: "Marketplace seller", group: "Online", icon: "🧺",
    blurb: "Orders from online marketplaces, tracked in one place.",
    templateKey: "ONLINE_SELLER", sells: ["products"],
    capabilities: [...STOCK_TRADE, "online_orders", "business_page_orders", "whatsapp_orders", "phone_orders", ...ORDER_TRADE, "delivery", "pickup", "skus", "barcodes", "customer_history"],
    optionalCapabilities: ["customer_credit", "loyalty", "variants"],
    terminology: { customer: "Buyer", customers: "Buyers" },
    dashboard: ["orders", "today_sales", "pending_deliveries", "mpesa", "stock_alerts"],
    units: ["piece", "box", "pack"],
    focusQuestions: ["order_channels", "delivery"],
    answers: { keeps_stock: true, keeps_customers: true, orders: true },
  }),
  defineType({
    key: "online_seller", label: "Online seller", group: "Online", icon: "🌐",
    blurb: "Orders from your page, WhatsApp and phone.",
    templateKey: "ONLINE_SELLER", sells: ["products", "services"],
    capabilities: [...STOCK_TRADE, "online_orders", "business_page_orders", "whatsapp_orders", "phone_orders", ...ORDER_TRADE, "delivery", "pickup", "deposits", "partial_payments", "customer_history"],
    optionalCapabilities: ["customer_credit", "loyalty", "promotions"],
    terminology: { customer: "Buyer", customers: "Buyers" },
    dashboard: ["orders", "today_sales", "pending_deliveries", "mpesa", "cash"],
    units: ["piece", "box", "pack"],
    focusQuestions: ["order_channels", "delivery", "deposits"],
    answers: { keeps_stock: true, keeps_customers: true, orders: true },
  }),
  defineType({
    key: "subscription_business", label: "Subscription business", group: "Online", icon: "🔁",
    blurb: "Recurring billing with members and balances.",
    templateKey: "SERVICE_BUSINESS", sells: ["services", "products"],
    capabilities: ["subscriptions", "recurring_billing", "invoice", "partial_payments", "deposits", "customer_accounts", "customer_credit", "receivables", "statements", "outstanding_credit", "customer_history", "expenses", "expenses_report", "employee_profiles", "roles", "permissions", "mpesa", "bank", "card"],
    optionalCapabilities: ["loyalty", "stock_levels", "delivery"],
    terminology: { customer: "Member", customers: "Members", sale: "Billing", sales: "Billings", order: "Subscription", orders: "Subscriptions" },
    navigation: ["dashboard", "sell", "orders", "products", "customers", "credit", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "credit_owed", "new_customers", "mpesa", "expenses"],
    workflowKey: "generic", units: ["piece", "visit", "day"],
    focusQuestions: ["payment_plans"],
    answers: { keeps_stock: false, keeps_customers: true, credit_frequency: "sometimes" },
  }),
  defineType({
    key: "membership_business", label: "Membership business", group: "Online", icon: "🪪",
    blurb: "Members, renewals and access periods.",
    templateKey: "SERVICE_BUSINESS", sells: ["services"],
    capabilities: ["subscriptions", "recurring_billing", "customer_accounts", "customer_history", "loyalty", "invoice", "partial_payments", "expenses", "expenses_report", "employee_profiles", "roles", "permissions", "mpesa", "cash"],
    optionalCapabilities: ["appointments", "stock_levels"],
    terminology: { customer: "Member", customers: "Members", order: "Membership", orders: "Memberships" },
    navigation: ["dashboard", "sell", "products", "customers", "credit", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "new_customers", "mpesa", "cash"],
    workflowKey: "generic", units: ["day", "visit", "piece"],
    answers: { keeps_stock: false, keeps_customers: true },
  }),
];

/** ── Beauty & personal care (§18 SALONS) ────────────────────────────────────── */
const BEAUTY: BusinessTypeProfile[] = [
  defineType({
    key: "salon", label: "Salon", group: "Beauty & personal care", icon: "💇🏾‍♀️",
    blurb: "Appointments, stylists, services and product sales.",
    templateKey: "SALON", sells: ["services", "products"],
    capabilities: [
      ...SERVICE_SALES, "appointments", "stylists", "service_packages", "deposits",
      "customer_history", "customer_notes", "loyalty", "commissions", "sales_attribution",
      "employee_profiles", "roles", "permissions", "staff_performance", "expenses",
      "expenses_report", "stock_levels", "products", "catalogue", "units_of_measure",
      "suppliers", "purchases", ...ORDER_TRADE,
    ],
    optionalCapabilities: ["delivery", "customer_credit", "discounts", "promotions"],
    terminology: { customer: "Client", customers: "Clients", service: "Treatment", services: "Services", order: "Appointment", orders: "Appointments", staff: "Stylist", sale: "Bill", sales: "Bills" },
    navigation: ["dashboard", "appointments", "sell", "services", "products", "customers", "credit", "inventory", "expenses", "staff", "reports", "settings"],
    dashboard: ["appointments", "today_sales", "cash", "mpesa", "staff_performance", "new_customers"],
    workflowKey: "appointment", units: ["visit", "session", "hour", "piece"],
    focusQuestions: ["appointments", "stylists", "commissions", "packages", "deposits"],
    answers: { keeps_stock: true, keeps_customers: true, appointments: true, has_staff: true },
  }),
  defineType({
    key: "barber", label: "Barber", group: "Beauty & personal care", icon: "💈",
    blurb: "Walk-ins and appointments, with barber commissions.",
    templateKey: "BARBER", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "appointments", "stylists", "commissions", "sales_attribution", "employee_profiles", "roles", "permissions", "customer_history", "loyalty", "expenses", "expenses_report", "stock_levels", "products", "catalogue", "suppliers"],
    optionalCapabilities: ["deposits", "discounts", "customer_credit"],
    terminology: { customer: "Client", customers: "Clients", service: "Cut", services: "Services", order: "Appointment", orders: "Appointments", staff: "Barber" },
    navigation: ["dashboard", "appointments", "sell", "services", "products", "customers", "expenses", "staff", "reports", "settings"],
    dashboard: ["appointments", "today_sales", "cash", "mpesa", "staff_performance"],
    workflowKey: "appointment", units: ["visit", "piece"],
    focusQuestions: ["appointments", "commissions"],
    answers: { keeps_stock: true, keeps_customers: true, appointments: true },
  }),
  defineType({
    key: "spa", label: "Spa", group: "Beauty & personal care", icon: "🧖🏽‍♀️",
    blurb: "Treatments, packages and bookings.",
    templateKey: "SALON", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "appointments", "service_packages", "deposits", "stylists", "customer_history", "customer_notes", "loyalty", "commissions", "employee_profiles", "roles", "permissions", "expenses", "expenses_report", "stock_levels", "products", "catalogue", "expiry_tracking", "suppliers"],
    optionalCapabilities: ["customer_credit", "delivery", "promotions"],
    terminology: { customer: "Client", customers: "Clients", service: "Treatment", services: "Treatments", order: "Booking", orders: "Bookings" },
    navigation: ["dashboard", "appointments", "sell", "services", "products", "customers", "inventory", "expenses", "staff", "reports", "settings"],
    dashboard: ["appointments", "today_sales", "cash", "mpesa", "new_customers"],
    workflowKey: "appointment", units: ["session", "hour", "piece"],
    focusQuestions: ["appointments", "packages", "deposits"],
    answers: { keeps_stock: true, keeps_customers: true, appointments: true },
  }),
];

/** ── Motoring (§18 GARAGES) ─────────────────────────────────────────────────── */
const MOTORING: BusinessTypeProfile[] = [
  defineType({
    key: "garage", label: "Garage", group: "Motoring", icon: "🔧",
    blurb: "Job cards, vehicles, labour and parts.",
    templateKey: "GARAGE", sells: ["services", "products"],
    capabilities: [
      ...SERVICE_SALES, "vehicles", "job_cards", "labour", "estimates", "technicians",
      "parts_consumption", "quotation", "invoice", "deposits", "partial_payments",
      "customer_history", "customer_notes", ...STOCK_TRADE, ...CREDIT_TRADE,
      "employee_profiles", "roles", "permissions", "sales_attribution", "commissions",
      "profitability", ...ORDER_TRADE,
    ],
    optionalCapabilities: ["delivery", "pickup", "promotions"],
    terminology: { customer: "Vehicle owner", customers: "Vehicle owners", order: "Job", orders: "Jobs", service: "Labour", services: "Services", product: "Part", products: "Spare parts", quote: "Estimate" },
    navigation: ["dashboard", "jobs", "sell", "products", "customers", "credit", "inventory", "suppliers", "expenses", "staff", "reports", "settings"],
    dashboard: ["pending_jobs", "today_sales", "credit_owed", "stock_alerts", "cash", "mpesa"],
    workflowKey: "garage", units: ["job", "hour", "piece", "litre", "pair"],
    focusQuestions: ["vehicles", "job_cards", "estimates", "technicians", "parts", "deposits"],
    answers: { keeps_stock: true, keeps_customers: true, quotations: true },
  }),
  defineType({
    key: "auto_repair", label: "Auto repair", group: "Motoring", icon: "🚗",
    blurb: "Repairs tracked from inspection to collection.",
    templateKey: "GARAGE", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "vehicles", "job_cards", "labour", "estimates", "technicians", "parts_consumption", "quotation", "deposits", "customer_history", ...STOCK_TRADE, ...CREDIT_TRADE, "employee_profiles", "roles", "permissions", ...ORDER_TRADE],
    optionalCapabilities: ["commissions", "delivery"],
    terminology: { customer: "Vehicle owner", customers: "Vehicle owners", order: "Job", orders: "Jobs", product: "Part", products: "Spare parts", quote: "Estimate" },
    navigation: ["dashboard", "jobs", "sell", "products", "customers", "credit", "inventory", "suppliers", "expenses", "staff", "reports", "settings"],
    dashboard: ["pending_jobs", "today_sales", "credit_owed", "cash", "mpesa"],
    workflowKey: "garage", units: ["job", "hour", "piece", "litre"],
    focusQuestions: ["vehicles", "job_cards", "estimates"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "car_wash", label: "Car wash", group: "Motoring", icon: "🚿",
    blurb: "Quick service jobs with vehicles and staff.",
    templateKey: "SERVICE_BUSINESS", sells: ["services"],
    capabilities: [...SERVICE_SALES, "vehicles", "job_cards", "service_packages", "employee_profiles", "roles", "permissions", "sales_attribution", "commissions", "customer_history", "expenses", "expenses_report", "stock_levels", "suppliers"],
    optionalCapabilities: ["appointments", "loyalty", "delivery"],
    terminology: { customer: "Vehicle owner", customers: "Vehicle owners", order: "Job", orders: "Jobs", service: "Wash", services: "Washes" },
    navigation: ["dashboard", "jobs", "sell", "services", "customers", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "pending_jobs", "cash", "mpesa", "staff_performance"],
    workflowKey: "laundry", units: ["visit", "piece", "job"],
    focusQuestions: ["packages", "commissions"],
    answers: { keeps_stock: false, keeps_customers: true },
  }),
  defineType({
    key: "transport", label: "Transport", group: "Motoring", icon: "🚌",
    blurb: "Trips, passengers and route income.",
    templateKey: "SERVICE_BUSINESS", sells: ["services"],
    capabilities: [...SERVICE_SALES, "routes", "orders", "order_status", "fulfilment", "cancellation", "employee_profiles", "roles", "permissions", "sales_attribution", "expenses", "expenses_report", "financial_summaries", "income"],
    optionalCapabilities: ["customer_accounts", "subscriptions", "delivery"],
    terminology: { customer: "Passenger", customers: "Passengers", order: "Trip", orders: "Trips", product: "Route", products: "Routes" },
    navigation: ["dashboard", "sell", "orders", "products", "customers", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "orders", "cash", "mpesa", "expenses"],
    workflowKey: "generic", units: ["visit", "piece", "day"],
    focusQuestions: ["routes"],
    answers: { keeps_stock: false, keeps_customers: false },
  }),
  defineType({
    key: "courier", label: "Courier", group: "Motoring", icon: "🛵",
    blurb: "Shipments from pickup to delivery.",
    templateKey: "SERVICE_BUSINESS", sells: ["services"],
    capabilities: [...SERVICE_SALES, "delivery", "pickup", "routes", ...ORDER_TRADE, "employee_profiles", "roles", "permissions", "sales_attribution", "expenses", "expenses_report", "customer_accounts", "receivables"],
    optionalCapabilities: ["customer_credit", "commissions"],
    terminology: { customer: "Sender", customers: "Senders", order: "Shipment", orders: "Shipments" },
    navigation: ["dashboard", "orders", "sell", "customers", "credit", "expenses", "staff", "reports", "settings"],
    dashboard: ["orders", "pending_deliveries", "today_sales", "mpesa", "cash"],
    workflowKey: "delivery", units: ["piece", "visit", "kilogram"],
    focusQuestions: ["delivery", "routes"],
    answers: { keeps_stock: false, keeps_customers: true },
  }),
];

/** ── Everyday services (§18 LAUNDRY) ────────────────────────────────────────── */
const SERVICES: BusinessTypeProfile[] = [
  defineType({
    key: "laundry", label: "Laundry", group: "Everyday services", icon: "🧺",
    blurb: "Garment counts, service types and order status.",
    templateKey: "LAUNDRY", sells: ["services"],
    capabilities: [...SERVICE_SALES, "garments", "service_types", "delivery", "pickup", "customer_history", "customer_notes", ...ORDER_TRADE, "employee_profiles", "roles", "permissions", "expenses", "expenses_report", "stock_levels", "suppliers", "deposits", "partial_payments"],
    optionalCapabilities: ["loyalty", "customer_credit", "commissions"],
    terminology: { customer: "Client", customers: "Clients", order: "Load", orders: "Loads", product: "Service", products: "Services" },
    navigation: ["dashboard", "orders", "sell", "services", "customers", "credit", "expenses", "staff", "reports", "settings"],
    dashboard: ["orders", "today_sales", "pending_deliveries", "cash", "mpesa"],
    workflowKey: "laundry", units: ["piece", "visit", "kilogram"],
    focusQuestions: ["garments", "service_types", "pickup", "delivery"],
    answers: { keeps_stock: false, keeps_customers: true, orders: true },
  }),
  defineType({
    key: "cleaning_service", label: "Cleaning service", group: "Everyday services", icon: "🧽",
    blurb: "Jobs, clients and consumable stock.",
    templateKey: "SERVICE_BUSINESS", sells: ["services"],
    capabilities: [...SERVICE_SALES, "projects", "quotation", "invoice", "customer_history", "employee_profiles", "roles", "permissions", "sales_attribution", "expenses", "expenses_report", "stock_levels", "suppliers", "purchases", ...ORDER_TRADE, "deposits"],
    optionalCapabilities: ["subscriptions", "recurring_billing", "customer_credit"],
    terminology: { customer: "Client", customers: "Clients", order: "Job", orders: "Jobs" },
    navigation: ["dashboard", "orders", "sell", "services", "customers", "inventory", "expenses", "staff", "reports", "settings"],
    dashboard: ["orders", "today_sales", "credit_owed", "cash", "mpesa"],
    workflowKey: "project", units: ["visit", "hour", "piece"],
    focusQuestions: ["quotations", "recurring"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "tailor", label: "Tailor", group: "Everyday services", icon: "🧵",
    blurb: "Made-to-measure jobs with deposits and fabric stock.",
    templateKey: "PRINTING", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "custom_orders", "job_cards", "deposits", "partial_payments", "quotation", "artwork", "production_status", "customer_history", "customer_notes", ...STOCK_TRADE, "units_of_measure", "unit_conversions", ...ORDER_TRADE, "employee_profiles"],
    optionalCapabilities: ["variants", "commissions", "customer_credit"],
    terminology: { customer: "Client", customers: "Clients", order: "Job", orders: "Jobs", service: "Garment", services: "Garments" },
    navigation: ["dashboard", "jobs", "sell", "products", "customers", "credit", "inventory", "expenses", "reports", "settings"],
    dashboard: ["pending_jobs", "today_sales", "credit_owed", "cash", "mpesa"],
    workflowKey: "project", units: ["metre", "centimetre", "piece"],
    focusQuestions: ["orders", "deposits", "units"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "fashion_designer", label: "Fashion designer", group: "Everyday services", icon: "✂️",
    blurb: "Commissions, measurements, deposits and fabric.",
    templateKey: "PRINTING", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "custom_orders", "projects", "deposits", "partial_payments", "quotation", "artwork", "customer_history", "customer_notes", ...STOCK_TRADE, "units_of_measure", ...ORDER_TRADE],
    optionalCapabilities: ["variants", "appointments", "customer_credit"],
    terminology: { customer: "Client", customers: "Clients", order: "Commission", orders: "Commissions" },
    navigation: ["dashboard", "orders", "sell", "products", "customers", "inventory", "expenses", "reports", "settings"],
    dashboard: ["orders", "today_sales", "credit_owed", "cash", "mpesa"],
    workflowKey: "project", units: ["metre", "piece"],
    focusQuestions: ["orders", "deposits"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
];

/** ── Health & care ──────────────────────────────────────────────────────────── */
const HEALTH: BusinessTypeProfile[] = [
  defineType({
    key: "clinic", label: "Clinic / practice", group: "Health & care", icon: "🩺",
    blurb: "Patients, visits, services and careful records.",
    templateKey: "SERVICE_BUSINESS", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "appointments", "customer_history", "customer_notes", "invoice", "partial_payments", "deposits", "customer_accounts", "receivables", "statements", "expenses", "expenses_report", "employee_profiles", "roles", "permissions", "approval_workflows", "stock_levels", "products", "expiry_tracking", "batch_tracking", "suppliers", "purchases"],
    optionalCapabilities: ["commissions", "loyalty"],
    terminology: { customer: "Patient", customers: "Patients", order: "Visit", orders: "Visits", sale: "Bill", sales: "Bills" },
    navigation: ["dashboard", "appointments", "sell", "services", "products", "customers", "credit", "inventory", "expenses", "staff", "reports", "settings"],
    dashboard: ["appointments", "today_sales", "credit_owed", "cash", "mpesa", "stock_alerts"],
    workflowKey: "appointment", units: ["visit", "piece", "hour"],
    focusQuestions: ["appointments", "credit_frequency", "expiry"],
    answers: { keeps_stock: true, keeps_customers: true, appointments: true },
  }),
  defineType({
    key: "dental", label: "Dental practice", group: "Health & care", icon: "🦷",
    blurb: "Appointments, treatment plans and balances.",
    templateKey: "SERVICE_BUSINESS", sells: ["services"],
    capabilities: [...SERVICE_SALES, "appointments", "customer_history", "customer_notes", "invoice", "partial_payments", "deposits", "customer_accounts", "receivables", "statements", "expenses", "expenses_report", "employee_profiles", "roles", "permissions", "stock_levels", "expiry_tracking", "suppliers", "purchases"],
    optionalCapabilities: ["payment_plans", "loyalty"],
    terminology: { customer: "Patient", customers: "Patients", order: "Appointment", orders: "Appointments", sale: "Bill", sales: "Bills" },
    navigation: ["dashboard", "appointments", "sell", "services", "customers", "credit", "inventory", "expenses", "staff", "reports", "settings"],
    dashboard: ["appointments", "today_sales", "credit_owed", "cash", "mpesa"],
    workflowKey: "appointment", units: ["visit", "hour", "piece"],
    focusQuestions: ["appointments", "payment_plans"],
    answers: { keeps_stock: true, keeps_customers: true, appointments: true },
  }),
  defineType({
    key: "veterinary", label: "Veterinary business", group: "Health & care", icon: "🐾",
    blurb: "Pet owners, visits, medicines and stock.",
    templateKey: "SERVICE_BUSINESS", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "appointments", "customer_history", "customer_notes", ...STOCK_TRADE, "expiry_tracking", "batch_tracking", "customer_accounts", "receivables", "employee_profiles", "roles", "permissions"],
    optionalCapabilities: ["delivery", "loyalty", "customer_credit"],
    terminology: { customer: "Pet owner", customers: "Pet owners", order: "Visit", orders: "Visits", sale: "Bill", sales: "Bills" },
    navigation: ["dashboard", "appointments", "sell", "products", "customers", "credit", "inventory", "expenses", "staff", "reports", "settings"],
    dashboard: ["appointments", "today_sales", "stock_alerts", "cash", "mpesa"],
    workflowKey: "appointment", units: ["visit", "piece", "kilogram"],
    focusQuestions: ["appointments", "expiry"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
];

/** ── Farming (§18 FARM) ─────────────────────────────────────────────────────── */
const FARMING: BusinessTypeProfile[] = [
  defineType({
    key: "farm", label: "Farm", group: "Farming", icon: "🌽",
    blurb: "Produce, harvests, buyers and farm expenses.",
    templateKey: "FARM", sells: ["products"],
    capabilities: [
      "produce", "harvests", "production_batches", "seasonal_records", "buyers",
      "units_of_measure", "unit_conversions", "stock_levels", "stock_adjustments",
      "stock_counts", "wastage", "expiry_tracking", "customer_accounts", "customer_credit",
      "credit_limits", "receivables", "statements", "outstanding_credit", "customer_history",
      "expenses", "expenses_report", "suppliers", "supplier_accounts", "supplier_credit",
      "payables", "purchases", "purchase_orders", "income", "financial_summaries",
      "employee_profiles", "roles", "permissions", "sales_attribution", ...ORDER_TRADE, "delivery",
    ],
    optionalCapabilities: ["manufacturing", "finished_goods", "multi_location", "commissions"],
    terminology: { product: "Produce", products: "Produce", customer: "Buyer", customers: "Buyers", inventory: "Produce", stock: "Produce stock", order: "Batch", orders: "Batches" },
    navigation: ["dashboard", "sell", "produce", "orders", "customers", "credit", "inventory", "suppliers", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "credit_owed", "expenses", "stock_alerts", "cash", "mpesa"],
    workflowKey: "production", units: ["kilogram", "gram", "sack", "bag", "crate", "litre", "piece"],
    focusQuestions: ["harvests", "batches", "seasons", "buyers", "tracks_expenses"],
    answers: { keeps_stock: true, keeps_customers: true, tracks_expenses: true },
  }),
  defineType({
    key: "agribusiness", label: "Agribusiness", group: "Farming", icon: "🚜",
    blurb: "Production, processing and trade in one place.",
    templateKey: "AGRIBUSINESS", sells: ["products"],
    capabilities: ["produce", "harvests", "production_batches", "manufacturing", "raw_materials", "finished_goods", "bill_of_materials", "work_orders", "production_costs", "units_of_measure", "unit_conversions", ...STOCK_TRADE, ...CREDIT_TRADE, "wholesale_pricing", "bulk_pricing", "supplier_credit", "payables", "purchase_orders", "multi_location", "stock_transfers", "employee_profiles", "roles", "permissions", "sales_attribution", ...ORDER_TRADE, "delivery"],
    optionalCapabilities: ["customer_tiers", "routes", "seasonal_records", "commissions"],
    terminology: { product: "Produce", products: "Produce", customer: "Buyer", customers: "Buyers", inventory: "Produce & inputs" },
    navigation: ["dashboard", "sell", "produce", "orders", "products", "customers", "credit", "inventory", "suppliers", "purchases", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "credit_owed", "supplier_debt", "stock_alerts", "expenses"],
    workflowKey: "production", units: ["kilogram", "sack", "bag", "litre", "crate", "piece"],
    focusQuestions: ["manufacturing", "batches", "production_costs", "warehouses"],
    answers: { keeps_stock: true, keeps_customers: true, has_suppliers: true },
  }),
];

/** ── Making & building (§18 MANUFACTURING, PRINTING) ────────────────────────── */
const MAKING: BusinessTypeProfile[] = [
  defineType({
    key: "manufacturing", label: "Manufacturing", group: "Making & building", icon: "🏭",
    blurb: "Raw materials, recipes, batches and finished goods.",
    templateKey: "MANUFACTURING", sells: ["products"],
    capabilities: [
      "manufacturing", "raw_materials", "bill_of_materials", "work_orders", "production_costs",
      "finished_goods", "production_batches", "wastage", "assembly", ...STOCK_TRADE,
      "units_of_measure", "unit_conversions", "stock_counts", "multi_location", "stock_transfers",
      ...CREDIT_TRADE, "wholesale_pricing", "supplier_credit", "payables", "supplier_debt",
      "purchase_orders", "partial_receiving", "employee_profiles", "roles", "permissions",
      "sales_attribution", "profitability", ...ORDER_TRADE, "delivery",
    ],
    optionalCapabilities: ["customer_tiers", "minimum_quantities", "routes", "commissions"],
    terminology: { product: "Finished product", products: "Finished goods", order: "Work order", orders: "Work orders", stock: "Raw material", inventory: "Materials & goods" },
    navigation: ["dashboard", "sell", "orders", "products", "inventory", "customers", "credit", "suppliers", "purchases", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "orders", "stock_alerts", "supplier_debt", "credit_owed", "expenses"],
    workflowKey: "production", units: ["piece", "kilogram", "gram", "litre", "metre", "box", "carton"],
    focusQuestions: ["manufacturing", "bom", "work_orders", "production_costs", "wastage"],
    answers: { keeps_stock: true, keeps_customers: true, manufacturing: true, has_suppliers: true },
  }),
  defineType({
    key: "workshop", label: "Workshop", group: "Making & building", icon: "🛠️",
    blurb: "Jobs, materials and made-to-order work.",
    templateKey: "MANUFACTURING", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "job_cards", "custom_orders", "estimates", "quotation", "deposits", "partial_payments", "parts_consumption", ...STOCK_TRADE, "units_of_measure", ...CREDIT_TRADE, "employee_profiles", "roles", "permissions", "technicians", ...ORDER_TRADE],
    optionalCapabilities: ["manufacturing", "commissions", "delivery"],
    terminology: { order: "Job", orders: "Jobs", product: "Item", products: "Items" },
    navigation: ["dashboard", "jobs", "sell", "products", "customers", "credit", "inventory", "suppliers", "expenses", "staff", "reports", "settings"],
    dashboard: ["pending_jobs", "today_sales", "credit_owed", "stock_alerts", "cash"],
    workflowKey: "garage", units: ["job", "hour", "piece", "metre"],
    focusQuestions: ["job_cards", "deposits", "orders"],
    answers: { keeps_stock: true, keeps_customers: true },
  }),
  defineType({
    key: "printing", label: "Printing", group: "Making & building", icon: "🖨️",
    blurb: "Jobs, artwork, materials, deposits and balances.",
    templateKey: "PRINTING", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "custom_orders", "artwork", "production_status", "quotation", "invoice", "deposits", "partial_payments", "job_cards", ...STOCK_TRADE, "units_of_measure", "customer_history", "customer_notes", ...ORDER_TRADE, "delivery", "pickup", "employee_profiles", "roles", "permissions"],
    optionalCapabilities: ["manufacturing", "customer_credit", "commissions"],
    terminology: { customer: "Client", customers: "Clients", order: "Job", orders: "Jobs", quote: "Quotation" },
    navigation: ["dashboard", "jobs", "sell", "products", "customers", "credit", "inventory", "expenses", "staff", "reports", "settings"],
    dashboard: ["orders", "today_sales", "credit_owed", "cash", "mpesa"],
    workflowKey: "project", units: ["piece", "metre", "pack", "hour"],
    focusQuestions: ["artwork", "production_status", "deposits", "quotations"],
    answers: { keeps_stock: true, keeps_customers: true, quotations: true },
  }),
  defineType({
    key: "construction", label: "Construction", group: "Making & building", icon: "🏗️",
    blurb: "Projects, materials, clients and progress payments.",
    templateKey: "PROFESSIONAL_SERVICE", sells: ["services", "products"],
    capabilities: ["projects", "contracts", "quotation", "invoice", "deposits", "partial_payments", "payment_schedules", ...STOCK_TRADE, "units_of_measure", "unit_conversions", "multi_location", "stock_transfers", ...CREDIT_TRADE, "supplier_credit", "payables", "supplier_debt", "purchase_orders", "partial_receiving", "employee_profiles", "roles", "permissions", "sales_attribution", "time_tracking", "profitability", "expenses", "expenses_report"],
    optionalCapabilities: ["job_cards", "work_orders", "commissions"],
    terminology: { customer: "Client", customers: "Clients", order: "Project", orders: "Projects", product: "Material", products: "Materials", quote: "Bill of quantities" },
    navigation: ["dashboard", "projects", "sell", "products", "customers", "credit", "inventory", "suppliers", "purchases", "expenses", "staff", "reports", "settings"],
    dashboard: ["orders", "today_sales", "credit_owed", "supplier_debt", "expenses", "stock_alerts"],
    workflowKey: "project", units: ["bag", "sack", "metre", "kilogram", "piece", "day"],
    focusQuestions: ["projects", "projects", "payment_schedules", "has_suppliers"],
    answers: { keeps_stock: true, keeps_customers: true, projects: true },
  }),
];

/** ── Professional (§18 PROFESSIONAL SERVICES) ───────────────────────────────── */
const PROFESSIONAL: BusinessTypeProfile[] = [
  defineType({
    key: "professional_services", label: "Professional services", group: "Professional", icon: "💼",
    blurb: "Clients, projects, retainers and invoices.",
    templateKey: "PROFESSIONAL_SERVICE", sells: ["services"],
    capabilities: [
      ...SERVICE_SALES, "projects", "retainers", "recurring_billing", "quotation", "invoice",
      "deposits", "partial_payments", "customer_history", "customer_notes", "clients",
      "customer_accounts", "receivables", "statements", "outstanding_credit", "expenses",
      "expenses_report", "employee_profiles", "roles", "permissions", "sales_attribution",
      "time_tracking", "profitability", "income", "financial_summaries", "bank", "card",
    ],
    optionalCapabilities: ["commissions", "contracts", "customer_credit"],
    terminology: { customer: "Client", customers: "Clients", order: "Project", orders: "Projects", sale: "Invoice", sales: "Invoices" },
    navigation: ["dashboard", "projects", "sell", "services", "customers", "credit", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "orders", "credit_owed", "expenses", "mpesa", "mpesa"],
    workflowKey: "project", units: ["hour", "day", "visit", "session"],
    focusQuestions: ["projects", "retainers", "time_tracking", "recurring", "quotations"],
    answers: { keeps_stock: false, keeps_customers: true, projects: true, quotations: true },
  }),
  defineType({
    key: "consultancy", label: "Consultancy", group: "Professional", icon: "📊",
    blurb: "Engagements, retainers and invoices.",
    templateKey: "PROFESSIONAL_SERVICE", sells: ["services"],
    capabilities: [...SERVICE_SALES, "projects", "retainers", "recurring_billing", "quotation", "invoice", "deposits", "partial_payments", "customer_history", "customer_notes", "customer_accounts", "receivables", "statements", "expenses", "expenses_report", "employee_profiles", "roles", "permissions", "time_tracking", "profitability", "bank", "card"],
    optionalCapabilities: ["contracts", "commissions"],
    terminology: { customer: "Client", customers: "Clients", order: "Engagement", orders: "Engagements", sale: "Invoice", sales: "Invoices" },
    navigation: ["dashboard", "projects", "sell", "services", "customers", "credit", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "orders", "credit_owed", "expenses"],
    workflowKey: "project", units: ["hour", "day", "visit"],
    focusQuestions: ["projects", "retainers", "time_tracking"],
    answers: { keeps_stock: false, keeps_customers: true, projects: true },
  }),
  defineType({
    key: "agency", label: "Agency", group: "Professional", icon: "📣",
    blurb: "Client projects, retainers and campaign spend.",
    templateKey: "PROFESSIONAL_SERVICE", sells: ["services"],
    capabilities: [...SERVICE_SALES, "projects", "retainers", "recurring_billing", "quotation", "invoice", "deposits", "partial_payments", "customer_history", "customer_notes", "customer_accounts", "receivables", "statements", "expenses", "expenses_report", "employee_profiles", "roles", "permissions", "sales_attribution", "commissions", "time_tracking", "profitability"],
    optionalCapabilities: ["contracts", "custom_orders"],
    terminology: { customer: "Client", customers: "Clients", order: "Project", orders: "Projects", sale: "Invoice", sales: "Invoices" },
    navigation: ["dashboard", "projects", "sell", "services", "customers", "credit", "expenses", "staff", "reports", "settings"],
    dashboard: ["orders", "today_sales", "credit_owed", "expenses", "staff_performance"],
    workflowKey: "project", units: ["hour", "day", "session"],
    focusQuestions: ["projects", "retainers", "commissions"],
    answers: { keeps_stock: false, keeps_customers: true, projects: true },
  }),
];

/** ── Property & education (§18) ─────────────────────────────────────────────── */
const PROPERTY_EDUCATION: BusinessTypeProfile[] = [
  defineType({
    key: "real_estate", label: "Real estate", group: "Property & education", icon: "🏘️",
    blurb: "Properties, units, tenants, rent and deposits.",
    templateKey: "REAL_ESTATE", sells: ["services"],
    capabilities: [
      "properties", "tenants", "landlords", "rent", "customer_accounts", "receivables",
      "statements", "outstanding_credit", "partial_payments", "payment_plans", "invoice",
      "quotation", "deposits", "customer_history", "customer_notes", "expenses",
      "expenses_report", "employee_profiles", "roles", "permissions", "commissions",
      "sales_attribution", "financial_summaries", "bank", "mpesa", "cash",
    ],
    optionalCapabilities: ["multi_location", "projects", "projects"],
    terminology: { customer: "Tenant", customers: "Tenants", supplier: "Landlord", suppliers: "Landlords", product: "Unit", products: "Properties", sale: "Rent receipt", sales: "Rent receipts", order: "Tenancy", orders: "Tenancies" },
    navigation: ["dashboard", "orders", "products", "customers", "credit", "suppliers", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "credit_owed", "expenses", "orders", "mpesa"],
    workflowKey: "project", units: ["day", "piece", "visit"],
    focusQuestions: ["properties", "tenants", "rent", "landlords", "payment_plans"],
    answers: { keeps_stock: false, keeps_customers: true, credit_frequency: "sometimes" },
  }),
  defineType({
    key: "education", label: "Education / training", group: "Property & education", icon: "🎓",
    blurb: "Students, courses, fees and payment plans.",
    templateKey: "EDUCATION", sells: ["services"],
    capabilities: [
      "students", "courses", "fees", "payment_plans", "instructors", "appointments",
      "customer_accounts", "receivables", "statements", "outstanding_credit",
      "partial_payments", "invoice", "receipt", "customer_history", "customer_notes",
      "expenses", "expenses_report", "employee_profiles", "roles", "permissions",
      "sales_attribution", "financial_summaries", "mpesa", "cash", "bank",
    ],
    optionalCapabilities: ["subscriptions", "recurring_billing", "loyalty", "stock_levels"],
    terminology: { customer: "Student", customers: "Students", product: "Course", products: "Courses", service: "Class", services: "Classes", sale: "Fee payment", sales: "Fee payments", staff: "Instructor", order: "Enrolment", orders: "Enrolments" },
    navigation: ["dashboard", "sell", "products", "customers", "credit", "appointments", "expenses", "staff", "reports", "settings"],
    dashboard: ["today_sales", "credit_owed", "new_customers", "mpesa", "cash", "expenses"],
    workflowKey: "generic", units: ["session", "day", "visit"],
    focusQuestions: ["courses", "fees", "payment_plans", "instructors"],
    answers: { keeps_stock: false, keeps_customers: true, credit_frequency: "sometimes" },
  }),
];

/** ── Events & creative (§18 EVENTS) ─────────────────────────────────────────── */
const EVENTS: BusinessTypeProfile[] = [
  defineType({
    key: "events", label: "Events", group: "Events & creative", icon: "🎉",
    blurb: "Clients, packages, deposits and payment schedules.",
    templateKey: "EVENTS", sells: ["services", "products"],
    capabilities: ["events", "event_packages", "payment_schedules", "quotation", "invoice", "deposits", "partial_payments", "projects", "customer_history", "customer_notes", "customer_accounts", "receivables", "statements", "expenses", "expenses_report", "suppliers", "purchases", "employee_profiles", "roles", "permissions", "commissions", "sales_attribution", ...ORDER_TRADE],
    optionalCapabilities: ["stock_levels", "delivery", "loyalty"],
    terminology: { customer: "Client", customers: "Clients", order: "Event", orders: "Events", sale: "Invoice", sales: "Invoices", quote: "Proposal" },
    navigation: ["dashboard", "orders", "projects", "products", "customers", "credit", "suppliers", "expenses", "staff", "reports", "settings"],
    dashboard: ["orders", "today_sales", "credit_owed", "expenses", "pending_deliveries"],
    workflowKey: "project", units: ["piece", "day", "visit", "session"],
    focusQuestions: ["events", "packages", "payment_schedules", "deposits"],
    answers: { keeps_stock: false, keeps_customers: true, projects: true },
  }),
  defineType({
    key: "photography", label: "Photography", group: "Events & creative", icon: "📸",
    blurb: "Shoots, packages, deposits and deliveries.",
    templateKey: "EVENTS", sells: ["services", "products"],
    capabilities: [...SERVICE_SALES, "service_packages", "appointments", "custom_orders", "quotation", "invoice", "deposits", "partial_payments", "projects", "customer_history", "customer_notes", "expenses", "expenses_report", "employee_profiles", "roles", "permissions", ...ORDER_TRADE, "delivery"],
    optionalCapabilities: ["stock_levels", "commissions", "loyalty"],
    terminology: { customer: "Client", customers: "Clients", order: "Shoot", orders: "Shoots", service: "Package", services: "Packages" },
    navigation: ["dashboard", "orders", "appointments", "sell", "services", "customers", "credit", "expenses", "reports", "settings"],
    dashboard: ["orders", "appointments", "today_sales", "credit_owed", "mpesa"],
    workflowKey: "project", units: ["session", "hour", "piece"],
    focusQuestions: ["packages", "appointments", "deposits"],
    answers: { keeps_stock: false, keeps_customers: true, appointments: true },
  }),
];

/** ── Other ──────────────────────────────────────────────────────────────────── */
const OTHER: BusinessTypeProfile[] = [
  defineType({
    key: "other", label: "Something else", group: "Other", icon: "✨",
    blurb: "Tell us what you do and we'll configure around it.",
    templateKey: "SERVICE_BUSINESS", sells: ["products", "services"],
    capabilities: [...STOCK_TRADE, "returns", "discounts", "customer_history"],
    optionalCapabilities: [
      "customer_credit", "supplier_credit", "purchase_orders", "delivery", "appointments",
      "projects", "custom_orders", "variants", "barcodes", "expiry_tracking",
      "manufacturing", "employee_profiles", "commissions", "multi_location",
    ],
    dashboard: ["today_sales", "cash", "mpesa", "credit_owed", "stock_alerts", "expenses"],
    units: ["piece", "kilogram", "litre", "metre", "hour", "visit", "custom"],
    focusQuestions: ["business_other"],
    answers: {},
  }),
];

export const BUSINESS_TYPES: BusinessTypeProfile[] = [
  ...FOOD, ...RETAIL, ...TRADE, ...BEAUTY, ...MOTORING, ...SERVICES,
  ...HEALTH, ...FARMING, ...MAKING, ...PROFESSIONAL, ...PROPERTY_EDUCATION,
  ...EVENTS, ...OTHER,
];

export const BUSINESS_TYPE_KEYS: BusinessTypeKey[] = BUSINESS_TYPES.map((type) => type.key);

const TYPE_BY_KEY = new Map(BUSINESS_TYPES.map((type) => [type.key, type]));

const ALIAS_INDEX = new Map<string, BusinessTypeKey>();
for (const type of BUSINESS_TYPES) {
  ALIAS_INDEX.set(type.key.toLowerCase(), type.key);
  ALIAS_INDEX.set(type.label.toLowerCase(), type.key);
  for (const alias of type.aliases) ALIAS_INDEX.set(alias.toLowerCase(), type.key);
}
/** Legacy JATA AFTERCALL categories map onto POS business types (§80: nothing is renamed). */
const LEGACY_CATEGORY_MAP: Record<string, BusinessTypeKey> = {
  "food & restaurant": "restaurant",
  "beauty & cosmetics": "beauty_products",
  "salon & barber": "salon",
  "fashion & clothing": "boutique",
  "retail & general shop": "retail",
  "electronics": "electronics",
  "automotive": "garage",
  "real estate": "real_estate",
  "furniture & home": "furniture",
  "fitness & wellness": "spa",
  "creative & photography": "photography",
  "professional services": "professional_services",
  "hospitality": "hotel",
  "education & training": "education",
  "home & technical services": "cleaning_service",
  "other": "other",
};

export function getBusinessType(key: BusinessTypeKey | null | undefined): BusinessTypeProfile {
  return TYPE_BY_KEY.get(key ?? "") ?? TYPE_BY_KEY.get("other")!;
}

export function isBusinessTypeKey(key: unknown): key is BusinessTypeKey {
  return typeof key === "string" && TYPE_BY_KEY.has(key);
}

/** Resolve a free-text answer, a legacy category or an alias onto a business type (§19). */
export function resolveBusinessType(input: string | null | undefined): BusinessTypeProfile {
  const value = (input ?? "").trim().toLowerCase();
  if (!value) return getBusinessType("other");
  if (ALIAS_INDEX.has(value)) return getBusinessType(ALIAS_INDEX.get(value));
  if (LEGACY_CATEGORY_MAP[value]) return getBusinessType(LEGACY_CATEGORY_MAP[value]);
  // Word-level match: "hardware store in Kisumu" still finds `hardware`.
  const words = value.split(/[^a-z]+/).filter(Boolean);
  for (const word of words) {
    if (ALIAS_INDEX.has(word)) return getBusinessType(ALIAS_INDEX.get(word));
  }
  for (const [alias, key] of ALIAS_INDEX) {
    if (alias.length > 3 && value.includes(alias)) return getBusinessType(key);
  }
  return getBusinessType("other");
}

export function businessTypesByGroup(): { group: BusinessTypeGroup; types: BusinessTypeProfile[] }[] {
  const groups = new Map<BusinessTypeGroup, BusinessTypeProfile[]>();
  for (const type of BUSINESS_TYPES) {
    const list = groups.get(type.group) ?? [];
    list.push(type);
    groups.set(type.group, list);
  }
  return [...groups.entries()].map(([group, types]) => ({ group, types }));
}

/**
 * Map a free-text description onto capabilities (§19). Used for "Something else" and later by
 * the natural-language assistant (§64): words in the description switch capabilities on, and
 * the questionnaire then asks only what is still missing (§41).
 */
const DESCRIPTION_SIGNALS: { pattern: RegExp; capabilities: CapabilityKey[]; answers?: QuestionnaireAnswers }[] = [
  { pattern: /\b(sell|shop|store|retail|goods|products|merchandise)\b/i, capabilities: ["product_sales", "catalogue", "products"], answers: { sells: ["products"] } },
  { pattern: /\b(stock|inventory|store room|stores|warehouse)\b/i, capabilities: ["stock_levels", "stock_adjustments", "low_stock_alerts", "units_of_measure"], answers: { keeps_stock: true } },
  { pattern: /\b(service|labour|labor|repair|treatment|session|consult|training|teach|clean|salon|cut|design)\b/i, capabilities: ["service_sales", "services"], answers: { sells: ["services"] } },
  { pattern: /\b(credit|pay later|deni|madeni|on account|tab)\b/i, capabilities: ["customer_accounts", "customer_credit", "credit_limits", "receivables", "statements", "outstanding_credit"], answers: { credit_frequency: "sometimes" } },
  { pattern: /\b(m-?pesa|mpesa)\b/i, capabilities: ["mpesa"], answers: {} },
  { pattern: /\b(cash|money)\b/i, capabilities: ["cash"], answers: {} },
  { pattern: /\b(bank|transfer|equity|kcb|coop)\b/i, capabilities: ["bank"], answers: {} },
  { pattern: /\b(card|visa|mastercard|swipe)\b/i, capabilities: ["card"], answers: {} },
  { pattern: /\b(deliver|delivery|rider|dispatch|boda)\b/i, capabilities: ["delivery", "orders", "order_status", "fulfilment"], answers: { delivery: true, orders: true } },
  { pattern: /\b(pick ?up|collect|collection)\b/i, capabilities: ["pickup"], answers: { pickup: true } },
  { pattern: /\b(supplier|suppliers|vendor|distributor|wholesaler)\b/i, capabilities: ["suppliers", "supplier_accounts", "purchases"], answers: { has_suppliers: true } },
  { pattern: /\b(buy now pay later|supplier credit|trade credit)\b/i, capabilities: ["supplier_credit", "payables", "supplier_debt"], answers: { supplier_credit: true } },
  { pattern: /\b(purchase order|order stock|indent)\b/i, capabilities: ["purchase_orders", "partial_receiving"], answers: { purchase_orders: true } },
  { pattern: /\b(expense|expenses|rent|electricity|salaries|wages|fuel|transport costs)\b/i, capabilities: ["expenses", "expenses_report"], answers: { tracks_expenses: true } },
  { pattern: /\b(staff|employee|team|cashier|salesperson|worker|technician|stylist)\b/i, capabilities: ["employee_profiles", "roles", "permissions"], answers: { has_staff: true } },
  { pattern: /\b(commission|commissions)\b/i, capabilities: ["sales_attribution", "commissions", "staff_performance"], answers: { sales_attribution: true, commissions: true } },
  { pattern: /\b(branch|branches|outlet|outlets|location|locations|multiple shops)\b/i, capabilities: ["multi_location", "stock_transfers"], answers: { multi_branch: true } },
  { pattern: /\b(appointment|appointments|booking|bookings|reservation|calendar)\b/i, capabilities: ["appointments", "bookings", "reservations"], answers: { appointments: true } },
  { pattern: /\b(barcode|scan|scanner)\b/i, capabilities: ["barcodes", "skus"], answers: { barcode: true } },
  { pattern: /\b(size|sizes|colour|colors|color|shade|shades|variant|variants)\b/i, capabilities: ["variants", "sizes_colours"], answers: { variants: true } },
  { pattern: /\b(expir|expiry|use by|best before|shelf life)\b/i, capabilities: ["expiry_tracking"], answers: { expiry: true } },
  { pattern: /\b(batch|batches|lot)\b/i, capabilities: ["batch_tracking"], answers: { batches: true } },
  { pattern: /\b(serial|serials|imei|warranty)\b/i, capabilities: ["serial_numbers"], answers: { serials: true } },
  { pattern: /\b(kilo|kilogram|kg|gram|weight)\b/i, capabilities: ["units_of_measure"], answers: { units: ["kilogram", "gram"] } },
  { pattern: /\b(metre|meter|length|yard|foot)\b/i, capabilities: ["units_of_measure"], answers: { units: ["metre"] } },
  { pattern: /\b(litre|liter|volume)\b/i, capabilities: ["units_of_measure"], answers: { units: ["litre"] } },
  { pattern: /\b(carton|cartons|box|boxes|dozen|bulk|wholesale)\b/i, capabilities: ["wholesale_pricing", "unit_conversions"], answers: { wholesale_pricing: true } },
  { pattern: /\b(discount|discounts|offer|offers|promotion)\b/i, capabilities: ["discounts", "promotions"], answers: { discounts: true } },
  { pattern: /\b(deposit|deposits|advance|part payment)\b/i, capabilities: ["deposits", "partial_payments"], answers: { deposits: true } },
  { pattern: /\b(invoice|invoices|receipt|receipts|quotation|quote|estimate)\b/i, capabilities: ["invoice", "quotation"], answers: { quotations: true } },
  { pattern: /\b(tax|vat)\b/i, capabilities: ["tax"], answers: { tax: true } },
  { pattern: /\b(whatsapp|whats app)\b/i, capabilities: ["whatsapp_orders", "orders"], answers: { order_channels: ["whatsapp"] } },
  { pattern: /\b(phone|call|calls)\b/i, capabilities: ["phone_orders", "orders"], answers: {} },
  { pattern: /\b(website|online|web|e-?commerce)\b/i, capabilities: ["online_orders", "business_page_orders", "orders"], answers: { order_channels: ["online", "business_page"] } },
  { pattern: /\b(manufactur|produce|production|make|making|assemble|assembly|recipe|bom)\b/i, capabilities: ["manufacturing", "raw_materials", "bill_of_materials", "work_orders", "finished_goods"], answers: { manufacturing: true } },
  { pattern: /\b(farm|harvest|crop|maize|produce|dairy|poultry|livestock|agri)\b/i, capabilities: ["produce", "harvests", "production_batches", "seasonal_records", "buyers"], answers: {} },
  { pattern: /\b(vehicle|car|cars|motorbike|registration|number plate|job card)\b/i, capabilities: ["vehicles", "job_cards", "labour", "estimates", "technicians", "parts_consumption"], answers: {} },
  { pattern: /\b(menu|dish|dishes|kitchen|table|tables|dine|takeaway|take-away|food)\b/i, capabilities: ["menu", "kitchen_orders", "tables", "ingredients", "modifiers"], answers: {} },
  { pattern: /\b(garment|garments|laundry|wash|dry clean|iron)\b/i, capabilities: ["garments", "service_types"], answers: {} },
  { pattern: /\b(project|projects|contract|contracts|retainer)\b/i, capabilities: ["projects", "contracts", "retainers"], answers: { projects: true } },
  { pattern: /\b(rent|tenant|tenants|landlord|property|properties|unit|units)\b/i, capabilities: ["properties", "tenants", "landlords", "rent"], answers: {} },
  { pattern: /\b(student|students|course|courses|class|classes|fees|tuition|school)\b/i, capabilities: ["students", "courses", "fees", "payment_plans", "instructors"], answers: {} },
  { pattern: /\b(event|events|wedding|conference|package|packages)\b/i, capabilities: ["events", "event_packages", "payment_schedules"], answers: {} },
  { pattern: /\b(loyalty|reward|points|regulars)\b/i, capabilities: ["loyalty", "customer_history"], answers: { loyalty: true } },
  { pattern: /\b(customer|customers|client|clients|repeat|regular)\b/i, capabilities: ["customer_profiles", "customer_history"], answers: { keeps_customers: true } },
];

export type DescriptionReading = {
  capabilities: CapabilityKey[];
  answers: QuestionnaireAnswers;
  /** Words that matched, so the UI can explain what it understood (§64, §65). */
  matched: string[];
};

export function readBusinessDescription(description: string): DescriptionReading {
  const capabilities = new Set<CapabilityKey>();
  const answers: QuestionnaireAnswers = {};
  const matched: string[] = [];
  const text = description ?? "";
  for (const signal of DESCRIPTION_SIGNALS) {
    const found = text.match(signal.pattern);
    if (!found) continue;
    matched.push(found[0].toLowerCase());
    for (const capability of signal.capabilities) capabilities.add(capability);
    for (const [key, value] of Object.entries(signal.answers ?? {})) {
      const existing = answers[key];
      if (Array.isArray(existing) && Array.isArray(value)) {
        answers[key] = [...new Set([...existing, ...value])] as string[];
      } else if (existing === undefined) {
        answers[key] = value as never;
      }
    }
  }
  return { capabilities: [...capabilities], answers, matched: [...new Set(matched)] };
}
