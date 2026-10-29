#!/usr/bin/env node
// Real Chrome, HTTP and disposable PostgreSQL. Synthetic subscriptions are test fixtures,
// never payment or production evidence. A single product-save 503 per profile is simulated.
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

const db = new URL(process.env.DATABASE_URL || "postgresql://invalid.invalid/invalid");
const base = new URL(process.env.BASE_URL || "http://127.0.0.1:4100");
if (process.env.JATA_DISPOSABLE_BROWSER_DB !== "1" || !["localhost", "127.0.0.1"].includes(db.hostname) || !["localhost", "127.0.0.1"].includes(base.hostname) || base.protocol !== "http:") throw new Error("Requires explicit disposable local database and local HTTP server");
if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) throw new Error("Chrome unavailable");
const prisma = new PrismaClient();
const uid = randomUUID().slice(0, 8);
const sizes = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
const profiles = [{ key: "retail", label: "Retail shop" }, { key: "salon", label: "Salon" }, { key: "farm", label: "Farm" }];
let browser, strangerId;
const businesses = [];
async function login(page, email, password) {
  await page.goto(new URL("/login", base).href, { waitUntil: "load" });
  await page.waitForSelector("#login-email");
  await new Promise((done) => setTimeout(done, 1200));
  await page.type("#login-email", email); await page.type("#login-password", password);
  const result = page.waitForResponse((r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.click('button[type="submit"]');
  if (!(await result).ok()) throw new Error("Fixture login failed");
  await page.waitForFunction(() => location.pathname.startsWith("/dashboard"));
}
async function clickText(page, selector, text) {
  const handle = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((el) => el.textContent.trim() === t), selector, text);
  const element = handle.asElement();
  if (!element) throw new Error(`Missing ${selector} with text ${text}`);
  await element.click(); await handle.dispose();
}
async function layout(page, profile, stage) {
  for (const [width,height] of sizes) {
    await page.setViewport({ width,height });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 ? { width: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0,6).map((el) => `${el.tagName}.${String(el.className).slice(0,60)}`) } : null);
    if (overflow) throw new Error(`${profile} ${stage} overflow ${width}x${height}: ${JSON.stringify(overflow)}`);
    console.log(`PASS layout ${profile} ${stage} ${width}x${height}`);
  }
}
async function fill(page, selector, text) {
  console.log(`Filling ${selector}`);
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector);
  await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control");
  await page.type(selector, String(text));
}
try {
  const owner = await prisma.user.findUnique({ where: { email: process.env.SCREENSHOT_LOGIN_EMAIL || "demo@jata.link" } });
  const plan = await prisma.planConfig.findUnique({ where: { key: "BUSINESS_POS" } });
  if (!owner || !plan) throw new Error("Disposable fixtures missing");
  const stranger = await prisma.user.create({ data: { email: `pos-stranger-${uid}@jata.test`, name: "Fixture stranger", passwordHash: await bcrypt.hash("Fixture#2026", 10), role: "CUSTOMER" } });
  strangerId = stranger.id;
  for (const profile of profiles) {
    const business = await prisma.business.create({ data: { ownerId: owner.id, name: `Browser ${profile.key} ${uid}`, slug: `browser-${profile.key}-${uid}`, category: "Other" } });
    businesses.push(business.id);
    // This is a synthetic DB fixture exclusively inside the disposable CI database, not a payment.
    await prisma.posSubscription.create({ data: { businessId: business.id, userId: owner.id, planId: plan.id, status: "ACTIVE", expiresAt: new Date(Date.now()+86400000) } });
  }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage(); page.setDefaultTimeout(30000);
  await page.setViewport({ width: 390,height:844 });
  await login(page, process.env.SCREENSHOT_LOGIN_EMAIL || "demo@jata.link", process.env.SCREENSHOT_LOGIN_PASSWORD || "Demo1234!");
  // Synthetic browser event exercises presentation and dismissal, not the browser's native install flow.
  await new Promise((done) => setTimeout(done, 1200));
  await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable:true })));
  await page.waitForSelector('[data-pwa-install="available"]', { visible:true });
  for (const [width,height] of sizes) {
    await page.setViewport({ width,height });
    const result = await page.evaluate(() => {
      const banner = document.querySelector('[data-pwa-install="available"]');
      const next = banner.nextElementSibling;
      return { position: getComputedStyle(banner).position, bannerBottom: banner.getBoundingClientRect().bottom, nextTop: next?.getBoundingClientRect().top };
    });
    if (result.position === "fixed" || result.nextTop == null || result.bannerBottom > result.nextTop + 1) throw new Error(`Install prompt overlaps workspace at ${width}x${height}: ${JSON.stringify(result)}`);
    console.log(`PASS install prompt in document flow ${width}x${height}`);
  }
  await clickText(page, '[data-pwa-install="available"] button', "Not now");
  await page.waitForSelector('[data-pwa-install="available"]', { hidden:true });
  await page.reload({ waitUntil:"load" });
  await new Promise((done) => setTimeout(done, 1200));
  await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable:true })));
  await new Promise((done) => setTimeout(done, 200));
  if (await page.$('[data-pwa-install="available"]')) throw new Error("Dismissed install prompt reappeared after reload");
  console.log("PASS install prompt dismissal persists across reload (synthetic event)");
  for (const [index, profile] of profiles.entries()) {
    const id = businesses[index], root = `/dashboard/pos/${id}`;
    await page.goto(new URL(`${root}/configure`, base).href, { waitUntil:"load" });
    await page.waitForSelector(".pos-option", { visible:true });
    await new Promise((done) => setTimeout(done, 1200));
    await layout(page, profile.key, "configure-first-question");
    const option = await page.evaluateHandle((label) => [...document.querySelectorAll(".pos-option")].find((el) => el.querySelector("strong")?.textContent.trim().endsWith(label)), profile.label);
    if (!option.asElement()) throw new Error(`No ${profile.label} option`);
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/pos/${id}/configuration`) && r.request().method() === "POST").catch(() => null);
    await option.asElement().click(); await option.dispose();
    if (!(await saved)?.ok()) throw new Error(`${profile.key} questionnaire save failed`);
    await page.waitForFunction(() => !document.body.textContent.includes("Saving…"));
    await page.reload({ waitUntil:"load" });
    const config = await prisma.posConfiguration.findUnique({ where:{ businessId:id } });
    if (!config || JSON.parse(config.answersJson).business_type !== profile.key) throw new Error(`${profile.key} saved questionnaire missing`);
    console.log(`PASS ${profile.key} business-type questionnaire persisted across reload`);
    // Publish the already browser-saved draft only as a synthetic isolated fixture so operational
    // screens can be exercised. This deliberately proves neither payment nor publication workflow.
    await prisma.posConfiguration.update({ where:{ businessId:id }, data:{ status:"LIVE", configurationStatus:"PUBLISHED", publishedJson:config.draftJson, publishedVersion:1 } });
    await page.goto(new URL(`${root}/products?new=1`,base).href, { waitUntil:"load" });
    await page.waitForSelector("#f-name", { visible:true });
    await new Promise((done) => setTimeout(done, 1200));
    await layout(page, profile.key, "product-create");
    const kind = await page.$eval("#f-kind", (el) => el.value);
    if (kind !== "PRODUCT") throw new Error(`${profile.key} unexpected default ${kind}`);
    await fill(page,"#f-name",`Fixture ${profile.key}`); await fill(page,"#f-category",`Category ${profile.key}`); await fill(page,"#f-priceKES","100");
    // A controlled 503 tests the UI's error and recovery path, not a real database outage.
    let failNext = true;
    await page.setRequestInterception(true);
    const rejectOnce = (request) => {
      if (failNext && request.url().endsWith(`/api/pos/${id}/products`) && request.method() === "POST") {
        failNext = false;
        return void request.respond({ status:503, contentType:"application/json", body:JSON.stringify({ error:"Temporary test failure. Try again." }) });
      }
      void request.continue();
    };
    page.on("request", rejectOnce);
    const failedSave = page.waitForResponse((r) => r.url().endsWith(`/api/pos/${id}/products`) && r.status() === 503);
    await page.click('form.pos-form button[type="submit"]');
    await failedSave;
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes("Temporary test failure"));
    if (await prisma.posProduct.count({ where:{ businessId:id, name:`Fixture ${profile.key}` } })) throw new Error(`${profile.key} failed save created a product`);
    await page.setRequestInterception(false); page.off("request", rejectOnce);
    if ((await page.$eval("#f-name", (el) => el.value)) !== `Fixture ${profile.key}`) throw new Error(`${profile.key} lost form values after failed save`);
    console.log(`PASS ${profile.key} simulated product-save failure preserves form and supports retry`);
    await page.waitForFunction(() => !document.querySelector('form.pos-form button[type="submit"]')?.disabled);
    const created = page.waitForResponse((r) => r.url().endsWith(`/api/pos/${id}/products`) && r.request().method() === "POST").catch(() => null);
    const createNavigation = page.waitForNavigation({ waitUntil:"load" }).catch(() => null);
    await page.click('form.pos-form button[type="submit"]');
    if (!(await created)?.ok()) throw new Error(`${profile.key} product create failed`);
    await createNavigation;
    let product = await prisma.posProduct.findFirst({ where:{ businessId:id, name:`Fixture ${profile.key}` } });
    if (!product || product.kind !== kind || product.category !== `Category ${profile.key}` || product.priceKES !== 100) throw new Error(`${profile.key} product persistence failed`);
    await page.reload({ waitUntil:"load" });
    await page.waitForFunction((name) => document.body.textContent.includes(name), {}, product.name);
    await new Promise((done) => setTimeout(done, 1200));
    await clickText(page, ".pos-row-actions button", "Edit");
    await page.waitForFunction((category) => document.querySelector("#f-category")?.value === category && document.querySelector('form.pos-form button[type="submit"]')?.textContent.trim() === "Save changes", {}, product.category);
    await fill(page,"#f-category",`Updated ${profile.key}`);
    const edited = page.waitForResponse((r) => r.url().includes(`/api/pos/${id}/products/${product.id}`) && r.request().method() === "PATCH").catch(() => null);
    const editNavigation = page.waitForNavigation({ waitUntil:"load" }).catch(() => null);
    await clickText(page,'form.pos-form button',"Save changes");
    if (!(await edited)?.ok()) throw new Error(`${profile.key} edit failed`);
    await editNavigation;
    product = await prisma.posProduct.findUnique({ where:{ id:product.id } });
    if (product.category !== `Updated ${profile.key}`) throw new Error(`${profile.key} edited category missing: ${JSON.stringify(product.category)}`);
    console.log(`PASS ${profile.key} product/category create, reload and edit using real browser and PostgreSQL`);
    await page.goto(new URL(`${root}/inventory`,base).href, { waitUntil:"load" });
    await new Promise((done) => setTimeout(done, 1200));
    await layout(page, profile.key, "inventory");
    if (await page.$('[data-pwa-install="available"] .jata-pwa__button--quiet')) {
      await page.click('[data-pwa-install="available"] .jata-pwa__button--quiet');
      await page.waitForSelector('[data-pwa-install="available"]', { hidden:true });
      console.log("PASS dismiss install prompt before adjusting stock");
    }
    await clickText(page, "button.pos-tab", "Adjust");
    await page.waitForSelector("#inv-product", { visible:true });
    await page.select("#inv-product", product.id);
    await page.select("#inv-reason", "OPENING");
    await fill(page, "#inv-quantity", "5");
    const stockResponse = page.waitForResponse((r) => r.url().endsWith(`/api/pos/${id}/inventory`) && r.request().method() === "POST").catch(() => null);
    const stockNavigation = page.waitForNavigation({ waitUntil:"load" }).catch(() => null);
    await clickText(page, 'form.pos-form button[type="submit"]', "Save the change");
    if (!(await stockResponse)?.ok()) throw new Error(`${profile.key} stock adjustment failed`);
    await stockNavigation;
    const stock = await prisma.posInventoryItem.findFirst({ where:{ businessId:id, productId:product.id } });
    if (Number(stock?.quantity) !== 5) throw new Error(`${profile.key} opening stock not persisted`);
    console.log(`PASS ${profile.key} opening stock adjustment saved by browser`);
    await page.goto(new URL(`${root}/sell`,base).href, { waitUntil:"load" });
    await new Promise((done) => setTimeout(done, 1200));
    await layout(page, profile.key, "sell");
    await page.waitForSelector(".pos-item");
    if (await page.$('[data-pwa-install="available"] .jata-pwa__button--quiet')) {
      await page.click('[data-pwa-install="available"] .jata-pwa__button--quiet');
      await page.waitForSelector('[data-pwa-install="available"]', { hidden:true });
      console.log("PASS dismiss install prompt before using till");
    }
    await page.click(".pos-item");
    await page.waitForSelector('[aria-label^="One less "]', { visible:true }).catch(async () => {
      const details = await page.evaluate(() => { const el = document.querySelector(".pos-item"); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return { text:el.textContent.trim(), rect:{x:r.x,y:r.y,width:r.width,height:r.height}, top:top?.outerHTML.slice(0,200), body:document.body.textContent.slice(-1200) }; });
      throw new Error(`Cart did not respond to click: ${JSON.stringify(details)}`);
    });
    await clickText(page,".pos-method", "Cash");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent.trim().startsWith("Complete ") && !button.disabled)).catch(async () => {
      const diagnostic = await page.evaluate(() => ({ buttons: [...document.querySelectorAll("button")].filter((button) => button.textContent.trim().startsWith("Complete ")).map((button) => ({ text:button.textContent.trim(), disabled:button.disabled })), payment:document.querySelector("#pay-0")?.value, banner:document.querySelector(".pos-banner-text")?.textContent, cart:!!document.querySelector('[aria-label^="One less "]') }));
      throw new Error(`Till did not enable: ${JSON.stringify(diagnostic)}`);
    });
    const saleResponse = page.waitForResponse((r) => r.url().endsWith(`/api/pos/${id}/sales`) && r.request().method() === "POST").catch(() => null);
    const complete = await page.$$('button');
    const submit = (await Promise.all(complete.map(async (button) => [await button.evaluate((el) => el.textContent.trim()),button]))).find(([text]) => text.startsWith("Complete "))?.[1];
    if (!submit || await submit.evaluate((el) => el.disabled)) throw new Error(`${profile.key} complete sale disabled`);
    await submit.click();
    const sale = await saleResponse;
    if (!sale?.ok()) throw new Error(`${profile.key} sale failed HTTP ${sale?.status()}: ${sale ? (await sale.text()).slice(0,300) : "no response"}`);
    if (await prisma.posSale.count({ where:{ businessId:id } }) !== 1) throw new Error(`${profile.key} sale not persisted`);
    const remaining = await prisma.posInventoryItem.findFirst({ where:{ businessId:id, productId:product.id } });
    if (Number(remaining?.quantity) !== 4) throw new Error(`${profile.key} sale did not reduce stock`);
    console.log(`PASS ${profile.key} cash sale and stock decrement recorded by browser, synthetic subscription`);
    await page.goto(new URL(`${root}/reports`,base).href, { waitUntil:"load" });
    await new Promise((done) => setTimeout(done, 1200));
    await layout(page, profile.key, "reports");
    const reportResponse = page.waitForResponse((r) => r.url().includes(`/api/pos/${id}/reports?`) && r.request().method() === "GET").catch(() => null);
    const reportButton = await page.evaluateHandle(() => [...document.querySelectorAll("button.pos-option")].find((el) => el.querySelector("strong")?.textContent.trim() === "Daily sales"));
    if (!reportButton.asElement()) throw new Error(`${profile.key} daily sales report missing`);
    await reportButton.asElement().click(); await reportButton.dispose();
    const report = await reportResponse;
    if (!report?.ok()) throw new Error(`${profile.key} daily sales report failed`);
    const reportData = await report.json();
    if (!reportData.report?.summary?.some((row) => row.value === "1") || !reportData.report?.rows?.length) throw new Error(`${profile.key} daily sales did not report the recorded sale`);
    await page.waitForFunction(() => document.querySelector(".jata-stat-grid")?.textContent.includes("100"));
    console.log(`PASS ${profile.key} daily sales report shows recorded sale`);
    await page.goto(new URL(`${root}/products`,base).href, { waitUntil:"load" });
    await page.waitForSelector(".pos-row-actions button", { visible:true });
    await new Promise((done) => setTimeout(done, 1200));
    const removed = page.waitForResponse((r) => r.url().includes(`/api/pos/${id}/products/${product.id}`) && r.request().method() === "PATCH").catch(() => null);
    const removeNavigation = page.waitForNavigation({ waitUntil:"load" }).catch(() => null);
    await clickText(page, ".pos-row-actions button", "Remove");
    if (!(await removed)?.ok()) throw new Error(`${profile.key} product removal failed`);
    await removeNavigation;
    if ((await prisma.posProduct.findUnique({ where:{ id:product.id } }))?.isActive !== false) throw new Error(`${profile.key} product archive missing`);
    console.log(`PASS ${profile.key} product removed from active catalogue; historic sale retained`);
  }
  const strangerContext = await browser.createBrowserContext();
  const outsider = await strangerContext.newPage(); outsider.setDefaultTimeout(30000);
  await login(outsider, `pos-stranger-${uid}@jata.test`, "Fixture#2026");
  for (const id of businesses) {
    const status = await outsider.evaluate(async (path) => (await fetch(path)).status, `/api/pos/${id}/products`);
    if (![403,404].includes(status)) throw new Error(`Cross-tenant products unexpectedly returned ${status}`);
  }
  console.log("PASS cross-tenant catalogue requests refused from independent authenticated browser session");
  await strangerContext.close();
} finally {
  if (browser) await browser.close();
  for (const id of businesses) await prisma.business.deleteMany({ where:{ id } });
  if (strangerId) await prisma.user.deleteMany({ where:{ id:strangerId } });
  await prisma.$disconnect();
}
