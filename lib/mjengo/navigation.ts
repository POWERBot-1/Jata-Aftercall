import { ERP_MODULES, type ErpRole, moduleHref } from "../erp/navigation";

export const MJENGO_MODULES = [
  { key: "overview", label: "Business dashboard", path: "", glyph: "◈", permission: "WORKSPACE_READ", group: "ops", description: "Today's sales, stock alerts, and tasks." },
  { key: "sales", label: "Sales & orders", path: "/sales", glyph: "☰", permission: "MANAGE_STORE", group: "ops", description: "POS-linked orders and walk-in sales." },
  { key: "inventory", label: "Inventory", path: "/inventory", glyph: "▤", permission: "VIEW_INVENTORY", group: "ops", description: "Products, stock, movements." },
  { key: "procurement", label: "Procurement", path: "/procurement", glyph: "⇄", permission: "VIEW_INVENTORY", group: "ops", description: "Suppliers, POs, goods received." },
  { key: "customers", label: "Customers", path: "/customers", glyph: "☺", permission: "VIEW_CUSTOMERS", group: "reach", description: "CRM, debt, credit." },
  { key: "accounting", label: "Accounting", path: "/accounting", glyph: "▥", permission: "VIEW_FINANCE", group: "money", description: "Journals, trial balance, P&L." },
  { key: "workforce", label: "Workforce", path: "/workforce", glyph: "☖", permission: "VIEW_CUSTOMERS", group: "manage", description: "Staff, attendance, payroll." },
  { key: "reports", label: "Reports", path: "/reports", glyph: "◫", permission: "VIEW_FINANCE", group: "money", description: "Operational + financial reports." },
] as const;

export function mjengoPath(businessId: string, subPath = "") {
  return `/dashboard/mjengo/${encodeURIComponent(businessId)}${subPath}`;
}
