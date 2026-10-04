/**
 * Generated interface (§23, §24, §34, §35, §38, §60)
 *
 * The POS a business sees is produced from its configuration: which modules exist, which
 * metrics matter, which reports are meaningful, which quick actions help, and what an empty
 * screen should teach next. Nothing here knows what a restaurant is — it only reads
 * capabilities, so a new trade needs no new code (§52).
 */

import { getCapability, hasCapability } from "./capabilities";
import { resolveTerminology, type Terminology } from "./terminology";
import { resolveStates } from "./workflow";
import type {
  CapabilityKey, DashboardCardKey, PosConfiguration, PosModuleKey, ReportKey,
} from "./types";

// ── Navigation (§24) ──────────────────────────────────────────────────────────

export type NavItem = {
  key: PosModuleKey;
  label: string;
  href: string;
  icon: string;
  /** The primary action on that screen (§38: the obvious next thing). */
  action?: { label: string; href?: string };
};

/** Which capability makes a module worth showing. `null` means always. */
const MODULE_REQUIREMENTS: Record<PosModuleKey, CapabilityKey | null> = {
  dashboard: null,
  sell: "pos_sale",
  history: "pos_sale",
  // Every business that can take a payment gets the JATA Payment Wallet, whatever it sells (§10).
  payments: null,
  orders: "orders",
  products: "catalogue",
  services: "services",
  menu: "menu",
  customers: "customer_profiles",
  credit: "customer_accounts",
  inventory: "stock_levels",
  suppliers: "suppliers",
  purchases: "purchases",
  expenses: "expenses",
  staff: "employee_profiles",
  appointments: "appointments",
  jobs: "job_cards",
  projects: "projects",
  produce: "produce",
  branches: "multi_location",
  reports: null,
  settings: null,
};

const MODULE_META: Record<PosModuleKey, { icon: string; order: number }> = {
  dashboard: { icon: "🏠", order: 0 },
  sell: { icon: "➕", order: 1 },
  history: { icon: "📜", order: 2 },
  // The JATA Payment Wallet sits beside the till: it is where the merchant sees money arriving.
  payments: { icon: "💳", order: 2.5 },
  orders: { icon: "🧾", order: 3 },
  appointments: { icon: "📅", order: 4 },
  jobs: { icon: "🔧", order: 5 },
  projects: { icon: "📋", order: 6 },
  produce: { icon: "🌽", order: 7 },
  menu: { icon: "🍽️", order: 8 },
  products: { icon: "📦", order: 9 },
  services: { icon: "🛠️", order: 10 },
  customers: { icon: "👥", order: 11 },
  credit: { icon: "📒", order: 12 },
  inventory: { icon: "🏷️", order: 13 },
  branches: { icon: "🏬", order: 14 },
  suppliers: { icon: "🚚", order: 15 },
  purchases: { icon: "📥", order: 16 },
  expenses: { icon: "💸", order: 17 },
  staff: { icon: "🧑🏾‍💼", order: 18 },
  reports: { icon: "📈", order: 19 },
  settings: { icon: "⚙️", order: 20 },
};

/** Where a module lives in the URL, when its name and its path differ. */
const MODULE_PATH: Partial<Record<PosModuleKey, string>> = {
  history: "sales",
};

/**
 * Modules this configuration earns, ordered by the business type's preference and then by
 * the platform default. A restaurant never sees hardware stock controls; a consultancy never
 * sees a stock room (§23).
 */
