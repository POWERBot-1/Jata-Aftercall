/**
 * Prompt building (§8, §12, §16, §44, §55)
 *
 * Owners never write an AI prompt. They choose *what* they need ("Professional product photo",
 * "Warm & homely") and the Studio composes the instruction from the business's own design
 * context: palette, photography style, subject, category art direction and the owner's own
 * description of the item.
 *
 * Two rules are baked into every prompt:
 *   • Never invent business facts — no prices, claims, brands, logos or text in images.
 *   • Never restyle a real product when improving a photo the owner supplied.
 */

import { resolvePhotographyStyle, type DesignContext } from "./designContext";
import { GROUNDING_SYSTEM_RULES } from "./grounding";

export type ImagePlacement = "product" | "service" | "hero" | "gallery" | "logo" | "background";

export type ImagePreset = {
  key: string;
  label: string;
  description: string;
  /** What the image is for, which drives framing and aspect. */
  placement: ImagePlacement;
  composition: string;
  /** Sizes requested from the provider for this framing. */
  size: { width: number; height: number };
};

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    key: "product-photo",
    label: "Professional product photo",
    description: "A clean, catalogue-style shot of one item.",
    placement: "product",
    composition: "one item, centred, filling about two thirds of a square frame, no props competing for attention",
    size: { width: 1024, height: 1024 },
  },
  {
    key: "advert",
    label: "Premium advertisement",
    description: "A bolder, campaign-style image with room for a headline.",
    placement: "product",
    composition: "one hero item to one side with clean negative space for a headline, confident lighting",
    size: { width: 1024, height: 1024 },
  },
  {
    key: "natural",
    label: "Natural / local",
    description: "Feels real and unhurried, like a good phone photo.",
    placement: "product",
    composition: "the item in its everyday setting, softly out of focus behind, natural framing",
    size: { width: 1024, height: 1024 },
  },
  {
    key: "hero",
    label: "Website hero image",
    description: "A wide image for the top of your homepage.",
    placement: "hero",
    composition: "wide banner composition with the subject off-centre and generous empty space for text",
    size: { width: 1536, height: 864 },
  },
  {
    key: "social",
    label: "Social-media ready image",
    description: "Square and bold enough to stop a scrolling thumb.",
    placement: "gallery",
    composition: "square, strong silhouette, colour contrast that survives a small screen",
    size: { width: 1024, height: 1024 },
  },
  {
    key: "background",
    label: "Background texture",
    description: "A quiet brand backdrop with no product in it.",
    placement: "background",
    composition: "abstract, even, no focal subject, safe to place text over",
    size: { width: 1536, height: 864 },
  },
];

export function presetFor(key: string | null | undefined): ImagePreset {
  return IMAGE_PRESETS.find((preset) => preset.key === key) || IMAGE_PRESETS[0];
}

export type PromptFacts = {
  design: DesignContext;
  placement: ImagePlacement;
  /** Owner-supplied item name, e.g. "Beef Pilau". Never invented. */
  subjectName?: string | null;
  /** Owner-supplied description. */
  subjectDescription?: string | null;
  /** Free text the owner typed into "anything specific?". */
  ownerNotes?: string | null;
  /** Extra direction from the preset. */
  composition?: string;
  /** True when the owner attached their own photo to work from. */
  hasReference?: boolean;
};

function clean(value: unknown, max = 240): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Builds the image instruction. Colour, light direction and background come from the design
 * context, which is exactly what keeps ten generated photos looking like they belong to one
 * business (§16, §44).
 */
