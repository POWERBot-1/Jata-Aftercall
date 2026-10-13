"use client";

/**
 * Catalogue browsing (§10, §11, §31)
 *
 * Search, filter and sort run on the device against data already sent by the server, so a
 * customer on a slow connection gets instant results. Searches are recorded as analytics
 * events — never as personal data (§57).
 */

import { useMemo, useState } from "react";
import type { ItemCardData } from "@/lib/experience/catalogue";
import type { StorefrontItem } from "@/lib/experience/storefront";
import { ItemCard } from "./ItemCard";
import { BusinessCatalogue } from "./BusinessCatalogue";
import { BUSINESS_RECIPES, isEnquiryRecipe, type BusinessRecipeConfig } from "@/lib/experience/businessRecipes";
import { trackEvent } from "./Track";
import { isBookableConsultation } from "@/lib/experience/professionalWorkflow";

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
  recipe,
  recipeLayout,
}: {
  items: StorefrontItem[];
  data: ItemCardData;
  filters: CatalogueFilters;
  initialCategory?: string;
  businessId: string;
  recipe?: BusinessRecipeConfig | null;
  recipeLayout?: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(initialCategory || "");
  const [priceBand, setPriceBand] = useState("");
  const definition = BUSINESS_RECIPES.find((entry) => entry.key === recipe?.key);
  const [duration, setDuration] = useState<"ALL" | "SHORT" | "LONG">("ALL");
  const [requestType, setRequestType] = useState<"ALL" | "BOOK" | "ENQUIRE">("ALL");
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
    if (duration === "SHORT") result = result.filter((item) => item.durationMinutes !== null && item.durationMinutes <= 30);
    if (duration === "LONG") result = result.filter((item) => item.durationMinutes !== null && item.durationMinutes > 30);
    if (requestType === "BOOK") result = result.filter(isBookableConsultation);
    if (requestType === "ENQUIRE") result = result.filter((item) => !isBookableConsultation(item));
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
  }, [items, category, priceBand, availability, query, duration, requestType, filters.priceBands]);

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
            {definition?.availabilityLabel || "In stock only"}
          </button>
        ) : null}
      </div>

      {definition && isEnquiryRecipe(definition.key) ? (
        <div className="eb-chip-row" role="group" aria-label={definition.key === "technical-enquiry" ? "Service request type" : "Professional request type"} style={{ marginBottom: "1rem" }}>
          {([["ALL", "All services"], ["BOOK", definition.key === "technical-enquiry" ? "Book a visit" : "Book a consultation"], ["ENQUIRE", "Request a quote"]] as const).map(([value, label]) => (
            <button key={value} type="button" className={`eb-chip ${requestType === value ? "eb-chip--active" : ""}`} aria-pressed={requestType === value} onClick={() => setRequestType(value)}>{label}</button>
          ))}
        </div>
      ) : null}
      {definition?.source === "services" ? (
        <div className="eb-chip-row" role="group" aria-label="Service duration" style={{ marginBottom: "1rem" }}>
          {([["ALL", "Any duration"], ["SHORT", "30 min or less"], ["LONG", "Over 30 min"]] as const).map(([value, label]) => (
            <button key={value} type="button" className={`eb-chip ${duration === value ? "eb-chip--active" : ""}`} aria-pressed={duration === value} onClick={() => setDuration(value)}>{label}</button>
          ))}
        </div>
      ) : null}

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
      ) : recipe ? (
        <BusinessCatalogue items={visible} data={data} config={recipe} layout={recipeLayout} />
      ) : (
        <div className="eb-grid eb-grid--auto">
          {visible.map((item) => (
            <ItemCard key={item.id} item={item} data={data} />
          ))}
        </div>
      )}
    </div>
  );
}