export function availableModules(config: PosConfiguration): PosModuleKey[] {
  const allowed = (Object.keys(MODULE_REQUIREMENTS) as PosModuleKey[]).filter((key) => {
    const requirement = MODULE_REQUIREMENTS[key];
    if (!requirement) return true;
    if (key === "credit") return hasCapability(config, "customer_credit") || hasCapability(config, "customer_accounts") || hasCapability(config, "fees") || hasCapability(config, "rent");
    if (key === "products") return hasCapability(config, "catalogue") || hasCapability(config, "products") || hasCapability(config, "menu") || hasCapability(config, "properties") || hasCapability(config, "courses");
    if (key === "appointments") return hasCapability(config, "appointments") || hasCapability(config, "bookings") || hasCapability(config, "reservations");
    if (key === "jobs") return hasCapability(config, "job_cards") || hasCapability(config, "work_orders") || hasCapability(config, "production_status");
    if (key === "projects") return hasCapability(config, "projects") || hasCapability(config, "events") || hasCapability(config, "contracts");
    if (key === "purchases") return hasCapability(config, "purchases") || hasCapability(config, "purchase_orders");
    if (key === "branches") return hasCapability(config, "multi_location") || config.branches?.enabled === true;
    return hasCapability(config, requirement);
  });
  const allowedSet = new Set(allowed);
  const preferred = (config.navigation ?? []).filter((key) => allowedSet.has(key));
  // Sales history belongs beside the till, wherever the trade's preferred order put the till.
  if (allowedSet.has("history") && !preferred.includes("history")) {
    const sellIndex = preferred.indexOf("sell");
    if (sellIndex >= 0) preferred.splice(sellIndex + 1, 0, "history");
    else preferred.push("history");
  }
  const rest = allowed
    .filter((key) => !preferred.includes(key))
    .sort((a, b) => MODULE_META[a].order - MODULE_META[b].order);
  return [...preferred, ...rest];
}

export function moduleLabel(config: PosConfiguration, key: PosModuleKey): string {
  const terminology = resolveTerminology(config);
  switch (key) {
    case "dashboard": return "Home";
    case "sell": return `New ${terminology.sale}`;
    case "history": return `${terminology.sales} history`;
    case "payments": return "Payments";
    case "orders": return terminology.orders;
    case "products": return config.business?.typeKey === "real_estate" ? terminology.products : terminology.products;
    case "services": return terminology.services;
    case "menu": return "Menu";
    case "customers": return terminology.customers;
    case "credit": return hasCapability(config, "customer_credit") ? "Credit" : "Accounts";
    case "inventory": return terminology.inventory;
    case "suppliers": return terminology.suppliers;
    case "purchases": return "Purchases";
    case "expenses": return terminology.expenses;
    case "staff": return terminology.staff;
    case "appointments": return "Appointments";
    case "jobs": return terminology.orders === "Jobs" ? "Jobs" : "Jobs";
    case "projects": return terminology.orders === "Projects" ? "Projects" : "Projects";
    case "produce": return "Produce";
    case "branches": return terminology.branches;
    case "reports": return "Reports";
    case "settings": return "Settings";
    default: return String(key);
  }
}

export function buildNavigation(config: PosConfiguration, basePath: string): NavItem[] {
  return availableModules(config).map((key) => {
    const label = moduleLabel(config, key);
    const item: NavItem = {
      key,
      label,
      href: key === "dashboard" ? basePath : `${basePath}/${MODULE_PATH[key] ?? key}`,
      icon: MODULE_META[key].icon,
    };
    if (key === "dashboard") {
      item.action = { label: `+ New ${resolveTerminology(config).sale}`, href: `${basePath}/sell` };
    }
    return item;
  });
}

// ── Dashboard (§34) ───────────────────────────────────────────────────────────

const CARD_REQUIREMENTS: Record<DashboardCardKey, CapabilityKey | null> = {
  today_sales: null,
  orders: "orders",
  cash: "cash",
  mpesa: "mpesa",
  credit_owed: "customer_credit",
  supplier_debt: "supplier_credit",
  stock_alerts: "low_stock_alerts",
  expenses: "expenses",
  appointments: "appointments",
  pending_jobs: "job_cards",
  pending_deliveries: "delivery",
  staff_performance: "sales_attribution",
  inventory_value: "inventory_valuation",
  new_customers: "customer_profiles",
  top_products: "best_sellers",
  kitchen_queue: "kitchen_orders",
};