export function buildImagePrompt(facts: PromptFacts): string {
  const { design } = facts;
  const style = resolvePhotographyStyle(design.photography.key);
  const lines: string[] = [];

  lines.push(`A ${style.label.toLowerCase()} commercial image for ${design.businessName || "a small business"}, a ${design.categoryLabel.toLowerCase()} business in Kenya.`);
  if (facts.placement !== "background") {
    lines.push(`Subject: ${design.artDirection.subject}.`);
  } else {
    lines.push("Subject: none — this is a background texture for a website section.");
  }
  if (facts.subjectName) lines.push(`The owner sells: "${clean(facts.subjectName, 80)}".`);
  if (facts.subjectDescription) lines.push(`Owner's description: "${clean(facts.subjectDescription, 240)}".`);
  if (facts.ownerNotes) lines.push(`Owner's extra direction: "${clean(facts.ownerNotes, 200)}".`);
  lines.push(`Mood: ${design.artDirection.mood}. Website tone: ${design.tone}.`);
  lines.push(`Lighting: ${style.lighting}.`);
  lines.push(`Background: ${style.background}.`);
  lines.push(`Composition: ${facts.composition || style.composition}.`);
  lines.push(`Colour grade: ${style.grade}.`);
  lines.push(
    `Match this exact brand palette so the image sits naturally inside the website: primary ${design.palette.primary}, accent ${design.palette.accent}, background ${design.palette.background}.`,
  );
  lines.push(`Vary lighting direction and framing the same way across every image for this business (style seed ${design.styleSeed}).`);
  lines.push(`Avoid: ${design.artDirection.avoid}; cluttered props; busy patterns; heavy HDR; anything that looks like a stock photo.`);
  if (facts.hasReference) {
    lines.push(
      "The owner attached a photo of their own product. Preserve its identity exactly: same shape, colour, packaging, label text, proportions and material. Improve only the presentation — lighting, background, framing.",
    );
  }
  lines.push(
    "Do not include any text, price, logo, watermark, brand name or human faces unless the owner's own packaging already shows them. Never depict a different product than the one described.",
  );
  return lines.join(" ");
}

/**
 * Enhancement instruction (§14, §15). The wording is intentionally restrictive: a real product
 * must stay the same product after enhancement.
 */
export function buildEnhancePrompt(facts: { design: DesignContext; preserveIdentity: boolean; ownerNotes?: string | null }): string {
  const style = resolvePhotographyStyle(facts.design.photography.key);
  const lines = [
    "Improve this photograph for use on a small business website.",
    "Adjust only: exposure, white balance, contrast, colour accuracy, sharpness, noise and background cleanliness.",
    "Remove distracting clutter from the background and straighten the framing.",
  ];
  if (facts.preserveIdentity) {
    lines.push(
      "This is a real product the customer will receive. Keep its identity identical: the same product, same package, same label text, same shape, same colour, same quantity, same proportions. Do not redesign, restyle, resize or replace any object, and do not add or remove items.",
    );
  }
  lines.push(`Keep the business's photographic language: ${style.grade}, ${style.lighting}.`);
  if (facts.ownerNotes) lines.push(`Owner's instruction: "${clean(facts.ownerNotes, 160)}".`);
  lines.push("Do not add text, logos, watermarks, props or people.");
  return lines.join(" ");
}

export type CopyKind =
  | "PRODUCT_DESCRIPTION"
  | "SERVICE_DESCRIPTION"
  | "TAGLINE"
  | "SEO_DESCRIPTION"
  | "SEO_TITLE"
  | "OFFER_COPY"
  | "IMAGE_ALT"
  | "HERO_HEADLINE"
  | "HERO_SUBTITLE"
  | "ABOUT"
  | "FAQ_ANSWER"
  | "CTA_LABEL";

const COPY_SHAPES: Record<CopyKind, { instruction: string; maxChars: number; shape: string }> = {
  PRODUCT_DESCRIPTION: { instruction: "Write a product description a customer would read on a menu or shop page.", maxChars: 220, shape: "2 short sentences" },
  SERVICE_DESCRIPTION: { instruction: "Write a service description that explains what the customer gets and how it works.", maxChars: 220, shape: "2 short sentences" },
  TAGLINE: { instruction: "Write a short business tagline.", maxChars: 60, shape: "one line, no full stop unless it reads naturally" },
  SEO_DESCRIPTION: { instruction: "Write a search-result description for this business.", maxChars: 155, shape: "one sentence" },
  SEO_TITLE: { instruction: "Write a page title for search results.", maxChars: 60, shape: "business name and category, no keyword stuffing" },
  OFFER_COPY: { instruction: "Write a short line for a current offer the owner described.", maxChars: 120, shape: "one line" },
  IMAGE_ALT: { instruction: "Describe the image for a screen reader, factually and without marketing language.", maxChars: 125, shape: "a plain noun phrase" },
  HERO_HEADLINE: { instruction: "Write the main headline for the homepage hero.", maxChars: 70, shape: "one strong line" },
  HERO_SUBTITLE: { instruction: "Write the supporting line under the homepage headline.", maxChars: 120, shape: "one sentence" },
  ABOUT: { instruction: "Write the About section using only the facts supplied.", maxChars: 500, shape: "3 short sentences" },
  FAQ_ANSWER: { instruction: "Answer the customer's question using only the facts supplied.", maxChars: 400, shape: "2 sentences, direct answer first" },
  CTA_LABEL: { instruction: "Write a button label for the main action on this website.", maxChars: 24, shape: "2–3 words, verb first" },
};

