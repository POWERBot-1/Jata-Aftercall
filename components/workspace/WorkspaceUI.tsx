/**
 * `<img>` is used deliberately where the image URL is owner-supplied (a business cover or
 * logo) or comes from a fixed local registry with explicit width/height. next/image would
 * require the optimizer to fetch arbitrary remote URLs and would not respect the aspect-ratio
 * container these images fill, so the raw element with `loading="lazy"` is the safer choice.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/ui";
import type { WorkspacePhoto } from "@/lib/workspaceImagery";

/**
 * Workspace presentation primitives.
 *
 * Deliberately server-safe (no hooks, no "use client"): the same hero, panel, stat tile
 * and empty state are used by server pages and by the interactive dashboard, so there is
 * exactly one implementation of each surface across the authenticated product.
 *
 * Everything renders through the `.ws-*` design-system layer in `app/globals.css`; no
 * component here hard-codes a colour, radius or shadow.
 */

/**
 * A responsive photograph.
 *
 * WebP is offered first and the JPEG is the fallback, so an older Android browser still
 * sees the image. `width`/`height` reserve the box (no layout shift), `loading="lazy"` is
 * the default (only the hero opts into eager loading), and the alt text comes from the
 * imagery registry — always an honest description of the illustrative scene.
 *
 * If the file cannot load, the parent surface already has a cream background and the
 * card's own text, so the card remains readable and usable (progressive enhancement).
 */
export function WorkspacePhotoImage({
  photo,
  sizes = "(min-width: 900px) 62vw, 100vw",
  className,
  priority = false,
  position,
}: {
  photo: WorkspacePhoto;
  sizes?: string;
  className?: string;
  priority?: boolean;
  position?: string;
}) {
  return (
    <picture>
      {photo.webp || photo.webpSrcSet ? (
        <source type="image/webp" srcSet={photo.webpSrcSet ?? photo.webp} sizes={sizes} />
      ) : null}
      <img
        src={photo.src}
        srcSet={photo.srcSet}
        sizes={sizes}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        className={className}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        style={position ? { objectPosition: position } : undefined}
        {...(priority ? ({ fetchPriority: "high" } as Record<string, string>) : {})}
      />
    </picture>
  );
}

/**
 * The workspace hero band.
 *
 * One photograph, one serif headline, at most two actions and (optionally) a row of real
 * numbers. It is the visual anchor of every top-level owner screen, so the product reads
 * as one ecosystem instead of a set of unrelated forms.
 */
export function WorkspaceHero({
  kicker,
  title,
  subtitle,
  photo,
  actions,
  stats,
  compact = false,
  meta,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  photo?: WorkspacePhoto;
  actions?: ReactNode;
  stats?: ReactNode;
  compact?: boolean;
  meta?: ReactNode;
}) {
  return (
    <section className={cn("ws-hero", compact && "ws-hero--compact")} aria-label={typeof title === "string" ? title : undefined}>
      {photo ? (
        <div className="ws-hero__media">
          <WorkspacePhotoImage photo={photo} priority sizes="100vw" />
          <span className="ws-hero__scrim" aria-hidden="true" />
        </div>
      ) : null}
      <div className="ws-hero__inner">
        {kicker ? <p className="ws-kicker ws-kicker--light">{kicker}</p> : null}
        <h1 className="ws-hero__title">{title}</h1>
        {subtitle ? <p className="ws-hero__sub">{subtitle}</p> : null}
        {stats ? <dl className="ws-hero__stats">{stats}</dl> : null}
        {actions ? <div className="ws-hero__actions">{actions}</div> : null}
        {meta ? <p className="ws-hero__meta">{meta}</p> : null}
      </div>
    </section>
  );
}

/** One real number inside the hero. Never rendered without a value the server actually has. */
export function WorkspaceHeroStat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="ws-hero__stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint ? <dd className="sr-only">{hint}</dd> : null}
    </div>
  );
}

/**
 * A panel: the workspace's card.
 *
 * `flush` clips a photograph to the panel's rounded corners; `graphite` is the inverted
 * variant used for the one high-contrast section on a page (plans, share, AI).
 */
export function WorkspacePanel({
  title,
  meta,
  action,
  children,
  tone = "paper",
  labelledBy,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  tone?: "paper" | "graphite" | "plain";
  labelledBy?: string;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHead = Boolean(title || meta || action);
  return (
    <section
      className={cn("ws-panel", tone === "graphite" && "ws-panel--graphite", "ws-panel--flush", className)}
      aria-labelledby={labelledBy}
    >
      {hasHead ? (
        <div className="ws-panel__head">
          {title ? (
            <h2 id={labelledBy} className="ws-panel__title">
              {title}
            </h2>
          ) : null}
          {meta ? <p className="ws-section-head__meta">{meta}</p> : null}
          {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn("ws-panel__body", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A stat tile: label, big number, optional hint, coloured left rule per metric. */
export function WorkspaceStat({
  label,
  value,
  hint,
  metric,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  metric?: "views" | "whatsapp" | "calls" | "directions" | "shares";
  icon?: ReactNode;
}) {
  return (
    <div className="ws-stat" data-metric={metric}>
      <div className="ws-stat__top">
        <p className="ws-stat__label">{label}</p>
        {icon ? <span className="ws-stat__icon" aria-hidden="true">{icon}</span> : null}
      </div>
      <p className="ws-stat__value">{value}</p>
      {hint ? <p className="ws-stat__hint">{hint}</p> : null}
    </div>
  );
}

export function WorkspaceSectionHead({ title, meta, action, id }: { title: ReactNode; meta?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="ws-section-head">
      <h2 id={id} className="ws-section-head__title">
        {title}
      </h2>
      {meta ? <p className="ws-section-head__meta">{meta}</p> : null}
      {action}
    </div>
  );
}

/**
 * An empty state with artwork and the one action that fixes it.
 *
 * The photograph is category-specific where the caller knows the category, which keeps
 * the first-run dashboard from feeling like an error page.
 */
export function WorkspaceEmpty({
  title,
  text,
  photo,
  actions,
}: {
  title: ReactNode;
  text?: ReactNode;
  photo?: WorkspacePhoto;
  actions?: ReactNode;
}) {
  return (
    <section className="ws-empty">
      <div>
        <h2 className="ws-empty__title">{title}</h2>
        {text ? <p className="ws-empty__text">{text}</p> : null}
        {actions ? <div className="ws-empty__actions">{actions}</div> : null}
      </div>
      {photo ? (
        <div className="ws-empty__media">
          <WorkspacePhotoImage photo={photo} sizes="(min-width: 820px) 34vw, 92vw" />
        </div>
      ) : null}
    </section>
  );
}

/** A quiet key/value row used for page, plan and contact facts. */
export function WorkspaceFacts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("ws-facts", className)}>{children}</dl>;
}

export function WorkspaceFact({ label, children, icon }: { label: ReactNode; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="ws-fact">
      <dt>
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Skeleton block for the route-level loading UI. */
export function WorkspaceSkeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("ws-skel", className)} />;
}

/**
 * An inline success/error notice for guided workspace forms.
 *
 * One replacement for the hand-rolled, hard-coded light-red `<p style={{…}}>` blocks that used
 * to be copied through the AI Front Desk flow. It renders through the themed `.ws-notice`
 * tokens, so the same component reads correctly in the light and graphite themes. The role is
 * `alert` for an error and `status` for a success message, so assistive tech announces it.
 */
export function WorkspaceNotice({
  tone = "success",
  children,
  className,
}: {
  tone?: "success" | "error";
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn("ws-notice", `ws-notice--${tone}`, className)}>
      {children}
    </p>
  );
}
