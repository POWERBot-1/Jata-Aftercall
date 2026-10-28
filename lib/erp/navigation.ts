/**
 * POS / ERP - PRO navigation
 *
 * The full product map, filtered by role and industry pack. Modules that are not working in this
 * release are marked PLANNED and kept out of the primary navigation, so the interface never
 * promises a screen that does not do anything. Existing Business POS screens are reused for
 * products, stock, suppliers and staff rather than rebuilt.
 */

import type { ErpPermission, ErpRole } from "./access";
import { hasErpPermission } from "./access";
import { industryPack, packSupportsModule } from "./industryPacks";

export type ModuleStatus = "READY" | "PARTIAL" | "PLANNED";

export type ErpModule = {
  key: string;
  label: string;
  shortLabel: string;
  glyph: string;
  /** Path relative to the business base path, or an absolute path for a reused POS screen. */
  path: string;
  /** True when the link opens the existing Business POS shell. */
  reusesPos?: boolean;
  permission: ErpPermission;
  status: ModuleStatus;
  group: "operate" | "money" | "reach" | "compliance" | "manage";
  description: string;
  plannedNote?: string;
};

export const ERP_MODULES: ErpModule[] = [
  { key: "home", label: "Home", shortLabel: "Home", glyph: "⌂", path: "", permission: "WORKSPACE_READ", status: "READY", group: "operate", description: "What needs your attention today." },
  { key: "setup", label: "Guided setup", shortLabel: "Setup", glyph: "✓", path: "/onboarding", permission: "WORKSPACE_READ", status: "READY", group: "operate", description: "Twelve steps to a working workspace, derived from what you have actually done." },
  { key: "sell", label: "POS and checkout", shortLabel: "Sell", glyph: "▣", path: "/dashboard/pos/{id}/sell", reusesPos: true, permission: "MANAGE_INVOICES", status: "READY", group: "operate", description: "The existing Business POS till — fast, barcode-first checkout." },
  { key: "tasks", label: "Tasks and work", shortLabel: "Tasks", glyph: "✓", path: "/tasks", permission: "WORKSPACE_READ", status: "READY", group: "operate", description: "One board for everything somebody owns: automation follow-ups, renewals and manual work." },
  { key: "notifications", label: "Notifications", shortLabel: "Inbox", glyph: "✉", path: "/notifications", permission: "WORKSPACE_READ", status: "READY", group: "operate", description: "Work assigned to you, overdue items, orders and campaign results — in-app only." },
  { key: "orders", label: "Orders and fulfilment", shortLabel: "Orders", glyph: "☰", path: "/orders", permission: "MANAGE_STORE", status: "READY", group: "operate", description: "Online orders from your ordering link, and their fulfilment." },
  { key: "products", label: "Products and services", shortLabel: "Products", glyph: "◧", path: "/dashboard/pos/{id}/products", reusesPos: true, permission: "VIEW_INVENTORY", status: "READY", group: "operate", description: "Shared with the Business POS: one catalogue, one price list." },
  { key: "inventory", label: "Inventory and warehouses", shortLabel: "Stock", glyph: "▤", path: "/dashboard/pos/{id}/inventory", reusesPos: true, permission: "VIEW_INVENTORY", status: "READY", group: "operate", description: "Stock levels, movements and adjustments from the POS." },
  { key: "suppliers", label: "Suppliers and procurement", shortLabel: "Suppliers", glyph: "⇄", path: "/dashboard/pos/{id}/suppliers", reusesPos: true, permission: "VIEW_INVENTORY", status: "READY", group: "operate", description: "Supplier records and purchases, shared with the POS." },
  { key: "branches", label: "Branches and locations", shortLabel: "Branches", glyph: "⌖", path: "/dashboard/pos/{id}/branches", reusesPos: true, permission: "VIEW_INVENTORY", status: "READY", group: "manage", description: "Branches and their stock, shared with the POS." },
  { key: "customers", label: "Customers and CRM", shortLabel: "Customers", glyph: "☺", path: "/customers", permission: "VIEW_CUSTOMERS", status: "READY", group: "reach", description: "Contacts, consent, tags and import." },
  { key: "invoices", label: "Invoices and receipts", shortLabel: "Invoices", glyph: "▦", path: "/invoices", permission: "VIEW_INVOICES", status: "READY", group: "money", description: "Draft, issue and settle invoices; receipts and credit notes." },
  { key: "payments", label: "Payments and receivables", shortLabel: "Payments", glyph: "◈", path: "/invoices#receipts", permission: "VIEW_INVOICES", status: "READY", group: "money", description: "Receipts, allocations and outstanding balances." },
  { key: "debt", label: "Debt and repayments", shortLabel: "Debt", glyph: "◔", path: "/invoices#ageing", permission: "VIEW_FINANCE", status: "READY", group: "money", description: "Ageing and overdue invoices that can feed a reminder campaign." },
  { key: "accounting", label: "Accounting", shortLabel: "Books", glyph: "▥", path: "/accounting", permission: "VIEW_FINANCE", status: "READY", group: "money", description: "Journals, trial balance, profit and loss, balance sheet." },
  { key: "expenses", label: "Expenses and cash", shortLabel: "Expenses", glyph: "▧", path: "/expenses", permission: "VIEW_FINANCE", status: "READY", group: "money", description: "Record spending with a category and a ledger post." },
  { key: "messaging", label: "Business messaging", shortLabel: "Messaging", glyph: "✉", path: "/messaging", permission: "VIEW_MESSAGING", status: "READY", group: "reach", description: "Campaigns, audiences, templates, costs and delivery results." },
  { key: "sender", label: "Sender Identity", shortLabel: "Sender ID", glyph: "✦", path: "/sender-identity", permission: "VIEW_MESSAGING", status: "READY", group: "reach", description: "Apply for a Sender ID and track the provider's decision." },
  { key: "automation", label: "Automation rules", shortLabel: "Automation", glyph: "⚙", path: "/automation", permission: "VIEW_AUTOMATION", status: "READY", group: "reach", description: "Triggers, conditions, approvals and run history." },
  { key: "reports", label: "Reports and analytics", shortLabel: "Reports", glyph: "◫", path: "/reports", permission: "VIEW_FINANCE", status: "READY", group: "money", description: "Financial and messaging reports from the ledger and provider records." },
  { key: "store", label: "Online store", shortLabel: "Store", glyph: "◉", path: "/store", permission: "VIEW_STORE", status: "READY", group: "reach", description: "Your public ordering link, catalogue visibility and orders." },
  { key: "compliance", label: "Tax and compliance", shortLabel: "Compliance", glyph: "⚖", path: "/compliance", permission: "VIEW_COMPLIANCE", status: "READY", group: "compliance", description: "Kenya Compliance Centre: tax profile, eTIMS readiness and sector notes." },
  { key: "settings", label: "Settings and plan", shortLabel: "Settings", glyph: "☷", path: "/settings", permission: "WORKSPACE_READ", status: "READY", group: "manage", description: "Plan, industry pack, team, feature flags and data export." },
  { key: "staff", label: "Staff and attendance", shortLabel: "Staff", glyph: "☖", path: "/dashboard/pos/{id}/staff", reusesPos: true, permission: "VIEW_CUSTOMERS", status: "READY", group: "manage", description: "Staff records and roles, shared with the POS." },
  { key: "audit", label: "Audit log", shortLabel: "Audit", glyph: "◎", path: "/settings#audit", permission: "VIEW_AUDIT", status: "READY", group: "manage", description: "Who changed what, when, and why." },
  // ── Planned modules: visible only as an honest roadmap, never as buttons that do nothing.
  { key: "marketing", label: "Marketing campaigns", shortLabel: "Marketing", glyph: "◇", path: "", permission: "VIEW_MESSAGING", status: "PLANNED", group: "reach", description: "Campaign analytics, link tracking and attributed revenue.", plannedNote: "Campaign delivery and costs are live in Messaging. Link-click attribution is not implemented yet." },
  { key: "manufacturing", label: "Manufacturing and production", shortLabel: "Production", glyph: "⬡", path: "", permission: "VIEW_INVENTORY", status: "PLANNED", group: "operate", description: "Bills of materials, production runs and yield.", plannedNote: "Scoped for the manufacturing pack. Not implemented." },
  { key: "projects", label: "Projects and service jobs", shortLabel: "Projects", glyph: "◌", path: "", permission: "VIEW_INVOICES", status: "PLANNED", group: "operate", description: "Project budgets, time and milestones.", plannedNote: "POS job cards exist; ERP project costing is not implemented." },
  { key: "logistics", label: "Logistics and delivery", shortLabel: "Delivery", glyph: "➤", path: "", permission: "VIEW_STORE", status: "PLANNED", group: "operate", description: "Dispatch, riders and proof of delivery.", plannedNote: "Store orders support delivery or pickup; courier dispatch is not implemented." },
  { key: "assets", label: "Assets and maintenance", shortLabel: "Assets", glyph: "▣", path: "", permission: "VIEW_INVENTORY", status: "PLANNED", group: "operate", description: "Fixed-asset register and maintenance schedules.", plannedNote: "Fixed-asset accounts exist; the register and depreciation runs are not implemented." },
  { key: "documents", label: "Documents and approvals", shortLabel: "Documents", glyph: "▤", path: "", permission: "VIEW_AUDIT", status: "PLANNED", group: "compliance", description: "Attachments, approval inbox and retention.", plannedNote: "KYC document metadata is modelled; the upload and approval inbox are not enabled." },
  { key: "integrations", label: "Integrations and hardware", shortLabel: "Integrations", glyph: "⌁", path: "", permission: "MANAGE_SETTINGS", status: "PLANNED", group: "manage", description: "Providers, printers, scanners and scales.", plannedNote: "Provider adapters and camera/keyboard-wedge scanning are ready. Thermal printer, scale and cash-drawer adapters are untested and not offered." },
];

