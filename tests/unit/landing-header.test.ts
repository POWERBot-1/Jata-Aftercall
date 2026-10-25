import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Navbar } from "@/components/Navbar";
import { BrandMark } from "@/components/ui/BrandMark";

/**
 * Header contract — the landing header's wordmark, tagline and account controls.
 *
 * Two defects were reported against `main` (2026-10-25): the wordmark overlapped the Dashboard
 * control on a phone, and the tagline "Every call leaves your business behind." was missing on
 * mobile. The browser check (`scripts/browser/home-header-tagline.check.mjs`) proves the layout at
 * every width; this file pins the markup and the CSS rules that make that layout possible, so a
 * future edit that re-introduces either defect fails here as well.
 */

const css = readFileSync("app/globals.css", "utf8");
const TAGLINE = "Every call leaves your business behind.";

/** Every `@media` block with this query, with its braces stripped. */
function mediaBlocks(query: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(`@media ${query}`, from);
    if (start < 0) return blocks;
    const open = css.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    expect(end, `unbalanced @media ${query}`).toBeGreaterThan(0);
    blocks.push(css.slice(open + 1, end));
    from = end;
  }
}

/** Rules of every `@media` block with this query, merged in source order. */
function mediaRules(query: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const block of mediaBlocks(query)) {
    for (const [selector, declarations] of Object.entries(rulesOf(block))) {
      out[selector] = { ...(out[selector] ?? {}), ...declarations };
    }
  }
  return out;
}

/** CSS comments are stripped first: a comment inside a rule body would otherwise be read as part of
 * the declaration that follows it. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/** `min-width` becomes `minWidth`, so the assertions read as CSS properties. */
const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

function declarationsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const declaration of body.split(";").map((d) => d.trim()).filter(Boolean)) {
    const index = declaration.indexOf(":");
    if (index < 0) continue;
    out[camel(declaration.slice(0, index).trim())] = declaration.slice(index + 1).trim();
  }
  return out;
}

/** Every rule inside a block, keyed by selector, declarations merged in source order. */
function rulesOf(block: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const match of withoutComments(block).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    out[selector] = { ...(out[selector] ?? {}), ...declarationsOf(match[2]) };
  }
  return out;
}

