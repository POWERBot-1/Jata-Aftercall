import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getBusinessUrl, getBusinessPath, getBaseUrl } from "@/lib/url";

// Every variable getBaseUrl() reads. Each test starts from a clean slate and sets only what it needs.
const ENV_KEYS = ["PUBLIC_BASE_URL", "NEXTAUTH_URL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_ENV"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const original: Partial<Record<EnvKey, string | undefined>> = {};
for (const key of ENV_KEYS) original[key] = process.env[key];

function setEnv(values: Partial<Record<EnvKey, string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

// Real values observed in production for this project: VERCEL_URL is the ephemeral, Deployment-Protected
// host; VERCEL_PROJECT_PRODUCTION_URL is the stable production domain. Neither carries a scheme.
const STABLE_HOST = "jata-aftercall.vercel.app";
const EPHEMERAL_HOST = "jata-aftercall-e2p2idokw-powerbot-1.vercel.app";
const STABLE_URL = `https://${STABLE_HOST}`;

beforeEach(() => setEnv({}));
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (original[key] !== undefined) process.env[key] = original[key];
    else delete process.env[key];
  }
});

describe("url helpers — domain abstraction", () => {
  it("uses PUBLIC_BASE_URL for canonical business URL", () => {
    setEnv({ PUBLIC_BASE_URL: "https://jata-aftercall.vercel.app" });
    expect(getBusinessUrl("marys-beauty")).toBe("https://jata-aftercall.vercel.app/b/marys-beauty");
    expect(getBusinessPath("marys-beauty")).toBe("/b/marys-beauty");
  });

  it("strips trailing slash", () => {
    setEnv({ PUBLIC_BASE_URL: "https://jata-aftercall.pages.dev/" });
    expect(getBusinessUrl("nyumbani-kitchen")).toBe("https://jata-aftercall.pages.dev/b/nyumbani-kitchen");
  });

  it("falls back to localhost when not configured", () => {
    setEnv({ NEXTAUTH_URL: "http://localhost:3000" });
    expect(getBaseUrl()).toContain("localhost");
  });

  it("never hardcodes jata.link", () => {
    setEnv({ PUBLIC_BASE_URL: "https://jata-aftercall.vercel.app" });
    const url = getBusinessUrl("test-biz");
    expect(url).not.toContain("jata.link");
    expect(url).toContain("/b/");
  });

  it("no production domain is hard-coded", () => {
    setEnv({ NEXTAUTH_URL: "http://localhost:3000" });
    const base = getBaseUrl();
    expect(base).not.toContain("jata.link");
    expect(base).not.toContain("vercel.app");
    expect(getBusinessUrl("test")).toContain("/b/test");
  });
});

