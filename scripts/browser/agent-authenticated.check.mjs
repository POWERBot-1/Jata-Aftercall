#!/usr/bin/env node
/** Only the implemented application/status flow. NEVER asserts verification or activation.
 * Runs against a specifically named loopback CI database and loopback web server; fixtures and
 * screenshots contain synthetic data. No messages or payments are sent.
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const db = new URL(process.env.DATABASE_URL || "http://invalid");
const base = new URL(process.env.AGENT_TEST_BASE_URL || "http://invalid");
const loopback = ["localhost", "127.0.0.1", "[::1]"];
if (process.env.AGENT_BROWSER_ISOLATED !== "1" || !process.env.CHROME_PATH ||
    !["postgres:", "postgresql:"].includes(db.protocol) || !loopback.includes(db.hostname) || db.pathname !== "/jata_shots" ||
    base.protocol !== "http:" || !loopback.includes(base.hostname) || base.username || base.password || base.port !== "4100") {
  throw new Error("BLOCKED: requires the dedicated loopback jata_shots CI database, local server and explicit isolation flag");
}
const out = path.resolve("premium-shots/agents");
await mkdir(out, { recursive: true });
const prisma = new PrismaClient();
const password = "SyntheticAgentTest#2026";
const runId = randomUUID();
const emails = [`agent-${runId}@test.invalid`, `other-${runId}@test.invalid`];
const createdIds = [];
let browser;
try {
  const passwordHash = await bcrypt.hash(password, 10);
  for (const email of emails) {
    const user = await prisma.user.create({ data: { email, passwordHash, role: "CUSTOMER", name: "Synthetic Browser User" }, select: { id: true } });
    createdIds.push(user.id);
  }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  async function openPage() {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      let url;
      try { url = new URL(request.url()); } catch { return void request.abort(); }
      if (url.origin !== base.origin) return void request.abort();
      return void request.continue();
    });
    return { context, page };
  }
  async function login(page, email) {
    await page.goto(new URL("/login?next=agents", base).href, { waitUntil: "networkidle0" });
    await page.type("#login-email", email);
    await page.type("#login-password", password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname === "/agents/dashboard", { timeout: 20000 });
  }
  const first = await openPage();
  await first.page.setViewport({ width: 390, height: 844 });
  await login(first.page, emails[0]);
  await first.page.goto(new URL("/agents/apply", base).href, { waitUntil: "networkidle0" });
  await first.page.waitForSelector("#agent-name");
  await first.page.type("#agent-name", "Synthetic Browser Applicant");
  await first.page.type("#agent-phone", "0712345678");
  await first.page.click('input[type="checkbox"]');
  await first.page.click('button[type="submit"]');
  await first.page.waitForFunction(() => document.body.innerText.includes("Application received"), { timeout: 20000 });
  const application = await prisma.agentApplication.findUniqueOrThrow({ where: { userId: createdIds[0] } });
  if (application.status !== "PENDING") throw new Error("Application unexpectedly active or rejected");
  const auditCount = await prisma.auditEvent.count({ where: { action: "AGENT_APPLICATION_SUBMITTED", targetId: application.id } });
  if (auditCount !== 1) throw new Error("Expected exactly one application audit");
  for (const [width, height] of [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]]) {
    await first.page.setViewport({ width, height, deviceScaleFactor: 1 });
    const response = await first.page.goto(new URL("/agents/dashboard", base).href, { waitUntil: "networkidle0" });
    const state = await first.page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    if (response?.status() !== 200 || state.overflow || !state.text.includes("Synthetic Browser Applicant") || !state.text.includes("not active")) throw new Error(`Authenticated status failed at ${width}x${height}`);
    const controls = await first.page.evaluate(() => {
      const input = document.querySelector("#agent-verification-code");
      const nav = document.querySelector('nav[aria-label="Main navigation"]');
      const account = document.querySelector('.mk-header__actions a[href="/dashboard"]');
      const login = document.querySelector('.mk-header__actions a[href="/login"]');
      if (!input || !nav || !account || login) return false;
      const field = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      return style.color === "rgb(20, 17, 15)" && style.backgroundColor === "rgb(255, 255, 255)" &&
        field.height >= 44 && field.width >= 120 && field.right <= innerWidth &&
        Array.from(nav.querySelectorAll("a")).every((link) => {
          const box = link.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth + 1 && box.height >= 44;
        });
    });
    if (!controls) throw new Error(`Verification or navigation controls failed at ${width}x${height}`);
    await first.page.type("#agent-verification-code", "123456");
    await first.page.screenshot({ path: path.join(out, `application-status-${width}x${height}.png`), fullPage: true });
    console.log(`PASS authenticated application status ${width}x${height}`);
  }
  const second = await openPage();
  await login(second.page, emails[1]);
  const text = await second.page.evaluate(() => document.body.innerText);
  if (!text.includes("No application is recorded") || text.includes("Synthetic Browser Applicant")) throw new Error("Another account's application was exposed");
  await second.context.close();
  await first.context.close();
  console.log("PASS authenticated application submission, audit and cross-account isolation; activation and sales NOT TESTED");
} finally {
  if (browser) await browser.close();
  if (createdIds.length) {
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.agentApplication.deleteMany({ where: { userId: { in: createdIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.$disconnect();
}
