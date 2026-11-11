import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The 320x568 capture that raised the Share-edge question is the CLASSIC business page
// (`/b/nyumbani-kitchen`, `.jata-public`), whose sticky bar is `variant="sticky"` inside
// `fixed inset-x-0 bottom-0` → `px-3`. The experience storefront's `.eb-actionbar` is a DIFFERENT
// component and is already measured in scripts/browser/actionbar-layout.check.mjs at 14.4px.
// These tests pin the classic bar's real horizontal inset so the two are not conflated, and so the
// inset cannot be silently removed.
const page = readFileSync("components/BusinessPage.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

// Tailwind's default spacing scale: `px-3` = 0.75rem = 12px at the default root font size.
const PX_3 = 12;

describe("classic sticky action bar keeps a real edge inset", () => {
  it("renders the sticky bar full-bleed with an inner padded gutter", () => {
    // Full-bleed wrapper + inner container is what produces the gutter; `inset-x-0` alone would not.
    expect(page).toContain("fixed inset-x-0 bottom-0");
    expect(page).toContain("px-3 py-2");
    expect(page).toContain('variant="sticky"');
  });

  it("keeps the 12px gutter clear of the 8px floor used by the storefront checker", () => {
    expect(PX_3).toBeGreaterThanOrEqual(8);
    // No negative margin may eat the gutter back.
    const stickyBlock = page.slice(page.indexOf("Sticky bottom action bar"), page.indexOf("variant=\"sticky\""));
    expect(stickyBlock).not.toMatch(/-mx-\d/);
    expect(stickyBlock).not.toMatch(/px-0\b/);
  });

  it("does not reintroduce a zero side padding on the sticky controls", () => {
    const stickyRule = css.slice(css.indexOf(".jata-contact-actions--sticky .jata-contact-action {"));
    const rule = stickyRule.slice(0, stickyRule.indexOf("}"));
    // Horizontal padding is intentionally tiny (the container supplies the gutter) but must not be 0.
    expect(rule).toMatch(/padding:\s*0\.35rem\s+0\.15rem/);
    expect(rule).not.toMatch(/padding:\s*0\.35rem\s+0(rem|px)?\s*;/);
  });

  it("honours the device safe area at the bottom", () => {
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(page).toContain("safe-bottom");
  });

  it("keeps the four actions at a 44px touch target on the classic bar", () => {
    const baseRule = css.slice(css.indexOf(".jata-contact-action {"));
    expect(baseRule.slice(0, baseRule.indexOf("}"))).toContain("min-height: 2.75rem");
    // 2.75rem = 44px at the default root font size.
    expect(2.75 * 16).toBe(44);
  });
});

// The isolation gate's behaviour is itself a control: it must refuse anything that is not the
// disposable harness (exit 2 = BLOCKED, distinct from exit 1 = a real failed check). Pinning it stops
// a future edit from quietly turning this measurement into something that can point at production.
describe("classic sticky check refuses non-disposable targets", () => {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const SCRIPT = "scripts/browser/classic-sticky-gutter.check.mjs";
  // Any existing executable satisfies the CHROME_PATH presence test; the gate runs before launch.
  const run = (env: Record<string, string | undefined>) =>
    spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      timeout: 30000,
      env: { PATH: process.env.PATH, CHROME_PATH: process.execPath, ...env },
    });

  it("blocks when CI is not set", () => {
    const r = run({ DATABASE_URL: "postgresql://jata:jata@localhost:5432/jata_e2e?schema=public", AUTH_SECRET: "interactive-business-e2e-test-secret" });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toContain("refusing a non-isolated target");
  });

  it("blocks when the database is not the disposable one", () => {
    const r = run({ CI: "1", DATABASE_URL: "postgresql://user:pw@db.production.example/app", AUTH_SECRET: "interactive-business-e2e-test-secret" });
    expect(r.status).toBe(2);
  });

  it("blocks when AUTH_SECRET is not the test secret", () => {
    const r = run({ CI: "1", DATABASE_URL: "postgresql://jata:jata@localhost:5432/jata_e2e?schema=public", AUTH_SECRET: "a-real-secret" });
    expect(r.status).toBe(2);
  });
});
