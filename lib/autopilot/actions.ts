/**
 * JATA Autopilot — Proposal Queue, Idempotent Execution & Reversible Rollback Engine
 * (§3, §4, §11, §17)
 *
 * Implements the vertical-slice closed loop:
 *   PROPOSE -> AUTHORIZE -> SNAPSHOT BEFORE -> EXECUTE -> VERIFY AFTER -> AUDIT -> ROLLBACK
 */

import prisma from "@/lib/db";
import { assertNoInlineImagePersistence } from "@/lib/media/persistence-policy";
import { canBusinessRolePerform, type BusinessRole } from "@/lib/tenant";
import { recordAutopilotAudit } from "./audit";
import { isValidHhMm, verifyCustomerChannelConsent } from "./consent";
import { getAutopilotEntitlement } from "./entitlement";
import { isIndustryPackKey, resolveIndustryPack } from "./industry-packs";
import {
  defaultRiskCategoryForAction,
  evaluateAutopilotActionPolicy,
  isGlobalAutopilotKillSwitchActive,
} from "./policy";
import { redactAutopilotObject, scanForPromptInjection } from "./security";
import type {
  AutopilotActionPayload,
  AutopilotActionType,
  AutopilotMode,
  AutopilotOperationalStatus,
} from "./types";
import {
  releaseAutopilotBudgetReservation,
  reserveAutopilotBudget,
} from "./usage";

export interface AutopilotConfigSnapshot {
  businessId: string;
  autonomyMode: AutopilotMode;
  operationalStatus: AutopilotOperationalStatus;
  industryPackKey: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  dailySpendCapMinorKES: number;
  maxBatchRecipients: number;
  maxAutoDiscountPct: number;
  voiceEnabled: boolean;
  version: number;
}

export async function getAutopilotConfig(
  businessId: string,
  fallbackCategory?: string | null,
): Promise<AutopilotConfigSnapshot> {
  const defaultPack = resolveIndustryPack(fallbackCategory).key;
  try {
    const existing = await prisma.autopilotConfiguration.findUnique({
      where: { businessId },
    });
    if (existing) {
      return {
        businessId,
        autonomyMode: (existing.autonomyMode as AutopilotMode) || "ASSISTED",
        operationalStatus:
          (existing.operationalStatus as AutopilotOperationalStatus) || "LIVE",
        industryPackKey: existing.industryPackKey || defaultPack,
        quietHoursStart: existing.quietHoursStart || "20:00",
        quietHoursEnd: existing.quietHoursEnd || "07:00",
        timezone: existing.timezone || "Africa/Nairobi",
        dailySpendCapMinorKES: Number(existing.dailySpendCapMinorKES ?? 25_000),
        maxBatchRecipients: Number(existing.maxBatchRecipients ?? 50),
        maxAutoDiscountPct: Number(existing.maxAutoDiscountPct ?? 0),
        voiceEnabled: Boolean(existing.voiceEnabled),
        version: Number(existing.version ?? 1),
      };
    }
  } catch {
    // Offline fallback uses safe defaults below.
  }
  return {
    businessId,
    autonomyMode: "ASSISTED",
    operationalStatus: "LIVE",
    industryPackKey: defaultPack,
    quietHoursStart: "20:00",
    quietHoursEnd: "07:00",
    timezone: "Africa/Nairobi",
    dailySpendCapMinorKES: 25_000,
    maxBatchRecipients: 50,
    maxAutoDiscountPct: 0,
    voiceEnabled: false,
    version: 1,
  };
}

