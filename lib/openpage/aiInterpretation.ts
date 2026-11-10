import "server-only";

/**
 * Optional server-side interpretation of an owner's brief.
 *
 * JATA's approved provider registry is the only route to a model. There is no browser key,
 * no direct vendor URL and no new secret: when no provider is configured (or the call
 * fails), the deterministic requirements remain the whole answer.
 *
 * The model is asked for a short *creative direction note only*. It cannot choose prices,
 * contact details, structure, or facts, and its output is passed through JATA's grounding
 * filter before it is shown.
 */

import { resolveProvider } from "@/lib/ai/registry";
import { buildDesignContext } from "@/lib/ai/designContext";
import { filterGroundedTexts } from "@/lib/ai/grounding";
import { sanitizeText } from "@/lib/validation";
import type { StudioBusinessFacts, StudioRequirements } from "./requirements";

export type AiInterpretation = {
  note: string;
  provider: { key: string; label: string; modelKey: string };
  usedModel: boolean;
};

export async function interpretDesignBrief(params: {
  businessId: string;
  prompt: string;
  facts: StudioBusinessFacts;
  requirements: StudioRequirements;
}): Promise<AiInterpretation | null> {
  let provider;
  try {
    provider = resolveProvider("text");
  } catch {
    return null;
  }
  // The built-in provider has no model. The deterministic composer is the complete answer;
  // calling it here would double the work for no gain.
  if (!provider.capabilities.configured || provider.key === "jata-local") {
    return { note: "", provider: { key: provider.key, label: provider.label, modelKey: provider.modelKey }, usedModel: false };
  }

  const factual = [
    params.facts.name,
    params.facts.description,
    params.facts.location,
    params.requirements.businessType.label,
    params.requirements.summary,
  ].filter((value): value is string => Boolean(value && String(value).trim()));

  const design = buildDesignContext({
    businessName: params.facts.name,
    categoryKey: params.requirements.businessType.categoryKey,
  });

  try {
    const result = await provider.generateText(
      {
        kind: "DESIGN_DIRECTION",
        system:
          "You are a website art director for small Kenyan businesses. Reply with one short design direction sentence (max 180 characters). " +
          "Do not state facts, prices, offers, guarantees, awards, opening hours, contact details, testimonials or statistics. " +
          "Describe only mood, colour, spacing and imagery style. Return JSON {\"options\":[\"…\"]} with exactly one option.",
        prompt: `Owner brief: ${params.prompt.slice(0, 900)}\nDeterministic direction: ${params.requirements.summary}\nFACTS:\n${factual.join("\n")}`,
        maxChars: 180,
        facts: factual,
        design,
        count: 1,
        seed: `${params.businessId}:understand`,
      },
      { businessId: params.businessId, generationId: "openpage-understand", timeoutMs: 8_000 },
    );
    const { accepted } = filterGroundedTexts(result.texts, factual);
    const note = sanitizeText(accepted[0] || "", 180);
    return {
      note,
      provider: { key: provider.key, label: provider.label, modelKey: provider.modelKey },
      usedModel: !result.deterministic,
    };
  } catch {
    // A provider outage must never block prompt-to-site. The deterministic path answers.
    return null;
  }
}
