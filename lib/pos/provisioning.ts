/**
 * Provisioning and configuration lifecycle (§20, §43, §44, §48, §49)
 *
 * Server-side state machine for one tenant's POS. Every transition is written with the
 * business id resolved from authenticated membership (§5), versions are immutable so past
 * transactions stay interpretable (§48), and nothing becomes LIVE without confirmed payment.
 */

import prisma from "../db";
import { assertBusinessOwnership } from "../tenant";
import { SAFE_ERRORS } from "../safeError";
import type { SessionPayload } from "../auth";
import {
  applyTerminologyOverrides, buildConfiguration, configurationFingerprint, configurationSummary,
  finalize, normalizeConfiguration, validateConfiguration, type BuildContext,
} from "./configuration";
import { configurationReadiness, pruneAnswers, sanitizeAnswers } from "./questionnaire";
import { POS_PLAN_KEY, syncPosEntitlement } from "./entitlement";
import { CLONE_SCOPES, cloneConfiguration } from "./templates";
import type { CloneScopeKey } from "./types";
import { logPosAudit } from "./audit";
import type { PosConfiguration, PosLifecycleStatus, QuestionnaireAnswers } from "./types";

export type ConfigurationRecord = {
  id: string;
  businessId: string;
  status: PosLifecycleStatus;
  answers: QuestionnaireAnswers;
  draft: PosConfiguration;
  published: PosConfiguration | null;
  draftVersion: number;
  publishedVersion: number;
  fingerprint: string;
  updatedAt: Date;
  publishedAt: Date | null;
};

const DRAFT_STATUS: PosLifecycleStatus = "DRAFT";

function parseJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toRecord(row: any): ConfigurationRecord | null {
  if (!row) return null;
  const answers = (parseJson(row.answersJson) ?? {}) as QuestionnaireAnswers;
  const draft = normalizeConfiguration(parseJson(row.draftJson));
  const publishedRaw = parseJson(row.publishedJson);
  return {
    id: row.id,
    businessId: row.businessId,
    status: (row.status ?? DRAFT_STATUS) as PosLifecycleStatus,
    answers,
    draft,
    published: publishedRaw ? normalizeConfiguration(publishedRaw) : null,
    draftVersion: Number(row.draftVersion ?? 1),
    publishedVersion: Number(row.publishedVersion ?? 0),
    fingerprint: String(row.fingerprint ?? configurationFingerprint(draft)),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt ?? Date.now()),
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
  };
}

/** The configuration the POS should execute: published when live, otherwise the draft (§44). */
export function effectiveConfiguration(record: ConfigurationRecord | null, lifecycle: PosLifecycleStatus): PosConfiguration | null {
  if (!record) return null;
  if (lifecycle === "LIVE" && record.published) return record.published;
  return record.draft;
}

export async function loadConfiguration(businessId: string): Promise<ConfigurationRecord | null> {
  const row = await prisma.posConfiguration.findUnique({ where: { businessId } });
  return toRecord(row);
}

export type SaveDraftResult = {
  record: ConfigurationRecord;
  readiness: ReturnType<typeof configurationReadiness>;
  validation: ReturnType<typeof validateConfiguration>;
  changed: boolean;
};

/**
 * Autosave (§9). Answers are sanitized, pruned of anything no longer relevant (§40), turned
 * into a configuration and stored as a draft. A draft is never a live POS (§44).
 */
