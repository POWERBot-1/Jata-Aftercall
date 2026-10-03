/**
 * Capability library (§8, §52, §76)
 *
 * Reusable capabilities rather than business-specific hardcoding. A capability is data:
 * a plain-language label, the module it lives in, what it depends on and what it implies.
 * Adding "loyalty" to every salon in Kenya is one entry here — never an `if (salon)` branch
 * somewhere in the application (§52).
 */

import type { CapabilityKey, PosConfiguration, PosModuleKey } from "./types";

export type CapabilityGroup =
  | "sales" | "customers" | "inventory" | "procurement"
  | "finance" | "staff" | "orders" | "reporting" | "industry";

export type CapabilityDefinition = {
  key: CapabilityKey;
  label: string;
  /** One sentence an owner can understand. Shown in edit mode (§22). */
  description: string;
  group: CapabilityGroup;
  /** Plain-language question used by the capability editor (§22). */
  question?: string;
  /** Capabilities that must be on for this one to make sense. */
  requires?: CapabilityKey[];
  /** Capabilities switched on together with this one. */
  implies?: CapabilityKey[];
  /** Where the capability shows up in the generated POS (§24). */
  module?: PosModuleKey;
  /** Industry capabilities are offered only when the business type asks for them (§18). */
  industryOnly?: boolean;
};

function def(definition: CapabilityDefinition): CapabilityDefinition {
  return definition;
}

/** ── Sales (§8) ─────────────────────────────────────────────────────────────── */
const SALES: CapabilityDefinition[] = [
  def({ key: "pos_sale", label: "Counter sales", description: "Record a sale at the counter and take payment.", group: "sales", module: "sell", question: "Do you sell directly to customers at a counter or desk?" }),
  def({ key: "product_sales", label: "Product sales", description: "Sell physical items.", group: "sales", module: "sell", implies: ["catalogue"] }),
  def({ key: "service_sales", label: "Service sales", description: "Sell work you do — labour, treatments, repairs, sessions.", group: "sales", module: "sell" }),
  def({ key: "quotation", label: "Quotations", description: "Give a customer a price before they commit.", group: "sales", module: "orders" }),
  def({ key: "invoice", label: "Invoices", description: "Issue an invoice a customer pays later.", group: "sales", module: "orders" }),
  def({ key: "receipt", label: "Receipts", description: "Give a receipt after every sale.", group: "sales", module: "sell" }),
  def({ key: "returns", label: "Returns", description: "Accept goods back and return them to stock.", group: "sales", module: "sell", requires: ["pos_sale"] }),
  def({ key: "refunds", label: "Refunds", description: "Give money back for a completed sale.", group: "sales", module: "sell", requires: ["pos_sale"] }),
  def({ key: "discounts", label: "Discounts", description: "Reduce the price of an item or a whole sale.", group: "sales", module: "sell" }),
  def({ key: "promotions", label: "Promotions", description: "Run offers such as buy-one-get-one or a seasonal price.", group: "sales", module: "sell", requires: ["discounts"] }),
  def({ key: "deposits", label: "Deposits", description: "Take part payment now and the balance later.", group: "sales", module: "sell" }),
  def({ key: "partial_payments", label: "Partial payments", description: "Let a customer pay a sale in instalments.", group: "sales", module: "sell" }),
  def({ key: "split_payments", label: "Split payments", description: "Take one sale as part cash, part M-Pesa.", group: "sales", module: "sell" }),
  def({ key: "customer_pricing", label: "Customer-specific pricing", description: "Agree special prices with particular customers.", group: "sales", module: "customers", requires: ["customer_profiles"] }),
  def({ key: "wholesale_pricing", label: "Wholesale pricing", description: "A different price for people who buy in bulk.", group: "sales", module: "products" }),
  def({ key: "retail_pricing", label: "Retail pricing", description: "Your normal walk-in price.", group: "sales", module: "products" }),
  def({ key: "tax", label: "Tax", description: "Add tax to sales and show it on the receipt.", group: "sales", module: "settings" }),
  def({ key: "bundle_sales", label: "Bundles & combos", description: "Sell several items together as one price.", group: "sales", module: "products" }),
  def({ key: "subscriptions", label: "Subscriptions", description: "Bill a customer on a recurring schedule.", group: "sales", module: "orders" }),
  def({ key: "bookings", label: "Bookings", description: "Take appointments for a date and time.", group: "sales", module: "appointments" }),
  def({ key: "projects", label: "Projects", description: "Track work that runs over days or weeks.", group: "sales", module: "projects" }),
  def({ key: "contracts", label: "Contracts", description: "Manage agreed contracts and their value.", group: "sales", module: "projects" }),
  def({ key: "custom_orders", label: "Custom orders", description: "Make things to a customer's specification.", group: "sales", module: "orders" }),
  def({ key: "catalogue", label: "Catalogue", description: "A list of everything you sell with prices.", group: "sales", module: "products" }),
];

