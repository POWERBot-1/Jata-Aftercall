/**
 * Workspace semantic status tokens and the themed inline notice.
 *
 * Regression for a real defect: the AI Front Desk flow copied three notice blocks that hard-coded
 * a light-red palette (`#fef2f2` / `#991b1b`) and the stepper hard-coded `#1a140d`. Those values
 * do not re-point in the graphite (lime-spark) theme, so an error rendered as a near-unreadable
 * light box on a dark surface. The fix introduces workspace danger/on-amber tokens in BOTH theme
 * blocks and a single `WorkspaceNotice` component built on them. These tests keep that true.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceNotice } from "@/components/workspace/WorkspaceUI";

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
const aiWorkspace = readFileSync(path.join(root, "components/ai/AIFrontDeskWorkspace.tsx"), "utf8");

const count = (token: string) => (css.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

describe("workspace semantic status tokens exist in every theme", () => {
  const tokens = ["--ws-danger:", "--ws-danger-soft:", "--ws-danger-line:", "--ws-on-amber:", "--ws-jade-line:"];

  it("declares each token", () => {
    for (const token of tokens) expect(css).toContain(token);
  });

  it("re-declares each token for the graphite theme, not only the light default", () => {
    // One declaration in the default `.ws-shell` block and one inside the lime-spark override.
    for (const token of tokens) expect(count(token), token).toBeGreaterThanOrEqual(2);
  });
});

describe("themed inline notice component", () => {
  it("renders a success line as a polite status and an error line as an alert", () => {
    const success = renderToStaticMarkup(createElement(WorkspaceNotice, { tone: "success", children: "Saved" }));
    expect(success).toContain('role="status"');
    expect(success).toContain("ws-notice--success");

    const error = renderToStaticMarkup(createElement(WorkspaceNotice, { tone: "error", children: "Could not save" }));
    expect(error).toContain('role="alert"');
    expect(error).toContain("ws-notice--error");
  });

  it("is styled entirely through tokens", () => {
    expect(css).toContain(".ws-notice {");
    expect(css).toContain(".ws-notice--success");
    expect(css).toContain(".ws-notice--error");
    const noticeBlock = css.slice(css.indexOf(".ws-notice {"));
    expect(noticeBlock).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe("hard-coded colours are removed from the AI Front Desk flow", () => {
  it("no longer hard-codes the light-red notice palette or the stepper ink", () => {
    for (const hex of ["#fef2f2", "#991b1b", "#1a140d"]) {
      expect(aiWorkspace, hex).not.toContain(hex);
    }
  });

  it("uses the shared WorkspaceNotice instead of inline notice styles", () => {
    expect(aiWorkspace).toContain("WorkspaceNotice");
    expect(aiWorkspace).not.toMatch(/role=\{[a-zA-Z]+Notice\.tone === "error"/);
  });
});

describe("workspace success/warning message text is theme-aware", () => {
  const publishPanel = readFileSync(path.join(root, "components/dashboard/PublishPanel.tsx"), "utf8");
  const websiteHealth = readFileSync(path.join(root, "components/dashboard/WebsiteHealth.tsx"), "utf8");

  it("uses the jade/amber tokens instead of fixed Tailwind palette classes", () => {
    for (const source of [publishPanel, websiteHealth]) {
      expect(source).not.toMatch(/text-emerald-\d00/);
      expect(source).not.toMatch(/text-amber-\d00/);
      expect(source).toContain("var(--ws-jade)");
      expect(source).toContain("var(--ws-amber-deep)");
    }
  });
});

describe("destructive controls and statuses use the danger tokens", () => {
  it("the workspace danger button no longer hard-codes a light palette", () => {
    const rule = css.slice(css.indexOf(".ws-shell .jata-btn-danger")).split("\n")[0];
    expect(rule).toContain("var(--ws-danger)");
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("the workspace danger status uses the danger tokens", () => {
    const rule = css.slice(css.indexOf('.ws-status[data-tone="danger"]')).split("\n")[0];
    expect(rule).toContain("var(--ws-danger)");
    expect(rule).not.toContain("#dc2626");
  });
});
