/**
 * Layout variants for Website Studio (Immersive Website Engine, Phase 3)
 *
 * POST { businessId, seed? } → a candidate experience, compared against this business's own
 * recent published layouts and its current draft. It is a PREVIEW ONLY: this route never writes
 * the draft. The owner applies a candidate through the existing draft write path, which records
 * a revision so Undo still works and the previous draft is kept.
 *
 * Tenant scope: the business is authorised with guardTenantMutation, and history is read only
 * for that businessId. No other tenant's experiences are read or compared.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { SAFE_ERRORS } from "@/lib/safeError";
import { normalizeExperienceDocument } from "@/lib/experience/document";
import { generateGatedVariant } from "@/lib/experience/variant";
import { DEFAULT_DIVERSITY_THRESHOLD } from "@/lib/experience/diversity";
import type { ExperienceDocument } from "@/lib/experience/types";

export const dynamic = "force-dynamic";

const RECENT_LIMIT = 5;

function cleanSeed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^a-zA-Z0-9:|#_-]/g, "").slice(0, 80);
  return cleaned.length >= 4 ? cleaned : null;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const experience = await prisma.businessExperience.findUnique({
      where: { businessId },
      select: { draftJson: true, categoryKey: true, draftVersion: true },
    });
    if (!experience) return NextResponse.json({ error: "Create your website before generating a layout." }, { status: 409 });

    const current = normalizeExperienceDocument(JSON.parse(experience.draftJson || "{}"), experience.categoryKey);

    // The business's own published history only. Scoped by businessId, never by name or category.
    const versions = await prisma.experienceVersion.findMany({
      where: { businessId },
      orderBy: { version: "desc" },
      take: RECENT_LIMIT,
      select: { snapshotJson: true },
    });
    const recent: ExperienceDocument[] = versions.map((row) => {
      try {
        return normalizeExperienceDocument(JSON.parse(row.snapshotJson || "{}"), current.categoryKey);
      } catch {
        return normalizeExperienceDocument({}, current.categoryKey);
      }
    });

    // A client may pass a seed to reproduce or continue a sequence. Without one, the seed is
    // derived from the draft version, so repeated calls for the same draft return the same candidate.
    const baseSeed = cleanSeed(body?.seed) ?? `${businessId}:${experience.draftVersion}`;

    const result = generateGatedVariant({
      document: current,
      baseSeed,
      recent,
      threshold: DEFAULT_DIVERSITY_THRESHOLD,
    });

    return NextResponse.json({
      // Preview only. Nothing has been saved.
      candidate: result.document,
      saved: false,
      accepted: result.accepted,
      seed: result.seed,
      report: {
        threshold: result.report.threshold,
        maxSimilarity: result.report.maxSimilarity,
        closestIndex: result.report.closestIndex,
      },
      attempts: result.attempts.map((attempt) => ({ attempt: attempt.attempt, maxSimilarity: attempt.maxSimilarity, ok: attempt.ok })),
      change: result.change,
      comparedWith: recent.length,
    });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
