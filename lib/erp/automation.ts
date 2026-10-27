/**
 * Automation rules engine (§4.3)
 *
 * Rules are explicit: a trigger, conditions and a bounded list of actions. High-impact actions
 * (money, bulk messaging, irreversible state) are previewed and require human approval. Every run
 * is recorded with its idempotency key, so a repeated event cannot double-charge or double-send.
 * A per-business kill switch and a daily run cap stop a loop from becoming an incident.
 */

import { logErpAudit } from "./audit";

export type AutomationTrigger =
  | "LOW_STOCK"
  | "ORDER_RECEIVED"
  | "SALE_COMPLETED"
  | "PAYMENT_CONFIRMED"
  | "INVOICE_OVERDUE"
  | "EXPENSE_SUBMITTED"
  | "INTEGRATION_FAILED"
  | "DAILY_CLOSE_COMPLETED"
  | "BUDGET_THRESHOLD_EXCEEDED"
  | "EQUIPMENT_FAILURE";

export type AutomationActionType =
  | "NOTIFY"
  | "CREATE_TASK"
  | "SUGGEST_PURCHASE"
  | "ADD_TAG"
  | "SEND_TEMPLATE"
  | "PAUSE_CAMPAIGN"
  | "POST_JOURNAL";

export const AUTOMATION_TRIGGERS: Array<{ key: AutomationTrigger; label: string; description: string; example: string }> = [
  { key: "LOW_STOCK", label: "Stock is running low", description: "A product falls to or below its reorder level.", example: "Create a purchase suggestion and tell the manager." },
  { key: "ORDER_RECEIVED", label: "A store order arrives", description: "A customer places an order from your ordering link.", example: "Notify the POS panel and reserve stock." },
  { key: "SALE_COMPLETED", label: "A sale completes", description: "A sale is recorded and paid.", example: "Send a receipt and update inventory." },
  { key: "PAYMENT_CONFIRMED", label: "A payment is confirmed", description: "A verified provider or receipt settles an invoice.", example: "Allocate the payment and send a receipt." },
  { key: "INVOICE_OVERDUE", label: "An invoice becomes overdue", description: "An unpaid invoice passes its due date.", example: "Schedule a permitted reminder." },
  { key: "EXPENSE_SUBMITTED", label: "An expense is submitted", description: "A staff member submits an expense claim.", example: "Route it to the right approver." },
  { key: "INTEGRATION_FAILED", label: "An integration fails", description: "A provider call or callback fails repeatedly.", example: "Alert an administrator and create a task." },
  { key: "DAILY_CLOSE_COMPLETED", label: "The day is closed", description: "A daily close finishes.", example: "Generate the report and send it to authorised recipients." },
  { key: "BUDGET_THRESHOLD_EXCEEDED", label: "A budget threshold is reached", description: "Spending crosses a configured percentage.", example: "Alert the budget owner." },
  { key: "EQUIPMENT_FAILURE", label: "Equipment fails", description: "A device reports a failure.", example: "Create a service ticket." },
];

export const AUTOMATION_ACTIONS: Array<{ key: AutomationActionType; label: string; impact: "LOW" | "HIGH"; requiresApproval: boolean; implemented: boolean }> = [
  { key: "NOTIFY", label: "Notify a person", impact: "LOW", requiresApproval: false, implemented: true },
  { key: "CREATE_TASK", label: "Create a task", impact: "LOW", requiresApproval: false, implemented: true },
  { key: "SUGGEST_PURCHASE", label: "Suggest a purchase", impact: "LOW", requiresApproval: false, implemented: true },
  { key: "ADD_TAG", label: "Add a customer tag", impact: "LOW", requiresApproval: false, implemented: true },
  { key: "SEND_TEMPLATE", label: "Send a message (opt-in contacts only)", impact: "HIGH", requiresApproval: true, implemented: false },
  { key: "PAUSE_CAMPAIGN", label: "Pause a campaign", impact: "HIGH", requiresApproval: true, implemented: false },
  { key: "POST_JOURNAL", label: "Post a journal", impact: "HIGH", requiresApproval: true, implemented: false },
];

