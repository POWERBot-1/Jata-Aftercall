/**
 * Adaptive questionnaire (§9–§19, §40, §41, §42)
 *
 * A guided conversation, not a government form. One meaningful question at a time, smart
 * branching, sensible defaults and the minimum number of questions needed to configure a
 * useful POS (§41). Every question is data: its visibility is a predicate over the answers
 * collected so far, so a new trade or a new capability never means new screens (§52).
 */

import { BUSINESS_TYPES, getBusinessType, resolveBusinessType, type BusinessTypeProfile } from "./businessTypes";
import { workflowsForBusinessType } from "./workflow";
import { QUESTIONNAIRE_UNIT_KEYS } from "./units";
import type {
  AnswerValue, BusinessTypeKey, PosQuestion, QuestionnaireAnswers, UnitKey,
} from "./types";

export const QUESTION_SECTIONS = [
  { key: "business", label: "Your business", blurb: "What you do." },
  { key: "selling", label: "How you sell", blurb: "What you sell and how people pay." },
  { key: "credit", label: "Credit", blurb: "Selling now, collecting later." },
  { key: "stock", label: "Stock", blurb: "What you keep and how you measure it." },
  { key: "customers", label: "Customers", blurb: "The people who buy from you." },
  { key: "orders", label: "Orders & delivery", blurb: "Work that arrives before it is collected." },
  { key: "suppliers", label: "Suppliers", blurb: "The people you buy from." },
  { key: "staff", label: "Staff", blurb: "Who else uses the system." },
  { key: "locations", label: "Locations", blurb: "More than one place." },
  { key: "expenses", label: "Expenses", blurb: "What the business spends." },
  { key: "trade", label: "Your trade", blurb: "The details only your kind of business needs." },
] as const;

export type QuestionSectionKey = (typeof QUESTION_SECTIONS)[number]["key"];

// ── Answer helpers ────────────────────────────────────────────────────────────

export function typeProfile(answers: QuestionnaireAnswers): BusinessTypeProfile {
  const raw = answers.business_type;
  if (typeof raw === "string" && raw.trim()) return getBusinessType(raw.trim());
  return getBusinessType("other");
}

export function answeredText(answers: QuestionnaireAnswers, key: string): string {
  const value = answers[key];
  return typeof value === "string" ? value.trim() : "";
}

