import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children) }));
import { DashboardNav } from "@/components/DashboardNav";

describe("workspace navigation", () => {
  beforeEach(() => { pathname = "/dashboard"; });
  it.each(["/dashboard", "/dashboard/subscription", "/dashboard/ai", "/dashboard/studio", "/dashboard/pos", "/dashboard/erp", "/dashboard/autopilot"])('includes BOS at %s', (path) => {
    pathname = path;
    const html = renderToStaticMarkup(React.createElement(DashboardNav, { isAdmin: false }));
    expect(html).toContain('href="/dashboard/erp"');
    expect(html.indexOf('href="/dashboard/pos"')).toBeLessThan(html.indexOf('href="/dashboard/erp"'));
    expect(html.indexOf('href="/dashboard/erp"')).toBeLessThan(html.indexOf('href="/dashboard/autopilot"'));
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it("marks nested BOS screens active without matching unrelated prefixes", () => {
    pathname = "/dashboard/erp/business/settings";
    expect(renderToStaticMarkup(React.createElement(DashboardNav, { isAdmin: false }))).toMatch(/href="\/dashboard\/erp" aria-current="page"/);
    pathname = "/dashboard/erp-other";
    expect(renderToStaticMarkup(React.createElement(DashboardNav, { isAdmin: false }))).not.toContain('aria-current="page"');
  });
  it("uses the shared authenticated dashboard shell and wraps the workspace rail", () => {
    expect(readFileSync("app/dashboard/layout.tsx", "utf8")).toContain("<DashboardNav");
    expect(readFileSync("app/globals.css", "utf8")).toMatch(/\.ws-rail--workspace\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
