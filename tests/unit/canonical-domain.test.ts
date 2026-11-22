import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getBaseUrl } from "@/lib/url";

describe("official production canonical origin", () => {
  it("uses the official apex when production URL variables are absent or localhost", () => {
    expect(getBaseUrl({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "jata-aftercall.vercel.app",
      PUBLIC_BASE_URL: "http://localhost:3000",
      NEXTAUTH_URL: "http://localhost:3000",
    })).toBe("https://jataaftercall.co.ke");
  });

  it("preserves an explicit non-localhost PUBLIC_BASE_URL override", () => {
    expect(getBaseUrl({
      VERCEL_ENV: "production",
      PUBLIC_BASE_URL: "https://jataaftercall.co.ke",
      NEXTAUTH_URL: "https://fallback.example",
      VERCEL_PROJECT_PRODUCTION_URL: "jata-aftercall.vercel.app",
    })).toBe("https://jataaftercall.co.ke");
  });

  it("preserves an explicit NEXTAUTH_URL when PUBLIC_BASE_URL is absent", () => {
    expect(getBaseUrl({
      VERCEL_ENV: "production",
      NEXTAUTH_URL: "https://owner-configured.example/",
      VERCEL_PROJECT_PRODUCTION_URL: "jata-aftercall.vercel.app",
    })).toBe("https://owner-configured.example");
  });

  it("keeps preview links on the stable production domain, not the protected preview host", () => {
    expect(getBaseUrl({
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "jataaftercall.co.ke",
      VERCEL_URL: "jata-aftercall-preview-abc.vercel.app",
    })).toBe("https://jataaftercall.co.ke");
  });

  it("keeps local development on localhost when no explicit URL is supplied", () => {
    expect(getBaseUrl({ NODE_ENV: "development", VERCEL_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("redirects only the www custom host to the official apex", () => {
    const config = readFileSync("next.config.js", "utf8");
    expect(config).toContain('value: "www.jataaftercall.co.ke"');
    expect(config).toContain('destination: "https://jataaftercall.co.ke/:path*"');
    expect(config).toContain("permanent: true");
    expect(config).not.toContain('value: "jata-aftercall.vercel.app"');
  });
});
