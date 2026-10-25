#!/usr/bin/env node
/**
 * Rendered-browser visual verification for the workspace UI transformation.
 *
 * This is evidence tooling, not an application feature. It boots the *production* build against
 * the disposable `jata_e2e` database the CI gate already uses, signs three synthetic owners in
 * through the real `/login` form, provisions them with real API calls (registration → plan
 * checkout → test settlement → catalogue/experience writes), and then photographs every route the
 * mission names at 390 px and 1440 px.
 *
 * Nothing here is faked for the camera: the pages are the app's own server-rendered documents with
 * the app's own data layer. Numbers on screen are the synthetic fixtures created in this run, which
 * is exactly what an owner of a brand-new business sees. No provider is called, no payment is
 * confirmed (`/api/paystack/verify?...&mock=success` is the application's own test-settlement
 * branch, active only off-production with no secret), and no customer data is read.
 *
 * Usage (isolated database only — the guard below refuses anything else):
 *   STUDIO_BROWSER_TEST_WRITE=1 \
 *   DATABASE_URL=postgresql://jata:jata@localhost:5432/jata_e2e?schema=public \
 *   PRISMA_TEST_DATABASE_URL=$DATABASE_URL AUTH_SECRET=interactive-business-e2e-test-secret \
 *   CHROME_PATH=/tmp/chromium node scripts/verification/workspace-screenshots.mjs [--only=prefix]
 *
 * Output: `.cache/verification/workspace-screenshots/*.jpg` plus `report.json` and `report.md`.
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertIsolatedStudioTarget } from "../browser/studio-journey-safety.mjs";

const require = createRequire(import.meta.url);
const OUT_DIR = ".cache/verification/workspace-screenshots";
const KEEP = process.argv.includes("--keep");
const ONLY = (process.argv.find((argument) => argument.startsWith("--only=")) || "").slice("--only=".length);
const MOBILE = 390;
const DESKTOP = 1440;
const PASSWORD = "IsolatedUi#2026";
const runId = randomUUID().slice(0, 6);

let target;
try {
  target = assertIsolatedStudioTarget(process.env, readdirSync(process.cwd()));
  if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) throw new Error("Chrome executable unavailable");
  if (!existsSync(".next/BUILD_ID")) throw new Error("Production build unavailable — run npm run build first");
} catch (error) {
  console.error(`BLOCKED / NOT RUN: ${error.message}`);
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const results = [];
const seedLog = [];
const created = [];
let origin = "";
let server = null;
let browser = null;

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  const plans = await prisma.planConfig.findMany({ select: { id: true, key: true, priceKES: true, durationDays: true } });
  const planByKey = Object.fromEntries(plans.map((plan) => [plan.key, plan]));
  for (const key of ["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS", "BUSINESS_POS"]) {
    if (!planByKey[key]) throw new Error(`Seeded plan ${key} missing — run npm run seed`);
  }

  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "0.0.0.0", resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  origin = `http://localhost:${port}`;

  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "0.0.0.0", "-p", String(port)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PUBLIC_BASE_URL: origin,
      NEXTAUTH_URL: origin,
      VERCEL_ENV: "development",
      VERCEL_URL: "",
      VERCEL_PROJECT_PRODUCTION_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Production server startup timeout")), 120000);
    const onLog = (data) => { serverLog = (serverLog + String(data)).slice(-4000); if (/Ready in/.test(serverLog)) { clearTimeout(timeout); resolve(); } };
    server.stdout.on("data", onLog);
    server.stderr.on("data", onLog);
    server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    server.once("exit", () => { clearTimeout(timeout); reject(new Error(`Production server exited: ${serverLog.slice(-600)}`)); });
  });

  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb"],
  });
  seedLog.push(`browser ${await browser.version()} against ${origin}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const visitors = await browser.createBrowserContext();
  const visitorPage = await pageFor(visitors);
  // A fetch from about:blank has no origin, so the visitor page must already be on the app.
  await visitorPage.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });

  // ── synthetic owners ────────────────────────────────────────────────────────────────────────
  const studioOwner = await provision(visitorPage, {
    label: "studio", name: "QA Studio Owner", businessName: `QA Atelier ${runId}`, category: "salon",
    planKey: "INTERACTIVE_BUSINESS",
    profile: { phone: "0712 000 111", whatsapp: "0712 000 111", location: "Kilimani, Nairobi",
      description: "Synthetic acceptance fixture for visual verification — not a real business." },
    services: [
      { title: "Knotless braids", priceFrom: 2500, pricingType: "FIXED", durationMinutes: 120, bookingEnabled: true },
      { title: "Gel manicure", priceFrom: 1200, pricingType: "FIXED", durationMinutes: 60, bookingEnabled: true },
      { title: "Bridal glam", priceFrom: 6000, pricingType: "QUOTE", bookingEnabled: false },
    ],
    experience: { themeKey: "warm", photographyStyle: "editorial", designDirectionKey: "warm-hospitality" },
  });
  const posOwner = await provision(visitorPage, {
    label: "pos", name: "QA Shop Owner", businessName: `QA Duka ${runId}`, category: "retail",
    planKey: "BUSINESS_POS",
    profile: { phone: "0712 000 222", whatsapp: "0712 000 222", location: "Ngara, Nairobi",
      description: "Synthetic acceptance fixture for visual verification — not a real business." },
    products: [
      { name: "Cotton tote bag", priceKES: 650, category: "Bags", quantity: 24, sku: "QA-TOTE" },
      { name: "Recycled notebook", priceKES: 320, category: "Stationery", quantity: 60, sku: "QA-NOTE" },
      { name: "Brass keyring", priceKES: 180, category: "Gifts", quantity: 12, sku: "QA-KEY" },
      { name: "Linen apron", priceKES: 1450, category: "Home", quantity: 6, sku: "QA-APRON" },
      { name: "Beeswax candle", priceKES: 900, category: "Home", quantity: 0, sku: "QA-CANDLE" },
    ],
    posSale: true,
  });
  const aiOwner = await provision(visitorPage, {
    label: "ai", name: "QA Frontdesk Owner", businessName: `QA Clinic ${runId}`, category: "professional",
    planKey: "AI_BUSINESS_FRONT_DESK",
    profile: { phone: "0712 000 333", whatsapp: "0712 000 333", location: "Westlands, Nairobi",
      description: "Synthetic acceptance fixture for visual verification — not a real business." },
    services: [{ title: "Initial consultation", priceFrom: 2000, pricingType: "FIXED", durationMinutes: 45, bookingEnabled: true }],
  });

  // ── logged-out surfaces ───────────────────────────────────────────────────────────────────
  await capture(visitorPage, "home", "/", { anonymous: true });
  await capture(visitorPage, "login", "/login", { anonymous: true });
  await capture(visitorPage, "register", "/register", { anonymous: true });
  await capture(visitorPage, "forgot-password", "/forgot-password", { anonymous: true });
  await capture(visitorPage, "onboarding-redirect", "/onboarding", { anonymous: true, expectRedirect: true });
  await capture(visitorPage, "storefront", `/b/${studioOwner.slug}`, { anonymous: true });
  await capture(visitorPage, "storefront-shop", `/b/${studioOwner.slug}/shop`, { anonymous: true });
  await capture(visitorPage, "storefront-book", `/b/${studioOwner.slug}/book`, { anonymous: true });
  await capture(visitorPage, "admin-refused", "/admin", { anonymous: true, expectRedirect: true });

  // ── studio + account surfaces ────────────────────────────────────────────────────────────
  const studioPage = await pageFor(await browser.createBrowserContext());
  await signIn(studioPage, studioOwner.email);
  await capture(studioPage, "onboarding-signed-in", "/onboarding", { expectRedirect: true });
  await capture(studioPage, "dashboard", "/dashboard");
  await capture(studioPage, "dashboard-subscription", "/dashboard/subscription");
  await capture(studioPage, "dashboard-studio", "/dashboard/studio");
  await capture(studioPage, "dashboard-ai-unentitled", "/dashboard/ai");
  await capture(studioPage, "dashboard-pos-unentitled", "/dashboard/pos");
  for (const [name, suffix] of [["business", ""], ["business-insights", "/insights"], ["business-items", "/items"],
    ["business-orders", "/orders"], ["business-bookings", "/bookings"], ["business-canvas", "/canvas"],
    ["business-design", "/design"], ["business-photos", "/photos"], ["business-preview", "/preview"],
    ["business-sections", "/sections"], ["business-theme", "/theme"]]) {
    await capture(studioPage, name, `/dashboard/businesses/${studioOwner.businessId}${suffix}`);
  }

  // ── POS surfaces ─────────────────────────────────────────────────────────────────────────
  const posPage = await pageFor(await browser.createBrowserContext());
  await signIn(posPage, posOwner.email);
  await capture(posPage, "pos-workspace", "/dashboard/pos");
  const posBase = `/dashboard/pos/${posOwner.businessId}`;
  for (const name of ["", "/sell", "/products", "/inventory", "/sales", "/orders", "/customers", "/suppliers",
    "/purchases", "/expenses", "/reports", "/payments", "/staff", "/branches", "/settings", "/configure",
    "/plan", "/preview", "/appointments", "/menu", "/jobs", "/produce", "/projects", "/credit"]) {
    await capture(posPage, `pos${name.replaceAll("/", "-") || "-home"}`, `${posBase}${name}`);
  }

  // ── AI cockpit ───────────────────────────────────────────────────────────────────────────
  const aiPage = await pageFor(await browser.createBrowserContext());
  await signIn(aiPage, aiOwner.email);
  await capture(aiPage, "dashboard-ai", "/dashboard/ai");
  await capture(aiPage, "ai-tabs", "/dashboard/ai", { tabShots: true });

  await writeReports();
  console.log(`\nCaptured ${results.length} screenshots into ${OUT_DIR}`);

  if (KEEP) console.log("Fixtures kept (--keep): cleanup skipped.");
  else await cleanup();
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────

async function pageFor(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(60000);
  return page;
}

/** Real HTTP provisioning: register → price/checkout → server-side test settlement → catalogue. */
async function provision(visitorPage, spec) {
  const email = `ui-verify-${spec.label}-${runId}@test.invalid`;
  const registered = await visitorPage.evaluate(async (body) => {
    const response = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { name: spec.name, email, phone: spec.profile.phone.replace(/\s/g, ""), password: PASSWORD, businessName: spec.businessName });
  seedLog.push(`${spec.label}: register ${registered.status}`);
  const business = await prisma.business.findFirst({ where: { owner: { email } }, select: { id: true, slug: true, ownerId: true } });
  if (!business) throw new Error(`Registration did not create a business for ${spec.label}: ${JSON.stringify(registered).slice(0, 300)}`);
  created.push({ id: business.id, ownerId: business.ownerId, email });

  const page = await pageFor(await browser.createBrowserContext());
  await signIn(page, email);
  const api = (path, method = "GET", body) => page.evaluate(async (path, method, body) => {
    const response = await fetch(path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, path, method, body);

  if (spec.profile) {
    const profile = await api("/api/business", "PATCH", { businessId: business.id, ...spec.profile });
    seedLog.push(`${spec.label}: profile ${profile.status}`);
  }
  for (const service of spec.services || []) {
    const created2 = await api("/api/services", "POST", { businessId: business.id, isActive: true, ...service });
    seedLog.push(`${spec.label}: service "${service.title}" ${created2.status}`);
  }
  for (const product of spec.products || []) {
    // The POS catalogue and the storefront catalogue are different products on purpose; seed the
    // one the screens being photographed actually read.
    const path = spec.planKey === "BUSINESS_POS" ? `/api/pos/${business.id}/products` : "/api/products";
    const payload = spec.planKey === "BUSINESS_POS"
      ? { name: product.name, priceKES: product.priceKES, category: product.category, sku: product.sku, kind: "PRODUCT", trackInventory: true, reorderLevel: 5 }
      : { businessId: business.id, isActive: true, ...product };
    const created2 = await api(path, "POST", payload);
    seedLog.push(`${spec.label}: product "${product.name}" ${created2.status} ${created2.status >= 400 ? JSON.stringify(created2.body).slice(0, 140) : ""}`);
    if (spec.planKey === "BUSINESS_POS" && created2.status < 300 && product.quantity > 0) {
      // Real stock receipt, through the inventory endpoint — not a fabricated quantity in the row.
      const stock = await api(`/api/pos/${business.id}/inventory`, "POST", {
        productId: created2.body?.product?.id ?? created2.body?.id, quantity: product.quantity, reason: "Opening stock (QA fixture)", kind: "RECEIVE",
      });
      seedLog.push(`${spec.label}: opening stock "${product.name}" ${stock.status} ${stock.status >= 400 ? JSON.stringify(stock.body).slice(0, 140) : ""}`);
    }
  }

  // Plan activation. First through the application's own checkout + verify path — but the
  // provider-free test settlement is deliberately closed when NODE_ENV=production, and this script
  // photographs a production build, so in practice that call is refused (which is correct). The
  // fixture fallback below is a stored entitlement written directly, exactly like
  // scripts/browser/studio-authenticated.check.mjs does, and it is labelled as such: it is NOT
  // payment-provider verification and nothing on screen claims a provider confirmed anything.
  const plan = await prisma.planConfig.findUnique({ where: { key: spec.planKey }, select: { id: true, priceKES: true, durationDays: true } });
  if (plan) {
    const checkout = await api("/api/checkout", "POST", { businessId: business.id, planId: plan.id });
    seedLog.push(`${spec.label}: checkout ${checkout.status} ${JSON.stringify(checkout.body).slice(0, 160)}`);
    let entitled = false;
    if (checkout.status === 200 && checkout.body?.reference) {
      const verify = await api(`/api/paystack/verify?reference=${encodeURIComponent(checkout.body.reference)}&mock=success`);
      seedLog.push(`${spec.label}: verify ${verify.status} ${JSON.stringify(verify.body).slice(0, 160)}`);
      entitled = verify.status === 200;
    }
    if (!entitled) {
      const payment = await prisma.payment.create({
        data: {
          businessId: business.id, userId: business.ownerId, planId: plan.id,
          reference: `QA-UI-ENT-${spec.label}-${runId}`, amount: plan.priceKES * 100, currency: "KES", status: "PAID",
          purpose: "SUBSCRIPTION", raw: JSON.stringify({ isolatedFixture: true, providerVerified: false }),
        },
      });
      const now = Date.now();
      if (spec.planKey === "BUSINESS_POS") {
        await prisma.posSubscription.upsert({
          where: { businessId: business.id },
          update: { status: "ACTIVE", startAt: new Date(), expiresAt: new Date(now + 86400000 * (plan.durationDays || 30)),
            graceUntil: new Date(now + 86400000 * ((plan.durationDays || 30) + 3)), paymentId: payment.id, planId: plan.id, planKey: "BUSINESS_POS" },
          create: { businessId: business.id, userId: business.ownerId, planId: plan.id, planKey: "BUSINESS_POS", status: "ACTIVE",
            startAt: new Date(), expiresAt: new Date(now + 86400000 * (plan.durationDays || 30)),
            graceUntil: new Date(now + 86400000 * ((plan.durationDays || 30) + 3)), paymentId: payment.id,
            paymentReference: payment.reference },
        });
      } else {
        await prisma.subscription.upsert({
          where: { businessId: business.id },
          update: { status: "ACTIVE", planId: plan.id, startAt: new Date(), expiresAt: new Date(now + 86400000 * (plan.durationDays || 30)),
            graceUntil: new Date(now + 86400000 * ((plan.durationDays || 30) + 3)) },
          create: { businessId: business.id, userId: business.ownerId, planId: plan.id, status: "ACTIVE", startAt: new Date(),
            expiresAt: new Date(now + 86400000 * (plan.durationDays || 30)), graceUntil: new Date(now + 86400000 * ((plan.durationDays || 30) + 3)) },
        });
      }
      await prisma.business.update({ where: { id: business.id }, data: { status: "ACTIVE" } });
      seedLog.push(`${spec.label}: stored synthetic entitlement written (${spec.planKey}); provider verification NOT claimed`);
    }
  }

  if (spec.experience) {
    const current = await prisma.businessExperience.findUnique({ where: { businessId: business.id }, select: { draftVersion: true } });
    if (current) {
      const patched = await api("/api/experience", "PATCH", { businessId: business.id, expectedDraftVersion: current.draftVersion, ...spec.experience });
      seedLog.push(`${spec.label}: experience patch ${patched.status} ${JSON.stringify(patched.body).slice(0, 160)}`);
      const published = await api("/api/experience/publish", "POST", { businessId: business.id });
      seedLog.push(`${spec.label}: publish ${published.status} ${JSON.stringify(published.body).slice(0, 160)}`);
    }
  }

  if (spec.posSale) {
    const catalogue = await prisma.posProduct.findMany({ where: { businessId: business.id }, select: { id: true, name: true, priceKES: true }, take: 3 });
    if (catalogue.length) {
      const basket = catalogue.map((product) => ({ productId: product.id, name: product.name, quantity: 1, unitPriceKES: product.priceKES }));
      const total = basket.reduce((sum, item) => sum + item.unitPriceKES, 0);
      const sale = await api(`/api/pos/${business.id}/sales`, "POST", { items: basket, payments: [{ method: "cash", amountKES: total }], channel: "counter" });
      seedLog.push(`${spec.label}: pos sale ${sale.status} ${JSON.stringify(sale.body).slice(0, 160)}`);
      const customer = await api(`/api/pos/${business.id}/customers`, "POST", { name: "QA Walk-in Customer", phone: "0700000001" });
      seedLog.push(`${spec.label}: pos customer ${customer.status}`);
    }
  }

  const cookie = (await page.cookies()).find((entry) => entry.name === "jata_session");
  seedLog.push(`${spec.label}: session cookie ${cookie ? "issued" : "MISSING"}`);
  await page.close();
  return { email, slug: business.slug, businessId: business.id };
}

async function signIn(page, email) {
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-email");
  await page.type("#login-email", email);
  await page.type("#login-password", PASSWORD);
  await Promise.all([
    page.waitForFunction(() => location.pathname !== "/login", { timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 600));
  seedLog.push(`sign-in ${email}: ${new URL(page.url()).pathname}`);
}

async function settle(page) {
  await page.evaluate(async () => {
    try { await document.fonts.ready; } catch { /* older documents */ }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 700));
}

async function measure(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflowing = [];
    for (const element of document.querySelectorAll("body *")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > window.innerWidth + 1 || box.left < -1) {
        overflowing.push(`${element.tagName.toLowerCase()}.${String(element.className || "").split(" ").filter(Boolean).slice(0, 2).join(".")}@${Math.round(box.right)}`);
        if (overflowing.length >= 6) break;
      }
    }
    const images = [...document.querySelectorAll("img")];
    return {
      title: document.title,
      h1: [...document.querySelectorAll("h1")].map((node) => node.textContent.replace(/\s+/g, " ").trim().slice(0, 80)),
      headings: [...document.querySelectorAll("h2")].slice(0, 8).map((node) => node.textContent.replace(/\s+/g, " ").trim().slice(0, 60)),
      mains: document.querySelectorAll("main").length,
      navs: document.querySelectorAll("nav").length,
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      overflowing,
      images: images.length,
      brokenImages: images.filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => (image.currentSrc || image.src).slice(0, 120)).slice(0, 6),
      imagesWithoutAlt: images.filter((image) => !image.getAttribute("alt")).length,
      buttons: document.querySelectorAll("button").length,
      formlessInputs: [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
        .filter((input) => !input.closest("form") && !input.id).length,
      textLength: (document.body?.textContent || "").replace(/\s+/g, " ").trim().length,
      bodyClass: document.body?.className || "",
      scrollHeight: root.scrollHeight,
    };
  });
}

async function capture(page, name, path, options = {}) {
  if (ONLY && !name.startsWith(ONLY)) return;
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const listeners = {
    console: (message) => { if (message.type() === "error") consoleErrors.push(message.text().replace(/\s+/g, " ").slice(0, 200)); },
    pageerror: (error) => pageErrors.push(String(error.message).replace(/\s+/g, " ").slice(0, 200)),
    requestfailed: (request) => failedRequests.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText || ""}`.slice(0, 160)),
  };
  page.on("console", listeners.console);
  page.on("pageerror", listeners.pageerror);
  page.on("requestfailed", listeners.requestfailed);

  let status = null;
  try {
    const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle2", timeout: 60000 });
    status = response ? response.status() : null;
  } catch (error) {
    pageErrors.push(`NAVIGATION ${String(error.message).slice(0, 160)}`);
  }
  await settle(page);
  if (options.tabShots) await captureTabs(page, name);
  const metrics = await measure(page).catch((error) => ({ measureError: String(error.message) }));
  const finalPath = new URL(page.url()).pathname;

  for (const [label, width] of [["390", MOBILE], ["1440", DESKTOP]]) {
    await page.setViewport({ width, height: width === MOBILE ? 900 : 1000, deviceScaleFactor: 1, isMobile: width === MOBILE, hasTouch: width === MOBILE });
    await settle(page);
    const responsive = await measure(page).catch((error) => ({ measureError: String(error.message) }));
    const file = `${OUT_DIR}/${name}-${label}.jpg`;
    await page.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 72, optimizeForSpeed: false }).catch((error) => {
      pageErrors.push(`SCREENSHOT ${String(error.message).slice(0, 120)}`);
    });
    results.push({
      name, path, width, file, status, finalPath,
      redirected: finalPath !== path.replace(/\/$/, "") && !(path === "/" && finalPath === "/"),
      ...responsive,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 6),
      pageErrors: [...new Set(pageErrors)].slice(0, 6),
      failedRequests: [...new Set(failedRequests)].slice(0, 6),
    });
  }
  // Filesystem evidence line per route so a rerun diff is readable in CI logs.
  console.log(`${name.padEnd(28)} ${String(status).padEnd(4)} ${finalPath}  overflow(390/1440)=${results.at(-2).horizontalOverflow}/${results.at(-1).horizontalOverflow} images=${metrics.images} broken=${(metrics.brokenImages || []).length}`);
  page.off("console", listeners.console);
  page.off("pageerror", listeners.pageerror);
  page.off("requestfailed", listeners.requestfailed);
}

/** The AI cockpit keeps its tab content behind client-side tabs, so each tab gets its own photo. */
async function captureTabs(page, name) {
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"], nav button, .ws-tabs button')]
    .map((node) => node.textContent.replace(/\s+/g, " ").trim()).filter((label) => label && label.length < 40));
  const unique = [...new Set(tabs)].slice(0, 8);
  for (const label of unique) {
    const clicked = await page.evaluate((label) => {
      const node = [...document.querySelectorAll('button, [role="tab"]')].find((candidate) => candidate.textContent.replace(/\s+/g, " ").trim() === label);
      if (!node) return false;
      node.click();
      return true;
    }, label);
    if (!clicked) continue;
    await settle(page);
    for (const [widthLabel, width] of [["390", MOBILE], ["1440", DESKTOP]]) {
      await page.setViewport({ width, height: width === MOBILE ? 900 : 1000, deviceScaleFactor: 1, isMobile: width === MOBILE, hasTouch: width === MOBILE });
      await settle(page);
      const file = `${OUT_DIR}/${name}-${slugify(label)}-${widthLabel}.jpg`;
      await page.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 72 }).catch(() => {});
      results.push({ name: `${name}-${slugify(label)}`, path: "/dashboard/ai", width, file, tab: label, status: 200 });
    }
  }
}

async function writeReports() {
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify({ runId, origin, seedLog, results }, null, 2));
  const failures = results.filter((row) => (row.status && row.status >= 400) || (row.horizontalOverflow ?? 0) > 0 ||
    (row.brokenImages || []).length > 0 || (row.pageErrors || []).length > 0 || (row.mainCount ?? row.mains) > 1);
  const lines = [
    "# Rendered-browser verification",
    "",
    `Run \`${runId}\` — ${results.length} screenshots at 390 px and 1440 px.`,
    "",
    "## Fixture provisioning (real HTTP against a disposable database)",
    "",
    "```",
    ...seedLog,
    "```",
    "",
    "## Route observations",
    "",
    "| route | width | status | final URL | overflow | broken imgs | imgs w/o alt | h1 | console errors |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map((row) => `| ${row.name} | ${row.width} | ${row.status ?? "—"} | ${row.finalPath ?? "—"} | ${row.horizontalOverflow ?? "—"} | ${(row.brokenImages || []).length} | ${row.imagesWithoutAlt ?? "—"} | ${(row.h1 || []).join(" / ") || "—"} | ${(row.consoleErrors || []).length} |`),
    "",
    "## Flags",
    "",
    failures.length ? "```" : "No structural flags (overflow, broken images, runtime errors, nested `<main>`).",
    ...failures.map((row) => `${row.name} @${row.width}: overflow=${row.horizontalOverflow} broken=${(row.brokenImages || []).length} errors=${JSON.stringify([...(row.pageErrors || []), ...(row.consoleErrors || [])]).slice(0, 220)}`),
    failures.length ? "```" : "",
  ];
  writeFileSync(`${OUT_DIR}/report.md`, `${lines.join("\n")}\n`);
  console.log(`\nStructural flags: ${failures.length}`);
  for (const row of failures.slice(0, 40)) console.log(`  ${row.name}@${row.width} overflow=${row.horizontalOverflow} broken=${(row.brokenImages || []).length} pageErrors=${JSON.stringify(row.pageErrors)}`);
}

async function cleanup() {
  // Exact IDs created by this run only; the database is disposable, but leftover fixtures would
  // skew the next run's screenshots.
  for (const fixture of created) {
    await prisma.posSale.deleteMany({ where: { businessId: fixture.id } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { businessId: fixture.id } }).catch(() => {});
    await prisma.subscription.deleteMany({ where: { businessId: fixture.id } }).catch(() => {});
    await prisma.posSubscription.deleteMany({ where: { businessId: fixture.id } }).catch(() => {});
    await prisma.business.deleteMany({ where: { id: fixture.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: fixture.ownerId } }).catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  console.error(`BLOCKED / NOT RUN: ${error?.stack || error}`);
  process.exitCode = 2;
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  await prisma.$disconnect().catch(() => {});
}