/** ── Customers (§8) ─────────────────────────────────────────────────────────── */
const CUSTOMERS: CapabilityDefinition[] = [
  def({ key: "customer_profiles", label: "Customer records", description: "Keep names, phone numbers and details of your customers.", group: "customers", module: "customers" }),
  def({ key: "customer_accounts", label: "Customer accounts", description: "Each customer has an account with a running balance.", group: "customers", module: "credit", requires: ["customer_profiles"] }),
  def({ key: "customer_credit", label: "Customer credit", description: "Let trusted customers take goods and pay later.", group: "customers", module: "credit", requires: ["customer_accounts"], implies: ["receivables"] }),
  def({ key: "credit_limits", label: "Credit limits", description: "Cap how much each customer may owe you.", group: "customers", module: "credit", requires: ["customer_credit"] }),
  def({ key: "customer_history", label: "Purchase history", description: "See what a customer has bought before.", group: "customers", module: "customers", requires: ["customer_profiles"] }),
  def({ key: "customer_notes", label: "Customer notes", description: "Keep notes about a customer on their record.", group: "customers", module: "customers", requires: ["customer_profiles"] }),
  def({ key: "customer_segments", label: "Customer groups", description: "Group customers such as contractors, walkers, VIPs.", group: "customers", module: "customers", requires: ["customer_profiles"] }),
  def({ key: "loyalty", label: "Loyalty", description: "Reward customers who keep coming back.", group: "customers", module: "customers", requires: ["customer_profiles"] }),
  def({ key: "statements", label: "Customer statements", description: "Print or share a statement of what a customer owes.", group: "customers", module: "credit", requires: ["customer_credit"] }),
];

/** ── Inventory (§8) ─────────────────────────────────────────────────────────── */
const INVENTORY: CapabilityDefinition[] = [
  def({ key: "products", label: "Products", description: "Items you keep and sell.", group: "inventory", module: "products" }),
  def({ key: "services", label: "Services", description: "Work you sell that has no stock.", group: "inventory", module: "services" }),
  def({ key: "stock_levels", label: "Stock quantities", description: "Always know how much stock you have.", group: "inventory", module: "inventory", requires: ["products"] }),
  def({ key: "stock_adjustments", label: "Stock adjustments", description: "Correct stock with a recorded reason.", group: "inventory", module: "inventory", requires: ["stock_levels"] }),
  def({ key: "stock_transfers", label: "Stock transfers", description: "Move stock between locations.", group: "inventory", module: "inventory", requires: ["stock_levels", "multi_location"] }),
  def({ key: "stock_counts", label: "Stock counts", description: "Count stock and reconcile the difference.", group: "inventory", module: "inventory", requires: ["stock_levels"] }),
  def({ key: "low_stock_alerts", label: "Low-stock alerts", description: "Get told when an item is running low.", group: "inventory", module: "inventory", requires: ["stock_levels"] }),
  def({ key: "reorder_levels", label: "Reorder levels", description: "Set the quantity at which you reorder.", group: "inventory", module: "inventory", requires: ["stock_levels"] }),
  def({ key: "variants", label: "Product variants", description: "Sizes, colours and shades of one product.", group: "inventory", module: "products", requires: ["products"] }),
  def({ key: "skus", label: "SKUs", description: "Your own product codes.", group: "inventory", module: "products", requires: ["products"] }),
  def({ key: "barcodes", label: "Barcodes", description: "Scan a product instead of typing it.", group: "inventory", module: "products", requires: ["products"] }),
  def({ key: "batch_tracking", label: "Batch numbers", description: "Track which batch stock came from.", group: "inventory", module: "inventory", requires: ["stock_levels"] }),
  def({ key: "expiry_tracking", label: "Expiry dates", description: "Track use-by dates and get warned before expiry.", group: "inventory", module: "inventory", requires: ["stock_levels"] }),
  def({ key: "serial_numbers", label: "Serial numbers", description: "Track individual units such as electronics.", group: "inventory", module: "inventory", requires: ["stock_levels"] }),
  def({ key: "units_of_measure", label: "Units of measure", description: "Sell by piece, kilo, metre, carton and more.", group: "inventory", module: "products", requires: ["products"] }),
  def({ key: "unit_conversions", label: "Unit conversions", description: "Know that one carton is 24 pieces.", group: "inventory", module: "products", requires: ["units_of_measure"] }),
  def({ key: "inventory_valuation", label: "Stock valuation", description: "See what your stock is worth at cost.", group: "inventory", module: "reports", requires: ["stock_levels"] }),
  def({ key: "multi_location", label: "Stock by location", description: "Track stock separately at each location.", group: "inventory", module: "branches", requires: ["stock_levels"] }),
  def({ key: "manufacturing", label: "Manufacturing", description: "Turn raw materials into finished goods.", group: "inventory", module: "inventory", requires: ["stock_levels"], industryOnly: true }),
  def({ key: "assembly", label: "Assembly", description: "Build a product from other products.", group: "inventory", module: "inventory", requires: ["stock_levels"], industryOnly: true }),
];

