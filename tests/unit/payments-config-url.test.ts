import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { publicBaseUrl, readMpesaConfig } from "@/lib/payments/config";

const URL_ENV_KEYS = [
  "PUBLIC_BASE_URL",
  "NEXTAUTH_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "MPESA_CALLBACK_TOKEN",
  "MPESA_STK_CALLBACK_URL",
  "MPESA_C2B_CONFIRMATION_URL",
  "MPESA_C2B_VALIDATION_URL",
] as const;
const original = new Map<string, string | undefined>();
for (const key of URL_ENV_KEYS) original.set(key, process.env[key]);

function clearUrlEnvironment() {
  for (const key of URL_ENV_KEYS) delete process.env[key];
}

beforeEach(clearUrlEnvironment);
afterAll(() => {
  for (const key of URL_ENV_KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("payment provider callback origin", () => {
  it("uses the stable Vercel production host when operator URL variables are absent", () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "jata-aftercall-preview-abc.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "jata-aftercall.vercel.app";

    expect(publicBaseUrl()).toBe("https://jata-aftercall.vercel.app");
    process.env.MPESA_CALLBACK_TOKEN = "fixture-token";
    const config = readMpesaConfig();
    expect(config.stkCallbackUrl).toBe("https://jata-aftercall.vercel.app/api/payments/webhooks/mpesa/stk?token=fixture-token");
    expect(config.c2bConfirmationUrl).toBe("https://jata-aftercall.vercel.app/api/payments/webhooks/mpesa/confirmation?token=fixture-token");
  });

  it("keeps explicit operator origins ahead of Vercel fallback and strips trailing slashes", () => {
    process.env.PUBLIC_BASE_URL = "https://jataaftercall.co.ke/";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "jata-aftercall.vercel.app";

    expect(publicBaseUrl()).toBe("https://jataaftercall.co.ke");
  });

  it("preserves localhost fallback for local development only", () => {
    expect(publicBaseUrl()).toBe("http://localhost:3000");
  });
});
