export type PrimaryCtaAction = "shop" | "book" | "contact";

/**
 * Generated or legacy content can contain empty/whitespace-only CTA labels.
 * Always render a visible action label, preferring the owner-authored text.
 */
export function primaryCtaLabel(
  heroLabel: string | null | undefined,
  profileLabel: string | null | undefined,
  action: PrimaryCtaAction,
): string {
  const authored = heroLabel?.trim() || profileLabel?.trim();
  if (authored) return authored;
  if (action === "shop") return "Shop now";
  if (action === "book") return "Book now";
  return "Contact us";
}