/** ── Procurement (§8) ───────────────────────────────────────────────────────── */
const PROCUREMENT: CapabilityDefinition[] = [
  def({ key: "suppliers", label: "Suppliers", description: "Keep records of the people you buy from.", group: "procurement", module: "suppliers" }),
  def({ key: "supplier_accounts", label: "Supplier accounts", description: "Each supplier has an account with a running balance.", group: "procurement", module: "suppliers", requires: ["suppliers"] }),
  def({ key: "supplier_credit", label: "Supplier credit", description: "Buy now and pay your supplier later.", group: "procurement", module: "suppliers", requires: ["supplier_accounts"], implies: ["payables"] }),
  def({ key: "supplier_balances", label: "Supplier balances", description: "See exactly what you owe each supplier.", group: "procurement", module: "suppliers", requires: ["supplier_accounts"] }),
  def({ key: "purchase_orders", label: "Purchase orders", description: "Order stock before it arrives.", group: "procurement", module: "purchases", requires: ["suppliers"] }),
  def({ key: "purchases", label: "Purchases", description: "Record stock you buy and add it to inventory.", group: "procurement", module: "purchases", requires: ["suppliers"] }),
  def({ key: "partial_receiving", label: "Partial receiving", description: "Receive an order in more than one delivery.", group: "procurement", module: "purchases", requires: ["purchase_orders"] }),
  def({ key: "supplier_invoices", label: "Supplier invoices", description: "Keep the invoice your supplier gave you.", group: "procurement", module: "purchases", requires: ["purchases"] }),
  def({ key: "purchase_returns", label: "Purchase returns", description: "Send goods back to a supplier.", group: "procurement", module: "purchases", requires: ["purchases"] }),
  def({ key: "supplier_payments", label: "Supplier payments", description: "Record money you pay a supplier.", group: "procurement", module: "suppliers", requires: ["suppliers"] }),
  def({ key: "supplier_statements", label: "Supplier statements", description: "A statement of what you owe a supplier.", group: "procurement", module: "suppliers", requires: ["supplier_accounts"] }),
  def({ key: "procurement_history", label: "Buying history", description: "See what you bought, from whom and at what price.", group: "procurement", module: "reports", requires: ["purchases"] }),
];