export function moduleById(key: string): ErpModule | undefined {
  return ERP_MODULES.find((module) => module.key === key);
}

export function moduleHref(module: ErpModule, businessId: string): string {
  const base = `/dashboard/erp/${encodeURIComponent(businessId)}`;
  if (module.reusesPos) return module.path.replace("{id}", encodeURIComponent(businessId));
  if (!module.path) return base;
  return `${base}${module.path}`;
}

export type NavView = {
  primary: Array<ErpModule & { href: string; active?: boolean }>;
  groups: Array<{ key: string; label: string; items: Array<ErpModule & { href: string }> }>;
  bottom: Array<ErpModule & { href: string }>;
  planned: ErpModule[];
};

export function navigationFor(input: {
  businessId: string;
  role: ErpRole;
  packKey: string;
  activeKey?: string;
  /** Modules the deployment has switched off. */
  disabledKeys?: string[];
}): NavView {
  const pack = industryPack(input.packKey);
  const disabled = new Set(input.disabledKeys ?? []);
  const allowed = ERP_MODULES.filter(
    (module) =>
      module.status === "READY" &&
      !disabled.has(module.key) &&
      packSupportsModule(pack, module.key) &&
      hasErpPermission(input.role, module.permission),
  );

  const primaryKeys = ["home", "messaging", "customers", "invoices", "accounting", "store"];
  const primary = allowed
    .filter((module) => primaryKeys.includes(module.key))
    .sort((a, b) => primaryKeys.indexOf(a.key) - primaryKeys.indexOf(b.key))
    .map((module) => ({ ...module, href: moduleHref(module, input.businessId), active: module.key === input.activeKey }));

  const groupOrder: Array<{ key: string; label: string; modules: string[] }> = [
    { key: "operate", label: "Run the business", modules: ["setup", "sell", "orders", "products", "inventory", "suppliers", "branches", "staff"] },
    { key: "money", label: "Money", modules: ["invoices", "payments", "debt", "accounting", "expenses", "reports"] },
    { key: "reach", label: "Reach customers", modules: ["messaging", "sender", "customers", "store", "automation"] },
    { key: "compliance", label: "Compliance", modules: ["compliance", "audit"] },
  ];
  const groups = groupOrder.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.modules
      .map((key) => allowed.find((module) => module.key === key))
      .filter((module): module is ErpModule => Boolean(module))
      .map((module) => ({ ...module, href: moduleHref(module, input.businessId) })),
  })).filter((group) => group.items.length > 0);

  // The phone bar keeps five items so it stays thumb-reachable: setup is reachable from Home.
  const bottomKeys = ["home", "messaging", "invoices", "accounting", "settings"];
  const bottom = bottomKeys
    .map((key) => allowed.find((module) => module.key === key))
    .filter((module): module is ErpModule => Boolean(module))
    .map((module) => ({ ...module, href: moduleHref(module, input.businessId) }));

  const planned = ERP_MODULES.filter((module) => module.status === "PLANNED" && hasErpPermission(input.role, module.permission));
  return { primary, groups, bottom, planned };
}

/** Keyboard shortcuts advertised in the UI. They are handled by the shell's client helper. */
export const KEYBOARD_SHORTCUTS = [
  { keys: "g h", label: "Go home" },
  { keys: "g m", label: "Go to messaging" },
  { keys: "g i", label: "Go to invoices" },
  { keys: "g a", label: "Go to accounting" },
  { keys: "n c", label: "New campaign" },
  { keys: "/", label: "Focus search" },
  { keys: "?", label: "Show shortcuts" },
] as const;

/** Modules that actually work in this release, for status endpoints and the evidence report. */
export function listImplementedModules(): ErpModule[] {
  return ERP_MODULES.filter((module) => module.status === "READY");
}

export function listPlannedModules(): ErpModule[] {
  return ERP_MODULES.filter((module) => module.status === "PLANNED");
}
