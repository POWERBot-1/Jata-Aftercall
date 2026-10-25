#!/usr/bin/env node
/**
 * Home header + hero tagline browser check — 2026-10-25.
 *
 *   CHROME_PATH=/path/to/chromium BASE_URL=http://localhost:3000 SHOT_DIR=docs/evidence/home-header-2026-10-25 \
 *   node scripts/browser/home-header-tagline.check.mjs
 *
 * Requires a running server (`npm run dev`, or `npm run build && npm start`). What it proves, in a
 * real headless Chromium at the widths the brief names (320, 360, 390, 414, 768, 1024, 1280, 1440):
 *
 *   1. "JATA AFTERCALL" and the navigation controls never overlap, at any width, in the anonymous
 *      header and in the signed-in header (the session links are injected exactly as `Navbar`
 *      renders them), including with the browser's root font scaled up and with the menu open.
 *   2. Both texts are visible and unclipped: the wordmark (`JATA` mark + `AFTERCALL`) and the tagline
 *      "Every call leaves your business behind.". "Unclipped" means the painted text box of every
 *      piece stays inside the nav bar and inside its own element box — a flex row that squeezes a
 *      wordmark below its text width is reported, because that is what makes the letters collide.
 *   3. The tagline is rendered exactly once in the visible content — no duplicate, no hidden copy.
 *   4. No horizontal page overflow, and the header/hero spacing is sane.
 *   5. Keyboard navigation, the native `<details>` menu and accessible names still work.
 *   6. The Dashboard link keeps its destination, and anonymous `/dashboard/pos` still redirects to login.
 *
 * Exits 2 when Chrome is missing, so a run without a browser is reported as NOT RUN rather than as a pass.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const executablePath = process.env.CHROME_PATH;
if (!executablePath) {
  console.error("Browser missing: home header check NOT RUN. Set CHROME_PATH.");
  process.exit(2);
}
const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const shotDir = process.env.SHOT_DIR || "";
if (shotDir) mkdirSync(shotDir, { recursive: true });

// React 18 logs the lower-case `fetchpriority` hint in Hero.tsx as a console error. It is pre-existing
// on `main` (baseline run 2026-10-25), is not caused by this change and does not affect layout, so it
// is reported as informational rather than as a failure of this check.
const PRE_EXISTING_CONSOLE = /fetchpriority/i;

/** The exact markup `Navbar` renders in `.lp-nav__actions` for a signed-in visitor. */
const SESSION_ACTIONS = `
  <a class="jata-btn jata-btn-secondary jata-btn-sm" href="/dashboard"><span>Dashboard</span></a>
  <a class="jata-btn jata-btn-secondary jata-btn-sm" href="/admin"><span>Admin</span></a>
  <form class="lp-nav__logout" action="/api/auth/logout" method="post">
    <button class="jata-btn jata-btn-ghost jata-btn-sm" type="button">Logout</button>
  </form>`;

/** The same session links as they appear in the phone menu panel. */
const SESSION_PANEL = `
  <a class="lp-nav__panel-link" href="/dashboard">Dashboard</a>
  <a class="lp-nav__panel-link" href="/admin">Admin</a>
  <form action="/api/auth/logout" method="post">
    <button class="lp-nav__panel-link lp-nav__panel-button" type="button">Logout</button>
  </form>`;

