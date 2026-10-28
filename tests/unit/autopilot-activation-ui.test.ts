/**
 * JATA Autopilot activation controls — UI contract.
 *
 * The reported defect was that the three visible controls ("Activate KES 2,499",
 * "Activate KES 6,999", "Activate KES 19,999") appeared inactive. Source-level checks pin the
 * behaviour that makes a click observable and identical across the three plans.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const component = readFileSync(
  path.join(root, "components/autopilot/AutopilotCommandCenter.tsx"),
  "utf8",
);
const client = readFileSync(path.join(root, "lib/autopilot/checkoutClient.ts"), "utf8");

describe("activation buttons", () => {
  it("starts checkout from the plan the owner clicked, addressed by its allowlisted key", () => {
    expect(component).toContain("onClick={() => void startCheckout(plan)}");
    expect(component).toContain("beginAutopilotActivation({ businessId, planKey: plan.key })");
    // The old dead-end — returning early when the stored plan id was null — must be gone.
    expect(component).not.toContain("plan record is not seeded");
    expect(component).not.toContain("if (!planId)");
  });

  it("shows a per-button loading state and blocks a second activation while one runs", () => {
    expect(component).toContain("checkoutInFlight");
    expect(component).toContain("if (checkoutInFlight.current) return;");
    expect(component).toContain("checkoutPlanKey !== null");
    expect(component).toContain("Starting checkout…");
    expect(component).toContain("aria-busy={isStarting}");
  });

  it("renders activation feedback inside the plans panel, not only in the page banner", () => {
    const noticeIndex = component.indexOf('data-testid="autopilot-checkout-notice"');
    const panelIndex = component.indexOf("{/* Subscription Plans */}");
    const gridIndex = component.indexOf('<div className="grid gap-3 md:grid-cols-3">', noticeIndex);
    expect(panelIndex).toBeGreaterThan(-1);
    expect(noticeIndex).toBeGreaterThan(panelIndex);
    expect(noticeIndex).toBeLessThan(gridIndex);
    expect(component).toContain('role="alert"');
    expect(component).toContain('aria-live="assertive"');
    expect(component).toContain("checkoutNotice.action.href");
  });

  it("explains that only an owner or admin can pay when the viewer cannot", () => {
    expect(component).toContain("Only a business owner or admin can activate or renew a JATA Autopilot plan.");
  });

  it("keeps the plan name, price and 30-day period from the server payload", () => {
    expect(component).toContain("formatKES(plan.priceKES)");
    expect(component).toContain("/ 30 days");
  });
});

describe("checkout client", () => {
  it("validates the destination before navigating", () => {
    expect(client).toContain('url.hostname === "checkout.paystack.com"');
    expect(client).toContain('url.pathname === "/checkout/mock"');
  });

  it("maps every failure to a visible notice and never throws", () => {
    for (const code of ["SIGN_IN_REQUIRED", "CHECKOUT_IN_PROGRESS", "PLAN_NOT_CONFIGURED", "PAYMENTS_UNAVAILABLE", "PROVIDER_ERROR"]) {
      expect(client).toContain(code);
    }
    expect(client).toContain("ACTIVATION_NETWORK_ERROR");
    expect(client).toContain("ACTIVATION_BAD_LINK");
    // The only success outcome is a validated redirect.
    expect(client).toContain('kind: "redirect"');
  });
});