export function answeredBool(answers: QuestionnaireAnswers, key: string): boolean | null {
  const value = answers[key];
  if (value === true || value === false) return value;
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

export function answeredList(answers: QuestionnaireAnswers, key: string): string[] {
  const value = answers[key];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string" && value.trim()) return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

export function answeredNumber(answers: QuestionnaireAnswers, key: string): number | null {
  const value = answers[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[^0-9.-]/g, "")) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function sells(answers: QuestionnaireAnswers, kind: "products" | "services"): boolean {
  return answeredList(answers, "sells").includes(kind);
}

/** Does this trade want the capability? Drives both defaults and branching (§18, §40). */
export function typeOffers(answers: QuestionnaireAnswers, capabilityKey: string): boolean {
  const profile = typeProfile(answers);
  return profile.capabilities.includes(capabilityKey) || profile.optionalCapabilities.includes(capabilityKey);
}

/** Is a trade-specific question on this trade's list of things worth asking (§18)? */
export function isFocusQuestion(answers: QuestionnaireAnswers, questionId: string): boolean {
  return typeProfile(answers).focusQuestions.includes(questionId);
}

/** Only ask a trade question when the trade wants it *and* the preconditions hold. */
function trade(answers: QuestionnaireAnswers, questionId: string, capabilityKey: string, extra?: () => boolean): boolean {
  if (!(isFocusQuestion(answers, questionId) || typeOffers(answers, capabilityKey))) return false;
  return extra ? extra() : true;
}

// ── The questionnaire ─────────────────────────────────────────────────────────

export const EXPENSE_CATEGORY_OPTIONS = [
  { id: "rent", label: "Rent" },
  { id: "electricity", label: "Electricity" },
  { id: "water", label: "Water" },
  { id: "salaries", label: "Salaries" },
  { id: "transport", label: "Transport" },
  { id: "fuel", label: "Fuel" },
  { id: "marketing", label: "Marketing" },
  { id: "supplies", label: "Supplies" },
  { id: "maintenance", label: "Maintenance" },
  { id: "licences", label: "Licences & permits" },
  { id: "bank_charges", label: "Bank charges" },
  { id: "mpesa_charges", label: "M-Pesa charges" },
  { id: "other", label: "Other" },
];


export const QUESTIONNAIRE: PosQuestion[] = [
  // ── Your business (§10) ──
  {
    id: "business_type",
    section: "business",
    title: "What is your business?",
    help: "Pick the closest match. You can change it later, and you can always describe your own.",
    kind: "choice",
    allowCustom: true,
    customLabel: "Something else",
    required: true,
    options: [],
  },
  {
    id: "business_other",
    section: "business",
    title: "Tell us briefly what your business does",
    help: "A sentence is enough. JATA uses it to choose the right features (§19).",
    kind: "text",
    placeholder: "We repair and service water pumps for farms",
    required: true,
    when: (answers) => {
      const raw = answeredText(answers, "business_type");
      return !raw || raw === "other" || !getBusinessType(raw) || Boolean(answeredText(answers, "business_custom"));
    },
  },
  {
    id: "business_custom",
    section: "business",
    title: "What should we call your type of business?",
    help: "This word is used across your POS instead of a generic label.",
    kind: "text",
    placeholder: "Pump repairs",
    when: (answers) => Boolean(answeredText(answers, "business_type")) && !isKnownType(answeredText(answers, "business_type")),
  },

  {
    id: "custom_words",
    section: "business",
    title: "Would you like your own words on screen?",
    help: "JATA already uses the words your trade uses. Say yes if you would rather see something else — \"Clients\" instead of \"Customers\", \"Jobs\" instead of \"Orders\".",
    kind: "yesno",
    defaultValue: false,
    // Only asked when it can actually change something (§41): the trade already renames things,
    // or the business described itself and may have its own vocabulary.
    when: (answers) => {
      if (answeredBool(answers, "custom_words") === true) return true;
      const profile = typeProfile(answers);
      return Object.keys(profile.terminology).length > 0 || profile.key === "other";
    },
  },

  // ── How you sell (§11) ──
  {
    id: "sells",
    section: "selling",
    title: "How do you sell?",
    help: "Choose everything that applies.",
    kind: "multi",
    required: true,
    options: [
      { id: "products", label: "Products", hint: "Things you keep and hand over", icon: "📦" },
      { id: "services", label: "Services", hint: "Work you do for someone", icon: "🛠️" },
      { id: "bookings", label: "Bookings", hint: "A date and time", icon: "📅" },
      { id: "subscriptions", label: "Subscriptions", hint: "Billed again and again", icon: "🔁" },
      { id: "projects", label: "Projects", hint: "Work over days or weeks", icon: "📋" },
      { id: "contracts", label: "Contracts", hint: "Agreed work with a value", icon: "📝" },
      { id: "custom_orders", label: "Custom orders", hint: "Made to a customer's spec", icon: "✂️" },
    ],
  },
  {
    id: "payment_methods",
    section: "selling",
    title: "How do customers pay?",
    help: "Choose every way you accept money.",
    kind: "multi",
    required: true,
    defaultValue: ["cash", "mpesa"],
    options: [
      { id: "cash", label: "Cash", icon: "💵" },
      { id: "mpesa", label: "M-Pesa", icon: "📱" },
      { id: "bank", label: "Bank transfer", icon: "🏦" },
      { id: "card", label: "Card", icon: "💳" },
      { id: "credit", label: "Credit", hint: "Pay later", icon: "📒" },
      { id: "other", label: "Other", icon: "➕" },
    ],
  },
  {
    id: "payment_other_labels",
    section: "selling",
    title: "Which other payment methods?",
    help: "Separate them with commas, for example: Cheque, Sacco.",
    kind: "text",
    placeholder: "Cheque, Sacco",
    when: (answers) => answeredList(answers, "payment_methods").includes("other"),
  },
  {
    id: "discounts",
    section: "selling",
    title: "Do you give discounts?",
    kind: "yesno",
    defaultValue: false,
  },
  {
    id: "quotations",
    section: "selling",
    title: "Do you quote a price before starting work?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) =>
      sells(answers, "services") ||
      answeredList(answers, "sells").some((kind) => ["projects", "custom_orders", "contracts"].includes(kind)) ||
      typeOffers(answers, "quotation"),
  },
  {
    id: "deposits",
    section: "selling",
    title: "Do you take a deposit before you start?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) =>
      answeredBool(answers, "quotations") === true ||
      answeredList(answers, "sells").some((kind) => ["projects", "custom_orders", "bookings"].includes(kind)) ||
      typeOffers(answers, "deposits"),
  },
  {
    id: "split_payments",
    section: "selling",
    title: "Does one sale ever get paid two ways?",
    help: "For example part cash and part M-Pesa.",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => answeredList(answers, "payment_methods").length > 1,
  },
  {
    id: "tax",
    section: "selling",
    title: "Do you add tax to your sales?",
    kind: "yesno",
    defaultValue: false,
  },
  {
    id: "tax_rate",
    section: "selling",
    title: "What tax rate do you charge?",
    kind: "number",
    unit: "%",
    min: 0,
    max: 100,
    step: 0.5,
    defaultValue: 16,
    when: (answers) => answeredBool(answers, "tax") === true,
  },

  // ── Credit (§11, §30) ──
  {
    id: "credit_frequency",
    section: "credit",
    title: "Do you sell on credit?",
    help: "Credit means the customer takes the goods or service now and pays you later.",
    kind: "choice",
    defaultValue: "never",
    options: [
      { id: "never", label: "Never", hint: "Everyone pays before they leave" },
      { id: "sometimes", label: "Sometimes", hint: "A few trusted customers" },
      { id: "frequently", label: "Frequently", hint: "Most weeks someone owes you" },
      { id: "most", label: "Most customers", hint: "Credit is how your business runs" },
    ],
    when: (answers) =>
      answeredList(answers, "payment_methods").includes("credit") ||
      answeredText(answers, "credit_frequency") !== "" ||
      typeOffers(answers, "customer_credit"),
  },
  {
    id: "credit_qualifies",
    section: "credit",
    title: "Who qualifies for credit?",
    help: "In your own words — your staff will see this when they approve credit.",
    kind: "text",
    placeholder: "Contractors we have supplied for over six months",
    when: (answers) => creditEnabled(answers),
  },
  {
    id: "credit_limit",
    section: "credit",
    title: "What is the most one customer may owe you?",
    help: "You can set a different limit for each customer later.",
    kind: "amount",
    unit: "KES",
    min: 0,
    max: 100_000_000,
    step: 500,
    defaultValue: 20000,
    when: (answers) => creditEnabled(answers),
  },
  {
    id: "credit_terms_days",
    section: "credit",
    title: "How many days do customers have to pay?",
    kind: "number",
    unit: "days",
    min: 1,
    max: 365,
    defaultValue: 30,
    when: (answers) => creditEnabled(answers),
  },
  {
    id: "credit_staff_approve",
    section: "credit",
    title: "Can your staff approve a credit sale?",
    help: "If not, only an owner or manager can.",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => creditEnabled(answers) && answeredBool(answers, "has_staff") === true,
  },
  {
    id: "credit_deposits",
    section: "credit",
    title: "Do credit customers pay a deposit first?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => creditEnabled(answers),
  },

  // ── Stock (§13) ──
  {
    id: "keeps_stock",
    section: "stock",
    title: "Do you keep stock?",
    help: "Only asked because you sell products.",
    kind: "yesno",
    required: true,
    defaultValue: true,
    when: (answers) => sells(answers, "products"),
  },
  {
    id: "units",
    section: "stock",
    title: "What do you sell by?",
    help: "Choose all that apply. You can add your own unit too.",
    kind: "multi",
    allowCustom: true,
    customLabel: "Custom unit",
    required: true,
    defaultValue: ["piece"],
    options: QUESTIONNAIRE_UNIT_KEYS.map((key) => ({ id: key, label: unitChoiceLabel(key) })),
    when: (answers) => answeredBool(answers, "keeps_stock") === true,
  },
  {
    id: "unit_conversion_factor",
    section: "stock",
    title: "How many pieces are in one big unit?",
    help: "For example 1 carton = 24 pieces. You can add more conversions later.",
    kind: "number",
    min: 2,
    max: 10000,
    unit: "pieces",
    when: (answers) => answeredBool(answers, "keeps_stock") === true && bigUnit(answers) !== null,
  },
  {
    id: "variants",
    section: "stock",
    title: "Do your products come in sizes, colours or shades?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "keeps_stock") === true && typeOffers(answers, "variants"),
  },
  {
    id: "barcode",
    section: "stock",
    title: "Do your products have barcodes?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "keeps_stock") === true && typeOffers(answers, "barcodes"),
  },
  {
    id: "expiry",
    section: "stock",
    title: "Do any of your products expire?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "keeps_stock") === true && typeOffers(answers, "expiry_tracking"),
  },
  {
    id: "batches",
    section: "stock",
    title: "Do you need batch numbers?",
    help: "Useful when a supplier recalls a batch.",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "keeps_stock") === true && typeOffers(answers, "batch_tracking"),
  },
  {
    id: "serials",
    section: "stock",
    title: "Do you track individual serial numbers?",
    help: "Common for electronics and warranty work.",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "keeps_stock") === true && typeOffers(answers, "serial_numbers"),
  },
  {
    id: "stock_counts",
    section: "stock",
    title: "Do you count your stock regularly?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => answeredBool(answers, "keeps_stock") === true && typeOffers(answers, "stock_counts"),
  },
  {
    id: "manufacturing",
    section: "stock",
    title: "Do you make or assemble what you sell?",
    help: "Raw materials go in, finished products come out.",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "keeps_stock") === true && typeOffers(answers, "manufacturing"),
  },
  {
    id: "wastage",
    section: "stock",
    title: "Do you need to record wastage or spoilage?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "keeps_stock") === true && typeOffers(answers, "wastage"),
  },

  // ── Customers (§14) ──
  {
    id: "keeps_customers",
    section: "customers",
    title: "Do you keep customer records?",
    kind: "yesno",
    defaultValue: true,
  },
  {
    id: "customer_fields",
    section: "customers",
    title: "What do you keep about a customer?",
    kind: "multi",
    defaultValue: ["name", "phone"],
    options: [
      { id: "name", label: "Name" },
      { id: "phone", label: "Phone number" },
      { id: "email", label: "Email" },
      { id: "location", label: "Location" },
      { id: "number", label: "Customer number" },
      { id: "notes", label: "Notes" },
    ],
    when: (answers) => answeredBool(answers, "keeps_customers") === true,
  },
  {
    id: "repeat_customers",
    section: "customers",
    title: "Are your customers usually repeat customers?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "keeps_customers") === true,
  },
  {
    id: "loyalty",
    section: "customers",
    title: "Would you like to reward loyal customers?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "repeat_customers") === true && typeOffers(answers, "loyalty"),
  },

  // ── Orders & delivery (§28, §29) ──
  {
    id: "orders",
    section: "orders",
    title: "Do customers order ahead?",
    help: "By phone, WhatsApp, your business page or in person for later collection.",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => typeOffers(answers, "orders") || typeOffers(answers, "delivery") || typeOffers(answers, "pickup"),
  },
  {
    id: "order_channels",
    section: "orders",
    title: "Where do orders come from?",
    kind: "multi",
    defaultValue: ["walk_in", "phone"],
    options: [
      { id: "walk_in", label: "Walk-in", icon: "🚶🏾" },
      { id: "phone", label: "Phone call", icon: "📞" },
      { id: "whatsapp", label: "WhatsApp", icon: "💬" },
      { id: "business_page", label: "JATA business page", icon: "🔗" },
      { id: "online", label: "Website", icon: "🌐" },
      { id: "staff", label: "Entered by staff", icon: "🧑🏾‍💼" },
    ],
    when: (answers) => answeredBool(answers, "orders") === true,
  },
  {
    id: "delivery",
    section: "orders",
    title: "Do you deliver to customers?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "orders") === true || isFocusQuestion(answers, "delivery") || typeOffers(answers, "delivery"),
  },
  {
    id: "pickup",
    section: "orders",
    title: "Do customers collect their orders?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => answeredBool(answers, "orders") === true || typeOffers(answers, "pickup"),
  },
  {
    id: "order_workflow",
    section: "orders",
    title: "How does an order move through your business?",
    help: "This sets the statuses your staff will see. You can trim it later.",
    kind: "choice",
    when: (answers) => answeredBool(answers, "orders") === true,
    options: [],
  },

  // ── Suppliers (§12) ──
  {
    id: "has_suppliers",
    section: "suppliers",
    title: "Do you buy from suppliers?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => answeredBool(answers, "keeps_stock") === true || answeredBool(answers, "manufacturing") === true,
  },
  {
    id: "supplier_payment_methods",
    section: "suppliers",
    title: "How do you pay suppliers?",
    kind: "multi",
    defaultValue: ["cash", "mpesa"],
    options: [
      { id: "cash", label: "Cash" },
      { id: "mpesa", label: "M-Pesa" },
      { id: "bank", label: "Bank transfer" },
      { id: "card", label: "Card" },
      { id: "credit", label: "Credit" },
      { id: "mixed", label: "A mix of these" },
    ],
    when: (answers) => answeredBool(answers, "has_suppliers") === true,
  },
  {
    id: "supplier_credit",
    section: "suppliers",
    title: "Do suppliers let you buy now and pay later?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) =>
      answeredBool(answers, "has_suppliers") === true &&
      (answeredList(answers, "supplier_payment_methods").includes("credit") ||
        answeredList(answers, "supplier_payment_methods").includes("mixed") ||
        typeOffers(answers, "supplier_credit")),
  },
  {
    id: "supplier_terms_days",
    section: "suppliers",
    title: "How many days do suppliers give you to pay?",
    kind: "number",
    unit: "days",
    min: 1,
    max: 365,
    defaultValue: 30,
    when: (answers) => answeredBool(answers, "supplier_credit") === true,
  },
  {
    id: "purchase_orders",
    section: "suppliers",
    title: "Do you order stock before it arrives?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "has_suppliers") === true,
  },
  {
    id: "partial_receiving",
    section: "suppliers",
    title: "Do suppliers sometimes deliver an order in parts?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => answeredBool(answers, "purchase_orders") === true,
  },

  // ── Staff (§15) ──
  {
    id: "has_staff",
    section: "staff",
    title: "Do other people use the system?",
    kind: "yesno",
    defaultValue: false,
  },
  {
    id: "staff_count",
    section: "staff",
    title: "How many people will use it?",
    kind: "number",
    min: 1,
    max: 500,
    defaultValue: 2,
    when: (answers) => answeredBool(answers, "has_staff") === true,
  },
  {
    id: "staff_roles",
    section: "staff",
    title: "What do they do?",
    help: "Choose the roles you need. Each role gets sensible permissions you can change.",
    kind: "multi",
    options: [
      { id: "MANAGER", label: "Manager" },
      { id: "CASHIER", label: "Cashier" },
      { id: "SALESPERSON", label: "Salesperson" },
      { id: "INVENTORY", label: "Inventory staff" },
      { id: "ACCOUNTANT", label: "Accountant" },
      { id: "TECHNICIAN", label: "Technician" },
      { id: "WAITER", label: "Waiter" },
      { id: "STYLIST", label: "Stylist / barber" },
      { id: "DELIVERY", label: "Delivery staff" },
    ],
    when: (answers) => answeredBool(answers, "has_staff") === true,
  },
  {
    id: "sales_attribution",
    section: "staff",
    title: "Should sales be attributed to staff?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => answeredBool(answers, "has_staff") === true,
  },
  {
    id: "commissions",
    section: "staff",
    title: "Do you pay staff commission?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "sales_attribution") === true && typeOffers(answers, "commissions"),
  },
  {
    id: "approvals",
    section: "staff",
    title: "Should some actions need a manager's approval?",
    help: "Refunds, discounts and credit approval are the usual ones.",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => answeredBool(answers, "has_staff") === true,
  },

  // ── Locations (§16) ──
  {
    id: "multi_branch",
    section: "locations",
    title: "Do you operate more than one location?",
    kind: "yesno",
    defaultValue: false,
  },
  {
    id: "branch_count",
    section: "locations",
    title: "How many locations?",
    kind: "number",
    min: 2,
    max: 200,
    defaultValue: 2,
    when: (answers) => answeredBool(answers, "multi_branch") === true,
  },
  {
    id: "stock_by_branch",
    section: "locations",
    title: "Do you track stock at each location?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => answeredBool(answers, "multi_branch") === true && answeredBool(answers, "keeps_stock") === true,
  },

  // ── Expenses (§17) ──
  {
    id: "tracks_expenses",
    section: "expenses",
    title: "Do you want to track business expenses?",
    kind: "yesno",
    defaultValue: true,
  },
  {
    id: "expense_categories",
    section: "expenses",
    title: "Which expenses matter to you?",
    help: "You can add your own categories later.",
    kind: "multi",
    allowCustom: true,
    customLabel: "Add your own",
    defaultValue: ["rent", "electricity", "transport", "salaries"],
    options: EXPENSE_CATEGORY_OPTIONS,
    when: (answers) => answeredBool(answers, "tracks_expenses") === true,
  },

  // ── Your trade (§18) — only what this trade asked for ──
  {
    id: "restaurant_tables",
    section: "trade",
    title: "Do you serve customers at tables?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "restaurant_tables", "tables"),
  },
  {
    id: "restaurant_kitchen",
    section: "trade",
    title: "Should orders go to a kitchen screen?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "restaurant_kitchen", "kitchen_orders"),
  },
  {
    id: "menu_modifiers",
    section: "trade",
    title: "Do customers add extras or changes?",
    help: "Such as no onions, extra cheese or a side of chips.",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "menu_modifiers", "modifiers"),
  },
  {
    id: "recipes",
    section: "trade",
    title: "Do you want recipes to use up ingredients?",
    help: "Selling a dish reduces the ingredients it uses.",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "recipes", "recipes") && answeredBool(answers, "keeps_stock") === true,
  },
  {
    id: "appointments",
    section: "trade",
    title: "Do customers book appointments?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "appointments", "appointments"),
  },
  {
    id: "stylists",
    section: "trade",
    title: "Is work assigned to a specific person?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "stylists", "stylists") && answeredBool(answers, "has_staff") === true,
  },
  {
    id: "packages",
    section: "trade",
    title: "Do you sell packages or bundles?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "packages", "service_packages") || trade(answers, "packages", "event_packages"),
  },
  {
    id: "vehicles",
    section: "trade",
    title: "Do you keep each customer's vehicles?",
    help: "Registration numbers and service history stay with the vehicle.",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "vehicles", "vehicles"),
  },
  {
    id: "job_cards",
    section: "trade",
    title: "Do you run a job card per job?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "job_cards", "job_cards"),
  },
  {
    id: "estimates",
    section: "trade",
    title: "Do you give an estimate before starting?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "estimates", "estimates"),
  },
  {
    id: "technicians",
    section: "trade",
    title: "Is a job assigned to a technician?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "technicians", "technicians") && answeredBool(answers, "has_staff") === true,
  },
  {
    id: "parts",
    section: "trade",
    title: "Do jobs use spare parts from your stock?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "parts", "parts_consumption") && answeredBool(answers, "keeps_stock") === true,
  },
  {
    id: "harvests",
    section: "trade",
    title: "Do you record harvests?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "harvests", "harvests"),
  },
  {
    id: "seasons",
    section: "trade",
    title: "Do you compare one season with another?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "seasons", "seasonal_records"),
  },
  {
    id: "buyers",
    section: "trade",
    title: "Do you keep records of your buyers?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "buyers", "buyers"),
  },
  {
    id: "tiers",
    section: "trade",
    title: "Do different customers get different prices?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "tiers", "customer_tiers"),
  },
  {
    id: "minimums",
    section: "trade",
    title: "Is there a minimum quantity per order?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "minimums", "minimum_quantities"),
  },
  {
    id: "routes",
    section: "trade",
    title: "Do you plan deliveries by route?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "routes", "routes") && answeredBool(answers, "delivery") === true,
  },
  {
    id: "warehouses",
    section: "trade",
    title: "Do you keep stock in more than one store or warehouse?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "warehouses", "warehouses") || trade(answers, "warehouses", "multi_location"),
  },
  {
    id: "bom",
    section: "trade",
    title: "Do you keep a recipe or bill of materials?",
    help: "What goes into each finished product.",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "bom", "bill_of_materials") && answeredBool(answers, "manufacturing") === true,
  },
  {
    id: "work_orders",
    section: "trade",
    title: "Do you schedule production runs?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "work_orders", "work_orders") && answeredBool(answers, "manufacturing") === true,
  },
  {
    id: "production_costs",
    section: "trade",
    title: "Do you want to know what each batch cost to make?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "production_costs", "production_costs") && answeredBool(answers, "manufacturing") === true,
  },
  {
    id: "projects",
    section: "trade",
    title: "Do you run projects for clients?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "projects", "projects") || answeredList(answers, "sells").includes("projects"),
  },
  {
    id: "retainers",
    section: "trade",
    title: "Do clients pay a retainer?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "retainers", "retainers") && answeredBool(answers, "projects") === true,
  },
  {
    id: "time_tracking",
    section: "trade",
    title: "Do you track time spent on work?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "time_tracking", "time_tracking") && answeredBool(answers, "projects") === true,
  },
  {
    id: "recurring",
    section: "trade",
    title: "Do you bill the same amount on a schedule?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "recurring", "recurring_billing") || answeredList(answers, "sells").includes("subscriptions"),
  },
  {
    id: "properties",
    section: "trade",
    title: "Do you manage properties and units?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "properties", "properties"),
  },
  {
    id: "tenants",
    section: "trade",
    title: "Do you keep tenant records?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "tenants", "tenants") && answeredBool(answers, "properties") !== false,
  },
  {
    id: "landlords",
    section: "trade",
    title: "Do you pay or report to landlords?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "landlords", "landlords"),
  },
  {
    id: "rent",
    section: "trade",
    title: "Do you collect rent?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "rent", "rent") && answeredBool(answers, "tenants") !== false,
  },
  {
    id: "payment_plans",
    section: "trade",
    title: "Do people pay in instalments?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "payment_plans", "payment_plans") || trade(answers, "payment_plans", "fees"),
  },
  {
    id: "courses",
    section: "trade",
    title: "Do you run courses or classes?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "courses", "courses"),
  },
  {
    id: "fees",
    section: "trade",
    title: "Do you charge fees with balances?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "fees", "fees"),
  },
  {
    id: "instructors",
    section: "trade",
    title: "Is each class taught by a specific person?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "instructors", "instructors") && answeredBool(answers, "has_staff") === true,
  },
  {
    id: "events",
    section: "trade",
    title: "Do you run events for clients?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "events", "events"),
  },
  {
    id: "payment_schedules",
    section: "trade",
    title: "Do clients pay a deposit now and a balance later?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "payment_schedules", "payment_schedules") && answeredBool(answers, "events") !== false,
  },
  {
    id: "garments",
    section: "trade",
    title: "Do you count items a customer drops off?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "garments", "garments"),
  },
  {
    id: "service_types",
    section: "trade",
    title: "Do you offer different service types?",
    help: "Such as wash, dry-clean and press.",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "service_types", "service_types"),
  },
  {
    id: "artwork",
    section: "trade",
    title: "Do jobs have artwork or reference files?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "artwork", "artwork"),
  },
  {
    id: "production_status",
    section: "trade",
    title: "Do you track a job through production?",
    kind: "yesno",
    defaultValue: true,
    when: (answers) => trade(answers, "production_status", "production_status"),
  },
  {
    id: "wholesale_pricing",
    section: "trade",
    title: "Do you have a wholesale price for bulk buyers?",
    kind: "yesno",
    defaultValue: false,
    when: (answers) => trade(answers, "wholesale_pricing", "wholesale_pricing") || trade(answers, "wholesale_pricing", "bulk_pricing"),
  },
];


