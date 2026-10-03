/**
 * Forms are configured, not coded per trade (§24, §38, §52)
 *
 * The engine decides which fields a screen asks for. A restaurant's dish form has no " reorder
 * level" if the kitchen does not track stock; a garage's customer form asks for a vehicle; a
 * wholesale form asks for a credit limit. One generic renderer draws whatever this returns, so
 * adding a trade never means adding a form.
 *
 * Nothing here mentions a business type: every rule reads a capability or a configuration flag.
 */

import { hasCapability } from "./capabilities";
import { resolveTerminology, type Terminology } from "./terminology";
import { unitOptions } from "./units";
import { EXPENSE_CATEGORY_OPTIONS } from "./questionnaire";
import { BUILT_IN_ROLES, resolveRoles } from "./permissions";
import { MOVEMENT_REASONS } from "./inventory";
import type { PosConfiguration } from "./types";

export type FieldKind = "text" | "textarea" | "number" | "money" | "phone" | "email" | "select" | "multiselect" | "toggle" | "date" | "datetime";

export type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  options?: { id: string; label: string }[];
  defaultValue?: string | number | boolean;
  /** Grouping label shown above a set of fields ("Pricing", "Credit", …). */
  group?: string;
  /** Shown in the list view rather than only in the form. */
  column?: boolean;
};

export type FormSpec = {
  entity: string;
  word: string;
  plural: string;
  fields: FieldSpec[];
  groups: string[];
};