/** Declarations of every rule whose selector exactly matches, merged in source order. */
function rule(selector: string, source = css): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`, "g");
  const merged: Record<string, string> = {};
  let found = false;
  for (const match of withoutComments(source).matchAll(re)) {
    found = true;
    Object.assign(merged, declarationsOf(match[2]));
  }
  expect(found, `missing CSS rule ${selector}`).toBe(true);
  return merged;
}

// JSX is not available in a .ts test file (vitest collects only *.test.ts / *.spec.ts), so the
// components are created with createElement.
const renderNavbar = (session?: { email: string; role: string } | null) => renderToStaticMarkup(createElement(Navbar, { session }));

describe("landing header markup", () => {
  it("renders the wordmark, the tagline and the account controls once each", () => {
    const html = renderNavbar({ email: "owner@example.com", role: "USER" });
    expect(html).toContain('class="jata-brand-mark"');
    expect(html).toContain("AFTERCALL");
    expect(html.match(/Every call leaves your business behind/g)?.length).toBe(1);
    expect(html).toContain('class="lp-nav__actions"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('class="lp-nav__panel"');
  });

  it("keeps the tagline inside the brand link, not in a second header element", () => {
    const html = renderNavbar(null);
    const tagline = html.match(/<span class="jata-brand-tag">([^<]*)<\/span>/);
    expect(tagline, "the tagline span must render").toBeTruthy();
    expect(tagline![1]).toBe(TAGLINE);
    // The tagline's closest anchor is the brand link, so it inherits the wordmark's destination.
    const brand = html.slice(0, tagline!.index);
    const lastAnchor = brand.lastIndexOf("<a ");
    expect(brand.slice(lastAnchor, brand.indexOf(">", lastAnchor))).toContain('class="jata-brand"');
  });

  it("offers Dashboard, Admin and Logout to a signed-in visitor and to the menu panel", () => {
    const html = renderNavbar({ email: "owner@example.com", role: "ADMIN" });
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('action="/api/auth/logout"');
    // The panel repeats the account links for the phone menu; each keeps its destination.
    expect(html.match(/href="\/dashboard"/g)?.length).toBe(2);
    expect(html.match(/href="\/admin"/g)?.length).toBe(2);
  });

  it("keeps the anonymous header on the login and register flows", () => {
    const html = renderNavbar(null);
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/register"');
    expect(html).not.toContain('href="/dashboard"');
  });

  it("leaves compact headers (dashboard, product shells) without the marketing line", () => {
    const compact = renderToStaticMarkup(createElement(BrandMark, { compact: true }));
    expect(compact).not.toContain("jata-brand-tag");
    const full = renderToStaticMarkup(createElement(BrandMark, {}));
    expect(full).toContain("jata-brand-tag");
    expect(full.match(/Every call leaves your business behind/g)?.length).toBe(1);
  });
});

describe("landing header layout rules", () => {
  it("puts the tagline on its own line under the wordmark below the tablet breakpoint", () => {
    const phone = mediaRules("(max-width: 639px)");
    const tagline = phone[".lp-nav .jata-brand-tag"];
    expect(tagline, "the phone tagline rule must exist").toBeTruthy();
    expect(tagline!.display).toBe("block");
    expect(tagline!.width).toBe("100%");
    expect(tagline!.minWidth).toBe("0");
    // The wordmark stacks the tagline under itself and grows into the space the controls leave, so the
    // tagline line is as wide as the bar allows instead of being squeezed into the wordmark's width.
    expect(phone[".lp-nav .jata-brand"]?.flexDirection).toBe("column");
    expect(phone[".lp-nav .jata-brand"]?.flex).toBe("1 1 auto");
  });

  it("keeps the tagline inline above the tablet breakpoint, as the redesign had it", () => {
    const desktop = mediaRules("(min-width: 640px)");
    expect(desktop[".lp-nav .jata-brand-tag"]?.display).toBe("inline");
  });

  it("moves the account links into the menu panel on a phone so the wordmark keeps its text", () => {
    const phone = mediaRules("(max-width: 419px)");
    expect(phone[".lp-nav .lp-nav__actions"]?.display).toBe("none");
    // The wordmark must never be clipped to fit: no rule hides its name on a phone.
    expect(phone[".lp-nav .jata-brand-name"]).toBeUndefined();
    expect(mediaRules("(max-width: 379px)")[".lp-nav .jata-brand-name"]).toBeUndefined();
  });

  it("lets the header row wrap instead of pushing the wordmark into the controls", () => {
    expect(rule(".lp-nav__inner").flexWrap).toBe("wrap");
    expect(rule(".lp-nav .jata-brand").minWidth).toBe("0");
    expect(rule(".lp-nav__actions").minWidth).toBe("0");
    expect(mediaRules("(min-width: 980px)")[".lp-nav__links"]?.flexWrap).toBe("wrap");
  });

  it("turns the tagline on per surface instead of toggling it by viewport width", () => {
    // The shared rule stays off; only the landing header switches it on. A global min-width rule is
    // what made the tagline disappear below 640 px while the header never overrode it.
    const shared = rule(".jata-brand-tag");
    expect(shared.display).toBe("none");
    expect(shared.minWidth).toBe("0");
    // No media query toggles the bare shared rule: the landing header owns its own breakpoint.
    expect(mediaRules("(min-width: 640px)")[".jata-brand-tag"], "the bare .jata-brand-tag must not be toggled by a media query").toBeUndefined();
    expect(mediaRules("(max-width: 639px)")[".jata-brand-tag"], "the bare .jata-brand-tag must not be toggled by a media query").toBeUndefined();
  });
});