export async function updateAutopilotConfiguration(params: {
  businessId: string;
  actorUserId: string;
  actorRole: BusinessRole;
  patch: Partial<{
    autonomyMode: AutopilotMode;
    operationalStatus: AutopilotOperationalStatus;
    industryPackKey: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    dailySpendCapMinorKES: number;
    maxBatchRecipients: number;
    maxAutoDiscountPct: number;
    voiceEnabled: boolean;
  }>;
}): Promise<{ ok: true; config: AutopilotConfigSnapshot } | { ok: false; status: number; error: string }> {
  if (!canBusinessRolePerform(params.actorRole, "manage_settings")) {
    return {
      ok: false,
      status: 403,
      error: "Only the business OWNER, ADMIN, or MANAGER can change Autopilot governance or pause state.",
    };
  }

  if (
    params.patch.quietHoursStart !== undefined &&
    !isValidHhMm(params.patch.quietHoursStart)
  ) {
    return {
      ok: false,
      status: 400,
      error: "quietHoursStart must use 24-hour HH:MM format (for example, 20:00).",
    };
  }
  if (
    params.patch.quietHoursEnd !== undefined &&
    !isValidHhMm(params.patch.quietHoursEnd)
  ) {
    return {
      ok: false,
      status: 400,
      error: "quietHoursEnd must use 24-hour HH:MM format (for example, 07:00).",
    };
  }

  const current = await getAutopilotConfig(params.businessId);
  const nextMode: AutopilotMode =
    params.patch.autonomyMode &&
    ["ASSISTED", "SUPERVISED", "ADVANCED"].includes(params.patch.autonomyMode)
      ? params.patch.autonomyMode
      : current.autonomyMode;
  const nextStatus: AutopilotOperationalStatus =
    params.patch.operationalStatus &&
    ["LIVE", "PAUSED"].includes(params.patch.operationalStatus)
      ? params.patch.operationalStatus
      : current.operationalStatus;
  const nextPack =
    params.patch.industryPackKey && isIndustryPackKey(params.patch.industryPackKey)
      ? params.patch.industryPackKey
      : current.industryPackKey;

  const nextDailyCap =
    typeof params.patch.dailySpendCapMinorKES === "number" &&
    Number.isFinite(params.patch.dailySpendCapMinorKES)
      ? Math.max(1_000, Math.min(5_000_000, Math.round(params.patch.dailySpendCapMinorKES)))
      : current.dailySpendCapMinorKES;
  const nextBatchCap =
    typeof params.patch.maxBatchRecipients === "number" &&
    Number.isFinite(params.patch.maxBatchRecipients)
      ? Math.max(1, Math.min(500, Math.round(params.patch.maxBatchRecipients)))
      : current.maxBatchRecipients;
  const nextDiscountCap =
    typeof params.patch.maxAutoDiscountPct === "number" &&
    Number.isFinite(params.patch.maxAutoDiscountPct)
      ? Math.max(0, Math.min(30, Math.round(params.patch.maxAutoDiscountPct)))
      : current.maxAutoDiscountPct;

  const saved = await prisma.autopilotConfiguration.upsert({
    where: { businessId: params.businessId },
    create: {
      businessId: params.businessId,
      autonomyMode: nextMode,
      operationalStatus: nextStatus,
      industryPackKey: nextPack,
      quietHoursStart: params.patch.quietHoursStart ?? current.quietHoursStart,
      quietHoursEnd: params.patch.quietHoursEnd ?? current.quietHoursEnd,
      timezone: current.timezone,
      dailySpendCapMinorKES: nextDailyCap,
      maxBatchRecipients: nextBatchCap,
      maxAutoDiscountPct: nextDiscountCap,
      voiceEnabled: params.patch.voiceEnabled ?? current.voiceEnabled,
      version: 1,
    },
    update: {
      autonomyMode: nextMode,
      operationalStatus: nextStatus,
      industryPackKey: nextPack,
      quietHoursStart: params.patch.quietHoursStart ?? current.quietHoursStart,
      quietHoursEnd: params.patch.quietHoursEnd ?? current.quietHoursEnd,
      dailySpendCapMinorKES: nextDailyCap,
      maxBatchRecipients: nextBatchCap,
      maxAutoDiscountPct: nextDiscountCap,
      voiceEnabled: params.patch.voiceEnabled ?? current.voiceEnabled,
      version: current.version + 1,
    },
  });

  const actionName =
    params.patch.operationalStatus && params.patch.operationalStatus !== current.operationalStatus
      ? params.patch.operationalStatus === "PAUSED"
        ? "autopilot.emergency_pause.activated"
        : "autopilot.emergency_pause.resumed"
      : "autopilot.configuration.updated";

  await recordAutopilotAudit({
    businessId: params.businessId,
    actorKind: params.actorRole === "OWNER" ? "OWNER" : "STAFF",
    actorUserId: params.actorUserId,
    action: actionName,
    targetType: "AutopilotConfiguration",
    targetId: saved.id,
    metadata: {
      before: current,
      after: {
        autonomyMode: nextMode,
        operationalStatus: nextStatus,
        industryPackKey: nextPack,
        dailySpendCapMinorKES: nextDailyCap,
        maxBatchRecipients: nextBatchCap,
        maxAutoDiscountPct: nextDiscountCap,
      },
    },
  });

  return {
    ok: true,
    config: await getAutopilotConfig(params.businessId),
  };
}

export async function listAutopilotProposals(businessId: string, limit = 30) {
  try {
    const rows = await prisma.autopilotActionProposal.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row: any) => ({
      id: String(row.id),
      businessId: String(row.businessId),
      actionType: row.actionType as AutopilotActionType,
      riskCategory: String(row.riskCategory),
      autonomyModeAtCreation: String(row.autonomyModeAtCreation),
      status: String(row.status),
      title: String(row.title),
      rationale: String(row.rationale),
      expectedImpact: row.expectedImpact ?? null,
      payload: safeJsonParse(row.payloadJson),
      rollbackSupported: Boolean(row.rollbackSupported),
      voiceTranscriptConfirmed: Boolean(row.voiceTranscriptConfirmed),
      idempotencyKey: String(row.idempotencyKey),
      executedAt: row.executedAt instanceof Date ? row.executedAt.toISOString() : row.executedAt ?? null,
      rolledBackAt: row.rolledBackAt instanceof Date ? row.rolledBackAt.toISOString() : row.rolledBackAt ?? null,
      lastError: row.lastError ?? null,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt ?? new Date().toISOString()),
    }));
  } catch {
    return [];
  }
}

