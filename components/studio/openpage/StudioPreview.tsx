"use client";

/**
 * Live candidate preview.
 *
 * This renders the candidate through the *existing* JATA storefront renderer
 * (`ExperienceSite`), with the same components customers see. It is not a mock and not a
 * second rendering engine. The shell is kept so the preview has the real chrome, but view
 * tracking is disabled (`trackViews={false}`) because a preview must not create customer
 * events. The full draft/live preview remains available at the existing
 * `/dashboard/businesses/[id]/preview` and `/b/[slug]` routes.
 */

import { useMemo } from "react";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";
import { themeOf } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import type { StorefrontData } from "@/lib/experience/storefront";
import type { ExperienceDocument } from "@/lib/experience/types";
import type { StudioPreviewBase } from "@/lib/openpage/previewData";

export const PREVIEW_WIDTHS = { mobile: 390, tablet: 834, desktop: 1280 } as const;
export type StudioDevice = keyof typeof PREVIEW_WIDTHS;

export function StudioPreview({
  base,
  document,
  device = "desktop",
  scale = 1,
  height = 620,
  scroll = true,
  fit = false,
  label = "Website preview",
}: {
  base: StudioPreviewBase;
  document: ExperienceDocument;
  device?: StudioDevice;
  scale?: number;
  height?: number;
  scroll?: boolean;
  /** Fit the live site to the container instead of scaling a fixed device width. */
  fit?: boolean;
  label?: string;
}) {
  const data = useMemo<StorefrontData>(() => ({
    ...base,
    document,
    theme: themeOf(document),
    profile: getExperienceProfile(document.categoryKey),
    isPreview: true,
    publishedVersion: 0,
  }), [base, document]);

  const width = PREVIEW_WIDTHS[device];

  return (
    <div
      className="studio-preview-frame"
      data-studio-preview={device}
      aria-label={label}
      style={{
        height,
        width: fit && device === "mobile" ? width : undefined,
        maxWidth: "100%",
        overflowY: scroll ? "auto" : "hidden",
        overflowX: "hidden",
        background: "var(--ws-paper, #fff)",
        border: "1px solid var(--ws-line, #e4e4e7)",
        borderRadius: 14,
        position: "relative",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none"
        style={{
          width: fit ? (device === "mobile" ? width : "100%") : width,
          minHeight: fit ? height : height / Math.min(scale, 1),
          transform: fit ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <ExperienceSite data={data} trackViews={false} />
      </div>
    </div>
  );
}
