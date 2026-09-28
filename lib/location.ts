export type ParsedCoordinates = { valid: true; lat: number | null; lng: number | null } | { valid: false; error: string };

/** Accept either no coordinates or a complete numeric pair within geographic bounds. */
export function parseCoordinates(latValue: unknown, lngValue: unknown): ParsedCoordinates {
  const empty = (value: unknown) => value === undefined || value === null || value === "";
  if (empty(latValue) && empty(lngValue)) return { valid: true, lat: null, lng: null };
  if (empty(latValue) || empty(lngValue)) return { valid: false, error: "Enter both latitude and longitude, or leave both blank." };
  const parseNumber = (value: unknown): number | null => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const lat = parseNumber(latValue);
  const lng = parseNumber(lngValue);
  if (lat === null || lng === null) return { valid: false, error: "Latitude and longitude must be valid decimal numbers." };
  if (lat < -90 || lat > 90) return { valid: false, error: "Latitude must be between -90 and 90." };
  if (lng < -180 || lng > 180) return { valid: false, error: "Longitude must be between -180 and 180." };
  return { valid: true, lat, lng };
}

export function getDirectionsUrl(location?: string | null, lat?: number | null, lng?: number | null): string | null {
  if (typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
      typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
  }
  const address = location?.trim();
  return address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;
}
