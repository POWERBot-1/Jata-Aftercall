/**
 * JATA AFTERCALL — Configurable Business POS (§1, §6, §20, §53)
 *
 * ONE JATA POS ENGINE + CONFIGURATION/CAPABILITY SYSTEM + BUSINESS TEMPLATES (§76).
 *
 * Nothing in this product is per-industry code: a business type selects a configuration,
 * and the engine executes that configuration. Every type below is therefore descriptive
 * data — capabilities, terminology, workflows, fields, permissions and UI — never a fork
 * of the application (§52).
 *
 * The authoritative artefact is the `PosConfiguration` ("Business Operating Profile", §7).
 * It is produced by the adaptive questionnaire (§9, §40), edited in plain language (§22),
 * previewed (§23), versioned (§48) and only ever executed against one authenticated tenant.
 */

/** Bumped when the shape of a stored configuration changes in a way that needs migration. */
export const POS_CONFIG_SCHEMA_VERSION = 1;

// ── Identity ──────────────────────────────────────────────────────────────────

/** Registry key from `lib/pos/businessTypes`. `"other"` is always available (§10, §19). */
export type BusinessTypeKey = string;

/** Capability registry key from `lib/pos/capabilities`. Validated at runtime, not by union. */
export type CapabilityKey = string;

/** Module key that may appear in the generated POS navigation (§23, §24). */
export type PosModuleKey =
  | "dashboard"
  | "sell"
  | "history"
  | "orders"
  | "products"
  | "services"
  | "menu"
  | "customers"
  | "credit"
  | "inventory"
  | "suppliers"
  | "purchases"
  | "expenses"
  | "staff"
  | "appointments"
  | "jobs"
  | "projects"
  | "produce"
  | "branches"
  | "reports"
  | "settings";

/** Metric card keys the generated dashboard may show (§34). */
export type DashboardCardKey =
  | "today_sales"
  | "orders"
  | "cash"
  | "mpesa"
  | "credit_owed"
  | "supplier_debt"
  | "stock_alerts"
  | "expenses"
  | "appointments"
  | "pending_jobs"
  | "pending_deliveries"
  | "staff_performance"
  | "inventory_value"
  | "new_customers"
  | "top_products"
  | "kitchen_queue";

/** Report keys (§35). Each is gated by the capability that makes it meaningful. */
export type ReportKey =
  | "daily_sales"
  | "weekly_sales"
  | "monthly_sales"
  | "gross_sales"
  | "refunds"
  | "net_sales"
  | "payment_breakdown"
  | "outstanding_credit"
  | "supplier_debt"
  | "expenses"
  | "inventory_value"
  | "best_sellers"
  | "slow_movers"
  | "staff_performance"
  | "customer_activity"
  | "profitability"
  | "channel_attribution"
  | "ingredient_usage"
  | "commissions"
  | "job_profitability"
  | "produce"
  | "production"
  | "rent"
  | "projects";

/** Entities whose *presentation* may be renamed while their structure stays identical (§46). */
export type TerminologyEntityKey =
  | "customer"
  | "customers"
  | "product"
  | "products"
  | "service"
  | "services"
  | "sale"
  | "sales"
  | "order"
  | "orders"
  | "invoice"
  | "quote"
  | "supplier"
  | "suppliers"
  | "staff"
  | "expense"
  | "expenses"
  | "stock"
  | "inventory"
  | "branch"
  | "branches";

// ── Money, units, channels ────────────────────────────────────────────────────

export type UnitKey =
  | "piece" | "box" | "carton" | "kilogram" | "gram" | "litre" | "millilitre"
  | "metre" | "centimetre" | "pair" | "dozen" | "pack" | "roll" | "bottle"
  | "sack" | "bag" | "crate" | "hour" | "day" | "visit" | "session" | "job"
  | "custom";

export type PaymentMethodKey = "cash" | "mpesa" | "bank" | "card" | "credit" | "other";

/** Where a transaction came from (§28, §70). The POS never depends on any one channel. */
export type ChannelKey =
  | "walk_in" | "phone" | "whatsapp" | "business_page" | "online"
  | "staff" | "delivery" | "other";

export type CreditFrequency = "never" | "sometimes" | "frequently" | "most";

/** One unit conversion, e.g. 1 carton = 24 pieces (§13). */
export type UnitConversion = {
  fromUnit: UnitKey | string;
  toUnit: UnitKey | string;
  factor: number;
  label?: string;
};

// ── Business Operating Profile (§7, §20) ──────────────────────────────────────

export type PosSalesConfig = {
  products: boolean;
  services: boolean;
  subscriptions: boolean;
  bookings: boolean;
  projects: boolean;
  contracts: boolean;
  customOrders: boolean;
  quotations: boolean;
  invoices: boolean;
  returns: boolean;
  refunds: boolean;
  discounts: boolean;
  promotions: boolean;
  deposits: boolean;
  partialPayments: boolean;
  splitPayments: boolean;
  customerPricing: boolean;
  wholesalePricing: boolean;
  retailPricing: boolean;
  bundles: boolean;
  tax: { enabled: boolean; ratePercent: number; label: string; inclusive: boolean };
};