/** ── Finance (§8) ───────────────────────────────────────────────────────────── */
const FINANCE: CapabilityDefinition[] = [
  def({ key: "cash", label: "Cash", description: "Accept cash payments.", group: "finance", module: "sell" }),
  def({ key: "mpesa", label: "M-Pesa", description: "Accept M-Pesa and record the confirmation code.", group: "finance", module: "sell" }),
  def({ key: "bank", label: "Bank transfer", description: "Accept bank transfers.", group: "finance", module: "sell" }),
  def({ key: "card", label: "Card", description: "Accept card payments.", group: "finance", module: "sell" }),
  def({ key: "credit_payments", label: "Credit sales", description: "Sell now, collect later.", group: "finance", module: "credit", requires: ["customer_credit"] }),
  def({ key: "expenses", label: "Expenses", description: "Record what the business spends money on.", group: "finance", module: "expenses" }),
  def({ key: "income", label: "Income", description: "See everything the business earned.", group: "finance", module: "reports" }),
  def({ key: "receivables", label: "Money owed to you", description: "Track what customers owe you.", group: "finance", module: "credit", requires: ["customer_credit"] }),
  def({ key: "payables", label: "Money you owe", description: "Track what you owe suppliers — kept separate from customer credit.", group: "finance", module: "suppliers", requires: ["supplier_credit"] }),
  def({ key: "daily_closing", label: "Daily closing", description: "Close the day and see cash, M-Pesa and credit in one place.", group: "finance", module: "reports" }),
  def({ key: "cash_drawer", label: "Cash drawer", description: "Count the drawer and reconcile it.", group: "finance", module: "reports", requires: ["cash", "daily_closing"] }),
  def({ key: "reconciliation", label: "Reconciliation", description: "Match recorded payments to what actually arrived.", group: "finance", module: "reports" }),
  def({ key: "financial_summaries", label: "Financial summaries", description: "Income, expenses and profit at a glance.", group: "finance", module: "reports" }),
];

/** ── Staff (§8) ─────────────────────────────────────────────────────────────── */
const STAFF: CapabilityDefinition[] = [
  def({ key: "employee_profiles", label: "Staff records", description: "Add the people who use the system.", group: "staff", module: "staff" }),
  def({ key: "roles", label: "Roles", description: "Give each person a role such as cashier or manager.", group: "staff", module: "staff", requires: ["employee_profiles"] }),
  def({ key: "permissions", label: "Permissions", description: "Control exactly what each role may do.", group: "staff", module: "staff", requires: ["roles"] }),
  def({ key: "shifts", label: "Shifts", description: "Record who worked when.", group: "staff", module: "staff", requires: ["employee_profiles"] }),
  def({ key: "sales_attribution", label: "Sales by staff", description: "Know who made each sale.", group: "staff", module: "reports", requires: ["employee_profiles"] }),
  def({ key: "commissions", label: "Commissions", description: "Pay staff a share of what they sell.", group: "staff", module: "reports", requires: ["sales_attribution"] }),
  def({ key: "staff_performance", label: "Staff performance", description: "Compare how each person is doing.", group: "staff", module: "reports", requires: ["sales_attribution"] }),
  def({ key: "approval_workflows", label: "Approvals", description: "Require a manager to approve discounts, refunds or credit.", group: "staff", module: "settings", requires: ["roles"] }),
];

/** ── Orders & channels (§8, §28, §29, §70) ──────────────────────────────────── */
const ORDERS: CapabilityDefinition[] = [
  def({ key: "orders", label: "Orders", description: "Take an order and move it through to completion.", group: "orders", module: "orders" }),
  def({ key: "walkin_orders", label: "Walk-in orders", description: "Orders taken from someone at your premises.", group: "orders", module: "orders", requires: ["orders"] }),
  def({ key: "phone_orders", label: "Phone orders", description: "Orders taken over a phone call.", group: "orders", module: "orders", requires: ["orders"] }),
  def({ key: "whatsapp_orders", label: "WhatsApp orders", description: "Orders that arrive on WhatsApp.", group: "orders", module: "orders", requires: ["orders"] }),
  def({ key: "business_page_orders", label: "Business page orders", description: "Orders from your JATA business page.", group: "orders", module: "orders", requires: ["orders"] }),
  def({ key: "online_orders", label: "Online orders", description: "Orders placed on a website.", group: "orders", module: "orders", requires: ["orders"] }),
  def({ key: "reservations", label: "Reservations", description: "Hold a table, room or slot for a customer.", group: "orders", module: "appointments", requires: ["orders"] }),
  def({ key: "delivery", label: "Delivery", description: "Deliver to customers and track each delivery.", group: "orders", module: "orders" }),
  def({ key: "pickup", label: "Pickup", description: "Let customers collect their order.", group: "orders", module: "orders" }),
  def({ key: "order_status", label: "Order status", description: "See where every order is.", group: "orders", module: "orders", requires: ["orders"] }),
  def({ key: "fulfilment", label: "Fulfilment", description: "Mark orders as packed, dispatched or served.", group: "orders", module: "orders", requires: ["order_status"] }),
  def({ key: "partial_fulfilment", label: "Partial fulfilment", description: "Send part of an order now and the rest later.", group: "orders", module: "orders", requires: ["fulfilment"] }),
  def({ key: "cancellation", label: "Cancellations", description: "Cancel an order and put stock back.", group: "orders", module: "orders", requires: ["orders"] }),
  def({ key: "channel_attribution", label: "Channel tracking", description: "See which channel each sale came from.", group: "orders", module: "reports", requires: ["orders"] }),
];