function safeJsonParse(raw: unknown): any {
  if (typeof raw !== "string" || !raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function validateAutopilotActionPayload(
  actionType: AutopilotActionType,
  payload: unknown,
): { ok: true; payload: AutopilotActionPayload } | { ok: false; code: string; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      code: "INVALID_ACTION_PAYLOAD",
      error: "Action payload must be a JSON object.",
    };
  }
  const p = payload as Record<string, unknown>;
  if (p.actionType !== actionType) {
    return {
      ok: false,
      code: "ACTION_PAYLOAD_MISMATCH",
      error: `Payload actionType '${String(p.actionType)}' must match proposal actionType '${actionType}'.`,
    };
  }

  if (actionType === "CREATE_OR_UPDATE_OFFER") {
    const title = typeof p.title === "string" ? p.title.trim() : "";
    const description = typeof p.description === "string" ? p.description.trim() : "";
    if (!title || title.length > 140) {
      return {
        ok: false,
        code: "INVALID_OFFER_TITLE",
        error: "Offer title is required and must be 1–140 characters.",
      };
    }
    if (description.length > 1000) {
      return {
        ok: false,
        code: "INVALID_OFFER_DESCRIPTION",
        error: "Offer description must be 1,000 characters or fewer.",
      };
    }
    if (
      p.discountPercent !== undefined &&
      (typeof p.discountPercent !== "number" ||
        !Number.isFinite(p.discountPercent) ||
        p.discountPercent < 0 ||
        p.discountPercent > 100)
    ) {
      return {
        ok: false,
        code: "INVALID_OFFER_DISCOUNT",
        error: "Offer discountPercent must be between 0 and 100.",
      };
    }
    if (
      p.validUntilIso !== undefined &&
      p.validUntilIso !== null &&
      (typeof p.validUntilIso !== "string" || Number.isNaN(Date.parse(p.validUntilIso)))
    ) {
      return {
        ok: false,
        code: "INVALID_OFFER_EXPIRY",
        error: "Offer validUntilIso must be a valid ISO timestamp.",
      };
    }
    return { ok: true, payload: payload as AutopilotActionPayload };
  }

  if (actionType === "RESOLVE_UNANSWERED_FAQ") {
    const question = typeof p.question === "string" ? p.question.trim() : "";
    const answer = typeof p.answer === "string" ? p.answer.trim() : "";
    if (!question || question.length > 500 || !answer || answer.length > 2000) {
      return {
        ok: false,
        code: "INVALID_FAQ_PAYLOAD",
        error: "FAQ resolution requires a non-empty question (<=500 chars) and answer (<=2000 chars).",
      };
    }
    return { ok: true, payload: payload as AutopilotActionPayload };
  }

  if (actionType === "QUEUE_CONSENTED_FOLLOWUP") {
    const channel = p.channel;
    const scope = p.scope;
    const body = typeof p.body === "string" ? p.body.trim() : "";
    if (channel !== "WHATSAPP" && channel !== "SMS" && channel !== "EMAIL") {
      return {
        ok: false,
        code: "INVALID_FOLLOWUP_CHANNEL",
        error: "Follow-up channel must be WHATSAPP, SMS, or EMAIL.",
      };
    }
    if (scope !== "TRANSACTIONAL" && scope !== "MARKETING") {
      return {
        ok: false,
        code: "INVALID_FOLLOWUP_SCOPE",
        error: "Follow-up scope must be TRANSACTIONAL or MARKETING.",
      };
    }
    if (!body || body.length > 2000) {
      return {
        ok: false,
        code: "INVALID_FOLLOWUP_BODY",
        error: "Follow-up message body is required and must be 2,000 characters or fewer.",
      };
    }
    if (
      p.recipientCount !== undefined &&
      (typeof p.recipientCount !== "number" ||
        !Number.isInteger(p.recipientCount) ||
        p.recipientCount < 1)
    ) {
      return {
        ok: false,
        code: "INVALID_RECIPIENT_COUNT",
        error: "Follow-up recipientCount must be a positive integer.",
      };
    }
    return { ok: true, payload: payload as AutopilotActionPayload };
  }

  return {
    ok: false,
    code: "UNSUPPORTED_ACTION_TYPE",
    error: `Unsupported Autopilot actionType '${String(actionType)}'.`,
  };
}

export async function proposeAutopilotAction(params: {
  businessId: string;
  actorUserId: string;
  actorRole: BusinessRole;
  actionType: AutopilotActionType;
  title: string;
  rationale: string;
  expectedImpact?: string;
  payload: AutopilotActionPayload;
  idempotencyKey: string;
  sessionId?: string | null;
  modality?: "TEXT" | "VOICE_TRANSCRIPT" | "DOCUMENT_EXTRACT";
  voiceTranscriptConfirmed?: boolean;
  now?: Date;
}): Promise<
  | { ok: true; proposal: any; autoExecuted: boolean; duplicate: boolean }
  | { ok: false; code: string; error: string; status: number }
