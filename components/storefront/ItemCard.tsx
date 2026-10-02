/**
 * Item card & price display (§8, §10, §11, §24)
 *
 * Shared by every section and by the catalogue page, so a product looks identical wherever
 * the customer meets it. Client-safe: it is rendered on the server for the first paint and
 * reused client-side for filtering.
 */

import Link from "next/link";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";
import { formatDuration, formatKES } from "@/lib/format";
import { AddToCartButton } from "./CartProvider";

/** Price display that respects quote-based and range pricing (§12). */
export function ItemPrice({ item, showWas = true }: { item: StorefrontItem; showWas?: boolean }) {
  if (item.pricingType === "QUOTE" || item.price === null) {
    return <span className="eb-price">{item.priceLabel || "Request a quote"}</span>;
  }
  const to = item.kind === "service" ? null : null;
  void to;
  return (
    <span className="eb-price">
      {item.kind === "service" && item.priceLabel && !item.priceLabel.startsWith("KES") ? `${item.priceLabel}` : formatKES(item.price)}
      {showWas && item.wasPrice ? <span className="eb-price--was">{formatKES(item.wasPrice)}</span> : null}
    </span>
  );
}

export function ItemCard({ item, data }: { item: StorefrontItem; data: StorefrontData }) {
  const href = `/b/${data.business.slug}/item/${item.id}`;
  const canAdd = data.profile.capabilities.includes("commerce") && item.kind === "product" && item.price !== null;
  const soldOut = item.kind === "product" && (item.stockStatus === "OUT_OF_STOCK" || item.stockStatus === "DISCONTINUED");

  return (
    <article className={`eb-card eb-card--${data.theme.treatment.cardStyle}`}>
      <Link href={href} className="eb-card__media" aria-label={item.name} tabIndex={-1}>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.name} loading="lazy" decoding="async" />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--eb-muted)", fontSize: "0.8rem" }}>No photo yet</div>
        )}
        {item.isFeatured ? <span className="eb-card__badge">Featured</span> : null}
        {soldOut ? <span className="eb-card__badge">Sold out</span> : null}
      </Link>
      <div className="eb-card__body">
        {item.category ? <span className="eb-eyebrow">{item.category}</span> : null}
        <h3 className="eb-card__title">
          <Link href={href}>{item.name}</Link>
        </h3>
        {item.description ? <p className="eb-card__desc">{item.description}</p> : null}
        {item.durationMinutes ? <p className="eb-card__meta">{formatDuration(item.durationMinutes)}</p> : null}
        <div className="eb-card__foot">
          <ItemPrice item={item} />
          {canAdd && !soldOut ? (
            <AddToCartButton
              productId={item.id}
              name={item.name}
              unitPriceKES={item.price}
              imageUrl={item.imageUrl}
              label={data.profile.cta.add}
            />
          ) : (
            <Link href={href} className="eb-btn eb-btn--outline eb-btn--sm">
              {item.kind === "service" ? (data.profile.capabilities.includes("booking") ? "Book" : "View") : "View"}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
