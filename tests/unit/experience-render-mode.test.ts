import { describe, expect, it } from "vitest";
import {
  modeForScore,
  readCapabilitySignals,
  resolveRenderMode,
  scoreCapabilities,
  type CapabilitySignals,
} from "@/lib/experience/renderMode";

const capable: CapabilitySignals = {
  webgl: true,
  webgpu: true,
  deviceMemoryGB: 8,
  hardwareConcurrency: 8,
  viewportWidth: 1280,
  effectiveType: "4g",
  saveData: false,
  reducedMotion: false,
};

const lowEndAndroid: CapabilitySignals = {
  webgl: true,
  webgpu: false,
  deviceMemoryGB: 2,
  hardwareConcurrency: 4,
  viewportWidth: 360,
  effectiveType: "4g",
  saveData: false,
  reducedMotion: false,
};

describe("capability scoring", () => {
  it("scores a capable device at the top of the range and never above 100", () => {
    const { score, reasons } = scoreCapabilities(capable);
    expect(score).toBeGreaterThanOrEqual(90);
    expect(score).toBeLessThanOrEqual(100);
    expect(reasons).toContain("webgpu");
  });

  it("scores a device with no WebGL below the immersive band", () => {
    const score = scoreCapabilities({ ...capable, webgl: false, webgpu: false }).score;
    expect(score).toBeLessThan(66);
  });

  it("treats unknown signals neutrally rather than punishing them", () => {
    const unknown = scoreCapabilities({
      ...capable,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      effectiveType: null,
    });
    const known = scoreCapabilities(capable);
    expect(unknown.score).toBeGreaterThan(0);
    expect(unknown.score).toBeLessThan(known.score);
    expect(unknown.reasons).toEqual(expect.arrayContaining(["memory-unknown", "cores-unknown", "network-unknown"]));
  });

  it("maps scores to bands with the documented default thresholds", () => {
    expect(modeForScore(0)).toBe("lite");
    expect(modeForScore(30)).toBe("lite");
    expect(modeForScore(31)).toBe("motion");
    expect(modeForScore(65)).toBe("motion");
    expect(modeForScore(66)).toBe("immersive");
    expect(modeForScore(100)).toBe("immersive");
  });

  it("honours configurable thresholds", () => {
    const custom = { motionMin: 50, immersiveMin: 90 };
    expect(modeForScore(49, custom)).toBe("lite");
    expect(modeForScore(70, custom)).toBe("motion");
    expect(modeForScore(90, custom)).toBe("immersive");
  });
});

describe("resolveRenderMode", () => {
  it("uses MOTION for a modest Android phone on a normal connection", () => {
    const decision = resolveRenderMode({ signals: lowEndAndroid });
    expect(decision.mode).toBe("motion");
    expect(decision.requested).toBe("motion");
    expect(decision.fallbackReason).toBeNull();
  });

  it("never returns IMMERSIVE while the immersive engine is not implemented", () => {
    const decision = resolveRenderMode({ signals: capable, preference: "immersive" });
    expect(decision.requested).toBe("immersive");
    expect(decision.mode).toBe("motion");
    expect(decision.fallbackReason).toBe("not-implemented");
  });

  it("falls back from IMMERSIVE when WebGL is unavailable", () => {
    const decision = resolveRenderMode({
      signals: { ...capable, webgl: false, webgpu: false },
      preference: "immersive",
      implemented: ["lite", "motion", "immersive"],
    });
    expect(decision.mode).toBe("motion");
    expect(decision.fallbackReason).toBe("no-webgl");
  });

  it("keeps the owner's explicit LITE choice even on a capable device", () => {
    expect(resolveRenderMode({ signals: capable, preference: "lite" }).mode).toBe("lite");
  });

  it("forces LITE for reduced-motion visitors whatever the preference says", () => {
    const decision = resolveRenderMode({ signals: { ...capable, reducedMotion: true }, preference: "motion" });
    expect(decision.mode).toBe("lite");
    expect(decision.fallbackReason).toBe("reduced-motion");
  });

  it("forces LITE for Save-Data and slow connections", () => {
    expect(resolveRenderMode({ signals: { ...capable, saveData: true } }).mode).toBe("lite");
    expect(resolveRenderMode({ signals: { ...capable, effectiveType: "3g" } }).fallbackReason).toBe("slow-connection");
  });

  it("ignores an unknown preference string and uses the score", () => {
    expect(resolveRenderMode({ signals: lowEndAndroid, preference: "turbo" }).mode).toBe("motion");
  });

  it("never steps up beyond the score band", () => {
    const decision = resolveRenderMode({ signals: { ...lowEndAndroid, deviceMemoryGB: 1 }, preference: "motion" });
    expect(decision.mode).toBe("motion");
  });
});

describe("readCapabilitySignals", () => {
  it("returns a safe empty profile when there is no window (server or node)", () => {
    const signals = readCapabilitySignals(undefined);
    expect(signals.webgl).toBe(false);
    expect(signals.reducedMotion).toBe(false);
    expect(signals.deviceMemoryGB).toBeNull();
  });

  it("does not throw when browser APIs are hostile or missing", () => {
    const hostile = {
      document: {
        createElement: () => {
          throw new Error("no canvas");
        },
      },
      navigator: {},
      matchMedia: () => {
        throw new Error("boom");
      },
      innerWidth: 360,
    } as unknown as Window;
    expect(() => readCapabilitySignals(hostile)).not.toThrow();
    const signals = readCapabilitySignals(hostile);
    expect(signals.webgl).toBe(false);
    expect(signals.viewportWidth).toBe(360);
  });
});
