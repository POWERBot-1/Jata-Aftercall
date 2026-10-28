/**
 * JATA Autopilot — Deterministic Action-Policy, RBAC, Autonomy Modes &
 * Kill-Switch Engine (§3, §4, §10, §17)
 *
 * The LLM is never the authority for its own permissions. Every action is
 * evaluated by deterministic server code before queuing or executing.
 */

import { canBusinessRolePerform, type BusinessRole, type RolePermissionLevel } from "@/lib/tenant";
import { checkRegulatedIndustryViolation, resolveIndustryPack } from "./industry-packs";
import type {
  AutopilotActionPayload,
  AutopilotActionType,
  AutopilotMode,
  AutopilotOperationalStatus,
  AutopilotRiskCategory,
} from "./types";

export function isGlobalAutopilotKillSwitchActive(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  const flag = (env.JATA_AUTOPILOT_GLOBAL_KILL_SWITCH ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

export function requiredBusinessPermissionForAction(
  actionType: AutopilotActionType,
): RolePermissionLevel {
  switch (actionType) {
    case "CREATE_OR_UPDATE_OFFER":
      return "configure";
    case "RESOLVE_UNANSWERED_FAQ":
      return "edit_knowledge";
    case "QUEUE_CONSENTED_FOLLOWUP":
      return "manage_orders";
  }
}

export function defaultRiskCategoryForAction(
  actionType: AutopilotActionType,
  payload: AutopilotActionPayload,
): AutopilotRiskCategory {
  if (actionType === "RESOLVE_UNANSWERED_FAQ") {
    return "LOW_RISK_DRAFT";
  }
  if (actionType === "CREATE_OR_UPDATE_OFFER") {
    const pct = payload.actionType === "CREATE_OR_UPDATE_OFFER" ? (payload.discountPercent ?? 0) : 0;
    return pct > 0 ? "MEDIUM_RISK_REVERSIBLE" : "LOW_RISK_DRAFT";
  }
  return "MEDIUM_RISK_REVERSIBLE";
}

export interface PolicyEvaluationInput {
  phase: "PROPOSE" | "EXECUTE" | "AUTO_EXECUTE";
  actorRole: BusinessRole;
  entitled: boolean;
  autonomyMode: AutopilotMode;
  operationalStatus: AutopilotOperationalStatus;
  industryPackKey: string;
  actionType: AutopilotActionType;
  riskCategory: AutopilotRiskCategory;
  payload: AutopilotActionPayload;
  modality?: "TEXT" | "VOICE_TRANSCRIPT" | "DOCUMENT_EXTRACT";
  voiceTranscriptConfirmed?: boolean;
  maxAutoDiscountPct?: number;
  maxBatchRecipients?: number;
  env?: Partial<NodeJS.ProcessEnv>;
}

export type PolicyDecision =
  | {
      allowed: true;
      requiresExplicitApproval: boolean;
      effectiveRiskCategory: AutopilotRiskCategory;
    }
  | {
      allowed: false;
      code:
        | "GLOBAL_KILL_SWITCH_ACTIVE"
        | "TENANT_AUTOPILOT_PAUSED"
        | "HIGH_RISK_ACTION_LOCKED"
        | "RBAC_FORBIDDEN"
        | "ENTITLEMENT_REQUIRED"
        | "VOICE_CONFIRMATION_REQUIRED"
        | "REGULATED_INDUSTRY_BLOCK"
        | "INVALID_BATCH_RECIPIENT_COUNT"
        | "MISMATCHED_RECIPIENT_COUNT_FIELD"
        | "BATCH_RECIPIENT_CAP_EXCEEDED"
        | "AUTO_DISCOUNT_CAP_EXCEEDED"
        | "MODE_REQUIRES_HUMAN_APPROVAL";
      reason: string;
    };

export function evaluateAutopilotActionPolicy(
  input: PolicyEvaluationInput,
): PolicyDecision {
  if (isGlobalAutopilotKillSwitchActive(input.env)) {
    return {
      allowed: false,
      code: "GLOBAL_KILL_SWITCH_ACTIVE",
      reason:
        "Platform-wide JATA Autopilot emergency kill switch is active. All autonomous proposals and executions are halted.",
    };
  }

  if (input.operationalStatus === "PAUSED") {
    return {
      allowed: false,
      code: "TENANT_AUTOPILOT_PAUSED",
      reason:
        "JATA Autopilot is paused for this business. Resume Autopilot in Command Center settings before running actions.",
    };
  }

  if (input.riskCategory === "HIGH_RISK_LOCKED") {
    return {
      allowed: false,
      code: "HIGH_RISK_ACTION_LOCKED",
      reason:
        "High-risk financial, payout, refund, or destructive actions are permanently locked from autonomous execution.",
    };
  }

  const neededPermission = requiredBusinessPermissionForAction(input.actionType);
  if (!canBusinessRolePerform(input.actorRole, neededPermission)) {
    return {
      allowed: false,
      code: "RBAC_FORBIDDEN",
      reason: `Your role (${input.actorRole}) does not have '${neededPermission}' permission for this action.`,
    };
  }

  if (
    input.modality === "VOICE_TRANSCRIPT" &&
    !input.voiceTranscriptConfirmed
  ) {
    return {
      allowed: false,
      code: "VOICE_CONFIRMATION_REQUIRED",
      reason:
        "Voice commands require explicit owner transcript confirmation before queuing or executing a write action.",
    };
  }

  const pack = resolveIndustryPack(input.industryPackKey);
  const serializedPayload = JSON.stringify(input.payload);
  const regulatedCheck = checkRegulatedIndustryViolation(pack, serializedPayload);
  if (regulatedCheck.allowed === false) {
    return {
      allowed: false,
      code: "REGULATED_INDUSTRY_BLOCK",
      reason: regulatedCheck.reason,
    };
  }

  const maxBatch = input.maxBatchRecipients ?? 50;
  if (input.payload.actionType === "QUEUE_CONSENTED_FOLLOWUP") {
    if (Object.prototype.hasOwnProperty.call(input.payload, "recipientCount")) {
      return {
        allowed: false,
        code: "MISMATCHED_RECIPIENT_COUNT_FIELD",
        reason:
          "Follow-up payload field 'recipientCount' is prohibited; use 'batchRecipientCount' exclusively.",
      };
    }
    const rawBatchCount = input.payload.batchRecipientCount;
    if (
      rawBatchCount !== undefined &&
      (typeof rawBatchCount !== "number" ||
        !Number.isFinite(rawBatchCount) ||
        !Number.isInteger(rawBatchCount) ||
        rawBatchCount < 1)
    ) {
      return {
        allowed: false,
        code: "INVALID_BATCH_RECIPIENT_COUNT",
        reason: "Follow-up batchRecipientCount must be a finite positive integer >= 1.",
      };
    }
    const effectiveBatchCount = rawBatchCount ?? 1;
    if (
      typeof maxBatch !== "number" ||
      !Number.isFinite(maxBatch) ||
      !Number.isInteger(maxBatch) ||
      maxBatch < 1 ||
      effectiveBatchCount > maxBatch
    ) {
      return {
        allowed: false,
        code: "BATCH_RECIPIENT_CAP_EXCEEDED",
        reason: `Follow-up batch size (${effectiveBatchCount}) exceeds tenant safety cap (${maxBatch}).`,
      };
    }
  }

  if ((input.phase === "EXECUTE" || input.phase === "AUTO_EXECUTE") && !input.entitled) {
    return {
      allowed: false,
      code: "ENTITLEMENT_REQUIRED",
      reason:
        "An active JATA Autopilot subscription is required to execute live actions. Preview mode supports grounded diagnosis and safe drafts only.",
    };
  }

  const effectiveRisk = defaultRiskCategoryForAction(input.actionType, input.payload);

  if (input.phase === "AUTO_EXECUTE") {
    if (input.autonomyMode === "ASSISTED") {
      return {
        allowed: false,
        code: "MODE_REQUIRES_HUMAN_APPROVAL",
        reason: "Assisted mode never auto-executes actions; owner approval is required.",
      };
    }

    if (input.autonomyMode === "SUPERVISED" && effectiveRisk !== "LOW_RISK_DRAFT") {
      return {
        allowed: false,
        code: "MODE_REQUIRES_HUMAN_APPROVAL",
        reason:
          "Supervised Autopilot requires explicit owner approval for pricing, discount, or outbound customer messages.",
      };
    }

    const discountPct =
      input.payload.actionType === "CREATE_OR_UPDATE_OFFER"
        ? (input.payload.discountPercent ?? 0)
        : input.payload.actionType === "QUEUE_CONSENTED_FOLLOWUP"
          ? (input.payload.discountPercent ?? 0)
          : 0;
    const maxAutoDiscount = input.maxAutoDiscountPct ?? 0;
    if (discountPct > maxAutoDiscount) {
      return {
        allowed: false,
        code: "AUTO_DISCOUNT_CAP_EXCEEDED",
        reason: `Discount (${discountPct}%) exceeds the configured automatic discount cap (${maxAutoDiscount}%). Queued for owner approval.`,
      };
    }
  }

  const requiresExplicitApproval =
    input.autonomyMode === "ASSISTED" ||
    (input.autonomyMode === "SUPERVISED" && effectiveRisk !== "LOW_RISK_DRAFT");

  return {
    allowed: true,
    requiresExplicitApproval,
    effectiveRiskCategory: effectiveRisk,
  };
}