function lower(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

// ── Products and services (§13) ───────────────────────────────────────────────

export function productFields(config: PosConfiguration): FieldSpec[] {
  const words: Terminology = resolveTerminology(config);
  const fields: FieldSpec[] = [
    { key: "name", label: words.product, kind: "text", required: true, placeholder: `e.g. ${words.product}`, column: true },
    {
      key: "kind",
      label: "Is it something you keep, or something you do?",
      kind: "select",
      defaultValue: "PRODUCT",
      column: true,
      options: [
        ...(config.sales.products ? [{ id: "PRODUCT", label: words.product }] : []),
        ...(config.sales.services ? [{ id: "SERVICE", label: words.service }] : []),
      ],
    },
    { key: "priceKES", label: "Price (KES)", kind: "money", required: true, defaultValue: 0, column: true, group: "Pricing" },
  ];

  if (config.sales.wholesalePricing) {
    fields.push({ key: "wholesalePriceKES", label: "Wholesale price (KES)", kind: "money", hint: "For bulk buyers.", group: "Pricing" });
  }
  if (hasCapability(config, "profitability") || config.inventory.valuation) {
    fields.push({ key: "costKES", label: "What it costs you (KES)", kind: "money", hint: "Used for profit and stock value.", group: "Pricing" });
  }
  if (config.sales.tax.enabled) {
    fields.push({ key: "taxable", label: `Charge ${config.sales.tax.label || "tax"} on this?`, kind: "toggle", defaultValue: false, group: "Pricing" });
  }

  if (config.inventory.enabled) {
    fields.push({
      key: "unitKey",
      label: "How do you measure it?",
      kind: "select",
      defaultValue: "piece",
      options: unitOptions(config).map((unit) => ({ id: unit.key, label: unit.label })),
      column: true,
      group: words.stock,
    });
    if (config.sales.services) {
      fields.push({ key: "trackInventory", label: "Do you keep stock of it?", kind: "toggle", defaultValue: true, group: words.stock });
    }
    if (config.inventory.reorderLevels || config.inventory.lowStockAlerts) {
      fields.push({ key: "reorderLevel", label: "Warn me when it drops to", kind: "number", defaultValue: 0, group: words.stock });
    }
    if (config.inventory.barcode) {
      fields.push({ key: "barcode", label: "Barcode", kind: "text", placeholder: "Scan or type", hint: "Used at the till with a scanner.", group: words.stock });
    }
    if (hasCapability(config, "skus")) {
      fields.push({ key: "sku", label: "Your code", kind: "text", group: words.stock });
    }
    if (config.inventory.variants) {
      fields.push({
        key: "variantOptions",
        label: "Choices (sizes, colours)",
        kind: "textarea",
        placeholder: "Size: S, M, L\nColour: Red, Blue",
        hint: "One line per choice, comma-separated.",
        group: words.stock,
      });
    }
  }

  if (config.sales.services && hasCapability(config, "appointments")) {
    fields.push({ key: "durationMinutes", label: "How long does it take? (minutes)", kind: "number", group: words.service });
  }
  fields.push({ key: "description", label: "Anything staff should know?", kind: "textarea", group: "Notes" });
  fields.push({ key: "isActive", label: "On sale", kind: "toggle", defaultValue: true, group: "Notes" });

  return fields;
}

// ── Customers (§14, §46) ──────────────────────────────────────────────────────

export function customerFields(config: PosConfiguration): FieldSpec[] {
  const words = resolveTerminology(config);
  const fields: FieldSpec[] = [{ key: "name", label: words.customer, kind: "text", required: true, column: true }];
  if (config.customers.fields.phone) {
    fields.push({ key: "phone", label: "Phone", kind: "phone", placeholder: "07XX XXX XXX", column: true });
  }
  if (config.customers.fields.email) fields.push({ key: "email", label: "Email", kind: "email" });
  if (config.customers.fields.location) fields.push({ key: "location", label: "Where are they?", kind: "text" });
  if (config.customers.fields.customerNumber) {
    fields.push({ key: "customerNumber", label: `${words.customer} number`, kind: "text", hint: "Your own reference." });
  }
  if (config.customers.segments) {
    fields.push({
      key: "segment",
      label: "Group",
      kind: "select",
      options: [
        { id: "", label: "No group" },
        { id: "regular", label: "Regular" },
        { id: "vip", label: "VIP" },
        { id: "wholesale", label: "Wholesale" },
        { id: "new", label: "New" },
      ],
    });
  }
  if (config.credit.enabled) {
    fields.push({ key: "creditEnabled", label: `Can they pay later?`, kind: "toggle", defaultValue: false, group: "Credit" });
    fields.push({
      key: "creditLimitKES",
      label: "Their limit (KES)",
      kind: "money",
      defaultValue: config.credit.limitKES || 0,
      hint: config.credit.limitKES ? `Your default is KES ${config.credit.limitKES.toLocaleString("en-KE")}.` : "Zero means no limit set.",
      group: "Credit",
      column: true,
    });
  }
  if (config.customers.fields.notes) fields.push({ key: "notes", label: "Notes", kind: "textarea", group: "Notes" });
  return fields;
}

/** The extra thing a customer owns or occupies — a vehicle, a unit, a pet (§18). */
export function assetFields(config: PosConfiguration): FieldSpec[] {
  const words = resolveTerminology(config);
  const label = hasCapability(config, "vehicles")
    ? "Vehicle"
    : hasCapability(config, "rent")
      ? "Unit"
      : hasCapability(config, "produce")
        ? "Plot"
        : `${words.customer} item`;
  return [
    { key: "label", label: "What kind of thing is it?", kind: "text", defaultValue: label },
    { key: "name", label, kind: "text", required: true, placeholder: label === "Vehicle" ? "Toyota Probox" : label },
    {
      key: "identifier",
      label: label === "Vehicle" ? "Registration number" : label === "Unit" ? "Unit number" : "Reference",
      kind: "text",
      placeholder: label === "Vehicle" ? "KDA 123X" : "",
      column: true,
    },
  ];
}

// ── Suppliers (§12) ───────────────────────────────────────────────────────────

export function supplierFields(config: PosConfiguration): FieldSpec[] {
  const words = resolveTerminology(config);
  const fields: FieldSpec[] = [{ key: "name", label: words.supplier, kind: "text", required: true, column: true }];
  fields.push({ key: "phone", label: "Phone", kind: "phone", column: true });
  fields.push({ key: "email", label: "Email", kind: "email" });
  fields.push({ key: "location", label: "Where are they?", kind: "text" });
  if (config.suppliers.credit) {
    fields.push({ key: "creditEnabled", label: "Do they give you credit?", kind: "toggle", group: "Credit" });
    fields.push({
      key: "termsDays",
      label: "How many days do you have to pay?",
      kind: "number",
      defaultValue: config.suppliers.termsDays || 30,
      group: "Credit",
      column: true,
    });
  }
  fields.push({ key: "notes", label: "Notes", kind: "textarea", group: "Notes" });
  return fields;
}

// ── Staff (§15, §36) ──────────────────────────────────────────────────────────

export function staffFields(config: PosConfiguration): FieldSpec[] {
  const words = resolveTerminology(config);
  const roles = resolveRoles(config).filter((role) => role.key !== "OWNER" && role.key !== "ADMIN");
  const options = (roles.length ? roles : BUILT_IN_ROLES).map((role) => ({ id: role.key, label: role.name }));
  const fields: FieldSpec[] = [
    { key: "name", label: words.staff === "Staff" ? "Their name" : words.staff, kind: "text", required: true, column: true },
    { key: "phone", label: "Phone", kind: "phone", column: true },
    { key: "roleKey", label: "What can they do?", kind: "select", defaultValue: options[0]?.id ?? "CASHIER", options, column: true },
  ];
  if (config.staff.commissions) {
    fields.push({ key: "commissionPercent", label: "Commission (%)", kind: "number", defaultValue: 0, hint: "Of what they sell." });
  }
  if (config.branches.enabled) {
    fields.push({ key: "branchId", label: `Which ${lower(words.branch)}?`, kind: "text", hint: "Leave blank for all locations." });
  }
  fields.push({ key: "isActive", label: "Currently working", kind: "toggle", defaultValue: true });
  return fields;
}

// ── Expenses (§17) ────────────────────────────────────────────────────────────

export function expenseFields(config: PosConfiguration): FieldSpec[] {
  const configured = config.expenses.categories ?? [];
  const labels = new Map(EXPENSE_CATEGORY_OPTIONS.map((option) => [option.id, option.label]));
  const options = (configured.length ? configured : EXPENSE_CATEGORY_OPTIONS.map((option) => option.id)).map((key) => ({
    id: key,
    label: labels.get(key) ?? key.replace(/_/g, " "),
  }));
  return [
    { key: "categoryKey", label: "What was it for?", kind: "select", required: true, options, column: true },
    { key: "label", label: "Short description", kind: "text", placeholder: "October rent", column: true },
    { key: "amountKES", label: "Amount (KES)", kind: "money", required: true, column: true },
    { key: "method", label: "How did you pay?", kind: "select", defaultValue: "cash", options: paymentOptions(config) },
    { key: "reference", label: "Reference", kind: "text", hint: "Receipt or transaction number." },
    { key: "occurredAt", label: "When?", kind: "date" },
    { key: "notes", label: "Notes", kind: "textarea" },
  ];
}

// ── Purchases (§12) ───────────────────────────────────────────────────────────

export function purchaseFields(config: PosConfiguration): FieldSpec[] {
  const words = resolveTerminology(config);
  const fields: FieldSpec[] = [];
  if (config.suppliers.enabled) {
    fields.push({ key: "supplierId", label: words.supplier, kind: "select", options: [] });
  }
  fields.push({ key: "reference", label: "Your reference", kind: "text", placeholder: "Auto if left blank" });
  if (config.suppliers.purchaseOrders) {
    fields.push({ key: "expectedAt", label: "When should it arrive?", kind: "date" });
    fields.push({ key: "receiveNow", label: "It has already arrived", kind: "toggle", defaultValue: false });
  }
  fields.push({ key: "notes", label: "Notes", kind: "textarea" });
  return fields;
}

// ── Orders (§28, §29) ─────────────────────────────────────────────────────────

export function orderFields(config: PosConfiguration): FieldSpec[] {
  const words = resolveTerminology(config);
  const fields: FieldSpec[] = [];
  if (config.customers.enabled) {
    fields.push({ key: "customerName", label: words.customer, kind: "text", column: true });
    fields.push({ key: "customerPhone", label: "Their phone", kind: "phone" });
  }
  const channels = config.orders.channels ?? [];
  if (channels.length > 1) {
    fields.push({
      key: "channel",
      label: "How did it come in?",
      kind: "select",
      defaultValue: channels[0],
      column: true,
      options: channels.map((channel) => ({ id: channel, label: channelLabel(channel) })),
    });
  }
  if (config.delivery.enabled || config.delivery.pickup) {
    const options = [
      ...(config.delivery.pickup ? [{ id: "PICKUP", label: "Collecting" }] : []),
      ...(config.delivery.enabled ? [{ id: "DELIVERY", label: "Delivering" }] : []),
      { id: "DINE_IN", label: "Here" },
    ];
    fields.push({ key: "fulfilment", label: "How do they get it?", kind: "select", options, column: true });
  }
  if (config.delivery.enabled) {
    fields.push({ key: "address", label: "Where to?", kind: "textarea" });
    fields.push({ key: "feeKES", label: "Delivery fee (KES)", kind: "money", defaultValue: config.delivery.feeKES });
  }
  if (hasCapability(config, "appointments") || hasCapability(config, "job_cards") || hasCapability(config, "projects")) {
    fields.push({ key: "expectedAt", label: "When is it due?", kind: "datetime", column: true });
  }
  if (config.sales.deposits) {
    fields.push({ key: "depositKES", label: "Deposit taken (KES)", kind: "money", defaultValue: 0 });
  }
  fields.push({ key: "notes", label: "Anything else?", kind: "textarea", placeholder: "Notes for the team" });
  return fields;
}

export function orderItemFields(config: PosConfiguration): FieldSpec[] {
  const words = resolveTerminology(config);
  const fields: FieldSpec[] = [{ key: "name", label: words.product, kind: "select", required: true, options: [] }];
  fields.push({ key: "quantity", label: "How many?", kind: "number", defaultValue: 1, required: true });
  if (hasCapability(config, "recipes") || hasCapability(config, "custom_orders")) {
    fields.push({ key: "modifiers", label: "Anything special?", kind: "textarea", placeholder: "No onions, extra sauce" });
  }
  return fields;
}

// ── Stock changes (§33) ───────────────────────────────────────────────────────

export function adjustmentFields(config: PosConfiguration): FieldSpec[] {
  return [
    { key: "productId", label: "Which item?", kind: "select", required: true, options: [] },
    {
      key: "reason",
      label: "Why is it changing?",
      kind: "select",
      required: true,
      options: MOVEMENT_REASONS.filter((reason) => ["ADJUSTMENT", "DAMAGE", "EXPIRY", "WASTAGE", "COUNT", "OPENING"].includes(reason.key)).map(
        (reason) => ({ id: reason.key, label: reason.label }),
      ),
    },
    { key: "quantity", label: "How much?", kind: "number", required: true, defaultValue: 1 },
    { key: "note", label: "Short reason", kind: "text", hint: "Damage, expiry and corrections need a note." },
  ];
}

export function transferFields(config: PosConfiguration): FieldSpec[] {
  const words = resolveTerminology(config);
  return [
    { key: "productId", label: "Which item?", kind: "select", required: true, options: [] },
    { key: "quantity", label: "How much?", kind: "number", required: true, defaultValue: 1 },
    { key: "fromBranchId", label: `From which ${lower(words.branch)}?`, kind: "select", options: [] },
    { key: "toBranchId", label: `To which ${lower(words.branch)}?`, kind: "select", required: true, options: [] },
    { key: "note", label: "Note", kind: "text" },
  ];
}

// ── Payment methods (§31) ─────────────────────────────────────────────────────

export function paymentOptions(config: PosConfiguration): { id: string; label: string }[] {
  const options: { id: string; label: string }[] = [];
  if (config.payments.cash) options.push({ id: "cash", label: "Cash" });
  if (config.payments.mpesa) options.push({ id: "mpesa", label: "M-Pesa" });
  if (config.payments.card) options.push({ id: "card", label: "Card" });
  if (config.payments.bank) options.push({ id: "bank", label: "Bank transfer" });
  for (const label of config.payments.otherLabels ?? []) options.push({ id: label, label });
  if (!options.length) options.push({ id: "cash", label: "Cash" });
  return options;
}

export function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    walk_in: "Walk-in",
    phone: "Phone call",
    whatsapp: "WhatsApp",
    business_page: "JATA page",
    online: "Website",
    staff: "Staff",
    delivery: "Delivery",
    other: "Other",
  };
  return labels[channel] ?? channel.replace(/_/g, " ");
}

