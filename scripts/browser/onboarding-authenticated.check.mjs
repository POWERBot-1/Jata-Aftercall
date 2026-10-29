#!/usr/bin/env node
// Real browser/HTTP/PostgreSQL on the fictional CI database. No payment is made.
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

const db = new URL(process.env.DATABASE_URL || "postgresql://invalid.invalid/invalid");
const base = new URL(process.env.BASE_URL || "http://127.0.0.1:4100");
if (process.env.JATA_DISPOSABLE_BROWSER_DB !== "1" || !["localhost", "127.0.0.1"].includes(db.hostname) || !["localhost", "127.0.0.1"].includes(base.hostname) || base.protocol !== "http:") throw new Error("Requires explicit disposable local database and local HTTP server.");
if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) throw new Error("Chrome unavailable");
const prisma = new PrismaClient();
const name = `Onboarding browser ${randomUUID().slice(0, 8)}`;
const sizes = [[320,568],[360,800],[390,844],[430,932],[768,1024],[1366,768]];
let browser, businessId;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(new URL("/login", base).href, { waitUntil: "load" });
  await page.waitForSelector("#login-email");
  await new Promise((done) => setTimeout(done, 1200));
  await page.type("#login-email", process.env.SCREENSHOT_LOGIN_EMAIL || "demo@jata.link");
  await page.type("#login-password", process.env.SCREENSHOT_LOGIN_PASSWORD || "Demo1234!");
  const login = page.waitForResponse((r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.click('button[type="submit"]');
  if (!(await login).ok()) throw new Error("Fixture login failed");
  await page.waitForFunction(() => location.pathname.startsWith("/dashboard"));
  await page.goto(new URL("/onboarding", base).href, { waitUntil: "load" });
  await page.waitForSelector("#onboard-name");
  async function step(n) { await page.waitForFunction((s) => document.querySelector('nav[aria-label="Setup progress"]')?.textContent.includes(`Step ${s} of 7`), {}, n); }
  async function click(text) {
    const button = await page.evaluateHandle((label) => [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === label), text);
    const element = button.asElement();
    if (!element) throw new Error(`Missing button: ${text}`);
    await element.click();
    await button.dispose();
  }
  async function responsive(stage) {
    for (const [width, height] of sizes) {
      await page.setViewport({ width, height });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 ? { actual: document.documentElement.scrollWidth, elements: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((el) => `${el.tagName}.${String(el.className).slice(0,60)}`) } : null);
      if (overflow) throw new Error(`Onboarding ${stage} overflow at ${width}x${height}: ${JSON.stringify(overflow)}`);
      console.log(`PASS onboarding ${stage} layout ${width}x${height}`);
    }
  }
  await responsive("name");
  await click("Save and continue");
  await page.waitForFunction(() => document.body.textContent.includes("Enter your business name"));
  await page.type("#onboard-name", name);
  await click("Save and continue");
  await step(2);
  const row = await prisma.business.findFirst({ where: { name }, select: { id: true, isPublished: true } });
  if (!row || row.isPublished) throw new Error("Saved private draft missing");
  businessId = row.id;
  await page.reload({ waitUntil: "load" });
  await step(2);
  await page.waitForFunction(() => document.body.textContent.includes("restored your unfinished setup"));
  await responsive("contact");
  await page.type("#onboard-phone", "0712345678");
  await click("Continue"); await step(3); await responsive("location");
  await click("Continue"); await step(4); await responsive("services");
  await page.type("#service-title-0", "Fixture service");
  await page.type("#service-price-0", "KES 100");
  await click("Continue"); await step(5); await responsive("message");
  await page.type("#onboard-description", "Fictional onboarding browser fixture");
  await click("Continue"); await step(6); await responsive("plan");
  await click("Continue to publish");
  await page.waitForFunction(() => document.body.textContent.includes("Publishing opens after your subscription payment is confirmed"));
  const saved = await prisma.business.findUnique({ where: { id: businessId }, select: { description: true, isPublished: true } });
  const services = await prisma.service.count({ where: { businessId, title: "Fixture service" } });
  if (saved?.description !== "Fictional onboarding browser fixture" || saved.isPublished || services !== 1) throw new Error("Saved onboarding business or service did not persist privately");
  console.log("PASS real Chrome: onboarding validation, create, reload/restore, saved service and description, unpaid publish refusal; no payment made");
  console.log("NOT TESTED paid onboarding publish and production access");
} finally {
  if (browser) await browser.close();
  // All mutations are confined to the disposable DB. Do not mask a journey failure during cleanup.
  if (businessId) {
    await prisma.service.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  }
  await prisma.$disconnect();
}
