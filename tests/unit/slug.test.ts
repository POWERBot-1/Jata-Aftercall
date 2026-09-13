import { describe, it, expect } from "vitest";
import { slugify, validateSlug, isReservedSlug } from "@/lib/slug";

describe("slugify", () => {
  it("slugifies business names", () => {
    expect(slugify("Mary's Beauty Studio")).toBe("marys-beauty-studio");
    expect(slugify("  Nyumbani Kitchen  ")).toBe("nyumbani-kitchen");
    expect(slugify("Kamau Auto Care!")).toBe("kamau-auto-care");
  });
  it("collapses hyphens and lowercases", () => {
    expect(slugify("A  ---  B")).toBe("a-b");
  });
  it("trims to 50 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(50);
  });
});

describe("validateSlug", () => {
  it("accepts valid slugs", () => {
    expect(validateSlug("marys-beauty").valid).toBe(true);
    expect(validateSlug("nyumbani-kitchen-1").valid).toBe(true);
  });
  it("rejects reserved slugs", () => {
    expect(validateSlug("admin").valid).toBe(false);
    expect(validateSlug("api").valid).toBe(false);
    expect(validateSlug("dashboard").valid).toBe(false);
    expect(validateSlug("b").valid).toBe(false);
  });
  it("rejects short and invalid chars", () => {
    expect(validateSlug("ab").valid).toBe(false);
    expect(validateSlug("Mary").valid).toBe(false);
    expect(validateSlug("a/b").valid).toBe(false);
  });
  it("rejects double hyphens and leading/trailing", () => {
    expect(validateSlug("a--b").valid).toBe(false);
  });
});

describe("isReservedSlug", () => {
  it("detects reserved", () => {
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("marys-beauty")).toBe(false);
  });
});