describe("getBaseUrl — stable production URL on Vercel (Fix 1)", () => {
  it("regression: production runtime with localhost PUBLIC_BASE_URL resolves to the stable production URL, not the ephemeral deployment host", () => {
    setEnv({
      PUBLIC_BASE_URL: "http://localhost:3000",
      NEXTAUTH_URL: "http://localhost:3000",
      VERCEL_ENV: "production",
      VERCEL_URL: EPHEMERAL_HOST,
      VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST,
    });
    const base = getBaseUrl();
    expect(base).toBe(STABLE_URL);
    expect(base).not.toContain("localhost");
    expect(base).not.toContain(EPHEMERAL_HOST);
  });

  it("prefers VERCEL_PROJECT_PRODUCTION_URL over ephemeral VERCEL_URL when nothing explicit is configured", () => {
    setEnv({ VERCEL_ENV: "production", VERCEL_URL: EPHEMERAL_HOST, VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST });
    expect(getBaseUrl()).toBe(STABLE_URL);
  });

  it("non-local PUBLIC_BASE_URL takes precedence over both Vercel URLs", () => {
    setEnv({
      PUBLIC_BASE_URL: "https://jata-aftercall.pages.dev",
      VERCEL_ENV: "production",
      VERCEL_URL: EPHEMERAL_HOST,
      VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST,
    });
    expect(getBaseUrl()).toBe("https://jata-aftercall.pages.dev");
  });

  it("non-local NEXTAUTH_URL takes precedence over Vercel URLs when PUBLIC_BASE_URL is localhost", () => {
    setEnv({
      PUBLIC_BASE_URL: "http://localhost:3000",
      NEXTAUTH_URL: "https://jata-aftercall.pages.dev/",
      VERCEL_ENV: "production",
      VERCEL_URL: EPHEMERAL_HOST,
      VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST,
    });
    expect(getBaseUrl()).toBe("https://jata-aftercall.pages.dev");
  });

  it("localhost PUBLIC_BASE_URL does not override the production URL", () => {
    setEnv({ PUBLIC_BASE_URL: "http://localhost:3000", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST });
    expect(getBaseUrl()).toBe(STABLE_URL);
  });

  it("localhost NEXTAUTH_URL does not override the production URL", () => {
    setEnv({ NEXTAUTH_URL: "http://localhost:3000", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST });
    expect(getBaseUrl()).toBe(STABLE_URL);
  });

  it("127.0.0.1 and 0.0.0.0 values are treated as local and ignored on Vercel", () => {
    setEnv({ PUBLIC_BASE_URL: "http://127.0.0.1:3000", NEXTAUTH_URL: "http://0.0.0.0:3000", VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST });
    expect(getBaseUrl()).toBe(STABLE_URL);
  });

  it("legacy fallback: only ephemeral VERCEL_URL exposed still yields an https deployment URL (never localhost)", () => {
    setEnv({ PUBLIC_BASE_URL: "http://localhost:3000", VERCEL_URL: EPHEMERAL_HOST });
    expect(getBaseUrl()).toBe(`https://${EPHEMERAL_HOST}`);
  });

  it("tolerates a scheme and trailing slash on Vercel-provided hosts", () => {
    setEnv({ VERCEL_PROJECT_PRODUCTION_URL: `https://${STABLE_HOST}/` });
    expect(getBaseUrl()).toBe(STABLE_URL);
    setEnv({ VERCEL_URL: `https://${EPHEMERAL_HOST}/` });
    expect(getBaseUrl()).toBe(`https://${EPHEMERAL_HOST}`);
  });

  it("preview deployments also point customer-facing URLs at the stable production domain", () => {
    setEnv({ VERCEL_ENV: "preview", VERCEL_URL: "jata-aftercall-git-feature-powerbot-1.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST });
    expect(getBaseUrl()).toBe(STABLE_URL);
  });

  it("existing consumers derive stable production URLs: checkout callback, logout redirect, metadataBase, business URL", () => {
    setEnv({
      PUBLIC_BASE_URL: "http://localhost:3000",
      VERCEL_ENV: "production",
      VERCEL_URL: EPHEMERAL_HOST,
      VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST,
    });
    const base = getBaseUrl();
    // app/api/checkout/route.ts — callbackUrl: `${base}/checkout/callback?reference=${reference}`
    expect(`${base}/checkout/callback?reference=jata_abc`).toBe(`${STABLE_URL}/checkout/callback?reference=jata_abc`);
    // app/api/auth/logout/route.ts — new URL("/login", getBaseUrl())
    expect(new URL("/login", base).toString()).toBe(`${STABLE_URL}/login`);
    // app/layout.tsx — metadataBase: new URL(getBaseUrl())
    expect(new URL(base).origin).toBe(STABLE_URL);
    // dashboard share link / sitemap / canonical
    expect(getBusinessUrl("karis-farm")).toBe(`${STABLE_URL}/b/karis-farm`);
  });
});

describe("getBaseUrl — local/development behavior preserved", () => {
  it("no Vercel variables: PUBLIC_BASE_URL -> NEXTAUTH_URL -> http://localhost:3000", () => {
    setEnv({ PUBLIC_BASE_URL: "http://localhost:3000", NEXTAUTH_URL: "http://localhost:4000" });
    expect(getBaseUrl()).toBe("http://localhost:3000");
    setEnv({ NEXTAUTH_URL: "http://localhost:4000" });
    expect(getBaseUrl()).toBe("http://localhost:4000");
    setEnv({});
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });

  it("`vercel dev` (VERCEL_ENV=development) keeps localhost even though production variables are exposed", () => {
    setEnv({
      PUBLIC_BASE_URL: "http://localhost:3000",
      VERCEL_ENV: "development",
      VERCEL_URL: "localhost:3000",
      VERCEL_PROJECT_PRODUCTION_URL: STABLE_HOST,
    });
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });

  it("a localhost VERCEL_URL alone never produces an https://localhost origin", () => {
    setEnv({ VERCEL_URL: "localhost:3000" });
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });
});
