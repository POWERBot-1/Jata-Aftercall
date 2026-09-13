import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getBusinessUrl, getBusinessPath, getBaseUrl } from "@/lib/url";

describe("url helpers — domain abstraction", () => {
  const origBase = process.env.PUBLIC_BASE_URL;
  const origVercel = process.env.VERCEL_URL;

  afterEach(() => {
    process.env.PUBLIC_BASE_URL = origBase;
    if (origVercel) process.env.VERCEL_URL = origVercel;
    else delete process.env.VERCEL_URL;
  });

  it("uses PUBLIC_BASE_URL for canonical business URL", () => {
    process.env.PUBLIC_BASE_URL = "https://jata-aftercall.vercel.app";
    expect(getBusinessUrl("marys-beauty")).toBe("https://jata-aftercall.vercel.app/b/marys-beauty");
    expect(getBusinessPath("marys-beauty")).toBe("/b/marys-beauty");
  });

  it("strips trailing slash", () => {
    process.env.PUBLIC_BASE_URL = "https://jata-aftercall.pages.dev/";
    expect(getBusinessUrl("nyumbani-kitchen")).toBe("https://jata-aftercall.pages.dev/b/nyumbani-kitchen");
  });

  it("falls back to localhost when not configured", () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.VERCEL_URL;
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    expect(getBaseUrl()).toContain("localhost");
  });

  it("never hardcodes jata.link", () => {
    process.env.PUBLIC_BASE_URL = "https://jata-aftercall.vercel.app";
    const url = getBusinessUrl("test-biz");
    expect(url).not.toContain("jata.link");
    expect(url).toContain("/b/");
  });
});
