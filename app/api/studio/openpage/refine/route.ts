/**
 * Website Studio — conversational refinement.
 *
 * POST { businessId, message, document } → a refined candidate document.
 *
 * Preview-only. The submitted document is treated as untrusted: it is pinned to the
 * business's own category and normalized by the JATA schema before any instruction is
 * applied. The result is validated again. Prices, stock, payment settings and contact
 * details are absent from the action set, so no prompt can change them.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardStudioWebsiteMutation } from "@/lib/experience/ensure-default-website";
import { SAFE_ERRORS, publicErrorMessage } from "@/lib/safeError";
import { getExperienceProfile } from "@/lib/experience/categories";
import { validateExperienceDocument } from "@/lib/experience/schema";
import {
  DESIGN_AUDIENCES,
  DESIGN_DENSITIES,
  DESIGN_GOALS,
  DESIGN_PERSONALITIES,
} from "@/lib/experience/templateFamilies";
import { loadStudioGenerationContext } from "@/lib/openpage/serverContext";
import { understandBrief, type StudioRequirements } from "@/lib/openpage/requirements";
import { refineWebsite } from "@/lib/openpage/refine";

export const dynamic = "force-dynamic";

function parseRequirements(input: unknown, fallback: StudioRequirements): StudioRequirements {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const raw = input as Record<string, unknown>;
  const next = { ...fallback };
  if ((DESIGN_GOALS as readonly unknown[]).includes(raw.goal)) next.goal = raw.goal as StudioRequirements["goal"];
  if ((DESIGN_PERSONALITIES as readonly unknown[]).includes(raw.personality)) next.personality = raw.personality as StudioRequirements["personality"];
  if ((DESIGN_AUDIENCES as readonly unknown[]).includes(raw.audience)) next.audience = raw.audience as StudioRequirements["audience"];
  if ((DESIGN_DENSITIES as readonly unknown[]).includes(raw.density)) next.density = raw.density as StudioRequirements["density"];
  const profile = getExperienceProfile(fallback.businessType.categoryKey);
  if (next.goal === "sell" && !profile.capabilities.includes("commerce")) next.goal = fallback.goal;
  if (next.goal === "book" && !profile.capabilities.includes("booking")) next.goal = fallback.goal;
  return next;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "We couldn't read that message." }, { status: 400 });
  }

  const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
  const guard = await guardStudioWebsiteMutation(session, businessId, "read");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 800) : "";
  if (!message) return NextResponse.json({ error: "Tell JATA what you would like to change." }, { status: 400 });
  if (!body?.document || typeof body.document !== "object" || Array.isArray(body.document)) {
    return NextResponse.json({ error: "Choose a layout to refine first." }, { status: 400 });
  }

  try {
    const loaded = await loadStudioGenerationContext(businessId);
    if (loaded.ok === false) {
      return NextResponse.json({ error: loaded.error, ...(loaded.code ? { code: loaded.code } : {}) }, { status: loaded.status });
    }
    const { context } = loaded;

    // The tenant's recorded category is authoritative. A client cannot switch the site's
    // business type through a refinement payload.
    const candidate = validateExperienceDocument(
      { ...(body.document as Record<string, unknown>), categoryKey: context.business.categoryKey },
      { allowLegacy: true, fallbackCategory: context.business.categoryKey },
    );
    if (!candidate.ok) {
      return NextResponse.json(
        { error: "That website configuration is not supported. Nothing was changed.", code: "experience_schema_invalid", issues: candidate.issues },
        { status: 400 },
      );
    }

    const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1200) : message;
    const fallback = understandBrief(prompt, context.facts);
    const requirements = parseRequirements(body?.requirements, fallback);
    const seed = typeof body?.seed === "string" ? body.seed.slice(0, 80) : `${businessId}:refine`;

    const result = refineWebsite({
      document: candidate.document,
      message,
      requirements,
      seed,
    });

    return NextResponse.json({
      ...result,
      requirements,
      baseDraftVersion: context.draftVersion,
      saved: false,
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("openpage refine failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
