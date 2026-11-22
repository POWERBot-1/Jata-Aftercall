import { describe, expect, it } from "vitest";
import { primaryCtaLabel } from "@/lib/experience/cta";

describe("primary storefront CTA labels", () => {
  it("preserves a non-empty hero-authored label", () => {
    expect(primaryCtaLabel("  Order today  ", "Shop now", "shop")).toBe("Order today");
  });

  it("falls back to the profile label when the generated hero label is blank", () => {
    expect(primaryCtaLabel("   ", "  Book an appointment  ", "book")).toBe("Book an appointment");
  });

  it("uses a category-aware action when both authored labels are empty", () => {
    expect(primaryCtaLabel(" ", "", "shop")).toBe("Shop now");
    expect(primaryCtaLabel(null, undefined, "book")).toBe("Book now");
    expect(primaryCtaLabel(undefined, "  ", "contact")).toBe("Contact us");
  });
});
