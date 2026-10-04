/**
 * AI copywriting pipeline (§10, §26, §27, §55)
 *
 * One path for every written suggestion in the Studio — product descriptions, homepage
 * headlines, About text, FAQ answers, SEO titles and descriptions, alt text and button labels.
 *
 *   facts in → provider (if configured) → grounding filter → suggestions out
 *
 * Three invariants:
 *   • Nothing is ever written to the catalogue here. The owner reviews and saves (§44, §45).
 *   • A sentence that asserts a fact the owner never supplied is dropped, not softened (§55).
 *   • When no provider is configured, or the provider fails, the deterministic composer answers
 *     instead — so the "Help me write this" button is never a dead end (§58).
 */

import { ASSIST_LABELS, suggestContent, type AssistKind, type AssistSuggestion } from "../experience/contentAssist";
import type { CategoryKey } from "../experience/types";
import { buildAltTextPrompt, buildCopyPrompt } from "./promptBuilder";
import { filterGroundedTexts } from "./grounding";
import { ProviderError, providerErrorMessage } from "./provider";
import { resolveProvider } from "./registry";
import { buildDesignContext, type DesignContext } from "./designContext";
import { finishGeneration, startGeneration } from "./generationStore";

export type CopyRequest = {
  businessId: string;
  userId?: string | null;
  kind: AssistKind;
  categoryKey?: CategoryKey | string | null;
  businessName?: string | null;
  subjectName?: string | null;
  description?: string | null;
  notes?: string | null;
  attributes?: string[];
  location?: string | null;
  question?: string | null;
  /** Brand + theme context, when the caller has the draft document loaded. */
  designContext?: DesignContext | null;
  /** Owner's tone of voice from the AI Front Desk configuration, when available. */
  toneOfVoice?: string | null;
  count?: number;
};

export type CopyOutcome = {
  kind: AssistKind;
  label: string;
  suggestions: AssistSuggestion[];
  requiresApproval: true;
  /** True when JATA's built-in composer answered instead of a model. */
  deterministic: boolean;
  provider: { key: string; label: string };
  /** How many candidate sentences were rejected by the grounding filter. */
  rejected: number;
  note: string;
};

/** The facts a suggestion is allowed to build on — nothing else may appear in the output. */
export function factsFor(request: CopyRequest): string[] {
  return [
    request.businessName,
    request.subjectName,
    request.description,
    request.notes,
    request.location,
    request.question,
    ...(request.attributes || []),
  ]
    .map((fact) => String(fact ?? "").replace(/\s+/g, " ").trim())
    .filter((fact) => fact.length > 0)
    .slice(0, 12);
}

function deterministicSuggestions(request: CopyRequest): AssistSuggestion[] {
  return suggestContent({
    kind: request.kind,
    categoryKey: request.categoryKey ?? undefined,
    name: request.subjectName ?? undefined,
    notes: request.notes ?? request.description ?? undefined,
    attributes: request.attributes,
    businessName: request.businessName ?? undefined,
    location: request.location ?? undefined,
    durationMinutes: null,
    priceKES: undefined,
    question: request.question ?? undefined,
  });
}

