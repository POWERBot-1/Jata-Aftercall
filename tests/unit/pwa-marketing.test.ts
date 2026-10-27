/**
 * Phase 6/8/11/16 — public marketing navigation, installable PWA contract and release-gate
 * regression coverage. Source-level checks are used deliberately: they catch a broken link or an
 * unsafe caching rule before a browser is available.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function pngSize(file: string): { width: number; height: number; signature: boolean } {
  const buffer = readFileSync(path.join(root, file));
  const signature = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), signature };
}

describe("installable PWA", () => {
  it("has a valid, complete manifest with real icon files", () => {
    const manifest = JSON.parse(read("public/manifest.json"));
    expect(manifest.name).toBe("JATA AFTERCALL");
    expect(manifest.short_name).toBe("AFTERCALL");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#14110f");
    expect(manifest.background_color).toBe("#f7f2e8");
    expect(manifest.icons.some((icon: any) => icon.purpose === "maskable" && icon.sizes === "512x512")).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(path.join(root, "public", icon.src)), icon.src).toBe(true);
  });

  it("ships real PNG icons at the declared sizes", () => {
    for (const [file, size] of [["public/icons/icon-192.png", 192], ["public/icons/icon-512.png", 512], ["public/icons/apple-touch-icon.png", 180]] as const) {
      const info = pngSize(file);
      expect(info.signature, file).toBe(true);
      expect(info.width, file).toBe(size);
      expect(info.height, file).toBe(size);
    }
  });

  it("wires the manifest, viewport and lifecycle UI into the root layout", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('manifest: "/manifest.json"');
    expect(layout).toContain("appleWebApp");
    expect(layout).toContain("export const viewport");
    expect(layout).toContain("<PwaInstaller />");
    const installer = read("components/pwa/PwaInstaller.tsx");
    expect(installer).toContain('register("/sw.js"');
    expect(installer).toContain("SKIP_WAITING");
    expect(installer).toContain('data-pwa-online="false"');
    expect(installer).toContain("beforeinstallprompt");
    expect(installer).not.toContain("toLocale");
  });

  it("caches only safe public static assets and never HTML, APIs or private pages", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('"/api/"');
    for (const prefix of ["/dashboard", "/admin", "/checkout", "/receipt", "/login", "/register", "/b/", "/onboarding"]) {
      expect(sw, prefix).toContain(prefix);
    }
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain("caches.match(OFFLINE_URL)");
    expect(sw).toContain("no-store|private");
    expect(sw).toContain("if (url.search) return false");
    expect(sw).not.toContain("cache.put(event.request"); // no blanket navigation caching
  });

  it("offline page is honest about what needs connectivity", () => {
    const offline = read("public/offline.html");
    expect(offline).toContain("You are offline");
    expect(offline).toContain("Paystack payments, verification and receipts");
    expect(offline).toContain("AI Front Desk answers and Website Studio generation");
    expect(offline).toContain("No offline financial transactions are created.");
  });
});

describe("public marketing pages", () => {
  const pages = [
    "app/products/page.tsx",
    "app/products/[slug]/page.tsx",
    "app/pricing/page.tsx",
    "app/faq/page.tsx",
    "app/help/page.tsx",
    "app/contact/page.tsx",
    "app/install/page.tsx",
    "app/privacy/page.tsx",
    "app/terms/page.tsx",
  ];

  it("all required routes exist and use the shared landing design system", () => {
    for (const file of pages) {
      expect(existsSync(path.join(root, file)), file).toBe(true);
      expect(statSync(path.join(root, file)).size, file).toBeGreaterThan(200);
    }
    const shell = read("components/marketing/MarketingShell.tsx");
    expect(shell).toContain('className="lp-page mk-page"');
    expect(shell).toContain("lp-section");
    expect(shell).toContain("lp-h2");
  });

  it("every internal link in the new pages resolves to a real route or known app route", () => {
    const known = new Set([
      "/", "/#demo", "/#pricing", "/#faq", "/#benefits", "/#product",
      "/login", "/register", "/forgot-password", "/dashboard", "/dashboard/subscription",
      "/help", "/faq", "/contact", "/install", "/privacy", "/terms", "/products", "/pricing",
      "/products/business-page", "/products/ai-front-desk", "/products/website-studio", "/products/business-pos",
      "/b/nyumbani-kitchen", "/b/marys-beauty-studio", "/b/kamau-auto-care", "/b/john-kamau-properties",
    ]);
    const sources = [...pages, "components/marketing/MarketingShell.tsx", "components/landing/FaqAndFooter.tsx"];
    for (const file of sources) {
      const source = read(file);
      const links = [...source.matchAll(/href="(\/[^"#]*(?:#[^"]*)?)"/g)].map((match) => match[1]);
      for (const link of links) {
        const pathname = link.split("#")[0] || "/";
        if (pathname.startsWith("/b/")) continue;
        if (known.has(link) || known.has(pathname)) continue;
        const candidate = pathname === "/" ? "app/page.tsx" : `app${pathname}/page.tsx`;
        expect(existsSync(path.join(root, candidate)) || existsSync(path.join(root, `app${pathname}/route.ts`)), `${file} → ${link}`).toBe(true);
      }
    }
  });

  it("marketing shell renders all support and policy links with a skip link", async () => {
    const { MarketingLayout, MarketingHeader, MarketingFooter } = await import("@/components/marketing/MarketingShell");
    const html = renderToStaticMarkup(createElement(MarketingLayout as any, { eyebrow: "Test", title: "Test page", intro: "Test intro", children: createElement("p", null, "body") } as any));
    expect(html).toContain("Skip to content");
    for (const href of ["/products", "/pricing", "/faq", "/install", "/contact", "/privacy", "/terms"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    expect(renderToStaticMarkup(createElement(MarketingHeader as any))).toContain("Get started");
    expect(renderToStaticMarkup(createElement(MarketingFooter as any))).toContain("/b/nyumbani-kitchen");
  });

  it("sitemap lists every new static page", async () => {
    const source = read("app/sitemap.ts");
    for (const route of ["/products", "/pricing", "/faq", "/help", "/contact", "/install", "/privacy", "/terms"]) {
      expect(source, route).toContain(`"${route}"`);
    }
    expect(read("app/robots.ts")).toContain("sitemap.xml");
  });

  it("pricing copy preserves the authoritative plan order and prices without inventing a refund promise", () => {
    const pricing = read("app/pricing/page.tsx");
    expect(pricing).toContain("homepagePlanCards");
    expect(pricing).toContain("There is no self-service in-app refund button");
    expect(pricing).not.toMatch(/automatic refund|money-back guarantee/i);
    const planOrder = read("lib/pricing.ts");
    expect(planOrder).toContain('["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "JATA_AUTOPILOT", "INTERACTIVE_BUSINESS", "BUSINESS_POS"]');
  });

  it("contact page does not invent a support email or phone number", () => {
    const contact = read("app/contact/page.tsx");
    expect(contact).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(contact).not.toMatch(/07\d{8}|2547\d{8}/);
    expect(contact).toContain("PASSWORD_RESET_SMTP_URL");
  });

  it("release evidence directory is present for genuine artefacts", () => {
    const dir = path.join(root, "docs", "evidence");
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });
});
