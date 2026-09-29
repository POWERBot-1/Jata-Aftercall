/**
 * Turns the stored opening-hours value into customer-readable rows.
 * The column historically stores JSON.stringify(<anything>) (a string, an object map,
 * or an array), sometimes with `<`/`>` HTML-escaped by sanitizeText. Customers must
 * never see raw JSON: unknown shapes are dropped rather than printed.
 */
export type OpeningHoursRow = { label: string; value: string };

const DAY_NAMES: Record<string, string> = {
  mon: "Mon", monday: "Mon", tue: "Tue", tues: "Tue", tuesday: "Tue", wed: "Wed", wednesday: "Wed",
  thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu", fri: "Fri", friday: "Fri",
  sat: "Sat", saturday: "Sat", sun: "Sun", sunday: "Sun",
  weekdays: "Weekdays", weekday: "Weekdays", weekends: "Weekends", weekend: "Weekends",
  daily: "Every day", everyday: "Every day", holidays: "Public holidays", holiday: "Public holidays",
};

const MAX_ROWS = 14;
const MAX_TEXT = 80;

function decodeEscapes(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function clean(value: string): string {
  return decodeEscapes(value).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

/** "mon_sat" → "Mon–Sat", "sunday" → "Sun", "public holidays" → "Public holidays". */
export function formatDayLabel(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (DAY_NAMES[normalized]) return DAY_NAMES[normalized];
  const range = normalized.split(/\s*(?:_|-|–|to)\s*/).filter(Boolean);
  if (range.length === 2 && DAY_NAMES[range[0]] && DAY_NAMES[range[1]]) return `${DAY_NAMES[range[0]]}–${DAY_NAMES[range[1]]}`;
  const words = clean(key).replace(/[_]+/g, " ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

function formatValue(value: unknown): string | null {
  if (typeof value === "string") return clean(value) || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value === false || value === null) return "Closed";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (v.closed === true) return "Closed";
    const open = typeof v.open === "string" ? clean(v.open) : typeof v.from === "string" ? clean(v.from) : "";
    const close = typeof v.close === "string" ? clean(v.close) : typeof v.to === "string" ? clean(v.to) : "";
    if (open && close) return `${open} – ${close}`;
    if (typeof v.hours === "string") return clean(v.hours) || null;
  }
  return null;
}

export function formatOpeningHours(raw: string | null | undefined): OpeningHoursRow[] {
  if (!raw || typeof raw !== "string") return [];
  const text = decodeEscapes(raw).trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Plain text that was never JSON (e.g. "Mon–Sat 8am–6pm") is already readable.
    return text.startsWith("{") || text.startsWith("[") ? [] : [{ label: "", value: clean(text) }];
  }

  const rows: OpeningHoursRow[] = [];
  if (typeof parsed === "string") {
    const value = clean(parsed);
    if (value) rows.push({ label: "", value });
  } else if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === "string") { const value = clean(item); if (value) rows.push({ label: "", value }); continue; }
      if (item && typeof item === "object") {
        const entry = item as Record<string, unknown>;
        const day = typeof entry.day === "string" ? entry.day : typeof entry.days === "string" ? entry.days : typeof entry.label === "string" ? entry.label : "";
        const value = formatValue(entry);
        if (value) rows.push({ label: day ? formatDayLabel(day) : "", value });
      }
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const formatted = formatValue(value);
      if (formatted) rows.push({ label: formatDayLabel(key), value: formatted });
    }
  }
  return rows.slice(0, MAX_ROWS);
}