/** The complete form spec for one entity, ready for the generic renderer. */
export function formSpec(config: PosConfiguration, entity: "product" | "customer" | "supplier" | "staff" | "expense" | "order"): FormSpec {
  const words = resolveTerminology(config);
  switch (entity) {
    case "product":
      return { entity, word: words.product, plural: words.products, fields: productFields(config), groups: groupsOf(productFields(config)) };
    case "customer":
      return { entity, word: words.customer, plural: words.customers, fields: customerFields(config), groups: groupsOf(customerFields(config)) };
    case "supplier":
      return { entity, word: words.supplier, plural: words.suppliers, fields: supplierFields(config), groups: groupsOf(supplierFields(config)) };
    case "staff":
      return { entity, word: words.staff, plural: words.staff, fields: staffFields(config), groups: groupsOf(staffFields(config)) };
    case "expense":
      return { entity, word: words.expense, plural: words.expenses, fields: expenseFields(config), groups: groupsOf(expenseFields(config)) };
    case "order":
    default:
      return { entity, word: words.order, plural: words.orders, fields: orderFields(config), groups: groupsOf(orderFields(config)) };
  }
}

function groupsOf(fields: FieldSpec[]): string[] {
  const seen: string[] = [];
  for (const field of fields) {
    const group = field.group ?? "";
    if (group && !seen.includes(group)) seen.push(group);
  }
  return seen;
}

/** The values a form starts with when editing an existing record. */
export function fieldValues(fields: FieldSpec[], record: Record<string, unknown> | null): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const raw = record ? record[field.key] : undefined;
    if (raw === undefined || raw === null) {
      values[field.key] = field.defaultValue ?? (field.kind === "toggle" ? false : field.kind === "number" || field.kind === "money" ? 0 : "");
      continue;
    }
    if (typeof raw === "boolean") values[field.key] = raw;
    else if (typeof raw === "number") values[field.key] = raw;
    else if (raw instanceof Date) values[field.key] = raw.toISOString().slice(0, 10);
    else values[field.key] = String(raw);
  }
  return values;
}
