import { describe, it, expect } from "vitest";
import { verifyMjengoOrigin } from "../../lib/mjengo/csrf";

describe("mjengo: CSRF origin check", () => {
  it("allows missing origin (same-origin non-browser)", () => {
    const req = new Request("https://jataaftercall.co.ke/api/mjengo/branding", { headers: {} });
    expect(verifyMjengoOrigin(req).ok).toBe(true);
  });
  it("rejects foreign origin", () => {
    const req = new Request("https://jataaftercall.co.ke/api/mjengo/branding", { headers: { origin: "https://evil.com", host: "jataaftercall.co.ke" } });
    expect(verifyMjengoOrigin(req).ok).toBe(false);
  });
  it("rejects malformed forwarded proto", () => {
    const req = new Request("https://jataaftercall.co.ke/api/mjengo/branding", { headers: { origin: "https://jataaftercall.co.ke", host: "jataaftercall.co.ke", "x-forwarded-proto": "ftp" } });
    expect(verifyMjengoOrigin(req).ok).toBe(false);
  });
});