const CARD_LABELS: Record<DashboardCardKey, string> = {
  today_sales: "Today's sales",
  orders: "Open orders",
  cash: "Cash today",
  mpesa: "M-Pesa today",
  credit_owed: "Owed to you",
  supplier_debt: "You owe",
  stock_alerts: "Low stock",
  expenses: "Expenses this month",
  appointments: "Today's appointments",
  pending_jobs: "Jobs in progress",
  pending_deliveries: "Deliveries outstanding",
  staff_performance: "Staff today",
  inventory_value: "Stock value",
  new_customers: "New customers",
  top_products: "Best sellers",
  kitchen_queue: "In the kitchen",
};

/** Cards this business should see — never every metric to every business (§34). */
export function deriveDashboardCards(config: PosConfiguration): DashboardCardKey[] {
  const configured = (config.dashboard ?? []) as DashboardCardKey[];
  const allowed = configured.filter((key) => {
    const requirement = CARD_REQUIREMENTS[key];
    if (requirement === undefined) return false;
    if (requirement === null) return true;
    if (key === "appointments") return hasCapability(config, "appointments") || hasCapability(config, "bookings");
    if (key === "pending_jobs") return hasCapability(config, "job_cards") || hasCapability(config, "work_orders");
    return hasCapability(config, requirement);
  });
  const baseline: DashboardCardKey[] = ["today_sales"];
  if (hasCapability(config, "cash")) baseline.push("cash");
  if (hasCapability(config, "mpesa")) baseline.push("mpesa");
  if (hasCapability(config, "customer_credit")) baseline.push("credit_owed");
  if (hasCapability(config, "low_stock_alerts")) baseline.push("stock_alerts");
  const merged = [...new Set([...allowed, ...baseline])];
  return merged.slice(0, 8);
}

export function cardLabel(key: DashboardCardKey): string {
  return CARD_LABELS[key] ?? String(key);
}

// ── Quick actions (§24, §38) ──────────────────────────────────────────────────

export type QuickAction = { key: string; label: string; href: string; icon: string; primary?: boolean };

export function deriveQuickActions(config: PosConfiguration, basePath: string): QuickAction[] {
  const terminology = resolveTerminology(config);
  const actions: QuickAction[] = [];
  if (hasCapability(config, "pos_sale")) {
    actions.push({ key: "new_sale", label: `New ${terminology.sale}`, href: `${basePath}/sell`, icon: "➕", primary: true });
  }
  if (hasCapability(config, "orders")) {
    actions.push({ key: "new_order", label: `New ${terminology.order}`, href: `${basePath}/orders`, icon: "🧾" });
  }
  if (hasCapability(config, "appointments") || hasCapability(config, "bookings")) {
    actions.push({ key: "new_appointment", label: "New appointment", href: `${basePath}/appointments`, icon: "📅" });
  }
  if (hasCapability(config, "customer_credit")) {
    actions.push({ key: "collect_payment", label: "Collect a payment", href: `${basePath}/credit`, icon: "📒" });
  }
  if (hasCapability(config, "stock_adjustments")) {
    actions.push({ key: "adjust_stock", label: `Adjust ${terminology.stock.toLowerCase()}`, href: `${basePath}/inventory`, icon: "🏷️" });
  }
  if (hasCapability(config, "expenses")) {
    actions.push({ key: "record_expense", label: "Record an expense", href: `${basePath}/expenses`, icon: "💸" });
  }
  if (hasCapability(config, "purchases")) {
    actions.push({ key: "record_purchase", label: "Record a purchase", href: `${basePath}/purchases`, icon: "📥" });
  }
  if (hasCapability(config, "catalogue") || hasCapability(config, "products")) {
    actions.push({ key: "add_product", label: `Add ${terminology.product.toLowerCase()}`, href: `${basePath}/products`, icon: "📦" });
  }
  return actions.slice(0, 6);
}

// ── Reports (§35) ─────────────────────────────────────────────────────────────

