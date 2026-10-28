/**
 * Image-choice persistence for both plans.
 *
 * Website Studio: the hero focal point rides inside the existing experience document and
 * must survive normalization + schema validation (so a saved crop survives a refresh and
 * can be published). POS: the header image rides inside the existing configuration JSON,
 * is sanitized, survives questionnaire rebuilds at the configuration layer, and — being
 * presentation only — never changes the trading fingerprint.
 */
import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import { validateExperienceDocument } from "@/lib/experience/schema";
import {
  baselineConfiguration,
  configurationFingerprint,
  normalizeConfiguration,
  sanitizePosPresentation,
} from "@/lib/pos/configuration";

describe("website hero focal point", () => {
  it("round-trips through normalization and passes document validation", () => {
    const created = createExperienceDocument({ categoryKey: "food", businessName: "Nyumbani Kitchen" });
    created.brand.heroImageUrl = "/category/fashion.jpg";
    created.brand.heroFocalX = 30;
    created.brand.heroFocalY = 70;

    const normalized = normalizeExperienceDocument(JSON.parse(JSON.stringify(created)), "food");
    expect(normalized.brand.heroImageUrl).toBe("/category/fashion.jpg");
    expect(normalized.brand.heroFocalX).toBe(30);
    expect(normalized.brand.heroFocalY).toBe(70);

    const checked = validateExperienceDocument(normalized);
    expect(checked.ok, JSON.stringify(checked.ok ? [] : checked.issues)).toBe(true);
  });

  it("clamps out-of-range focal values instead of storing a broken crop", () => {
    const doc = normalizeExperienceDocument(
      { brand: { heroImageUrl: "/category/fashion.jpg", heroFocalX: 400, heroFocalY: -10 } },
      "food",
    );
    expect(doc.brand.heroFocalX).toBe(95);
    expect(doc.brand.heroFocalY).toBe(5);
  });

  it("stays absent for legacy documents that never set a focal point", () => {
    const doc = normalizeExperienceDocument({ brand: { heroImageUrl: "/landing/nyumbani-kitchen.jpg" } }, "food");
    expect(doc.brand.heroFocalX).toBeUndefined();
    expect(doc.brand.heroFocalY).toBeUndefined();
    expect(validateExperienceDocument(doc).ok).toBe(true);
  });
});

describe("POS header presentation", () => {
  it("starts empty on the baseline configuration", () => {
    expect(baselineConfiguration().presentation).toEqual({});
  });

  it("accepts registry paths and https URLs, clamps focal, trims alt", () => {
    expect(
      sanitizePosPresentation({
        headerImageUrl: "  /category/pharmacy.jpg ",
        headerImageAlt: "  Our shop front ",
        headerFocalX: 120,
        headerFocalY: 40.6,
        somethingElse: "dropped",
      }),
    ).toEqual({
      headerImageUrl: "/category/pharmacy.jpg",
      headerImageAlt: "Our shop front",
      headerFocalX: 95,
      headerFocalY: 41,
    });
    expect(sanitizePosPresentation({ headerImageUrl: "https://cdn.example.com/a.jpg" }).headerImageUrl)
      .toBe("https://cdn.example.com/a.jpg");
  });

  it("refuses inline bytes, executable schemes and protocol-relative URLs", () => {
    for (const bad of [
      "data:image/png;base64,iVBORw0KGgo=",
      "javascript:alert(1)",
      "//evil.example/x.jpg",
      "http://insecure.example/x.jpg",
      "/\\evil",
      "",
      42,
      null,
    ]) {
      expect(sanitizePosPresentation({ headerImageUrl: bad }).headerImageUrl, String(bad)).toBeUndefined();
    }
    expect(sanitizePosPresentation(null)).toEqual({});
    expect(sanitizePosPresentation("nope")).toEqual({});
  });

  it("survives a stored-configuration round trip through normalizeConfiguration", () => {
    const config = baselineConfiguration();
    config.presentation = { headerImageUrl: "/category/hardware.jpg", headerFocalX: 25, headerFocalY: 60 };
    const restored = normalizeConfiguration(JSON.parse(JSON.stringify(config)));
    expect(restored.presentation).toEqual({ headerImageUrl: "/category/hardware.jpg", headerFocalX: 25, headerFocalY: 60 });
  });

  it("never changes the trading fingerprint", () => {
    const a = baselineConfiguration();
    const b = baselineConfiguration();
    b.presentation = { headerImageUrl: "/category/transport.jpg", headerFocalX: 10, headerFocalY: 90 };
    expect(configurationFingerprint(a)).toBe(configurationFingerprint(b));
  });

  it("drops a stored data URL instead of resurrecting inline persistence", () => {
    const restored = normalizeConfiguration({
      presentation: { headerImageUrl: "data:image/jpeg;base64,/9j/4AAQ" },
    });
    expect(restored.presentation.headerImageUrl).toBeUndefined();
  });
});