const QUESTION_BY_ID = new Map(QUESTIONNAIRE.map((question) => [question.id, question]));

export function getQuestion(id: string): PosQuestion | undefined {
  return QUESTION_BY_ID.get(id);
}

export function isKnownType(value: string): boolean {
  const profile = getBusinessType(value);
  return profile.key === value.trim().toLowerCase();
}

export function creditEnabled(answers: QuestionnaireAnswers): boolean {
  if (answeredList(answers, "payment_methods").includes("credit")) return true;
  const frequency = answeredText(answers, "credit_frequency");
  return frequency !== "" && frequency !== "never";
}

/** The big unit in the answer set, if the owner chose one — drives the conversion question. */
export function bigUnit(answers: QuestionnaireAnswers): string | null {
  const units = answeredList(answers, "units");
  const big = ["carton", "box", "dozen", "sack", "bag", "crate", "pack", "roll"];
  return units.find((unit) => big.includes(unit)) ?? null;
}

/** Options that depend on the registry (business types, workflows) are filled in per answer set. */
export function questionWithOptions(question: PosQuestion, answers: QuestionnaireAnswers): PosQuestion {
  if (question.id === "business_type") {
    return { ...question, options: businessTypeOptions() };
  }
  if (question.id === "order_workflow") {
    const profile = typeProfile(answers);
    return {
      ...question,
      defaultValue: profile.workflowKey,
      options: workflowsForBusinessType(profile.key, profile.capabilities).map((workflow) => ({
        id: workflow.key,
        label: workflow.label,
        hint: workflow.states.map((state) => state.label).join(" → "),
      })),
    };
  }
  return question;
}