/** ── Reporting (§8, §35) ────────────────────────────────────────────────────── */
const REPORTING: CapabilityDefinition[] = [
  def({ key: "daily_sales", label: "Daily sales", description: "What you sold today.", group: "reporting", module: "reports" }),
  def({ key: "weekly_sales", label: "Weekly sales", description: "What you sold this week.", group: "reporting", module: "reports" }),
  def({ key: "monthly_sales", label: "Monthly sales", description: "What you sold this month.", group: "reporting", module: "reports" }),
  def({ key: "payment_breakdown", label: "Payment breakdown", description: "Cash, M-Pesa, card and credit side by side.", group: "reporting", module: "reports" }),
  def({ key: "outstanding_credit", label: "Outstanding credit", description: "Everyone who owes you money, oldest first.", group: "reporting", module: "reports", requires: ["customer_credit"] }),
  def({ key: "supplier_debt", label: "Supplier debt", description: "Everyone you owe, oldest first.", group: "reporting", module: "reports", requires: ["supplier_credit"] }),
  def({ key: "expenses_report", label: "Expenses report", description: "Where the money went.", group: "reporting", module: "reports", requires: ["expenses"] }),
  def({ key: "inventory_value", label: "Inventory value", description: "What your stock is worth.", group: "reporting", module: "reports", requires: ["inventory_valuation"] }),
  def({ key: "best_sellers", label: "Best sellers", description: "Your most popular items.", group: "reporting", module: "reports" }),
  def({ key: "slow_movers", label: "Slow movers", description: "Items that are not selling.", group: "reporting", module: "reports", requires: ["stock_levels"] }),
  def({ key: "customer_activity", label: "Customer activity", description: "Who is buying and how often.", group: "reporting", module: "reports", requires: ["customer_profiles"] }),
  def({ key: "profitability", label: "Profitability", description: "Sales less cost of goods and expenses.", group: "reporting", module: "reports", requires: ["financial_summaries"] }),
];

/**
 * ── Industry capabilities (§18) ───────────────────────────────────────────────
 * Offered by the business type, never by an `if` statement in a screen.
 */
