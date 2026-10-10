/**
 * Boundary tests for the 3D layer (Immersive Website Engine, Phase 5)
 *
 * Static guarantees that the Lite and Motion pages can never pull Three.js in, and a server-render
 * check that the static image is what a visitor sees first. WebGL itself cannot run in this test
 * environment; that is reported as NOT verified, not implied.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImmersiveStage } from "@/components/storefront/immersive/ImmersiveStage";

const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...sourceFiles(join(dir, entry)));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

const SOURCES = ["app", "components", "lib"].flatMap((dir) => sourceFiles(dir));

describe("Three.js is confined to one lazily loaded module", () => {
  it("only ThreeProductViewer imports 'three'", () => {
    const importers = SOURCES.filter((file) => /from\s+["']three(\/|["'])/.test(readFileSync(join(ROOT, file), "utf8")));
    expect(importers).toEqual(["components/storefront/immersive/ThreeProductViewer.tsx"]);
  });

  it("the Lite and Motion storefront never reference the immersive layer", () => {
    const litePath = [
      "components/storefront/ExperienceSite.tsx",
      "components/storefront/StorefrontShell.tsx",
      "components/storefront/Sections.tsx",
      "components/storefront/RenderModeProbe.tsx",
      "components/storefront/MotionReveal.tsx",
      "app/b/[slug]/page.tsx",
    ];
    for (const file of litePath) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(text, file).not.toMatch(/immersive|ThreeProductViewer|from\s+["']three/);
    }
  });

  it("the viewer is loaded through a dynamic, client-only import", () => {
    const stage = readFileSync(join(ROOT, "components/storefront/immersive/ImmersiveStage.tsx"), "utf8");
    expect(stage).toMatch(/dynamic\(\(\)\s*=>\s*import\("\.\/ThreeProductViewer"\)/);
    expect(stage).toMatch(/ssr:\s*false/);
  });

  it("the policy module does not import Three.js", () => {
    const policy = readFileSync(join(ROOT, "lib/experience/immersive/policy.ts"), "utf8");
    expect(policy).not.toMatch(/three/);
  });
});

describe("the static image is shown first, and 3D never leaves a blank area", () => {
  it("server-renders the static image with its accessible description and no canvas", () => {
    const markup = renderToStaticMarkup(
      createElement(ImmersiveStage, {
        modelUrl: "https://cdn.example.com/m.glb",
        alt: "Leather handbag, front view",
        fallbackImageUrl: "https://cdn.example.com/bag.webp",
      }),
    );
    expect(markup).toContain('src="https://cdn.example.com/bag.webp"');
    expect(markup).toContain('alt="Leather handbag, front view"');
    expect(markup).not.toContain("<canvas");
  });

  it("without an image, still shows the accessible description rather than an empty box", () => {
    const markup = renderToStaticMarkup(
      createElement(ImmersiveStage, { modelUrl: "https://cdn.example.com/m.glb", alt: "Sofa, 3-seater", fallbackImageUrl: null }),
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Sofa, 3-seater"');
    expect(markup).toContain("Sofa, 3-seater");
  });
});