export type ConditionOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";

export type AutomationCondition = { field: string; operator: ConditionOperator; value: unknown };
export type AutomationAction = { type: AutomationActionType; params?: Record<string, unknown> };

export type AutomationRuleInput = {
  name: string;
  trigger: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  requiresApproval?: boolean;
  maxRunsPerDay?: number;
};

const ALLOWED_FIELDS = new Set([
  "productId",
  "productName",
  "quantity",
  "reorderLevel",
  "orderId",
  "orderTotalCents",
  "branchId",
  "customerId",
  "customerName",
  "invoiceId",
  "balanceCents",
  "daysOverdue",
  "amountCents",
  "category",
  "campaignId",
  "budgetPercent",
  "deviceId",
  "providerKey",
]);

/**
 * Validate a rule definition before it is saved. Unknown triggers, actions, fields and operators
 * are refused: an automation engine that silently ignores a typo is a liability.
 */
export function validateAutomationRule(input: AutomationRuleInput): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.name || input.name.trim().length < 3) errors.push("Give the rule a name.");
  if (!AUTOMATION_TRIGGERS.some((trigger) => trigger.key === input.trigger)) errors.push("Choose a trigger from the list.");
  if (!Array.isArray(input.actions) || input.actions.length === 0) errors.push("Add at least one action.");
  if (input.actions?.length > 5) errors.push("Keep a rule to five actions so it stays comprehensible.");

  for (const condition of input.conditions ?? []) {
    if (!ALLOWED_FIELDS.has(condition.field)) errors.push(`"${condition.field}" is not a field this trigger provides.`);
    if (!["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"].includes(condition.operator)) errors.push("That condition operator is not supported.");
  }

  for (const action of input.actions ?? []) {
    const definition = AUTOMATION_ACTIONS.find((entry) => entry.key === action.type);
    if (!definition) {
      errors.push(`"${action.type}" is not an available action.`);
      continue;
    }
    if (!definition.implemented) {
      errors.push(`"${definition.label}" is not available yet. It is listed as planned, not working.`);
    }
    if (definition.requiresApproval) warnings.push(`"${definition.label}" will ask for approval before it runs.`);
  }

  if (input.maxRunsPerDay !== undefined && (input.maxRunsPerDay < 1 || input.maxRunsPerDay > 1000)) {
    errors.push("Set a daily run cap between 1 and 1,000.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

function compare(actual: unknown, operator: ConditionOperator, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual === expected || String(actual) === String(expected);
    case "neq":
      return !(actual === expected || String(actual) === String(expected));
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "in":
      return Array.isArray(expected) && expected.map(String).includes(String(actual));
    default:
      return false;
  }
}

export function evaluateConditions(conditions: AutomationCondition[], event: Record<string, unknown>): { matched: boolean; details: Array<{ field: string; matched: boolean }> } {
  const details = conditions.map((condition) => ({
    field: condition.field,
    matched: compare(event[condition.field], condition.operator, condition.value),
  }));
  return { matched: details.every((detail) => detail.matched), details };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    const parsed = JSON.parse(value ?? "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function automationKillSwitch(configuration: { featureFlagsJson?: string | null } | null | undefined): boolean {
  return Boolean(parseJson<Record<string, boolean>>(configuration?.featureFlagsJson, {}).automationKillSwitch);
}

export type RunAutomationInput = {
  businessId: string;
  ruleId: string;
  event: Record<string, unknown>;
  /** Stable id for the triggering event; makes replay idempotent. */
  eventId: string;
  actorId?: string | null;
  actorName?: string | null;
  dryRun?: boolean;
  approved?: boolean;
  approverId?: string | null;
  now?: Date;
};

/**
 * Preview or execute a rule. `dryRun` is the default posture: it records what *would* happen and
 * writes nothing except the run. Execution still refuses high-impact actions without approval.
 */
export async function runAutomation(client: any, input: RunAutomationInput) {
  const now = input.now ?? new Date();
  // Preview is the default. A caller must pass `dryRun: false` explicitly to let a rule act,
  // so a forgotten flag cannot start sending messages on its own.
  const dryRun = input.dryRun !== false;
  const rule = await client.erpAutomationRule.findUnique({ where: { id: input.ruleId } });
  if (!rule || rule.businessId !== input.businessId) throw Object.assign(new Error("That automation rule was not found."), { status: 404 });

  const configuration = await client.erpConfiguration.findUnique({ where: { businessId: input.businessId } }).catch(() => null);
  if (automationKillSwitch(configuration)) {
    return { status: "SKIPPED", reason: "Automation is paused by the platform safety switch.", actions: [] as string[] };
  }

  const idempotencyKey = `rule:${rule.id}:event:${input.eventId}`;
  const existing = await client.erpAutomationRun.findUnique({
    where: { businessId_ruleId_idempotencyKey: { businessId: input.businessId, ruleId: rule.id, idempotencyKey } },
  }).catch(() => null);
  if (existing && existing.status !== "PREVIEW") {
    return { status: existing.status, reason: "This event was already processed for this rule.", actions: parseJson<string[]>(existing.actionsJson, []) };
  }

  if (!dryRun && String(rule.status).toUpperCase() !== "ACTIVE") {
    return { status: "SKIPPED", reason: "This rule is not active.", actions: [] };
  }
  if (!dryRun && Number(rule.runCountToday ?? 0) >= Number(rule.maxRunsPerDay ?? 50)) {
    return { status: "SKIPPED", reason: "This rule reached its daily run limit.", actions: [] };
  }

  const conditions = parseJson<AutomationCondition[]>(rule.conditionsJson, []);
  const evaluation = evaluateConditions(conditions, input.event);
  if (!evaluation.matched) {
    return { status: "SKIPPED", reason: "The conditions were not met.", actions: [] };
  }

  const actions = parseJson<AutomationAction[]>(rule.actionsJson, []);
  const highImpact = actions.some((action) => AUTOMATION_ACTIONS.find((entry) => entry.key === action.type)?.requiresApproval);
  const needsApproval = Boolean(rule.requiresApproval) && highImpact && !input.approved;

  if (dryRun || needsApproval) {
    const status = needsApproval ? "AWAITING_APPROVAL" : "PREVIEW";
    const run = existing ?? (await client.erpAutomationRun.create({
      data: {
        businessId: input.businessId,
        ruleId: rule.id,
        trigger: rule.trigger,
        eventJson: JSON.stringify(input.event),
        status,
        actionsJson: JSON.stringify(actions.map((action) => action.type)),
        resultJson: JSON.stringify({ evaluation, wouldRun: actions.map((action) => action.type) }),
        idempotencyKey,
        finishedAt: now,
      },
    }));
    return {
      status,
      reason: needsApproval
        ? "This rule includes an action that needs a person to approve it before anything happens."
        : "Preview only — nothing was changed.",
      actions: actions.map((action) => action.type),
      runId: run.id,
      evaluation,
    };
  }

  const executed: string[] = [];
  const results: Array<{ action: string; ok: boolean; detail: string }> = [];

  for (const action of actions) {
    const definition = AUTOMATION_ACTIONS.find((entry) => entry.key === action.type);
    if (!definition || !definition.implemented) {
      results.push({ action: action.type, ok: false, detail: "Not available in this release." });
      continue;
    }
    if (action.type === "NOTIFY" || action.type === "CREATE_TASK" || action.type === "SUGGEST_PURCHASE") {
      const title =
        action.type === "SUGGEST_PURCHASE"
          ? `Purchase suggestion: ${String(input.event.productName ?? "stock item")}`
          : action.type === "CREATE_TASK"
            ? `Task: ${String(action.params?.title ?? rule.name)}`
            : String(action.params?.title ?? rule.name);
      await client.erpNotification.create({
        data: {
          businessId: input.businessId,
          kind: action.type,
          title,
          body: String(action.params?.message ?? `Triggered by ${rule.name}.`),
          href: action.params?.href ? String(action.params.href) : null,
          audienceRole: String(action.params?.role ?? "OWNER"),
        },
      });
      executed.push(action.type);
      results.push({ action: action.type, ok: true, detail: title });
      continue;
    }
    if (action.type === "ADD_TAG") {
      const contactId = String(input.event.customerId ?? "");
      const tag = String(action.params?.tag ?? "");
      if (!contactId || !tag) {
        results.push({ action: action.type, ok: false, detail: "No customer or tag in the event." });
        continue;
      }
      const contact = await client.msgContact.findUnique({ where: { id: contactId } }).catch(() => null);
      if (!contact || contact.businessId !== input.businessId) {
        results.push({ action: action.type, ok: false, detail: "Customer is not a contact in this business." });
        continue;
      }
      const tags = new Set<string>(parseJson<string[]>(contact.tagsJson, []));
      tags.add(tag);
      await client.msgContact.update({ where: { id: contact.id }, data: { tagsJson: JSON.stringify([...tags]) } });
      executed.push(action.type);
      results.push({ action: action.type, ok: true, detail: `Tagged ${tag}` });
      continue;
    }
    results.push({ action: action.type, ok: false, detail: "No executor for this action." });
  }

  const run = await client.erpAutomationRun.create({
    data: {
      businessId: input.businessId,
      ruleId: rule.id,
      trigger: rule.trigger,
      eventJson: JSON.stringify(input.event),
      status: "EXECUTED",
      actionsJson: JSON.stringify(executed),
      resultJson: JSON.stringify({ results }),
      idempotencyKey,
      finishedAt: now,
    },
  });
  await client.erpAutomationRule.update({
    where: { id: rule.id },
    data: {
      lastRunAt: now,
      runCountToday: { increment: 1 },
      failureCount: results.some((result) => !result.ok) ? { increment: 1 } : undefined,
    },
  }).catch(async () => {
    await client.erpAutomationRule.update({ where: { id: rule.id }, data: { lastRunAt: now } });
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.approverId ?? input.actorId,
    actorName: input.actorName,
    action: "AUTOMATION_RUN",
    targetType: "AUTOMATION_RULE",
    targetId: rule.id,
    after: { runId: run.id, executed, trigger: rule.trigger },
    client,
  });

  return { status: "EXECUTED", reason: `Ran ${executed.length} action${executed.length === 1 ? "" : "s"}.`, actions: executed, runId: run.id, results };
}

/** The starter rules offered by each industry pack. Inactive until the owner turns them on. */
export const STARTER_RULES: Array<AutomationRuleInput & { packKeys: string[] }> = [
  {
    name: "Low stock: notify the owner and suggest a purchase",
    trigger: "LOW_STOCK",
    conditions: [{ field: "quantity", operator: "lte", value: 5 }],
    actions: [
      { type: "NOTIFY", params: { title: "Stock is low", message: "A product has reached its reorder level.", role: "OWNER" } },
      { type: "SUGGEST_PURCHASE", params: {} },
    ],
    requiresApproval: false,
    maxRunsPerDay: 20,
    packKeys: ["retail", "supermarket", "wholesale", "pharmacy", "hardware", "electronics", "fashion"],
  },
  {
    name: "New store order: tell the counter",
    trigger: "ORDER_RECEIVED",
    conditions: [{ field: "orderTotalCents", operator: "gte", value: 0 }],
    actions: [{ type: "NOTIFY", params: { title: "New online order", message: "An order arrived from your ordering link." } }],
    requiresApproval: false,
    maxRunsPerDay: 100,
    packKeys: ["retail", "restaurant", "pharmacy", "electronics", "fashion", "grocery"],
  },
  {
    name: "Overdue invoice: create a follow-up task",
    trigger: "INVOICE_OVERDUE",
    conditions: [{ field: "daysOverdue", operator: "gte", value: 3 }],
    actions: [{ type: "CREATE_TASK", params: { title: "Follow up an overdue invoice" } }],
    requiresApproval: true,
    maxRunsPerDay: 25,
    packKeys: ["professional_services", "wholesale", "agency", "bookkeeping"],
  },
];
