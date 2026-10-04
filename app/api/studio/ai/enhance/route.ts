/**
 * Improve a photo (§14, §15)
 *
 * Two honest paths:
 *
 *   mode = "device"   — the owner's phone already applied a measured pixel-level improvement
 *                       (lighting, exposure, contrast, sharpness, crop). JATA records it as an
 *                       ENHANCED asset whose pixels are the owner's own product, so the product
 *                       identity is preserved by construction and the original is kept beside it.
 *
 *   mode = "provider" — an image provider edits the photo. JATA asks it to change only the
 *                       presentation and keep the product identical, stores the result *next to*
 *                       the original (never over it) and records that a vendor touched the image.
 *
 * If no image provider is connected, the provider path answers with a clear, actionable message
 * pointing at the on-device editor instead of failing silently (§39, §58).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { rateLimit } from "@/lib/rate-limit";
import { enhanceStudioImage } from "@/lib/ai/imageLab";
import { MAX_UPLOAD_CHARS } from "@/lib/media/imageFormat";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const limit = rateLimit(req, { key: "studio-ai-enhance", max: 12, windowMs: 60_000 });
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

  const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
  if (!imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Choose a photo to improve." }, { status: 400 });
  }
  if (imageDataUrl.length > MAX_UPLOAD_CHARS) {
    return NextResponse.json({ error: "That photo is too large to improve. JATA can optimize it on your phone first — try uploading it again." }, { status: 413 });
  }

  const mode = body?.mode === "provider" ? "provider" : "device";

  try {
    const outcome = await enhanceStudioImage({
      businessId,
      userId: session.userId,
      imageDataUrl,
      assetId: typeof body?.assetId === "string" ? body.assetId.slice(0, 60) : null,
      subjectType: typeof body?.subjectType === "string" ? (body.subjectType as any) : null,
      subjectId: typeof body?.subjectId === "string" ? body.subjectId.slice(0, 60) : null,
      mode,
      ownerNotes: typeof body?.ownerNotes === "string" ? body.ownerNotes.slice(0, 300) : null,
      applied: Array.isArray(body?.applied) ? (body.applied as string[]).map((entry) => String(entry).slice(0, 60)).slice(0, 6) : undefined,
      strength: typeof body?.strength === "string" ? body.strength.slice(0, 20) : null,
    });

    if (outcome.status !== "ok") {
      return NextResponse.json({ error: outcome.error, code: outcome.code, retryable: outcome.retryable }, { status: outcome.httpStatus });
    }
    return NextResponse.json({
      generationId: outcome.generationId,
      provider: outcome.provider,
      assets: outcome.assets,
      notes: outcome.notes,
      quota: outcome.quota,
      identityPreserved: true,
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("studio image enhancement failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