export type ReportDefinition = {
  key: ReportKey;
  label: string;
  blurb: string;
  group: "Sales" | "Money" | "Stock" | "People" | "Trade";
  capability: CapabilityKey | null;
  /** Whether the numbers are recorded facts or calculated (§35). */
  basis: "recorded" | "calculated" | "estimate";
};

export const REPORT_CATALOGUE: ReportDefinition[] = [
  { key: "daily_sales", label: "Daily sales", blurb: "Everything sold today.", group: "Sales", capability: "daily_sales", basis: "recorded" },
  { key: "weekly_sales", label: "Weekly sales", blurb: "The last seven days.", group: "Sales", capability: "weekly_sales", basis: "recorded" },
  { key: "monthly_sales", label: "Monthly sales", blurb: "This month so far.", group: "Sales", capability: "monthly_sales", basis: "recorded" },
  { key: "gross_sales", label: "Gross sales", blurb: "Before discounts and refunds.", group: "Sales", capability: "daily_sales", basis: "calculated" },
  { key: "net_sales", label: "Net sales", blurb: "After discounts, refunds and returns.", group: "Sales", capability: "daily_sales", basis: "calculated" },
  { key: "refunds", label: "Refunds & returns", blurb: "Money given back and goods returned.", group: "Sales", capability: "refunds", basis: "recorded" },
  { key: "payment_breakdown", label: "Payment methods", blurb: "Cash, M-Pesa, bank, card and credit.", group: "Money", capability: "payment_breakdown", basis: "recorded" },
  { key: "outstanding_credit", label: "Outstanding credit", blurb: "Who owes you, oldest first.", group: "Money", capability: "outstanding_credit", basis: "recorded" },
  { key: "supplier_debt", label: "Supplier debt", blurb: "Who you owe, oldest first.", group: "Money", capability: "supplier_debt", basis: "recorded" },
  { key: "expenses", label: "Expenses", blurb: "By category and month.", group: "Money", capability: "expenses_report", basis: "recorded" },
  { key: "profitability", label: "Profitability", blurb: "Sales less cost of goods and expenses.", group: "Money", capability: "profitability", basis: "calculated" },
  { key: "inventory_value", label: "Stock value", blurb: "What your stock is worth at cost.", group: "Stock", capability: "inventory_value", basis: "calculated" },
  { key: "best_sellers", label: "Best sellers", blurb: "Your most popular items.", group: "Stock", capability: "best_sellers", basis: "recorded" },
  { key: "slow_movers", label: "Slow movers", blurb: "Items that have not sold recently.", group: "Stock", capability: "slow_movers", basis: "calculated" },
  { key: "customer_activity", label: "Customer activity", blurb: "Who buys, and how often.", group: "People", capability: "customer_activity", basis: "recorded" },
  { key: "staff_performance", label: "Staff performance", blurb: "Sales by person.", group: "People", capability: "staff_performance", basis: "recorded" },
  { key: "commissions", label: "Commissions", blurb: "What each person earned.", group: "People", capability: "commissions", basis: "calculated" },
  { key: "channel_attribution", label: "Sales by channel", blurb: "Walk-in, phone, WhatsApp, your page.", group: "People", capability: "channel_attribution", basis: "recorded" },
  { key: "ingredient_usage", label: "Ingredient usage", blurb: "What the kitchen used.", group: "Trade", capability: "recipes", basis: "calculated" },
  { key: "job_profitability", label: "Job profitability", blurb: "Labour and parts per job.", group: "Trade", capability: "job_cards", basis: "calculated" },
  { key: "produce", label: "Produce", blurb: "Harvests, quantities and buyers.", group: "Trade", capability: "produce", basis: "recorded" },
  { key: "production", label: "Production", blurb: "Batches, inputs and outputs.", group: "Trade", capability: "manufacturing", basis: "recorded" },
  { key: "rent", label: "Rent", blurb: "Collected and outstanding.", group: "Trade", capability: "rent", basis: "recorded" },
  { key: "projects", label: "Projects", blurb: "Progress, deposits and balances.", group: "Trade", capability: "projects", basis: "recorded" },
];