export function copyShapeFor(kind: string): { instruction: string; maxChars: number; shape: string } {
  return COPY_SHAPES[kind as CopyKind] || COPY_SHAPES.PRODUCT_DESCRIPTION;
}

const LANGUAGE_RULE: Record<DesignContext["language"], string> = {
  en: "Write in clear, everyday English as used in Kenya.",
  sw: "Write in natural Kiswahili as spoken in Kenya — not a literal translation. Avoid English words where a Kiswahili word is normal.",
  mixed: "Write in the natural English–Kiswahili mix Kenyan business owners use on WhatsApp: mostly English, with familiar Kiswahili words where they fit.",
};

export type CopyPrompt = { system: string; prompt: string; maxChars: number };

/** The user-facing prompt for any copy kind, grounded in facts only. */
export function buildCopyPrompt(facts: {
  kind: string;
  design: DesignContext;
  subjectName?: string | null;
  facts: string[];
  question?: string | null;
  tone?: string | null;
}): CopyPrompt {
  const shape = copyShapeFor(facts.kind);
  const suppliedFacts = facts.facts.map((fact) => clean(fact, 200)).filter(Boolean);
  const prompt = [
    `BUSINESS: ${facts.design.businessName} (${facts.design.categoryLabel})${facts.design.location ? `, ${facts.design.location}` : ""}.`,
    `WEBSITE STYLE: ${facts.design.mood}; typography ${facts.design.typography}.`,
    `TONE: ${facts.tone || facts.design.tone}.`,
    LANGUAGE_RULE[facts.design.language],
    `TASK: ${shape.instruction} Keep it under ${shape.maxChars} characters. Shape: ${shape.shape}.`,
    facts.subjectName ? `SUBJECT: ${clean(facts.subjectName, 90)}.` : "",
    facts.question ? `CUSTOMER QUESTION: ${clean(facts.question, 200)}.` : "",
    `FACTS: ${suppliedFacts.length > 0 ? suppliedFacts.join(" | ") : "(none supplied)"}`,
    "If the FACTS list is empty or does not answer the task, write only generic wording that a customer can act on, and do not assert anything specific about the business.",
    `Return ${Math.max(1, Math.min(4, 3))} different options.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system: GROUNDING_SYSTEM_RULES, prompt, maxChars: shape.maxChars };
}

/**
 * Alt-text instruction (§27). Deliberately factual: screen-reader users need to know what the
 * image shows, not what the marketing team hopes it conveys. No keyword stuffing.
 */
export function buildAltTextPrompt(facts: { design: DesignContext; subjectName?: string | null; placement?: string | null }): CopyPrompt {
  return {
    system:
      "You write image descriptions for screen readers. Describe what is visible, factually and briefly. Never speculate about mood, quality or brand claims, and never repeat keywords.",
    prompt: [
      `Business: ${facts.design.businessName} (${facts.design.categoryLabel}).`,
      facts.subjectName ? `The image is of: ${clean(facts.subjectName, 90)}.` : "",
      facts.placement ? `Where it appears: ${facts.placement}.` : "",
      "Write one plain description under 120 characters. Do not start with 'image of'.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxChars: 120,
  };
}

/** What the Studio tells the owner it is doing while a generation runs (§40). */
export function generationStatusMessages(preset: string): { working: string; preparing: string } {
  const label = presetFor(preset).label.toLowerCase();
  return {
    working: `Creating your ${label}…`,
    preparing: "Applying your website style…",
  };
}
