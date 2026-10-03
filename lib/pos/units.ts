/**
 * Units of measure (§13, §14, test matrix N — custom units)
 *
 * A business sells by piece, bag, metre or kilo, and one carton may be 24 pieces. Units are
 * presentation plus arithmetic — never a different application per trade.
 */

import type { PosConfiguration, UnitConversion, UnitKey } from "./types";

export type UnitDefinition = {
  key: UnitKey;
  label: string;
  plural: string;
  /** Countable units are whole numbers; measurable units may be fractional. */
  countable: boolean;
  /** Base unit this measures against, used by default conversions. */
  family: "count" | "weight" | "volume" | "length" | "time" | "service";
  abbrev?: string;
};

export const UNITS: UnitDefinition[] = [
  { key: "piece", label: "Piece", plural: "Pieces", countable: true, family: "count", abbrev: "pc" },
  { key: "box", label: "Box", plural: "Boxes", countable: true, family: "count" },
  { key: "carton", label: "Carton", plural: "Cartons", countable: true, family: "count" },
  { key: "pack", label: "Pack", plural: "Packs", countable: true, family: "count" },
  { key: "dozen", label: "Dozen", plural: "Dozens", countable: true, family: "count" },
  { key: "pair", label: "Pair", plural: "Pairs", countable: true, family: "count" },
  { key: "roll", label: "Roll", plural: "Rolls", countable: true, family: "count" },
  { key: "bottle", label: "Bottle", plural: "Bottles", countable: true, family: "count" },
  { key: "sack", label: "Sack", plural: "Sacks", countable: true, family: "count" },
  { key: "bag", label: "Bag", plural: "Bags", countable: true, family: "count" },
  { key: "crate", label: "Crate", plural: "Crates", countable: true, family: "count" },
  { key: "kilogram", label: "Kilogram", plural: "Kilograms", countable: false, family: "weight", abbrev: "kg" },
  { key: "gram", label: "Gram", plural: "Grams", countable: false, family: "weight", abbrev: "g" },
  { key: "litre", label: "Litre", plural: "Litres", countable: false, family: "volume", abbrev: "l" },
  { key: "millilitre", label: "Millilitre", plural: "Millilitres", countable: false, family: "volume", abbrev: "ml" },
  { key: "metre", label: "Metre", plural: "Metres", countable: false, family: "length", abbrev: "m" },
  { key: "centimetre", label: "Centimetre", plural: "Centimetres", countable: false, family: "length", abbrev: "cm" },
  { key: "hour", label: "Hour", plural: "Hours", countable: false, family: "time", abbrev: "hr" },
  { key: "day", label: "Day", plural: "Days", countable: true, family: "time" },
  { key: "visit", label: "Visit", plural: "Visits", countable: true, family: "service" },
  { key: "session", label: "Session", plural: "Sessions", countable: true, family: "service" },
  { key: "job", label: "Job", plural: "Jobs", countable: true, family: "service" },
  { key: "custom", label: "Custom unit", plural: "Custom units", countable: true, family: "count" },
];

/** Units offered in the questionnaire, in the order the specification lists them (§13). */
export const QUESTIONNAIRE_UNIT_KEYS: UnitKey[] = [
  "piece", "box", "carton", "kilogram", "gram", "litre", "millilitre",
  "metre", "centimetre", "pair", "dozen", "pack", "roll", "bottle", "sack",
];

const BY_KEY = new Map<string, UnitDefinition>(UNITS.map((unit) => [unit.key, unit]));

/** Owner-defined units, e.g. `{ "tin": { label: "Tin", plural: "Tins" } }` (§13 custom unit). */
export type CustomUnits = Record<string, { label: string; plural: string; countable?: boolean }>;

export function getUnit(key: string | null | undefined): UnitDefinition | undefined {
  if (!key) return undefined;
  return BY_KEY.get(key);
}

export function unitLabel(key: string | null | undefined, custom?: CustomUnits): string {
  if (!key) return "";
  if (custom?.[key]?.label) return custom[key].label;
  return BY_KEY.get(key)?.label ?? humanize(key);
}

export function unitPlural(key: string | null | undefined, custom?: CustomUnits): string {
  if (!key) return "";
  if (custom?.[key]?.plural) return custom[key].plural;
  return BY_KEY.get(key)?.plural ?? humanize(key);
}

export function isUnitKey(key: unknown): key is UnitKey {
  return typeof key === "string" && BY_KEY.has(key);
}

/**
 * The units this business may sell and stock in, with the words it uses (§13, §16, §24).
 * Form dropdowns are built from this, so a hardware store never sees "session" and a salon
 * never sees "sack" — the list comes from the configuration, not from the trade's code.
 */
