import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import AgentsPage from "@/app/agents/page";

describe("agent programme public entry", () => {
  it("links to the programme near the end of the homepage", () => {
    const home = readFileSync("app/page.tsx", "utf8");
    expect(home).toContain('href="/agents"');
    expect(home.indexOf('href="/agents"')).toBeGreaterThan(home.indexOf('id="pricing"'));
  });

  it("does not claim applications or commissions are available", () => {
    const html = renderToStaticMarkup(createElement(AgentsPage));
    expect(html).toContain("Applications can be submitted using an existing account");
    expect(html).toContain("Registration alone will not guarantee a commission");
    expect(html).toContain('href="/agents/apply"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/contact"');
  });
});