> {
  const payloadCheck = validateAutopilotActionPayload(params.actionType, params.payload);
  if (payloadCheck.ok === false) {
    return {
      ok: false,
      code: payloadCheck.code,
      error: payloadCheck.error,
      status: 400,
    };
  }

  const injectionScan = scanForPromptInjection(
    `${params.title}\n${params.rationale}\n${JSON.stringify(params.payload)}`,
  );
  if (!injectionScan.safe) {
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      actorUserId: params.actorUserId,
      action: "autopilot.security.prompt_injection_blocked",
      metadata: { code: injectionScan.code },
    });
    return {
      ok: false,
      code: injectionScan.code ?? "PROMPT_INJECTION_BLOCKED",
      error: injectionScan.reason ?? "Blocked unsafe payload.",
      status: 400,
    };
  }

  assertNoInlineImagePersistence(params.payload);

  const [config, entitlement] = await Promise.all([
    getAutopilotConfig(params.businessId),
    getAutopilotEntitlement(params.businessId, params.now),
  ]);

  const riskCategory = defaultRiskCategoryForAction(params.actionType, params.payload);
  const policy = evaluateAutopilotActionPolicy({
    phase: "PROPOSE",
    actorRole: params.actorRole,
    entitled: entitlement.entitled,
    autonomyMode: config.autonomyMode,
    operationalStatus: config.operationalStatus,
    industryPackKey: config.industryPackKey,
    actionType: params.actionType,
    riskCategory,
    payload: params.payload,
    modality: params.modality,
    voiceTranscriptConfirmed: params.voiceTranscriptConfirmed,
    maxAutoDiscountPct: config.maxAutoDiscountPct,
    maxBatchRecipients: config.maxBatchRecipients,
  });

  if (policy.allowed === false) {
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      actorUserId: params.actorUserId,
      action: "autopilot.proposal.blocked_by_policy",
      metadata: { code: policy.code, reason: policy.reason, actionType: params.actionType },
    });
    return {
      ok: false,
      code: policy.code,
      error: policy.reason,
      status: policy.code === "RBAC_FORBIDDEN" ? 403 : 409,
    };
  }

  const normalizedKey = params.idempotencyKey.trim().slice(0, 140);
  if (!normalizedKey) {
    return {
      ok: false,
      code: "MISSING_IDEMPOTENCY_KEY",
      error: "idempotencyKey is required for every Autopilot proposal.",
      status: 400,
    };
  }

  // Idempotency guard per (businessId, idempotencyKey)
  const existing = await prisma.autopilotActionProposal.findUnique({
    where: {
      businessId_idempotencyKey: {
        businessId: params.businessId,
        idempotencyKey: normalizedKey,
      },
    },
  });
  if (existing) {
    return { ok: true, proposal: existing, autoExecuted: false, duplicate: true };
  }

  const sanitizedPayload = redactAutopilotObject(params.payload);
  let created: any;
  try {
    created = await prisma.autopilotActionProposal.create({
      data: {
        businessId: params.businessId,
        sessionId: params.sessionId ?? null,
        actionType: params.actionType,
        riskCategory: policy.effectiveRiskCategory,
        autonomyModeAtCreation: config.autonomyMode,
        status: "PROPOSED",
        title: params.title.slice(0, 200),
        rationale: params.rationale.slice(0, 2000),
        expectedImpact: params.expectedImpact?.slice(0, 1000) ?? null,
        payloadJson: JSON.stringify(sanitizedPayload),
        rollbackSupported: true,
        voiceTranscriptConfirmed: Boolean(params.voiceTranscriptConfirmed),
        idempotencyKey: normalizedKey,
        proposedBy: "AUTOPILOT",
        expiresAt: new Date((params.now ?? new Date()).getTime() + 7 * 86_400_000),
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const raced = await prisma.autopilotActionProposal.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId: params.businessId,
            idempotencyKey: normalizedKey,
          },
        },
      });
      if (raced) {
        return { ok: true, proposal: raced, autoExecuted: false, duplicate: true };
      }
    }
    throw err;
  }

  await recordAutopilotAudit({
    businessId: params.businessId,
    actorKind: "AUTOPILOT",
    actorUserId: params.actorUserId,
    action: "autopilot.proposal.created",
    targetType: "AutopilotActionProposal",
    targetId: created.id,
    proposalId: created.id,
    metadata: {
      actionType: params.actionType,
      riskCategory: policy.effectiveRiskCategory,
      autonomyMode: config.autonomyMode,
    },
  });

  // Check if current mode permits safe immediate auto-execution
  const autoCheck = evaluateAutopilotActionPolicy({
    phase: "AUTO_EXECUTE",
    actorRole: params.actorRole,
    entitled: entitlement.entitled,
    autonomyMode: config.autonomyMode,
    operationalStatus: config.operationalStatus,
    industryPackKey: config.industryPackKey,
    actionType: params.actionType,
    riskCategory: policy.effectiveRiskCategory,
    payload: params.payload,
    modality: params.modality,
    voiceTranscriptConfirmed: params.voiceTranscriptConfirmed,
    maxAutoDiscountPct: config.maxAutoDiscountPct,
    maxBatchRecipients: config.maxBatchRecipients,
  });

  if (autoCheck.allowed) {
    const execResult = await approveAndExecuteProposal({
      businessId: params.businessId,
      proposalId: created.id,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      now: params.now,
    });
    if (execResult.ok) {
      return {
        ok: true,
        proposal: execResult.proposal,
        autoExecuted: true,
        duplicate: false,
      };
    }
  }

  return { ok: true, proposal: created, autoExecuted: false, duplicate: false };
}

export async function rejectProposal(params: {
  businessId: string;
  proposalId: string;
  actorUserId: string;
  actorRole: BusinessRole;
}): Promise<{ ok: true; proposal: any } | { ok: false; status: number; error: string }> {
  if (!canBusinessRolePerform(params.actorRole, "configure")) {
    return { ok: false, status: 403, error: "Insufficient role to reject proposals." };
  }
  const proposal = await prisma.autopilotActionProposal.findFirst({
    where: { id: params.proposalId, businessId: params.businessId },
  });
  if (!proposal) {
    return { ok: false, status: 404, error: "Proposal not found for this business." };
  }
  if (proposal.status !== "PROPOSED") {
    return {
      ok: false,
      status: 409,
      error: `Only PROPOSED actions can be rejected (current status: ${proposal.status}).`,
    };
  }
  const updated = await prisma.autopilotActionProposal.update({
    where: { id: proposal.id },
    data: {
      status: "REJECTED",
      decidedByUserId: params.actorUserId,
      decidedAt: new Date(),
    },
  });
  await recordAutopilotAudit({
    businessId: params.businessId,
    actorKind: params.actorRole === "OWNER" ? "OWNER" : "STAFF",
    actorUserId: params.actorUserId,
    action: "autopilot.proposal.rejected",
    targetType: "AutopilotActionProposal",
    targetId: proposal.id,
    proposalId: proposal.id,
  });
  return { ok: true, proposal: updated };
}

export async function approveAndExecuteProposal(params: {
  businessId: string;
  proposalId: string;
  actorUserId: string;
  actorRole: BusinessRole;
  now?: Date;
}): Promise<
  | { ok: true; proposal: any; idempotentReplay?: boolean }
  | { ok: false; code: string; status: number; error: string }
