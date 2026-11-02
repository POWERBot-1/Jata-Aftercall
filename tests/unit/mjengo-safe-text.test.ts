import { describe, it, expect } from "vitest";
import { sanitizeBrandingText, isSafeBrandingName, escapeHtml } from "../../lib/mjengo/sanitize";

describe("mjengo: safe text rendering", () => {
  it("rejects HTML tags and event handlers", () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)</script>',
      '<svg onload=alert(1)>',
      'hello <b>world</b>',
      'x" onerror="alert(1)',
    ];
    for (const p of payloads) {
      const safe = sanitizeBrandingText(p);
      // safe text keeps characters but isSafeBrandingName rejects tagged
      if (p.includes("<") || p.includes(">")) {
        expect(isSafeBrandingName(p)).toBe(false);
      }
      // escapeHtml must neutralize
      const escaped = escapeHtml(p);
      expect(escaped).not.toContain("<script");
      expect(escaped).toContain("&lt;");
    }
  });
  it("allows plain business names", () => {
    expect(isSafeBrandingName("Sunrise Hardware")).toBe(true);
    expect(isSafeBrandingName("Mary's Beauty Studio")).toBe(true);
  });
  it("renders as text not HTML: escaped output contains no executable", () => {
    const hostile = 'Karibu <img src=x onerror="alert(1)">';
    const escaped = escapeHtml(hostile);
    expect(escaped).toBe('Karibu &lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
});
