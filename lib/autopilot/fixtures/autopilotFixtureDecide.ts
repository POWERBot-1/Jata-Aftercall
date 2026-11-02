/**
 * FICTIONAL Autopilot fixture decisions (development and test only).
 *
 * Runs the REAL deterministic policy functions on fictional state:
 *   - evaluateAutopilotActionPolicy   (kill switch, tenant pause, RBAC, entitlement,
 *                                      regulated-industry, batch and discount caps, modes)
 *   - validateAutopilotActionPayload  (payload shape and batch cap)
 *   - isWithinQuietHours              (Africa/Nairobi, server clock)
 *   - canBusinessRolePerform          (role matrix)
 *
 * Order of checks mirrors app/api/autopilot/proposals/route.ts and
 * lib/autopilot/actions.ts (approveAndExecuteProposal). Where the real path needs the
 * database (daily spend reservation, customer profile and consent lookup), the fixture
 * does NOT claim to enforce it. Those points are listed in
 * FIXTURE_NOT_SIMULATED and are covered by the database-backed suites instead.
 *
 * Nothing here writes to a database, calls a provider, sends a message, or spends money.
 */

import { canBusinessRolePerform, type BusinessRole } from "@/lib/tenant";
import { evaluateAutopilotActionPolicy, defaultRiskCategoryForAction } from "@/lib/autopilot/policy";
import { validateAutopilotActionPayload } from "@/lib/autopilot/actions";
import { isValidHhMm, isWithinQuietHours } from "@/lib/autopilot/consent";
import type { AutopilotActionType } from "@/lib/autopilot/types";
import type { FixtureBusiness, FixtureProposal, FixtureState } from "./autopilotFixtureModel";

export const FIXTURE_NOT_SIMULATED = [
  "Daily spend reservation (database-backed budget ledger): covered by tests/prisma and the CI PostgreSQL job, not this fixture.",
  "Customer profile and opt-in lookup on follow-up queueing (database): fixture mirrors the outcome with fictional consent rows only.",
  "Command turns (LLM provider), document ingestion and channel dispatch: not executed; the fixture returns 501.",
  "Checkout and payment: never initiated from the fixture.",
] as const;

export type FixtureRequest =
  | { kind: "CONFIG_PATCH"; businessId: string; patch: { operationalStatus?: "LIVE" | "PAUSED"; quietHoursStart?: string; quietHoursEnd?: string } }
  | {
      kind: "PROPOSE";
      businessId: string;
      candidate: {
        actionType: AutopilotActionType;
        title: string;
        rationale: string;
        expectedImpact: string | null;
        payload: Record<string, unknown>;
        idempotencyKey: string;
      };
    }
  | {
      kind: "PROPOSAL_OP";
      businessId: string;
      proposalId: string;
      operation: "APPROVE_AND_EXECUTE" | "REJECT" | "ROLLBACK";
    }
  | {
      kind: "CONSENT_RECORD";
      businessId: string;
      channel: "WHATSAPP" | "SMS" | "EMAIL";
      scope: "TRANSACTIONAL" | "MARKETING";
      status: "OPTED_IN" | "OPTED_OUT";
      label: string;
    };

