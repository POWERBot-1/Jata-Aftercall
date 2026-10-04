/**
 * Generation persistence (§41, §43, §51)
 *
 * Every AI call leaves a row: who asked, for which business, which subject, which provider and
 * model, how long it took and what came out. The row is the audit trail *and* the usage meter,
 * and because it names the assets it produced, deleting a generation deletes exactly what it
 * created — nothing else, and nothing belonging to another tenant.
 *
 * All access is `businessId`-scoped; no function here accepts a business id from the client
 * without the caller having checked ownership first.
 */

import crypto from "crypto";
import prisma from "../db";

export type GenerationKind = "IMAGE" | "ENHANCE" | "COPY" | "ALT_TEXT";
export type GenerationStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED";

export type GenerationRecordInput = {
  businessId: string;
  userId?: string | null;
  kind: GenerationKind;
  capability?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  prompt: string;
  providerKey: string;
  modelKey?: string | null;
};

/** Stable hash of the exact instruction, used to serve a repeat request from cache. */
export function promptHash(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 32);
}

function model(): any {
  return (prisma as any)?.aiGeneration;
}

export async function startGeneration(input: GenerationRecordInput): Promise<{ id: string } | null> {
  const delegate = model();
  if (!delegate?.create) return null;
  try {
    const row = await delegate.create({
      data: {
        businessId: input.businessId,
        userId: input.userId ?? null,
        kind: input.kind,
        capability: input.capability ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        prompt: input.prompt.slice(0, 4000),
        promptHash: promptHash(input.prompt),
        providerKey: input.providerKey,
        modelKey: input.modelKey ?? null,
        status: "PENDING" as GenerationStatus,
      },
      select: { id: true },
    });
    return row?.id ? { id: row.id } : null;
  } catch {
    // Generation must still work when the audit table is unavailable (offline builds, mocks);
    // the caller records the outcome best-effort.
    return null;
  }
}

export async function finishGeneration(input: {
  id: string | null;
  status: GenerationStatus;
  assetIds?: string[];
  selectedAssetId?: string | null;
  durationMs?: number;
  errorCode?: string | null;
}): Promise<void> {
  if (!input.id) return;
  const delegate = model();
  if (!delegate?.update) return;
  try {
    await delegate.update({
      where: { id: input.id },
      data: {
        status: input.status,
        assetIds: input.assetIds && input.assetIds.length > 0 ? JSON.stringify(input.assetIds) : null,
        selectedAssetId: input.selectedAssetId ?? null,
        durationMs: typeof input.durationMs === "number" ? Math.min(600_000, Math.max(0, Math.round(input.durationMs))) : null,
        errorCode: input.errorCode ? String(input.errorCode).slice(0, 60) : null,
        completedAt: new Date(),
      },
    });
  } catch {
    // Never fail a completed generation because of telemetry (§39: the owner's work is safe).
  }
}

/** Most recent generation for one business, used for the rate limiter and the history panel. */
export async function latestGeneration(businessId: string, kind?: GenerationKind): Promise<{ id: string; createdAt: Date; kind: string } | null> {
  const delegate = model();
  if (!delegate?.findFirst) return null;
  try {
    return await delegate.findFirst({
      where: kind ? { businessId, kind } : { businessId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, kind: true },
    });
  } catch {
    return null;
  }
}

/** Successful generations in the current period — the usage meter (§17). */
export async function usageRecords(businessId: string, since: Date): Promise<Array<{ kind: string; status: string; createdAt: Date; assetIds?: string | null }>> {
  const delegate = model();
  if (!delegate?.findMany) return [];
  try {
    const rows = await delegate.findMany({
      where: { businessId, createdAt: { gte: since } },
      select: { kind: true, status: true, createdAt: true, assetIds: true },
      take: 2000,
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Cache lookup: an identical instruction from the same business (same item, same preset, same
 * style) returns the images it already produced instead of paying a provider again (§51).
 */
export async function findCachedGeneration(input: {
  businessId: string;
  hash: string;
  kind: GenerationKind;
  withinMs: number;
}): Promise<{ id: string; assetIds: string[] } | null> {
  const delegate = model();
  if (!delegate?.findFirst) return null;
  const since = new Date(Date.now() - input.withinMs);
  try {
    const row = await delegate.findFirst({
      where: { businessId: input.businessId, promptHash: input.hash, kind: input.kind, status: "SUCCEEDED", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { id: true, assetIds: true },
    });
    if (!row?.assetIds) return null;
    const ids = JSON.parse(String(row.assetIds));
    return Array.isArray(ids) && ids.length > 0 ? { id: row.id, assetIds: ids.map(String) } : null;
  } catch {
    return null;
  }
}

export type GenerationHistoryEntry = {
  id: string;
  kind: string;
  status: string;
  providerKey: string;
  modelKey: string | null;
  capability: string | null;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
  durationMs: number | null;
  errorCode: string | null;
  assetIds: string[];
  selectedAssetId: string | null;
};

export async function generationHistory(businessId: string, limit = 40): Promise<GenerationHistoryEntry[]> {
  const delegate = model();
  if (!delegate?.findMany) return [];
  try {
    const rows = await delegate.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(100, limit)),
      select: {
        id: true, kind: true, status: true, providerKey: true, modelKey: true, capability: true,
        subjectType: true, subjectId: true, createdAt: true, durationMs: true, errorCode: true,
        assetIds: true, selectedAssetId: true,
      },
    });
    return (Array.isArray(rows) ? rows : []).map((row: any) => ({
      id: String(row.id),
      kind: String(row.kind),
      status: String(row.status),
      providerKey: String(row.providerKey || "jata-local"),
      modelKey: row.modelKey ? String(row.modelKey) : null,
      capability: row.capability ? String(row.capability) : null,
      subjectType: row.subjectType ? String(row.subjectType) : null,
      subjectId: row.subjectId ? String(row.subjectId) : null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      durationMs: typeof row.durationMs === "number" ? row.durationMs : null,
      errorCode: row.errorCode ? String(row.errorCode) : null,
      assetIds: parseIdList(row.assetIds),
      selectedAssetId: row.selectedAssetId ? String(row.selectedAssetId) : null,
    }));
  } catch {
    return [];
  }
}

function parseIdList(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