> {
  const now = params.now ?? new Date();
  const proposal = await prisma.autopilotActionProposal.findFirst({
    where: { id: params.proposalId, businessId: params.businessId },
  });
  if (!proposal) {
    return {
      ok: false,
      code: "NOT_FOUND",
      status: 404,
      error: "Proposal not found for this business.",
    };
  }
  if (proposal.status === "EXECUTED") {
    return { ok: true, proposal, idempotentReplay: true };
  }

  const staleExecuting =
    proposal.status === "EXECUTING" &&
    proposal.decidedAt &&
    now.getTime() - new Date(proposal.decidedAt).getTime() > 5 * 60_000;

  if (
    proposal.status !== "PROPOSED" &&
    proposal.status !== "APPROVED" &&
    proposal.status !== "FAILED" &&
    !staleExecuting
  ) {
    return {
      ok: false,
      code: proposal.status === "EXECUTING" ? "CONCURRENT_EXECUTION" : "INVALID_PROPOSAL_STATE",
      status: 409,
      error: `Proposal cannot be executed from status '${proposal.status}'.`,
    };
  }

  if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() <= now.getTime()) {
    await prisma.autopilotActionProposal.update({
      where: { id: proposal.id },
      data: { status: "EXPIRED" },
    });
    return {
      ok: false,
      code: "PROPOSAL_EXPIRED",
      status: 409,
      error: "Proposal has expired and must be re-generated from fresh business data before execution.",
    };
  }

  const rawPayload = safeJsonParse(proposal.payloadJson);
  const payloadValidation = validateAutopilotActionPayload(
    proposal.actionType as AutopilotActionType,
    rawPayload,
  );
  if (payloadValidation.ok === false) {
    await prisma.autopilotActionProposal.update({
      where: { id: proposal.id },
      data: { status: "FAILED", lastError: payloadValidation.error },
    });
    return {
      ok: false,
      code: payloadValidation.code,
      status: 400,
      error: payloadValidation.error,
    };
  }
  const payload = payloadValidation.payload;

  const [config, entitlement] = await Promise.all([
    getAutopilotConfig(params.businessId),
    getAutopilotEntitlement(params.businessId, now),
  ]);

  const policy = evaluateAutopilotActionPolicy({
    phase: "EXECUTE",
    actorRole: params.actorRole,
    entitled: entitlement.entitled,
    autonomyMode: config.autonomyMode,
    operationalStatus: config.operationalStatus,
    industryPackKey: config.industryPackKey,
    actionType: proposal.actionType as AutopilotActionType,
    riskCategory: proposal.riskCategory as any,
    payload,
    voiceTranscriptConfirmed: Boolean(proposal.voiceTranscriptConfirmed),
    maxAutoDiscountPct: config.maxAutoDiscountPct,
    maxBatchRecipients: config.maxBatchRecipients,
  });

  if (policy.allowed === false) {
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      actorUserId: params.actorUserId,
      action: "autopilot.execution.blocked_by_policy",
      proposalId: proposal.id,
      metadata: { code: policy.code, reason: policy.reason },
    });
    return {
      ok: false,
      code: policy.code,
      status: policy.code === "RBAC_FORBIDDEN" || policy.code === "ENTITLEMENT_REQUIRED" ? 403 : 409,
      error: policy.reason,
    };
  }

  const neededCap =
    proposal.actionType === "QUEUE_CONSENTED_FOLLOWUP" ? "OUTBOUND_MSG" : "WORKFLOW_STEP";
  const budgetIdempotencyKey = `exec_${proposal.id}`;
  const budget = await reserveAutopilotBudget({
    businessId: params.businessId,
    tierKey: entitlement.entitled ? entitlement.tier : "PREVIEW",
    capability: neededCap,
    provider: "jata-autopilot-executor",
    idempotencyKey: budgetIdempotencyKey,
    dailySpendCapMinorKES: config.dailySpendCapMinorKES,
    unitsIn: 1,
    unitsOut: 1,
    now,
  });
  if (budget.allowed === false) {
    return {
      ok: false,
      code: budget.code,
      status: 429,
      error: budget.reason,
    };
  }

  // Compare-and-set transition to EXECUTING so concurrent double-clicks never execute twice
  const claimed = await prisma.autopilotActionProposal.updateMany({
    where: { id: proposal.id, businessId: params.businessId, status: proposal.status },
    data: {
      status: "EXECUTING",
      decidedByUserId: params.actorUserId,
      decidedAt: now,
    },
  });
  if (claimed.count !== 1) {
    const latest = await prisma.autopilotActionProposal.findFirst({
      where: { id: proposal.id, businessId: params.businessId },
    });
    if (latest?.status === "EXECUTED") {
      return { ok: true, proposal: latest, idempotentReplay: true };
    }
    return {
      ok: false,
      code: "CONCURRENT_EXECUTION",
      status: 409,
      error: "Proposal is already being processed.",
    };
  }

  try {
    let beforeSnapshot: Record<string, unknown> = {};
    let afterSnapshot: Record<string, unknown> = {};

    if (payload.actionType === "CREATE_OR_UPDATE_OFFER") {
      const priorOffer = await prisma.offer.findUnique({
        where: { businessId: params.businessId },
      });
      beforeSnapshot = priorOffer
        ? {
            existed: true,
            title: priorOffer.title,
            subtitle: priorOffer.subtitle,
            validUntil: priorOffer.validUntil ? new Date(priorOffer.validUntil).toISOString() : null,
            isActive: priorOffer.isActive,
            ctaLabel: priorOffer.ctaLabel,
            badge: priorOffer.badge,
            imageUrl: priorOffer.imageUrl,
          }
        : { existed: false };

      const updatedOffer = await prisma.offer.upsert({
        where: { businessId: params.businessId },
        create: {
          businessId: params.businessId,
          title: payload.title,
          subtitle: payload.description,
          badge: payload.badgeText ?? null,
          ctaLabel: payload.ctaLabel ?? null,
          validUntil: payload.validUntilIso ? new Date(payload.validUntilIso) : null,
          isActive: true,
        },
        update: {
          title: payload.title,
          subtitle: payload.description,
          badge: payload.badgeText ?? null,
          ctaLabel: payload.ctaLabel ?? null,
          validUntil: payload.validUntilIso ? new Date(payload.validUntilIso) : null,
          isActive: true,
        },
      });
      afterSnapshot = { offerId: updatedOffer.id, title: updatedOffer.title, isActive: updatedOffer.isActive };
    } else if (payload.actionType === "RESOLVE_UNANSWERED_FAQ") {
      const existingFaq = await prisma.fAQ.findFirst({
        where: { businessId: params.businessId, question: payload.question },
      });
      let priorUnanswered: any = null;
      if (payload.unansweredQuestionId) {
        priorUnanswered = await prisma.unansweredQuestion.findFirst({
          where: { id: payload.unansweredQuestionId, businessId: params.businessId },
        });
        if (!priorUnanswered) {
          await releaseAutopilotBudgetReservation(budgetIdempotencyKey);
          await prisma.autopilotActionProposal.update({
            where: { id: proposal.id },
            data: { status: "FAILED", lastError: "Unanswered question does not belong to this business." },
          });
          return {
            ok: false,
            code: "FOREIGN_OR_MISSING_QUESTION",
            status: 404,
            error: "Referenced unanswered question was not found for this business.",
          };
        }
      }
      beforeSnapshot = {
        existingFaqId: existingFaq?.id ?? null,
        existingFaqAnswer: existingFaq?.approvedAnswer ?? null,
        existingFaqActive: existingFaq?.isActive ?? null,
        unansweredQuestionId: priorUnanswered?.id ?? null,
        unansweredWasResolved: priorUnanswered?.isResolved ?? false,
        unansweredPriorAnswer: priorUnanswered?.approvedAnswer ?? null,
      };

      const savedFaq = existingFaq
        ? await prisma.fAQ.update({
            where: { id: existingFaq.id },
            data: { approvedAnswer: payload.answer, isActive: true },
          })
        : await prisma.fAQ.create({
            data: {
              businessId: params.businessId,
              question: payload.question,
              approvedAnswer: payload.answer,
              isActive: true,
            },
          });

      if (priorUnanswered) {
        await prisma.unansweredQuestion.update({
          where: { id: priorUnanswered.id },
          data: {
            approvedAnswer: payload.answer,
            isResolved: true,
          },
        });
      }
      afterSnapshot = {
        faqId: savedFaq.id,
        question: savedFaq.question,
        resolvedUnansweredId: priorUnanswered?.id ?? null,
      };
    } else if (payload.actionType === "QUEUE_CONSENTED_FOLLOWUP") {
      const consentCheck = await verifyCustomerChannelConsent({
        businessId: params.businessId,
        recipientPhone: payload.recipientPhone,
        recipientEmail: payload.recipientEmail,
        channel: payload.channel,
        scope: payload.scope,
        quietHoursStart: config.quietHoursStart,
        quietHoursEnd: config.quietHoursEnd,
        timezone: config.timezone,
        now,
      });
      if (consentCheck.allowed === false) {
        await releaseAutopilotBudgetReservation(budgetIdempotencyKey);
        await prisma.autopilotActionProposal.update({
          where: { id: proposal.id },
          data: { status: "FAILED", lastError: consentCheck.reason },
        });
        return {
          ok: false,
          code: consentCheck.code,
          status: 409,
          error: consentCheck.reason,
        };
      }

      beforeSnapshot = { queuedNotificationExisted: false };
      const queuedNotification = await prisma.notification.create({
        data: {
          businessId: params.businessId,
          eventType: "AUTOPILOT_CONSENTED_FOLLOWUP",
          title: payload.subject || "Business follow-up",
          message: payload.body,
          channel: payload.channel,
          recipientNumber: payload.recipientPhone ?? null,
          recipientEmail: payload.recipientEmail ?? null,
          status: "PENDING",
          referenceId: proposal.id,
        },
      });
      afterSnapshot = {
        notificationId: queuedNotification.id,
        status: queuedNotification.status,
        deliveryState: "STAGED_IN_OUTBOX",
        providerVerifiedDelivery: false,
        channel: queuedNotification.channel,
      };
    }

    assertNoInlineImagePersistence(beforeSnapshot);
    assertNoInlineImagePersistence(afterSnapshot);

    const finalized = await prisma.autopilotActionProposal.update({
      where: { id: proposal.id },
      data: {
        status: "EXECUTED",
        beforeSnapshotJson: JSON.stringify(beforeSnapshot),
        afterSnapshotJson: JSON.stringify(afterSnapshot),
        executedAt: now,
        lastError: null,
      },
    });

    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: params.actorRole === "OWNER" ? "OWNER" : "STAFF",
      actorUserId: params.actorUserId,
      action: "autopilot.proposal.executed",
      targetType: "AutopilotActionProposal",
      targetId: proposal.id,
      proposalId: proposal.id,
      metadata: {
        actionType: proposal.actionType,
        afterSnapshot,
      },
    });

    return { ok: true, proposal: finalized };
  } catch (err) {
    await releaseAutopilotBudgetReservation(budgetIdempotencyKey);
    const safeMsg = err instanceof Error ? err.message.slice(0, 240) : "Execution error";
    await prisma.autopilotActionProposal.update({
      where: { id: proposal.id },
      data: { status: "FAILED", lastError: safeMsg },
    });
    return {
      ok: false,
      code: "EXECUTION_FAILED",
      status: 500,
      error: "Action execution failed safely; target state was not marked complete.",
    };
  }
}

