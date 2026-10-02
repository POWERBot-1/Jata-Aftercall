"use client";

/**
 * Product / service / property detail (§8, §10, §11, §24, §31)
 *
 * Category-shaped interaction: a fashion item asks for size and colour, a dish asks for
 * add-ons, a property asks for a viewing request. The same component serves all of them;
 * the experience profile decides which controls exist (§6, §17).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StorefrontItem } from "@/lib/experience/storefront";
import { useCart } from "./CartProvider";
import { trackEvent } from "./Track";
import { formatDuration, formatKES } from "@/lib/format";

export function ItemDetailClient({
  item,
  slug,
  businessId,
  capabilities,
  cta,
  itemNoun,
  related,
}: {
  item: StorefrontItem;
  slug: string;
  businessId: string;
  capabilities: string[];
  cta: { add: string; primary: string; enquire: string };
  itemNoun: string;
  related: Array<{ id: string; name: string; price: number | null; imageUrl: string | null }>;
}) {
  const cart = useCart();
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [added, setAdded] = useState(false);

  const optionGroups = Object.entries(item.variantOptions || {});
  const commerce = capabilities.includes("commerce");
  const booking = capabilities.includes("booking");

  const selectedVariant = useMemo(() => {
    if (item.variants.length === 0) return null;
    const match = item.variants.find((variant) =>
      Object.entries(selectedOptions).every(([group, value]) => String((variant.options as Record<string, string>)?.[group] ?? "") === value),
    );
    // A product with a single flat variant list (e.g. "Red / M") still resolves by label.
    return match || (optionGroups.length === 0 ? item.variants.find((variant) => variant.label === selectedOptions.variant) || item.variants[0] : null);
  }, [item.variants, selectedOptions, optionGroups.length]);

  const addOns = item.addOns.filter((addOn) => addOnIds.includes(addOn.id));
  const unitPrice = (selectedVariant?.priceKES ?? item.price) ?? 0;
  const addOnTotal = addOns.reduce((sum, addOn) => sum + addOn.priceKES, 0);
  const lineTotal = (unitPrice + addOnTotal) * quantity;

  const soldOut = item.kind === "product" && (item.stockStatus === "OUT_OF_STOCK" || item.stockStatus === "DISCONTINUED");
  const variantLabel = [selectedVariant?.label, addOns.length ? `+ ${addOns.map((a) => a.name).join(", ")}` : ""].filter(Boolean).join(" · ");

  function addToCart() {
    cart.add({
      productId: item.id,
      variantId: selectedVariant?.id,
      variantLabel: variantLabel || undefined,
      name: item.name,
      unitPriceKES: unitPrice,
      quantity,
      addOns,
      imageUrl: item.imageUrl,
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2400);
  }

  return (
    <div className="eb-grid" style={{ gridTemplateColumns: "1fr", gap: "clamp(1.5rem, 4vw, 3rem)", alignItems: "start" }}>
      <div style={{ display: "grid", gap: "2rem" }} className="eb-detail-grid">
        <div>
          <div style={{ overflow: "hidden", borderRadius: "var(--eb-radius-card)", background: "var(--eb-surface-muted)" }}>
            {item.images.length > 0 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.images[Math.min(activeImage, item.images.length - 1)]}
                alt={item.name}
                style={{ width: "100%", aspectRatio: "var(--eb-media-ratio)", objectFit: "cover" }}
                fetchPriority="high"
              />
            ) : (
              <div style={{ display: "grid", placeItems: "center", aspectRatio: "var(--eb-media-ratio)", color: "var(--eb-muted)" }}>
                No photo yet
              </div>
            )}
          </div>
          {item.images.length > 1 ? (
            <div className="eb-gallery" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(4.5rem, 1fr))", marginTop: "0.75rem" }}>
              {item.images.slice(0, 6).map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  aria-label={`View image ${index + 1}`}
                  aria-current={activeImage === index}
                  style={{
                    padding: 0,
                    border: activeImage === index ? "2px solid var(--eb-primary)" : "1px solid var(--eb-border)",
                    borderRadius: "var(--eb-radius)",
                    overflow: "hidden",
                    background: "none",
                    cursor: "pointer",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" style={{ aspectRatio: "1 / 1", objectFit: "cover", width: "100%" }} loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          {item.category ? <span className="eb-eyebrow">{item.category}</span> : null}
          <h1 className="eb-h2" style={{ marginTop: "0.4rem" }}>{item.name}</h1>
          {item.brand ? <p className="eb-muted">{item.brand}</p> : null}

          <p style={{ margin: "1rem 0 0", fontSize: "1.35rem", fontWeight: 700 }}>
            {item.pricingType === "QUOTE" || item.price === null ? (
              item.priceLabel || "Request a quote"
            ) : (
              <>
                {formatKES(unitPrice)}
                {item.wasPrice ? <span className="eb-price--was">{formatKES(item.wasPrice)}</span> : null}
              </>
            )}
          </p>

          {[item.portionSize, item.prepMinutes ? `Ready in ~${item.prepMinutes} min` : null, formatDuration(item.durationMinutes), item.staffName ? `With ${item.staffName}` : null]
            .filter(Boolean)
            .length > 0 ? (
            <p className="eb-muted">
              {[item.portionSize, item.prepMinutes ? `Ready in ~${item.prepMinutes} min` : null, formatDuration(item.durationMinutes), item.staffName ? `With ${item.staffName}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}

          {item.description ? <p style={{ whiteSpace: "pre-line", marginTop: "1.25rem" }}>{item.description}</p> : null}

          {item.ingredients ? (
            <p className="eb-muted" style={{ marginTop: "1rem" }}>
              <strong>Ingredients:</strong> {item.ingredients}
            </p>
          ) : null}

          {/* ── Variants (§8, §10, §17) ── */}
          {optionGroups.length > 0 ? (
            <div style={{ marginTop: "1.75rem", display: "grid", gap: "1.25rem" }}>
              {optionGroups.map(([group, values]) => (
                <fieldset key={group} style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="eb-label">{group}</legend>
                  <div className="eb-chip-row">
                    {values.map((value) => {
                      const active = selectedOptions[group] === value;
                      const variant = item.variants.find((entry) => String((entry.options as Record<string, string>)?.[group] ?? "") === value);
                      const unavailable = variant ? variant.stockStatus === "OUT_OF_STOCK" : false;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={`eb-chip ${active ? "eb-chip--active" : ""}`}
                          aria-pressed={active}
                          disabled={unavailable}
                          style={unavailable ? { opacity: 0.4, textDecoration: "line-through" } : undefined}
                          onClick={() => setSelectedOptions((current) => ({ ...current, [group]: value }))}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : item.variants.length > 1 ? (
            <fieldset style={{ border: 0, padding: 0, margin: "1.75rem 0 0" }}>
              <legend className="eb-label">Options</legend>
              <div className="eb-chip-row">
                {item.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    className={`eb-chip ${selectedOptions.variant === variant.label ? "eb-chip--active" : ""}`}
                    aria-pressed={selectedOptions.variant === variant.label}
                    disabled={variant.stockStatus === "OUT_OF_STOCK"}
                    onClick={() => setSelectedOptions({ variant: variant.label })}
                  >
                    {variant.label}
                    {variant.priceKES ? ` · ${formatKES(variant.priceKES)}` : ""}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* ── Add-ons (§7) ── */}
          {item.addOns.length > 0 ? (
            <fieldset style={{ border: 0, padding: 0, margin: "1.75rem 0 0" }}>
              <legend className="eb-label">Add-ons</legend>
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {item.addOns.map((addOn) => (
                  <label key={addOn.id} style={{ display: "flex", alignItems: "center", gap: "0.7rem", fontSize: "0.95rem" }}>
                    <input
                      type="checkbox"
                      checked={addOnIds.includes(addOn.id)}
                      onChange={(event) =>
                        setAddOnIds((current) => (event.target.checked ? [...current, addOn.id] : current.filter((id) => id !== addOn.id)))
                      }
                      style={{ width: "1.1rem", height: "1.1rem" }}
                    />
                    <span style={{ flex: 1 }}>{addOn.name}</span>
                    <span className="eb-muted">+ {formatKES(addOn.priceKES)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* ── Actions (§43) ── */}
          <div style={{ marginTop: "2rem", display: "grid", gap: "0.6rem" }}>
            {commerce && item.kind === "product" && item.price !== null ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <button type="button" className="eb-btn eb-btn--outline eb-btn--sm" onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Decrease quantity">
                      −
                    </button>
                    <span aria-live="polite" style={{ minWidth: "1.5rem", textAlign: "center" }}>{quantity}</span>
                    <button type="button" className="eb-btn eb-btn--outline eb-btn--sm" onClick={() => setQuantity(Math.min(99, quantity + 1))} aria-label="Increase quantity">
                      +
                    </button>
                  </div>
                  <span style={{ fontWeight: 700 }}>{formatKES(lineTotal)}</span>
                </div>
                <button type="button" className="eb-btn eb-btn--block" onClick={addToCart} disabled={soldOut}>
                  {soldOut ? "Sold out" : `${cta.add} · ${formatKES(lineTotal)}`}
                </button>
                <p className="eb-muted" aria-live="polite" style={{ minHeight: "1.25rem" }}>
                  {added ? "Added to your order ✓" : ""}
                </p>
              </>
            ) : null}

            {booking && item.kind === "service" ? (
              <Link href={`/b/${slug}/book?service=${item.id}`} className="eb-btn eb-btn--block">
                {item.pricingType === "QUOTE" ? cta.enquire : "Book this"}
              </Link>
            ) : null}

            {!commerce && !booking && item.kind === "product" ? (
              <Link href={`/b/${slug}/book?item=${item.id}`} className="eb-btn eb-btn--block">
                {cta.enquire}
              </Link>
            ) : null}

            {!commerce && item.kind === "service" ? (
              <Link href={`/b/${slug}/book?service=${item.id}`} className="eb-btn eb-btn--block">
                {cta.enquire}
              </Link>
            ) : null}

            <Link href={`/b/${slug}/shop`} className="eb-btn eb-btn--outline eb-btn--block">
              Back to {itemNoun === "Property" ? "listings" : "the catalogue"}
            </Link>
          </div>

          {related.length > 0 ? (
            <div style={{ marginTop: "2.5rem" }}>
              <h2 className="eb-h3" style={{ marginBottom: "1rem" }}>More like this</h2>
              <div className="eb-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))", gap: "0.75rem" }}>
                {related.map((entry) => (
                  <Link key={entry.id} href={`/b/${slug}/item/${entry.id}`} className="eb-card">
                    <div className="eb-card__media" style={{ aspectRatio: "1 / 1" }}>
                      {entry.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.imageUrl} alt={entry.name} loading="lazy" />
                      ) : null}
                    </div>
                    <div className="eb-card__body" style={{ padding: "0.7rem 0.8rem 0.9rem" }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem" }}>{entry.name}</p>
                      {entry.price ? <p className="eb-card__meta" style={{ margin: 0 }}>{formatKES(entry.price)}</p> : null}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Fires a view event for the item when the customer lands on it (§31, §32). */
export function ItemViewTracker({ businessId, itemId, kind }: { businessId: string; itemId: string; kind: "product" | "service" }) {
  if (typeof window === "undefined") return null;
  trackEvent(businessId, kind === "service" ? "SERVICE_VIEW" : "PRODUCT_VIEW", itemId);
  return null;
}
