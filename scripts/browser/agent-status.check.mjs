#!/usr/bin/env node
/** Local-only browser smoke check for the currently implemented agent application status UI.
 * It does not test activated agents, referrals, phone verification, Paystack or provider delivery.
 * Run a local server first, then set CHROME_PATH. Screenshots go to the ignored .cache directory.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const chrome = process.env.CHROME_PATH;
const base = new URL(process.env.AGENT_TEST_BASE_URL || "http://127.0.0.1:3200");
if (!chrome || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:" || base.username || base.password) {
  console.error("CHROME_PATH and an unauthenticated, loopback-only HTTP AGENT_TEST_BASE_URL are required.");
  process.exit(2);
}
const output = path.resolve(".cache/agent-status-screenshots");
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
try {
  const page = await browser.newPage();
  // Each viewport must fetch the page independently rather than passing on a 304 cache hit.
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return void request.abort(); }
    if (url.origin !== base.origin) return void request.abort();
    return void request.continue();
  });
  for (const [width, height] of [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const response = await page.goto(new URL("/agents", base).href, { waitUntil: "networkidle0" });
    const state = await page.evaluate(() => ({
      title: document.querySelector("h1")?.textContent,
      hasApplication: Boolean(document.querySelector('a[href="/agents/apply"]')),
      hasStatus: Boolean(document.querySelector('a[href="/agents/dashboard"]')),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    if (response?.status() !== 200 || !state.title?.includes("Agent") || !state.hasApplication || !state.hasStatus || state.overflow) {
      throw new Error(`Landing failed at ${width}x${height}: HTTP ${response?.status()} ${JSON.stringify(state)}`);
    }
    await page.screenshot({ path: path.join(output, `landing-${width}x${height}.png`) });
    console.log(`PASS ${width}x${height}: landing, links, no page overflow`);
  }
  await page.setViewport({ width: 390, height: 844 });
  const home = await page.goto(new URL("/", base).href, { waitUntil: "networkidle0" });
  if (home?.status() !== 200 || !(await page.$('a[href="/agents"]'))) throw new Error("Homepage agent entry is missing.");
  console.log("PASS homepage agent entry");
  await page.goto(new URL("/agents/apply", base).href, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Sign in with an existing JATA"));
  await page.screenshot({ path: path.join(output, "application-signed-out-390x844.png") });
  const response = await page.goto(new URL("/agents/dashboard", base).href, { waitUntil: "networkidle0" });
  if (response?.status() !== 200 || new URL(page.url()).pathname !== "/login" || new URL(page.url()).searchParams.get("next") !== "agents") {
    throw new Error("Anonymous dashboard did not redirect to the allowlisted login destination.");
  }
  await page.screenshot({ path: path.join(output, "agent-login-390x844.png") });
  console.log("PASS signed-out application and dashboard redirect");
} finally {
  await browser.close();
}