export type PosPaymentsConfig = {
  cash: boolean;
  mpesa: boolean;
  bank: boolean;
  card: boolean;
  credit: boolean;
  other: boolean;
  /** Owner-defined method labels, e.g. ["Cheque", "Sacco"]. */
  otherLabels: string[];
};

export type PosCreditConfig = {
  enabled: boolean;
  frequency: CreditFrequency;
  /** Default limit applied to a new credit customer; 0 = decided per customer. */
  limitKES: number;
  termsDays: number;
  staffCanApprove: boolean;
  depositsRequired: boolean;
  highlightOverdue: boolean;
  statements: boolean;
  /** Plain-language answer to "who qualifies?" — shown to staff, never parsed. */
  qualifyingNote: string;
};

export type PosInventoryConfig = {
  enabled: boolean;
  units: string[];
  conversions: UnitConversion[];
  variants: boolean;
  barcode: boolean;
  expiry: boolean;
  batches: boolean;
  serials: boolean;
  locations: boolean;
  transfers: boolean;
  manufacturing: boolean;
  assembly: boolean;
  valuation: boolean;
  lowStockAlerts: boolean;
  stockCounts: boolean;
  reorderLevels: boolean;
};

export type PosCustomersConfig = {
  enabled: boolean;
  fields: {
    name: boolean;
    phone: boolean;
    email: boolean;
    location: boolean;
    customerNumber: boolean;
    notes: boolean;
  };
  repeat: boolean;
  accounts: boolean;
  loyalty: boolean;
  segments: boolean;
  history: boolean;
};

export type PosSuppliersConfig = {
  enabled: boolean;
  credit: boolean;
  termsDays: number;
  purchaseOrders: boolean;
  partialReceiving: boolean;
  reminders: boolean;
  statements: boolean;
  paymentMethods: PaymentMethodKey[];
};

export type PosStaffConfig = {
  enabled: boolean;
  count: number;
  roles: string[];
  attribution: boolean;
  commissions: boolean;
  shifts: boolean;
  approvals: boolean;
};

export type PosBranchesConfig = {
  enabled: boolean;
  count: number;
  /** Whether stock is tracked per branch (only meaningful with inventory). */
  perBranchStock: boolean;
};

export type PosExpensesConfig = {
  enabled: boolean;
  categories: string[];
};

export type PosDeliveryConfig = {
  enabled: boolean;
  pickup: boolean;
  zones: boolean;
  feeKES: number;
};

export type PosOrdersConfig = {
  enabled: boolean;
  channels: ChannelKey[];
  /** Key into `ORDER_WORKFLOWS` (§29). Business-specific states, one engine. */
  workflowKey: string;
  states: string[];
};

export type PosReceiptConfig = {
  businessName: string;
  showLogo: boolean;
  showContact: boolean;
  showCashier: boolean;
  showTaxBreakdown: boolean;
  showBalance: boolean;
  showCreditBalance: boolean;
  footerMessage: string;
};

export type PosRoleConfig = {
  key: string;
  name: string;
  permissions: string[];
  /** Built-in roles cannot be deleted, only adjusted (§36). */
  builtIn: boolean;
};

export type PosConfiguration = {
  schemaVersion: number;
  business: {
    typeKey: BusinessTypeKey;
    typeLabel: string;
    /** Free text for `other` and for any business whose label needs clarifying (§19). */
    otherDescription: string;
    name: string;
    branchName: string;
  };
  sales: PosSalesConfig;
  payments: PosPaymentsConfig;
  credit: PosCreditConfig;
  inventory: PosInventoryConfig;
  customers: PosCustomersConfig;
  suppliers: PosSuppliersConfig;
  staff: PosStaffConfig;
  branches: PosBranchesConfig;
  expenses: PosExpensesConfig;
  delivery: PosDeliveryConfig;
  orders: PosOrdersConfig;
  receipt: PosReceiptConfig;
  /** Presentation-only overrides (§46). The underlying entity never changes shape. */
  terminology: Partial<Record<TerminologyEntityKey, string>>;
  /** Enabled capabilities — derived from the answers, stored for auditability (§8). */
  capabilities: CapabilityKey[];
  /** Generated navigation, in display order (§24). */
  navigation: PosModuleKey[];
  /** Generated dashboard cards, in display order (§34). */
  dashboard: DashboardCardKey[];
  /** Generated report catalogue (§35). */
  reports: ReportKey[];
  /** Roles and their permission sets (§36). */
  roles: PosRoleConfig[];
  /** Industry modules the business type switched on (menu, job cards, harvests, …). */
  industry: {
    key: string;
    modules: CapabilityKey[];
  };
};

