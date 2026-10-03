/**
 * Templates and cloning (§25, §26, §50, §51, test matrix O & P)
 *
 * "Configured to my likeness." A successful configuration can be saved as a template and
 * used for a second branch, a sister company or a franchise — copying *structure* only.
 *
 * The safety rule is enforced in code, not in a comment: `COPYABLE_SCOPES` is the only thing
 * a clone may read, and `assertCloneSafety` refuses any payload that mentions balances,
 * transactions, credentials or tenant identifiers (§25, §56).
 */

import { getBusinessType } from "./businessTypes";
import { isCapabilityKey, normalizeCapabilities } from "./capabilities";
import { baselineConfiguration, buildConfiguration, finalize } from "./configuration";
import { resolveRoles } from "./permissions";
import { resolveTerminology } from "./terminology";
import { getWorkflow, resolveStates } from "./workflow";
import type {
  CloneScopeKey, PosConfiguration, PosTemplate, QuestionnaireAnswers, TerminologyEntityKey,
} from "./types";

export const CLONE_SCOPES: { key: CloneScopeKey; label: string; blurb: string }[] = [
  { key: "capabilities", label: "POS structure", blurb: "Everything your POS can do." },
  { key: "workflows", label: "Workflows", blurb: "How an order moves through the business." },
  { key: "terminology", label: "Your words", blurb: "What you call customers, products and orders." },
  { key: "payments", label: "Payment setup", blurb: "Which methods are accepted — never account details." },
  { key: "categories", label: "Categories", blurb: "How your products and services are grouped." },
  { key: "permissions", label: "Permissions", blurb: "Roles and what each role may do." },
  { key: "dashboard", label: "Dashboard", blurb: "The metrics shown first." },
  { key: "receipt", label: "Receipt design", blurb: "What appears on a receipt." },
  { key: "rules", label: "Operating rules", blurb: "Credit terms, tax, stock rules and reorder levels." },
];

export const DEFAULT_CLONE_SCOPE: CloneScopeKey[] = CLONE_SCOPES.map((scope) => scope.key);

/**
 * What a clone may never carry (§25, §50, §56): credentials, tenant or actor identifiers, and
 * operational data — transactions, balances, receipt numbers, references.
 *
 * Matching is deliberately precise. A configuration legitimately has a `sales` section, a
 * `showBalance` receipt flag and an `email` field toggle; those are *structure*, not records, and
 * a substring rule that caught them would make copying a setup impossible. Record-shaped data is
 * still caught, because the keys that only ever appear on a record (`balanceKES`, `receiptNumber`,
 * `saleId`, `businessId`, …) are refused wherever they appear in the clone.
 */
const FORBIDDEN_CLONE_KEYS = [
  // Secrets and credentials.
  "password", "passcode", "pin", "secret", "token", "apikey", "credential", "privatekey",
  "signature", "session", "sessionid",
  // Tenant and actor identifiers.
  "tenant", "tenantid", "businessid", "ownerid", "userid", "staffid", "customerid", "supplierid",
  "saleid", "paymentid", "orderid", "branchid",
  // Operational data. (`history` is deliberately absent: "keep purchase history" is a configuration
  // flag, and a real history row is caught by the record markers below.)
  "transaction", "transactions", "ledger", "balance", "balances", "outstanding", "reference",
  "references", "receiptnumber", "invoicenumber", "mpesacode", "krapin", "idnumber", "audit",
  "coordinates",
];

/** Substrings that only ever belong to a record, so they are refused inside a longer key too. */
const FORBIDDEN_CLONE_SUBSTRINGS = [
  "transaction", "ledger", "credential", "apikey", "privatekey", "receiptnumber", "invoicenumber",
  "mpesacode", "tenantid", "businessid", "ownerid", "userid", "paymentid", "saleid", "customerid",
  "supplierid", "orderid", "balancekes", "paidkes", "totalamount",
];

