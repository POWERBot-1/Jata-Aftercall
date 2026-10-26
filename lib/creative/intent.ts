/**
 * Creative command understanding (Website Studio creative engine).
 *
 * Turns an owner's ordinary-language instruction — typed or spoken — into a structured,
 * testable intent: what kind of media, in what shape, for which placement, and what is
 * still missing. This module never generates anything and never claims a capability; it
 * only *understands*. Whether JATA can act on an intent is decided separately and
 * truthfully by `lib/creative/capabilities.ts`.
 *
 * Pure and dependency-free, so the identical reading runs in the browser (to show the
 * owner what JATA understood before they press Generate) and on the server (which never
 * trusts a client-supplied media type).
 */

export type CreativeMediaType = "hero" | "poster" | "product" | "banner" | "edit" | "animation" | "video";

export type CreativeAspect = "wide" | "square" | "vertical";

export type CreativeIntent = {
  mediaType: CreativeMediaType;
  aspect: CreativeAspect;
  /** Existing Studio preset key (`lib/ai/promptBuilder` IMAGE_PRESETS) for image intents. */
  preset: string;
  placement: "hero" | "product" | "service" | "gallery" | "background";
  /** Photo-improvement operations the owner asked for, in their words' order. */
  editOperations: string[];
  /** True when the instruction only refines a previous result ("make it brighter"). */
  isFollowUp: boolean;
  /**
   * The single essential follow-up question, when the instruction cannot be acted on
   * without it — e.g. an edit with no reference photo. Null when JATA can proceed with
   * sensible defaults from the business profile.
   */
  followUp: string | null;
  /** Owner-facing one-liner JATA can repeat back: what it understood. */
  understood: string;
};

const VIDEO_WORDS = /\b(video|clip|reel|whatsapp status|status video|tiktok|filamu)\b/i;
const ANIMATION_WORDS = /\b(animat\w*|gif|moving (picture|image|poster)|motion graphic)\b/i;
const POSTER_WORDS = /\b(poster|flyer|tangazo|advert|ad\b|promotion(al)? (poster|graphic|image)|offer (poster|graphic)|banner ad)\b/i;
const BANNER_WORDS = /\b(banner|cover photo|header image|thumbnail)\b/i;
const HERO_WORDS = /\b(hero|opening image|main (image|picture|photo)|top of (my|the) (website|page)|website (look|image|picture|photo|banner)|homepage)\b/i;
const EDIT_WORDS = /\b(improv\w*|enhanc\w*|bright\w*|lighting|background|remove (the )?background|replace (the )?background|clean up|retouch|fix (this|the|my) (photo|picture|image)|edit (this|the|my)|sharpen|contrast|colour|color)\b/i;
const FOLLOW_UP_WORDS = /^(make it|make this|change (it|the|this)|use a |use the |more |less |brighter|darker|bigger|smaller|vertical|wider|now )/i;

const EDIT_OPERATIONS: Array<[RegExp, string]> = [
  [/\b(bright\w*|lighting|lighten)\b/i, "brighter, better lighting"],
  [/\bbackground\b/i, "new background"],
  [/\b(sharpen|sharpness|clearer)\b/i, "sharper"],
  [/\b(contrast)\b/i, "stronger contrast"],
  [/\b(colour|color|saturat\w*|vibrant)\b/i, "richer colour"],
  [/\b(crop|composition|frame|framing)\b/i, "better crop and composition"],
  [/\b(clean|tidy|remove|retouch)\b/i, "cleaned up"],
];

export function detectAspect(text: string, mediaType: CreativeMediaType): CreativeAspect {
  if (/\b(vertical|portrait|whatsapp status|status|story|stories|reel|tiktok|9:16|tall)\b/i.test(text)) return "vertical";
  if (/\b(square|instagram|insta\b|1:1|post)\b/i.test(text)) return "square";
  if (/\b(wide|banner|landscape|16:9|desktop|website)\b/i.test(text)) return "wide";
  if (mediaType === "poster") return "vertical";
  if (mediaType === "video" || mediaType === "animation") return "vertical";
  return "wide";
}

