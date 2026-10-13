import { describe, expect, it } from "vitest";
import { immersiveEligibility, immersiveFeatureEnabled, IMMERSIVE_LIMITS } from "@/lib/experience/immersive/policy";
import type { CapabilitySignals } from "@/lib/experience/renderMode";

const capable: CapabilitySignals = {
  webgl: true,
  webgpu: false,
  deviceMemoryGB: 8,
  hardwareConcurrency: 8,
  viewportWidth: 1280,
  effectiveType: "4g",
  saveData: false,
  reducedMotion: false,
};
const model = { url: "https://cdn.example.com/tenants/biz/model-glb/room.glb", bytes: 3 * 1024 * 1024 };

describe("immersive feature switch", () => {
  it("is off by default", () => {
    expect(immersiveFeatureEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("stays off in this build even when the flag is set, because no durable store is configured", () => {
    expect(immersiveFeatureEnabled({ JATA_IMMERSIVE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(
      immersiveFeatureEnabled({ JATA_IMMERSIVE_ENABLED: "true", JATA_STORAGE_PROVIDER: "vercel-blob" } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe("immersive eligibility", () => {
  it("is eligible only when every condition holds", () => {
    expect(immersiveEligibility({ enabled: true, signals: capable, asset: model })).toEqual({ eligible: true, reason: "eligible" });
  });

  const cases: Array<[string, Partial<CapabilitySignals>, string]> = [
    ["no WebGL", { webgl: false }, "no-webgl"],
    ["reduced motion", { reducedMotion: true }, "reduced-motion"],
    ["Save-Data", { saveData: true }, "save-data"],
    ["2G connection", { effectiveType: "2g" }, "slow-connection"],
    ["3G connection", { effectiveType: "3g" }, "slow-connection"],
    ["memory not reported (iOS)", { deviceMemoryGB: null }, "memory-unknown"],
    ["low-memory Android (2 GB)", { deviceMemoryGB: 2 }, "low-memory"],
    ["low-core device", { hardwareConcurrency: 2 }, "low-cores"],
  ];
  for (const [name, patch, reason] of cases) {
    it(`keeps a visitor off 3D on ${name}`, () => {
      const result = immersiveEligibility({ enabled: true, signals: { ...capable, ...patch }, asset: model });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe(reason);
    });
  }

  it("is off when the feature flag is off, regardless of the device", () => {
    expect(immersiveEligibility({ enabled: false, signals: capable, asset: model }).reason).toBe("immersive-disabled");
  });

  it("needs a model", () => {
    expect(immersiveEligibility({ enabled: true, signals: capable, asset: null }).reason).toBe("no-model");
  });

  it("rejects an oversized model rather than shipping it to a phone", () => {
    const huge = { url: model.url, bytes: IMMERSIVE_LIMITS.maxModelBytes + 1 };
    expect(immersiveEligibility({ enabled: true, signals: capable, asset: huge }).reason).toBe("model-too-large");
  });

  it("rejects a model not served over HTTPS (no http, data or javascript URLs)", () => {
    for (const url of ["http://cdn.example.com/m.glb", "data:model/gltf-binary;base64,AA", "javascript:alert(1)", "/relative.glb"]) {
      expect(immersiveEligibility({ enabled: true, signals: capable, asset: { url, bytes: 1000 } }).reason).toBe("model-url-not-https");
    }
  });
});
