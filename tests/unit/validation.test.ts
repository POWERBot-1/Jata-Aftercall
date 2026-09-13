import { describe, it, expect } from "vitest";
import { validateEmail, validatePhone, sanitizeText, isValidCategory } from "@/lib/validation";

describe("validation", () => {
  it("validates email", () => {
    expect(validateEmail("mary@example.com")).toBe(true);
    expect(validateEmail("invalid")).toBe(false);
    expect(validateEmail("a@b")).toBe(false);
  });
  it("validates phone", () => {
    expect(validatePhone("0722123456")).toBe(true);
    expect(validatePhone("+254722123456")).toBe(true);
    expect(validatePhone("123")).toBe(false);
  });
  it("sanitizes text — strips < > and limits length", () => {
    expect(sanitizeText("<script>alert(1)</script>", 100)).not.toContain("<script>");
    expect(sanitizeText("<script>alert(1)</script>", 100)).toContain("&lt;script&gt;");
    expect(sanitizeText("a".repeat(200), 50).length).toBe(50);
  });
  it("validates categories", () => {
    expect(isValidCategory("Beauty")).toBe(true);
    expect(isValidCategory("Other")).toBe(true);
    expect(isValidCategory("InvalidCat")).toBe(false);
  });
});

describe("XSS payloads", () => {
  it("neutralizes common XSS vectors via sanitizeText", () => {
    const payloads = [
      "<script>alert(1)</script>",
      "\"><svg onload=alert(1)>",
      "javascript:alert(1)",
      "<img src=x onerror=alert(1)>",
      "{{7*7}}",
    ];
    for (const p of payloads) {
      const out = sanitizeText(p, 500);
      expect(out).not.toContain("<script>");
      expect(out).not.toContain("<svg");
      expect(out).not.toContain("<img");
    }
  });
});
