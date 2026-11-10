/**
 * Website Studio — generate multiple distinct website layouts from one brief.
 *
 * POST { businessId, prompt, overrides? } → up to three materially distinct candidates.
 *
 * Preview-only. No draft, no published snapshot and no business row is written. Each
 * candidate is produced by JATA's existing art-direction engine, converted through the
 * OpenPage adapter, validated by the JATA Experience schema and returned for live preview.
 * The owner saves explicitly through the existing versioned draft API.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardStudioWebsiteMutation } from "@/lib/experience/ensure-default-website";
import { SAFE_ERRORS, publicErrorMessage } from "@/lib/safeError";
import { getExperienceProfile } from "@/lib/experience/categories";
import {
  DESIGN_AUDIENCES,
  DESIGN_DENSITIES,
  DESIGN_GOALS,
  DESIGN_PERSONALITIES,
} from "@/lib/experience/templateFamilies";
import { loadStudioGenerationContext } from "@/lib/openpage/serverContext";
import { briefFromRequirements, understandBrief, type StudioRequirements } from "@/lib/openpage/requirements";
import { generateStudioCandidates } from "@/lib/openpage/generate";
import { interpretDesignBrief } from "@/lib/openpage/aiInterpretation";

export const dynamic = "force-dynamic";

type Overrides = Partial<Pick<StudioRequirements, "goal" | "personality" | "audience" | "density">>;

function parseOverrides(input: unknown, requirements: StudioRequirements): Overrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const overrides: Overrides = {};
  const profile = getExperienceProfile(requirements.businessType.categoryKey);
  if ((DESIGN_GOALS as readonly unknown[]).includes(raw.goal)) {
    const goal = raw.goal as StudioRequirements["goal"];
    const allowed = goal !== "sell" || profile.capabilities.includes("commerce");
    const bookable = goal !== "book" || profile.capabilities.includes("booking");
    if (allowed && bookable) overrides.goal = goal;
  }
  if ((DESIGN_PERSONALITIES as readonly unknown[]).includes(raw.personality)) overrides.personality = raw.personality as StudioRequirements["personality"];
  if ((DESIGN_AUDIENCES as readonly unknown[]).includes(raw.audience)) overrides.audience = raw.audience as StudioRequirements["audience"];
  if ((DESIGN_DENSITIES as readonly unknown[]).includes(raw.density)) overrides.density = raw.density as StudioRequirements["density"];
  return overrides;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "We couldn't read that brief." }, { status: 400 });
  }

  const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
  // Generation reads tenant facts and candidate documents; it never writes.
  const guard = await guardStudioWebsiteMutation(session, businessId, "read");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (prompt.length < 8) {
    return NextResponse.json({ error: "Describe your business first, then generate layouts." }, { status: 400 });
  }

  try {
    const loaded = await loadStudioGenerationContext(businessId);
    if (loaded.ok === false) {
      return NextResponse.json({ error: loaded.error, ...(loaded.code ? { code: loaded.code } : {}) }, { status: loaded.status });
    }
    const { context } = loaded;

    const deterministic = understandBrief(prompt, context.facts);
    const overrides = parseOverrides(body?.overrides, deterministic);
    const requirements: StudioRequirements = { ...deterministic, ...overrides };
    const brief = briefFromRequirements(requirements);

    const result = generateStudioCandidates({
      baseDocument: context.baseDocument,
      businessId,
      requirements,
      brief,
      counts: { products: context.counts.products, services: context.counts.services },
      recent: context.recent,
      baseDraftVersion: context.draftVersion,
      seed: typeof body?.seed === "string" && body.seed.trim() ? body.seed.trim().slice(0, 80) : undefined,
    });

    const interpretation = await interpretDesignBrief({ businessId, prompt, facts: context.facts, requirements });

    return NextResponse.json({
      ...result,
      directionNote: interpretation?.note || null,
      provider: interpretation
        ? { key: interpretation.provider.key, label: interpretation.provider.label, modelKey: interpretation.provider.modelKey, usedModel: interpretation.usedModel }
        : { key: "jata-local", label: "JATA built-in", modelKey: null, usedModel: false },
      // Truthful scope: the gate compares against this business's own recent published
      // versions and the current draft only.
      comparedWith: context.recent.length,
      historyLimitation:
        context.recent.length === 0
          ? "There are no published versions to compare against yet, so the candidates were checked against your current draft and each other."
          : null,
      reviewPolicy:
        "Prices, stock, payments, contact details and opening hours are never generated. Generated testimonials, statistics and FAQ answers are not imported as facts.",
      saved: false,
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("openpage generate failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