function isForbiddenCloneKey(key: string): boolean {
  const normalized = String(key ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return false;
  if (FORBIDDEN_CLONE_KEYS.includes(normalized)) return true;
  return FORBIDDEN_CLONE_SUBSTRINGS.some((pattern) => normalized.includes(pattern));
}

export type CloneSafetyResult = { ok: boolean; reason?: string; path?: string };

/** Refuse to copy anything that is operational data or a secret, whatever the caller asked for. */
export function assertCloneSafety(value: unknown, path = ""): CloneSafetyResult {
  if (value === null || value === undefined) return { ok: true };
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = assertCloneSafety(value[index], `${path}[${index}]`);
      if (!result.ok) return result;
    }
    return { ok: true };
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenCloneKey(key)) {
        return { ok: false, reason: `"${key}" is operational data and is never copied.`, path: path ? `${path}.${key}` : key };
      }
      const result = assertCloneSafety(entry, path ? `${path}.${key}` : key);
      if (!result.ok) return result;
    }
  }
  return { ok: true };
}

// ── Built-in template library (§51) ───────────────────────────────────────────

function template(
  key: string,
  name: string,
  description: string,
  businessTypeKey: string,
  answers: QuestionnaireAnswers,
  scope: CloneScopeKey[] = DEFAULT_CLONE_SCOPE,
): PosTemplate {
  return { key, name, description, businessTypeKey, answers, scope, builtIn: true };
}