export function deriveReports(config: PosConfiguration): ReportKey[] {
  return REPORT_CATALOGUE
    .filter((report) => !report.capability || hasCapability(config, report.capability))
    .map((report) => report.key);
}

export function reportDefinitions(config: PosConfiguration): ReportDefinition[] {
  const enabled = new Set(deriveReports(config));
  return REPORT_CATALOGUE.filter((report) => enabled.has(report.key));
}

// ── Empty states (§60) ────────────────────────────────────────────────────────

export type EmptyState = { title: string; body: string; action: { label: string; href: string } };

export function emptyStateFor(config: PosConfiguration, module: PosModuleKey, basePath: string): EmptyState {
  const terminology: Terminology = resolveTerminology(config);
  switch (module) {
    case "products":
    case "menu":
      return {
        title: `No ${terminology.products.toLowerCase()} yet`,
        body: `Add your first ${terminology.product.toLowerCase()} to start selling.`,
        action: { label: `+ Add ${terminology.product}`, href: `${basePath}/products?new=1` },
      };
    case "services":
      return {
        title: `No ${terminology.services.toLowerCase()} yet`,
        body: `Add the work you do, with a price and how long it takes.`,
        action: { label: `+ Add ${terminology.service}`, href: `${basePath}/services?new=1` },
      };
    case "customers":
      return {
        title: `No ${terminology.customers.toLowerCase()} yet`,
        body: `Add a ${terminology.customer.toLowerCase()} so you can see their history and balance.`,
        action: { label: `+ Add ${terminology.customer}`, href: `${basePath}/customers?new=1` },
      };
    case "credit":
      return {
        title: "Nobody owes you anything",
        body: "Credit sales and repayments will appear here.",
        action: { label: `+ New ${terminology.sale}`, href: `${basePath}/sell` },
      };
    case "inventory":
      return {
        title: `No ${terminology.stock.toLowerCase()} recorded`,
        body: "Add an opening quantity for each item you keep.",
        action: { label: "+ Add stock", href: `${basePath}/inventory?new=1` },
      };
    case "suppliers":
      return {
        title: `No ${terminology.suppliers.toLowerCase()} yet`,
        body: "Add the people you buy from to track prices and balances.",
        action: { label: `+ Add ${terminology.supplier}`, href: `${basePath}/suppliers?new=1` },
      };
    case "purchases":
      return {
        title: "No purchases yet",
        body: "Record what you buy and your stock updates automatically.",
        action: { label: "+ Record a purchase", href: `${basePath}/purchases?new=1` },
      };
    case "expenses":
      return {
        title: "No expenses recorded",
        body: "Add rent, electricity or transport to see your real profit.",
        action: { label: "+ Record an expense", href: `${basePath}/expenses?new=1` },
      };
    case "staff":
      return {
        title: "No staff yet",
        body: "Add the people who will use the POS and choose what each can do.",
        action: { label: "+ Add staff", href: `${basePath}/staff?new=1` },
      };
    case "orders":
      return {
        title: `No ${terminology.orders.toLowerCase()} yet`,
        body: `Orders from ${orderChannelWords(config)} will land here.`,
        action: { label: `+ New ${terminology.order}`, href: `${basePath}/orders?new=1` },
      };
    case "appointments":
      return {
        title: "No appointments yet",
        body: "Book a customer in and they will appear on the calendar.",
        action: { label: "+ New appointment", href: `${basePath}/appointments?new=1` },
      };
    case "jobs":
      return {
        title: "No jobs yet",
        body: "Create a job card to track work from inspection to collection.",
        action: { label: "+ New job", href: `${basePath}/jobs?new=1` },
      };
    case "projects":
      return {
        title: "No projects yet",
        body: "Track client work, deposits and balances in one place.",
        action: { label: "+ New project", href: `${basePath}/projects?new=1` },
      };
    case "produce":
      return {
        title: "No produce recorded",
        body: "Record a harvest to start tracking quantities and buyers.",
        action: { label: "+ Record a harvest", href: `${basePath}/produce?new=1` },
      };
    case "branches":
      return {
        title: "No locations added",
        body: "Add each location so stock and sales stay separate.",
        action: { label: "+ Add a location", href: `${basePath}/branches?new=1` },
      };
    case "history":
      return {
        title: `No ${terminology.sales.toLowerCase()} yet`,
        body: `Every ${terminology.sale.toLowerCase()} you record lands here with its receipt.`,
        action: { label: `+ New ${terminology.sale}`, href: `${basePath}/sell` },
      };
    case "reports":
      return {
        title: "No sales yet",
        body: "Reports fill in as soon as you record your first sale.",
        action: { label: `+ New ${terminology.sale}`, href: `${basePath}/sell` },
      };
    case "sell":
    default:
      return {
        title: "Ready when you are",
        body: `Add ${terminology.products.toLowerCase()} or record a sale straight away.`,
        action: { label: `+ New ${terminology.sale}`, href: `${basePath}/sell` },
      };
  }
}

