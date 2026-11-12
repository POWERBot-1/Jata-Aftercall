/**
 * Native OpenPage generation adapter.
 *
 * OpenPage's browser-side Gemini key and standalone /api/generate endpoint are intentionally
 * not used. The editor requests a tenant-authorized candidate from JATA's existing deterministic
 * design engine and approved server-side AI provider registry.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertStudioWebsiteAccess } from "@/lib/experience/tenant";
import { getInteractiveEntitlement } from "@/lib/experience/entitlement";
import { rateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/db";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { loadStudioGenerationContext } from "@/lib/openpage/serverContext";
import { briefFromRequirements, understandBrief } from "@/lib/openpage/requirements";
import { generateStudioCandidates } from "@/lib/openpage/generate";
import { interpretDesignBrief } from "@/lib/openpage/aiInterpretation";
import { experienceToSiteConfig, siteConfigToExperience } from "@/lib/openpage/adapter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const limit = rateLimit(request, { key: "openpage-native-generate", max: 6, windowMs: 60_000 });
  if (!limit.allowed) return limit.response!;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "We couldn't read that website brief." }, { status: 400 });
  }
  const websiteId = typeof body.websiteId === "string" ? body.websiteId.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (!websiteId) return NextResponse.json({ error: "Choose a website first." }, { status: 400 });
  if (prompt.length < 8) return NextResponse.json({ error: "Describe the website you want to create." }, { status: 400 });

  try {
    const access = await assertStudioWebsiteAccess(websiteId, session, "edit");
    const entitlement = await getInteractiveEntitlement(access.businessId);
    if (!entitlement.entitled) {
      return NextResponse.json({ error: entitlement.reason, code: "website_studio_entitlement_required" }, { status: 402 });
    }

    const loaded = await loadStudioGenerationContext(access.businessId);
    if ("error" in loaded) {
      return NextResponse.json({ error: loaded.error, ...(loaded.code ? { code: loaded.code } : {}) }, { status: loaded.status });
    }
    const { context } = loaded;

    // Adapt the current native draft into JATA's guarded generation model before proposing
    // a replacement. Unsupported blocks are reported by the adapter; they are not silently
    // presented as retained native content.
    const nativeDocument = await prisma.openPageSiteDocument.findUnique({
      where: { websiteId: access.websiteId },
      select: { draftJson: true, draftVersion: true },
    });
    let baseDocument = context.baseDocument;
    let adapterNotes: string[] = [];
    if (nativeDocument?.draftJson) {
      try {
        const current = JSON.parse(nativeDocument.draftJson);
        const adapted = siteConfigToExperience(current, baseDocument, { applyTheme: true });
        baseDocument = adapted.document;
        adapterNotes = [
          ...adapted.unsupported.map((item) => item.message),
          ...adapted.retained.map((item) => item.reason),
        ].slice(0, 12);
      } catch {
        return NextResponse.json({
          error: "The current OpenPage draft could not be safely adapted for generation. Your saved draft is unchanged.",
          code: "openpage_generation_base_invalid",
        }, { status: 409 });
      }
    }

    const requirements = understandBrief(prompt, context.facts);
    const interpretation = await interpretDesignBrief({
      businessId: access.businessId,
      prompt,
      facts: context.facts,
      requirements,
    });
    if (interpretation?.note) {
      requirements.summary = `${requirements.summary} · creative direction: ${interpretation.note}`.slice(0, 500);
    }
    const brief = briefFromRequirements(requirements);
    const generated = generateStudioCandidates({
      baseDocument,
      businessId: access.businessId,
      requirements,
      brief,
      counts: { products: context.counts.products, services: context.counts.services },
      recent: context.recent,
      baseDraftVersion: nativeDocument?.draftVersion ?? context.draftVersion,
      seed: typeof body.seed === "string" && body.seed.trim() ? body.seed.trim().slice(0, 80) : undefined,
      maxCandidates: 1,
    });
    const candidate = generated.candidates[0];
    if (!candidate) return NextResponse.json({ error: "JATA could not create a safe website layout from this brief." }, { status: 422 });

    const adapted = experienceToSiteConfig(candidate.document, {
      businessName: context.business.name,
      seed: `${access.businessId}:native-openpage`,
    });
    return NextResponse.json({
      config: adapted.config,
      source: interpretation?.usedModel ? "ai" : "template",
      provider: interpretation?.provider ?? { key: "jata-local", label: "JATA built-in", modelKey: "deterministic-layout" },
      directionNote: interpretation?.note || null,
      notes: [...candidate.notes, ...adapterNotes, ...adapted.unsupported.map((item) => item.message)].slice(0, 20),
      saved: false,
      baseDraftVersion: nativeDocument?.draftVersion ?? 0,
      reviewPolicy: "Generated layout is a draft. Verify all business facts, product content, prices, contact details, images and claims before publishing.",
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("openpage native generation failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