export const TEMPLATE_LIBRARY: PosTemplate[] = [
  template("RETAIL_BASIC", "Basic retail shop", "Counter sales, cash and M-Pesa, stock and receipts.", "retail", {
    sells: ["products"], payment_methods: ["cash", "mpesa"], keeps_stock: true, keeps_customers: false, tracks_expenses: true,
  }),
  template("RETAIL_CREDIT", "Retail with credit", "Retail plus trusted customers who pay later.", "retail", {
    sells: ["products"], payment_methods: ["cash", "mpesa", "credit"], keeps_stock: true, keeps_customers: true,
    credit_frequency: "sometimes", credit_limit: 20000, credit_terms_days: 30, tracks_expenses: true, has_suppliers: true,
  }),
  template("WHOLESALE", "Wholesale & distribution", "Bulk pricing, stockists, credit and routes.", "wholesale", {
    sells: ["products"], payment_methods: ["cash", "mpesa", "bank", "credit"], keeps_stock: true, keeps_customers: true,
    credit_frequency: "frequently", credit_limit: 100000, credit_terms_days: 30, has_suppliers: true,
    supplier_credit: true, purchase_orders: true, wholesale_pricing: true, tiers: true, delivery: true, has_staff: true,
    staff_roles: ["SALESPERSON", "INVENTORY"], sales_attribution: true, tracks_expenses: true,
  }),
  template("RESTAURANT", "Restaurant", "Menu, kitchen orders and tables.", "restaurant", {
    sells: ["products"], payment_methods: ["cash", "mpesa"], keeps_stock: true, keeps_customers: false, orders: true,
    order_channels: ["walk_in", "phone"], restaurant_tables: true, restaurant_kitchen: true, menu_modifiers: true,
    has_staff: true, staff_roles: ["WAITER", "CASHIER"], tracks_expenses: true, has_suppliers: true,
  }),
  template("RESTAURANT_DELIVERY", "Restaurant with delivery", "Restaurant plus delivery and WhatsApp orders.", "restaurant", {
    sells: ["products"], payment_methods: ["cash", "mpesa"], keeps_stock: true, orders: true, delivery: true, pickup: true,
    order_channels: ["walk_in", "phone", "whatsapp"], order_workflow: "delivery", restaurant_kitchen: true,
    menu_modifiers: true, has_staff: true, staff_roles: ["WAITER", "DELIVERY", "CASHIER"], tracks_expenses: true,
  }),
  template("SALON", "Salon", "Appointments, stylists, services and product sales.", "salon", {
    sells: ["services", "products"], payment_methods: ["cash", "mpesa"], keeps_stock: true, keeps_customers: true,
    repeat_customers: true, appointments: true, stylists: true, has_staff: true, staff_roles: ["STYLIST", "CASHIER"],
    sales_attribution: true, commissions: true, loyalty: true, tracks_expenses: true,
  }),
  template("BARBER", "Barber", "Walk-ins and appointments with barber commissions.", "barber", {
    sells: ["services"], payment_methods: ["cash", "mpesa"], keeps_stock: false, keeps_customers: true,
    repeat_customers: true, appointments: true, has_staff: true, staff_roles: ["STYLIST"], sales_attribution: true,
    commissions: true, tracks_expenses: true,
  }),
  template("HARDWARE", "Hardware shop", "Pieces, boxes and metres, with contractor credit.", "hardware", {
    sells: ["products"], payment_methods: ["cash", "mpesa", "bank", "credit"], keeps_stock: true, units: ["piece", "box", "metre", "bag"],
    keeps_customers: true, credit_frequency: "frequently", credit_limit: 50000, credit_terms_days: 30,
    has_suppliers: true, supplier_credit: true, purchase_orders: true, quotations: true, delivery: true,
    wholesale_pricing: true, has_staff: true, staff_roles: ["CASHIER", "SALESPERSON", "INVENTORY"], tracks_expenses: true,
  }),
  template("GARAGE", "Garage", "Job cards, vehicles, labour and spare parts.", "garage", {
    sells: ["services", "products"], payment_methods: ["cash", "mpesa"], keeps_stock: true, keeps_customers: true,
    vehicles: true, job_cards: true, estimates: true, technicians: true, parts: true, deposits: true,
    has_staff: true, staff_roles: ["TECHNICIAN", "CASHIER"], sales_attribution: true, tracks_expenses: true, has_suppliers: true,
  }),
  template("AUTO_PARTS", "Spare parts", "Part numbers, stock and trade customers.", "spare_parts", {
    sells: ["products"], payment_methods: ["cash", "mpesa", "credit"], keeps_stock: true, keeps_customers: true,
    barcode: true, serials: false, has_suppliers: true, purchase_orders: true, credit_frequency: "sometimes",
    credit_limit: 30000, tracks_expenses: true,
  }),
  template("LAUNDRY", "Laundry", "Garment counts, service types and order status.", "laundry", {
    sells: ["services"], payment_methods: ["cash", "mpesa"], keeps_stock: false, keeps_customers: true, orders: true,
    garments: true, service_types: true, pickup: true, delivery: true, has_staff: true, staff_roles: ["CASHIER"],
    tracks_expenses: true,
  }),
  template("BOUTIQUE", "Boutique", "Sizes, colours, collections and client history.", "boutique", {
    sells: ["products"], payment_methods: ["cash", "mpesa"], keeps_stock: true, units: ["piece", "pair"],
    keeps_customers: true, repeat_customers: true, variants: true, barcode: true, loyalty: true, tracks_expenses: true,
  }),
  template("FARM", "Farm", "Produce, harvests, buyers and farm expenses.", "farm", {
    sells: ["products"], payment_methods: ["cash", "mpesa", "bank"], keeps_stock: true, units: ["kilogram", "sack", "crate", "litre"],
    keeps_customers: true, harvests: true, buyers: true, tracks_expenses: true, has_suppliers: true,
    expense_categories: ["fuel", "salaries", "supplies", "transport", "other"],
  }),
  template("AGRIBUSINESS", "Agribusiness", "Production, processing and trade.", "agribusiness", {
    sells: ["products"], payment_methods: ["cash", "mpesa", "bank", "credit"], keeps_stock: true,
    units: ["kilogram", "sack", "bag", "litre"], keeps_customers: true, manufacturing: true, bom: true,
    work_orders: true, has_suppliers: true, supplier_credit: true, purchase_orders: true, wholesale_pricing: true,
    has_staff: true, staff_roles: ["INVENTORY", "SALESPERSON"], tracks_expenses: true,
  }),
  template("MANUFACTURING", "Manufacturing", "Raw materials, recipes, batches and finished goods.", "manufacturing", {
    sells: ["products"], payment_methods: ["cash", "mpesa", "bank", "credit"], keeps_stock: true, manufacturing: true,
    bom: true, work_orders: true, production_costs: true, keeps_customers: true, has_suppliers: true,
    supplier_credit: true, purchase_orders: true, has_staff: true, staff_roles: ["INVENTORY", "MANAGER"],
    sales_attribution: true, tracks_expenses: true,
  }),
  template("PROFESSIONAL_SERVICE", "Professional services", "Clients, projects, retainers and invoices.", "professional_services", {
    sells: ["services"], payment_methods: ["mpesa", "bank", "cash"], keeps_stock: false, keeps_customers: true,
    projects: true, retainers: true, quotations: true, deposits: true, time_tracking: false, tracks_expenses: true,
    has_staff: true, staff_roles: ["MANAGER", "ACCOUNTANT"],
  }),
  template("REAL_ESTATE", "Property management", "Properties, units, tenants and rent.", "real_estate", {
    sells: ["services"], payment_methods: ["mpesa", "bank", "cash"], keeps_stock: false, keeps_customers: true,
    properties: true, tenants: true, rent: true, payment_plans: true, credit_frequency: "sometimes",
    credit_limit: 50000, credit_terms_days: 30, tracks_expenses: true,
  }),
  template("EDUCATION", "School & training", "Students, courses, fees and payment plans.", "education", {
    sells: ["services"], payment_methods: ["mpesa", "cash", "bank"], keeps_stock: false, keeps_customers: true,
    courses: true, fees: true, payment_plans: true, instructors: false, has_staff: true,
    staff_roles: ["MANAGER", "ACCOUNTANT"], credit_frequency: "sometimes", credit_limit: 30000, tracks_expenses: true,
  }),
  template("EVENTS", "Events & catering", "Clients, packages, deposits and schedules.", "events", {
    sells: ["services", "products"], payment_methods: ["mpesa", "cash", "bank"], keeps_stock: false, keeps_customers: true,
    events: true, packages: true, payment_schedules: true, deposits: true, quotations: true, projects: true,
    tracks_expenses: true, has_suppliers: true, has_staff: true, staff_roles: ["MANAGER"],
  }),
  template("PRINTING", "Printing & custom orders", "Jobs, artwork, deposits and balances.", "printing", {
    sells: ["services", "products"], payment_methods: ["cash", "mpesa"], keeps_stock: true, keeps_customers: true,
    custom_orders: true, artwork: true, production_status: true, quotations: true, deposits: true,
    has_suppliers: true, tracks_expenses: true,
  }),
  template("SERVICE_BUSINESS", "Service business", "Cash-only or cash + M-Pesa services with no stock.", "cleaning_service", {
    sells: ["services"], payment_methods: ["cash", "mpesa"], keeps_stock: false, keeps_customers: true,
    tracks_expenses: true, has_staff: true, staff_roles: ["CASHIER"], sales_attribution: true,
  }),
  template("ONLINE_SELLER", "Online seller", "Orders from your page, WhatsApp and phone.", "online_seller", {
    sells: ["products"], payment_methods: ["mpesa", "cash"], keeps_stock: true, keeps_customers: true, orders: true,
    order_channels: ["whatsapp", "business_page", "online", "phone"], delivery: true, pickup: true, tracks_expenses: true,
  }),
];