// ── Questionnaire (§9, §40, §41) ──────────────────────────────────────────────

/** A single stored answer. Values stay JSON-safe so drafts autosave verbatim (§9). */
export type AnswerValue = string | number | boolean | string[] | null;
export type QuestionnaireAnswers = Record<string, AnswerValue>;

export type QuestionKind = "choice" | "multi" | "yesno" | "number" | "text" | "amount";

export type QuestionOption = {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
};

export type PosQuestion = {
  id: string;
  /** Plain-language prompt. Never technical wording (§3, §22). */
  title: string;
  help?: string;
  kind: QuestionKind;
  options?: QuestionOption[];
  /** Allows a free-text "Something else" answer (§10). */
  allowCustom?: boolean;
  customLabel?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  /** Sensible default so an owner can always continue (§9). */
  defaultValue?: AnswerValue;
  /** Grouping used by the editor and the progress bar. */
  section: string;
  /**
   * Adaptive branching (§40, §41): a question is only asked when this returns true for the
   * answers collected so far. Returning false also removes the answer, so an owner who
   * changes an earlier answer never carries a stale one forward.
   */
  when?: (answers: QuestionnaireAnswers) => boolean;
  required?: boolean;
};

// ── Lifecycle (§43, §44) ──────────────────────────────────────────────────────

/**
 * Explicit commercial states. A preview is not production, a configuration is not an
 * activation, and payment *initiation* is not payment success.
 */
export type PosLifecycleStatus =
  | "DRAFT"
  | "CONFIGURED"
  | "PREVIEW"
  | "AWAITING_PAYMENT"
  | "PAYMENT_CONFIRMED"
  | "PROVISIONING"
  | "LIVE"
  | "SUSPENDED"
  | "CANCELLED";

export const POS_LIFECYCLE_ORDER: PosLifecycleStatus[] = [
  "DRAFT", "CONFIGURED", "PREVIEW", "AWAITING_PAYMENT",
  "PAYMENT_CONFIRMED", "PROVISIONING", "LIVE",
];

/** Entitlement statuses persisted for admin views and lifecycle jobs. */
export type PosEntitlementStatus =
  | "NONE" | "PENDING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "SUSPENDED" | "CANCELLED";

// ── Templates and cloning (§25, §26, §50, §51) ────────────────────────────────

/** What an owner is allowed to copy. Financial and secret data is never in this list. */
export type CloneScopeKey =
  | "capabilities"
  | "workflows"
  | "terminology"
  | "payments"
  | "categories"
  | "permissions"
  | "dashboard"
  | "receipt"
  | "rules";

export type PosTemplate = {
  key: string;
  name: string;
  description: string;
  /** Business type this template starts from; the questionnaire stays authoritative (§51). */
  businessTypeKey: BusinessTypeKey;
  /** Partial answers that pre-fill the questionnaire. */
  answers: QuestionnaireAnswers;
  scope: CloneScopeKey[];
  builtIn: boolean;
};

// ── Transactions (§27, §30, §31, §33, §54) ────────────────────────────────────

export type SaleLineInput = {
  productId?: string | null;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  unitKey?: string;
  quantity: number;
  unitPriceKES: number;
  discountKES?: number;
};

export type SalePaymentInput = {
  method: PaymentMethodKey | string;
  amountKES: number;
  reference?: string;
};

export type SaleTotals = {
  subtotalKES: number;
  discountKES: number;
  taxableKES: number;
  taxKES: number;
  totalKES: number;
  paidKES: number;
  balanceKES: number;
  changeKES: number;
};

/** Every stock change carries a reason — stock is never mutated without a trace (§33). */
export type InventoryMovementReason =
  | "OPENING" | "SALE" | "RETURN" | "PURCHASE" | "PURCHASE_RETURN"
  | "ADJUSTMENT" | "DAMAGE" | "EXPIRY" | "COUNT" | "TRANSFER_IN"
  | "TRANSFER_OUT" | "PRODUCTION_IN" | "PRODUCTION_OUT" | "WASTAGE";

export type CreditPartyType = "CUSTOMER" | "SUPPLIER";

/** A receipt is generated from recorded data — never stored as a second source of truth (§32). */
export type ReceiptDocument = {
  businessName: string;
  tagline?: string;
  contact?: string[];
  receiptNumber: string;
  issuedAt: string;
  cashier?: string;
  customer?: { name: string; phone?: string; number?: string };
  lines: { name: string; quantity: number; unit?: string; unitPriceKES: number; discountKES: number; totalKES: number }[];
  subtotalKES: number;
  discountKES: number;
  taxLabel?: string;
  taxKES: number;
  totalKES: number;
  payments: { method: string; amountKES: number; reference?: string }[];
  balanceKES: number;
  creditBalanceKES?: number;
  footerMessage?: string;
  channel?: string;
};
