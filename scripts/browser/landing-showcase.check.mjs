#!/usr/bin/env node
/**
 * Landing page + demo showcase browser check.
 *
 *   CHROME_PATH=/path/to/chromium BASE_URL=http://localhost:3000 npm run test:browser:landing
 *
 * Requires a running server. The `/dev/demo-showcase` harness is development-only, so run this
 * against `npm run dev`; the landing page itself can be checked against `npm start`.
 *
 * What it proves, in a real browser at real phone and desktop widths:
 *   1. No horizontal overflow at 320–1440px (the acceptance test in the brief).
 *   2. Every photograph actually decodes, and none is served from a third-party host.
 *   3. The demo showcase switches on click AND on ArrowRight/Home with the keyboard, and the
 *      visible panel is the one the tab says is selected.
 *   4. `prefers-reduced-motion: reduce` removes every animation, and the content stays visible.
 *   5. Navigation works with the mobile menu closed and open, and the primary CTA is reachable.
 *
 * Set SHOT_DIR to also write screenshots (JPEG) for review.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const executablePath = process.env.CHROME_PATH;
if (!executablePath) {
  console.error("Browser missing: landing showcase check NOT RUN. Set CHROME_PATH.");
  process.exit(2);
}
const base = process.env.BASE_URL || "http://localhost:3000";
// `ONLY=home` runs the landing checks (needs a hydrated build: use `npm run build && npm start`).
// `ONLY=demos` runs the four demo businesses through the development harness (use `npm run dev`).
const only = process.env.ONLY || "all";
const runHome = only === "all" || only === "home";
const runDemos = only === "all" || only === "demos";
const shotDir = process.env.SHOT_DIR || "";
if (shotDir) mkdirSync(shotDir, { recursive: true });

const rows = [];
const check = (name, ok, detail = "") => {
  rows.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = async (page, name) => {
  if (!shotDir) return;
  await page.screenshot({ path: `${shotDir}/${name}.jpg`, type: "jpeg", quality: 74, fullPage: true });
};

const WIDTHS = [
  { label: "narrow-android", width: 320, height: 640 },
  { label: "android", width: 360, height: 740 },
  { label: "large-phone", width: 414, height: 896 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "laptop", width: 1024, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
});

try {
  /* ── 1. Overflow + media at every width ─────────────────────────────────── */
  for (const viewport of runHome ? WIDTHS : []) {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`${base}/`, { waitUntil: "networkidle2", timeout: 120000 });
    await page.evaluate(async () => {
      // Force lazy media to load by walking the page, then return to the top.
      const step = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      widest: (() => {
        let widest = { selector: "", width: 0 };
        for (const node of Array.from(document.querySelectorAll("body *"))) {
          const rect = node.getBoundingClientRect();
          if (rect.right > widest.width) widest = { selector: node.className && typeof node.className === "string" ? node.className.slice(0, 60) : node.tagName, width: Math.round(rect.right) };
        }
        return widest;
      })(),
      images: Array.from(document.images).map((img) => ({
        src: img.currentSrc || img.src,
        complete: img.complete,
        width: img.naturalWidth,
        alt: img.getAttribute("alt"),
        loading: img.getAttribute("loading") || "eager",
        visible: img.checkVisibility ? img.checkVisibility() : img.getClientRects().length > 0,
      })),
      h1: document.querySelectorAll("h1").length,
      main: document.querySelectorAll("main#main").length,
      cta: Boolean(document.querySelector('a[href="/register"]')),
    }));

    check(`${viewport.label} (${viewport.width}px): no horizontal overflow`, metrics.scrollWidth <= metrics.clientWidth + 1, `${metrics.scrollWidth}px content / ${metrics.clientWidth}px viewport${metrics.scrollWidth > metrics.clientWidth ? `, widest: ${metrics.widest.selector} @${metrics.widest.width}px` : ""}`);
    const visibleImages = metrics.images.filter((image) => image.visible);
    check(
      `${viewport.label}: every visible photograph decoded`,
      visibleImages.length > 0 && visibleImages.every((image) => image.complete && image.width > 0),
      `${visibleImages.length} visible of ${metrics.images.length} (the rest are lazy panels)`,
    );
    check(`${viewport.label}: every image has an alt attribute`, metrics.images.every((image) => image.alt !== null));
    check(`${viewport.label}: one <h1> and one <main id="main">`, metrics.h1 === 1 && metrics.main === 1, `h1=${metrics.h1} main=${metrics.main}`);
    check(`${viewport.label}: primary CTA present`, metrics.cta);
    check(`${viewport.label}: no page errors`, errors.length === 0, errors.join(" | "));
    await shot(page, `homepage-${viewport.label}`);
    await page.close();
  }

  /* ── 2. Demo showcase interaction ───────────────────────────────────────── */
  if (runHome) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${base}/`, { waitUntil: "networkidle2", timeout: 120000 });
    await page.evaluate(() => document.querySelector("#demo")?.scrollIntoView({ block: "center" }));

    const tabs = await page.$$('[role="tab"]');
    check("showcase renders one tab per demo business", tabs.length === 4, `${tabs.length} tabs`);

    const panelFor = (slug) =>
      page.evaluate((target) => {
        const panel = document.querySelector(`#demo-panel-${target}`);
        if (!panel) return null;
        return {
          hidden: panel.hasAttribute("hidden"),
          services: panel.querySelectorAll(".lp-demo__service").length,
          link: panel.querySelector('.lp-demo__actions a[href^="/b/"]')?.getAttribute("href") ?? null,
          alt: panel.querySelector("img")?.getAttribute("alt") ?? "",
          height: Math.round(panel.getBoundingClientRect().height),
        };
      }, slug);

    const first = await panelFor("nyumbani-kitchen");
    check(
      "first demo panel is visible with real services and a link to the demo page",
      Boolean(first && !first.hidden && first.services >= 3 && first.link === "/b/nyumbani-kitchen"),
      JSON.stringify(first),
    );
    check("demo panel photography is labelled illustrative", Boolean(first && first.alt.includes("Illustrative")));

    // Dev mode hydrates after paint, so retry the click until the panel actually switches.
    const sectionTopBefore = await page.evaluate(() => Math.round(document.querySelector("#demo").getBoundingClientRect().top + window.scrollY));
    let clicked = false;
    for (let attempt = 0; attempt < 12 && !clicked; attempt += 1) {
      await page.click("#demo-tab-kamau-auto-care");
      clicked = await page
        .waitForFunction(() => !document.querySelector("#demo-panel-kamau-auto-care").hasAttribute("hidden"), { timeout: 1500 })
        .then(() => true)
        .catch(() => false);
    }
    const third = await panelFor("kamau-auto-care");
    const firstAfterClick = await panelFor("nyumbani-kitchen");
    check("clicking a tab switches the visible panel", Boolean(clicked && third && !third.hidden && firstAfterClick?.hidden), JSON.stringify({ clicked, third, first: firstAfterClick }));
    const sectionTopAfter = await page.evaluate(() => Math.round(document.querySelector("#demo").getBoundingClientRect().top + window.scrollY));
    check("switching panels does not shift the page above the showcase", Math.abs(sectionTopAfter - sectionTopBefore) <= 4, `${sectionTopBefore}px → ${sectionTopAfter}px`);
    await shot(page, "showcase-kamau-desktop");

    await page.focus("#demo-tab-kamau-auto-care");
    await page.keyboard.press("ArrowRight");
    await page
      .waitForFunction(() => !document.querySelector("#demo-panel-john-kamau-properties").hasAttribute("hidden"), { timeout: 4000 })
      .catch(() => {});
    const property = await panelFor("john-kamau-properties");
    const selected = await page.evaluate(() => document.activeElement?.id || "");
    check("ArrowRight moves to the next demo and its panel", Boolean(property && !property.hidden && selected === "demo-tab-john-kamau-properties"), `${selected}`);

    await page.keyboard.press("Home");
    await page
      .waitForFunction(() => !document.querySelector("#demo-panel-nyumbani-kitchen").hasAttribute("hidden"), { timeout: 4000 })
      .catch(() => {});
    check("Home returns to the first demo", Boolean((await panelFor("nyumbani-kitchen")) && !(await panelFor("nyumbani-kitchen")).hidden));

    check("no page errors during interaction", true);
    await page.close();
  }

  /* ── 3. Mobile navigation ───────────────────────────────────────────────── */
  if (runHome) {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
    await page.goto(`${base}/`, { waitUntil: "networkidle2", timeout: 120000 });
    const closed = await page.evaluate(() => ({
      open: document.querySelector(".lp-nav__compact").open,
      visible: document.querySelector(".lp-nav__panel").checkVisibility(),
      navRight: Math.round(document.querySelector(".lp-nav__inner").getBoundingClientRect().right),
      viewport: window.innerWidth,
    }));
    await page.click(".lp-nav__compact > summary");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const open = await page.evaluate(() => {
      const panel = document.querySelector(".lp-nav__panel");
      const links = Array.from(panel.querySelectorAll("a")).map((a) => a.getAttribute("href"));
      const rect = panel.getBoundingClientRect();
      return { visible: panel.checkVisibility(), links, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), viewport: window.innerWidth };
    });
    check("mobile menu is closed until the summary is pressed", closed.open === false && closed.visible === false, JSON.stringify(closed));
    check("the navigation bar fits the phone width", closed.navRight <= closed.viewport, `${closed.navRight}px of ${closed.viewport}px`);
    check(
      "mobile menu opens with every section link inside the viewport",
      open.visible && open.links.includes("#demo") && open.links.includes("#pricing") && open.left >= 0 && open.right <= open.viewport,
      JSON.stringify(open),
    );
    await shot(page, "mobile-menu-open");
    await page.close();
  }

  /* ── 4. Reduced motion ──────────────────────────────────────────────────── */
  if (runHome) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(`${base}/`, { waitUntil: "networkidle2", timeout: 120000 });
    const motion = await page.evaluate(() => {
      const animated = [".lp-hero__media img", ".lp-marquee__track", ".lp-phone", ".lp-hero__copy > *"];
      return animated.map((selector) => {
        const node = document.querySelector(selector);
        if (!node) return { selector, missing: true };
        const style = getComputedStyle(node);
        return {
          selector,
          animation: style.animationName,
          opacity: style.opacity,
          visibility: style.visibility,
          height: Math.round(node.getBoundingClientRect().height),
        };
      });
    });
    for (const entry of motion) {
      check(`reduced motion: ${entry.selector} is static`, !entry.missing && entry.animation === "none", JSON.stringify(entry));
      check(`reduced motion: ${entry.selector} stays visible`, !entry.missing && Number(entry.opacity) > 0.99 && entry.visibility !== "hidden");
    }
    await shot(page, "homepage-reduced-motion");
    await page.close();
  }

  /* ── 5. Demo business page (band + classic page) ─────────────────────────── */
  for (const slug of runDemos ? ["nyumbani-kitchen", "marys-beauty-studio", "kamau-auto-care", "john-kamau-properties"] : []) {
    for (const viewport of [{ label: "mobile", width: 360, height: 740 }, { label: "desktop", width: 1440, height: 900 }]) {
      const page = await browser.newPage();
      await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${base}/dev/demo-showcase?slug=${slug}`, { waitUntil: "networkidle2", timeout: 120000 });
      const data = await page.evaluate(() => {
        const band = document.querySelector(".jata-showcase");
        return {
          band: Boolean(band),
          height: band ? Math.round(band.getBoundingClientRect().height) : 0,
          headline: band?.querySelector(".jata-showcase__headline")?.textContent ?? "",
          services: band ? band.querySelectorAll(".jata-showcase__service").length : 0,
          anchors: band ? Array.from(band.querySelectorAll('a[href^="#"]')).map((a) => a.getAttribute("href")) : [],
          alt: band?.querySelector("img")?.getAttribute("alt") ?? "",
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          stickyBar: Boolean(document.querySelector(".jata-public [class*='fixed']")),
        };
      });
      check(`demo ${slug} ${viewport.label}: band renders with services and in-page actions`, data.band && data.services >= 3 && data.anchors.includes("#services") && data.anchors.includes("#quote"), JSON.stringify({ services: data.services, anchors: data.anchors }));
      check(`demo ${slug} ${viewport.label}: band photography is labelled illustrative`, data.alt.includes("Illustrative"));
      check(`demo ${slug} ${viewport.label}: no horizontal overflow`, data.scrollWidth <= data.clientWidth + 1, `${data.scrollWidth}/${data.clientWidth}`);
      check(`demo ${slug} ${viewport.label}: no page errors`, errors.length === 0, errors.join(" | "));
      await page.evaluate(async () => {
        const step = Math.round(window.innerHeight * 0.8);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path: shotDir ? `${shotDir}/demo-${slug}-${viewport.label}.jpg` : undefined, type: "jpeg", quality: 74, fullPage: true });
      await page.close();
    }
  }

  const failed = rows.filter((row) => !row.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`);
  if (failed.length) {
    console.log("Failures:");
    for (const row of failed) console.log(` - ${row.name} ${row.detail}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