const TEMPLATE_BY_KEY = new Map(TEMPLATE_LIBRARY.map((entry) => [entry.key, entry]));

export function getTemplate(key: string | null | undefined): PosTemplate | undefined {
  return TEMPLATE_BY_KEY.get(key ?? "");
}

export function isTemplateKey(key: unknown): key is string {
  return typeof key === "string" && TEMPLATE_BY_KEY.has(key);
}

/** Templates for a trade, best match first (§26 — "Use my template"). */
export function templatesForBusinessType(typeKey: string): PosTemplate[] {
  const profile = getBusinessType(typeKey);
  return TEMPLATE_LIBRARY.filter((entry) => entry.businessTypeKey === profile.key || entry.key === profile.templateKey)
    .concat(TEMPLATE_LIBRARY.filter((entry) => entry.key === profile.templateKey && entry.businessTypeKey !== profile.key));
}

/** Start answers from a template, keeping anything the owner already answered (§26). */
export function applyTemplate(template: PosTemplate, existing: QuestionnaireAnswers = {}): QuestionnaireAnswers {
  const merged: QuestionnaireAnswers = {
    business_type: template.businessTypeKey,
    ...template.answers,
  };
  for (const [key, value] of Object.entries(existing)) {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
    merged[key] = value;
  }
  merged.business_type = existing.business_type && existing.business_type !== template.businessTypeKey
    ? existing.business_type
    : template.businessTypeKey;
  return merged;
}

/** Build a configuration straight from a template (test matrix O). */
export function configurationFromTemplate(template: PosTemplate, context: { businessName?: string } = {}): PosConfiguration {
  return buildConfiguration(applyTemplate(template), context);
}

// ── Save a configuration as a template (§26) ──────────────────────────────────

export type SavedTemplate = {
  key: string;
  name: string;
  description: string;
  businessTypeKey: string;
  answers: QuestionnaireAnswers;
  scope: CloneScopeKey[];
  builtIn: false;
  configuration: PosConfiguration;
};

/**
 * Reduce a live configuration to the structure worth reusing. Only configuration travels —
 * never balances, transactions, customers or credentials (§25).
 */
