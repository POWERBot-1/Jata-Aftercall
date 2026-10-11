import { describe, expect, it } from "vitest";
import {
  chooseDerivativeFormat,
  pictureSourcesFor,
  planDerivatives,
  probeEncodeSupport,
} from "@/lib/media/derivatives";

describe("responsive derivative planning", () => {
  it("plans every size for a large phone photo, keeping the aspect ratio", () => {
    const plans = planDerivatives({ width: 4032, height: 3024 });
    const planned = plans.filter((plan) => plan.planned);
    expect(planned.map((plan) => plan.role).sort()).toEqual(["desktop", "hero", "mobile", "thumbnail"]);
    for (const plan of planned) {
      expect(plan.width / plan.height).toBeCloseTo(4032 / 3024, 2);
      expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(1920);
    }
  });

  it("never upscales: only sizes genuinely smaller than the source are planned", () => {
    const plans = planDerivatives({ width: 600, height: 400 });
    // A 480px thumbnail is a real reduction of a 600px source; 768px and up would be upscales and are not planned.
    expect(plans.filter((plan) => plan.planned).map((plan) => plan.role)).toEqual(["thumbnail"]);
    for (const plan of plans) {
      expect(plan.width).toBeLessThanOrEqual(600);
      expect(plan.height).toBeLessThanOrEqual(400);
    }
  });

  it("does not plan a size that would barely differ from the original", () => {
    const plans = planDerivatives({ width: 1500, height: 1000 });
    const hero = plans.find((plan) => plan.role === "hero")!;
    expect(hero.planned).toBe(false);
    const thumb = plans.find((plan) => plan.role === "thumbnail")!;
    expect(thumb.planned).toBe(true);
  });

  it("refuses to plan anything for an unknown or zero-size source", () => {
    const plans = planDerivatives({ width: 0, height: 0 });
    expect(plans.every((plan) => !plan.planned && plan.reason === "unknown-source-size")).toBe(true);
  });
});

describe("format negotiation", () => {
  it("prefers AVIF, then WebP, then JPEG, using only what the browser can encode", () => {
    expect(chooseDerivativeFormat({ support: { avif: true, webp: true }, hasAlpha: false })).toBe("avif");
    expect(chooseDerivativeFormat({ support: { avif: false, webp: true }, hasAlpha: false })).toBe("webp");
    expect(chooseDerivativeFormat({ support: { avif: false, webp: false }, hasAlpha: false })).toBe("jpeg");
  });

  it("keeps transparency: WebP if supported, otherwise PNG, never a lossy format that drops alpha", () => {
    expect(chooseDerivativeFormat({ support: { avif: true, webp: true }, hasAlpha: true })).toBe("webp");
    expect(chooseDerivativeFormat({ support: { avif: true, webp: false }, hasAlpha: true })).toBe("png");
  });

  it("probes support from canvas output, treating a silent PNG fallback as unsupported", () => {
    // A browser without WebP encoding returns PNG for image/webp requests.
    const noWebp = (mime: string) => (mime === "image/webp" ? "data:image/png;base64,AAAA" : `data:${mime};base64,AAAA`);
    expect(probeEncodeSupport(noWebp)).toEqual({ avif: true, webp: false });
    expect(probeEncodeSupport(() => "data:image/png;base64,AAAA")).toEqual({ avif: false, webp: false });
  });

  it("treats a throwing encoder as unsupported rather than failing the page", () => {
    expect(
      probeEncodeSupport(() => {
        throw new Error("no canvas");
      }),
    ).toEqual({ avif: false, webp: false });
  });

  it("orders <picture> sources best-first with the JPEG/PNG fallback last", () => {
    const sources = pictureSourcesFor([
      { format: "jpeg", url: "/a.jpg" },
      { format: "avif", url: "/a.avif" },
      { format: "webp", url: "/a.webp" },
    ]);
    expect(sources.map((source) => source.type)).toEqual(["image/avif", "image/webp", "image/jpeg"]);
    expect(sources[sources.length - 1].format).toBe("jpeg");
  });
});
