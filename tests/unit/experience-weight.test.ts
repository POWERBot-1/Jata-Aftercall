/**
 * Published-experience weight tests (§39, §83, §84)
 *
 * The weight check is advisory, so what matters is that it reports honestly: measured bytes are
 * measured, unmeasured assets are named rather than counted as zero, and nothing it does can
 * throw into the Studio page that displays it.
 */

import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_BUDGETS,
  experienceWeight,
  weightSummaryLine,
} from "@/lib/experience/weight";

const png = (payloadLength: number) => `data:image/png;base64,${"A".repeat(payloadLength)}`;
/** floor(chars * 3 / 4) — the same estimate lib/media/imageFormat.ts uses. */
const bytes = (payloadLength: number) => Math.floor((payloadLength * 3) / 4);

describe("a document with no assets is reported as such, not as a failure", () => {
  it("finds nothing and stays within budget", () => {
    const weight = experienceWeight({
      document: { version: 1, categoryKey: "restaurant", themeKey: "core-minimal", brand: { businessName: "Jata Grill" }, sections: [] },
    });
    expect(weight.assets).toEqual([]);
    expect(weight.imageCount).toBe(0);
    expect(weight.imageBytes).toBe(0);
    expect(weight.overBudget).toEqual([]);
    expect(weight.verdict).toBe("within-budget");
    expect(weightSummaryLine(weight)).toBe("No images yet.");
  });
});

describe("measured bytes are measured, unknown bytes are named", () => {
  it("measures a data URL from its own payload", () => {
    const weight = experienceWeight({
      document: { brand: { heroImageUrl: png(1000), logoUrl: png(400) }, sections: [] },
    });
    expect(weight.imageCount).toBe(2);
    expect(weight.imageBytes).toBe(bytes(1000) + bytes(400));
    expect(weight.largestImageBytes).toBe(bytes(1000));
    expect(weight.unmeasuredCount).toBe(0);
    expect(weight.verdict).toBe("within-budget");
  });

  it("reports a remote URL as unmeasured instead of pretending it is zero", () => {
    const weight = experienceWeight({
      document: { brand: { heroImageUrl: "https://cdn.example.com/hero.webp" }, sections: [] },
    });
    expect(weight.imageCount).toBe(1);
    expect(weight.imageBytes).toBe(0);
    expect(weight.unmeasuredCount).toBe(1);
    // Nothing was measured, so the verdict says so rather than claiming the page is light.
    expect(weight.verdict).toBe("unknown");
    expect(weight.recommendations.join(" ")).toMatch(/could not be checked/);
    expect(weightSummaryLine(weight)).toBe("Page weight could not be measured.");
  });

  it("resolves a model's size when the caller supplies it", () => {
    const url = "https://cdn.example.com/product.glb";
    const weight = experienceWeight({ document: { immersive: { modelUrl: url } }, models: [{ url, bytes: 1_500_000 }] });
    expect(weight.modelCount).toBe(1);
    expect(weight.modelBytes).toBe(1_500_000);
    expect(weight.overBudget).toEqual([]);
  });
});