export function templateFromConfiguration(config: PosConfiguration, name: string): SavedTemplate {
  const businessName = (name || config.business.name || "My business").trim().slice(0, 80);
  const answers: QuestionnaireAnswers = answersFromConfiguration(config);
  return {
    key: `custom_${businessName.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`,
    name: `${businessName} setup`,
    description: `Saved from ${config.business.typeLabel || getBusinessType(config.business.typeKey).label}.`,
    businessTypeKey: config.business.typeKey,
    answers,
    scope: DEFAULT_CLONE_SCOPE,
    builtIn: false,
    configuration: cloneConfiguration(config, DEFAULT_CLONE_SCOPE),
  };
}

/** Configuration → answers, so a saved template re-enters the same questionnaire (§26). */
export function answersFromConfiguration(config: PosConfiguration): QuestionnaireAnswers {
  const answers: QuestionnaireAnswers = {
    business_type: config.business.typeKey,
    sells: [
      ...(config.sales.products ? ["products"] : []),
      ...(config.sales.services ? ["services"] : []),
      ...(config.sales.subscriptions ? ["subscriptions"] : []),
      ...(config.sales.bookings ? ["bookings"] : []),
      ...(config.sales.projects ? ["projects"] : []),
      ...(config.sales.contracts ? ["contracts"] : []),
      ...(config.sales.customOrders ? ["custom_orders"] : []),
    ],
    payment_methods: [
      ...(config.payments.cash ? ["cash"] : []),
      ...(config.payments.mpesa ? ["mpesa"] : []),
      ...(config.payments.bank ? ["bank"] : []),
      ...(config.payments.card ? ["card"] : []),
      ...(config.payments.credit || config.credit.enabled ? ["credit"] : []),
      ...(config.payments.other ? ["other"] : []),
    ],
    discounts: config.sales.discounts,
    quotations: config.sales.quotations,
    deposits: config.sales.deposits,
    split_payments: config.sales.splitPayments,
    tax: config.sales.tax.enabled,
    tax_rate: config.sales.tax.ratePercent,
    credit_frequency: config.credit.enabled ? config.credit.frequency : "never",
    credit_limit: config.credit.limitKES,
    credit_terms_days: config.credit.termsDays,
    credit_staff_approve: config.credit.staffCanApprove,
    credit_deposits: config.credit.depositsRequired,
    keeps_stock: config.inventory.enabled,
    units: config.inventory.units,
    variants: config.inventory.variants,
    barcode: config.inventory.barcode,
    expiry: config.inventory.expiry,
    batches: config.inventory.batches,
    serials: config.inventory.serials,
    stock_counts: config.inventory.stockCounts,
    manufacturing: config.inventory.manufacturing,
    keeps_customers: config.customers.enabled,
    customer_fields: Object.entries(config.customers.fields)
      .filter(([, enabled]) => enabled)
      .map(([key]) => (key === "customerNumber" ? "number" : key)),
    repeat_customers: config.customers.repeat,
    loyalty: config.customers.loyalty,
    orders: config.orders.enabled,
    order_channels: config.orders.channels,
    order_workflow: config.orders.workflowKey,
    delivery: config.delivery.enabled,
    pickup: config.delivery.pickup,
    has_suppliers: config.suppliers.enabled,
    supplier_payment_methods: config.suppliers.paymentMethods,
    supplier_credit: config.suppliers.credit,
    supplier_terms_days: config.suppliers.termsDays,
    purchase_orders: config.suppliers.purchaseOrders,
    partial_receiving: config.suppliers.partialReceiving,
    has_staff: config.staff.enabled,
    staff_count: config.staff.count,
    staff_roles: config.staff.roles,
    sales_attribution: config.staff.attribution,
    commissions: config.staff.commissions,
    approvals: config.staff.approvals,
    multi_branch: config.branches.enabled,
    branch_count: config.branches.count,
    stock_by_branch: config.branches.perBranchStock,
    tracks_expenses: config.expenses.enabled,
    expense_categories: config.expenses.categories,
  };
  return answers;
}

// ── Cloning (§25, §50) ────────────────────────────────────────────────────────

/**
 * Copy a configuration to another business or branch, choosing exactly what to copy.
 * The result never carries money, balances, people or identifiers from the source (§25).
 */
