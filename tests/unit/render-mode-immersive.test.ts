import { describe, expect, it } from "vitest";
import { resolveRenderMode, type CapabilitySignals } from "@/lib/experience/renderMode";

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
const withImmersive = ["lite", "motion", "immersive"] as const;

describe("immersive is used only when eligible, implemented and supported", () => {
  it("uses IMMERSIVE for an eligible capable device when the engine is available", () => {
    const decision = resolveRenderMode({ preference: "immersive", signals: capable, implemented: withImmersive, immersiveEligible: true });
    expect(decision.mode).toBe("immersive");
    expect(decision.fallbackReason).toBeNull();
  });

  it("uses IMMERSIVE from 'auto' only when the score is high and the device is eligible", () => {
    const decision = resolveRenderMode({ signals: capable, implemented: withImmersive, immersiveEligible: true });
    expect(decision.requested).toBe("immersive");
    expect(decision.mode).toBe("immersive");
  });

  it("falls back to MOTION when the device is not eligible, with the reason recorded", () => {
    const decision = resolveRenderMode({ preference: "immersive", signals: capable, implemented: withImmersive, immersiveEligible: false });
    expect(decision.mode).toBe("motion");
    expect(decision.fallbackReason).toBe("immersive-not-eligible");
  });

  it("treats a missing eligibility decision as not eligible (safe default)", () => {
    const decision = resolveRenderMode({ preference: "immersive", signals: capable, implemented: withImmersive });
    expect(decision.mode).toBe("motion");
    expect(decision.fallbackReason).toBe("immersive-not-eligible");
  });

  it("never uses IMMERSIVE when the engine is not in this build", () => {
    const decision = resolveRenderMode({ preference: "immersive", signals: capable, immersiveEligible: true });
    expect(decision.mode).toBe("motion");
    expect(decision.fallbackReason).toBe("not-implemented");
  });

  it("keeps reduced-motion visitors in LITE even when 3D is eligible", () => {
    const decision = resolveRenderMode({
      preference: "immersive",
      signals: { ...capable, reducedMotion: true },
      implemented: withImmersive,
      immersiveEligible: true,
    });
    expect(decision.mode).toBe("lite");
    expect(decision.fallbackReason).toBe("reduced-motion");
  });

  it("falls back immersive → motion when WebGL is missing, even if flagged eligible", () => {
    const decision = resolveRenderMode({
      preference: "immersive",
      signals: { ...capable, webgl: false, webgpu: false },
      implemented: withImmersive,
      immersiveEligible: true,
    });
    expect(decision.mode).toBe("motion");
    expect(decision.fallbackReason).toBe("no-webgl");
  });

  it("an owner who chooses LITE is never moved up to 3D", () => {
    const decision = resolveRenderMode({ preference: "lite", signals: capable, implemented: withImmersive, immersiveEligible: true });
    expect(decision.mode).toBe("lite");
  });
});
