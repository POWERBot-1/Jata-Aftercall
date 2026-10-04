/**
 * Section renderers (§6, §7–§12, §20)
 *
 * One set of components renders every category. What changes per category is the data,
 * the terminology, the ordering of sections and the theme — never the components (§51).
 *
 * These are server components: the customer's first paint needs no client JavaScript.
 */

import Link from "next/link";
import type { ExperienceSection } from "@/lib/experience/types";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";
import { formatDuration } from "@/lib/format";
import { formatOpeningHours } from "@/lib/openingHours";
import { getDirectionsUrl } from "@/lib/location";
import { getWhatsAppUrl, normalizeKePhone } from "@/lib/phone";
import { ItemCard, ItemPrice } from "./ItemCard";
import { AddToCartButton } from "./CartProvider";
import { ContactTracker } from "./Track";

function SectionShell({
  id,
  title,
  subtitle,
  children,
  tone = "default",
}: {
  id: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  tone?: "default" | "muted";
}) {
  return (
    <section
      id={id}
      className="eb-section"
      aria-labelledby={title ? `${id}-title` : undefined}
      style={tone === "muted" ? { background: "var(--eb-surface-muted)" } : undefined}
    >
      <div className="eb-container">
        {title || subtitle ? (
          <header className="eb-section-head">
            <div>
              {title ? (
                <h2 id={`${id}-title`} className="eb-h2">
                  {title}
                </h2>
              ) : null}
              {subtitle ? <p className="eb-lede">{subtitle}</p> : null}
            </div>
          </header>
        ) : null}
        {children}
      </div>
    </section>
  );
}