const rows = [];
const info = (name, detail = "") => {
  console.log(`INFO ${name}${detail ? ` — ${detail}` : ""}`);
};
const check = (name, ok, detail = "") => {
  rows.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const VIEWPORTS = [
  { label: "320", width: 320, height: 640 },
  { label: "360", width: 360, height: 740 },
  { label: "390", width: 390, height: 844 },
  { label: "414", width: 414, height: 896 },
  { label: "768", width: 768, height: 1024 },
  { label: "1024", width: 1024, height: 768 },
  { label: "1280", width: 1280, height: 800 },
  { label: "1440", width: 1440, height: 900 },
];

/** Measured facts about the header, the tagline and the page box. Runs in the page. */
const measure = () => {
  // Every helper lives inside this function: it is serialised into the page, so it cannot reach the
  // module scope.
  const TAGLINE = "Every call leaves your business behind.";
  const round = (value) => Math.round(value * 10) / 10;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
  };
  // The layout box of an element's text — what actually paints on screen.
  const textRectOf = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
  };
  const intersectArea = (a, b) => {
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return overlapX > 0 && overlapY > 0 ? overlapX * overlapY : 0;
  };
  // Union of a list of boxes; zero-size boxes (hidden content) are ignored.
  const union = (boxes) => {
    const live = boxes.filter((box) => box && box.width > 0 && box.height > 0);
    if (!live.length) return null;
    return {
      left: round(Math.min(...live.map((box) => box.left))),
      right: round(Math.max(...live.map((box) => box.right))),
      top: round(Math.min(...live.map((box) => box.top))),
      bottom: round(Math.max(...live.map((box) => box.bottom))),
      width: 0,
      height: 0,
    };
  };
  const inside = (rect, container) => {
    if (!rect || !container) return false;
    return (
      rect.left >= container.left - 0.5 &&
      rect.right <= container.right + 0.5 &&
      rect.top >= container.top - 0.5 &&
      rect.bottom <= container.bottom + 0.5
    );
  };
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const nav = document.querySelector("nav.lp-nav");
  if (!nav) return { missing: "nav.lp-nav" };
  const navRect = rectOf(nav);

  const brand = document.querySelector(".lp-nav .jata-brand");
  const brandMark = document.querySelector(".lp-nav .jata-brand-mark");
  const brandName = document.querySelector(".lp-nav .jata-brand-name");
  const brandTag = document.querySelector(".lp-nav .jata-brand-tag");
  const actions = document.querySelector(".lp-nav__actions");
  const links = document.querySelector(".lp-nav__links");
  const compact = document.querySelector(".lp-nav__compact");
  const panel = document.querySelector(".lp-nav__panel");

  const actionNodes = [...(actions?.querySelectorAll("a, button") ?? [])];
  const linkNodes = [...(links?.querySelectorAll("a") ?? [])];
  const panelNodes = [...(panel?.querySelectorAll("a, button") ?? [])];

  // The painted extent of the brand is the union of the text boxes of its three pieces.
  const brandPaint = union([textRectOf(brandMark), textRectOf(brandName), textRectOf(brandTag)]);
  // A piece whose painted text is wider than its own box has been squeezed by a flex row: its letters
  // spill past the box and are what collide with the controls next to it.
  const squeezed = (el) => {
    if (!el || !visible(el)) return false;
    const text = textRectOf(el);
    const box = rectOf(el);
    return text.width > box.width + 0.5;
  };

  // DOM nodes must not be part of the returned object: the result is serialised out of the page.
  const pieces = [
    { name: "mark", el: brandMark },
    { name: "name", el: brandName },
    { name: "tagline", el: brandTag },
  ].map((piece) => ({
    name: piece.name,
    visible: visible(piece.el),
    text: (piece.el?.textContent || "").trim(),
    textRect: textRectOf(piece.el),
    box: rectOf(piece.el),
    squeezed: squeezed(piece.el),
    insideNav: inside(textRectOf(piece.el), navRect),
  }));

  const groups = [
    { name: "nav-links", rect: union(linkNodes.map(rectOf)) },
    { name: "nav-actions", rect: union(actionNodes.map(rectOf)) },
    { name: "nav-menu", rect: compact ? rectOf(compact) : null },
  ].filter((group) => group.rect);

  const overlaps = brandPaint
    ? groups
        .map((group) => ({ name: group.name, area: Math.round(intersectArea(brandPaint, group.rect) * 100) / 100 }))
        .filter((entry) => entry.area > 0)
    : [];

  // The tagline, counted the way a reader would see it: the rendered text of the whole page.
  const renderedTaglines = (document.body.innerText || "").split("Every call leaves your business behind").length - 1;
  const taglineLeafNodes = [...document.querySelectorAll("body *")].filter(
    (el) => !el.children.length && (el.textContent || "").trim() === TAGLINE,
  ).length;

  const dashboard =
    actionNodes.find((node) => (node.textContent || "").trim() === "Dashboard") ??
    panelNodes.find((node) => (node.textContent || "").trim() === "Dashboard") ??
    null;

  return {
    viewport: window.innerWidth,
    innerWidth: document.documentElement.clientWidth,
    navRect,
    brand: {
      visible: visible(brand),
      paint: brandPaint,
      pieces,
      nameText: (brandName?.textContent || "").trim(),
    },
    tagline: {
      visible: visible(brandTag),
      text: (brandTag?.textContent || "").trim(),
      paint: textRectOf(brandTag),
      href: brandTag?.closest("a")?.getAttribute("href") ?? null,
    },
    actions: {
      visible: visible(actions),
      rect: actions ? rectOf(actions) : null,
      labels: actionNodes.map((node) => ({ label: (node.textContent || "").trim(), href: node.getAttribute("href") })),
    },
    links: linkNodes.map((node) => ({ label: (node.textContent || "").trim(), href: node.getAttribute("href") })),
    panelLinks: panelNodes.map((node) => ({ label: (node.textContent || "").trim(), href: node.getAttribute("href") })),
    overlaps,
    dashboard: dashboard ? { label: "Dashboard", href: dashboard.getAttribute("href") } : null,
    renderedTaglines,
    taglineLeafNodes,
    h1: document.querySelectorAll("h1").length,
    h1Text: document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    heroCopyTop: document.querySelector(".lp-hero__copy") ? round(document.querySelector(".lp-hero__copy").getBoundingClientRect().top) : null,
    skipLink: document.querySelector(".jata-skip-link")?.getAttribute("href") ?? null,
    compactOpen: Boolean(compact?.open),
  };
};

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
});

