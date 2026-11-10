/**
 * Website Studio — "understand my business" step.
 *
 * POST { businessId, prompt } → deterministic requirements + explicit gaps.
 * Preview-only: nothing is written. Tenant scope and role are enforced by the same
 * Studio guard used by every owner mutation/read.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardStudioWebsiteMutation } from "@/lib/experience/ensure-default-website";
import { SAFE_ERRORS, publicErrorMessage } from "@/lib/safeError";
import { loadStudioGenerationContext } from "@/lib/openpage/serverContext";
import { understandBrief, STUDIO_PROMPT_EXAMPLES } from "@/lib/openpage/requirements";
import { interpretDesignBrief } from "@/lib/openpage/aiInterpretation";

export const dynamic = "force-dynamic";

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
  const guard = await guardStudioWebsiteMutation(session, businessId, "read");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (prompt.length < 8) {
    return NextResponse.json({ error: "Describe your business and the customers you want to win (at least a sentence)." }, { status: 400 });
  }

  try {
    const loaded = await loadStudioGenerationContext(businessId);
    if (loaded.ok === false) {
      return NextResponse.json({ error: loaded.error, ...(loaded.code ? { code: loaded.code } : {}) }, { status: loaded.status });
    }
    const { context } = loaded;

    const requirements = understandBrief(prompt, context.facts);
    const interpretation = await interpretDesignBrief({ businessId, prompt, facts: context.facts, requirements });

    return NextResponse.json({
      requirements,
      examples: STUDIO_PROMPT_EXAMPLES,
      directionNote: interpretation?.note || null,
      provider: interpretation
        ? { key: interpretation.provider.key, label: interpretation.provider.label, modelKey: interpretation.provider.modelKey, usedModel: interpretation.usedModel }
        : { key: "jata-local", label: "JATA built-in", modelKey: null, usedModel: false },
      baseDraftVersion: context.draftVersion,
      hasExperience: context.hasExperience,
      published: context.business.isPublished,
      counts: context.counts,
      saved: false,
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("openpage understand failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
