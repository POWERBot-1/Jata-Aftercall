#!/usr/bin/env node
/**
 * Premium transformation visual evidence capture (2026-10-27 redesign, PR #69).
 *
 *   CHROME_PATH=/path/to/chrome BASE_URL=http://127.0.0.1:4100 \
 *   SHOT_DIR=./premium-shots npm run test:browser:premium-screenshots
 *
 * Why this exists: the six-viewport visual verification could not run in the authoring sandbox
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
  const overflowChain = [];
  let node = firstOffender;
  let hops = 0;
  while (node && hops < 12) {
    const cs = getComputedStyle(node);
    overflowChain.push({
      tag: node.tagName.toLowerCase(),
      cls: classOf(node),
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      overflowX: cs.overflowX,
      display: cs.display,
      position: cs.position,
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
  return {
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    horizontalOverflow: doc.scrollWidth > window.innerWidth,
    overflowOffenders: offenders,
    overflowChain,
    title: document.title,
    pathname: location.pathname,
    hasErrorOverlay: Boolean(document.querySelector("nextjs-portal")),
    tokens: {
      jataLime: token("--jata-lime"),
      jataGraphite: token("--jata-graphite"),
      lpAmber: lpToken("--lp-amber"),
      wsAmber: token("--ws-amber"),
    },
    css: {
      primaryCtaBg: css(".lp-btn--primary", "backgroundColor"),
      primaryCtaColor: css(".lp-btn--primary", "color"),
      heroBg: css(".lp-hero", "backgroundColor"),
      bodyBg: css("body", "backgroundColor"),
    },
    planCards,
    h1: document.querySelector("h1")?.textContent?.trim().slice(0, 120) ?? "",
  };
}

const evidence = {
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
      ? `scrollWidth=${r.scrollWidth} innerWidth=${r.innerWidth} offenders=${JSON.stringify(r.overflowOffenders)} chain=${JSON.stringify(r.overflowChain)}`
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
  record(home.tokens.jataLime === "#b6ff2e", `electric-lime token applies at ${width}`, home.tokens.jataLime);
  record(home.tokens.jataGraphite === "#16181d", `graphite token applies at ${width}`, home.tokens.jataGraphite);
  record(home.tokens.lpAmber === "#b6ff2e", `landing accent token (scoped to .lp-page) maps to electric lime at ${width}`, String(home.tokens.lpAmber));
  record(home.css.primaryCtaBg === "rgb(182, 255, 46)",
    `primary CTA renders electric lime at ${width}`, home.css.primaryCtaBg ?? "no .lp-btn--primary");
  record(home.css.primaryCtaColor === "rgb(27, 30, 36)",
    `primary CTA label is graphite on lime at ${width}`, home.css.primaryCtaColor ?? "");
  record(home.css.heroBg === "rgb(22, 24, 29)",
    `hero band renders graphite at ${width}`, home.css.heroBg ?? "");
}

writeFileSync(`${shotDir}/evidence.json`, JSON.stringify(evidence, null, 2));
writeFileSync(`${shotDir}/summary.log`, `${log.join("\n")}\n\n${failures.length ? `${failures.length} FAILURE(S)` : "ALL OBJECTIVE GATES PASSED"}\n`);
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : "ALL OBJECTIVE GATES PASSED"} — evidence in ${shotDir}`);
process.exit(failures.length ? 1 : 0);
