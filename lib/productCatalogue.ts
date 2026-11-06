/**
 * Public product-catalogue assembly for the marketing surfaces.
 *
 * Separates five distinct concepts so a missing database row can never silently hide an
 * approved package from the public catalogue, while nothing becomes purchasable without
 * its real conditions:
 *
 *   1. Product catalogue visibility  — every approved package is listed from its approved
 *      constants (FALLBACK_PLANS / FRONT_DESK_TIER_PRICING / AUTOPILOT_PLAN_CATALOG),
 *      whether or not its stored `PlanConfig` row exists.
 *   2. Commercial activation         — a stored, active, price-matching row.
 *   3. Payment availability          — unchanged checkout guards (server-side, untouched here).
 *   4. Entitlement provisioning      — unchanged settlement/entitlement engines (untouched here).
 *   5. Provider readiness            — Voice additionally requires `getVoiceReadiness().canSell`.
 *
 * Pure functions only: no database and no framework imports, so the resilience rules are
 * unit-testable offline. Cards built here are presentation — they grant nothing.
 */
import { FALLBACK_PLANS, PRIVATE_PLAN_KEYS, homepagePlanCards, type HomepagePlanCard } from "./pricing";
import {
  AI_FRONT_DESK_VOICE_KEY,
  FRONT_DESK_TIER_KEYS,
  FRONT_DESK_TIER_PRICING,
  isFrontDeskTierKey,
  type FrontDeskTierKey,
} from "./frontDeskTiers";

/**
 * Front Desk tiers rendered by the dedicated family section on `/products`.
 * They are never duplicated into the main grid (the family section is their single source),
 * except the Starter key which keeps its owner-mandated grid position.
 */
export const FAMILY_SECTION_ONLY_KEYS = [
  "AI_FRONT_DESK_STANDARD",
  "AI_FRONT_DESK_PRO",
  AI_FRONT_DESK_VOICE_KEY,
] as const;

/** The workspace-only Autopilot tiers, shown on `/products` after the standard card. */
export const PRODUCTS_PAGE_AUTOPILOT_TIERS = [
  "JATA_AUTOPILOT_PRO",
  "JATA_AUTOPILOT_ENTERPRISE",
] as const;

/** Single source of truth for customer-facing availability labels. */
export const CATALOGUE_STATUS = {
  active: "Active in the server catalogue",
  awaiting: "Awaiting catalogue activation — not for sale",
  providerPending: "Awaiting provider activation — not for sale",
  providerVerified: "Provider and commercial gates verified",
} as const;

/**
 * The conditions that must all be verified before Front Desk Voice may be sold, receive
 * live calls, or run paid activation. Listed verbatim from the readiness gates in
 * `lib/telnyx/voice-readiness.ts` and the release rules — never shortened, never reordered
 * into a claim that any of them is already complete.
 */
export const VOICE_SELLING_CONDITIONS = [
  "Telnyx account and inbound number readiness",
  "Required provider credentials and environment configuration",
  "Media streaming worker readiness, including its handshake token",
  "Provider callback and event handling verification",
  "Real handset inbound call testing",
  "Commercial activation approval for customer billing",
] as const;

/** A stored row satisfies the approved price/term for its family key (money stays server-derived). */
export function isPriceMatchedRow(
  row: Pick<HomepagePlanCard, "key" | "priceKES" | "durationDays"> | undefined,
  key: FrontDeskTierKey,
): boolean {
  if (!row) return false;
  const approved = FRONT_DESK_TIER_PRICING[key];
  return row.priceKES === approved.priceKES && row.durationDays === approved.durationDays;
}

/**
 * Availability label for a Front Desk family card. The family section always displays the
 * approved price, so its row must match the approved price and term exactly; Voice also
 * requires the full provider + commercial readiness before anything reads as sellable.
 */
export function frontDeskTierStatus(input: {
  key: FrontDeskTierKey;
  catalogueMatch: boolean;
  voiceCanSell: boolean;
}): string {
  const { key, catalogueMatch, voiceCanSell } = input;
  if (key === AI_FRONT_DESK_VOICE_KEY) {
    if (!voiceCanSell) return CATALOGUE_STATUS.providerPending;
    return catalogueMatch ? CATALOGUE_STATUS.providerVerified : CATALOGUE_STATUS.awaiting;
  }
  return catalogueMatch ? CATALOGUE_STATUS.active : CATALOGUE_STATUS.awaiting;
}

function workspacePhrase(key: string): string {
  if (key === "ERP_PRO") return "switched on from the ERP workspace";
  if (key.startsWith("JATA_AUTOPILOT")) return "sold inside the JATA Autopilot workspace";
  if (key === "BUSINESS_POS") return "sold from your dashboard";
  return "managed from your workspace";
}

/**
 * Availability label for a main-grid card. Grid cards display the stored price when a
 * price-matched row exists (and the approved canonical fallback when it does not), so a
 * usable row's presence is the activation signal — the caller passes
 * `priceMatchedGridKeys(...)` membership, never a raw row lookup; private workspace
 * products state their real sales channel instead of implying a public checkout.
 */