export function orderChannelWords(config: PosConfiguration): string {
  const channels = config.orders?.channels ?? [];
  const words: string[] = [];
  if (channels.includes("phone")) words.push("phone calls");
  if (channels.includes("whatsapp")) words.push("WhatsApp");
  if (channels.includes("business_page")) words.push("your JATA page");
  if (channels.includes("online")) words.push("your website");
  if (channels.includes("walk_in")) words.push("walk-ins");
  if (!words.length) return "your customers";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// ── Onboarding (§61) ──────────────────────────────────────────────────────────

export type SetupStep = { key: string; label: string; body: string; href: string; capability: CapabilityKey | null };

const SETUP_STEPS: SetupStep[] = [
  { key: "products", label: "Add what you sell", body: "Products or services with prices.", href: "products", capability: "catalogue" },
  { key: "customers", label: "Add your customers", body: "Names and phone numbers are enough.", href: "customers", capability: "customer_profiles" },
  { key: "suppliers", label: "Add your suppliers", body: "So purchases and balances are tracked.", href: "suppliers", capability: "suppliers" },
  { key: "staff", label: "Add your staff", body: "Give each person a role.", href: "staff", capability: "employee_profiles" },
  { key: "payments", label: "Review payment methods", body: "Cash, M-Pesa, bank, card and credit.", href: "settings", capability: null },
  { key: "first_sale", label: "Make your first sale", body: "The rest fills in from there.", href: "sell", capability: "pos_sale" },
];

/** Guided setup after payment — the business can still operate with partial setup (§61). */
export function setupSteps(config: PosConfiguration, basePath: string, completed: Set<string> = new Set()): (SetupStep & { href: string; done: boolean })[] {
  return SETUP_STEPS
    .filter((step) => !step.capability || hasCapability(config, step.capability))
    .map((step) => ({ ...step, href: `${basePath}/${step.href}`, done: completed.has(step.key) }));
}

/** Order states the screens will show, taken from the workflow the configuration chose (§29). */
export function orderStatesFor(config: PosConfiguration): { key: string; label: string }[] {
  return resolveStates(config).map((state) => ({ key: state.key, label: state.label }));
}

/** Human-readable capability list for the summary and the plan page (§21, §65, §66). */
export function capabilityBulletList(config: PosConfiguration, limit = 12): string[] {
  const order = ["pos_sale", "orders", "menu", "appointments", "job_cards", "projects", "stock_levels",
    "customer_credit", "suppliers", "supplier_credit", "expenses", "delivery", "employee_profiles",
    "daily_sales", "payment_breakdown"];
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const key of [...order, ...config.capabilities]) {
    if (seen.has(key) || bullets.length >= limit) continue;
    const capability = getCapability(key);
    if (!capability) continue;
    if (capability.group === "reporting" && !order.includes(key)) continue;
    seen.add(key);
    bullets.push(capability.label);
  }
  return bullets;
}
