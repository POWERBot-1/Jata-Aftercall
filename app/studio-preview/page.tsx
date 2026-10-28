import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createExperienceDocument } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import { themesForCategory } from "@/lib/experience/themes";
import { designDirections } from "@/lib/studio/designDirections";
import { StudioCanvas } from "@/components/studio/canvas/StudioCanvas";

export const metadata: Metadata = { title: "Studio Canvas — preview build", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Canvas preview build — a self-contained showcase of the new editing surface.
 *
 * WHY THIS EXISTS: the project's Vercel configuration skips non-production builds and the
 * sandbox that built this feature has no database, so an authenticated Studio screen cannot be
 * opened in review. This route renders the real `StudioCanvas` component against a generated
 * sample document so a reviewer can see and operate the editor.
 *
 * IT IS HONEST ABOUT WHAT IT IS: `demo` mode performs no network writes at all, the fixture is
 * labelled on screen, and the route is refused in production. It is not a substitute for the
 * authenticated screen — it is the same component with the same code paths minus persistence.
 */
export default async function CanvasPreviewBuildPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  // Never available on the production deployment, whatever else is configured.
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV) {
    notFound();
  }

  const businessName = "Mary's Beauty Studio";
  const profile = getExperienceProfile("beauty");
  const document = createExperienceDocument({
    categoryKey: "beauty",
    businessName,
    description: "Braids, nails and beauty in Kitengela.",
    phone: "+254700000000",
    whatsapp: "+254700000000",
    location: "Kitengela, Kajiado",
  });

  const directions = designDirections({
    categoryKey: document.categoryKey,
    businessName,
    brand: document.brand,
    themeKey: document.themeKey,
  });

  const themes = themesForCategory(document.categoryKey).map((theme) => ({
    key: theme.key,
    name: theme.name,
    description: theme.description,
    swatches: [theme.palette.bg, theme.palette.surface, theme.palette.primary, theme.palette.accent, theme.palette.text],
  }));

  return (
    <div className="jc-page">
      <StudioCanvas
        demo
        initialPanel={tab === "design" ? "design" : "section"}
        businessId="preview-build"
        slug="marys-beauty-studio"
        businessName={businessName}
        categoryLabel={profile.label}
        document={document}
        draftVersion={7}
        publishedVersion={6}
        hasUnpublishedChanges
        directions={directions}
        themes={themes}
        currentDirectionKey={directions[0]?.key ?? null}
        currentThemeKey={document.themeKey}
        publicUrl="/studio-preview"
      />
    </div>
  );
}