export function catalogueCardStatus(input: {
  key: string;
  hasStoredRow: boolean;
  voiceCanSell: boolean;
}): string {
  const { key, hasStoredRow, voiceCanSell } = input;
  if (key === AI_FRONT_DESK_VOICE_KEY && !voiceCanSell) return CATALOGUE_STATUS.providerPending;
  if (isFrontDeskTierKey(key)) {
    return hasStoredRow ? CATALOGUE_STATUS.active : CATALOGUE_STATUS.awaiting;
  }
  if (PRIVATE_PLAN_KEYS.includes(key)) {
    const channel = workspacePhrase(key);
    return hasStoredRow ? `${CATALOGUE_STATUS.active} — ${channel}` : `Approved package — ${channel}`;
  }
  return hasStoredRow ? CATALOGUE_STATUS.active : CATALOGUE_STATUS.awaiting;
}

/**
 * Builds the marketing grid for `/products` from the approved catalogue constants,
 * overlaid with whatever active `PlanConfig` rows can actually be read.
 *
 * Resilience guarantee: the output ALWAYS contains the seven owner-ordered offers plus the
 * two workspace-only Autopilot tiers — for empty input, partial input, or full production
 * input — so an approved product can never silently disappear when its row is missing.
 * A stored row wins its own price/name slot only while its price and term equal the
 * approved public constants — the same rule checkout enforces server-side
 * (`PLAN_PRICING_INVALID`); an out-of-spec row never leaks its amount onto a public card
 * and never reads as "in the server catalogue". The canonical fallback covers every hole
 * and never rewrites anything stored that is actually sellable.
 *
 * The three Front Desk family tiers (Standard/Pro/Voice) are excluded from the grid on
 * purpose — the `/products` family section renders them from `FRONT_DESK_TIER_KEYS`.
 */
export function buildMarketingCatalogue(
  stored: readonly HomepagePlanCard[],
  // The shared authoritative assembler, injected by callers (the products page passes the
  // imported `homepagePlanCards` so the "one helper shared with the homepage" contract
  // remains visible at the call site). Defaults to the same function for unit tests.
  assemble: (rows: readonly HomepagePlanCard[]) => HomepagePlanCard[] = homepagePlanCards,
): HomepagePlanCard[] {
  return assembleCards(priceMatchedStoredRows(stored, assemble), assemble);
}

/**
 * Stored rows keyed into the public grid, filtered to the ones whose price and term equal
 * the approved constants rendered for that key (baseline computed through the very same
 * assembly path, so every grid slot — including the ERP workspace card — is covered).
 * Checkout rejects a mismatched row with `PLAN_PRICING_INVALID`; the public page must
 * therefore neither display the out-of-spec amount nor label such a row as active.
 */
function priceMatchedStoredRows(
  stored: readonly HomepagePlanCard[],
  assemble: (rows: readonly HomepagePlanCard[]) => HomepagePlanCard[] = homepagePlanCards,
): HomepagePlanCard[] {
  const baseline = new Map(assembleCards([], assemble).map((card) => [card.key, card]));
  return stored.filter((row) => {
    const approved = baseline.get(row.key);
    if (!approved) return true; // family/unknown keys: validated on their own surface
    return row.priceKES === approved.priceKES && row.durationDays === approved.durationDays;
  });
}

/** Keys of stored rows the `/products` grid may count as catalogue-present (price-matched). */
export function priceMatchedGridKeys(
  stored: readonly HomepagePlanCard[],
  assemble: (rows: readonly HomepagePlanCard[]) => HomepagePlanCard[] = homepagePlanCards,
): Set<string> {
  return new Set(priceMatchedStoredRows(stored, assemble).map((row) => row.key));
}

function assembleCards(
  stored: readonly HomepagePlanCard[],
  assemble: (rows: readonly HomepagePlanCard[]) => HomepagePlanCard[],
): HomepagePlanCard[] {
  const storedByKey = new Map(stored.map((row) => [row.key, row]));

  // Canonical approved rows fill every public hole; a stored row always wins its slot.
  const merged: HomepagePlanCard[] = FALLBACK_PLANS.map((fallback) => {
    const row = storedByKey.get(fallback.key);
    return row ?? { key: fallback.key, name: fallback.name, priceKES: fallback.priceKES, durationDays: fallback.durationDays };
  });
  // Stored rows for keys outside the canonical list. Family tiers are skipped here: the
  // family section renders them from the approved tier pricing with their own status.
  for (const row of stored) {
    if (merged.some((card) => card.key === row.key)) continue;
    if (isFrontDeskTierKey(row.key)) continue;
    merged.push(row);
  }

  const cards = assemble(merged);

  // Approved workspace-only Autopilot tiers, directly after the standard Autopilot card.
  // Kept page-local (not inside `homepagePlanCards`) so the owner's homepage seven-card
  // order and its pinned tests remain byte-identical.
  const autopilotTiers: HomepagePlanCard[] = PRODUCTS_PAGE_AUTOPILOT_TIERS.map((key) => {
    const row = storedByKey.get(key);
    const canonical = FALLBACK_PLANS.find((plan) => plan.key === key)!;
    return row ?? { key: canonical.key, name: canonical.name, priceKES: canonical.priceKES, durationDays: canonical.durationDays };
  });
  const autopilotIndex = cards.findIndex((card) => card.key === "JATA_AUTOPILOT");
  if (autopilotIndex >= 0) {
    return [...cards.slice(0, autopilotIndex + 1), ...autopilotTiers, ...cards.slice(autopilotIndex + 1)];
  }
  return [...cards, ...autopilotTiers];
}

/** The four approved family keys in display order (shared by the page and its tests). */
export const FAMILY_DISPLAY_KEYS: readonly FrontDeskTierKey[] = FRONT_DESK_TIER_KEYS;
