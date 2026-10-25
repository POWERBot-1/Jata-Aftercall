/**
 * JATA Autopilot — Owner Command Center Conversational & Voice Router (§7, §9, §10)
 *
 * Answers owner business questions strictly from `runGroundedBusinessDiagnosis()`,
 * enforces voice transcript confirmation before any write proposal, blocks prompt
 * injection and regulated clinical/legal violations, and meters AI usage.
 */

import prisma from "@/lib/db";
import { resolveProvider } from "@/lib/ai/registry";
import type { BusinessRole } from "@/lib/tenant";
import {
  getAutopilotConfig,
  proposeAutopilotAction,
  updateAutopilotConfiguration,
} from "./actions";
import { recordAutopilotAudit } from "./audit";
import { runGroundedBusinessDiagnosis } from "./diagnosis";
import { getAutopilotEntitlement } from "./entitlement";
import { checkRegulatedIndustryViolation, resolveIndustryPack } from "./industry-packs";
import { isGlobalAutopilotKillSwitchActive } from "./policy";
import { redactAutopilotText, scanForPromptInjection } from "./security";
import {
  releaseAutopilotBudgetReservation,
  reserveAutopilotBudget,
} from "./usage";

export interface CommandCenterTurnResult {
  ok: boolean;
  reply: string;
  providerUsed: string;
  requiresVoiceConfirmation?: boolean;
  blockedCode?: string;
  createdProposal?: any | null;
  pausedChangedTo?: "PAUSED" | "LIVE" | null;
  diagnosisSnapshot?: Awaited<ReturnType<typeof runGroundedBusinessDiagnosis>>;
}

const WRITE_INTENT_REGEX =
  /\b(draft|create|publish|launch|update|approve|resolve|fix|send|queue)\b.*\b(offer|promo|promotion|faq|question|follow[ -]?up|message)\b/i;

const PAUSE_INTENT_REGEX =
  /^\s*(pause|emergency\s+stop|halt)\s+(jata\s+)?autopilot\b/i;

const RESUME_INTENT_REGEX =
  /^\s*(resume|unpause)\s+(jata\s+)?autopilot\b/i;

