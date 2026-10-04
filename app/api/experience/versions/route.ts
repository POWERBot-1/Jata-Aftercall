/**
 * Publication versions (§15)
 *
 * Every publish snapshots the document. Rollback restores a previous version into the draft
 * so the owner can preview it and publish deliberately — publication is never automatic.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { normalizeExperienceDocument } from "@/lib/experience/document";
import { recordDraftRevision } from "@/lib/experience/history";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });
  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  try {
    const versions = await prisma.experienceVersion.findMany({
      where: { businessId },
      orderBy: { version: "desc" },
      take: 20,
      select: { id: true, version: true, themeKey: true, categoryKey: true, publishedAt: true, note: true },
    });
    return NextResponse.json({ versions });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const version = Math.round(Number(body?.version));
    if (!businessId || !Number.isSafeInteger(version)) {
      return NextResponse.json({ error: "Choose a version to restore." }, { status: 400 });
    }
    try {
      await assertBusinessOwnership(businessId, session);
    } catch (error) {
      const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    const snapshot = await prisma.experienceVersion.findUnique({
      where: { businessId_version: { businessId, version } },
    });
    if (!snapshot) return NextResponse.json({ error: "That version is no longer available." }, { status: 404 });
    const existing = await prisma.businessExperience.findUnique({
      where: { businessId },
      select: { draftVersion: true },
    });
    if (!existing) return NextResponse.json({ error: "Create your website before restoring a version." }, { status: 409 });

    const document = normalizeExperienceDocument(JSON.parse(snapshot.snapshotJson), snapshot.categoryKey);
    const nextVersion = Math.max(1, existing.draftVersion) + 1;
    const experience = await prisma.businessExperience.update({
      where: { businessId },
      data: {
        draftJson: JSON.stringify(document),
        draftVersion: nextVersion,
        historyCursor: nextVersion,
        categoryKey: snapshot.categoryKey,
        themeKey: snapshot.themeKey,
      },
      select: { id: true, draftVersion: true },
    });
    await recordDraftRevision(prisma, {
      businessId,
      draftVersion: nextVersion,
      document,
      label: `Restored your published version ${version}`,
      source: "RESTORE",
      createdById: session.userId,
    });
    await logAudit({
      actorId: session.userId,
      action: "EXPERIENCE_VERSION_RESTORED",
      targetType: "BUSINESS_EXPERIENCE",
      targetId: experience.id,
      metadata: { businessId, version },
    });

    return NextResponse.json({ document, draftVersion: experience.draftVersion, restored: true });
  } catch {
    console.error("version restore failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
