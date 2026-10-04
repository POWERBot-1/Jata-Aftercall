/**
 * AI generation history (§43)
 *
 * The owner can see what JATA created, when, with what, and — importantly — delete it. Deleting
 * a generation removes exactly the media assets it produced for that business, and nothing else.
 * Everything is scoped by a stored row's `businessId`, never by a client-supplied one.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { generationHistory } from "@/lib/ai/generationStore";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const businessId = params.get("businessId")?.trim() || "";
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const limit = Number(params.get("limit")) || 40;
    const entries = await generationHistory(businessId, limit);
    return NextResponse.json({ generations: entries });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ error: "Choose a generation to remove." }, { status: 400 });

  try {
    const generation = await prisma.aiGeneration.findUnique({ where: { id }, select: { id: true, businessId: true, assetIds: true } });
    if (!generation) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, generation.businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const assetIds: string[] = (() => {
      try {
        const parsed = JSON.parse(String(generation.assetIds || "[]"));
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    })();

    // Remove the images this generation created, then the record itself.
    const removed = assetIds.length
      ? await prisma.mediaAsset.deleteMany({ where: { businessId: generation.businessId, id: { in: assetIds } } })
      : { count: 0 };
    await prisma.aiGeneration.delete({ where: { id } });
    await logAudit({
      actorId: session.userId,
      action: "AI_GENERATION_DELETED",
      targetType: "AI_GENERATION",
      targetId: id,
      metadata: { businessId: generation.businessId, assets: removed?.count ?? 0 },
    });
    return NextResponse.json({ ok: true, removed: removed?.count ?? 0 });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