export async function handleOwnerCommandTurn(params: {
  businessId: string;
  actorUserId: string;
  actorRole: BusinessRole;
  message: string;
  modality?: "TEXT" | "VOICE_TRANSCRIPT";
  voiceTranscriptConfirmed?: boolean;
  now?: Date;
}): Promise<CommandCenterTurnResult> {
  const now = params.now ?? new Date();
  const modality = params.modality ?? "TEXT";
  const cleanMessage = redactAutopilotText(params.message.trim()).slice(0, 2000);

  if (!cleanMessage) {
    return {
      ok: false,
      reply: "Enter or dictate a question or instruction for JATA Autopilot.",
      providerUsed: "jata-policy",
      blockedCode: "EMPTY_MESSAGE",
    };
  }

  // 1. Prompt-injection hard boundary
  const injection = scanForPromptInjection(cleanMessage);
  if (!injection.safe) {
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      actorUserId: params.actorUserId,
      action: "autopilot.command.prompt_injection_blocked",
      metadata: { code: injection.code, modality },
    });
    return {
      ok: false,
      reply:
        injection.reason ??
        "Instruction blocked by JATA Autopilot prompt-injection boundary.",
      providerUsed: "jata-security",
      blockedCode: injection.code ?? "PROMPT_INJECTION",
    };
  }

  // 2. Immediate emergency pause command (works even if kill switch is not set; requires OWNER/MANAGER)
  if (PAUSE_INTENT_REGEX.test(cleanMessage)) {
    if (modality === "VOICE_TRANSCRIPT" && !params.voiceTranscriptConfirmed) {
      return {
        ok: false,
        reply:
          "Voice transcript captured: confirm the transcript checkbox to pause JATA Autopilot.",
        providerUsed: "jata-voice-gate",
        requiresVoiceConfirmation: true,
        blockedCode: "VOICE_CONFIRMATION_REQUIRED",
      };
    }
    const paused = await updateAutopilotConfiguration({
      businessId: params.businessId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      patch: { operationalStatus: "PAUSED" },
    });
    if (paused.ok === false) {
      return {
        ok: false,
        reply: paused.error,
        providerUsed: "jata-rbac",
        blockedCode: "RBAC_FORBIDDEN",
      };
    }
    return {
      ok: true,
      reply:
        "Emergency Pause activated. JATA Autopilot will not propose or execute actions for this business until you resume it.",
      providerUsed: "jata-local",
      pausedChangedTo: "PAUSED",
    };
  }

  if (RESUME_INTENT_REGEX.test(cleanMessage)) {
    if (modality === "VOICE_TRANSCRIPT" && !params.voiceTranscriptConfirmed) {
      return {
        ok: false,
        reply: "Confirm the voice transcript checkbox to resume JATA Autopilot.",
        providerUsed: "jata-voice-gate",
        requiresVoiceConfirmation: true,
        blockedCode: "VOICE_CONFIRMATION_REQUIRED",
      };
    }
    const resumed = await updateAutopilotConfiguration({
      businessId: params.businessId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      patch: { operationalStatus: "LIVE" },
    });
    if (resumed.ok === false) {
      return {
        ok: false,
        reply: resumed.error,
        providerUsed: "jata-rbac",
        blockedCode: "RBAC_FORBIDDEN",
      };
    }
    return {
      ok: true,
      reply: "JATA Autopilot resumed (`LIVE`) in your configured autonomy mode.",
      providerUsed: "jata-local",
      pausedChangedTo: "LIVE",
    };
  }

  if (isGlobalAutopilotKillSwitchActive()) {
    return {
      ok: false,
      reply:
        "Platform-wide JATA Autopilot kill switch is active. Diagnostic data remains readable in the dashboard, while autonomous actions are halted.",
      providerUsed: "jata-kill-switch",
      blockedCode: "GLOBAL_KILL_SWITCH_ACTIVE",
    };
  }

  const [config, entitlement] = await Promise.all([
    getAutopilotConfig(params.businessId),
    getAutopilotEntitlement(params.businessId, now),
  ]);
  const diagnosis = await runGroundedBusinessDiagnosis({
    businessId: params.businessId,
    explicitIndustryPackKey: config.industryPackKey,
    now,
  });
  const pack = resolveIndustryPack(diagnosis.industryPackKey);

  // 3. Regulated industry safety check on owner command
  const regCheck = checkRegulatedIndustryViolation(pack, cleanMessage);
  if (regCheck.allowed === false) {
    await recordAutopilotAudit({
      businessId: params.businessId,
      actorKind: "SYSTEM",
      actorUserId: params.actorUserId,
      action: "autopilot.command.regulated_guardrail_blocked",
      metadata: { code: regCheck.code },
    });
    return {
      ok: false,
      reply: regCheck.reason,
      providerUsed: "jata-regulated-guardrail",
      blockedCode: regCheck.code,
      diagnosisSnapshot: diagnosis,
    };
  }

  // 4. Tenant Emergency Pause gate: read-only deterministic diagnostics remain readable,
  //    while write proposals and external AI provider spend are halted immediately.
  const hasWriteIntent = WRITE_INTENT_REGEX.test(cleanMessage);
  if (config.operationalStatus === "PAUSED") {
    if (hasWriteIntent) {
      return {
        ok: false,
        reply:
          "Emergency Pause is active for this business. Resume JATA Autopilot before queuing or executing actions.",
        providerUsed: "jata-paused-readonly",
        blockedCode: "TENANT_AUTOPILOT_PAUSED",
        diagnosisSnapshot: diagnosis,
      };
    }
    return {
      ok: true,
      reply: `[PAUSED — Read-Only Diagnostics]\n\n${buildDeterministicExecutiveBrief(diagnosis, null)}`,
      providerUsed: "jata-paused-readonly",
      diagnosisSnapshot: diagnosis,
    };
  }

  // 5. Write-intent routing with mandatory voice confirmation
  if (hasWriteIntent && modality === "VOICE_TRANSCRIPT" && !params.voiceTranscriptConfirmed) {
    return {
      ok: false,
      reply:
        "Voice command detected for a business write action. Review and check 'Confirm voice transcript' before Autopilot queues this proposal.",
      providerUsed: "jata-voice-gate",
      requiresVoiceConfirmation: true,
      blockedCode: "VOICE_CONFIRMATION_REQUIRED",
      diagnosisSnapshot: diagnosis,
    };
  }

  let createdProposal: any | null = null;
  if (hasWriteIntent && diagnosis.suggestedProposals.length > 0) {
    const wantsFaq = /\b(faq|question|front\s*desk|answer)\b/i.test(cleanMessage);
    const candidate =
      (wantsFaq
        ? diagnosis.suggestedProposals.find((p) => p.actionType === "RESOLVE_UNANSWERED_FAQ")
        : diagnosis.suggestedProposals.find((p) => p.actionType === "CREATE_OR_UPDATE_OFFER")) ??
      diagnosis.suggestedProposals[0];

    const propRes = await proposeAutopilotAction({
      businessId: params.businessId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      actionType: candidate.actionType,
      title: candidate.title,
      rationale: candidate.rationale,
      expectedImpact: candidate.expectedImpact,
      payload: candidate.payload,
      idempotencyKey: `${candidate.idempotencyKey}_cmd`,
      modality,
      voiceTranscriptConfirmed: params.voiceTranscriptConfirmed,
      now,
    });
    if (propRes.ok === false) {
      return {
        ok: false,
        reply: propRes.error,
        providerUsed: "jata-policy",
        blockedCode: propRes.code,
        diagnosisSnapshot: diagnosis,
      };
    }
    createdProposal = propRes.proposal;
  }

  // 6. Metered narrative response (uses configured text provider if available & within budget,
  //    strictly anchored to `diagnosis` facts; deterministic `jata-local` otherwise).
  const tierKey = entitlement.entitled ? entitlement.tier : "PREVIEW";
  const capability = modality === "VOICE_TRANSCRIPT" ? "VOICE_STT" : "LLM_REASONING";
  const turnIdempotencyKey = `turn_${params.businessId}_${now.getTime()}_${cleanMessage.slice(0, 20)}`;

  let providerUsed = "jata-local";
  let reply = buildDeterministicExecutiveBrief(diagnosis, createdProposal);

  const textProvider = resolveProvider("text");
  const budget = await reserveAutopilotBudget({
    businessId: params.businessId,
    tierKey,
    capability,
    provider: textProvider.key,
    idempotencyKey: turnIdempotencyKey,
    dailySpendCapMinorKES: config.dailySpendCapMinorKES,
    unitsIn: cleanMessage.length,
    unitsOut: reply.length,
    now,
  });

  if (budget.allowed && textProvider.key !== "jata-local") {
    try {
      const groundedFacts = [
        diagnosis.healthSummary,
        ...diagnosis.findings.map((f) => `[${f.basis}] ${f.title}: ${f.summary}`),
        ...diagnosis.dataGaps.map((g) => `Missing data: ${g}`),
        ...(createdProposal ? [`Queued proposal (${createdProposal.status}): ${createdProposal.title}`] : []),
      ];
      const llmRes = await textProvider.generateText(
        {
          kind: "autopilot_executive_brief",
          system:
            "Answer the business owner concisely using ONLY the supplied grounded facts. Never invent revenue, customer counts, or payment verification.",
          prompt: cleanMessage,
          maxChars: 550,
          facts: groundedFacts,
          design: {
            businessName: diagnosis.businessName,
            category: diagnosis.industryPackName,
          } as any,
          count: 1,
          seed: params.businessId,
        },
        {
          businessId: params.businessId,
          generationId: `autopilot_${now.getTime()}`,
          timeoutMs: 12_000,
        },
      );
      if (llmRes.texts?.[0]?.trim()) {
        reply = redactAutopilotText(llmRes.texts[0].trim());
        providerUsed = textProvider.key;
      }
    } catch {
      await releaseAutopilotBudgetReservation(turnIdempotencyKey);
      providerUsed = "jata-local";
    }
  }

  // Persist session turn when database is reachable
  try {
    const session = await prisma.autopilotSession.create({
      data: {
        businessId: params.businessId,
        actorUserId: params.actorUserId,
        surface: "COMMAND_CENTER",
        title: cleanMessage.slice(0, 80),
      },
    });
    await prisma.autopilotMessage.create({
      data: {
        businessId: params.businessId,
        sessionId: session.id,
        role: "USER",
        modality,
        content: cleanMessage,
      },
    });
    await prisma.autopilotMessage.create({
      data: {
        businessId: params.businessId,
        sessionId: session.id,
        role: "ASSISTANT",
        modality: "TEXT",
        content: reply,
        diagnosticsJson: JSON.stringify({ providerUsed }),
      },
    });
  } catch {
    // Non-fatal in offline preview mode.
  }

  return {
    ok: true,
    reply,
    providerUsed,
    createdProposal,
    diagnosisSnapshot: diagnosis,
  };
}

function buildDeterministicExecutiveBrief(
  diagnosis: Awaited<ReturnType<typeof runGroundedBusinessDiagnosis>>,
  createdProposal: any | null,
): string {
  const parts: string[] = [diagnosis.healthSummary];
  if (diagnosis.findings.length > 0) {
    const top = diagnosis.findings
      .slice(0, 2)
      .map((f) => `• [${f.basis}] ${f.title}: ${f.summary}`)
      .join("\n");
    parts.push(`Priority findings:\n${top}`);
  }
  if (diagnosis.dataGaps.length > 0) {
    parts.push(`Missing data signals: ${diagnosis.dataGaps.join(" ")}`);
  }
  if (createdProposal) {
    parts.push(
      `Action queued (${createdProposal.status}): "${createdProposal.title}" — review, approve, or roll back any time in the Approval Queue.`,
    );
  }
  return parts.join("\n\n");
}
