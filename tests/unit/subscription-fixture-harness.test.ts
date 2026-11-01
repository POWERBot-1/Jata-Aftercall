import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FIXTURE_RESULT_PATH,
  simulateSubscriptionApi,
  simulatedAuthorizationUrl,
  simulatedResultCopy,
  SUBSCRIPTION_FIXTURE_OUTCOMES,
} from "@/lib/subscription/fixtures/subscriptionFixture";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const FIXTURE_FILES = [
  "lib/subscription/fixtures/subscriptionFixture.ts",
  "components/subscription/fixture/SubscriptionFixtureClient.tsx",
  "app/dev/subscription-fixture/page.tsx",
  "app/dev/subscription-fixture/paystack-simulated/page.tsx",
];

describe("subscription fixture safety", () => {
  it("every fixture page 404s in production", () => {
    for (const rel of ["app/dev/subscription-fixture/page.tsx", "app/dev/subscription-fixture/paystack-simulated/page.tsx"]) {
      const src = read(rel);
      expect(src, rel).toMatch(/if \(process\.env\.NODE_ENV === "production"\) notFound\(\)/);
    }
  });

  it("fixture code never references a payment provider, secret, or external URL", () => {
    for (const rel of FIXTURE_FILES) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/paystack\.co|https?:\/\//i);
      expect(src, rel).not.toMatch(/PAYSTACK_|process\.env\.(?!NODE_ENV)/);
      expect(src, rel).not.toMatch(/from ["']@\/lib\/payments|prisma|@\/lib\/db/i);
    }
  });

  it("simulated authorization URLs are same-origin fixture paths only", () => {
    for (const outcome of SUBSCRIPTION_FIXTURE_OUTCOMES) {
      const url = simulatedAuthorizationUrl(outcome);
      expect(url.startsWith(`${FIXTURE_RESULT_PATH}?`)).toBe(true);
      expect(url).not.toMatch(/^[a-z]+:|^\/\//i);
    }
  });

  it("the transport fails closed for routes outside the fixture", async () => {
    const res = await simulateSubscriptionApi({ outcome: "success", method: "POST", path: "/api/subscription/activate", body: {} });
    expect(res).toBeNull();
    const pay = await simulateSubscriptionApi({ outcome: "success", method: "GET", path: "/api/checkout", body: {} });
    expect(pay).toBeNull();
  });

  it("checkout success returns the fictional KES 1,500 amount and a fixture URL, never a provider link", async () => {
    const res = await simulateSubscriptionApi({ outcome: "success", method: "POST", path: "/api/checkout", body: {} });
    const data = (await res!.json()) as { simulated: boolean; payment: { amount: number; currency: string }; authorization_url: string };
    expect(data.simulated).toBe(true);
    expect(data.payment).toEqual({ amount: 150000, currency: "KES" });
    expect(data.authorization_url.startsWith(FIXTURE_RESULT_PATH)).toBe(true);
  });

  it("checkout failure starts no payment and returns no authorization URL", async () => {
    const res = await simulateSubscriptionApi({ outcome: "failure", method: "POST", path: "/api/checkout", body: {} });
    expect(res!.status).toBe(422);
    const data = (await res!.json()) as { error: string; authorization_url?: string };
    expect(data.error).toMatch(/^FICTIONAL FIXTURE/);
    expect(data.authorization_url).toBeUndefined();
  });

  it("registration failure creates no account and success is labelled simulated", async () => {
    const fail = await simulateSubscriptionApi({ outcome: "failure", method: "POST", path: "/api/auth/register", body: {} });
    expect(fail!.status).toBe(422);
    expect(((await fail!.json()) as { error: string }).error).toMatch(/No account was created/);
    const ok = await simulateSubscriptionApi({ outcome: "success", method: "POST", path: "/api/auth/register", body: {} });
    expect(((await ok!.json()) as { simulated: boolean }).simulated).toBe(true);
  });

  it("simulated result copy never claims verification, collection, or activation", () => {
    for (const outcome of ["success", "cancelled", undefined]) {
      const copy = simulatedResultCopy(outcome);
      expect(`${copy.title} ${copy.body}`).toMatch(/SIMULATED|FICTIONAL/);
      const text = `${copy.title} ${copy.body}`;
      expect(text).toMatch(/no money moved|nothing was charged|activates nothing|no subscription was activated/i);
      expect(text).not.toMatch(/has been activated|was activated successfully|payment (was )?(received|successful)|verified payment|subscription (is|is now) active/i);
    }
  });
});

describe("RegisterForm and CheckoutForm production behaviour is unchanged", () => {
  it("RegisterForm still navigates to /dashboard when no fixture hook is given", () => {
    const src = read("components/RegisterForm.tsx");
    expect(src).toMatch(/if \(onRegistered\) \{\s*onRegistered\(\);\s*return;\s*\}\s*router\.push\("\/dashboard"\);/);
  });

  it("CheckoutForm still delegates the amount to the server and redirects only to the server-provided URL", () => {
    const src = read("components/CheckoutForm.tsx");
    expect(src).toContain("window.location.assign(data.authorization_url)");
    expect(src).toContain("The amount you pay is set by our server");
  });
});
