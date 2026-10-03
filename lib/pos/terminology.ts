/**
 * Business-specific terminology (§24, §46)
 *
 * The underlying entity never changes shape — only the word on the screen does. A garage
 * says "Vehicle Owners", a restaurant says "Guests", a salon says "Clients", and every one
 * of them reads and writes the same PosCustomer table.
 */

import type { PosConfiguration, TerminologyEntityKey } from "./types";

export const GENERIC_TERMINOLOGY: Record<TerminologyEntityKey, string> = {
  customer: "Customer",
  customers: "Customers",
  product: "Product",
  products: "Products",
  service: "Service",
  services: "Services",
  sale: "Sale",
  sales: "Sales",
  order: "Order",
  orders: "Orders",
  invoice: "Invoice",
  quote: "Quotation",
  supplier: "Supplier",
  suppliers: "Suppliers",
  staff: "Staff",
  expense: "Expense",
  expenses: "Expenses",
  stock: "Stock",
  inventory: "Inventory",
  branch: "Branch",
  branches: "Branches",
};

/** Words each trade uses by default (§18, §46). Owners can still override any of them. */
export const TERMINOLOGY_PRESETS: Record<string, Partial<Record<TerminologyEntityKey, string>>> = {
  restaurant: { customer: "Guest", customers: "Guests", product: "Dish", products: "Menu", order: "Order", orders: "Orders", sale: "Bill", sales: "Bills", stock: "Ingredients", inventory: "Ingredients" },
  cafe: { customer: "Guest", customers: "Guests", product: "Item", products: "Menu", sale: "Bill", sales: "Bills", stock: "Ingredients", inventory: "Ingredients" },
  bar: { customer: "Guest", customers: "Guests", products: "Drinks list", product: "Drink", sale: "Bill", sales: "Bills" },
  bakery: { product: "Item", products: "Bakes", customer: "Customer", customers: "Customers" },
  hotel: { customer: "Guest", customers: "Guests", product: "Room / service", products: "Rooms & services", order: "Reservation", orders: "Reservations" },
  salon: { customer: "Client", customers: "Clients", service: "Treatment", services: "Services", order: "Appointment", orders: "Appointments", staff: "Stylist", sale: "Bill", sales: "Bills" },
  barber: { customer: "Client", customers: "Clients", service: "Cut", services: "Services", order: "Appointment", orders: "Appointments", staff: "Barber" },
  spa: { customer: "Client", customers: "Clients", service: "Treatment", services: "Treatments", order: "Booking", orders: "Bookings" },
  laundry: { customer: "Client", customers: "Clients", order: "Load", orders: "Loads", product: "Service", products: "Services" },
  garage: { customer: "Vehicle owner", customers: "Vehicle owners", order: "Job", orders: "Jobs", service: "Labour", services: "Services", product: "Part", products: "Spare parts", quote: "Estimate" },
  auto_repair: { customer: "Vehicle owner", customers: "Vehicle owners", order: "Job", orders: "Jobs", product: "Part", products: "Spare parts", quote: "Estimate" },
  spare_parts: { product: "Part", products: "Spare parts", customer: "Customer", customers: "Customers" },
  car_wash: { customer: "Vehicle owner", customers: "Vehicle owners", order: "Job", orders: "Jobs", service: "Wash", services: "Washes" },
  farm: { product: "Produce", products: "Produce", customer: "Buyer", customers: "Buyers", supplier: "Buyer / supplier", stock: "Produce stock", inventory: "Produce", order: "Sale batch", orders: "Batches" },
  agribusiness: { product: "Produce", products: "Produce", customer: "Buyer", customers: "Buyers", inventory: "Produce" },
  hardware: { product: "Item", products: "Stock items", customer: "Customer", customers: "Customers", quote: "Quotation" },
  building_materials: { product: "Material", products: "Materials", customer: "Contractor", customers: "Contractors" },
  wholesale: { customer: "Stockist", customers: "Stockists", sale: "Invoice", sales: "Invoices", order: "Order", orders: "Orders" },
  boutique: { product: "Item", products: "Collections", customer: "Client", customers: "Clients" },
  clothing: { product: "Item", products: "Clothing", customer: "Client", customers: "Clients" },
  shoes: { product: "Pair", products: "Shoes", customer: "Client", customers: "Clients" },
  manufacturing: { product: "Finished product", products: "Finished goods", order: "Work order", orders: "Work orders", stock: "Raw material", inventory: "Materials & goods" },
  workshop: { order: "Job", orders: "Jobs", product: "Item", products: "Items" },
  professional_services: { customer: "Client", customers: "Clients", order: "Project", orders: "Projects", sale: "Invoice", sales: "Invoices", service: "Service", services: "Services" },
  consultancy: { customer: "Client", customers: "Clients", order: "Engagement", orders: "Engagements", sale: "Invoice", sales: "Invoices" },
  agency: { customer: "Client", customers: "Clients", order: "Project", orders: "Projects", sale: "Invoice", sales: "Invoices" },
  real_estate: { customer: "Tenant", customers: "Tenants", supplier: "Landlord", suppliers: "Landlords", product: "Unit", products: "Properties", sale: "Rent receipt", sales: "Rent receipts", order: "Tenancy", orders: "Tenancies" },
  education: { customer: "Student", customers: "Students", product: "Course", products: "Courses", service: "Class", services: "Classes", sale: "Fee payment", sales: "Fee payments", staff: "Instructor", order: "Enrolment", orders: "Enrolments" },
  training: { customer: "Student", customers: "Students", product: "Course", products: "Courses", sale: "Fee payment", sales: "Fee payments" },
  events: { customer: "Client", customers: "Clients", order: "Event", orders: "Events", sale: "Invoice", sales: "Invoices", quote: "Proposal" },
  catering: { customer: "Client", customers: "Clients", order: "Event", orders: "Events", product: "Menu item", products: "Menu", stock: "Ingredients" },
  printing: { customer: "Client", customers: "Clients", order: "Job", orders: "Jobs", quote: "Quotation", product: "Item", products: "Products" },
  photography: { customer: "Client", customers: "Clients", order: "Shoot", orders: "Shoots", service: "Package", services: "Packages" },
  clinic: { customer: "Patient", customers: "Patients", order: "Visit", orders: "Visits", service: "Service", services: "Services", sale: "Bill", sales: "Bills" },
  dental: { customer: "Patient", customers: "Patients", order: "Appointment", orders: "Appointments", sale: "Bill", sales: "Bills" },
  veterinary: { customer: "Pet owner", customers: "Pet owners", order: "Visit", orders: "Visits", sale: "Bill", sales: "Bills" },
  pharmacy: { customer: "Patient", customers: "Patients", product: "Medicine", products: "Medicines" },
  transport: { customer: "Passenger", customers: "Passengers", order: "Trip", orders: "Trips", product: "Route", products: "Routes" },
  courier: { customer: "Sender", customers: "Senders", order: "Shipment", orders: "Shipments", product: "Service", products: "Services" },
  online_seller: { customer: "Buyer", customers: "Buyers", order: "Order", orders: "Orders" },
  subscription_business: { customer: "Member", customers: "Members", sale: "Billing", sales: "Billings", order: "Subscription", orders: "Subscriptions" },
  membership_business: { customer: "Member", customers: "Members", order: "Membership", orders: "Memberships" },
  construction: { customer: "Client", customers: "Clients", order: "Project", orders: "Projects", product: "Material", products: "Materials", quote: "Bill of quantities" },
  cleaning_service: { customer: "Client", customers: "Clients", order: "Job", orders: "Jobs", service: "Service", services: "Services" },
  tailor: { customer: "Client", customers: "Clients", order: "Job", orders: "Jobs", service: "Garment", services: "Garments" },
  fashion_designer: { customer: "Client", customers: "Clients", order: "Commission", orders: "Commissions" },
  florist: { product: "Arrangement", products: "Bouquets", order: "Order", orders: "Orders" },
  furniture: { product: "Item", products: "Furniture", customer: "Client", customers: "Clients" },
};

