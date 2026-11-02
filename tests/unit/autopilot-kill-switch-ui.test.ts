/**
 * Regression tests: Autopilot kill-switch and pause UI state (fixture data, real component).
 *
 * Renders the REAL AutopilotCommandCenter with fictional fixture overviews and asserts which
 * controls are disabled. Approval and execution remain server-authoritative: these tests check
 * the UI disabling layer only. Server refusal is covered by autopilot-fixture-safety.test.ts
 * (decision level) and by the browser capture (actual HTTP responses). Nothing here sends a
 * request, changes state, or touches a real tenant.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AutopilotCommandCenter } from "@/components/autopilot/AutopilotCommandCenter";
import {
  buildFixtureOverview,
  createFixtureState,
  FIXTURE_BUSINESS_A,
  type FixtureRole,
  type FixtureScenarioId,
} from "@/lib/autopilot/fixtures/autopilotFixtureModel";

function render(opts: {
  scenario: FixtureScenarioId;
  role?: FixtureRole;
  globalKillSwitch?: boolean;
}): string {
  const state = createFixtureState(opts.scenario, {
    role: opts.role ?? "OWNER",
    tenant: "a",
    globalKillSwitch: opts.globalKillSwitch,
  });
  const overview = buildFixtureOverview(state, FIXTURE_BUSINESS_A);
  return renderToStaticMarkup(
    createElement(AutopilotCommandCenter, { businessId: FIXTURE_BUSINESS_A, initialData: overview }),
  );
}

/** Returns the opening tag of every <button> whose visible text includes `label` (HTML-escaped). */
function buttonsLabelled(markup: string, label: string): string[] {
  return markup
    .split("<button")
    .slice(1)
    .map((chunk) => "<button" + chunk.slice(0, chunk.indexOf(">") + 1) + chunk.slice(chunk.indexOf(">") + 1))
    .filter((chunk) => chunk.slice(0, chunk.indexOf("</button>")).includes(label))
    .map((chunk) => chunk.slice(0, chunk.indexOf(">") + 1));
}

const APPROVE = "Approve &amp; Execute";
const REJECT = "Reject";
const INSPECT = "Inspect &amp; Extract Safely";
const KILL_ALERT = "Platform Kill Switch Active";

describe("kill switch ACTIVE: approval controls are disabled", () => {
  const markup = render({ scenario: "kill-switch", role: "OWNER", globalKillSwitch: true });

  it("shows the kill-switch alert with the reactivation explanation", () => {
    expect(markup).toContain(KILL_ALERT);
    expect(markup).toContain("cannot be made from this screen");
    expect(markup).toContain('role="alert"');
  });

  it("disables every Approve & Execute control while pending proposals exist", () => {
    const approves = buttonsLabelled(markup, APPROVE);
    expect(approves.length).toBeGreaterThan(0);
    for (const tag of approves) expect(tag).toContain("disabled");
  });

  it("disables inspect/extract and suggested-proposal creation", () => {
    for (const tag of buttonsLabelled(markup, INSPECT)) expect(tag).toContain("disabled");
  });

  it("keeps Reject available (a safe, final action)", () => {
    const rejects = buttonsLabelled(markup, REJECT);
    expect(rejects.length).toBeGreaterThan(0);
    for (const tag of rejects) expect(tag).not.toContain("disabled");
  });

  it("does not claim an execution happened", () => {
    expect(markup).not.toContain("Action verified and executed");
  });
});

describe("kill switch INACTIVE: approval controls are enabled for an authorised role", () => {
  const markup = render({ scenario: "approval-pending", role: "OWNER", globalKillSwitch: false });

  it("has no kill-switch alert", () => {
    expect(markup).not.toContain(KILL_ALERT);
  });

  it("enables Approve & Execute for pending proposals", () => {
    const approves = buttonsLabelled(markup, APPROVE);
    expect(approves.length).toBeGreaterThan(0);
    for (const tag of approves) expect(tag).not.toContain("disabled");
  });

  it("keeps inspect disabled only because the input is empty (not because of the kill switch)", () => {
    // Inspect requires text; with empty input it is disabled regardless of kill-switch state.
    for (const tag of buttonsLabelled(markup, INSPECT)) expect(tag).toContain("disabled");
    const killed = render({ scenario: "kill-switch", role: "OWNER", globalKillSwitch: true });
    for (const tag of buttonsLabelled(killed, INSPECT)) expect(tag).toContain("disabled");
  });
});

describe("tenant paused: approval controls are disabled", () => {
  const markup = render({ scenario: "paused", role: "OWNER", globalKillSwitch: false });

  it("disables Approve & Execute while the tenant is paused", () => {
    const approves = buttonsLabelled(markup, APPROVE);
    for (const tag of approves) expect(tag).toContain("disabled");
  });
});

describe("STAFF (read-only): approval controls are disabled regardless of kill switch", () => {
  it("disables Approve & Execute and inspect with the kill switch inactive", () => {
    const markup = render({ scenario: "approval-pending", role: "STAFF", globalKillSwitch: false });
    for (const tag of buttonsLabelled(markup, APPROVE)) expect(tag).toContain("disabled");
    for (const tag of buttonsLabelled(markup, INSPECT)) expect(tag).toContain("disabled");
  });

  it("disables Approve & Execute with the kill switch active too", () => {
    const markup = render({ scenario: "kill-switch", role: "STAFF", globalKillSwitch: true });
    for (const tag of buttonsLabelled(markup, APPROVE)) expect(tag).toContain("disabled");
  });
});

describe("source guards: the halted flag and in-flight guard are wired", () => {
  it("combines tenant pause and the platform kill switch into one halted flag", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("components/autopilot/AutopilotCommandCenter.tsx", "utf8");
    expect(src).toContain("const isHalted = isPaused || data.globalKillSwitchActive;");
    expect(src).toContain("disabled={busy || isHalted || !canConfigure}");
    // No approval control may be left gated only on the tenant pause.
    expect(src).not.toMatch(/disabled=\{busy \|\| isPaused \|\| !canConfigure\}/);
  });

  it("blocks APPROVE_AND_EXECUTE before any request while halted", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("components/autopilot/AutopilotCommandCenter.tsx", "utf8");
    const fnAt = src.indexOf("async function runProposalOperation(");
    expect(fnAt).toBeGreaterThan(0);
    const guard = src.indexOf('operation === "APPROVE_AND_EXECUTE" &&', fnAt);
    const fetchAt = src.indexOf('fetch("/api/autopilot/proposals"', fnAt);
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(fetchAt);
    expect(src).toContain("Nothing was executed.");
  });

  it("gives both approval controls the theme-text focus ring and keeps the 24px radio target", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("components/autopilot/AutopilotCommandCenter.tsx", "utf8");
    const css = readFileSync("app/globals.css", "utf8");
    expect(src.match(/autopilot-approval-control/g)?.length).toBe(2);
    expect(css).toContain(".jata-btn.autopilot-approval-control:focus-visible {\n  outline: 2px solid var(--jata-ink);");
    expect(css).toContain('.product-theme-option input[type="radio"] { width: 24px; height: 24px;');
  });
});
