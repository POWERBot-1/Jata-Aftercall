"use client";
import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { parseCoordinates } from "@/lib/location";

export type LocationValue = { location: string; lat: string; lng: string };

/** Round to ~11 m. Enough for directions without storing more precision than needed. */
function round(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

export function locationError(value: LocationValue): string {
  if (value.location.trim().length > 160) return "Location must be 160 characters or fewer.";
  const coordinates = parseCoordinates(value.lat, value.lng);
  return coordinates.valid === false ? coordinates.error : "";
}

/**
 * Location entry with a typed address (always available), optional one-tap device
 * location, manual coordinates as a fallback, inline validation and an on-demand map
 * preview (OpenStreetMap embed — free, no API key, loaded only when asked for).
 */
export function LocationFields({ idPrefix, value, onChange, ids }: {
  idPrefix: string;
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  ids?: { location?: string; lat?: string; lng?: string };
}) {
  const locationId = ids?.location || `${idPrefix}-location`;
  const latId = ids?.lat || `${idPrefix}-lat`;
  const lngId = ids?.lng || `${idPrefix}-lng`;
  const [geoStatus, setGeoStatus] = useState("");
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const coordinates = parseCoordinates(value.lat, value.lng);
  const error = coordinates.valid === false ? coordinates.error : "";
  const hasPoint = coordinates.valid === true && typeof coordinates.lat === "number" && typeof coordinates.lng === "number";

  function useDeviceLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("Your browser can’t share its location. Type your address or landmark instead.");
      return;
    }
    setLocating(true);
    setGeoStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onChange({ ...value, lat: round(position.coords.latitude), lng: round(position.coords.longitude) });
        setGeoStatus("Location added. Check the map preview, then save.");
      },
      (err) => {
        setLocating(false);
        setGeoStatus(err.code === err.PERMISSION_DENIED
          ? "Location permission was blocked. Type your address or landmark instead — customers can still get directions."
          : "We couldn’t get your location. Type your address or landmark instead.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  let mapSrc = "";
  if (hasPoint && coordinates.valid === true) {
    const lat = coordinates.lat as number;
    const lng = coordinates.lng as number;
    const d = 0.004;
    mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`;
  }

  return (
    <div className="space-y-3">
      <Field id={locationId} label="Address or landmark" hint="For example: Kimathi Street, next to Hilton, Nairobi CBD. Leave blank to hide directions.">
        <input maxLength={160} autoComplete="street-address" value={value.location} onChange={(e) => onChange({ ...value, location: e.target.value })} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useDeviceLocation} disabled={locating} className="jata-btn jata-btn-secondary">
          {locating ? "Finding location…" : "Use my current location"}
        </button>
        {hasPoint && (
          <button type="button" onClick={() => setShowMap((s) => !s)} className="jata-btn jata-btn-ghost underline" aria-expanded={showMap}>
            {showMap ? "Hide map preview" : "Show map preview"}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="jata-hint">{geoStatus}</p>
      {showMap && mapSrc && (
        <iframe title="Map preview of your saved location" src={mapSrc} loading="lazy" referrerPolicy="no-referrer" className="h-56 w-full rounded-xl border" />
      )}
      <details className="rounded-xl border p-3" open={Boolean(error)}>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Enter map coordinates manually</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id={latId} label="Latitude" hint="Between -90 and 90, e.g. -1.2833" error={error || undefined}>
            <input inputMode="decimal" value={value.lat} onChange={(e) => onChange({ ...value, lat: e.target.value })} />
          </Field>
          <Field id={lngId} label="Longitude" hint="Between -180 and 180, e.g. 36.8219">
            <input inputMode="decimal" value={value.lng} onChange={(e) => onChange({ ...value, lng: e.target.value })} />
          </Field>
        </div>
        {(value.lat || value.lng) && (
          <button type="button" className="jata-btn jata-btn-ghost mt-2 underline" onClick={() => { onChange({ ...value, lat: "", lng: "" }); setShowMap(false); }}>
            Clear coordinates
          </button>
        )}
      </details>
    </div>
  );
}