export async function saveDraft(params: {
  businessId: string;
  answers: unknown;
  actorId: string;
  context?: BuildContext;
  /** The owner's own words for things (§46) — validated, presentation-only. */
  terminology?: Record<string, string> | null;
}): Promise<SaveDraftResult> {
  const answers = pruneAnswers(sanitizeAnswers(params.answers));
  const built = finalize(buildConfiguration(answers, params.context ?? {}));
  const configuration = finalize(applyTerminologyOverrides(built, params.terminology));
  const readiness = configurationReadiness(answers);
  const validation = validateConfiguration(configuration);
  const fingerprint = configurationFingerprint(configuration);
  const existing = await prisma.posConfiguration.findUnique({ where: { businessId: params.businessId } });
  const previous = toRecord(existing);
  const status: PosLifecycleStatus = previous && isPostPaymentStatus(previous.status)
    ? previous.status
    : readiness.ready && validation.ok
      ? "CONFIGURED"
      : previous?.status === "PREVIEW"
        ? "PREVIEW"
        : DRAFT_STATUS;

  const data = {
    businessId: params.businessId,
    status,
    answersJson: JSON.stringify(answers),
    draftJson: JSON.stringify(configuration),
    draftVersion: previous && previous.fingerprint !== fingerprint ? previous.draftVersion + 1 : previous?.draftVersion ?? 1,
    fingerprint,
    configurationStatus: readiness.ready && validation.ok ? "READY" : "INCOMPLETE",
  };

  const row = existing
    ? await prisma.posConfiguration.update({ where: { businessId: params.businessId }, data })
    : await prisma.posConfiguration.create({ data: { ...data, publishedVersion: 0 } as never });

  const record = toRecord(row)!;
  const changed = !previous || previous.fingerprint !== fingerprint;
  if (changed) {
    await logPosAudit({
      businessId: params.businessId,
      actorId: params.actorId,
      action: "POS_CONFIGURATION_SAVED",
      targetType: "POS_CONFIGURATION",
      targetId: record.id,
      metadata: { version: record.draftVersion, status, ready: readiness.ready },
    });
  }
  return { record, readiness, validation, changed };
}

function isPostPaymentStatus(status: PosLifecycleStatus): boolean {
  return status === "PAYMENT_CONFIRMED" || status === "PROVISIONING" || status === "LIVE" || status === "SUSPENDED";
}

/** Entering preview (§23). Preview never writes business data — it only marks intent (§44). */
export async function markPreview(businessId: string, actorId: string): Promise<ConfigurationRecord | null> {
  const record = await loadConfiguration(businessId);
  if (!record) return null;
  if (isPostPaymentStatus(record.status)) return record;
  // §4, §44: the journey runs configure → preview → plan, so a draft that has a configuration
  // must be previewable. Without DRAFT here the PREVIEW state was unreachable: `saveDraft` stores
  // a draft, and the owner would go straight from DRAFT to AWAITING_PAYMENT.
  const previewable = record.status === "DRAFT" || record.status === "CONFIGURED" || record.status === "AWAITING_PAYMENT";
  const status: PosLifecycleStatus = previewable ? "PREVIEW" : record.status;
  const row = await prisma.posConfiguration.update({ where: { businessId }, data: { status } });
  await logPosAudit({ businessId, actorId, action: "POS_PREVIEW_OPENED", targetType: "POS_CONFIGURATION", targetId: record.id });
  return toRecord(row);
}

/** Choose plan (§43). Only a complete configuration may ask for payment. */
export async function markAwaitingPayment(businessId: string, actorId: string): Promise<{ ok: boolean; record: ConfigurationRecord | null; reason?: string }> {
  const record = await loadConfiguration(businessId);
  if (!record) return { ok: false, record: null, reason: "Configure your POS first." };
  const validation = validateConfiguration(record.draft);
  if (!validation.ok) {
    return { ok: false, record, reason: validation.issues.find((issue) => issue.severity === "error")?.message ?? "Finish your configuration first." };
  }
  if (isPostPaymentStatus(record.status)) return { ok: true, record };
  const row = await prisma.posConfiguration.update({ where: { businessId }, data: { status: "AWAITING_PAYMENT" } });
  await logPosAudit({ businessId, actorId, action: "POS_PLAN_SELECTED", targetType: "POS_CONFIGURATION", targetId: record.id, metadata: { planKey: POS_PLAN_KEY } });
  return { ok: true, record: toRecord(row) };
}

/**
 * Publish the draft configuration (§43, §48). Only allowed while the POS is live — an
 * unpaid configuration cannot become the operating profile of a business.
 */