const PRESET_FOR: Record<CreativeMediaType, { preset: string; placement: CreativeIntent["placement"] }> = {
  hero: { preset: "hero", placement: "hero" },
  poster: { preset: "advert", placement: "gallery" },
  product: { preset: "product-photo", placement: "product" },
  banner: { preset: "background", placement: "background" },
  edit: { preset: "product-photo", placement: "product" },
  animation: { preset: "social", placement: "gallery" },
  video: { preset: "social", placement: "gallery" },
};

/** Human label per media type, for chips and status lines. */
export const MEDIA_TYPE_LABELS: Record<CreativeMediaType, string> = {
  hero: "Website opening image",
  poster: "Poster / advert",
  product: "Product image",
  banner: "Banner",
  edit: "Improve my photo",
  animation: "Animated graphic",
  video: "Video advert",
};

export function parseCreativeInstruction(
  instruction: string,
  options: { hasReferenceImage?: boolean; forcedMediaType?: CreativeMediaType | "auto" | null } = {},
): CreativeIntent {
  const text = (instruction || "").trim().replace(/\s+/g, " ").slice(0, 600);

  let mediaType: CreativeMediaType;
  if (options.forcedMediaType && options.forcedMediaType !== "auto") mediaType = options.forcedMediaType;
  else if (VIDEO_WORDS.test(text)) mediaType = "video";
  else if (ANIMATION_WORDS.test(text)) mediaType = "animation";
  else if (EDIT_WORDS.test(text) && (options.hasReferenceImage || /\b(this|that|my) (photo|picture|image)\b/i.test(text) || /\b(uploaded)\b/i.test(text))) mediaType = "edit";
  else if (POSTER_WORDS.test(text)) mediaType = "poster";
  else if (BANNER_WORDS.test(text)) mediaType = "banner";
  else if (HERO_WORDS.test(text)) mediaType = "hero";
  else if (EDIT_WORDS.test(text)) mediaType = "edit";
  else mediaType = "product";

  const editOperations: string[] = [];
  if (mediaType === "edit") {
    for (const [pattern, label] of EDIT_OPERATIONS) {
      if (pattern.test(text)) editOperations.push(label);
    }
    if (editOperations.length === 0) editOperations.push("brighter, better lighting", "richer colour", "sharper");
  }

  const aspect = detectAspect(text, mediaType);
  const { preset, placement } = PRESET_FOR[mediaType];
  const isFollowUp = FOLLOW_UP_WORDS.test(text);

  let followUp: string | null = null;
  if (!text) {
    followUp = "What would you like to create? For example: “Make a poster for my weekend offer.”";
  } else if (mediaType === "edit" && !options.hasReferenceImage) {
    followUp = "Which photo should I improve? Pick one from your gallery below, then press Generate again.";
  }

  const aspectWord = aspect === "vertical" ? "vertical" : aspect === "square" ? "square" : "wide";
  const understood = !text
    ? "Tell me what to create."
    : mediaType === "edit"
      ? `Improve your photo: ${editOperations.join(", ")}. Your original is kept.`
      : `A ${aspectWord} ${MEDIA_TYPE_LABELS[mediaType].toLowerCase()} for your business.`;

  return { mediaType, aspect, preset, placement, editOperations, isFollowUp, followUp, understood };
}

/** Example commands shown in the empty creative workspace. */
export const CREATIVE_EXAMPLES = [
  "Create a premium poster advertising my salon's weekend offer",
  "Make my grocery website look fresh, modern and trustworthy",
  "Improve the lighting and background of this product photo",
  "Prepare a vertical advert for WhatsApp Status",
  "Make it brighter, with a black and gold background",
] as const;
