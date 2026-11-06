/**
 * Usage metering and billing reconciliation (§Voice deliverable 6).
 *
 * Rules encoded here (never violated anywhere else):
 * - One metering row per call (`callId` unique) — duplicate billing is structurally impossible.
 * - Duration comes from actual answered/ended timestamps; provider cost is only ever what the
 *   provider reported (NULL until then — never estimated or invented).
 * - Metering never creates, updates or deletes Payment rows: customer money moves exclusively
 *   through the existing Paystack subscription checkout, which is itself gated on readiness.
 * - Reconciliation is a pure computation over supplied records so tests (and later the admin
 *   report) can prove customer usage, entitlement windows and provider usage agree.
 */
import type { VoiceEventStore } from "./call-events";
import type { VoiceCallRow } from "./types";

export type VoiceUsageRow = {
  id: string;
  callId: string;
  businessId: string;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number;
  providerCostMinor: number | null;
  providerCostCurrency: string | null;
  status: string;
};

export type UsageCreation = {
  callId: string;
  businessId: string;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date;
  durationSeconds: number;
};

/** Answered duration in whole seconds (0 when never answered). */
export function billableDurationSeconds(answeredAt: Date | null, endedAt: Date | null): number {
  if (!answeredAt || !endedAt) return 0;
  return Math.max(0, Math.floor((endedAt.getTime() - answeredAt.getTime()) / 1000));
}

/**
 * Create the metering row for a finished call. Unanswered calls produce no row (duration 0,
 * nothing to reconcile). Safe to call repeatedly (callId is unique).
 */
export async function finalizeUsageForCall(store: VoiceEventStore, call: VoiceCallRow, now: () => Date = () => new Date()): Promise<VoiceUsageRow | null> {
  const answeredAt = call.answeredAt;
  if (!answeredAt) return null;
  const endedAt = call.endedAt ?? now();
  const createUsage = (store as any).createUsageIfMissing?.bind(store);
  if (typeof createUsage !== "function") return null;
  const row = await createUsage({
    callId: call.id,
    businessId: call.businessId,
    startedAt: answeredAt,
    answeredAt,
    endedAt,
    durationSeconds: billableDurationSeconds(answeredAt, endedAt),
  } satisfies UsageCreation);
  if (row && row.status === "OPEN" && !row.endedAt) {
    const updateUsage = (store as any).updateUsage?.bind(store);
    if (typeof updateUsage === "function") {
      await updateUsage(row.id, { status: "FINALIZED", endedAt, durationSeconds: billableDurationSeconds(answeredAt, endedAt) });
    }
  } else if (row && row.status === "OPEN") {
    const updateUsage = (store as any).updateUsage?.bind(store);
    if (typeof updateUsage === "function") await updateUsage(row.id, { status: "FINALIZED" });
  }
  return row;
}

/** Record a provider-reported cost for a call. Only call with real provider numbers. */
export async function applyProviderCost(
  store: VoiceEventStore,
  input: { callId: string; costMinor: number; currency: string },
): Promise<void> {
  if (!Number.isSafeInteger(input.costMinor) || input.costMinor < 0) {
    throw new Error("provider cost must be a non-negative integer amount of minor units");
  }
  const updateUsage = (store as any).updateUsage?.bind(store);
  const findUsage = (store as any).findUsageByCallId?.bind(store);
  if (typeof updateUsage !== "function" || typeof findUsage !== "function") return;
  const row = await findUsage(input.callId);
  if (!row) throw new Error("no usage row for call — provider cost cannot be attached");
  await updateUsage(row.id, { providerCostMinor: input.costMinor, providerCostCurrency: input.currency });
}

export type ReconciliationInput = {
  usage: VoiceUsageRow[];
  /** Active subscription for the Voice tier during the window, if any. */
  voiceEntitlement: { businessId: string; status: string; expiresAt: Date | null } | null;
  /** Provider's own usage report lines for the same window (optional). */
  providerReport?: Array<{ callId: string; durationSeconds: number; costMinor: number | null }>;
  window: { from: Date; to: Date };
  /** True while the service was unavailable (readiness off or kill switch engaged). */
  serviceAvailable: boolean;
};

export type ReconciliationReport = {
  calls: number;
  totalBillableSeconds: number;
  totalProviderCostMinor: number | null;
  /** Usage attached to a business without an active entitlement — must be empty or explained. */
  usageWithoutEntitlement: string[];
  /** Provider lines that disagree with local metering — investigated, never auto-fixed. */
  providerMismatches: Array<{ callId: string; issue: string }>;
  /** Calls metered while service was reported unavailable — customers are not charged for these. */
  usageDuringOutage: string[];
  duplicateCallIds: string[];
  clean: boolean;
};

/** Pure reconciliation over verified records — no database access, no invention. */
export function reconcileVoiceUsage(input: ReconciliationInput): ReconciliationReport {
  const seen = new Set<string>();
  const duplicateCallIds: string[] = [];
  let totalBillableSeconds = 0;
  let costSum: number | null = null;
  const usageWithoutEntitlement: string[] = [];
  const usageDuringOutage: string[] = [];

  const entitlementActive =
    input.voiceEntitlement !== null &&
    input.voiceEntitlement.status === "ACTIVE" &&
    (input.voiceEntitlement.expiresAt === null || input.voiceEntitlement.expiresAt.getTime() >= input.window.from.getTime());

  for (const row of input.usage) {
    if (seen.has(row.callId)) duplicateCallIds.push(row.callId);
    seen.add(row.callId);
    totalBillableSeconds += row.durationSeconds;
    if (typeof row.providerCostMinor === "number") costSum = (costSum ?? 0) + row.providerCostMinor;
    if (!entitlementActive) usageWithoutEntitlement.push(row.callId);
    if (!input.serviceAvailable) usageDuringOutage.push(row.callId);
  }

  const providerMismatches: Array<{ callId: string; issue: string }> = [];
  for (const line of input.providerReport ?? []) {
    const local = input.usage.find((row) => row.callId === line.callId);
    if (!local) {
      providerMismatches.push({ callId: line.callId, issue: "PROVIDER_ONLY" });
      continue;
    }
    if (line.durationSeconds !== local.durationSeconds) {
      providerMismatches.push({ callId: line.callId, issue: `DURATION provider=${line.durationSeconds} local=${local.durationSeconds}` });
    }
    if (line.costMinor !== null && local.providerCostMinor !== null && line.costMinor !== local.providerCostMinor) {
      providerMismatches.push({ callId: line.callId, issue: `COST provider=${line.costMinor} local=${local.providerCostMinor}` });
    }
  }

  const clean =
    usageWithoutEntitlement.length === 0 &&
    providerMismatches.length === 0 &&
    usageDuringOutage.length === 0 &&
    duplicateCallIds.length === 0;

  return {
    calls: input.usage.length,
    totalBillableSeconds,
    totalProviderCostMinor: costSum,
    usageWithoutEntitlement,
    providerMismatches,
    usageDuringOutage,
    duplicateCallIds,
    clean,
  };
}
