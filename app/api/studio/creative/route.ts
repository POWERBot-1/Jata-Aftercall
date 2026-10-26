/**
 * Creative command API (Website Studio creative engine).
 *
 * One endpoint behind the Create workspace:
 *
 *   GET  ?businessId=…                 → the truthful capability matrix for this deployment
 *   POST { businessId, instruction, mediaType?, referenceAssetId?, referenceDataUrl?, refresh? }
 *        → parses the instruction on the server (a client-supplied media type is a hint,
 *          never trusted alone), then answers with an honest job state:
 *            needs-input   essential information is missing — one follow-up question
 *            unsupported   media type (animation/video) has no provider adapter here
 *            unavailable   a provider or durable storage is not configured (503)
 *            completed     real assets were created by the existing Studio image lab
 *            failed        the provider call failed; safe to retry
 *
 * No placeholder asset is ever returned as a result. When generation is unavailable the
 * handler returns *before* any quota write, generation record or provider call — the same
 * fail-closed rule the image lab itself enforces. Tenant guard, rate limiting and size
 * limits mirror `/api/studio/ai/image`.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { rateLimit } from "@/lib/rate-limit";
import { parseCreativeInstruction, type CreativeMediaType } from "@/lib/creative/intent";
import { capabilityForMediaType, creativeCapabilities } from "@/lib/creative/capabilities";
import { enhanceStudioImage, generateStudioImages } from "@/lib/ai/imageLab";
import { MAX_UPLOAD_CHARS } from "@/lib/media/imageFormat";

export const dynamic = "force-dynamic";

const MEDIA_TYPES: CreativeMediaType[] = ["hero", "poster", "product", "banner", "edit", "animation", "video"];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  // Booleans and owner-facing sentences only — no keys, endpoints or account details.
  return NextResponse.json(creativeCapabilities());
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const limit = rateLimit(req, { key: "studio-creative", max: 12, windowMs: 60_000 });
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

  const instruction = typeof body?.instruction === "string" ? body.instruction.slice(0, 600) : "";
  const forced = MEDIA_TYPES.includes(body?.mediaType as CreativeMediaType) ? (body.mediaType as CreativeMediaType) : "auto";
  const referenceDataUrl =
    typeof body?.referenceDataUrl === "string" && body.referenceDataUrl.startsWith("data:image/")
      ? body.referenceDataUrl
      : null;
  if (referenceDataUrl && referenceDataUrl.length > MAX_UPLOAD_CHARS) {
    return NextResponse.json({ error: "That photo is too large to work with. Choose a smaller one, or improve it from Photos first." }, { status: 413 });
  }
  const hasReference = Boolean(referenceDataUrl) || typeof body?.referenceAssetId === "string";

  const intent = parseCreativeInstruction(instruction, { hasReferenceImage: hasReference, forcedMediaType: forced });
  const matrix = creativeCapabilities();
  const capability = capabilityForMediaType(intent.mediaType, matrix);

  if (intent.followUp) {
    return NextResponse.json({ status: "needs-input", intent, capability, followUp: intent.followUp });
  }

  if (intent.mediaType === "animation" || intent.mediaType === "video") {
    return NextResponse.json({
      status: "unsupported",
      intent,
      capability,
      suggestion: "JATA can make a vertical poster in the same shape today — change the type to Poster and generate that instead.",
    });
  }

  if (capability.state !== "available") {
    return NextResponse.json(
      { status: "unavailable", intent, capability, error: capability.reason, code: "creative_unavailable", retryable: false },
      { status: 503 },
    );
  }

  try {
    if (intent.mediaType === "edit") {
      if (!referenceDataUrl) {
        return NextResponse.json({
          status: "needs-input",
          intent,
          capability,
          followUp: "Choose the photo to improve from your gallery so JATA can edit that exact picture. Your original is always kept.",
        });
      }
      const outcome = await enhanceStudioImage({
        businessId,
        userId: session.userId,
        imageDataUrl: referenceDataUrl,
        assetId: typeof body?.referenceAssetId === "string" ? body.referenceAssetId.slice(0, 60) : null,
        mode: "provider",
        ownerNotes: instruction,
        applied: intent.editOperations,
      });
      if (outcome.status !== "ok") {
        return NextResponse.json(
          { status: "failed", intent, capability, error: outcome.error, code: outcome.code, retryable: outcome.retryable ?? true },
          { status: outcome.httpStatus },
        );
      }
      return NextResponse.json({ status: "completed", intent, capability, generationId: outcome.generationId, assets: outcome.assets, notes: outcome.notes, quota: outcome.quota });
    }

    const outcome = await generateStudioImages({
      businessId,
      userId: session.userId,
      preset: intent.preset,
      placement: intent.placement,
      subjectType: intent.mediaType === "hero" ? "BUSINESS" : "PRODUCT",
      subjectName: typeof body?.subjectName === "string" ? body.subjectName.slice(0, 120) : null,
      ownerNotes: instruction,
      referenceDataUrl,
      count: 2,
      refresh: body?.refresh === true,
    });
    if (outcome.status !== "ok") {
      return NextResponse.json(
        { status: outcome.httpStatus === 503 ? "unavailable" : "failed", intent, capability, error: outcome.error, code: outcome.code, retryable: outcome.retryable ?? true },
        { status: outcome.httpStatus },
      );
    }
    return NextResponse.json({
      status: "completed",
      intent,
      capability,
      generationId: outcome.generationId,
      provider: outcome.provider,
      cached: outcome.cached,
      assets: outcome.assets,
      notes: outcome.notes,
      quota: outcome.quota,
      representative: outcome.assets.some((asset) => asset.label === "REPRESENTATIVE"),
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("creative command failed");
    return NextResponse.json({ status: "failed", intent, capability, error: mapped.message, retryable: true }, { status: mapped.status });
  }
}
