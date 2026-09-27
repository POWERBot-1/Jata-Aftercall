import { describe, it, expect, afterEach } from "vitest";
import { getBusinessUrl, getBusinessPath, getBaseUrl } from "@/lib/url";

describe("url helpers — domain abstraction", () => {
  const origBase = process.env.PUBLIC_BASE_URL;
  const origVercel = process.env.VERCEL_URL;
  const origNextAuth = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (origBase !== undefined) process.env.PUBLIC_BASE_URL = origBase;
    else delete process.env.PUBLIC_BASE_URL;
    if (origVercel !== undefined) process.env.VERCEL_URL = origVercel;
    else delete process.env.VERCEL_URL;
    if (origNextAuth !== undefined) process.env.NEXTAUTH_URL = origNextAuth;
    else delete process.env.NEXTAUTH_URL;
  });

  it("uses PUBLIC_BASE_URL for canonical business URL", () => {
    process.env.PUBLIC_BASE_URL = "https://jata-aftercall.vercel.app";
    delete process.env.VERCEL_URL;
    expect(getBusinessUrl("marys-beauty")).toBe("https://jata-aftercall.vercel.app/b/marys-beauty");
    expect(getBusinessPath("marys-beauty")).toBe("/b/marys-beauty");
  });

  it("strips trailing slash", () => {
    process.env.PUBLIC_BASE_URL = "https://jata-aftercall.pages.dev/";
    delete process.env.VERCEL_URL;
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
    delete process.env.VERCEL_URL;
    const url = getBusinessUrl("test-biz");
    expect(url).not.toContain("jata.link");
    expect(url).toContain("/b/");
  });

  it("localhost PUBLIC_BASE_URL does not override VERCEL_URL when VERCEL_URL present", () => {
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    process.env.VERCEL_URL = "jata-aftercall.vercel.app";
    const base = getBaseUrl();
    expect(base).toBe("https://jata-aftercall.vercel.app");
    expect(base).not.toContain("localhost");
  });

  it("localhost NEXTAUTH_URL does not override VERCEL_URL when VERCEL_URL present", () => {
    delete process.env.PUBLIC_BASE_URL;
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    process.env.VERCEL_URL = "my-app.vercel.app";
    const base = getBaseUrl();
    expect(base).toBe("https://my-app.vercel.app");
  });

  it("non-localhost PUBLIC_BASE_URL takes precedence over VERCEL_URL", () => {
    process.env.PUBLIC_BASE_URL = "https://jata-aftercall.pages.dev";
    process.env.VERCEL_URL = "jata-aftercall.vercel.app";
    expect(getBaseUrl()).toBe("https://jata-aftercall.pages.dev");
  });

  it("no production domain is hard-coded", () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.VERCEL_URL;
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    const base = getBaseUrl();
    // Should not contain hardcoded prod domains
    expect(base).not.toContain("jata.link");
    // getBusinessUrl should be based on base
    const url = getBusinessUrl("test");
    expect(url).toContain("/b/test");
  });
});
