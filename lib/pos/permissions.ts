/**
 * Roles and permissions (§36, §52)
 *
 * Permissions operate at capability/action level, and the check happens on the server for
 * every tenant-owned operation. High-risk actions (refunds, price edits, credit approval,
 * configuration changes) are never allowed by default.
 */

import { CATALOGUE_CAPABILITIES, ORDER_BOARD_CAPABILITIES, STOCK_CAPABILITIES, hasCapability } from "./capabilities";
import type { CapabilityKey, PosConfiguration, PosRoleConfig } from "./types";

export const PERMISSIONS = [
  // Sales
  { key: "VIEW_SALES", label: "See sales", risk: "low" },
  { key: "CREATE_SALE", label: "Record a sale", risk: "low" },
  { key: "EDIT_SALE", label: "Edit an open sale", risk: "medium" },
  { key: "VOID_SALE", label: "Void a sale", risk: "high" },
  { key: "REFUND_SALE", label: "Refund a sale", risk: "high" },
  { key: "EDIT_PRICE", label: "Change a price", risk: "high" },
  { key: "APPLY_DISCOUNT", label: "Give a discount", risk: "medium" },
  { key: "VIEW_RECEIPTS", label: "See receipts", risk: "low" },
  // Payments — the JATA Payment Wallet (§61, §62, §112 of the payment specification)
  { key: "VIEW_PAYMENTS", label: "See payments", risk: "low" },
  { key: "MANAGE_PAYMENT_DESTINATIONS", label: "Change where you get paid", risk: "high" },
  { key: "REFUND_PAYMENT", label: "Refund a payment", risk: "high" },
  { key: "MANAGE_RECONCILIATION", label: "Reconcile payments", risk: "medium" },
  // Customers & credit
  { key: "VIEW_CUSTOMERS", label: "See customers", risk: "low" },
  { key: "MANAGE_CUSTOMERS", label: "Add and edit customers", risk: "low" },
  { key: "VIEW_CREDIT", label: "See credit balances", risk: "medium" },
  { key: "APPROVE_CREDIT", label: "Approve credit", risk: "high" },
  { key: "RECORD_REPAYMENT", label: "Record a repayment", risk: "medium" },
  // Inventory
  { key: "VIEW_INVENTORY", label: "See stock", risk: "low" },
  { key: "EDIT_INVENTORY", label: "Add and edit products", risk: "medium" },
  { key: "ADJUST_STOCK", label: "Adjust stock", risk: "high" },
  { key: "TRANSFER_STOCK", label: "Move stock between locations", risk: "medium" },
  // Procurement
  { key: "VIEW_SUPPLIERS", label: "See suppliers", risk: "low" },
  { key: "MANAGE_SUPPLIERS", label: "Add and edit suppliers", risk: "medium" },
  { key: "CREATE_PURCHASE", label: "Record a purchase", risk: "medium" },
  { key: "APPROVE_PURCHASE", label: "Approve a purchase order", risk: "high" },
  { key: "RECORD_SUPPLIER_PAYMENT", label: "Pay a supplier", risk: "high" },
  // Finance
  { key: "VIEW_EXPENSES", label: "See expenses", risk: "medium" },
  { key: "CREATE_EXPENSE", label: "Record an expense", risk: "medium" },
  { key: "VIEW_REPORTS", label: "See reports", risk: "medium" },
  { key: "CLOSE_DAY", label: "Close the day", risk: "medium" },
  // Orders
  { key: "VIEW_ORDERS", label: "See orders", risk: "low" },
  { key: "MANAGE_ORDERS", label: "Move orders through stages", risk: "low" },
  { key: "CANCEL_ORDER", label: "Cancel an order", risk: "medium" },
  // Administration
  { key: "VIEW_STAFF", label: "See staff", risk: "medium" },
  { key: "MANAGE_USERS", label: "Add staff and change permissions", risk: "high" },
  { key: "VIEW_AUDIT", label: "See the audit log", risk: "high" },
  { key: "EDIT_CONFIGURATION", label: "Change how the POS is configured", risk: "high" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export type PermissionRisk = "low" | "medium" | "high";

const PERMISSION_KEYS = new Set<string>(PERMISSIONS.map((permission) => permission.key));

export function isPermissionKey(key: unknown): key is PermissionKey {
  return typeof key === "string" && PERMISSION_KEYS.has(key);
}

export function permissionLabel(key: string): string {
  return PERMISSIONS.find((permission) => permission.key === key)?.label ?? key;
}

export function highRiskPermissions(): PermissionKey[] {
  return PERMISSIONS.filter((permission) => permission.risk === "high").map((permission) => permission.key);
}

/** Every permission — owners and admins hold the full set. */
export const ALL_PERMISSIONS: PermissionKey[] = PERMISSIONS.map((permission) => permission.key);

// A cashier takes money and sees that it arrived (§61); they can never change where it goes,
// refund it, or touch reconciliation.
const CASHIER_DEFAULTS: PermissionKey[] = [
  "VIEW_SALES", "CREATE_SALE", "VIEW_RECEIPTS", "VIEW_CUSTOMERS", "MANAGE_CUSTOMERS",
  "VIEW_INVENTORY", "VIEW_ORDERS", "MANAGE_ORDERS", "VIEW_PAYMENTS",
];

const SALESPERSON_DEFAULTS: PermissionKey[] = [
  ...CASHIER_DEFAULTS, "APPLY_DISCOUNT", "RECORD_REPAYMENT", "VIEW_CREDIT",
];

// A manager may refund and reconcile, but changing where the business gets paid stays with the
// owner (it is the single highest-risk change in the POS, §62), and so does adding staff.
const MANAGER_DEFAULTS: PermissionKey[] = [
  ...ALL_PERMISSIONS.filter((key) =>
    !["MANAGE_USERS", "EDIT_CONFIGURATION", "APPROVE_CREDIT", "VOID_SALE", "MANAGE_PAYMENT_DESTINATIONS"].includes(key),
  ),
];

const INVENTORY_DEFAULTS: PermissionKey[] = [
  "VIEW_SALES", "VIEW_INVENTORY", "EDIT_INVENTORY", "ADJUST_STOCK", "TRANSFER_STOCK",
  "VIEW_SUPPLIERS", "CREATE_PURCHASE", "VIEW_REPORTS",
];

const ACCOUNTANT_DEFAULTS: PermissionKey[] = [
  "VIEW_SALES", "VIEW_CUSTOMERS", "VIEW_CREDIT", "RECORD_REPAYMENT", "VIEW_INVENTORY",
  "VIEW_SUPPLIERS", "RECORD_SUPPLIER_PAYMENT", "VIEW_EXPENSES", "CREATE_EXPENSE",
  "VIEW_REPORTS", "CLOSE_DAY", "VIEW_AUDIT",
  "VIEW_PAYMENTS", "MANAGE_RECONCILIATION",
];

const TECHNICIAN_DEFAULTS: PermissionKey[] = [
  "VIEW_ORDERS", "MANAGE_ORDERS", "VIEW_CUSTOMERS", "VIEW_INVENTORY", "VIEW_SALES",
];

const WAITER_DEFAULTS: PermissionKey[] = ["VIEW_ORDERS", "MANAGE_ORDERS", "VIEW_CUSTOMERS", "CREATE_SALE", "VIEW_SALES"];

const STYLIST_DEFAULTS: PermissionKey[] = ["VIEW_ORDERS", "MANAGE_ORDERS", "VIEW_CUSTOMERS", "CREATE_SALE", "VIEW_SALES"];

const DELIVERY_DEFAULTS: PermissionKey[] = ["VIEW_ORDERS", "MANAGE_ORDERS", "VIEW_CUSTOMERS"];

/** Built-in roles (§36). Custom roles are stored per tenant and behave identically. */
export const BUILT_IN_ROLES: { key: string; name: string; blurb: string; permissions: PermissionKey[] }[] = [
  { key: "OWNER", name: "Owner", blurb: "Full control of the business.", permissions: [...ALL_PERMISSIONS] },
  { key: "ADMIN", name: "Admin", blurb: "Runs the business day to day.", permissions: [...ALL_PERMISSIONS] },
  { key: "MANAGER", name: "Manager", blurb: "Everything except adding staff and changing the setup.", permissions: MANAGER_DEFAULTS },
  { key: "CASHIER", name: "Cashier", blurb: "Takes payments and gives receipts.", permissions: CASHIER_DEFAULTS },
  { key: "SALESPERSON", name: "Salesperson", blurb: "Sells, discounts within limits and collects repayments.", permissions: SALESPERSON_DEFAULTS },
  { key: "INVENTORY", name: "Inventory staff", blurb: "Looks after stock and purchases.", permissions: INVENTORY_DEFAULTS },
  { key: "ACCOUNTANT", name: "Accountant", blurb: "Money in, money out and the reports.", permissions: ACCOUNTANT_DEFAULTS },
  { key: "TECHNICIAN", name: "Technician", blurb: "Works on jobs and updates their status.", permissions: TECHNICIAN_DEFAULTS },
  { key: "WAITER", name: "Waiter", blurb: "Takes orders to the kitchen and to the table.", permissions: WAITER_DEFAULTS },
  { key: "STYLIST", name: "Stylist / barber", blurb: "Sees their appointments and bills them.", permissions: STYLIST_DEFAULTS },
  { key: "DELIVERY", name: "Delivery staff", blurb: "Sees what to deliver and where.", permissions: DELIVERY_DEFAULTS },
];

const ROLE_BY_KEY = new Map(BUILT_IN_ROLES.map((role) => [role.key, role]));

export function getBuiltInRole(key: string | null | undefined) {
  return ROLE_BY_KEY.get(key ?? "");
}

export function isBuiltInRoleKey(key: unknown): key is string {
  return typeof key === "string" && ROLE_BY_KEY.has(key);
}

/** Roles offered for a configuration: built-ins that fit, plus whatever the owner added. */
export function resolveRoles(config: PosConfiguration | null | undefined): PosRoleConfig[] {
  const chosen = config?.staff?.roles ?? [];
  const roles: PosRoleConfig[] = [];
  const always = ["OWNER", "ADMIN"];
  for (const key of [...always, ...chosen]) {
    const builtIn = getBuiltInRole(key);
    if (!builtIn) continue;
    if (roles.some((role) => role.key === builtIn.key)) continue;
    roles.push({ key: builtIn.key, name: builtIn.name, permissions: [...builtIn.permissions], builtIn: true });
  }
  if (!config?.staff?.enabled) {
    // A solo owner still needs a role for themselves; nobody else gets one (§47 baseline).
    return roles.filter((role) => role.key === "OWNER" || role.key === "ADMIN");
  }
  for (const custom of config?.roles ?? []) {
    if (!custom?.key || typeof custom.key !== "string") continue;
    if (ROLE_BY_KEY.has(custom.key)) continue;
    roles.push({
      key: custom.key.slice(0, 40),
      name: String(custom.name ?? custom.key).slice(0, 60),
      permissions: (custom.permissions ?? []).filter(isPermissionKey),
      builtIn: false,
    });
  }
  return roles;
}

/** Which permissions a role holds, restricted to what the business actually configured. */
export function effectivePermissions(config: PosConfiguration, roleKey: string): PermissionKey[] {
  // Fail closed (§36, §75): a role this configuration does not define gets *nothing*. The business
  // owner and a platform admin are resolved to OWNER/ADMIN before this point, so they never arrive
  // here — an unrecognized key means a stale staff record or a forged role, and neither may act.
  const role = resolveRoles(config).find((candidate) => candidate.key === roleKey);
  const granted = new Set<string>(role?.permissions ?? []);
  // A permission for a module the business does not have is meaningless (§24, §52):
  // a service-only consultancy has no stock to adjust, so nobody holds ADJUST_STOCK.
  //
  // A gate is satisfied by *any* capability that makes the module real, because one screen serves
  // many configurations (§52). The Products screen is a till's catalogue, a hardware store's stock
  // room and a salon's services list; the order board is called "Orders", "Appointments", "Jobs" or
  // "Projects" depending on the trade. Gating those on one capability key left the screen in the
  // navigation while the API refused it — a dead end an owner cannot understand (§47, §60).
  const capabilityGates: Partial<Record<PermissionKey, CapabilityKey | CapabilityKey[]>> = {
    ADJUST_STOCK: "stock_adjustments",
    TRANSFER_STOCK: "stock_transfers",
    VIEW_INVENTORY: [...CATALOGUE_CAPABILITIES, ...STOCK_CAPABILITIES],
    EDIT_INVENTORY: CATALOGUE_CAPABILITIES,
    VIEW_CREDIT: "customer_credit",
    APPROVE_CREDIT: "customer_credit",
    RECORD_REPAYMENT: "customer_credit",
    VIEW_SUPPLIERS: "suppliers",
    MANAGE_SUPPLIERS: "suppliers",
    CREATE_PURCHASE: "purchases",
    APPROVE_PURCHASE: "purchase_orders",
    RECORD_SUPPLIER_PAYMENT: "supplier_payments",
    VIEW_EXPENSES: "expenses",
    CREATE_EXPENSE: "expenses",
    APPLY_DISCOUNT: "discounts",
    REFUND_SALE: "refunds",
    VIEW_ORDERS: ORDER_BOARD_CAPABILITIES,
    MANAGE_ORDERS: ORDER_BOARD_CAPABILITIES,
    CANCEL_ORDER: "cancellation",
    VIEW_STAFF: "employee_profiles",
    MANAGE_USERS: "employee_profiles",
  };
  return ALL_PERMISSIONS.filter((key) => {
    if (!granted.has(key)) return false;
    const gate = capabilityGates[key];
    if (!gate) return true;
    return Array.isArray(gate) ? gate.some((capability) => hasCapability(config, capability)) : hasCapability(config, gate);
  });
}

export function can(config: PosConfiguration, roleKey: string, permission: PermissionKey): boolean {
  return effectivePermissions(config, roleKey).includes(permission);
}

/**
 * Flat result shape: this project compiles with `strictNullChecks` off, where a discriminated
 * union on a boolean does not narrow, so the reason travels as an optional field.
 */
export type PermissionCheck = { allowed: boolean; reason?: string };

/**
 * Server-side authorization decision for one action. Plain-language reasons are safe to show
 * the person who was refused (§38) without leaking anything about another tenant.
 */
export function checkPermission(config: PosConfiguration, roleKey: string, permission: PermissionKey): PermissionCheck {
  const held = effectivePermissions(config, roleKey);
  if (held.includes(permission)) return { allowed: true };
  const known = getBuiltInRole(roleKey);
  const roleName = known?.name ?? roleKey ?? "this role";
  return {
    allowed: false,
    reason: `${roleName} cannot ${permissionLabel(permission).toLowerCase()}. Ask your business owner to change permissions.`,
  };
}

/** Permissions a screen should ask for, keyed by action — keeps routes honest and readable. */
export const ACTION_PERMISSIONS = {
  listSales: "VIEW_SALES",
  createSale: "CREATE_SALE",
  refundSale: "REFUND_SALE",
  voidSale: "VOID_SALE",
  editPrice: "EDIT_PRICE",
  applyDiscount: "APPLY_DISCOUNT",
  listCustomers: "VIEW_CUSTOMERS",
  manageCustomer: "MANAGE_CUSTOMERS",
  approveCredit: "APPROVE_CREDIT",
  recordRepayment: "RECORD_REPAYMENT",
  listInventory: "VIEW_INVENTORY",
  editInventory: "EDIT_INVENTORY",
  adjustStock: "ADJUST_STOCK",
  transferStock: "TRANSFER_STOCK",
  listSuppliers: "VIEW_SUPPLIERS",
  manageSupplier: "MANAGE_SUPPLIERS",
  createPurchase: "CREATE_PURCHASE",
  recordSupplierPayment: "RECORD_SUPPLIER_PAYMENT",
  listExpenses: "VIEW_EXPENSES",
  createExpense: "CREATE_EXPENSE",
  viewReports: "VIEW_REPORTS",
  closeDay: "CLOSE_DAY",
  listStaff: "VIEW_STAFF",
  manageStaff: "MANAGE_USERS",
  viewAudit: "VIEW_AUDIT",
  editConfiguration: "EDIT_CONFIGURATION",
  viewPayments: "VIEW_PAYMENTS",
  requestPayment: "CREATE_SALE",
  managePaymentDestinations: "MANAGE_PAYMENT_DESTINATIONS",
  refundPayment: "REFUND_PAYMENT",
  reconcilePayments: "MANAGE_RECONCILIATION",
} as const satisfies Record<string, PermissionKey>;
