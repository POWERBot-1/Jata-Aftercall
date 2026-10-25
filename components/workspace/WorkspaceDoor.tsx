/**
 * `<img>` is used deliberately where the image URL is owner-supplied (a business cover or
 * logo) or comes from a fixed local registry with explicit width/height. next/image would
 * require the optimizer to fetch arbitrary remote URLs and would not respect the aspect-ratio
 * container these images fill, so the raw element with `loading="lazy"` is the safer choice.
 */
/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";
import type { WorkspacePhoto } from "@/lib/workspaceImagery";
import { safeImageUrl } from "@/lib/workspaceImagery";

/**
 * A "door" into a per-business product (Website Studio, Business POS).
 *
 * One photograph, the business name, its real state pills, one sentence about what needs
 * attention, and the links that act on it. Shared by both product doors so the two lists can
 * never drift into different layouts, and shared with the visual-regression harness.
 */
export function WorkspaceDoor({
  coverUrl,
  photo,
  title,
  meta,
  pills,
  note,
  actions,
  sizes = "(min-width: 720px) 12rem, 100vw",
}: {
  coverUrl?: string | null;
  photo: WorkspacePhoto;
  title: ReactNode;
  meta: ReactNode;
  pills?: ReactNode;
  note?: ReactNode;
  actions: ReactNode;
  sizes?: string;
}) {
  const cover = safeImageUrl(coverUrl);
  return (
    <li className="ws-door">
      <div className="ws-door__media">
        {cover ? (
          // The owner's own cover: decorative, the name is right beside it.
          <img src={cover} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        ) : (
          <picture>
            {photo.webp || photo.webpSrcSet ? <source type="image/webp" srcSet={photo.webpSrcSet ?? photo.webp} sizes={sizes} /> : null}
            <img
              src={photo.src}
              srcSet={photo.srcSet}
              sizes={sizes}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
            />
          </picture>
        )}
      </div>
      <div className="ws-door__body">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="ws-door__title">{title}</h2>
            <p className="ws-door__meta">{meta}</p>
          </div>
          {pills ? <div className="ws-door__pills">{pills}</div> : null}
        </div>
        {note ? <div className="ws-door__pills">{note}</div> : null}
        <div className="ws-door__actions">{actions}</div>
      </div>
    </li>
  );
}
