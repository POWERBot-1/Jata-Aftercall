import { describe, it, expect } from "vitest";
import { normalizeKePhone, isValidKePhone, getWhatsAppUrl } from "@/lib/phone";

describe("Kenyan phone normalization", () => {
  it("normalizes 07XXXXXXXX to 254XXXXXXXXX", () => {
    expect(normalizeKePhone("0712345678")).toBe("254712345678");
    expect(normalizeKePhone("0700000000")).toBe("254700000000");
  });

  it("normalizes 01XXXXXXXX to 254XXXXXXXXX", () => {
    expect(normalizeKePhone("0112345678")).toBe("254112345678");
    expect(normalizeKePhone("0100000000")).toBe("254100000000");
  });

  it("handles 9-digit without leading 0", () => {
    expect(normalizeKePhone("712345678")).toBe("254712345678");
    expect(normalizeKePhone("112345678")).toBe("254112345678");
  });

  it("keeps valid 254 numbers valid", () => {
    expect(normalizeKePhone("254712345678")).toBe("254712345678");
    expect(normalizeKePhone("254112345678")).toBe("254112345678");
    expect(normalizeKePhone("+254712345678")).toBe("254712345678");
    expect(normalizeKePhone("254 712 345 678")).toBe("254712345678");
    expect(isValidKePhone("254712345678")).toBe(true);
  });

  it("handles 2540 prefix (2540712345678 -> 254712345678)", () => {
    expect(normalizeKePhone("2540712345678")).toBe("254712345678");
    expect(normalizeKePhone("2540112345678")).toBe("254112345678");
  });

  it("invalid numbers return null and do not generate wa.me URLs", () => {
    expect(normalizeKePhone("")).toBeNull();
    expect(normalizeKePhone(null)).toBeNull();
    expect(normalizeKePhone("123")).toBeNull();
    expect(normalizeKePhone("0712345")).toBeNull(); // too short
    expect(normalizeKePhone("0212345678")).toBeNull(); // 02 not Kenyan mobile
    expect(normalizeKePhone("254212345678")).toBeNull(); // 2542 invalid
    expect(normalizeKePhone("abc")).toBeNull();
    expect(getWhatsAppUrl("123")).toBeNull();
    expect(getWhatsAppUrl("0212345678")).toBeNull();
    expect(getWhatsAppUrl(null)).toBeNull();
  });

  it("generates valid wa.me URLs only for valid numbers", () => {
    const url = getWhatsAppUrl("0712345678", "Hello");
    expect(url).toBe("https://wa.me/254712345678?text=Hello");
    const url2 = getWhatsAppUrl("254712345678");
    expect(url2).toBe("https://wa.me/254712345678");
    expect(getWhatsAppUrl("invalid")).toBeNull();
  });

  it("Request Quote fallback chain is handled by caller — phone lib returns null for invalid so caller can fallback to tel: or #quote", () => {
    // This test documents the contract: invalid -> null, valid -> url
    const invalid = getWhatsAppUrl("0212345678", "quote");
    expect(invalid).toBeNull();
    // Caller would then use tel: or #quote
  });
});
