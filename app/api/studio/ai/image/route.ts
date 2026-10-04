/**
 * Create website images with JATA AI (§11–§17, §41, §51)
 *
 * Server-authoritative on every axis that matters:
 *   • the business must belong to the signed-in user (ownership check before any read),
 *   • the quota and the per-business cooldown are enforced here, not in the UI,
 *   • the subject is re-read from the database by id, scoped to the business, so a client can
 *     never name another tenant's product,
 *   • an identical instruction inside the cache window is served from the generation history
 *     instead of calling a provider again.
 *
 * The response contains candidates only. Applying one to a product or a section is a separate,
 * explicit owner action (§5, §15).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { rateLimit } from "@/lib/rate-limit";
import { generateStudioImages } from "@/lib/ai/imageLab";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  // Cost control at the edge: a phone double-tapping "Create" must not buy four images (§51).
  const limit = rateLimit(req, { key: "studio-ai-image", max: 12, windowMs: 60_000 });
  if (!limit.allowed) return limit.response!;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "We couldn't read that request." }, { status: 400 });
  }

  const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
  const guard = await guardTenantMutation(session, businessId, "configure");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const preset = typeof body?.preset === "string" ? body.preset.slice(0, 40) : "product-photo";
  const subjectType = typeof body?.subjectType === "string" ? (body.subjectType.toUpperCase() as "PRODUCT" | "SERVICE" | "SECTION" | "LOGO" | "BUSINESS") : null;
  const subjectId = typeof body?.subjectId === "string" ? body.subjectId.slice(0, 60) : null;

  try {
    const outcome = await generateStudioImages({
      businessId,
      userId: session.userId,
      preset,
      style: typeof body?.style === "string" ? body.style.slice(0, 40) : null,
      placement: typeof body?.placement === "string" ? (body.placement as any) : null,
      subjectType: subjectType && ["PRODUCT", "SERVICE", "SECTION", "LOGO", "BUSINESS"].includes(subjectType) ? subjectType : null,
      subjectId,
      subjectName: typeof body?.subjectName === "string" ? body.subjectName.slice(0, 120) : null,
      subjectDescription: typeof body?.subjectDescription === "string" ? body.subjectDescription.slice(0, 400) : null,
      ownerNotes: typeof body?.ownerNotes === "string" ? body.ownerNotes.slice(0, 300) : null,
      referenceDataUrl: typeof body?.referenceDataUrl === "string" && body.referenceDataUrl.startsWith("data:image/") ? body.referenceDataUrl : null,
      count: Number(body?.count) || 2,
      refresh: body?.refresh === true,
    });

    if (outcome.status !== "ok") {
      return NextResponse.json({ error: outcome.error, code: outcome.code, retryable: outcome.retryable }, { status: outcome.httpStatus });
    }
    return NextResponse.json({
      generationId: outcome.generationId,
      provider: outcome.provider,
      cached: outcome.cached,
      assets: outcome.assets,
      notes: outcome.notes,
      quota: outcome.quota,
      // Repeated here so the UI can state it plainly next to the images (§15).
      representative: outcome.assets.some((asset) => asset.label === "REPRESENTATIVE"),
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("studio image generation failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