describe("the §39 budgets produce recommendations, never refusals", () => {
  it("flags total image weight above the 1 MB target", () => {
    const weight = experienceWeight({
      document: { brand: { heroImageUrl: png(2_000_000) }, sections: [] },
      budgets: { initialImagesBytes: 1_000_000 },
    });
    expect(weight.overBudget).toContain("initialImagesBytes");
    expect(weight.verdict).toBe("optimise");
    expect(weight.recommendations.join(" ")).toMatch(/shrink them for phones/);
  });

  it("flags one oversized photo separately from the total", () => {
    const weight = experienceWeight({
      document: { brand: { heroImageUrl: png(1_000_000) }, sections: [] },
      budgets: { singleImageBytes: 600_000, initialImagesBytes: 5_000_000 },
    });
    expect(weight.overBudget).toContain("singleImageBytes");
    expect(weight.overBudget).not.toContain("initialImagesBytes");
  });

  it("flags a 3D model above the ceiling and, separately, above the hard maximum", () => {
    const heavy = experienceWeight({ document: { m: "https://cdn.example.com/a.glb" }, models: [{ url: "https://cdn.example.com/a.glb", bytes: 5_000_000 }] });
    expect(heavy.overBudget).toContain("modelBytesCeiling");
    expect(heavy.overBudget).not.toContain("modelBytesHardMax");

    const huge = experienceWeight({ document: { m: "https://cdn.example.com/b.glb" }, models: [{ url: "https://cdn.example.com/b.glb", bytes: 9_000_000 }] });
    expect(huge.overBudget).toEqual(expect.arrayContaining(["modelBytesCeiling", "modelBytesHardMax"]));
  });

  it("flags too many separate asset requests", () => {
    const sections = Array.from({ length: 30 }, (_, index) => ({ id: `s${index}`, imageUrl: png(100) }));
    const weight = experienceWeight({ document: { sections } });
    expect(weight.initialRequests).toBe(30);
    expect(weight.overBudget).toContain("initialRequests");
    expect(EXPERIENCE_BUDGETS.initialRequests).toBe(24);
  });

  it("never blocks: an over-budget document still reports a fallback and no error", () => {
    const weight = experienceWeight({ document: { brand: { heroImageUrl: png(4_000_000) } } });
    expect(weight.verdict).toBe("optimise");
    expect(weight.fallbackAvailable).toBe(true);
  });
});

describe("the walk is generic, so new document fields are counted too", () => {
  it("finds images nested in galleries, arrays and unfamiliar keys", () => {
    const weight = experienceWeight({
      document: {
        brand: { heroImageUrl: png(100) },
        sections: [
          { id: "a", type: "gallery", images: [png(200), png(300)] },
          { id: "b", type: "campaign", futureField: { deep: { thumbnail: png(400) } } },
        ],
        seo: { imageUrl: "https://cdn.example.com/og.png" },
      },
    });
    // Four measured data URLs plus one unmeasured remote OG image.
    expect(weight.imageCount).toBe(5);
    expect(weight.unmeasuredCount).toBe(1);
    expect(weight.assets.map((asset) => asset.path)).toEqual(
      expect.arrayContaining(["brand.heroImageUrl", "sections[0].images[0]", "sections[1].futureField.deep.thumbnail", "seo.imageUrl"]),
    );
  });

  it("distinguishes a GLB from a JPEG in the same document", () => {
    const weight = experienceWeight({
      document: { hero: png(100), model: "https://cdn.example.com/x.glb" },
      models: [{ url: "https://cdn.example.com/x.glb", bytes: 2_500_000 }],
    });
    expect(weight.imageCount).toBe(1);
    expect(weight.modelCount).toBe(1);
    expect(weight.modelBytes).toBe(2_500_000);
  });
});

describe("a malformed document cannot break the Studio page that shows this", () => {
  it("returns an empty unknown report for null, numbers and strings", () => {
    for (const document of [null, undefined, 42, "not a document", true]) {
      const weight = experienceWeight({ document });
      expect(weight.assets).toEqual([]);
      expect(weight.verdict).toBe("within-budget");
    }
  });

  it("stops at the node cap instead of following a cycle forever", () => {
    const cyclic: Record<string, unknown> = { brand: { heroImageUrl: png(100) } };
    cyclic.self = cyclic;
    const weight = experienceWeight({ document: cyclic, maxNodes: 200 });
    // It terminated, and it still counted the image it reached before the cap.
    expect(weight.imageCount).toBeGreaterThanOrEqual(1);
  });

  it("never returns a negative or NaN byte count", () => {
    const weight = experienceWeight({ document: { brand: { heroImageUrl: "data:image/png;base64," } } });
    expect(Number.isNaN(weight.imageBytes)).toBe(false);
    expect(weight.imageBytes).toBeGreaterThanOrEqual(0);
  });
});

describe("the summary line is owner-facing copy, not a byte dump", () => {
  it("reads as a sentence in every state", () => {
    const within = experienceWeight({ document: { brand: { heroImageUrl: png(1000) } } });
    expect(weightSummaryLine(within)).toMatch(/within budget$/);
    const optimise = experienceWeight({ document: { brand: { heroImageUrl: png(2_000_000) } } });
    expect(weightSummaryLine(optimise)).toMatch(/worth optimising$/);
    expect(weightSummaryLine(optimise)).not.toMatch(/NaN/);
  });
});