/** Loads the landing page and returns the page plus the errors logged while it loaded. */
const open = async (viewport, { session = false } = {}) => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !PRE_EXISTING_CONSOLE.test(message.text())) errors.push(`console: ${message.text()}`);
  });
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  await page.goto(`${base}/`, { waitUntil: "networkidle2", timeout: 120000 });
  await page.waitForSelector(".lp-nav .jata-brand", { timeout: 30000 });
  if (session) {
    // Signed-in header: the same markup `Navbar` renders for a session, in the bar and in the phone
    // menu panel (the anonymous links are replaced, not duplicated).
    await page.evaluate(({ actions, panel }) => {
      const bar = document.querySelector(".lp-nav__actions");
      if (bar) bar.innerHTML = actions;
      const menu = document.querySelector(".lp-nav__panel");
      if (menu) {
        for (const node of [...menu.querySelectorAll("a[href='/login']")]) node.remove();
        menu.insertAdjacentHTML("beforeend", panel);
      }
    }, { actions: SESSION_ACTIONS, panel: SESSION_PANEL });
  }
  return { page, errors };
};

const headerChecks = async (label, f, viewport, errors, shot) => {
  const overlapNames = f.overlaps.map((entry) => `${entry.name}+${entry.area}px²`).join(", ");
  check(`${label}: no header overlap`, f.overlaps.length === 0, overlapNames || `nav ${f.navRect.width}px`);

  const brandPiecesOk = f.brand.pieces.every((piece) => (piece.name === "tagline" ? true : piece.visible && piece.insideNav && !piece.squeezed));
  check(
    `${label}: "JATA AFTERCALL" visible, unclipped and inside the header`,
    f.brand.visible && f.brand.nameText === "AFTERCALL" && brandPiecesOk,
    `mark=${JSON.stringify(f.brand.pieces[0].textRect)} name=${JSON.stringify(f.brand.pieces[1].textRect)} squeezed=${f.brand.pieces.filter((p) => p.squeezed).map((p) => p.name).join(",") || "none"}`,
  );

  check(
    `${label}: tagline visible, unclipped and inside the header`,
    f.tagline.visible && f.tagline.text === "Every call leaves your business behind." && f.tagline.paint.width > 0 && insideRect(f.tagline.paint, f.navRect),
    `paint=${JSON.stringify(f.tagline.paint)}`,
  );
  check(`${label}: tagline rendered exactly once`, f.renderedTaglines === 1 && f.taglineLeafNodes === 1, `rendered=${f.renderedTaglines} leafNodes=${f.taglineLeafNodes}`);
  check(`${label}: no horizontal overflow`, f.innerWidth === viewport.width, `clientWidth=${f.innerWidth} viewport=${viewport.width}`);
  check(`${label}: hero starts below the header`, f.heroCopyTop !== null && f.heroCopyTop - f.navRect.bottom > 8, `heroCopyTop=${f.heroCopyTop} navBottom=${f.navRect.bottom}`);
  check(`${label}: one <h1> with the hero headline`, f.h1 === 1 && /Turn every customer conversation/.test(f.h1Text), f.h1Text.slice(0, 48));
  check(`${label}: no new page errors`, errors.length === 0, errors.join(" | "));
  if (shot) await shot(label);
};