export interface FixtureDecision {
  status: number;
  body: Record<string, unknown>;
  state: FixtureState;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(state: FixtureState, status: number, code: string, error: string): FixtureDecision {
  return { status, body: { ok: false, code, error }, state };
}

function findProposal(state: FixtureState, businessId: string, proposalId: string): FixtureProposal | undefined {
  // Mirrors `findFirst({ where: { id, businessId } })`: the tenant filter is part of the lookup.
  for (const business of Object.values(state.businesses)) {
    const hit = business.proposals.find((p) => p.id === proposalId && p.businessId === businessId);
    if (hit) return hit;
  }
  return undefined;
}

function audit(business: FixtureBusiness, action: string, actorKind: string, now: Date) {
  business.audit.unshift({
    id: `${business.id}-a${business.audit.length + 1}-${now.getTime()}`,
    actorKind,
    action,
    createdAt: now.toISOString(),
  });
}

function isFixtureState(value: unknown): value is FixtureState {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<FixtureState>;
  return typeof v.activeBusinessId === "string" && !!v.businesses && typeof v.businesses === "object";
}

/**
 * Pure decision over fictional state. Returns the next state and the HTTP-style result.
 * `now` is supplied by the caller (the route passes the server clock).
 */
export function decideFixtureRequest(
  input: { state: unknown; request: unknown },
  now: Date = new Date(),
): FixtureDecision {
  if (!isFixtureState(input.state)) {
    return { status: 400, body: { ok: false, code: "INVALID_FIXTURE_STATE", error: "Invalid fixture state." }, state: {} as FixtureState };
  }
  const state = clone(input.state);
  const req = input.request as FixtureRequest;
  if (!req || typeof req !== "object" || typeof (req as { businessId?: unknown }).businessId !== "string") {
    return fail(state, 400, "INVALID_REQUEST", "businessId is required.");
  }

  // Tenant membership: the fictional actor belongs only to the active business.
  if (req.businessId !== state.activeBusinessId) {
    return fail(state, 403, "TENANT_FORBIDDEN", "You are not a member of this business.");
  }
  const business = state.businesses[req.businessId];
  if (!business) return fail(state, 404, "BUSINESS_NOT_FOUND", "Business not found.");

  const role = state.actorRole as BusinessRole;

  if (req.kind === "CONFIG_PATCH") {
    if (!canBusinessRolePerform(role, "manage_settings")) {
      return fail(state, 403, "RBAC_FORBIDDEN", `Your role (${role}) cannot change Autopilot settings.`);
    }
    const p = req.patch;
    if (p.operationalStatus !== undefined && p.operationalStatus !== "LIVE" && p.operationalStatus !== "PAUSED") {
      return fail(state, 400, "INVALID_STATUS", "operationalStatus must be LIVE or PAUSED.");
    }
    if (p.quietHoursStart !== undefined && !isValidHhMm(p.quietHoursStart)) {
      return fail(state, 400, "INVALID_QUIET_HOURS", "quietHoursStart must use 24-hour HH:MM format (for example, 20:00).");
    }
    if (p.quietHoursEnd !== undefined && !isValidHhMm(p.quietHoursEnd)) {
      return fail(state, 400, "INVALID_QUIET_HOURS", "quietHoursEnd must use 24-hour HH:MM format (for example, 07:00).");
    }
    if (p.operationalStatus) business.operationalStatus = p.operationalStatus;
    if (p.quietHoursStart) business.quietHoursStart = p.quietHoursStart;
    if (p.quietHoursEnd) business.quietHoursEnd = p.quietHoursEnd;
    audit(business, p.operationalStatus === "PAUSED" ? "autopilot.config.paused" : "autopilot.config.updated", "OWNER", now);
    return {
      status: 200,
      body: {
        ok: true,
        config: {
          businessId: business.id,
          autonomyMode: business.autonomyMode,
          operationalStatus: business.operationalStatus,
          industryPackKey: business.industryPackKey,
          quietHoursStart: business.quietHoursStart,
          quietHoursEnd: business.quietHoursEnd,
          timezone: business.timezone,
          dailySpendCapMinorKES: business.dailySpendCapMinorKES,
          maxBatchRecipients: business.maxBatchRecipients,
          maxAutoDiscountPct: business.maxAutoDiscountPct,
          voiceEnabled: false,
          version: 1,
        },
      },
      state,
    };
  }

  if (req.kind === "CONSENT_RECORD") {
    if (!canBusinessRolePerform(role, "manage_orders")) {
      return fail(state, 403, "RBAC_FORBIDDEN", `Your role (${role}) cannot record customer consent.`);
    }
    const id = `${business.id}-c${business.consents.length + 1}`;
    business.consents.push({ id, label: req.label, channel: req.channel, scope: req.scope, status: req.status });
    audit(business, "autopilot.consent.updated", "OWNER", now);
    return { status: 200, body: { ok: true, consent: { id, status: req.status, channel: req.channel, scope: req.scope } }, state };
  }

  if (req.kind === "PROPOSE") {
    if (!canBusinessRolePerform(role, "configure")) {
      return fail(state, 403, "RBAC_FORBIDDEN", `Your role (${role}) cannot queue Autopilot proposals.`);
    }
    const duplicate = business.proposals.find((p) => p.idempotencyKey === req.candidate.idempotencyKey);
    if (duplicate) {
      return { status: 200, body: { ok: true, duplicate: true, proposal: { id: duplicate.id, status: duplicate.status } }, state };
    }
    const payloadCheck = validateAutopilotActionPayload(req.candidate.actionType, req.candidate.payload, {
      maxBatchRecipients: business.maxBatchRecipients,
    });
    if (payloadCheck.ok === false) {
      return fail(state, payloadCheck.code === "BATCH_RECIPIENT_CAP_EXCEEDED" ? 409 : 400, payloadCheck.code, payloadCheck.error);
    }
    const risk = defaultRiskCategoryForAction(req.candidate.actionType, payloadCheck.payload);
    const policy = evaluateAutopilotActionPolicy({
      phase: "PROPOSE",
      actorRole: role,
      entitled: business.entitled,
      autonomyMode: business.autonomyMode,
      operationalStatus: business.operationalStatus,
      industryPackKey: business.industryPackKey,
      actionType: req.candidate.actionType,
      riskCategory: risk,
      payload: payloadCheck.payload,
      maxAutoDiscountPct: business.maxAutoDiscountPct,
      maxBatchRecipients: business.maxBatchRecipients,
      env: killSwitchEnv(state),
    });
    if (policy.allowed === false) {
      audit(business, "autopilot.proposal.blocked_by_policy", "SYSTEM", now);
      return fail(state, 409, policy.code, policy.reason);
    }
    const id = `${business.id}-p-new-${business.proposals.length + 1}`;
    business.proposals.unshift({
      id,
      businessId: business.id,
      actionType: req.candidate.actionType as FixtureProposal["actionType"],
      riskCategory: risk,
      status: "PROPOSED",
      title: req.candidate.title,
      rationale: req.candidate.rationale,
      expectedImpact: req.candidate.expectedImpact,
      payload: payloadCheck.payload as unknown as Record<string, unknown>,
      rollbackSupported: true,
      idempotencyKey: req.candidate.idempotencyKey,
      expiresAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
      executedAt: null,
      rolledBackAt: null,
      lastError: null,
      createdAt: now.toISOString(),
    });
    audit(business, "autopilot.proposal.created", "AUTOPILOT", now);
    return { status: 201, body: { ok: true, duplicate: false, proposal: { id, status: "PROPOSED" } }, state };
  }

  // PROPOSAL_OP
  if (!canBusinessRolePerform(role, "configure")) {
    return fail(state, 403, "RBAC_FORBIDDEN", `Your role (${role}) cannot approve, reject or roll back proposals.`);
  }
  const proposal = findProposal(state, req.businessId, req.proposalId);
  if (!proposal) return fail(state, 404, "NOT_FOUND", "Proposal not found for this business.");

  if (req.operation === "REJECT") {
    if (proposal.status !== "PROPOSED") {
      return fail(state, 409, "INVALID_PROPOSAL_STATE", `Only PROPOSED actions can be rejected (current status: ${proposal.status}).`);
    }
    proposal.status = "REJECTED";
    audit(business, "autopilot.proposal.rejected", "OWNER", now);
    return { status: 200, body: { ok: true, proposal: { id: proposal.id, status: "REJECTED" } }, state };
  }

  if (req.operation === "ROLLBACK") {
    if (proposal.status !== "EXECUTED" || !proposal.rollbackSupported) {
      return fail(state, 409, "NOT_ROLLBACK_ELIGIBLE", "Only executed, rollback-supported actions can be rolled back.");
    }
    proposal.status = "ROLLED_BACK";
    proposal.rolledBackAt = now.toISOString();
    audit(business, "autopilot.proposal.rolled_back", "OWNER", now);
    return { status: 200, body: { ok: true, proposal: { id: proposal.id, status: "ROLLED_BACK" } }, state };
  }

  // APPROVE_AND_EXECUTE: same order as approveAndExecuteProposal.
  if (proposal.status === "EXECUTED") {
    return { status: 200, body: { ok: true, idempotentReplay: true, proposal: { id: proposal.id, status: "EXECUTED" } }, state };
  }
  if (proposal.status !== "PROPOSED" && proposal.status !== "APPROVED" && proposal.status !== "FAILED") {
    return fail(state, 409, "INVALID_PROPOSAL_STATE", `Proposal cannot be executed from status '${proposal.status}'.`);
  }
  if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() <= now.getTime()) {
    proposal.status = "EXPIRED";
    return fail(state, 409, "PROPOSAL_EXPIRED", "Proposal has expired and must be re-generated from fresh business data before execution.");
  }

