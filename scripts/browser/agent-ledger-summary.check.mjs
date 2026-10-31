#!/usr/bin/env node
/** Synthetic authenticated display test only. Provider and summary response are fixtures. */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const db = new URL(process.env.DATABASE_URL || "http://invalid");
const base = new URL(process.env.AGENT_TEST_BASE_URL || "http://invalid");
if (process.env.AGENT_BROWSER_ISOLATED !== "1" || !process.env.CHROME_PATH ||
    !["postgres:", "postgresql:"].includes(db.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !["/jata_shots", "/jata_agent_test"].includes(db.pathname) ||
    base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) || base.username || base.password || base.port !== "4100") throw new Error("Requires explicitly isolated loopback browser and disposable database");
const out = path.resolve("premium-shots/agents-ledger");
await mkdir(out, { recursive: true });
const prisma = new PrismaClient();
const password = "SyntheticAgentTest#2026";
const email = `ledger-${randomUUID()}@test.invalid`;
const fixture = { scope: "OWN_LEDGER_STORAGE_ONLY", currency: "KES", entryCount: "2", accrualMinor: "9007199254740993", reversalMinor: "-2000", netMinor: "9007199254738993", verification: "NOT_CHECKED", entitlement: "NOT_DETERMINED", payout: "NOT_AVAILABLE" };
let user, browser;
try {
  user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), role: "CUSTOMER", name: "Synthetic Ledger User" }, select: { id: true } });
  await prisma.agentApplication.create({ data: { userId: user.id, fullName: "Synthetic Ledger Agent", phoneE164: "+254712345678", privacyAcknowledgedAt: new Date(), agentStatus: "ACTIVE", status: "PENDING" } });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  let summaryMode = "ready";
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    let url; try { url = new URL(request.url()); } catch { return void request.abort(); }
    if (url.origin !== base.origin) return void request.abort();
    if (url.pathname === "/api/agents/commissions/summary") return void request.respond({ status: summaryMode === "failure" ? 503 : 200, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(summaryMode === "malformed" ? { ...fixture, payout: "AVAILABLE" } : fixture) });
    return void request.continue();
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(new URL("/login?next=agents", base).href, { waitUntil: "networkidle0" });
  await page.type("#login-email", email); await page.type("#login-password", password); await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === "/agents/dashboard", { timeout: 30000 });
  for (const [width, height] of [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const response = await page.goto(new URL("/agents/dashboard", base).href, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.innerText.includes("90,071,992,547,409.93"), { timeout: 20000 });
    const result = await page.evaluate(() => {
      const section = document.querySelector('section[aria-label="Unverified commission ledger records"]');
      if (!section) return { error: "missing section" };
      const text = section.textContent || ""; const box = section.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1 || box.left < 0 || box.right > innerWidth + 1, text };
    });
    if (response?.status() !== 200 || result.error || result.overflow || !result.text.includes("not earnings or a payable balance") || !result.text.includes("−KES 20.00")) throw new Error(`Ledger display failed ${width}x${height}: ${JSON.stringify(result)}`);
    await page.screenshot({ path: path.join(out, `unverified-ledger-${width}x${height}.png`), fullPage: true });
    console.log(`PASS synthetic authenticated ledger display ${width}x${height}`);
  }
  for (const mode of ["failure", "malformed"]) {
    summaryMode = mode;
    await page.goto(new URL("/agents/dashboard", base).href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Ledger records are temporarily unavailable"));
    if ((await page.evaluate(() => document.body.innerText)).includes("90,071,992,547,409.93")) throw new Error("Stale values remained visible after failed response");
    console.log(`PASS ${mode} response fails closed`);
  }
  await prisma.agentApplication.update({ where: { userId: user.id }, data: { agentStatus: "SUSPENDED" } });
  summaryMode = "ready";
  await page.goto(new URL("/agents/dashboard", base).href, { waitUntil: "domcontentloaded" });
  const suspended = await page.evaluate(() => document.body.innerText);
  if (!suspended.includes("Agent access suspended") || suspended.includes("Unverified commission ledger records")) throw new Error("Suspended account can see ledger display");
  console.log("PASS suspended-agent display blocked");
  console.log("PASS display with intercepted synthetic summary; no payment or provider exercised");
} finally {
  if (browser) await browser.close();
  if (user) { await prisma.agentApplication.deleteMany({ where: { userId: user.id } }); await prisma.user.deleteMany({ where: { id: user.id } }); }
  await prisma.$disconnect();
}
