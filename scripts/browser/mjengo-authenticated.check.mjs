#!/usr/bin/env node
/**
 * MJENGO OS authenticated journey in real Chrome on the disposable CI database (R-MJ-10).
 *
 *   public /products/mjengo-os → hero "Get MJENGO OS" → /login?next=mjengo → sign in →
 *   /dashboard/mjengo → own business workspace, UNPAID (402 shell, stored-plan checkout link, APIs 402)
 *   → /checkout review page renders KES 2,000 (the pay button is never pressed) →
 *   ACTIVE MjengoSubscription/MjengoEntitlement rows → workspace renders, APIs 200 →
 *   another tenant's workspace and APIs are refused → six-viewport overflow checks at each stage.
 *
 * NO PAYMENT IS MADE. The paid state is written directly as database rows in the disposable database,
 * stated plainly here and in the output. The payment → settlement → entitlement path itself is proven
 * by tests/prisma/mjengo-journey-postgres.test.ts (signed webhook, real settlement code). This script
 * proves what that suite cannot: real sign-in, the cookie session, server-rendered pages and layout.
 *
 * Refuses to run unless JATA_DISPOSABLE_BROWSER_DB=1 and both the database and the app are on localhost.
 */
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { assertDisposableMjengoBrowserEnv } from "./mjengo-authenticated.guard.mjs";

const { base } = assertDisposableMjengoBrowserEnv(process.env);
const password = process.env.DEMO_FIXTURE_PASSWORD;
if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) throw new Error("Chrome unavailable");

const prisma = new PrismaClient();
const tag = randomUUID().slice(0, 8);
const sizes = [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]];
const created = { users: [], businesses: [], payments: [] };
let browser;

async function fixtureOwner(label) {
  const user = await prisma.user.create({
    data: { email: `mjengo-${label}-${tag}@test.invalid`, name: `MJENGO ${label} ${tag}`, passwordHash: await bcrypt.hash(password, 10), role: "CUSTOMER" },
  });
  created.users.push(user.id);
  const business = await prisma.business.create({
    data: {
      ownerId: user.id, slug: `mjengo-${label}-${tag}`, name: `Mjengo ${label} Builders ${tag}`, category: "services", theme: "default",
      phone: "0722000000", whatsapp: "0722000000", isPublished: false, status: "ACTIVE",
    },
  });
  created.businesses.push(business.id);
  return { user, business };
}