  const payloadCheck = validateAutopilotActionPayload(proposal.actionType as AutopilotActionType, proposal.payload, {
    maxBatchRecipients: business.maxBatchRecipients,
  });
  if (payloadCheck.ok === false) {
    if (payloadCheck.code !== "BATCH_RECIPIENT_CAP_EXCEEDED") {
      proposal.status = "FAILED";
      proposal.lastError = payloadCheck.error;
    }
    return fail(state, payloadCheck.code === "BATCH_RECIPIENT_CAP_EXCEEDED" ? 409 : 400, payloadCheck.code, payloadCheck.error);
  }

  const policy = evaluateAutopilotActionPolicy({
    phase: "EXECUTE",
    actorRole: role,
    entitled: business.entitled,
    autonomyMode: business.autonomyMode,
    operationalStatus: business.operationalStatus,
    industryPackKey: business.industryPackKey,
    actionType: proposal.actionType as AutopilotActionType,
    riskCategory: proposal.riskCategory as never,
    payload: payloadCheck.payload,
    voiceTranscriptConfirmed: false,
    maxAutoDiscountPct: business.maxAutoDiscountPct,
    maxBatchRecipients: business.maxBatchRecipients,
    env: killSwitchEnv(state),
  });
  if (policy.allowed === false) {
    audit(business, "autopilot.execution.blocked_by_policy", "SYSTEM", now);
    const status = policy.code === "RBAC_FORBIDDEN" || policy.code === "ENTITLEMENT_REQUIRED" ? 403 : 409;
    return fail(state, status, policy.code, policy.reason);
  }

