/**
 * MJENGO OS navigation.
 *
 * Deliberately its own list rather than a re-export of the ERP modules: MJENGO is a separate
 * product with its own permissions and its own routes, and every entry here has a page under
 * app/dashboard/mjengo/[businessId]/ (asserted by tests/unit/mjengo-workspace-routes.test.ts).
 * Entries are workspace *sections*, not an entitlement: access is decided once, by
 * requireMjengoAccess, and a section never grants anything by being linked.
 */

export const MJENGO_MODULES = [
  { key: "overview", label: "Business dashboard", path: "", glyph: "◈", permission: "WORKSPACE_READ", group: "ops", description: "Today's sales, stock alerts, and tasks." },
  { key: "sales", label: "Sales & orders", path: "/sales", glyph: "☰", permission: "MANAGE_STORE", group: "ops", description: "POS-linked orders and walk-in sales." },
  { key: "inventory", label: "Inventory", path: "/inventory", glyph: "▤", permission: "VIEW_INVENTORY", group: "ops", description: "Products, stock, movements." },
  { key: "procurement", label: "Procurement", path: "/procurement", glyph: "⇄", permission: "VIEW_INVENTORY", group: "ops", description: "Suppliers, POs, goods received." },
  { key: "customers", label: "Customers", path: "/customers", glyph: "☺", permission: "VIEW_CUSTOMERS", group: "reach", description: "CRM, debt, credit." },
  { key: "accounting", label: "Accounting", path: "/accounting", glyph: "▥", permission: "VIEW_FINANCE", group: "money", description: "Journals, trial balance, P&L." },
  { key: "workforce", label: "Workforce", path: "/workforce", glyph: "☖", permission: "VIEW_CUSTOMERS", group: "manage", description: "Staff, attendance, payroll." },
  { key: "reports", label: "Reports", path: "/reports", glyph: "◫", permission: "VIEW_FINANCE", group: "money", description: "Operational + financial reports." },
  { key: "settings", label: "Plan & settings", path: "/settings", glyph: "⚙", permission: "VIEW_FINANCE", group: "manage", description: "Stored plan terms, subscription storage, branding." },
] as const;

/**
 * Every path here is backed by a real page under app/dashboard/mjengo/[businessId]/. The list is
 * the single source of truth for the workspace nav, so a link can never point at a route that does
 * not exist: tests/unit/mjengo-workspace-routes.test.ts asserts each `path` resolves to a page.tsx.
 */
export const MJENGO_SUB_ROUTES = [
  "",
  "/sales",
  "/inventory",
  "/procurement",
  "/customers",
  "/accounting",
  "/workforce",
  "/reports",
  "/settings",
] as const;

export function mjengoPath(businessId: string, subPath = "") {
  return `/dashboard/mjengo/${encodeURIComponent(businessId)}${subPath}`;
}