export async function rollbackExecutedProposal(params: {
  businessId: string;
  proposalId: string;
  actorUserId: string;
  actorRole: BusinessRole;
  now?: Date;
}): Promise<
  | { ok: true; proposal: any }
  | { ok: false; code: string; status: number; error: string }
> {
  const now = params.now ?? new Date();
  if (!canBusinessRolePerform(params.actorRole, "configure")) {
    return {
      ok: false,
      code: "RBAC_FORBIDDEN",
      status: 403,
      error: "Your role does not permit rolling back Autopilot actions.",
    };
  }

  const proposal = await prisma.autopilotActionProposal.findFirst({
    where: { id: params.proposalId, businessId: params.businessId },
  });
  if (!proposal) {
    return {
      ok: false,
      code: "NOT_FOUND",
      status: 404,
      error: "Proposal not found for this business.",
    };
  }
  if (proposal.status !== "EXECUTED") {
    return {
      ok: false,
      code: "NOT_EXECUTED",
      status: 409,
      error: `Only EXECUTED actions can be rolled back (current status: ${proposal.status}).`,
    };
  }
  if (!proposal.rollbackSupported) {
    return {
      ok: false,
      code: "ROLLBACK_NOT_SUPPORTED",
      status: 409,
      error: "This action does not support automated rollback.",
    };
  }

  const before = safeJsonParse(proposal.beforeSnapshotJson);
  const after = safeJsonParse(proposal.afterSnapshotJson);

  if (proposal.actionType === "QUEUE_CONSENTED_FOLLOWUP" && after.notificationId) {
    const notifPreCheck = await prisma.notification.findFirst({
      where: { id: String(after.notificationId), businessId: params.businessId },
    });
    if (notifPreCheck?.status === "DELIVERED") {
      return {
        ok: false,
        code: "ALREADY_DELIVERED_EXTERNAL",
        status: 409,
        error:
          "Follow-up message has already been delivered to the external recipient and cannot be unsent.",
      };
    }
  }

  // Compare-and-set transition so concurrent rollback clicks never restore/delete twice
  const claimedRollback = await prisma.autopilotActionProposal.updateMany({
    where: { id: proposal.id, businessId: params.businessId, status: "EXECUTED" },
    data: { status: "ROLLING_BACK" },
  });
  if (claimedRollback.count !== 1) {
    const latest = await prisma.autopilotActionProposal.findFirst({
      where: { id: proposal.id, businessId: params.businessId },
    });
    if (latest?.status === "ROLLED_BACK") {
      return { ok: true, proposal: latest };
    }
    return {
      ok: false,
      code: "CONCURRENT_ROLLBACK",
      status: 409,
      error: "Proposal rollback is already in progress.",
    };
  }

  try {
    if (proposal.actionType === "CREATE_OR_UPDATE_OFFER") {
      if (before.existed) {
        await prisma.offer.upsert({
          where: { businessId: params.businessId },
          create: {
            businessId: params.businessId,
            title: String(before.title ?? ""),
            subtitle: before.subtitle ?? null,
            validUntil: before.validUntil ? new Date(before.validUntil) : null,
            isActive: Boolean(before.isActive),
            ctaLabel: before.ctaLabel ?? null,
            badge: before.badge ?? null,
            imageUrl: before.imageUrl ?? null,
          },
          update: {
            title: String(before.title ?? ""),
            subtitle: before.subtitle ?? null,
            validUntil: before.validUntil ? new Date(before.validUntil) : null,
            isActive: Boolean(before.isActive),
            ctaLabel: before.ctaLabel ?? null,
            badge: before.badge ?? null,
            imageUrl: before.imageUrl ?? null,
          },
        });
      } else {
        await prisma.offer.delete({ where: { businessId: params.businessId } }).catch(async () => {
          await prisma.offer.upsert({
            where: { businessId: params.businessId },
            create: { businessId: params.businessId, title: "Inactive", isActive: false },
            update: { isActive: false },
          });
        });
      }
    } else if (proposal.actionType === "RESOLVE_UNANSWERED_FAQ") {
      if (before.existingFaqId) {
        await prisma.fAQ.update({
          where: { id: String(before.existingFaqId) },
          data: {
            approvedAnswer: String(before.existingFaqAnswer ?? ""),
            isActive: Boolean(before.existingFaqActive ?? true),
          },
        });
      } else if (after.faqId) {
        await prisma.fAQ.delete({ where: { id: String(after.faqId) } }).catch(async () => {
          await prisma.fAQ.update({
            where: { id: String(after.faqId) },
            data: { isActive: false },
          });
        });
      }
      if (before.unansweredQuestionId) {
        const ownedQuestion = await prisma.unansweredQuestion.findFirst({
          where: { id: String(before.unansweredQuestionId), businessId: params.businessId },
        });
        if (ownedQuestion) {
          await prisma.unansweredQuestion.update({
            where: { id: ownedQuestion.id },
            data: {
              isResolved: Boolean(before.unansweredWasResolved),
              approvedAnswer: before.unansweredPriorAnswer ?? null,
            },
          });
        }
      }
    } else if (proposal.actionType === "QUEUE_CONSENTED_FOLLOWUP") {
      if (after.notificationId) {
        const notif = await prisma.notification.findFirst({
          where: { id: String(after.notificationId), businessId: params.businessId },
        });
        if (notif?.status === "DELIVERED") {
          await prisma.autopilotActionProposal.update({
            where: { id: proposal.id },
            data: { status: "EXECUTED" },
          });
          return {
            ok: false,
            code: "ALREADY_DELIVERED_EXTERNAL",
            status: 409,
            error:
              "Follow-up message has already been delivered to the external recipient and cannot be unsent.",
          };
        }
        if (notif) {
          await prisma.notification.update({
            where: { id: notif.id },
            data: { status: "SKIPPED" },
          });
        }
      }
    }
  } catch (err) {
    await prisma.autopilotActionProposal.update({
      where: { id: proposal.id },
      data: { status: "EXECUTED" },
    });
    throw err;
  }

  const rolledBack = await prisma.autopilotActionProposal.update({
    where: { id: proposal.id },
    data: {
      status: "ROLLED_BACK",
      rolledBackAt: now,
    },
  });

  await recordAutopilotAudit({
    businessId: params.businessId,
    actorKind: params.actorRole === "OWNER" ? "OWNER" : "STAFF",
    actorUserId: params.actorUserId,
    action: "autopilot.proposal.rolled_back",
    targetType: "AutopilotActionProposal",
    targetId: proposal.id,
    proposalId: proposal.id,
    metadata: { actionType: proposal.actionType },
  });

  return { ok: true, proposal: rolledBack };
}