export async function publishConfiguration(params: {
  businessId: string;
  actorId: string;
  note?: string;
}): Promise<{ ok: boolean; reason?: string; record: ConfigurationRecord | null; version?: number }> {
  const record = await loadConfiguration(params.businessId);
  if (!record) return { ok: false, reason: "Configure your POS first.", record: null };
  const validation = validateConfiguration(record.draft);
  if (!validation.ok) {
    return { ok: false, reason: validation.issues.find((issue) => issue.severity === "error")?.message ?? "Your configuration is incomplete.", record };
  }
  const entitlement = await syncPosEntitlement(params.businessId);
  if (!entitlement.entitled) {
    return { ok: false, reason: entitlement.reason, record };
  }
  const version = record.publishedVersion + 1;
  const row = await prisma.$transaction(async (tx: any) => {
    await tx.posConfigurationVersion.create({
      data: {
        businessId: params.businessId,
        configurationId: record.id,
        version,
        snapshotJson: JSON.stringify(record.draft),
        answersJson: JSON.stringify(record.answers),
        fingerprint: record.fingerprint,
        note: (params.note ?? "").slice(0, 240) || null,
        createdById: params.actorId,
      },
    });
    return tx.posConfiguration.update({
      where: { businessId: params.businessId },
      data: {
        publishedJson: JSON.stringify(record.draft),
        publishedVersion: version,
        publishedAt: new Date(),
        publishedById: params.actorId,
        status: "LIVE",
        configurationStatus: "PUBLISHED",
      },
    });
  });
  await logPosAudit({
    businessId: params.businessId,
    actorId: params.actorId,
    action: "POS_CONFIGURATION_PUBLISHED",
    targetType: "POS_CONFIGURATION",
    targetId: record.id,
    metadata: { version, summary: configurationSummary(record.draft).slice(0, 3) },
  });
  return { ok: true, record: toRecord(row), version };
}

export async function listVersions(businessId: string, limit = 20) {
  const rows = await prisma.posConfigurationVersion.findMany({
    where: { businessId },
    orderBy: { version: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true, version: true, note: true, fingerprint: true, publishedAt: true, createdById: true, snapshotJson: true },
  });
  return rows.map((row: any) => ({
    id: row.id,
    version: row.version,
    note: row.note ?? "",
    fingerprint: row.fingerprint ?? "",
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
    createdById: row.createdById ?? null,
    summary: configurationSummary(normalizeConfiguration(parseJson(row.snapshotJson))),
  }));
}

/**
 * Roll back to an earlier version (§48). This writes a *new* version containing the old
 * snapshot — history is never rewritten, so past transactions stay interpretable (§54).
 */
export async function rollbackToVersion(params: { businessId: string; versionId: string; actorId: string }): Promise<{ ok: boolean; reason?: string; version?: number }> {
  const record = await loadConfiguration(params.businessId);
  if (!record) return { ok: false, reason: "Configure your POS first." };
  const entitlement = await syncPosEntitlement(params.businessId);
  if (!entitlement.entitled) return { ok: false, reason: entitlement.reason };
  const target = await prisma.posConfigurationVersion.findFirst({ where: { id: params.versionId, businessId: params.businessId } });
  if (!target) return { ok: false, reason: "That version does not belong to this business." };
  const snapshot = normalizeConfiguration(parseJson((target as any).snapshotJson));
  const nextVersion = record.publishedVersion + 1;
  await prisma.$transaction(async (tx: any) => {
    await tx.posConfigurationVersion.create({
      data: {
        businessId: params.businessId,
        configurationId: record.id,
        version: nextVersion,
        snapshotJson: JSON.stringify(snapshot),
        answersJson: JSON.stringify(parseJson((target as any).answersJson) ?? {}),
        fingerprint: configurationFingerprint(snapshot),
        note: `Rolled back to version ${(target as any).version}`,
        createdById: params.actorId,
      },
    });
    await tx.posConfiguration.update({
      where: { businessId: params.businessId },
      data: {
        draftJson: JSON.stringify(snapshot),
        publishedJson: JSON.stringify(snapshot),
        draftVersion: record.draftVersion + 1,
        publishedVersion: nextVersion,
        publishedAt: new Date(),
        publishedById: params.actorId,
        status: "LIVE",
        configurationStatus: "PUBLISHED",
        fingerprint: configurationFingerprint(snapshot),
      },
    });
  });
  await logPosAudit({
    businessId: params.businessId,
    actorId: params.actorId,
    action: "POS_CONFIGURATION_ROLLED_BACK",
    targetType: "POS_CONFIGURATION",
    targetId: record.id,
    metadata: { fromVersion: (target as any).version, toVersion: nextVersion },
  });
  return { ok: true, version: nextVersion };
}

