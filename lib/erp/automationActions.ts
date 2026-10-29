/**
 * Automation rule lifecycle helpers
 *
 * Kept beside the engine so the actions layer cannot construct an invalid rule: every create,
 * activate and pause goes through validation, a permission-relevant status change and an audit
 * entry. Rules are created inactive; turning one on is a deliberate, separate act.
 */

import { logErpAudit } from "./audit";
import { validateAutomationRule, type AutomationAction, type AutomationCondition } from "./automation";
export { runAutomation } from "./automation";

export async function createAutomationRule(
  client: any,
  input: {
    businessId: string;
    actorId?: string | null;
    actorName?: string | null;
    name: string;
    trigger: string;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
    requiresApproval?: boolean;
    maxRunsPerDay?: number;
    activate?: boolean;
  },
) {
  const validation = validateAutomationRule({
    name: input.name,
    trigger: input.trigger,
    conditions: input.conditions,
    actions: input.actions,
    requiresApproval: input.requiresApproval,
    maxRunsPerDay: input.maxRunsPerDay,
  });
  if (!validation.ok) throw Object.assign(new Error(validation.errors[0]), { status: 400, code: "RULE_INVALID" });

  const rule = await client.erpAutomationRule.create({
    data: {
      businessId: input.businessId,
      name: input.name.trim(),
      trigger: input.trigger,
      conditionsJson: JSON.stringify(input.conditions),
      actionsJson: JSON.stringify(input.actions),
      status: input.activate ? "ACTIVE" : "DRAFT",
      requiresApproval: input.requiresApproval !== false,
      maxRunsPerDay: input.maxRunsPerDay ?? 50,
      createdById: input.actorId ?? null,
    },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "AUTOMATION_RULE_CREATED",
    targetType: "AUTOMATION_RULE",
    targetId: rule.id,
    after: { name: rule.name, trigger: rule.trigger, status: rule.status },
    client,
  });
  return rule;
}

export async function activateAutomation(
  client: any,
  input: { businessId: string; ruleId: string; actorId?: string | null; actorName?: string | null },
) {
  const rule = await client.erpAutomationRule.findUnique({ where: { id: input.ruleId } });
  if (!rule || rule.businessId !== input.businessId) throw Object.assign(new Error("That rule was not found."), { status: 404 });
  const actions = JSON.parse(rule.actionsJson || "[]");
  const validation = validateAutomationRule({
    name: rule.name,
    trigger: rule.trigger,
    conditions: JSON.parse(rule.conditionsJson || "[]"),
    actions,
    requiresApproval: rule.requiresApproval,
    maxRunsPerDay: rule.maxRunsPerDay,
  });
  if (!validation.ok) throw Object.assign(new Error(validation.errors[0]), { status: 400 });
  const configuration = await client.erpConfiguration.findUnique({ where: { businessId: input.businessId } }).catch(() => null);
  try {
    const flags = JSON.parse(configuration?.featureFlagsJson || "{}");
    if (flags.automationKillSwitch) {
      throw Object.assign(new Error("Automation is paused by the platform safety switch. Ask support to review it before activating rules."), { status: 409 });
    }
  } catch (error: any) {
    if (error?.status) throw error;
  }
  const updated = await client.erpAutomationRule.update({ where: { id: rule.id }, data: { status: "ACTIVE" } });
  await logErpAudit({ businessId: input.businessId, actorId: input.actorId, actorName: input.actorName, action: "AUTOMATION_RULE_ACTIVATED", targetType: "AUTOMATION_RULE", targetId: rule.id, client });
  return updated;
}

export async function pauseAutomation(
  client: any,
  input: { businessId: string; ruleId: string; actorId?: string | null; actorName?: string | null; reason: string },
) {
  const rule = await client.erpAutomationRule.findUnique({ where: { id: input.ruleId } });
  if (!rule || rule.businessId !== input.businessId) throw Object.assign(new Error("That rule was not found."), { status: 404 });
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 5) throw Object.assign(new Error("Write a short reason so the next person knows why this stopped."), { status: 400, code: "REASON_REQUIRED" });
  const updated = await client.erpAutomationRule.update({ where: { id: rule.id }, data: { status: "PAUSED" } });
  await logErpAudit({ businessId: input.businessId, actorId: input.actorId, actorName: input.actorName, action: "AUTOMATION_RULE_PAUSED", targetType: "AUTOMATION_RULE", targetId: rule.id, reason: input.reason, client });
  return updated;
}
