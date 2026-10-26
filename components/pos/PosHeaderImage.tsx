"use client";

/**
 * The category-aware POS header image.
 *
 * Attractive but never in the way: it is a short banner on most screens, collapses to a
 * slim strip on the Sell screen (where products, the cart and the total own the space),
 * and can be hidden by hand on any screen. It is decorative beside the real header text,
 * loads lazily, and removes itself if the image fails — a picture must never delay or
 * block a sale, online or off.
 */

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

export type PosHeaderImageData = {
  src: string;
  srcSet?: string;
  webp?: string;
  webpSrcSet?: string;
  alt: string;
  focal: string;
  width?: number;
  height?: number;
};

export function PosHeaderImage({ image }: { image: PosHeaderImageData }) {
  const pathname = usePathname() || "";
  const onSellScreen = /\/sell(\/|$)/.test(pathname);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  if (failed || !image?.src) return null;
  const open = expanded ?? !onSellScreen;

  return (
    <div className="pos-header-image" data-collapsed={open ? undefined : "true"}>
      {open ? (
        <picture>
          {image.webp ? <source srcSet={image.webpSrcSet} type="image/webp" sizes="100vw" /> : null}
          <img
            src={image.src}
            srcSet={image.srcSet}
            sizes="100vw"
            alt={image.alt}
            width={image.width ?? 1200}
            height={image.height ?? 670}
            loading="lazy"
            decoding="async"
            style={{ objectPosition: image.focal }}
            onError={() => setFailed(true)}
          />
        </picture>
      ) : null}
      <button
        type="button"
        className="pos-header-image-toggle"
        aria-expanded={open}
        aria-label={open ? "Make the header image smaller" : "Show the header image"}
        onClick={() => setExpanded(!open)}
      >
        {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        <span>{open ? "Smaller" : "Show image"}</span>
      </button>
    </div>
  );
}

export default PosHeaderImage;
