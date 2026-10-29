#!/usr/bin/env node
// Real Chrome + disposable PostgreSQL + real HTTP. This intentionally verifies the
// unconfigured-storage refusal, NOT successful upload, object persistence or production.
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const dbUrl = new URL(process.env.DATABASE_URL || "postgresql://invalid.invalid/invalid");
if (process.env.JATA_DISPOSABLE_BROWSER_DB !== "1" || !["localhost", "127.0.0.1"].includes(dbUrl.hostname) || process.env.JATA_STORAGE_PROVIDER) {
  throw new Error("Refusing to run: requires an explicitly disposable local database and unconfigured storage.");
}
const chrome = process.env.CHROME_PATH;
const image = resolve("public/category/agriculture-720.jpg");
if (!chrome || !existsSync(chrome) || !existsSync(image)) throw new Error("Real Chrome and the local photo fixture are required.");
const base = process.env.BASE_URL || "http://127.0.0.1:4100";
const screenshots = process.env.SHOT_DIR || "premium-shots";
mkdirSync(screenshots, { recursive: true });
const prisma = new PrismaClient();
const business = await prisma.business.findUnique({ where: { slug: "nyumbani-kitchen" }, select: { id: true } });
if (!business) throw new Error("Fictional demo business missing from disposable DB.");
const fixture = await prisma.posProduct.create({ data: { businessId: business.id, name: "Browser photo fixture", category: "Photo fixture category", priceKES: 10 } });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(`${base}/login`, { waitUntil: "load" });
  await page.waitForSelector("#login-email", { timeout: 15000 });
  // Wait for the client form to hydrate before typing controlled inputs.
  await new Promise((done) => setTimeout(done, 1200));
  await page.type("#login-email", process.env.SCREENSHOT_LOGIN_EMAIL || "demo@jata.link");
  await page.type("#login-password", process.env.SCREENSHOT_LOGIN_PASSWORD || "Demo1234!");
  const loginResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST", { timeout: 30000 });
  await page.click('button[type="submit"]');
  const login = await loginResponse;
  if (!login.ok()) throw new Error(`Demo login rejected with HTTP ${login.status()}.`);
  await page.waitForFunction(() => location.pathname.startsWith("/dashboard"), { timeout: 30000 });
  const url = `${base}/dashboard/pos/${encodeURIComponent(business.id)}/products?new=1`;
  for (const [width, height] of [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("#pos-product-photo", { timeout: 15000 });
    await page.waitForSelector("#pos-category-photo", { timeout: 15000 });
    const overflow = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= innerWidth + 1) return null;
      const offenders = Array.from(document.querySelectorAll("body *")).map((element) => ({ tag: element.tagName, className: element.className?.toString().slice(0, 80), right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })).filter((element) => element.right > innerWidth + 1).slice(0, 8);
      return { documentWidth: document.documentElement.scrollWidth, offenders };
    });
    if (overflow) throw new Error(`POS catalogue overflows at ${width}x${height}: ${JSON.stringify(overflow)}`);
    await page.screenshot({ path: `${screenshots}/pos-photo-${width}x${height}.jpg`, type: "jpeg", quality: 70, fullPage: true });
    console.log(`PASS POS product and category controls render at ${width}x${height} without horizontal overflow`);
  }
  const file = await page.$("#pos-product-photo");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/media") && response.request().method() === "POST", { timeout: 30000 });
  await file.uploadFile(image);
  const response = await responsePromise;
  if (response.status() !== 503) throw new Error(`Expected honest unconfigured-storage refusal, got ${response.status()}`);
  await page.waitForFunction(() => document.body.textContent.includes("Retry upload"), { timeout: 10000 });
  if (!(await page.$('img[alt="Selected item photo"]'))) throw new Error("Local preview missing after refused upload.");
  const submitDisabled = await page.$eval('form.pos-form button[type="submit"]', (button) => button.disabled);
  if (!submitDisabled) throw new Error("An unsaved failed upload must not silently save the item.");
  const retry = await page.$$('form.pos-form button');
  const retryButton = (await Promise.all(retry.map(async (button) => [(await button.evaluate((el) => el.textContent.trim())), button]))).find(([text]) => text === "Retry upload")?.[1];
  if (!retryButton) throw new Error("Retry action missing.");
  const retryResponse = page.waitForResponse((response) => response.url().endsWith("/api/media") && response.request().method() === "POST", { timeout: 30000 });
  await retryButton.click();
  if ((await retryResponse).status() !== 503) throw new Error("Retry did not fail closed.");
  console.log("PASS real Chrome product selection, local preview, unconfigured-storage refusal and retry");
  const categoryFile = await page.$("#pos-category-photo");
  const categoryResponse = page.waitForResponse((response) => response.url().endsWith("/api/media") && response.request().method() === "POST", { timeout: 30000 });
  await categoryFile.uploadFile(image);
  if ((await categoryResponse).status() !== 503) throw new Error("Category upload did not fail closed.");
  await page.waitForFunction(() => document.querySelector('[aria-labelledby="pos-category-photos"] [role="alert"]'));
  if (await prisma.posCategoryImage.count({ where: { businessId: business.id, category: "Photo fixture category" } })) throw new Error("Refused upload unexpectedly created a category image reference.");
  console.log("PASS real Chrome category photo selection and unconfigured-storage refusal");
  console.log("BLOCKED durable upload, reload and fresh-session object access: no approved storage configured");
} finally {
  if (browser) await browser.close();
  await prisma.posProduct.deleteMany({ where: { id: fixture.id, businessId: business.id } });
  await prisma.$disconnect();
}
