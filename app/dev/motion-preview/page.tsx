/**
 * Motion preview harness (Immersive Website Engine, Phase 2). NOT visitor-facing.
 *
 * Returns 404 in production builds. In development it renders the same `MotionReveal` wrapper and
 * `MotionEngineMount` the public storefront uses, with fixed inputs, so a real browser can be
 * pointed at each decision path: Lite, Motion with a `subtle` treatment, Motion with an
 * `expressive` treatment, reduced motion and Save-Data. Query values are matched against fixed
 * lists; anything else is ignored.
 *
 * No database, no tenant and no network: the sections are literals, which is the point — this
 * harness measures the motion layer, not the storefront.
 */

import { notFound } from "next/navigation";
import { MotionReveal } from "@/components/storefront/MotionReveal";
import { MotionEngineMount } from "@/components/storefront/motion/MotionEngineMount";
import { RenderModeProbe } from "@/components/storefront/RenderModeProbe";
import { sectionRecipesForPage } from "@/lib/experience/motion";
import { isRenderPreference, type RenderPreference } from "@/lib/experience/renderMode";
import type { MotionLevel } from "@/lib/experience/themes";

export const dynamic = "force-dynamic";

const LEVELS: MotionLevel[] = ["none", "subtle", "expressive"];

const SECTIONS = [
  { id: "sec-hero-copy", title: "Fresh tilapia, grilled to order", body: "KES 650. Served with ugali and sukuma." },
  { id: "sec-menu", title: "This week's menu", body: "Nyama choma, chicken biryani, vegetable pilau." },
  { id: "sec-hours", title: "Open 8am to 9pm", body: "Closed Mondays. WhatsApp orders until 8:30pm." },
  { id: "sec-contact", title: "Find us", body: "Moi Avenue, next to the matatu stage." },
];

export default async function MotionPreviewHarness({
  searchParams,
}: {
  searchParams: Promise<{ preference?: string; level?: string; seed?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const preference: RenderPreference = isRenderPreference(params.preference) ? params.preference : "auto";
  const motionLevel: MotionLevel = LEVELS.includes(params.level as MotionLevel) ? (params.level as MotionLevel) : "expressive";
  const seed = /^[\w:-]{1,64}$/.test(params.seed ?? "") ? String(params.seed) : "restaurant:jata-grill";
  const recipes = sectionRecipesForPage({ motionLevel, seed, sections: SECTIONS });

  return (
    <main style={{ maxWidth: 420, margin: "24px auto", padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Motion preview (development harness)</h1>
      <p id="motion-preview-meta" data-level={motionLevel} data-preference={preference} data-seed={seed}>
        Level {motionLevel}, preference {preference}.
      </p>

      <RenderModeProbe preference={preference} />
      <MotionEngineMount motionLevel={motionLevel} seed={seed} preference={preference} />

      {SECTIONS.map((section) =>
        motionLevel === "none" ? (
          <section key={section.id} id={section.id}>
            <h2 style={{ fontSize: 16 }}>{section.title}</h2>
            <p>{section.body}</p>
          </section>
        ) : (
          <MotionReveal key={section.id} motionLevel={motionLevel} recipe={recipes[section.id] ?? null}>
            <section id={section.id}>
              <h2 style={{ fontSize: 16 }}>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          </MotionReveal>
        ),
      )}
    </main>
  );
}
