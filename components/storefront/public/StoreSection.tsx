/**
 * One section of the public storefront.
 *
 * Every block on the page — services, offers, hours, contact, loyalty, QR — renders through this
 * shell, so the page reads as one designed surface: the same container, the same hairline, the same
 * heading rhythm, the same spacing. Section content is passed in; the chrome is never re-invented
 * per block.
 */

export function StoreSection({
  id,
  eyebrow,
  title,
  lede,
  children,
  action,
  labelledBy,
  motionRecipe,
  className = "",
  ...rest
}: {
  id?: string;
  /** A short uppercase label above the title. Omit where the title already says it. */
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  lede?: React.ReactNode;
  children?: React.ReactNode;
  /** A single control aligned to the heading (a link, a button). */
  action?: React.ReactNode;
  /** Set when the caller supplies its own heading element with an id. */
  labelledBy?: string;
  /** Spacing is the page's business (sections sit in one rhythm); keep it out of the shell. */
  className?: string;
  /** Motion recipe the storefront reveals with (`data-motion-recipe`). */
  motionRecipe?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-motion-recipe={motionRecipe}
      className={`st-section ${className}`.trim()}
      {...rest}
    >
      {eyebrow || title ? (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow ? <p className="st-eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="st-sectionTitle">{title}</h2> : null}
          </div>
          {action ? <div style={{ flex: "none" }}>{action}</div> : null}
        </div>
      ) : null}
      {lede ? <p className="st-sectionLede">{lede}</p> : null}
      {title || eyebrow ? <div style={{ marginTop: "0.85rem" }}>{children}</div> : children}
    </section>
  );
}

export default StoreSection;