export function businessTypeOptions(): { id: string; label: string; hint?: string; icon?: string }[] {
  return BUSINESS_TYPE_OPTIONS;
}

const BUSINESS_TYPE_OPTIONS = BUSINESS_TYPES.map((type) => ({
  id: type.key,
  label: type.label,
  hint: type.blurb,
  icon: type.icon,
}));

function unitChoiceLabel(key: UnitKey): string {
  const labels: Record<string, string> = {
    piece: "Piece", box: "Box", carton: "Carton", kilogram: "Kilogram", gram: "Gram",
    litre: "Litre", millilitre: "Millilitre", metre: "Metre", centimetre: "Centimetre",
    pair: "Pair", dozen: "Dozen", pack: "Pack", roll: "Roll", bottle: "Bottle", sack: "Sack",
  };
  return labels[key] ?? key;
}

// ── Flow control (§9, §40, §41) ───────────────────────────────────────────────

export function isQuestionVisible(question: PosQuestion, answers: QuestionnaireAnswers): boolean {
  if (!question.when) return true;
  try {
    return question.when(answers) === true;
  } catch {
    // A broken predicate must never blank the whole questionnaire (§47 safe baseline).
    return true;
  }
}

export function visibleQuestions(answers: QuestionnaireAnswers): PosQuestion[] {
  return QUESTIONNAIRE.filter((question) => isQuestionVisible(question, answers));
}

