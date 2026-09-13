import { describe, it, expect } from "vitest";
import { THEMES, THEME_OPTIONS, resolveTheme } from "@/lib/themes";

describe("themes", () => {
  it("has exactly 3 themes", () => {
    expect(Object.keys(THEMES)).toHaveLength(3);
    expect(THEME_OPTIONS).toHaveLength(3);
  });
  it("contains clean, dark, warm", () => {
    expect(THEMES.clean).toBeDefined();
    expect(THEMES.dark).toBeDefined();
    expect(THEMES.warm).toBeDefined();
  });
  it("resolves unknown to clean default", () => {
    expect(resolveTheme("nonexistent").key).toBe("clean");
    expect(resolveTheme(null).key).toBe("clean");
  });
  it("each theme has tokens", () => {
    for (const t of Object.values(THEMES)) {
      expect(t.colors.bg).toBeTruthy();
      expect(t.colors.card).toBeTruthy();
      expect(t.colors.primary).toBeTruthy();
      expect(t.radius).toBeTruthy();
    }
  });
});
