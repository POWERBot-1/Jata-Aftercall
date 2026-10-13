import type { StorefrontData, StorefrontItem } from "./storefront";
import { formatKES } from "../format";

/** Price bands are derived from the tenant's own catalogue, never hard-coded (§11). */
export function priceBandsFor(items: StorefrontItem[]): Array<{ label: string; min: number; max: number }> {
  const prices = items.map((item) => item.price).filter((price): price is number => typeof price === "number" && price > 0);
  if (prices.length < 4) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= min) return [];
  const step = (max - min) / 3;
  return [
    { label: `Under ${formatKES(Math.round(min + step))}`, min: 0, max: Math.round(min + step) },
    { label: `${formatKES(Math.round(min + step))} – ${formatKES(Math.round(min + step * 2))}`, min: Math.round(min + step), max: Math.round(min + step * 2) },
    { label: `Over ${formatKES(Math.round(min + step * 2))}`, min: Math.round(min + step * 2), max: Number.MAX_SAFE_INTEGER },
  ];
}

/** Only the public fields needed by filtered cards cross the client boundary. */
export type ItemCardData = {
  business: { slug: string };
  profile: { capabilities: StorefrontData["profile"]["capabilities"]; cta: { add: string } };
  theme: { treatment: { cardStyle: StorefrontData["theme"]["treatment"]["cardStyle"] } };
};
export function itemCardDataFor(data: StorefrontData): ItemCardData {
  return {
    business: { slug: data.business.slug },
    profile: { capabilities: [...data.profile.capabilities], cta: { add: data.profile.cta.add } },
    theme: { treatment: { cardStyle: data.theme.treatment.cardStyle } },
  };
}