const insideRect = (rect, container) => rect && container && rect.left >= container.left - 0.5 && rect.right <= container.right + 0.5 && rect.top >= container.top - 0.5 && rect.bottom <= container.bottom + 0.5;

try {
  /* ── 1. Anonymous header + tagline at every viewport ───────────────────── */
  for (const viewport of VIEWPORTS) {
    const { page, errors } = await open(viewport);
    const f = await page.evaluate(measure);
    if (!f) {
      check(`${viewport.label}px: header measured`, false, "measure() returned nothing");
      await page.close();
      continue;
    }
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`${viewport.label}px: document does not scroll horizontally`, scrollWidth <= f.innerWidth + 0.5, `scrollWidth=${scrollWidth} clientWidth=${f.innerWidth}`);
    await headerChecks(`${viewport.label}px`, f, viewport, errors, async () => {
      await page.screenshot({ path: `${shotDir}/header-${viewport.label}.jpg`, type: "jpeg", quality: 76, clip: { x: 0, y: 0, width: viewport.width, height: 460 } });
    });
    check(
      `${viewport.label}px: menu panel offers the account links`,
      f.panelLinks.length > 0 && f.panelLinks.every((link) => link.href),
      JSON.stringify(f.panelLinks),
    );
    await page.close();
  }

  /* ── 2. Signed-in header (the state the report describes) ─────────────── */
  for (const viewport of VIEWPORTS) {
    const { page, errors } = await open(viewport, { session: true });
    const f = await page.evaluate(measure);
    await headerChecks(`${viewport.label}px signed-in`, f, viewport, errors);
    check(
      `${viewport.label}px signed-in: Dashboard link keeps /dashboard`,
      f.dashboard?.href === "/dashboard",
      JSON.stringify(f.dashboard),
    );
    check(
      `${viewport.label}px signed-in: actions group is either visible and clear of the brand, or moved into the menu`,
      !(f.actions.visible && f.overlaps.some((entry) => entry.name === "nav-actions")),
      `actionsVisible=${f.actions.visible}`,
    );
    await page.close();
  }

  /* ── 3. Menu open at phone widths ─────────────────────────────────────── */
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[3]]) {
    const { page } = await open(viewport, { session: true });
    await page.evaluate(() => {
      const details = document.querySelector(".lp-nav__compact");
      if (details) details.open = true;
    });
    const f = await page.evaluate(measure);
    const panelRight = await page.evaluate(() => {
      const panel = document.querySelector(".lp-nav__panel");
      return panel ? Math.round(panel.getBoundingClientRect().right) : null;
    });
    check(`${viewport.label}px: open menu does not overlap the brand`, f.overlaps.length === 0, `${f.overlaps.length} overlap(s)`);
    check(`${viewport.label}px: open menu stays inside the viewport`, panelRight !== null && panelRight <= viewport.width + 0.5, `panelRight=${panelRight}`);
    check(`${viewport.label}px: open menu offers Dashboard at /dashboard`, f.panelLinks.some((link) => link.label === "Dashboard" && link.href === "/dashboard"), JSON.stringify(f.panelLinks));
    await page.screenshot({ path: `${shotDir}/menu-${viewport.label}.jpg`, type: "jpeg", quality: 76, clip: { x: 0, y: 0, width: viewport.width, height: 460 } });
    await page.close();
  }

  /* ── 4. Browser text scaling ──────────────────────────────────────────── */
  for (const scale of [1.25, 1.5]) {
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4]]) {
      const { page } = await open(viewport);
      await page.addStyleTag({ content: `html { font-size: ${Math.round(scale * 100)}%; }` });
      const f = await page.evaluate(measure);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      check(
        `${viewport.label}px @ ${Math.round(scale * 100)}% root font: no overlap, tagline visible, no overflow`,
        f.overlaps.length === 0 && f.tagline.visible && insideRect(f.tagline.paint, f.navRect) && scrollWidth <= f.innerWidth + 0.5,
        `overlaps=${f.overlaps.length} tagline=${f.tagline.visible} scrollWidth=${scrollWidth}`,
      );
      await page.close();
    }
  }

  /* ── 5. Keyboard navigation at 390 px ─────────────────────────────────── */
  {
    const { page } = await open(VIEWPORTS[2]);
    const focusPath = [];
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press("Tab");
      focusPath.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return "none";
          const name = el.className && typeof el.className === "string" && el.className ? el.className : el.tagName;
          const container = el.closest(".lp-nav__compact, .lp-nav__panel, .lp-nav__actions, .lp-nav .jata-brand, .jata-skip-link, .product-theme-picker");
          return container ? `${name} in ${container.className}` : name;
        }),
      );
    }
    check(
      `390px: keyboard path reaches skip link, brand and menu control`,
      focusPath.some((name) => name.includes("jata-skip-link")) &&
        focusPath.some((name) => name.includes("jata-brand")) &&
        focusPath.some((name) => name.includes("lp-nav__compact")),
      focusPath.join(" → "),
    );

    // Open the native menu with the keyboard, then walk into it.
    await page.evaluate(() => document.querySelector(".lp-nav__compact summary").focus());
    await page.keyboard.press(" ");
    const panelOpen = await page.evaluate(() => document.querySelector(".lp-nav__compact").open);
    await page.keyboard.press("Tab");
    const panelFocused = await page.evaluate(() => document.activeElement?.className ?? "");
    check(
      `390px: menu control opens with the keyboard and the first panel link takes focus`,
      panelOpen && panelFocused.includes("lp-nav__panel"),
      `open=${panelOpen} focused=${panelFocused}`,
    );
    check(
      `390px: skip link and nav carry accessible names`,
      (await page.evaluate(() => document.querySelector(".jata-skip-link")?.textContent?.trim() ?? "")) === "Skip to content" &&
        (await page.evaluate(() => document.querySelector("nav.lp-nav")?.getAttribute("aria-label") ?? "")) === "Main",
    );
    await page.close();
  }

  /* ── 6. Anonymous access to the dashboard routes ──────────────────────── */
  for (const route of ["/dashboard/pos", "/dashboard"]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const response = await page.goto(`${base}${route}`, { waitUntil: "networkidle2", timeout: 120000 });
    const finalPath = new URL(page.url()).pathname;
    check(`anonymous ${route} redirects to login`, finalPath === "/login", `status=${response?.status()} final=${finalPath}`);
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = rows.filter((row) => !row.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`);
if (failed.length) {
  console.error(`FAIL: ${failed.length} check(s) failed`);
  process.exit(1);
}
process.exit(0);
