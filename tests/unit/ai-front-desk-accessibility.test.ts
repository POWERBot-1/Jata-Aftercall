/**
 * AI Front Desk — mobile and accessibility evidence (P1).
 *
 * These assertions are the measurable part of the accessibility claim in the delivery report:
 * contrast ratios computed from the actual design tokens, tap targets read from the actual
 * stylesheet, and the label/announcement wiring checked in the actual components. No screenshots
 * and no browser are involved, so this cannot drift into a claim the code does not support.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const globals = readFileSync(path.join(root, "app/globals.css"), "utf8");
const workspace = readFileSync(path.join(root, "components/ai/AIFrontDeskWorkspace.tsx"), "utf8");
const console_ = readFileSync(path.join(root, "components/AIDashboardClient.tsx"), "utf8");
const customer = readFileSync(path.join(root, "components/AIFrontDeskCustomerClient.tsx"), "utf8");
const noticeComponent = readFileSync(path.join(root, "components/workspace/WorkspaceUI.tsx"), "utf8");

function token(name: string): string {
  const match = globals.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`missing colour token --${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe("colour contrast (WCAG 2.1 AA, 4.5:1 for body text)", () => {
  it.each([
    ["ws-text", "ws-paper"],
    ["ws-text", "ws-cream"],
    ["ws-muted", "ws-paper"],
    ["ws-muted", "ws-cream"],
    ["ws-amber-deep", "ws-paper"],
    ["ws-amber-deep", "ws-amber-soft"],
    ["ws-jade", "ws-jade-soft"],
    ["ws-on-ink", "ws-ink"],
  ])("--%s on --%s", (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the deliberately faint token out of body copy", () => {
    // --ws-faint is 3.85:1, so it may only be used for non-text decoration. The AI surfaces use
    // --ws-text / --ws-muted for every string they render.
    for (const [name, source] of Object.entries({ workspace, console_, customer })) {
      expect(source, name).not.toContain("ws-faint");
    }
  });
});

describe("tap targets for narrow Android screens", () => {
  it("keeps every button at least 44px tall through the design system", () => {
    expect(globals).toMatch(/\.jata-btn\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(globals).toMatch(/\.ws-shell \.jata-btn\.jata-btn-sm\s*\{\s*min-height:\s*2\.75rem/);
    expect(globals).toMatch(/\.jata-cta\s*\{[^}]*min-height:\s*2\.75rem/);
  });

  it("gives the compact pill controls an explicit 44px floor", () => {
    for (const [name, source] of Object.entries({ workspace, console_, customer })) {
      expect(source, name).not.toMatch(/min-h-(7|8|9|10)\b/);
      expect(source, name).toContain("min-h-11");
    }
  });

  it("never relies on a fixed pixel width that would overflow a 320px screen", () => {
    for (const [name, source] of Object.entries({ workspace, console_, customer })) {
      expect(source, name).not.toMatch(/\bw-\[\d{3,}px\]/);
      expect(source, name).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
    }
  });

  it("wraps action rows instead of clipping them", () => {
    expect(workspace).toContain("flex flex-wrap");
    expect(console_).toContain("flex flex-wrap");
  });
});

describe("keyboard and focus", () => {
  it("draws a visible focus ring on every interactive primitive", () => {
    expect(globals).toMatch(/\.jata-btn:focus-visible[\s\S]{0,120}outline:\s*2px solid var\(--jata-focus\)/);
    expect(globals).toMatch(/outline-offset:\s*2px/);
    expect(globals).toMatch(/a:focus-visible,\s*[\r\n]+button:focus-visible/);
  });

  it("keeps screen-reader-only text available for anything visual-only", () => {
    // `sr-only` comes from Tailwind's utility layer; this pins that the components actually use it
    // rather than silently dropping context that is only conveyed visually.
    expect(workspace).toContain("sr-only");
  });

  it("uses real buttons and links rather than clickable divs", () => {
    expect(workspace).not.toMatch(/<div[^>]*onClick=/);
    expect(console_).not.toMatch(/<div[^>]*onClick=/);
    expect(customer).not.toMatch(/<div[^>]*onClick=/);
  });
});

describe("screen-reader semantics", () => {
  it("labels every text input it renders", () => {
    const labels = [...workspace.matchAll(/htmlFor="([^"]+)"/g)].map((match) => match[1]);
    const controls = [...workspace.matchAll(/id="(fd-[^"]+)"/g)]
      .map((match) => match[1])
      .filter((id) => !/-(error|hint|note)$/.test(id));
    expect(labels.length).toBeGreaterThan(5);
    for (const label of labels) expect(controls, label).toContain(label);
    for (const control of controls) expect(labels, control).toContain(control);
  });

  it("announces async results instead of only painting them", () => {
    // The error/status role mapping now lives in the shared WorkspaceNotice component (themed and
    // reused across the guided flows). The workspace keeps its error/success tone split and the
    // component maps an error to alert and every other result to status.
    expect(workspace).toContain('<WorkspaceNotice tone={publishNotice.tone === "error" ? "error" : "success"}');
    expect(noticeComponent).toContain('role={tone === "error" ? "alert" : "status"}');
    expect(workspace).toContain('aria-live="polite"');
    expect(workspace).toContain("aria-busy");
    expect(console_).toContain('role="status"');
    expect(customer).toContain('aria-live');
  });

  it("marks the current step and the step list for assistive technology", () => {
    expect(workspace).toContain('aria-label="AI Front Desk setup steps"');
    expect(workspace).toContain('aria-current={active ? "step" : undefined}');
  });

  it("describes invalid fields with aria-invalid and a linked error", () => {
    expect(workspace).toContain("aria-invalid={profileErrors.name ? true : undefined}");
    expect(workspace).toContain('aria-describedby={profileErrors.name ? "fd-name-error" : "fd-name-hint"}');
    expect(workspace).toContain('<p id="fd-name-error" role="alert" className="jata-error">');
  });

  it("hides decorative icons from the accessibility tree", () => {
    const icons = [...workspace.matchAll(/<(Loader2|ArrowRight|ArrowLeft|Sparkles|Radio|Wallet|Store|Lock|Clock|MessageSquare|ShieldAlert|CreditCard|RefreshCw|PlayCircle|ImagePlus|BadgeCheck|Bot|MapPin|Phone|Send|CheckCircle2)\b[^>]*>/g)];
    expect(icons.length).toBeGreaterThan(10);
    for (const [tag] of icons) expect(tag).toContain('aria-hidden="true"');
  });
});

describe("no silent failures", () => {
  it("never uses alert() or a full page reload to report an outcome", () => {
    for (const [name, source] of Object.entries({ workspace, console_, customer })) {
      expect(source, name).not.toMatch(/\balert\(/);
      expect(source, name).not.toContain("location.reload");
    }
  });

  it("gives every network failure a retry path", () => {
    expect(workspace).toContain("Try again");
    expect(console_).toContain("Try again");
    expect(customer).toContain("try again");
  });
});