export function cloneConfiguration(source: PosConfiguration, scope: CloneScopeKey[] = DEFAULT_CLONE_SCOPE): PosConfiguration {
  const wanted = new Set(scope);
  const target = baselineConfiguration();

  // The business type always travels: it is what makes the rest of the copy coherent.
  target.business.typeKey = source.business.typeKey;
  target.business.typeLabel = source.business.typeLabel;
  target.business.otherDescription = source.business.otherDescription;

  if (wanted.has("capabilities")) {
    target.sales = { ...source.sales };
    target.inventory = { ...structuredClone(source.inventory), conversions: source.inventory.conversions.map((entry) => ({ ...entry })) };
    target.customers = { ...source.customers, fields: { ...source.customers.fields } };
    target.suppliers = { ...source.suppliers, paymentMethods: [...source.suppliers.paymentMethods] };
    target.staff = { ...source.staff, roles: [...source.staff.roles] };
    target.branches = { ...source.branches };
    target.expenses = { ...source.expenses, categories: [...source.expenses.categories] };
    target.delivery = { ...source.delivery };
    target.capabilities = normalizeCapabilities(source.capabilities);
    target.industry = { key: source.industry?.key ?? target.business.typeKey, modules: [...(source.industry?.modules ?? [])] };
  }
  if (wanted.has("workflows")) {
    target.orders = {
      enabled: source.orders.enabled,
      channels: [...source.orders.channels],
      workflowKey: getWorkflow(source.orders.workflowKey).key,
      states: resolveStates(source).map((state) => state.key),
    };
  }
  if (wanted.has("terminology")) {
    target.terminology = { ...source.terminology } as Partial<Record<TerminologyEntityKey, string>>;
  }
  if (wanted.has("payments")) {
    // Method *structure* only. No till numbers, no accounts, no references (§25).
    target.payments = {
      cash: source.payments.cash, mpesa: source.payments.mpesa, bank: source.payments.bank,
      card: source.payments.card, credit: source.payments.credit, other: source.payments.other,
      otherLabels: [...source.payments.otherLabels],
    };
  }
  if (wanted.has("permissions")) {
    target.roles = resolveRoles({ ...target, staff: target.staff, roles: source.roles ?? [] });
  }
  if (wanted.has("dashboard")) {
    target.dashboard = [...source.dashboard];
    target.navigation = [...source.navigation];
  }
  if (wanted.has("receipt")) {
    target.receipt = {
      ...source.receipt,
      // The receipt carries the *new* business's name, never the source's (§25).
      businessName: "",
    };
  }
  if (wanted.has("rules")) {
    target.credit = {
      enabled: source.credit.enabled,
      frequency: source.credit.frequency,
      limitKES: source.credit.limitKES,
      termsDays: source.credit.termsDays,
      staffCanApprove: source.credit.staffCanApprove,
      depositsRequired: source.credit.depositsRequired,
      highlightOverdue: source.credit.highlightOverdue,
      statements: source.credit.statements,
      // "Who qualifies" is a rule the owner wrote; personal notes about customers are not.
      qualifyingNote: source.credit.qualifyingNote.slice(0, 240),
    };
    target.sales.tax = { ...source.sales.tax };
    target.suppliers.termsDays = source.suppliers.termsDays;
  }

  const cloned = finalize(target);
  const safety = assertCloneSafety(cloned);
  if (!safety.ok) {
    // Never fail open: if a copy would carry operational data, refuse the copy (§25, §56).
    throw new Error(`CLONE_UNSAFE:${safety.path}`);
  }
  return cloned;
}

function structuredClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Plain-language description of what a copy will and will not include (§50). */
export function describeCloneScope(scope: CloneScopeKey[]): { copies: string[]; neverCopies: string[] } {
  const copies = CLONE_SCOPES.filter((entry) => scope.includes(entry.key)).map((entry) => entry.label);
  return {
    copies,
    neverCopies: [
      "Sales and payment history",
      "Customer balances",
      "Supplier balances",
      "Staff records and logins",
      "Business identifiers",
      "Receipts and documents",
    ],
  };
}

/** Terminology preview for a cloned configuration, so the owner sees it in their words (§25). */
export function clonePreview(config: PosConfiguration): { capabilities: string[]; words: string[] } {
  const terminology = resolveTerminology(config);
  return {
    capabilities: config.capabilities.filter(isCapabilityKey).slice(0, 20),
    words: (Object.keys(terminology) as TerminologyEntityKey[])
      .map((key) => `${key}: ${terminology[key]}`)
      .slice(0, 8),
  };
}