export type Terminology = Record<TerminologyEntityKey, string>;

/**
 * Resolve the words this business uses: generic defaults → trade preset → owner override.
 * Owner overrides always win, so "Call them whatever you like" is literally true (§46).
 */
export function resolveTerminology(config: Pick<PosConfiguration, "business" | "terminology"> | null | undefined): Terminology {
  const preset = TERMINOLOGY_PRESETS[config?.business?.typeKey ?? ""] ?? {};
  const resolved = { ...GENERIC_TERMINOLOGY, ...preset } as Terminology;
  for (const [key, value] of Object.entries(config?.terminology ?? {})) {
    if (typeof value !== "string") continue;
    const clean = value.trim().slice(0, 40);
    if (!clean) continue;
    if (!(key in GENERIC_TERMINOLOGY)) continue;
    resolved[key as TerminologyEntityKey] = clean;
  }
  return resolved;
}

export function term(terminology: Terminology, key: TerminologyEntityKey): string {
  return terminology[key] ?? GENERIC_TERMINOLOGY[key];
}

/** Sentence-case a label for buttons and headings ("Customer" → "customer"). */
export function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** The three most visible words, used in the "configured for you" summary (§21, §65). */
export function terminologyHighlights(terminology: Terminology): { key: TerminologyEntityKey; label: string }[] {
  return (["customers", "products", "orders"] as TerminologyEntityKey[])
    .filter((key) => terminology[key] !== GENERIC_TERMINOLOGY[key])
    .map((key) => ({ key, label: terminology[key] }));
}

/** Owner-facing list of the words that can be renamed (§22 — modify business terminology). */
export const TERMINOLOGY_FIELDS: { key: TerminologyEntityKey; prompt: string }[] = [
  { key: "customers", prompt: "What do you call your customers?" },
  { key: "products", prompt: "What do you call the things you sell?" },
  { key: "orders", prompt: "What do you call an order?" },
  { key: "services", prompt: "What do you call your services?" },
  { key: "staff", prompt: "What do you call your staff?" },
  { key: "suppliers", prompt: "What do you call the people you buy from?" },
  { key: "stock", prompt: "What do you call your stock?" },
  { key: "sale", prompt: "What do you call a completed sale?" },
];
