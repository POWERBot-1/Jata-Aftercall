/**
 * Branded recovery screens.
 *
 * Until a root `not-found` and `global-error` existed, an unknown URL fell through to Next.js's
 * unstyled default 404 and a root-layout crash could leave a blank tab — both dead ends with no
 * way back. These render tests pin the replacement screens: one h1, the main landmark, a skip
 * link and real, safe recovery actions, with no raw error text exposed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootNotFound from "@/app/not-found";
import BusinessNotFound from "@/app/b/[slug]/not-found";
import GlobalError from "@/app/global-error";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("root 404", () => {
  const html = renderToStaticMarkup(createElement(RootNotFound));

  it("renders one h1, a main landmark and a skip link", () => {
    expect(html).toContain("<h1");
    expect(html).toContain('id="main"');
    expect(html).toContain('class="jata-skip-link"');
  });

  it("keeps the cross-tenant browser contract: the exact not-found phrase and noindex", () => {
    // The authenticated browser journey asserts the visible phrase and a noindex robots meta on
    // the boundary rendered when an owner opens another owner's workspace route.
    expect(html).toContain("could not be found");
    const source = read("app/not-found.tsx");
    expect(source).toContain("robots:");
    expect(source).toContain("index: false");
  });

  it("offers real recovery routes for new and returning customers", () => {
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/#pricing"');
  });

  it("uses shared tokens rather than a one-off palette", () => {
    expect(html).toContain("jata-page");
    expect(html).not.toMatch(/bg-zinc-|text-zinc-|bg-white\b/);
  });
});

describe("business page 404", () => {
  const html = renderToStaticMarkup(createElement(BusinessNotFound));

  it("explains the business-specific reason and offers a way back", () => {
    expect(html).toContain("<h1");
    expect(html).toContain('id="main"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/#demo"');
  });

  it("is marked noindex so an unresolved page never enters the search index", () => {
    const source = read("app/b/[slug]/not-found.tsx");
    expect(source).toContain("robots:");
    expect(source).toContain("index: false");
  });
});

describe("root global error boundary", () => {
  it("renders a self-contained recovery screen with retry and home, and a digest reference", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: { name: "Error", message: "secret internals", digest: "abc123" } as never, reset: () => {} }),
    );
    expect(html).toContain("<html");
    expect(html).toContain("<h1");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
    expect(html).toContain("Go to home");
    expect(html).toContain("abc123");
    // The raw error message must never reach the customer.
    expect(html).not.toContain("secret internals");
  });
});