export async function writeStudioCopy(request: CopyRequest): Promise<CopyOutcome> {
  const label = ASSIST_LABELS[request.kind] || "Text";
  const facts = factsFor(request);
  const design =
    request.designContext ||
    buildDesignContext({
      businessName: request.businessName || "This business",
      categoryKey: request.categoryKey,
      toneOfVoice: request.toneOfVoice ?? null,
    });

  const deterministic = deterministicSuggestions(request);
  const provider = resolveProvider("text");
  const wantsModel = provider.key !== "jata-local" && provider.capabilities.textGeneration;
  const count = Math.max(1, Math.min(4, request.count ?? 3));

  if (!wantsModel) {
    const { accepted, rejected } = filterGroundedTexts(deterministic.map((entry) => entry.text), facts);
    return {
      kind: request.kind,
      label,
      suggestions: accepted.map((text, index) => ({ id: `s${index + 1}`, text, requiresApproval: true as const })),
      requiresApproval: true,
      deterministic: true,
      provider: { key: provider.key, label: provider.label },
      rejected: rejected.length,
      note: "Review and edit before saving. Prices, stock and availability are never changed by the assistant.",
    };
  }

  const built = request.kind === "IMAGE_ALT"
    ? buildAltTextPrompt({ design, subjectName: request.subjectName, placement: null })
    : buildCopyPrompt({
        kind: request.kind,
        design,
        subjectName: request.subjectName,
        facts,
        question: request.question ?? null,
        tone: request.toneOfVoice ?? null,
      });

  const record = await startGeneration({
    businessId: request.businessId,
    userId: request.userId ?? null,
    kind: request.kind === "IMAGE_ALT" ? "ALT_TEXT" : "COPY",
    capability: request.kind,
    subjectType: request.subjectName ? "PRODUCT" : null,
    subjectId: null,
    prompt: built.prompt,
    providerKey: provider.key,
    modelKey: provider.modelKey,
  });
  const started = Date.now();

  try {
    const result = await provider.generateText(
      {
        kind: request.kind,
        system: built.system,
        prompt: built.prompt,
        maxChars: built.maxChars,
        facts,
        design,
        count,
        seed: design.styleSeed,
      },
      { businessId: request.businessId, generationId: record?.id || "copy", timeoutMs: 30_000 },
    );
    const { accepted, rejected } = filterGroundedTexts(result.texts, facts);
    await finishGeneration({
      id: record?.id ?? null,
      status: accepted.length > 0 ? "SUCCEEDED" : "BLOCKED",
      errorCode: accepted.length > 0 ? null : "grounding_rejected",
      durationMs: Date.now() - started,
    });

    if (accepted.length === 0) {
      // Nothing the model wrote survived the truth check: answer with grounded wording instead.
      const fallback = filterGroundedTexts(deterministic.map((entry) => entry.text), facts);
      return {
        kind: request.kind,
        label,
        suggestions: fallback.accepted.map((text, index) => ({ id: `s${index + 1}`, text, requiresApproval: true as const })),
        requiresApproval: true,
        deterministic: true,
        provider: { key: provider.key, label: provider.label },
        rejected: rejected.length,
        note: "JATA wrote this itself because the AI suggested claims we could not verify for your business.",
      };
    }

    return {
      kind: request.kind,
      label,
      suggestions: accepted.map((text, index) => ({ id: `s${index + 1}`, text, requiresApproval: true as const })),
      requiresApproval: true,
      deterministic: false,
      provider: { key: provider.key, label: provider.label },
      rejected: rejected.length,
      note: rejected.length > 0
        ? "JATA removed suggestions that claimed things you have not told us about. Review before saving."
        : "Review and edit before saving. Prices, stock and availability are never changed by the assistant.",
    };
  } catch (error) {
    const mapped = providerErrorMessage(error);
    await finishGeneration({ id: record?.id ?? null, status: "FAILED", errorCode: mapped.code, durationMs: Date.now() - started });
    const fallback = filterGroundedTexts(deterministic.map((entry) => entry.text), facts);
    return {
      kind: request.kind,
      label,
      suggestions: fallback.accepted.map((text, index) => ({ id: `s${index + 1}`, text, requiresApproval: true as const })),
      requiresApproval: true,
      deterministic: true,
      provider: { key: "jata-local", label: "JATA built-in" },
      rejected: 0,
      note: `${mapped.message} JATA's own suggestions are below instead.`,
    };
  }
}

/** Generates alt-text suggestions for one image, grounded in the owner's own words (§27). */
export async function suggestStudioAltText(request: {
  businessId: string;
  userId?: string | null;
  subjectName?: string | null;
  categoryKey?: CategoryKey | string | null;
  businessName?: string | null;
  location?: string | null;
}): Promise<{ suggestions: string[]; provider: string; rejected: number }> {
  const outcome = await writeStudioCopy({
    businessId: request.businessId,
    userId: request.userId,
    kind: "IMAGE_ALT",
    categoryKey: request.categoryKey,
    businessName: request.businessName,
    subjectName: request.subjectName,
    location: request.location,
    count: 3,
  });
  return { suggestions: outcome.suggestions.map((entry) => entry.text), provider: outcome.provider.label, rejected: outcome.rejected };
}

/** True when a provider failure should surface as a provider error rather than a fallback. */
export function isFatalProviderError(error: unknown): boolean {
  return error instanceof ProviderError && error.code === "not_configured";
}