export function isAnswered(answers: QuestionnaireAnswers, question: PosQuestion): boolean {
  const value = answers[question.id];
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Removing an answer also removes everything that depended on it, so an owner who changes
 * their mind never carries a stale configuration forward (§40).
 */
export function pruneAnswers(answers: QuestionnaireAnswers): QuestionnaireAnswers {
  let current: QuestionnaireAnswers = { ...answers };
  // Pruning can hide further questions, so repeat until the answer set stops shrinking.
  for (let pass = 0; pass < QUESTIONNAIRE.length + 1; pass += 1) {
    const visible = new Set(visibleQuestions(current).map((question) => question.id));
    const next: QuestionnaireAnswers = {};
    for (const [key, value] of Object.entries(current)) {
      // The chosen business type and its custom label are always kept (§19).
      if (key === "business_type" || key === "business_custom" || visible.has(key)) next[key] = value;
    }
    if (Object.keys(next).length === Object.keys(current).length) return next;
    current = next;
  }
  return current;
}

/**
 * Fill in the declared default for every question that is relevant right now and was left
 * unanswered (§22, §41).
 *
 * The questionnaire pre-selects these on screen, so an owner who taps straight through has
 * already accepted them. Storing the same values keeps the profile the server builds identical to
 * the one the owner was shown, and stops a skipped question configuring nothing at all: an owner
 * who says "yes, I track expenses" but never opens the category picker still gets usable
 * categories instead of every expense being filed as Other (§17).
 *
 * Defaults are applied repeatedly because accepting one can reveal a further question that has a
 * default of its own.
 */
export function applyQuestionDefaults(answers: QuestionnaireAnswers): QuestionnaireAnswers {
  const current: QuestionnaireAnswers = { ...answers };
  for (let pass = 0; pass < QUESTIONNAIRE.length + 1; pass += 1) {
    let changed = false;
    for (const question of visibleQuestions(current)) {
      if (isAnswered(current, question)) continue;
      const fallback = question.defaultValue;
      if (fallback === undefined || fallback === null || fallback === "") continue;
      if (Array.isArray(fallback) && fallback.length === 0) continue;
      current[question.id] = fallback;
      changed = true;
    }
    if (!changed) return current;
  }
  return current;
}

export function nextQuestion(answers: QuestionnaireAnswers): PosQuestion | null {
  for (const question of visibleQuestions(answers)) {
    if (!isAnswered(answers, question)) return questionWithOptions(question, answers);
  }
  return null;
}

export function questionIndex(answers: QuestionnaireAnswers): number {
  const next = nextQuestion(answers);
  const visible = visibleQuestions(answers);
  if (!next) return visible.length;
  return visible.findIndex((question) => question.id === next.id);
}

export function questionProgress(answers: QuestionnaireAnswers): {
  answered: number; total: number; percent: number; section: string; sectionLabel: string;
} {
  const visible = visibleQuestions(answers);
  const answered = visible.filter((question) => isAnswered(answers, question)).length;
  const next = nextQuestion(answers);
  const sectionKey = (next?.section ?? visible[visible.length - 1]?.section ?? "business") as QuestionSectionKey;
  const section = QUESTION_SECTIONS.find((entry) => entry.key === sectionKey);
  return {
    answered,
    total: visible.length,
    percent: visible.length ? Math.round((answered / visible.length) * 100) : 100,
    section: sectionKey,
    sectionLabel: section?.label ?? "Your business",
  };
}

/** Sensible starting answers for a business type, so the questionnaire starts short (§9, §26). */
export function initialAnswers(typeKey: BusinessTypeKey | string, existing?: QuestionnaireAnswers): QuestionnaireAnswers {
  const profile = getBusinessType(typeKey);
  const seeded: QuestionnaireAnswers = {
    business_type: profile.key,
    sells: [...(profile.answers.sells as string[] ?? ["products"])],
    payment_methods: ["cash", "mpesa"],
    keeps_customers: true,
    customer_fields: ["name", "phone"],
    ...profile.answers,
  };
  return pruneAnswers({ ...seeded, ...(existing ?? {}) });
}

/**
 * Switching business type re-seeds defaults for answers the owner has not explicitly set.
 * Answers the owner already gave are respected (§26 — answer only missing questions).
 */
export function applyBusinessType(answers: QuestionnaireAnswers, typeKey: string, explicit: Set<string> = new Set()): QuestionnaireAnswers {
  const profile = resolveBusinessType(typeKey);
  const seeded = initialAnswers(profile.key);
  const merged: QuestionnaireAnswers = { ...answers };
  for (const [key, value] of Object.entries(seeded)) {
    if (key === "business_type") continue;
    if (explicit.has(key) || isAnswered(answers, getQuestion(key) ?? { id: key } as PosQuestion)) continue;
    merged[key] = value;
  }
  merged.business_type = profile.key;
  return pruneAnswers(merged);
}

export type ReadinessIssue = { questionId: string; title: string; section: string };

/**
 * Configuration confidence (§42). Ready means every required visible question is answered;
 * anything else is reported as "one more question" rather than a silent guess.
 */
export function configurationReadiness(answers: QuestionnaireAnswers): {
  ready: boolean; missing: ReadinessIssue[]; askedCount: number;
} {
  const visible = visibleQuestions(answers);
  const missing: ReadinessIssue[] = [];
  for (const question of visible) {
    if (question.required && !isAnswered(answers, question)) {
      missing.push({ questionId: question.id, title: question.title, section: question.section });
    }
  }
  // Credit selected as a payment method but no credit terms recorded yet (§11, §30).
  if (answeredList(answers, "payment_methods").includes("credit") && !answeredText(answers, "credit_frequency")) {
    const question = getQuestion("credit_frequency");
    if (question) missing.push({ questionId: question.id, title: question.title, section: question.section });
  }
  if (sells(answers, "products") && answeredBool(answers, "keeps_stock") === null) {
    const question = getQuestion("keeps_stock");
    if (question) missing.push({ questionId: question.id, title: question.title, section: question.section });
  }
  if (!answeredText(answers, "business_type")) {
    const question = getQuestion("business_type");
    if (question) missing.unshift({ questionId: question.id, title: question.title, section: question.section });
  }
  return { ready: missing.length === 0, missing, askedCount: visible.length };
}

/** Sanitize an incoming answer payload — never trust the browser with types (§56). */
export function sanitizeAnswers(input: unknown): QuestionnaireAnswers {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const clean: QuestionnaireAnswers = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const question = QUESTION_BY_ID.get(key);
    if (!question) continue;
    clean[key] = sanitizeValue(value, question);
  }
  return pruneAnswers(clean);
}