try {
  const plan = await prisma.planConfig.findUnique({ where: { key: "MJENGO_OS" } });
  if (!plan || plan.priceKES !== 2000 || plan.durationDays !== 30 || !plan.isActive) throw new Error(`Seeded MJENGO_OS plan missing or not KES 2,000 / 30 days: ${JSON.stringify(plan)}`);
  const owner = await fixtureOwner("owner");
  const other = await fixtureOwner("other");

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 390, height: 844 });
  const text = () => page.evaluate(() => document.body.innerText);
  async function responsive(stage) {
    for (const [width, height] of sizes) {
      await page.setViewport({ width, height });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1
        ? { actual: document.documentElement.scrollWidth, elements: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`) }
        : null);
      if (overflow) throw new Error(`MJENGO ${stage} overflow at ${width}x${height}: ${JSON.stringify(overflow)}`);
    }
    await page.setViewport({ width: 390, height: 844 });
    console.log(`PASS mjengo ${stage}: no horizontal overflow at ${sizes.map(([w, h]) => `${w}x${h}`).join(", ")}`);
  }
  // Same-origin API probes from inside the signed-in page (the real cookie session, no injected headers).
  const api = (path) => page.evaluate(async (p) => (await fetch(p, { credentials: "same-origin" })).status, path);

  // 1. Public product page → hero CTA.
  await page.goto(new URL("/products/mjengo-os", base).href, { waitUntil: "load" });
  const heroHref = await page.$eval("#mjengo-hero a.mk-btn:not(.mk-btn--ghost)", (a) => a.getAttribute("href"));
  if (heroHref !== "/dashboard/mjengo") throw new Error(`Hero CTA must enter at /dashboard/mjengo, got ${heroHref}`);
  if (!(await text()).includes("KES 2,000")) throw new Error("Public page does not show the stored KES 2,000 plan");
  await responsive("public product page");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("#mjengo-hero a.mk-btn:not(.mk-btn--ghost)")]);
  const loginUrl = new URL(page.url());
  if (loginUrl.pathname !== "/login" || loginUrl.searchParams.get("next") !== "mjengo") throw new Error(`Signed-out CTA must reach /login?next=mjengo, got ${loginUrl.pathname}${loginUrl.search}`);
  console.log("PASS public CTA → /login?next=mjengo (intent preserved)");

  // 2. Sign in through the real form; the post-auth destination must be the MJENGO entry.
  await page.waitForSelector("#login-email");
  await new Promise((done) => setTimeout(done, 1200)); // hydration
  await page.type("#login-email", owner.user.email);
  await page.type("#login-password", password);
  const login = page.waitForResponse((r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.click('button[type="submit"]');
  if (!(await login).ok()) throw new Error("Fixture login failed");
  const workspacePath = `/dashboard/mjengo/${owner.business.id}`;
  await page.waitForFunction((p) => location.pathname === p, { timeout: 30000 }, workspacePath);
  console.log(`PASS sign-in returned to MJENGO and resolved the single owned business (${workspacePath})`);

  // 3. Unpaid workspace: 402 shell with the stored-plan checkout link; APIs refuse with 402.
  const unpaid = await text();
  if (!unpaid.includes("Set up your business first") && !unpaid.includes("Add MJENGO OS")) throw new Error(`Unpaid shell text unexpected: ${unpaid.slice(0, 300)}`);
  const checkoutHref = await page.$eval(`a[href^="/checkout?businessId="]`, (a) => a.getAttribute("href"));
  const checkoutUrl = new URL(checkoutHref, base);
  if (checkoutUrl.searchParams.get("businessId") !== owner.business.id || checkoutUrl.searchParams.get("planId") !== plan.id) throw new Error(`Checkout link must carry this business and the stored plan id: ${checkoutHref}`);
  for (const path of [`/api/mjengo/journal?businessId=${owner.business.id}`]) {
    const status = await api(path);
    if (status !== 402) throw new Error(`Unpaid ${path} must be 402, got ${status}`);
  }
  if (await prisma.mjengoSubscription.count({ where: { businessId: owner.business.id } })) throw new Error("Unpaid business unexpectedly has a MJENGO subscription row");
  await responsive("unpaid workspace (402)");
  console.log("PASS unpaid workspace: entitlement required, stored-plan checkout link, journal API 402, no subscription row");

  // 4. Checkout review page renders the server amount. The Paystack button is never pressed.
  await page.goto(checkoutUrl.href, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.innerText.includes("Review your checkout"));
  await responsive("checkout review");
  if (await prisma.payment.count({ where: { businessId: owner.business.id } })) throw new Error("Rendering checkout must not create a payment");
  console.log("PASS checkout review renders; no payment row created (pay button not pressed)");

  // 5. Paid state as disposable-DB rows (see header). Payment PAID + ACTIVE subscription + entitlement.
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 86_400_000);
  const payment = await prisma.payment.create({
    data: { reference: `MJENGO-BROWSER-${tag}`, businessId: owner.business.id, userId: owner.user.id, planId: plan.id, amount: 200_000, currency: "KES", status: "PAID" },
  });
  created.payments.push(payment.id);
  await prisma.mjengoSubscription.create({
    data: { businessId: owner.business.id, userId: owner.user.id, planId: plan.id, planKey: "MJENGO_OS", status: "ACTIVE", startAt: now, expiresAt, graceUntil: new Date(expiresAt.getTime() + 3 * 86_400_000), paymentId: payment.id, paymentReference: payment.reference },
  });
  await prisma.mjengoEntitlement.create({ data: { businessId: owner.business.id, packageKey: "MJENGO_OS", status: "ACTIVE", activatedAt: now, expiresAt } });

  // 6. Workspace opens for the entitled owner.
  await page.goto(new URL(workspacePath, base).href, { waitUntil: "load" });
  await page.waitForFunction((name) => document.querySelector("h1")?.textContent?.includes(name), {}, owner.business.name);
  if ((await text()).includes("Add MJENGO OS")) throw new Error("Entitled workspace still shows the purchase prompt");
  const journalStatus = await api(`/api/mjengo/journal?businessId=${owner.business.id}`);
  const brandingStatus = await api(`/api/mjengo/branding?businessId=${owner.business.id}`);
  if (journalStatus !== 200 || brandingStatus !== 200) throw new Error(`Entitled APIs must be 200 (journal ${journalStatus}, branding ${brandingStatus})`);
  await responsive("entitled workspace");
  console.log("PASS entitled workspace renders the business; journal and branding APIs 200");

  // 7. Cross-tenant: the same signed-in owner cannot open or query another tenant's workspace.
  await page.goto(new URL(`/dashboard/mjengo/${other.business.id}`, base).href, { waitUntil: "load" });
  const denied = await text();
  if (denied.includes(other.business.name) || !denied.includes("do not have access")) throw new Error(`Cross-tenant workspace was not refused: ${denied.slice(0, 300)}`);
  for (const path of [`/api/mjengo/journal?businessId=${other.business.id}`, `/api/mjengo/branding?businessId=${other.business.id}`]) {
    const status = await api(path);
    if (status !== 403) throw new Error(`Cross-tenant ${path} must be 403, got ${status}`);
  }
  console.log("PASS cross-tenant workspace page refused without leaking the other business name; APIs 403");

  console.log("PASS real Chrome: MJENGO public → login?next → workspace (unpaid 402) → checkout review → entitled workspace → cross-tenant denial; no payment made");
  console.log("NOT TESTED here: provider payment and webhook settlement (covered by tests/prisma/mjengo-journey-postgres.test.ts), production access");
} finally {
  if (browser) await browser.close();
  // Every mutation is confined to the disposable DB. Cleanup must not mask a journey failure.
  try {
    await prisma.mjengoEntitlement.deleteMany({ where: { businessId: { in: created.businesses } } });
    await prisma.mjengoSubscription.deleteMany({ where: { businessId: { in: created.businesses } } });
    await prisma.payment.deleteMany({ where: { id: { in: created.payments } } });
    await prisma.business.deleteMany({ where: { id: { in: created.businesses } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  } catch (error) {
    console.error(`cleanup incomplete (disposable DB only): ${error?.message ?? error}`);
  }
  await prisma.$disconnect();
}