/**
 * Provisioning after confirmed payment (§43, §44): PAYMENT_CONFIRMED → PROVISIONING → LIVE.
 * Runs inside the settlement transaction so a paid business can never be left unpublished.
 */
export async function provisionAfterPayment(tx: any, params: { businessId: string; actorId: string | null }): Promise<void> {
  const row = await tx.posConfiguration.findUnique({ where: { businessId: params.businessId } });
  if (!row) return;
  const record = toRecord(row);
  if (!record) return;
  const validation = validateConfiguration(record.draft);
  const publishable = validation.ok;
  await tx.posConfiguration.update({
    where: { businessId: params.businessId },
    data: {
      status: "LIVE",
      configurationStatus: publishable ? "PUBLISHED" : "READY",
      ...(publishable
        ? {
            publishedJson: JSON.stringify(record.draft),
            publishedVersion: record.publishedVersion + 1,
            publishedAt: new Date(),
            publishedById: params.actorId,
          }
        : {}),
    },
  });
  if (publishable) {
    await tx.posConfigurationVersion.create({
      data: {
        businessId: params.businessId,
        configurationId: record.id,
        version: record.publishedVersion + 1,
        snapshotJson: JSON.stringify(record.draft),
        answersJson: JSON.stringify(record.answers),
        fingerprint: record.fingerprint,
        note: "Activated by subscription payment",
        createdById: params.actorId,
      },
    });
  }
  await tx.posAuditEvent.create({
    data: {
      businessId: params.businessId,
      actorId: params.actorId,
      action: "POS_PROVISIONED",
      targetType: "POS_CONFIGURATION",
      targetId: record.id,
      metadata: JSON.stringify({ published: publishable, version: record.publishedVersion + 1 }),
    },
  });
}

export async function suspendPos(businessId: string, actorId: string | null, reason: string): Promise<void> {
  await prisma.posConfiguration.updateMany({ where: { businessId }, data: { status: "SUSPENDED" } });
  await prisma.posSubscription.updateMany({ where: { businessId }, data: { status: "SUSPENDED" } });
  await logPosAudit({ businessId, actorId, action: "POS_SUSPENDED", targetType: "BUSINESS", targetId: businessId, metadata: { reason } });
}

export async function cancelPos(businessId: string, actorId: string | null): Promise<void> {
  await prisma.posSubscription.updateMany({ where: { businessId }, data: { status: "CANCELLED" } });
  await prisma.posConfiguration.updateMany({ where: { businessId }, data: { status: "CANCELLED" } });
  await logPosAudit({ businessId, actorId, action: "POS_CANCELLED", targetType: "BUSINESS", targetId: businessId });
}

/**
 * Save a configuration as the owner's own template (§26). Only configuration is stored —
 * never balances, transactions or credentials, which `assertCloneSafety` would refuse anyway.
 */
export async function saveTemplate(params: { businessId: string; actorId: string; name: string }): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const record = await loadConfiguration(params.businessId);
  if (!record) return { ok: false, reason: "Configure your POS first." };
  // The owner's own words win; only a nameless save is labelled for them (§26, §51).
  const supplied = typeof params.name === "string" ? params.name.trim() : "";
  const name = (supplied || `${record.draft.business.name || "My business"} setup`).slice(0, 80);
  const row = await prisma.posTemplate.create({
    data: {
      ownerId: params.actorId,
      businessId: params.businessId,
      key: `custom_${Date.now().toString(36)}`,
      name,
      description: `Saved from ${record.draft.business.typeLabel || record.draft.business.typeKey}`,
      businessTypeKey: record.draft.business.typeKey,
      configurationJson: JSON.stringify(record.draft),
      answersJson: JSON.stringify(record.answers),
    },
    select: { id: true },
  });
  await logPosAudit({ businessId: params.businessId, actorId: params.actorId, action: "POS_TEMPLATE_SAVED", targetType: "POS_TEMPLATE", targetId: row.id, metadata: { name } });
  return { ok: true, id: row.id };
}

/**
 * Copy a configuration onto another business the same user owns (§25, §50, test matrix P).
 * Structure only: the target keeps its own identity, balances and history.
 */
