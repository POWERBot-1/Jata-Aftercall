"use client";

/**
 * Catalogue browsing (§10, §11, §31)
 *
 * Search, filter and sort run on the device against data already sent by the server, so a
 * customer on a slow connection gets instant results. Searches are recorded as analytics
 * events — never as personal data (§57).
 */

import { useMemo, useState } from "react";
import type { StorefrontItem } from "@/lib/experience/storefront";
import { ItemCard } from "./ItemCard";
import { trackEvent } from "./Track";
import { formatKES } from "@/lib/format";

export type CatalogueFilters = {
  categories: string[];
  priceBands: Array<{ label: string; min: number; max: number }>;
  showStockFilter: boolean;
  searchPlaceholder: string;
  itemNoun: string;
  itemNounPlural: string;
};

export function CatalogueClient({
  items,
  data,
  filters,
  initialCategory,
  businessId,
}: {
  items: StorefrontItem[];
  data: { business: { slug: string }; profile: { capabilities: string[]; cta: { cart: string } } };
  filters: CatalogueFilters;
  initialCategory?: string;
  businessId: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(initialCategory || "");
  const [priceBand, setPriceBand] = useState("");
  const [availability, setAvailability] = useState<"ALL" | "AVAILABLE">("ALL");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let result = items;
    if (category) result = result.filter((item) => item.category === category);
    if (priceBand) {
      const band = filters.priceBands.find((entry) => entry.label === priceBand);
      if (band) result = result.filter((item) => item.price !== null && item.price >= band.min && item.price <= band.max);
    }
    if (availability === "AVAILABLE") result = result.filter((item) => item.stockStatus !== "OUT_OF_STOCK" && item.stockStatus !== "DISCONTINUED");
    if (needle) {
      result = result.filter((item) =>
        [item.name, item.description, item.category, item.brand, ...(item.tags || [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    return result;
  }, [items, category, priceBand, availability, query, filters.priceBands]);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", marginBottom: "1.5rem" }}>
        <label className="eb-field" style={{ flex: "1 1 16rem", marginBottom: 0 }}>
          <span className="eb-sr">Search</span>
          <input
            type="search"
            className="eb-input"
            placeholder={filters.searchPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.length === 3) trackEvent(businessId, "SEARCH");
            }}
            aria-label={filters.searchPlaceholder}
          />
        </label>
        {filters.showStockFilter ? (
          <button
            type="button"
            className={`eb-chip ${availability === "AVAILABLE" ? "eb-chip--active" : ""}`}
            aria-pressed={availability === "AVAILABLE"}
            onClick={() => setAvailability(availability === "AVAILABLE" ? "ALL" : "AVAILABLE")}
          >
            In stock only
          </button>
        ) : null}
      </div>

      {filters.categories.length > 0 ? (
        <div className="eb-chip-row" style={{ marginBottom: "1.25rem" }}>
          <button type="button" className={`eb-chip ${category === "" ? "eb-chip--active" : ""}`} aria-pressed={category === ""} onClick={() => setCategory("")}>
            All
          </button>
          {filters.categories.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`eb-chip ${category === entry ? "eb-chip--active" : ""}`}
              aria-pressed={category === entry}
              onClick={() => setCategory(entry)}
            >
              {entry}
            </button>
          ))}
        </div>
      ) : null}

      {filters.priceBands.length > 0 ? (
        <div className="eb-chip-row" style={{ marginBottom: "1.75rem" }}>
          <button type="button" className={`eb-chip ${priceBand === "" ? "eb-chip--active" : ""}`} aria-pressed={priceBand === ""} onClick={() => setPriceBand("")}>
            Any price
          </button>
          {filters.priceBands.map((band) => (
            <button
              key={band.label}
              type="button"
              className={`eb-chip ${priceBand === band.label ? "eb-chip--active" : ""}`}
              aria-pressed={priceBand === band.label}
              onClick={() => setPriceBand(band.label)}
            >
              {band.label}
            </button>
          ))}
        </div>
      ) : null}

      <p className="eb-muted" style={{ marginBottom: "1rem" }} aria-live="polite">
        {visible.length} {visible.length === 1 ? filters.itemNoun.toLowerCase() : filters.itemNounPlural.toLowerCase()}
      </p>

      {visible.length === 0 ? (
        <div className="eb-empty">
          <h3 className="eb-h3">Nothing matches that yet</h3>
          <p>Try a different search, or clear the filters to see everything.</p>
        </div>
      ) : (
        <div className="eb-grid eb-grid--auto">
          {visible.map((item) => (
            <ItemCard key={item.id} item={item} data={data as never} />
          ))}
        </div>
      )}
    </div>
  );
}

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