const INDUSTRY: CapabilityDefinition[] = [
  // Restaurant / café / bar / bakery
  def({ key: "menu", label: "Menu", description: "Your menu with prices and categories.", group: "industry", module: "menu", industryOnly: true, requires: ["product_sales"] }),
  def({ key: "ingredients", label: "Ingredients", description: "Track ingredients as stock.", group: "industry", module: "inventory", industryOnly: true, requires: ["stock_levels"] }),
  def({ key: "recipes", label: "Recipes", description: "Link a dish to the ingredients it uses.", group: "industry", module: "menu", industryOnly: true, requires: ["ingredients"] }),
  def({ key: "kitchen_orders", label: "Kitchen orders", description: "Send orders to the kitchen and see their status.", group: "industry", module: "orders", industryOnly: true, requires: ["orders"] }),
  def({ key: "tables", label: "Tables", description: "Dine-in tables with their status.", group: "industry", module: "orders", industryOnly: true, requires: ["orders"] }),
  def({ key: "modifiers", label: "Modifiers & extras", description: "No onions, extra cheese, side of chips.", group: "industry", module: "sell", industryOnly: true, requires: ["product_sales"] }),
  def({ key: "wastage", label: "Wastage", description: "Record spoiled or wasted stock.", group: "industry", module: "inventory", industryOnly: true, requires: ["stock_levels"] }),
  // Salon / barber / spa
  def({ key: "appointments", label: "Appointments", description: "Book customers into a calendar.", group: "industry", module: "appointments", industryOnly: true, requires: ["service_sales"] }),
  def({ key: "stylists", label: "Stylists & barbers", description: "Assign work to a specific person.", group: "industry", module: "appointments", industryOnly: true, requires: ["employee_profiles"] }),
  def({ key: "service_packages", label: "Packages", description: "Bundle services into a package price.", group: "industry", module: "products", industryOnly: true, requires: ["service_sales"] }),
  // Garage / auto
  def({ key: "vehicles", label: "Vehicles", description: "Keep each customer's vehicles and registration numbers.", group: "industry", module: "customers", industryOnly: true, requires: ["customer_profiles"] }),
  def({ key: "job_cards", label: "Job cards", description: "A card per job from inspection to collection.", group: "industry", module: "jobs", industryOnly: true, requires: ["service_sales"] }),
  def({ key: "labour", label: "Labour", description: "Charge for labour separately from parts.", group: "industry", module: "sell", industryOnly: true, requires: ["service_sales"] }),
  def({ key: "estimates", label: "Estimates", description: "Quote a job before starting it.", group: "industry", module: "jobs", industryOnly: true, requires: ["quotation"] }),
  def({ key: "technicians", label: "Technicians", description: "Assign a job to a technician.", group: "industry", module: "jobs", industryOnly: true, requires: ["employee_profiles"] }),
  def({ key: "parts_consumption", label: "Parts used", description: "Record which spare parts a job used.", group: "industry", module: "jobs", industryOnly: true, requires: ["stock_levels"] }),
  // Farm / agribusiness
  def({ key: "produce", label: "Produce", description: "What you grow and sell.", group: "industry", module: "produce", industryOnly: true, requires: ["product_sales"] }),
  def({ key: "harvests", label: "Harvests", description: "Record each harvest and its quantity.", group: "industry", module: "produce", industryOnly: true }),
  def({ key: "production_batches", label: "Production batches", description: "Group output into batches.", group: "industry", module: "produce", industryOnly: true }),
  def({ key: "seasonal_records", label: "Seasonal records", description: "Compare one season with another.", group: "industry", module: "reports", industryOnly: true }),
  def({ key: "buyers", label: "Buyers", description: "Keep records of the buyers you sell to.", group: "industry", module: "customers", industryOnly: true, requires: ["customer_profiles"] }),
  // Wholesale / distribution
  def({ key: "bulk_pricing", label: "Bulk pricing", description: "Price breaks by quantity.", group: "industry", module: "products", industryOnly: true, requires: ["wholesale_pricing"] }),
  def({ key: "customer_tiers", label: "Customer tiers", description: "Different prices for different tiers of customer.", group: "industry", module: "customers", industryOnly: true, requires: ["customer_pricing"] }),
  def({ key: "minimum_quantities", label: "Minimum quantities", description: "Enforce a minimum order quantity.", group: "industry", module: "sell", industryOnly: true }),
  def({ key: "sales_reps", label: "Sales representatives", description: "Attribute sales to a rep on the road.", group: "industry", module: "staff", industryOnly: true, requires: ["sales_attribution"] }),
  def({ key: "routes", label: "Delivery routes", description: "Plan deliveries by route.", group: "industry", module: "orders", industryOnly: true, requires: ["delivery"] }),
  def({ key: "warehouses", label: "Warehouses", description: "Track stock across warehouses.", group: "industry", module: "branches", industryOnly: true, requires: ["multi_location"] }),
  // Manufacturing
  def({ key: "raw_materials", label: "Raw materials", description: "Stock that goes into production.", group: "industry", module: "inventory", industryOnly: true, requires: ["stock_levels"] }),
  def({ key: "bill_of_materials", label: "Recipes / bill of materials", description: "What goes into each finished product.", group: "industry", module: "inventory", industryOnly: true, requires: ["manufacturing"] }),
  def({ key: "work_orders", label: "Work orders", description: "Schedule and track a production run.", group: "industry", module: "jobs", industryOnly: true, requires: ["manufacturing"] }),
  def({ key: "production_costs", label: "Production costs", description: "What each batch cost to make.", group: "industry", module: "reports", industryOnly: true, requires: ["manufacturing"] }),
  def({ key: "finished_goods", label: "Finished goods", description: "Stock that came out of production.", group: "industry", module: "inventory", industryOnly: true, requires: ["manufacturing"] }),
  // Boutique / clothing
  def({ key: "sizes_colours", label: "Sizes & colours", description: "Sell the same item in different sizes and colours.", group: "industry", module: "products", industryOnly: true, requires: ["variants"] }),
  // Professional services
  def({ key: "clients", label: "Clients", description: "Keep records of your clients.", group: "industry", module: "customers", industryOnly: true, requires: ["customer_profiles"] }),
  def({ key: "retainers", label: "Retainers", description: "Track a monthly retainer and what it covers.", group: "industry", module: "projects", industryOnly: true, requires: ["projects"] }),
  def({ key: "time_tracking", label: "Time tracking", description: "Record hours worked on a project.", group: "industry", module: "projects", industryOnly: true, requires: ["projects"] }),
  def({ key: "recurring_billing", label: "Recurring billing", description: "Bill the same amount on a schedule.", group: "industry", module: "orders", industryOnly: true, requires: ["subscriptions"] }),
  // Real estate
  def({ key: "properties", label: "Properties", description: "The properties and units you manage.", group: "industry", module: "products", industryOnly: true }),
  def({ key: "tenants", label: "Tenants", description: "Who occupies each unit.", group: "industry", module: "customers", industryOnly: true, requires: ["customer_profiles"] }),
  def({ key: "landlords", label: "Landlords", description: "Who owns each property.", group: "industry", module: "suppliers", industryOnly: true, requires: ["suppliers"] }),
  def({ key: "rent", label: "Rent", description: "Collect and track rent.", group: "industry", module: "credit", industryOnly: true, requires: ["customer_accounts"] }),
  // Education
  def({ key: "students", label: "Students", description: "Keep records of your students.", group: "industry", module: "customers", industryOnly: true, requires: ["customer_profiles"] }),
  def({ key: "courses", label: "Courses & classes", description: "What you teach and when.", group: "industry", module: "products", industryOnly: true, requires: ["service_sales"] }),
  def({ key: "fees", label: "Fees", description: "Fee structures and balances.", group: "industry", module: "credit", industryOnly: true, requires: ["customer_accounts"] }),
  def({ key: "payment_plans", label: "Payment plans", description: "Let people pay fees in instalments.", group: "industry", module: "credit", industryOnly: true, requires: ["partial_payments"] }),
  def({ key: "instructors", label: "Instructors", description: "Who teaches each class.", group: "industry", module: "staff", industryOnly: true, requires: ["employee_profiles"] }),
  // Events / catering
  def({ key: "events", label: "Events", description: "An event per client with its own budget.", group: "industry", module: "projects", industryOnly: true, requires: ["projects"] }),
  def({ key: "event_packages", label: "Event packages", description: "Package prices for common events.", group: "industry", module: "products", industryOnly: true }),
  def({ key: "payment_schedules", label: "Payment schedules", description: "Deposit now, balance before the event.", group: "industry", module: "credit", industryOnly: true, requires: ["deposits"] }),
  // Laundry
  def({ key: "garments", label: "Garments & items", description: "Count what a customer dropped off.", group: "industry", module: "orders", industryOnly: true, requires: ["orders"] }),
  def({ key: "service_types", label: "Service types", description: "Wash, dry-clean, press, iron.", group: "industry", module: "products", industryOnly: true, requires: ["service_sales"] }),
  // Printing / custom orders
  def({ key: "artwork", label: "Artwork & references", description: "Keep the file or reference for a job.", group: "industry", module: "jobs", industryOnly: true, requires: ["custom_orders"] }),
  def({ key: "production_status", label: "Production status", description: "See where each job is in production.", group: "industry", module: "jobs", industryOnly: true, requires: ["orders"] }),
];