export async function copyConfigurationTo(params: {
  sourceBusinessId: string;
  targetBusinessId: string;
  actorId: string;
  /** The authenticated session: ownership of the target is proved here, never assumed (§5). */
  session: SessionPayload;
  scope: string[];
}): Promise<{ ok: boolean; reason?: string; code?: string }> {
  if (params.sourceBusinessId === params.targetBusinessId) return { ok: false, reason: "Choose a different business to copy into." };
  try {
    await assertBusinessOwnership(params.sourceBusinessId, params.session);
    await assertBusinessOwnership(params.targetBusinessId, params.session);
  } catch {
    // Same answer for "not yours" and "does not exist" (§56) — but the route still needs to know
    // this was an authorization refusal, not a bad form (§5, §75).
    return { ok: false, reason: SAFE_ERRORS.noAccess, code: "NOT_ALLOWED" };
  }
  const source = await loadConfiguration(params.sourceBusinessId);
  if (!source) return { ok: false, reason: "That business has no configuration to copy." };
  const target = await loadConfiguration(params.targetBusinessId);
  if (target && target.publishedVersion > 0) {
    return { ok: false, reason: "That business already has a live POS. Edit its configuration instead of overwriting it." };
  }
  // Only scopes this product defines may be copied (§50). An invented scope is refused outright
  // rather than quietly dropped: silently ignoring "copy the sales too" would leave an owner
  // believing operational data had been carried across when it never may be (§25, §50).
  const allowed = new Set(CLONE_SCOPES.map((entry) => entry.key));
  const requested = params.scope ?? [];
  const refused = requested.filter((entry) => !allowed.has(entry as CloneScopeKey));
  if (refused.length) {
    return {
      ok: false,
      code: "CLONE_SCOPE_REFUSED",
      reason: `Only the setup can be copied — ${refused.slice(0, 3).join(", ")} stays with the original business. Transactions, balances, receipt numbers and sign-in details are never copied.`,
    };
  }
  const scope = requested.filter((entry): entry is CloneScopeKey => allowed.has(entry as CloneScopeKey));
  const cloned = cloneConfiguration(source.draft, scope.length ? scope : undefined);
  cloned.business.name = "";
  cloned.business.branchName = "";
  cloned.receipt.businessName = "";
  const answers = pruneAnswers(sanitizeAnswers({ business_type: cloned.business.typeKey }));
  await prisma.posConfiguration.upsert({
    where: { businessId: params.targetBusinessId },
    update: {
      draftJson: JSON.stringify(cloned),
      answersJson: JSON.stringify(answers),
      fingerprint: configurationFingerprint(cloned),
      status: "CONFIGURED",
      configurationStatus: "READY",
      draftVersion: (target?.draftVersion ?? 0) + 1,
    },
    create: {
      businessId: params.targetBusinessId,
      draftJson: JSON.stringify(cloned),
      answersJson: JSON.stringify(answers),
      fingerprint: configurationFingerprint(cloned),
      status: "CONFIGURED",
      configurationStatus: "READY",
      draftVersion: 1,
      publishedVersion: 0,
    } as never,
  });
  await logPosAudit({
    businessId: params.targetBusinessId,
    actorId: params.actorId,
    action: "POS_CONFIGURATION_COPIED",
    targetType: "POS_CONFIGURATION",
    targetId: params.targetBusinessId,
    metadata: { sourceBusinessId: params.sourceBusinessId, scope: params.scope },
  });
  return { ok: true };
}

/** Lifecycle status combining configuration state and entitlement (§44). */
export async function posLifecycle(businessId: string): Promise<{
  lifecycle: PosLifecycleStatus;
  entitled: boolean;
  reason: string;
  nextAction: "configure" | "preview" | "pay" | "renew" | "none";
  record: ConfigurationRecord | null;
}> {
  const [record, entitlement] = await Promise.all([loadConfiguration(businessId), syncPosEntitlement(businessId)]);
  // The entitlement is authoritative: `derivePosEntitlement` never reports LIVE without payment
  // evidence, so a stored "LIVE" on a configuration row cannot bring a POS back to life (§44).
  const lifecycle = entitlement.lifecycle;
  return { lifecycle, entitled: entitlement.entitled, reason: entitlement.reason, nextAction: entitlement.nextAction, record };
}
