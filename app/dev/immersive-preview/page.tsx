/**
 * Immersive preview harness (Immersive Website Engine, Phase 5). NOT visitor-facing.
 *
 * Returns 404 in production builds. In development it renders ImmersivePreview with fixed,
 * allowlisted inputs so browser tests can check each decision path: 3D, static fallback, failed
 * model load, reduced motion and low-memory devices. Query values are matched against fixed
 * lists. Any other value is ignored, so this page never fetches a URL chosen by the request.
 */

import { notFound } from "next/navigation";
import { ImmersivePreview } from "@/components/storefront/immersive/ImmersivePreview";
import { isRenderPreference, type RenderPreference } from "@/lib/experience/renderMode";

export const dynamic = "force-dynamic";

const MODELS: Record<string, { url: string; bytes: number }> = {
  ok: { url: "https://models.preview.test/product-ok.glb", bytes: 2048 },
  missing: { url: "https://models.preview.test/product-missing.glb", bytes: 2048 },
};

export default async function ImmersivePreviewHarness({
  searchParams,
}: {
  searchParams: Promise<{ preference?: string; model?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const preference: RenderPreference = isRenderPreference(params.preference) ? params.preference : "immersive";
  const asset = MODELS[params.model ?? "ok"] ?? MODELS.ok;

  return (
    <main style={{ maxWidth: 420, margin: "24px auto", padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Immersive preview (development harness)</h1>
      <div id="product-preview" style={{ width: "100%" }}>
        <ImmersivePreview
          preference={preference}
          enabled
          asset={asset}
          alt="Preview product, front view"
          fallbackImageUrl="https://images.preview.test/product-fallback.svg"
        />
      </div>
    </main>
  );
}