function ItemRow({ item, data }: { item: StorefrontItem; data: StorefrontData }) {
  const href = `/b/${data.business.slug}/item/${item.id}`;
  const canAdd = data.profile.capabilities.includes("commerce") && item.kind === "product" && item.price !== null;
  const soldOut = item.kind === "product" && (item.stockStatus === "OUT_OF_STOCK" || item.stockStatus === "DISCONTINUED");
  return (
    <div className="eb-row">
      {item.imageUrl ? (
        <Link href={href} className="eb-row__media" tabIndex={-1} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
        </Link>
      ) : null}
      <div className="eb-row__main">
        <h3 className="eb-card__title">
          <Link href={href}>{item.name}</Link>
        </h3>
        {item.description ? <p className="eb-card__desc">{item.description}</p> : null}
        <p className="eb-card__meta">
          {[item.portionSize, item.prepMinutes ? `Ready in ~${item.prepMinutes} min` : null, formatDuration(item.durationMinutes)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="eb-row__side">
        <ItemPrice item={item} />
        {canAdd && !soldOut ? (
          <AddToCartButton productId={item.id} name={item.name} unitPriceKES={item.price} imageUrl={item.imageUrl} label="Add" />
        ) : (
          <Link href={href} className="eb-btn eb-btn--outline eb-btn--sm">
            {item.kind === "service" ? "Book" : "View"}
          </Link>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="eb-empty">
      <h3 className="eb-h3">{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export function SectionRenderer({ section, data }: { section: ExperienceSection; data: StorefrontData }) {
  const { profile } = data;
  const catalogue = profile.capabilities.includes("commerce") || profile.capabilities.includes("catalogue") ? data.items : data.services;
  const featured = (profile.capabilities.includes("booking") ? data.services : data.items).filter((item) => item.isFeatured);
  const base = featured.length > 0 ? featured : (profile.capabilities.includes("booking") ? data.services : data.items).slice(0, 6);

  switch (section.type) {
    case "featured": {
      const limit = Math.max(2, Math.min(12, section.limit || 6));
      const items = base.slice(0, limit);
      return (
        <SectionShell id={section.id} title={section.title} subtitle={section.subtitle}>
          {items.length === 0 ? (
            <EmptyState
              title={`Your ${profile.itemNounPlural.toLowerCase()} will appear here`}
              body={`Add your first ${profile.itemNoun.toLowerCase()} in the dashboard and it shows up here instantly.`}
            />
          ) : (
            <div className={`eb-grid ${section.layout === "list" ? "eb-grid--list" : "eb-grid--auto"}`}>
              {section.layout === "list"
                ? items.map((item) => <ItemRow key={item.id} item={item} data={data} />)
                : items.map((item) => <ItemCard key={item.id} item={item} data={data} />)}
            </div>
          )}
        </SectionShell>
      );
    }

    case "menu": {
      const grouped = new Map<string, StorefrontItem[]>();
      for (const item of catalogue) {
        const key = item.category || profile.itemNounPlural;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(item);
      }
      if (grouped.size === 0) {
        return (
          <SectionShell id={section.id} title={section.title} subtitle={section.subtitle}>
            <EmptyState
              title={`Nothing on the ${profile.catalogueLabel.toLowerCase()} yet`}
              body="Add items in your dashboard and they appear here, grouped by category."
            />
          </SectionShell>
        );
      }
      return (
        <>
          {Array.from(grouped.entries()).map(([category, items]) => (
            <SectionShell
              key={category}
              id={`${section.id}-${category.replace(/\s+/g, "-").toLowerCase()}`}
              title={`${section.title || profile.catalogueLabel} — ${category}`}
            >
              <div className="eb-grid eb-grid--list">
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} data={data} />
                ))}
              </div>
            </SectionShell>
          ))}
        </>
      );
    }

    case "services": {
      const items = data.services.filter((service) => !section.filter || service.category === section.filter);
      return (
        <SectionShell id={section.id} title={section.title} subtitle={section.subtitle} tone="muted">
          {items.length === 0 ? (
            <EmptyState title="No services listed yet" body="Add the services you offer, with prices or durations, so customers can book." />
          ) : (
            <div className={section.layout === "grid" ? "eb-grid eb-grid--auto" : "eb-grid eb-grid--list"}>
              {section.layout === "grid"
                ? items.map((item) => <ItemCard key={item.id} item={item} data={data} />)
                : items.map((item) => <ItemRow key={item.id} item={item} data={data} />)}
            </div>
          )}
        </SectionShell>
      );
    }

    case "categories": {
      if (data.categories.length === 0) return null;
      return (
        <SectionShell id={section.id} title={section.title || "Shop by category"}>
          <div className="eb-chip-row">
            {data.categories.map((category) => (
              <Link key={category} href={`/b/${data.business.slug}/shop?category=${encodeURIComponent(category)}`} className="eb-chip">
                {category}
              </Link>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "collections": {
      const limit = Math.max(2, Math.min(8, section.limit || 4));
      const collections = data.categories.slice(0, limit);
      if (collections.length === 0) return null;
      return (
        <SectionShell id={section.id} title={section.title} subtitle={section.subtitle}>
          <div className="eb-grid eb-grid--4">
            {collections.map((category) => {
              const cover = data.items.find((item) => item.category === category && item.imageUrl)?.imageUrl || null;
              const count = data.items.filter((item) => item.category === category).length;
              return (
                <Link key={category} href={`/b/${data.business.slug}/shop?category=${encodeURIComponent(category)}`} className="eb-card eb-card--media">
                  <div className="eb-card__media">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt={category} loading="lazy" decoding="async" />
                    ) : null}
                  </div>
                  <div className="eb-card__body">
                    <h3 className="eb-card__title">{category}</h3>
                    <p className="eb-card__meta">
                      {count} {count === 1 ? profile.itemNoun.toLowerCase() : profile.itemNounPlural.toLowerCase()}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </SectionShell>
      );
    }

    case "properties": {
      const limit = Math.max(1, Math.min(24, section.limit || 12));
      const listings = data.items.slice(0, limit);
      return (
        <SectionShell id={section.id} title={section.title || "Available properties"} subtitle={section.subtitle}>
          {listings.length === 0 ? (
            <EmptyState title="No listings yet" body="Add a property with photos, price and location to start receiving enquiries." />
          ) : (
            <div className="eb-grid eb-grid--3">
              {listings.map((item) => (
                <ItemCard key={item.id} item={item} data={data} />
              ))}
            </div>
          )}
        </SectionShell>
      );
    }

    case "offers": {
      const offer = data.offer;
      const title = section.title || offer?.title;
      if (!title) return null;
      return (
        <SectionShell id={section.id}>
          <div className="eb-offer">
            <div>
              {offer?.badge ? <span className="eb-eyebrow">{offer.badge}</span> : null}
              <h2 className="eb-h2" style={{ marginTop: "0.5rem" }}>
                {title}
              </h2>
              <p className="eb-lede">{section.subtitle || offer?.subtitle}</p>
              <div style={{ marginTop: "1.5rem" }}>
                <Link href={`/b/${data.business.slug}/shop`} className="eb-btn">
                  {offer?.ctaLabel || profile.cta.primary}
                </Link>
              </div>
            </div>
            {section.imageUrl || offer?.imageUrl ? (
              <div className="eb-offer__media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={(section.imageUrl || offer?.imageUrl) as string} alt={title} loading="lazy" decoding="async" />
              </div>
            ) : null}
          </div>
        </SectionShell>
      );
    }

    case "about": {
      const body = section.body || data.business.description || data.document.brand.description;
      if (!body && !section.imageUrl) return null;
      return (
        <SectionShell id={section.id} title={section.title || "About us"}>
          <div className="eb-offer">
            {section.imageUrl ? (
              <div className="eb-offer__media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={section.imageUrl} alt={section.title || data.business.name} loading="lazy" decoding="async" />
              </div>
            ) : null}
            <div>
              <p style={{ whiteSpace: "pre-line", margin: 0, fontSize: "1.05rem" }}>{body}</p>
            </div>
          </div>
        </SectionShell>
      );
    }

    case "gallery": {
      const images = (section.images || []).filter((image) => image.url).slice(0, 24);
      if (images.length === 0) return null;
      return (
        <SectionShell id={section.id} title={section.title || "Gallery"}>
          <div className="eb-gallery">
            {images.map((image, index) => (
              <figure key={`${image.url}-${index}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={image.alt || `${data.business.name} photo ${index + 1}`} loading="lazy" decoding="async" />
              </figure>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "testimonials": {
      const quotes = (section.items || []).filter((item) => item.quote);
      if (quotes.length === 0) return null;
      return (
        <SectionShell id={section.id} title={section.title || "What customers say"} tone="muted">
          <div className="eb-grid eb-grid--3">
            {quotes.slice(0, 6).map((quote, index) => (
              <blockquote key={index} className="eb-card" style={{ padding: "1.5rem", margin: 0 }}>
                <p style={{ margin: 0, fontSize: "1.02rem" }}>“{quote.quote}”</p>
                {quote.author ? <footer className="eb-card__meta" style={{ marginTop: "0.75rem" }}>— {quote.author}</footer> : null}
              </blockquote>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "steps": {
      const steps = (section.items || []).filter((item) => item.title);
      if (steps.length === 0) return null;
      return (
        <SectionShell id={section.id} title={section.title || "How it works"} tone="muted">
          <ol className="eb-grid eb-grid--3" style={{ listStyle: "none", counterReset: "jata-step", padding: 0 }}>
            {steps.slice(0, 6).map((step, index) => (
              <li key={index} className="eb-card" style={{ padding: "1.5rem" }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "2.25rem",
                    height: "2.25rem",
                    borderRadius: "999px",
                    background: "var(--eb-accent-soft, rgba(0,0,0,0.06))",
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </span>
                <p style={{ margin: "0.75rem 0 0.25rem", fontWeight: 700 }}>{step.title}</p>
                {step.body ? (
                  <p className="eb-muted" style={{ margin: 0, fontSize: "0.95rem" }}>
                    {step.body}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </SectionShell>
      );
    }

    case "why": {
      const reasons = (section.items || []).filter((item) => item.title);
      if (reasons.length === 0) return null;
      return (
        <SectionShell id={section.id} title={section.title || "Why customers choose us"}>
          <div className="eb-grid eb-grid--3">
            {reasons.slice(0, 6).map((reason, index) => (
              <div key={index} className="eb-card" style={{ padding: "1.5rem" }}>
                <p style={{ margin: 0, fontWeight: 700 }}>{reason.title}</p>
                {reason.body ? (
                  <p className="eb-muted" style={{ marginTop: "0.5rem", fontSize: "0.95rem" }}>
                    {reason.body}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "faq": {
      const entries = (section.items || []).filter((item) => item.question && item.answer);
      if (entries.length === 0) return null;
      return (
        <SectionShell id={section.id} title={section.title || "Common questions"}>
          <div style={{ maxWidth: "44rem" }}>
            {entries.slice(0, 12).map((entry, index) => (
              <details key={index} style={{ borderBottom: "1px solid var(--eb-border)", padding: "1rem 0" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>{entry.question}</summary>
                <p className="eb-muted" style={{ marginTop: "0.6rem" }}>
                  {entry.answer}
                </p>
              </details>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "hours": {
      const rows = formatOpeningHours(
        data.document.settings.openingHours ? JSON.stringify(data.document.settings.openingHours) : null,
      );
      if (rows.length === 0) return null;
      return (
        <SectionShell id={section.id} title={section.title || "Opening hours"}>
          <div className="eb-hours">
            {rows.map((row, index) => (
              <div key={index} className="eb-hours__row">
                <span>{row.label || "Hours"}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        </SectionShell>
      );
    }

    case "location": {
      const location = data.document.settings.location;
      if (!location) return null;
      const mapHref = getDirectionsUrl(location, data.document.settings.lat, data.document.settings.lng);
      return (
        <SectionShell id={section.id} title={section.title || "Find us"} tone="muted">
          <p style={{ fontSize: "1.05rem", margin: 0 }}>{location}</p>
          {section.body ? <p className="eb-muted">{section.body}</p> : null}
          {mapHref ? (
            <div style={{ marginTop: "1.25rem" }}>
              <ContactTracker businessId={data.business.id} eventType="DIRECTIONS_CLICK" href={mapHref} className="eb-btn eb-btn--outline">
                Get directions
              </ContactTracker>
            </div>
          ) : null}
        </SectionShell>
      );
    }

    case "contact": {
      const phone = data.document.settings.phone;
      const whatsapp = normalizeKePhone(data.document.settings.whatsapp || phone);
      const tel = phone ? `tel:${normalizeKePhone(phone) ? `+${normalizeKePhone(phone)}` : phone}` : null;
      return (
        <SectionShell id={section.id} title={section.title || "Get in touch"}>
          {section.body ? <p className="eb-lede">{section.body}</p> : null}
          <div className="eb-contact-grid" style={{ marginTop: "1.5rem" }}>
            {whatsapp ? (
              <ContactTracker
                businessId={data.business.id}
                eventType="WHATSAPP_CLICK"
                href={getWhatsAppUrl(whatsapp, `Hi ${data.business.name}, I found your page and I would like to know more.`)}
                className="eb-contact-tile"
              >
                <span aria-hidden="true">💬</span>
                <span>WhatsApp</span>
              </ContactTracker>
            ) : null}
            {tel ? (
              <ContactTracker businessId={data.business.id} eventType="CALL_CLICK" href={tel} className="eb-contact-tile">
                <span aria-hidden="true">📞</span>
                <span>Call us</span>
              </ContactTracker>
            ) : null}
            {data.document.settings.email ? (
              <a href={`mailto:${data.document.settings.email}`} className="eb-contact-tile">
                <span aria-hidden="true">✉️</span>
                <span>Email</span>
              </a>
            ) : null}
          </div>
        </SectionShell>
      );
    }

    case "cta": {
      return (
        <SectionShell id={section.id}>
          <div className="eb-offer" style={{ textAlign: "center", gridTemplateColumns: "1fr" }}>
            <div>
              <h2 className="eb-h2">{section.title}</h2>
              {section.body ? <p className="eb-lede" style={{ marginInline: "auto" }}>{section.body}</p> : null}
              <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <Link href={section.cta?.href && section.cta.href.startsWith("/") ? section.cta.href : `/b/${data.business.slug}/shop`} className="eb-btn">
                  {section.cta?.label || profile.cta.primary}
                </Link>
              </div>
            </div>
          </div>
        </SectionShell>
      );
    }

    default:
      return null;
  }
}
