#!/usr/bin/env node
/**
 * Six-viewport visual evidence capture for PR #69 (2026-10-27 owner correction: the original
 * espresso/cream/amber JATA AFTERCALL design is restored; this harness now asserts the ORIGINAL
 * palette and design tokens rather than the withdrawn graphite/lime direction).
 *
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://127.0.0.1:4100 \
 *   SHOT_DIR=./premium-shots npm run test:browser:premium-screenshots
 *
 * Why this exists: the six-viewport visual verification cannot run in the authoring sandbox
 * (no browser binary). This script runs in GitHub Actions on a real Chrome against a local
 * production build seeded with the fictional demo dataset, and uploads its screenshots as a
 * workflow artifact. It never points at production and never changes a setting: it only logs in
 * through the public sign-in form with the seeded demo user and reads pages.
 *
 * Viewports (exact, owner-mandated): 320x568, 360x800, 390x844, 430x932, 768x1024, 1366x768.
 *
 * Routes:
 *   public  — / (homepage + pricing grid), /login, /register, /forgot-password
 *   member  — /dashboard (Overview), /dashboard/ai (AI Business Front Desk),
 *             /dashboard/autopilot (JATA Auto Pilot), /dashboard/studio (Website Studio),
 *             /dashboard/pos (Business POS)
 *
 * Outputs in SHOT_DIR: one full-page JPEG per route per viewport, evidence.json (machine-readable
 * measurements) and summary.log. Exit codes: 2 = NOT RUN (no Chrome), 1 = hard evidence failure,
 * 0 = all objective gates passed. Screenshots are evidence for human/agent visual review; the
 * script itself never claims a visual PASS it cannot measure.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) {
  console.error("Browser missing: premium screenshot capture NOT RUN. Set CHROME_PATH.");
  process.exit(2);
}

const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const shotDir = process.env.SHOT_DIR;
if (!shotDir) {
  console.error("SHOT_DIR is required so evidence is never silently discarded.");
  process.exit(2);
}
mkdirSync(shotDir, { recursive: true });

const loginEmail = process.env.SCREENSHOT_LOGIN_EMAIL || "demo@jata.link";
const loginPassword = process.env.SCREENSHOT_LOGIN_PASSWORD || "Demo1234!";

const VIEWPORTS = [
  { label: "320x568", width: 320, height: 568 },
  { label: "360x800", width: 360, height: 800 },
  { label: "390x844", width: 390, height: 844 },
  { label: "430x932", width: 430, height: 932 },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "1366x768", width: 1366, height: 768 },
];

const PUBLIC_ROUTES = [
  { slug: "home", path: "/" },
  { slug: "login", path: "/login" },
  { slug: "register", path: "/register" },
  { slug: "forgot-password", path: "/forgot-password" },
  // Fictional demo business (seeded in the workflow's disposable database). Its official
  // demonstration number 0724317010 and location make it the contact-state evidence page:
  // real WhatsApp/tel/Directions destinations plus the Share fallback.
  { slug: "demo-nyumbani-kitchen", path: "/b/nyumbani-kitchen" },
];

const MEMBER_ROUTES = [
  { slug: "overview", path: "/dashboard" },
  { slug: "ai-front-desk", path: "/dashboard/ai" },
  { slug: "autopilot", path: "/dashboard/autopilot" },
  { slug: "website-studio", path: "/dashboard/studio" },
  { slug: "business-pos", path: "/dashboard/pos" },
];

// Owner-mandated 2026-10-27 homepage sequence.
const EXPECTED_PLAN_ORDER = [
  "MONTHLY",
  "ANNUAL",
  "AI_BUSINESS_FRONT_DESK",
  "JATA_AUTOPILOT",
  "INTERACTIVE_BUSINESS",
  "BUSINESS_POS",
];

const failures = [];
const log = [];
const record = (ok, name, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  log.push(line);
  console.log(line);
  if (!ok) failures.push(line);
};

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
});

// Measurements taken inside the page. Kept dependency-free and defensive so a missing element
// reports a fact instead of throwing the whole capture away. `measureFacts` is a plain named
// function because puppeteer serialises the evaluate body across the browser boundary.
async function openPage(context, route, viewport) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  // Deterministic 200s: without this, repeat visits in one context send conditional headers
  // and Chrome legitimately answers 304, which is a successful render but not the asserted code.
  await page.setCacheEnabled(false);
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  let status = 0;
  try {
    const response = await page.goto(`${base}${route.path}`, { waitUntil: "load", timeout: 45000 });
    status = response?.status() ?? 0;
  } catch (error) {
    pageErrors.push(`navigation: ${String(error).slice(0, 200)}`);
  }
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
  const facts = await page.evaluate(measureFacts);
  const shotPath = `${shotDir}/${viewport.label}__${route.slug}.jpg`;
  let shotMode = "fullPage";
  try {
    // Chrome refuses bitmaps past ~16,384px tall; fall back to a viewport shot rather than
    // losing the page entirely, and record the degradation honestly in evidence.
    await page.screenshot({ path: shotPath, type: "jpeg", quality: 74, fullPage: true });
  } catch (error) {
    shotMode = `viewport-only (fullPage failed: ${String(error).slice(0, 120)})`;
    await page.screenshot({ path: shotPath, type: "jpeg", quality: 74, fullPage: false });
  }
  await page.close();
  return { status, pageErrors, consoleErrors, shotMode, ...facts };
}

// Plain named function so puppeteer can serialise it across the browser boundary.
function measureFacts() {
  const doc = document.documentElement;
  const classOf = (el) => String(el.getAttribute?.("class") || "").split(" ").slice(0, 3).join(".");
  const offenders = [];
  let firstOffender = null;
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 1) {
      if (!firstOffender) firstOffender = el;
      offenders.push({ tag: el.tagName.toLowerCase(), cls: classOf(el), right: Math.round(r.right) });
      if (offenders.length >= 5) break;
    }
  }
  // When something overflows, record the containing-block chain of the first offender so the
  // propagating box can be identified from evidence alone (no devtools in CI).
  // The chrome chain (rail/wrap/header) clips correctly, so page-level overflow comes from main
  // content. Inspect main#main only and skip anything inside a clipping/scroll container so the
  // real widening element is named rather than a red herring from a scroll region.
  const mainWideners = [];
  const main = document.querySelector("main#main") || document.querySelector("main");
  if (main) {
    const inClippingAncestor = (el) => {
      let n = el.parentElement;
      while (n && n !== document.body) {
        if (["auto", "scroll", "clip", "hidden"].includes(getComputedStyle(n).overflowX)) return true;
        n = n.parentElement;
      }
      return false;
    };
    for (const el of Array.from(main.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 1 && !inClippingAncestor(el)) {
        mainWideners.push({
          t: el.tagName.toLowerCase(),
          c: classOf(el),
          r: Math.round(r.right),
          w: Math.round(r.width),
          pc: classOf(el.parentElement),
        });
        if (mainWideners.length >= 8) break;
      }
    }
  }
  // Compact keys keep the full chain inside a single check annotation.
  const overflowChain = [];
  let node = firstOffender;
  let hops = 0;
  while (node && hops < 12) {
    const cs = getComputedStyle(node);
    overflowChain.push({
      t: node.tagName.toLowerCase(),
      c: classOf(node),
      cw: node.clientWidth,
      sw: node.scrollWidth,
      ox: cs.overflowX,
      d: cs.display,
      p: cs.position,
    });
    node = node.parentElement;
    hops += 1;
  }
  const token = (name) => getComputedStyle(doc).getPropertyValue(name).trim();
  // The landing tokens are scoped to .lp-page, not :root; read --lp-amber where it is declared.
  const lpPage = document.querySelector(".lp-page");
  const lpToken = (name) => (lpPage ? getComputedStyle(lpPage).getPropertyValue(name).trim() : null);
  const css = (selector, prop) => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el)[prop] : null;
  };
  const planCards = Array.from(document.querySelectorAll(".lp-plan")).map((card) => ({
    key: card.getAttribute("data-plan"),
    name: card.querySelector(".lp-plan__name")?.textContent?.trim() ?? "",
    ctaHref: card.querySelector(".lp-plan__cta")?.getAttribute("href") ?? "",
  }));
  // Customer contact actions on the public business page. Only genuinely renderable
  // destinations are expected — the empty/honest-fallback behaviour is pinned by unit tests.
  const contactLinks = {
    whatsapp: Array.from(document.querySelectorAll('a[href^="https://wa.me/"]')).map((a) => a.getAttribute("href")),
    tel: Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) => a.getAttribute("href")),
    directions: Array.from(document.querySelectorAll('a[href*="google.com/maps"]')).map((a) => a.getAttribute("href")),
    hasShare: Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "Share"),
    comingSoon: Boolean(Array.from(document.querySelectorAll("p")).find((p) => (p.textContent || "").includes("coming soon"))),
  };
  return {
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    horizontalOverflow: doc.scrollWidth > window.innerWidth,
    overflowOffenders: offenders,
    mainWideners,
    overflowChain,
    title: document.title,
    pathname: location.pathname,
    hasErrorOverlay: Boolean(document.querySelector("nextjs-portal")),
    tokens: {
      // Original JATA AFTERCALL design (restored 2026-10-27): espresso/cream/amber.
      jataAccent: token("--jata-accent"),
      lpInk: lpToken("--lp-ink"),
      lpCream: lpToken("--lp-cream"),
      lpAmber: lpToken("--lp-amber"),
      lpAmberDeep: lpToken("--lp-amber-deep"),
      lpDisplay: lpToken("--lp-display"),
    },
    css: {
      primaryCtaBg: css(".lp-btn--primary", "backgroundColor"),
      primaryCtaColor: css(".lp-btn--primary", "color"),
      heroBg: css(".lp-hero", "backgroundColor"),
      bodyBg: css("body", "backgroundColor"),
    },
    planCards,
    contactLinks,
    h1: document.querySelector("h1")?.textContent?.trim().slice(0, 120) ?? "",
  };
}

const evidence = {
  // Self-identifying labels: every artifact and evidence.json says which design epoch and exact
  // commit it belongs to. The withdrawn graphite/lime run (2026-10-27 morning) is the BEFORE set;
  // anything carrying this marker is the AFTER set for the restored original design.
  designEpoch: "after-original-design-restoration-2026-10-27",
  beforeAfter: "AFTER",
  gitSha: process.env.GITHUB_SHA || null,
  base,
  capturedAt: new Date().toISOString(),
  viewports: VIEWPORTS.map((v) => v.label),
  routes: [...PUBLIC_ROUTES, ...MEMBER_ROUTES].map((r) => ({ ...r, access: r.path.startsWith("/dashboard") ? "member" : "public" })),
  results: [],
  login: {},
  navJourney: {},
};

// ---- Public context (no session): homepage, pricing and the auth surfaces ---------------------
const publicContext = await browser.createBrowserContext();
for (const viewport of VIEWPORTS) {
  for (const route of PUBLIC_ROUTES) {
    const result = await openPage(publicContext, route, viewport);
    evidence.results.push({ viewport: viewport.label, route: route.slug, access: "public", ...result });
  }
}
await publicContext.close();

// ---- Member context: real sign-in through the public form --------------------------------------
const memberContext = await browser.createBrowserContext();
  const loginPage = await memberContext.newPage();
  const loginErrors = [];
  loginPage.on("pageerror", (error) => loginErrors.push(String(error).slice(0, 300)));
  let loginOk = false;
  try {
    await loginPage.setCacheEnabled(false);
    await loginPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await loginPage.goto(`${base}/login`, { waitUntil: "load", timeout: 45000 });
    await loginPage.waitForSelector("#login-email", { timeout: 15000 });
    await loginPage.type("#login-email", loginEmail);
    await loginPage.type("#login-password", loginPassword);
    // puppeteer-core v25 removed page.waitForURL; waitForFunction on the location is its
    // documented replacement and works across every Chrome transport.
    await Promise.all([
      loginPage.waitForFunction(() => location.pathname.startsWith("/dashboard"), { timeout: 20000 }),
      loginPage.click('button[type="submit"]'),
    ]);
  loginOk = loginPage.url().includes("/dashboard");
  try {
    await loginPage.screenshot({ path: `${shotDir}/390x844__post-login.jpg`, type: "jpeg", quality: 74, fullPage: true });
  } catch {
    await loginPage.screenshot({ path: `${shotDir}/390x844__post-login.jpg`, type: "jpeg", quality: 74, fullPage: false });
  }
} catch (error) {
  loginErrors.push(String(error).slice(0, 300));
}
evidence.login = {
  ok: loginOk,
  email: loginEmail,
  finalUrl: loginPage.url(),
  pageErrors: loginErrors,
};
record(loginOk, "demo sign-in through the public login form reaches /dashboard", loginOk ? "" : loginErrors.join(" | ") || loginPage.url());
await loginPage.close();

if (loginOk) {
  for (const viewport of VIEWPORTS) {
    for (const route of MEMBER_ROUTES) {
      const result = await openPage(memberContext, route, viewport);
      evidence.results.push({ viewport: viewport.label, route: route.slug, access: "member", ...result });
    }
  }

  // Mobile nav journey at 390px: every workspace link must navigate and render content.
  const navPage = await memberContext.newPage();
  const navErrors = [];
  navPage.on("pageerror", (error) => navErrors.push(String(error).slice(0, 200)));
  await navPage.setCacheEnabled(false);
  await navPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const navSteps = [];
  try {
    await navPage.goto(`${base}/dashboard`, { waitUntil: "load", timeout: 45000 });
    await navPage.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    const hrefs = await navPage.$$eval('nav a[href^="/dashboard"]', (anchors) =>
      anchors.map((a) => a.getAttribute("href")),
    );
    const wanted = ["/dashboard", "/dashboard/ai", "/dashboard/autopilot", "/dashboard/studio", "/dashboard/pos"];
    for (const href of wanted) {
      if (!hrefs.includes(href)) {
        navSteps.push({ href, ok: false, detail: "nav link absent" });
        continue;
      }
      await navPage.click(`nav a[href="${href}"]`);
      await navPage.waitForSelector("h1, main", { timeout: 15000 });
      await navPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 350)));
      const at = new URL(navPage.url());
      const ok = at.pathname === href && !at.pathname.startsWith("/login");
      navSteps.push({ href, ok, detail: at.pathname });
    }
    await navPage.screenshot({ path: `${shotDir}/390x844__nav-journey.jpg`, type: "jpeg", quality: 74, fullPage: false });
  } catch (error) {
    navErrors.push(String(error).slice(0, 250));
  }
  evidence.navJourney = { steps: navSteps, pageErrors: navErrors };
  record(
    navSteps.length > 0 && navSteps.every((s) => s.ok) && navErrors.length === 0,
    "mobile dashboard nav (390px) reaches every workspace section",
    navErrors.join(" | ") || navSteps.filter((s) => !s.ok).map((s) => `${s.href}:${s.detail}`).join(" | "),
  );
  await navPage.close();
}
await memberContext.close();
await browser.close();

// ---- Objective gates over every captured page --------------------------------------------------
for (const r of evidence.results) {
  const label = `${r.viewport} ${r.route}`;
  // 304 is a successful conditional-render answer; cache is disabled in the harness so 200 is
  // expected, but a 304 must never be classified as a page failure.
  record(r.status === 200 || r.status === 304, `${label} serves successfully (200/304)`, `status=${r.status}`);
  record(!r.pathname.startsWith("/login") || r.access === "public" || r.route === "login",
    `${label} did not bounce to sign-in`, r.pathname);
  record(!r.horizontalOverflow, `${label} has no horizontal overflow`,
    r.horizontalOverflow
      ? `docSW=${r.scrollWidth} win=${r.innerWidth} mainWideners=${JSON.stringify(r.mainWideners)}`
      : "");
  record(r.pageErrors.length === 0, `${label} has no uncaught page errors`, r.pageErrors.join(" | "));
  record(!r.hasErrorOverlay, `${label} has no Next.js error overlay`);
}

// Homepage design gates: palette really applies in a real browser, and the six cards keep the
// owner-mandated order at a phone width and at desktop width.
for (const width of ["390x844", "1366x768"]) {
  const home = evidence.results.find((r) => r.viewport === width && r.route === "home");
  if (!home) {
    record(false, `homepage evidence at ${width} exists`);
    continue;
  }
  const keys = home.planCards.map((c) => c.key);
  record(keys.length === 6 && keys.every((k, i) => k === EXPECTED_PLAN_ORDER[i]),
    `homepage plan order at ${width}: Monthly, Annual, AI Front Desk, Autopilot, Website Studio, POS`,
    keys.join(" > "));
  // Original design tokens, scoped where the original stylesheet declares them.
  record(home.tokens.jataAccent === "#d97706", `root accent is the original amber at ${width}`, String(home.tokens.jataAccent));
  record(home.tokens.lpInk === "#14110f", `landing espresso ink token applies at ${width}`, String(home.tokens.lpInk));
  record(home.tokens.lpCream === "#f7f2e8", `landing cream token applies at ${width}`, String(home.tokens.lpCream));
  record(home.tokens.lpAmber === "#f0a03c", `landing amber token (scoped to .lp-page) applies at ${width}`, String(home.tokens.lpAmber));
  record(home.tokens.lpAmberDeep === "#b45309", `landing deep-amber token applies at ${width}`, String(home.tokens.lpAmberDeep));
  record(typeof home.tokens.lpDisplay === "string" && home.tokens.lpDisplay.includes("serif"),
    `editorial serif display face is in use at ${width}`, String(home.tokens.lpDisplay));
  record(home.css.primaryCtaBg === "rgb(240, 160, 60)",
    `primary CTA renders original amber at ${width}`, home.css.primaryCtaBg ?? "no .lp-btn--primary");
  record(home.css.primaryCtaColor === "rgb(26, 20, 13)",
    `primary CTA label is the original dark espresso on amber at ${width}`, home.css.primaryCtaColor ?? "");
  record(home.css.heroBg === "rgb(20, 17, 15)",
    `hero band renders original espresso at ${width}`, home.css.heroBg ?? "");
}

// Public demo business page — Phase 3C contact actions on a real Chrome render. The seeded demo
// number 0724317010 must produce working wa.me/tel destinations, Directions must point at Google
// Maps, and the Share control (native sheet -> clipboard -> visible link fallback) must exist.
const DEMO_WA = "https://wa.me/254724317010";
for (const width of ["390x844", "1366x768"]) {
  const demo = evidence.results.find((r) => r.viewport === width && r.route === "demo-nyumbani-kitchen");
  if (!demo) {
    record(false, `demo business contact evidence at ${width} exists`);
    continue;
  }
  const c = demo.contactLinks;
  record(c.whatsapp.some((href) => href.startsWith(DEMO_WA)),
    `demo page WhatsApp action opens wa.me/254724317010 at ${width}`, c.whatsapp.join(" | "));
  record(c.tel.some((href) => href.includes("254724317010")),
    `demo page Call action dials the normalised demo number at ${width}`, c.tel.join(" | "));
  record(c.directions.length === 1 && c.directions[0].includes("google.com/maps/dir/"),
    `demo page offers one Google Maps Directions link at ${width}`, c.directions.join(" | "));
  record(c.hasShare && !c.comingSoon,
    `demo page shows Share and no "coming soon" placeholder at ${width}`,
    `share=${c.hasShare} comingSoon=${c.comingSoon}`);
}

writeFileSync(`${shotDir}/evidence.json`, JSON.stringify(evidence, null, 2));
writeFileSync(`${shotDir}/summary.log`, `${log.join("\n")}\n\n${failures.length ? `${failures.length} FAILURE(S)` : "ALL OBJECTIVE GATES PASSED"}\n`);
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : "ALL OBJECTIVE GATES PASSED"} — evidence in ${shotDir}`);
process.exit(failures.length ? 1 : 0);