export function unitOptions(config: Pick<PosConfiguration, "inventory"> | null | undefined): { key: string; label: string; plural: string; countable: boolean }[] {
  const configured = (config?.inventory?.units ?? []).filter(isUnitKey);
  const keys = configured.length ? configured : QUESTIONNAIRE_UNIT_KEYS;
  return keys.map((key) => {
    const unit = getUnit(key);
    return { key, label: unit?.label ?? String(key), plural: unit?.plural ?? String(key), countable: unit?.countable !== false };
  });
}

export function isCountableUnit(key: string | null | undefined, custom?: CustomUnits): boolean {
  if (!key) return true;
  if (custom?.[key]) return custom[key].countable !== false;
  return BY_KEY.get(key)?.countable ?? true;
}

function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Built-in conversions inside one family. Owner conversions (§13) always win because they
 * describe *their* packaging: a carton of 12 and a carton of 24 both exist in Kenya.
 */
export const DEFAULT_CONVERSIONS: UnitConversion[] = [
  { fromUnit: "kilogram", toUnit: "gram", factor: 1000 },
  { fromUnit: "litre", toUnit: "millilitre", factor: 1000 },
  { fromUnit: "metre", toUnit: "centimetre", factor: 100 },
  { fromUnit: "dozen", toUnit: "piece", factor: 12 },
  { fromUnit: "day", toUnit: "hour", factor: 24 },
];

export function sanitizeConversions(conversions: unknown): UnitConversion[] {
  if (!Array.isArray(conversions)) return [];
  const clean: UnitConversion[] = [];
  for (const entry of conversions) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const fromUnit = typeof candidate.fromUnit === "string" ? candidate.fromUnit.trim().slice(0, 40) : "";
    const toUnit = typeof candidate.toUnit === "string" ? candidate.toUnit.trim().slice(0, 40) : "";
    const factor = Number(candidate.factor);
    if (!fromUnit || !toUnit || fromUnit === toUnit) continue;
    if (!Number.isFinite(factor) || factor <= 0 || factor > 1_000_000) continue;
    clean.push({
      fromUnit,
      toUnit,
      factor: Math.round(factor * 1000) / 1000,
      label: typeof candidate.label === "string" ? candidate.label.slice(0, 80) : undefined,
    });
  }
  // Last definition wins so an owner correcting a conversion is not shadowed by an old one.
  const byPair = new Map<string, UnitConversion>();
  for (const conversion of clean) byPair.set(`${conversion.fromUnit}->${conversion.toUnit}`, conversion);
  return [...byPair.values()];
}

/**
 * Convert a quantity into another unit. Returns `null` when no conversion path exists — the
 * caller must then treat the units as unrelated rather than guessing (§54: never fabricate).
 */
export function convertQuantity(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  conversions: UnitConversion[] = [],
): number | null {
  if (!Number.isFinite(quantity)) return null;
  if (fromUnit === toUnit) return quantity;
  const all = [...conversions, ...DEFAULT_CONVERSIONS];
  const direct = all.find((conversion) => conversion.fromUnit === fromUnit && conversion.toUnit === toUnit);
  if (direct) return roundQuantity(quantity * direct.factor, toUnit);
  const inverse = all.find((conversion) => conversion.fromUnit === toUnit && conversion.toUnit === fromUnit);
  if (inverse) return roundQuantity(quantity / inverse.factor, toUnit);
  // Two hops: carton → piece → gram style chains are rare, but 1 hop each way is common
  // (box → piece where the owner defined piece → unit differently).
  for (const first of all) {
    if (first.fromUnit !== fromUnit) continue;
    const second = all.find((conversion) => conversion.fromUnit === first.toUnit && conversion.toUnit === toUnit);
    if (second) return roundQuantity(quantity * first.factor * second.factor, toUnit);
    const secondInverse = all.find((conversion) => conversion.fromUnit === toUnit && conversion.toUnit === first.toUnit);
    if (secondInverse) return roundQuantity((quantity * first.factor) / secondInverse.factor, toUnit);
  }
  return null;
}

/** Stock is stored in base units; countable units never carry fractional stock. */
export function roundQuantity(quantity: number, unitKey: string): number {
  if (!Number.isFinite(quantity)) return 0;
  return isCountableUnit(unitKey) ? Math.round(quantity) : Math.round(quantity * 1000) / 1000;
}

export function describeConversion(conversion: UnitConversion): string {
  return conversion.label || `1 ${unitLabel(conversion.fromUnit)} = ${conversion.factor} ${unitLabel(conversion.toUnit)}`;
}

/** Validated quantity for a sale line: positive, finite and whole where the unit demands it. */
export function sanitizeQuantity(value: unknown, unitKey?: string): number {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const capped = Math.min(quantity, 1_000_000);
  return roundQuantity(capped, unitKey ?? "piece");
}