export const CAPABILITY_LIBRARY: CapabilityDefinition[] = [
  ...SALES, ...CUSTOMERS, ...INVENTORY, ...PROCUREMENT,
  ...FINANCE, ...STAFF, ...ORDERS, ...REPORTING, ...INDUSTRY,
];

export const CAPABILITY_GROUPS: { key: CapabilityGroup; label: string; blurb: string }[] = [
  { key: "sales", label: "Selling", blurb: "How you take money from a customer." },
  { key: "customers", label: "Customers", blurb: "Who buys from you." },
  { key: "inventory", label: "Stock", blurb: "What you keep." },
  { key: "procurement", label: "Suppliers", blurb: "Who you buy from." },
  { key: "finance", label: "Money", blurb: "Payments, expenses and balances." },
  { key: "staff", label: "Staff", blurb: "Who works with you." },
  { key: "orders", label: "Orders", blurb: "Work that moves through stages." },
  { key: "reporting", label: "Reports", blurb: "What the numbers say." },
  { key: "industry", label: "Your trade", blurb: "Things only your kind of business needs." },
];

const BY_KEY = new Map(CAPABILITY_LIBRARY.map((capability) => [capability.key, capability]));

export function getCapability(key: CapabilityKey): CapabilityDefinition | undefined {
  return BY_KEY.get(key);
}