  if (proposal.actionType === "QUEUE_CONSENTED_FOLLOWUP") {
    // Real order: quiet hours are checked first (verifyCustomerChannelConsent), then consent.
    const quiet = isWithinQuietHours({
      now,
      quietHoursStart: business.quietHoursStart,
      quietHoursEnd: business.quietHoursEnd,
      timezone: business.timezone,
    });
    if (quiet) {
      audit(business, "autopilot.execution.blocked_by_policy", "SYSTEM", now);
      return fail(state, 409, "QUIET_HOURS_ACTIVE", `Automated outbound messages are blocked during tenant quiet hours (${business.quietHoursStart}–${business.quietHoursEnd} ${business.timezone}).`);
    }
    const hasOptIn = business.consents.some((c) => c.channel === "WHATSAPP" && c.scope === "TRANSACTIONAL" && c.status === "OPTED_IN");
    if (!hasOptIn) {
      audit(business, "autopilot.execution.blocked_by_policy", "SYSTEM", now);
      return fail(state, 409, "CONSENT_NOT_GRANTED", "Explicit TRANSACTIONAL consent on WHATSAPP is not recorded for this business's customers.");
    }
  }

  proposal.status = "EXECUTED";
  proposal.executedAt = now.toISOString();
  proposal.lastError = null;
  audit(business, "autopilot.proposal.executed", "AUTOPILOT", now);
  return {
    status: 200,
    body: {
      ok: true,
      proposal: { id: proposal.id, status: "EXECUTED", actionType: proposal.actionType },
      fixtureNote:
        proposal.actionType === "QUEUE_CONSENTED_FOLLOWUP"
          ? "FIXTURE: staged in a fictional outbox only. Nothing was sent."
          : "FIXTURE: simulated execution. No business record was changed.",
    },
    state,
  };
}

function killSwitchEnv(state: FixtureState): Partial<NodeJS.ProcessEnv> {
  return state.globalKillSwitch ? { JATA_AUTOPILOT_GLOBAL_KILL_SWITCH: "1" } : {};
}
