/**
 * Autopilot interactive-controls repair (2026-10-26).
 *
 * The owner reported that on the JATA Autopilot page most icons, navigation items and
 * buttons "appear inactive". Browser reproduction (production build, desktop + mobile)
 * isolated distinct causes rather than one global failure:
 *
 *   1. The Appearance (product theme) options panel rendered UNDER the sticky workspace
 *      chrome: `.product-theme-toolbar` was z-index 40 while `.ws-chrome` is z-index 60,
 *      so the first theme option was covered and taps landed on the nav rail instead.
 *   2. The Autopilot hero's "Open Command Center" button only scrolled to an on-page
 *      anchor — and with zero businesses the anchor target did not exist, so the control
 *      did literally nothing.
 *   3. Every Command Center action handler used try/finally without catch, so a failed
 *      request (e.g. a dropped mobile connection) reset the button with no feedback.
 *   4. The section rail links were 40px tall, below the 44px touch target DashboardNav
 *      documents.
 *
 * These tests pin the repaired contracts. The matching real-browser verification is
 * `scripts/browser/autopilot-controls.check.mjs`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function zIndexOf(css: string, selectorPattern: RegExp): number {
  const match = css.match(selectorPattern);
  expect(match, `CSS rule not found: ${selectorPattern}`).toBeTruthy();
  const z = match![0].match(/z-index:\s*(\d+)/);
  expect(z, `z-index not found in rule: ${selectorPattern}`).toBeTruthy();
  return Number(z![1]);
}

describe("Appearance picker stacking", () => {
  const css = read("app/globals.css");

  it("paints the open Appearance panel above the sticky workspace chrome", () => {
    const chromeZ = zIndexOf(css, /\.ws-chrome\s*\{[^}]*\}/);
    const landingNavZ = zIndexOf(css, /\.jata-nav\.lp-nav\s*\{[^}]*\}/);
    const openToolbarZ = zIndexOf(
      css,
      /\.product-theme-toolbar:has\(> \.product-theme-picker\[open\]\)\s*\{[^}]*\}/,
    );
    expect(openToolbarZ).toBeGreaterThan(chromeZ);
    expect(openToolbarZ).toBeGreaterThan(landingNavZ);
  });

  it("keeps the closed toolbar beneath modal sheets so scrims still cover it", () => {
    const toolbarZ = zIndexOf(css, /\.product-theme-toolbar\s*\{[^}]*\}/);
    const sheetZ = zIndexOf(css, /\.jata-sheet\s*\{[^}]*\}/);
    expect(toolbarZ).toBeLessThan(sheetZ);
  });

  it("closes the picker after a theme is chosen and on Escape", () => {
    const provider = read("components/ProductThemeProvider.tsx");
    expect(provider).toContain("chooseAndClose");
    expect(provider).toContain('removeAttribute("open")');
    expect(provider).toContain('"Escape"');
  });
});

describe("Autopilot hero primary action", () => {
  const page = read("app/dashboard/autopilot/page.tsx");

  it("never labels a same-page scroll as opening the Command Center", () => {
    expect(page).not.toContain('<Link href="#autopilot-businesses" className="ws-btn-amber">\n              <Sparkles size={16} aria-hidden="true" /> Open Command Center');
  });

  it("opens the single business's Command Center directly", () => {
    expect(page).toContain("businesses.length === 1");
    expect(page).toContain("/dashboard/autopilot/${encodeURIComponent(onlyBusiness.id)}");
    expect(page).toContain('{entitlements[0]?.entitled ? "Open Command Center" : "Preview Command Center"}');
  });

  it("starts business creation when there are no businesses (no dead anchor)", () => {
    expect(page).toContain("businesses.length === 0");
    expect(page).toMatch(/<Link href="\/onboarding" className="ws-btn-amber">/);
  });

  it("labels the multi-business scroll as choosing a business", () => {
    expect(page).toContain("Choose a business");
    expect(page).toContain('href="#autopilot-businesses"');
  });

  it("keeps a per-business Command Center link with that business's own id", () => {
    expect(page).toContain("`/dashboard/autopilot/${encodeURIComponent(business.id)}`");
  });
});

describe("Command Center feedback on failed requests", () => {
  const cc = read("components/autopilot/AutopilotCommandCenter.tsx");

  it("defines one honest network-error notice", () => {
    expect(cc).toContain("NETWORK_ERROR_NOTICE");
    expect(cc).toContain("could not reach JATA");
  });

  it("surfaces network errors from every action handler instead of swallowing them", () => {
    // patchConfig, queueSuggestedProposal, runProposalOperation, submitOwnerCommand,
    // handleIngestSubmit, handleRecordConsent, refreshOverview.
    // Activation (startCheckout) reports through lib/autopilot/checkoutClient.ts, which returns
    // the same network notice as an inline result — see tests/unit/autopilot-checkout-client.test.ts.
    const catches = cc.match(/setBannerNotice\(NETWORK_ERROR_NOTICE\)/g) ?? [];
    expect(catches.length).toBeGreaterThanOrEqual(7);
    expect(cc).toContain("beginAutopilotActivation(");
  });

  it("reports a failed owner-pressed refresh", () => {
    expect(cc).toContain("refreshOverview({ reportError: true })");
    expect(cc).toContain("Could not refresh the Command Center.");
  });

  it("applies the config route's saved-configuration echo immediately", () => {
    expect(cc).toContain("if (json.config)");
    expect(cc).toContain("setData((prev) => ({ ...prev, config: json.config }))");
  });

  it("still does not fake success: errors use the server message first", () => {
    expect(cc).toContain('json.error || "Could not update Autopilot settings."');
    // Checkout reports the server's message through the shared client module, and only treats a
    // response as success when it carries a checkout URL that passed validation.
    expect(cc).toContain('outcome.kind === "redirect"');
    expect(cc).toContain("window.location.assign(outcome.url)");
    expect(cc).toContain("setCheckoutNotice(outcome.notice)");
  });
});

describe("workspace rail touch targets", () => {
  it("keeps rail links at a 44px (2.75rem) minimum height", () => {
    const css = read("app/globals.css");
    const railLink = css.match(/\.ws-rail a\s*\{[^}]*\}/)?.[0] ?? "";
    expect(railLink).toContain("min-height: 2.75rem");
  });
});