export function sanitizeValue(value: unknown, question: PosQuestion): AnswerValue {
  if (value === null || value === undefined) return null;
  switch (question.kind) {
    case "yesno":
      if (value === true || value === "yes") return true;
      if (value === false || value === "no") return false;
      return null;
    case "number":
    case "amount": {
      const parsed = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(parsed)) return null;
      const min = question.min ?? 0;
      const max = question.max ?? 1_000_000_000;
      return Math.min(Math.max(parsed, min), max);
    }
    case "text":
      return String(value).replace(/[<>]/g, "").trim().slice(0, 500) || null;
    case "multi": {
      const list = Array.isArray(value) ? value : String(value).split(",");
      const allowed = new Set((question.options ?? []).map((option) => option.id));
      const chosen = list
        .map((entry) => String(entry).trim())
        .filter((entry) => entry && (allowed.has(entry) || question.allowCustom))
        .slice(0, 40);
      return [...new Set(chosen)];
    }
    case "choice":
    default: {
      const text = String(value).trim().slice(0, 120);
      if (!text) return null;
      const allowed = new Set((question.options ?? []).map((option) => option.id));
      if (allowed.size && !allowed.has(text) && !question.allowCustom) return null;
      return text;
    }
  }
}

/** The minimum still to ask, in words the owner sees (§41, §42). */
export function minimumRemainingQuestions(answers: QuestionnaireAnswers): PosQuestion[] {
  const { missing } = configurationReadiness(answers);
  return missing
    .map((issue) => QUESTION_BY_ID.get(issue.questionId))
    .filter((question): question is PosQuestion => Boolean(question));
}