/**
 * Final pre-dispatch gate for staged Autopilot outbox notifications (§8.4, §11).
 *
 * Re-verifies Global Kill Switch, Tenant Pause, active Entitlement, EAT quiet
 * hours, and explicit consent / `STOP` opt-out IMMEDIATELY before any external
 * provider dispatch, and never marks a message `DELIVERED` without an
 * authoritative non-empty `providerMessageId`.
 */
export async function dispatchQueuedAutopilotFollowup(params: {
  businessId: string;
  notificationId: string;
  scope?: "TRANSACTIONAL" | "MARKETING";
  now?: Date;
  env?: Partial<NodeJS.ProcessEnv>;
  sendViaProvider?: (notification: any) => Promise<{
    delivered: boolean;
    providerMessageId?: string | null;
    errorMessage?: string;
  }>;
}): Promise<
  | {
      ok: true;
      deliveryState: "DELIVERED" | "STAGED_AWAITING_PROVIDER";
      providerMessageId: string | null;
    }
  | { ok: false; code: string; reason: string }
> {
  const now = params.now ?? new Date();
  const notif = await prisma.notification.findFirst({
    where: { id: params.notificationId, businessId: params.businessId },
  });
  if (!notif) {
    return {
      ok: false,
      code: "NOTIFICATION_NOT_FOUND",
      reason: "Queued notification not found for this business.",
    };
  }
  if (notif.status === "DELIVERED") {
    return { ok: true, deliveryState: "DELIVERED", providerMessageId: null };
  }
  if (notif.status !== "PENDING") {
    return {
      ok: false,
      code: "NOTIFICATION_NOT_PENDING",
      reason: `Notification cannot be dispatched from status '${String(notif.status)}'.`,
    };
  }

  if (isGlobalAutopilotKillSwitchActive(params.env)) {
    await prisma.notification.update({
      where: { id: notif.id },
      data: { status: "SKIPPED" },
    });
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      action: "autopilot.dispatch.halted_pre_send",
      targetType: "Notification",
      targetId: notif.id,
      metadata: { code: "GLOBAL_KILL_SWITCH_ACTIVE" },
    });
    return {
      ok: false,
      code: "GLOBAL_KILL_SWITCH_ACTIVE",
      reason: "Platform kill switch halted outbound dispatch before send.",
    };
  }

  const [config, entitlement] = await Promise.all([
    getAutopilotConfig(params.businessId),
    getAutopilotEntitlement(params.businessId, now),
  ]);

  if (config.operationalStatus === "PAUSED") {
    await prisma.notification.update({
      where: { id: notif.id },
      data: { status: "SKIPPED" },
    });
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      action: "autopilot.dispatch.halted_pre_send",
      targetType: "Notification",
      targetId: notif.id,
      metadata: { code: "TENANT_AUTOPILOT_PAUSED" },
    });
    return {
      ok: false,
      code: "TENANT_AUTOPILOT_PAUSED",
      reason: "Tenant Emergency Pause halted outbound dispatch before send.",
    };
  }

  if (!entitlement.entitled) {
    await prisma.notification.update({
      where: { id: notif.id },
      data: { status: "SKIPPED" },
    });
    return {
      ok: false,
      code: "ENTITLEMENT_REQUIRED",
      reason: "Active Autopilot subscription is required before outbound dispatch.",
    };
  }

  const consentCheck = await verifyCustomerChannelConsent({
    businessId: params.businessId,
    recipientPhone: notif.recipientNumber,
    recipientEmail: notif.recipientEmail,
    channel: (notif.channel as "WHATSAPP" | "SMS" | "EMAIL") || "WHATSAPP",
    scope: params.scope ?? "TRANSACTIONAL",
    quietHoursStart: config.quietHoursStart,
    quietHoursEnd: config.quietHoursEnd,
    timezone: config.timezone,
    now,
  });

  if (consentCheck.allowed === false) {
    await prisma.notification.update({
      where: { id: notif.id },
      data: { status: "SKIPPED" },
    });
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      action: "autopilot.dispatch.halted_pre_send",
      targetType: "Notification",
      targetId: notif.id,
      metadata: { code: consentCheck.code, reason: consentCheck.reason },
    });
    return {
      ok: false,
      code: consentCheck.code,
      reason: consentCheck.reason,
    };
  }

  if (!params.sendViaProvider) {
    return {
      ok: true,
      deliveryState: "STAGED_AWAITING_PROVIDER",
      providerMessageId: null,
    };
  }

  const providerRes = await params.sendViaProvider(notif);
  const providerMessageId =
    typeof providerRes.providerMessageId === "string" ? providerRes.providerMessageId.trim() : "";

  if (!providerRes.delivered || !providerMessageId) {
    await prisma.notification.update({
      where: { id: notif.id },
      data: { status: "FAILED" },
    });
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      action: "autopilot.dispatch.provider_failed",
      targetType: "Notification",
      targetId: notif.id,
      metadata: { errorMessage: providerRes.errorMessage ?? "Missing providerMessageId" },
    });
    return {
      ok: false,
      code: "PROVIDER_DELIVERY_UNVERIFIED",
      reason:
        providerRes.errorMessage ||
        "External gateway did not return an authoritative provider message ID; message was not marked DELIVERED.",
    };
  }

  await prisma.notification.update({
    where: { id: notif.id },
    data: { status: "DELIVERED" },
  });
  await recordAutopilotAudit({
    businessId: params.businessId,
    actorKind: "SYSTEM",
    action: "autopilot.dispatch.delivered",
    targetType: "Notification",
    targetId: notif.id,
    metadata: { providerMessageId, channel: notif.channel },
  });

  return {
    ok: true,
    deliveryState: "DELIVERED",
    providerMessageId,
  };
}
