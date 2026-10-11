/**
 * Draft history API — Undo, Redo and recovery (§45)
 *
 * The owner can step backwards and forwards through everything they have changed, and can jump
 * straight back to an older revision. History is draft-only: nothing here publishes, and nothing
 * here can reach another tenant's business.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { historyState, loadDraftHistory, moveDraftHistory, revisionSummaries } from "@/lib/experience/history";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const [experience, revisions] = await Promise.all([
      prisma.businessExperience.findUnique({
        where: { businessId },
        select: { draftVersion: true, historyCursor: true },
      }),
      loadDraftHistory(prisma, businessId),
    ]);
    const cursor = experience
      ? Number(experience.historyCursor) > 0
        ? Number(experience.historyCursor)
        : Number(experience.draftVersion) || 0
      : 0;
    const state = historyState(revisions, cursor);

    return NextResponse.json({
      ...state,
      // The row's version. Undo, redo and open-a-version send it back so a stale window cannot roll back newer edits.
      draftVersion: experience ? Number(experience.draftVersion) || null : null,
      revisions: revisionSummaries(revisions, cursor),
    });
  } catch {
    console.error("draft history read failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const guard = await guardTenantMutation(session, businessId, "configure");
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const rawVersion = Number(body?.version);
    const version = Number.isSafeInteger(rawVersion) && rawVersion > 0 ? rawVersion : null;
    const direction = body?.direction === "redo" ? "redo" : body?.direction === "undo" ? "undo" : null;
    if (!version && !direction) {
      return NextResponse.json({ error: "Choose Undo, Redo or a version to go back to." }, { status: 400 });
    }

    const expectedDraftVersion = Number(body?.expectedDraftVersion);
    const result = await moveDraftHistory(prisma, {
      businessId,
      direction: direction ?? "undo",
      version,
      expectedDraftVersion: Number.isInteger(expectedDraftVersion) && expectedDraftVersion > 0 ? expectedDraftVersion : null,
    });
    if (result.status === "conflict") {
      return NextResponse.json({ error: result.reason, code: "draft_version_conflict", unchanged: true }, { status: 409 });
    }
    if (result.status === "missing") return NextResponse.json({ error: result.reason }, { status: 409 });
    if (result.status === "unavailable") return NextResponse.json({ error: result.reason, unchanged: true }, { status: 409 });

    const revisions = await loadDraftHistory(prisma, businessId);
    // The cursor, not the new draft version: the draft now equals the restored revision.
    const state = historyState(revisions, result.cursor);

    await logAudit({
      actorId: session.userId,
      action: version ? "EXPERIENCE_DRAFT_VERSION_OPENED" : direction === "redo" ? "EXPERIENCE_DRAFT_REDO" : "EXPERIENCE_DRAFT_UNDO",
      targetType: "BUSINESS_EXPERIENCE",
      targetId: businessId,
      metadata: { businessId, draftVersion: result.draftVersion, label: result.label },
    });

    return NextResponse.json({
      document: result.document,
      draftVersion: result.draftVersion,
      label: result.label,
      message: result.message,
      unchanged: false,
      ...state,
      revisions: revisionSummaries(revisions, result.cursor),
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("draft history move failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