export function isCapabilityKey(key: unknown): key is CapabilityKey {
  return typeof key === "string" && BY_KEY.has(key);
}

export function capabilityLabel(key: CapabilityKey): string {
  return BY_KEY.get(key)?.label ?? String(key);
}

export function capabilitiesByGroup(group: CapabilityGroup): CapabilityDefinition[] {
  return CAPABILITY_LIBRARY.filter((capability) => capability.group === group);
}

/**
 * Expand a capability set through its implications and drop anything whose requirements are
 * unmet. Deterministic and idempotent, so the same answers always produce the same POS (§20).
 */
export function normalizeCapabilities(keys: Iterable<CapabilityKey>): CapabilityKey[] {
  const enabled = new Set<CapabilityKey>();
  const queue: CapabilityKey[] = [];
  for (const key of keys) {
    if (!isCapabilityKey(key) || enabled.has(key)) continue;
    enabled.add(key);
    queue.push(key);
  }
  // Implications cascade (customer_credit ⇒ customer_accounts ⇒ customer_profiles ⇒ …).
  while (queue.length) {
    const current = queue.shift() as CapabilityKey;
    for (const implied of BY_KEY.get(current)?.implies ?? []) {
      if (!enabled.has(implied) && isCapabilityKey(implied)) {
        enabled.add(implied);
        queue.push(implied);
      }
    }
  }
  // Prune capabilities that lost their prerequisites after editing (§22, §49).
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...enabled]) {
      const requires = BY_KEY.get(key)?.requires ?? [];
      if (requires.some((requirement) => !enabled.has(requirement))) {
        enabled.delete(key);
        changed = true;
      }
    }
  }
  return [...enabled];
}

export function hasCapability(config: { capabilities: CapabilityKey[] } | null | undefined, key: CapabilityKey): boolean {
  return Boolean(config?.capabilities?.includes(key));
}

/** Every capability the configuration switches on that a screen can be built from (§8). */
export function deriveCapabilities(config: PosConfiguration): CapabilityKey[] {
  const keys = new Set<CapabilityKey>(config.capabilities ?? []);
  return normalizeCapabilities(keys);
}

/** Capabilities an owner may add or remove in edit mode — industry ones stay grouped (§22). */
export function editableCapabilities(config: PosConfiguration): CapabilityDefinition[] {
  const enabled = new Set(config.capabilities);
  return CAPABILITY_LIBRARY.filter((capability) => enabled.has(capability.key) || !capability.industryOnly || isIndustryOffered(config, capability.key));
}

/** An industry capability is offered only when the business type put it on the table (§18). */
export function isIndustryOffered(config: PosConfiguration, key: CapabilityKey): boolean {
  const capability = getCapability(key);
  if (!capability?.industryOnly) return true;
  return (config.industry?.modules ?? []).includes(key);
}

/** Modules a configuration needs, in a stable order, for navigation generation (§24). */
export function modulesForCapabilities(capabilities: CapabilityKey[]): PosModuleKey[] {
  const modules = new Set<PosModuleKey>();
  for (const key of capabilities) {
    // Named `moduleKey`: `module` is reserved by the Next.js lint rules (and by CommonJS).
    const moduleKey = getCapability(key)?.module;
    if (moduleKey) modules.add(moduleKey);
  }
  return [...modules];
}
