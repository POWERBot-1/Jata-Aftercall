/** Functional business cards/lists shared by home, filtered catalogue and the owner's same-route preview. */
import Link from "next/link";
import type { StorefrontItem } from "@/lib/experience/storefront";
import type { ItemCardData } from "@/lib/experience/catalogue";
import { BUSINESS_RECIPES, recipeFacts, type BusinessRecipeConfig } from "@/lib/experience/businessRecipes";
import { ItemPrice } from "./ItemCard";
import { AddToCartButton } from "./CartProvider";

export function BusinessCatalogue({ items, data, config, layout }: { items: StorefrontItem[]; data: ItemCardData; config: BusinessRecipeConfig; layout?: string }) {
  const recipe = BUSINESS_RECIPES.find((entry) => entry.key === config.key);
  if (!recipe) return null;
  const presentation = layout === "grid" ? "product-grid" : layout === "list" || layout === "compact" ? recipe.category === "salon" ? "service-list" : recipe.category === "food" ? "menu-list" : "product-list" : recipe.layout;
  return (
    <ul className={`eb-business-recipe eb-business-recipe--${presentation}`} data-business-recipe={recipe.key} data-recipe-version={config.version}>
      {items.map((item) => {
        const href = `/b/${data.business.slug}/item/${item.id}`;
        const unavailable = item.kind === "product" && ["OUT_OF_STOCK", "DISCONTINUED"].includes(item.stockStatus);
        const options = item.variants.length > 0 || item.addOns.length > 0;
        const cart = recipe.source === "products" && item.kind === "product" && data.profile.capabilities.includes("commerce") &&
          item.pricingType !== "QUOTE" && item.price !== null && !unavailable && !options;
        const book = item.kind === "service" && item.bookingEnabled && data.profile.capabilities.includes("booking") && item.pricingType !== "QUOTE" && item.price !== null;
        const action = cart ? "cart" : book ? "book" : options && !unavailable ? "options" : item.pricingType === "QUOTE" ? "enquire" : "details";
        return (
          <li key={item.id}>
            <article className={`eb-card eb-card--${data.theme.treatment.cardStyle} eb-recipe-item`} data-recipe-item={item.id}>
              {item.imageUrl ? (
                <Link href={href} className="eb-recipe-item__media" tabIndex={-1} aria-label={item.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.imageUrl} alt={item.name} loading="lazy" decoding="async" />
                </Link>
              ) : <div className="eb-recipe-item__media eb-recipe-item__placeholder" aria-hidden="true">No photo yet</div>}
              <div className="eb-recipe-item__body">
                {item.category ? <p className="eb-eyebrow">{item.category}</p> : null}
                <h3 className="eb-card__title"><Link href={href}>{item.name}</Link></h3>
                {item.description ? <p className="eb-card__desc">{item.description}</p> : null}
                <dl className="eb-recipe-facts">
                  {recipeFacts(item, config).map((fact) => <div key={fact.key} data-recipe-detail={fact.key}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
                </dl>
                <div className="eb-recipe-item__action" data-recipe-action={action}>
                  <ItemPrice item={item} />
                  {cart ? <AddToCartButton productId={item.id} name={item.name} unitPriceKES={item.price!} imageUrl={item.imageUrl} label={data.profile.cta.add} /> :
                    <Link className="eb-btn eb-btn--outline eb-btn--sm" href={book ? `/b/${data.business.slug}/book?service=${encodeURIComponent(item.id)}` : href}>
                      {book ? "Book this service" : action === "options" ? "Choose options" : action === "enquire" ? "Request a quote" : "View details"}
                    </Link>}
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
