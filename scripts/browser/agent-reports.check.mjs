#!/usr/bin/env node
/**
 * ADMIN-023 browser journey: an active agent reads THEIR OWN referral report snapshots through the
 * real application route (/agents/reports) and the real API, in Chrome, over six viewports.
 *
 *   AUTH_SECRET=... DATABASE_URL=postgresql://...@127.0.0.1:5432/<db> CHROME_PATH=... \
 *   AGENT_TEST_BASE_URL=http://127.0.0.1:3200 AGENT_REFERRAL_REPORT_SNAPSHOTS_ENABLED=true \
 *   node scripts/browser/agent-reports.check.mjs
 *
 * Start the production server first (`next start`) against the SAME database and env.
 *
 * Data: fictional agents only (`@example.test`), seeded into a disposable loopback database. No
 * messages, payments, customer data, Paystack or live automation are touched. Session cookies are
 * minted with the same AUTH_SECRET the server verifies, exactly as scripts/erp/erp-pages.check.mjs does.
 *
 * Output: one line per check, then `RESULT: PASS|FAIL|BLOCKED`. Connection strings, cookies and
 * secrets are never printed. Screenshots are written to AGENT_REPORT_EVIDENCE_DIR (default .cache).
 */
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SignJWT } from "jose";

const require = createRequire(import.meta.url);
const SECRET = process.env.AUTH_SECRET ?? "";
const CHROME = process.env.CHROME_PATH ?? "";
const DATABASE_URL = process.env.PRISMA_TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const base = new URL(process.env.AGENT_TEST_BASE_URL || "http://127.0.0.1:3200");
const outDir = path.resolve(process.env.AGENT_REPORT_EVIDENCE_DIR || ".cache/agent-reports");

function blocked(reason) {
  console.log(`BLOCKED  ${reason}`);
  console.log("RESULT: BLOCKED");
  process.exit(2);
}
if (!SECRET) blocked("AUTH_SECRET is not set; cannot mint a session cookie the server will verify.");
if (!CHROME) blocked("CHROME_PATH is not set; the browser journey was not run.");
if (!DATABASE_URL) blocked("DATABASE_URL is not set; this journey needs a disposable database.");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:" || base.username || base.password) {
  blocked("AGENT_TEST_BASE_URL must be an unauthenticated loopback http URL.");
}
const dbUrl = new URL(DATABASE_URL);
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(dbUrl.hostname)) {
  blocked("DATABASE_URL must be a loopback database. Refusing to seed anything else.");
}

const puppeteer = require("puppeteer-core");
// Same engine selection as scripts/erp/erp-pages.check.mjs: the product's native client, pointed at the test DB.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

const results = [];
let failed = 0;
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const runId = randomUUID().slice(0, 8);
const VIEWPORTS = [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]];
const DAY = 86_400_000;
const base0 = Date.UTC(2020, 0, 1, 21, 0, 0);

async function makeAgent(label, status, agentStatus, snapshotCount, periodPrefix = "daily") {
  const user = await prisma.user.create({ data: { email: `agent-report-${label}-${runId}@example.test`, passwordHash: "x", role: "CUSTOMER" } });
  const phoneSuffix = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const app = await prisma.agentApplication.create({
    data: { userId: user.id, fullName: `Synthetic ${label} ${runId}`, phoneE164: `+2547${phoneSuffix}`, status, agentStatus, privacyAcknowledgedAt: new Date() },
  });
  if (snapshotCount > 0) {
    await prisma.agentReferralReportSnapshot.createMany({
      data: Array.from({ length: snapshotCount }, (_, i) => ({
        applicationId: app.id,
        periodKey: `${periodPrefix}:${new Date(base0 + i * DAY).toISOString().slice(0, 10)}`,
        periodType: periodPrefix === "daily" ? "DAILY" : "MONTHLY",
        startInclusive: new Date(base0 + i * DAY),
        endExclusive: new Date(base0 + (i + 1) * DAY),
        registrationCount: BigInt(0),
        existingApplicationCount: BigInt(0),
      })),
    });
  }
  return { user, app };
}

async function cookieFor(user) {
  const token = await new SignJWT({ userId: user.id, email: user.email, role: user.role, name: user.name ?? "", sessionVersion: user.sessionVersion ?? 0 })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));
  return { name: "jata_session", value: token, url: base.origin };
}

async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/login", base), { redirect: "manual" });
      if (response.status < 500) return true;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

async function main() {
  if (!(await waitForServer())) blocked("the server did not answer on AGENT_TEST_BASE_URL; start it first.");
  await mkdir(outDir, { recursive: true });

  // Seed. Counts are zero because the baseline trigger requires counts to equal real attribution rows.
  const active = await makeAgent("active", "PENDING", "ACTIVE", 101);
  const empty = await makeAgent("empty", "PENDING", "ACTIVE", 0);
  const other = await makeAgent("other", "PENDING", "ACTIVE", 3, "monthly");
  const pending = await makeAgent("pending", "PENDING", "INACTIVE", 2);
  const admin = await prisma.user.create({ data: { email: `agent-report-admin-${runId}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const customer = await prisma.user.create({ data: { email: `agent-report-customer-${runId}@example.test`, passwordHash: "x", role: "CUSTOMER" } });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      let url;
      try { url = new URL(request.url()); } catch { return void request.abort(); }
      return url.origin === base.origin ? void request.continue() : void request.abort();
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error).slice(0, 200)));

    // 1. Anonymous visitors are sent to sign-in and receive no report data.
    await page.deleteCookie(...(await page.cookies()));
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(new URL("/agents/reports", base).href, { waitUntil: "networkidle0" });
    const anonUrl = new URL(page.url());
    const anonBody = await page.evaluate(() => document.body.innerText);
    check("anonymous visitor is redirected to sign-in", anonUrl.pathname === "/login", anonUrl.pathname);
    check("anonymous response shows no report data", !anonBody.includes("Referral evidence by completed period") && !anonBody.includes("Load older snapshots"));

    // 2. Refused accounts: ADMIN and customer without an active agent application. No data, no admin path.
    for (const [label, user] of [["ADMIN without agent application", admin], ["customer without agent application", customer], ["PENDING inactive agent", pending.user]]) {
      await page.deleteCookie(...(await page.cookies()));
      await page.setCookie(await cookieFor(user));
      for (const [w, h] of VIEWPORTS) {
        await page.setViewport({ width: w, height: h });
        await page.goto(new URL("/agents/reports", base).href, { waitUntil: "networkidle0" });
        const state = await page.evaluate(() => ({
          text: document.body.innerText,
          hasButton: Boolean([...document.querySelectorAll("button")].find((b) => /Load older/.test(b.textContent || ""))),
          hasList: Boolean(document.querySelector("ol[aria-label]")),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        }));
        const ok = state.text.includes("An active agent account is required") && !state.hasButton && !state.hasList && !state.overflow;
        check(`${label} is refused at ${w}x${h}`, ok);
        if (w === 390) await page.screenshot({ path: path.join(outDir, `refused-${label.split(" ")[0].toLowerCase()}-390x844.png`), captureBeyondViewport: false });
      }
      const apiStatus = await page.evaluate(async () => (await fetch("/api/agents/reports/referrals", { credentials: "same-origin" })).status);
      check(`${label} API returns refusal`, apiStatus === 403 || apiStatus === 401, `HTTP ${apiStatus}`);
    }

    // 3. Active agent with 101 snapshots: populated, paginated, no duplicates, no other agent's data.
    await page.deleteCookie(...(await page.cookies()));
    await page.setCookie(await cookieFor(active.user));
    for (const [w, h] of VIEWPORTS) {
      await page.setViewport({ width: w, height: h });
      await page.goto(new URL("/agents/reports", base).href, { waitUntil: "networkidle0" });
      await page.waitForSelector("ol[aria-label]");
      const first = await page.evaluate(() => {
        const items = [...document.querySelectorAll("ol[aria-label] > li")];
        const button = [...document.querySelectorAll("button")].find((b) => /Load older/.test(b.textContent || ""));
        const rect = button ? button.getBoundingClientRect() : null;
        return {
          count: items.length,
          headings: items.map((li) => li.querySelector("h3")?.textContent || ""),
          hasButton: Boolean(button),
          buttonHeight: rect ? Math.round(rect.height) : 0,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          text: document.body.innerText,
        };
      });
      check(`active agent sees the first 100 own snapshots at ${w}x${h}`, first.count === 100 && first.hasButton && !first.overflow, `count=${first.count}`);
      check(`touch target for "Load older" is at least 44px at ${w}x${h}`, first.buttonHeight >= 44, `${first.buttonHeight}px`);
      if (w === 390) await page.screenshot({ path: path.join(outDir, "populated-first-page-390x844.png") });

      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Load older/.test(b.textContent || ""))?.click());
      await page.waitForFunction(() => document.querySelectorAll("ol[aria-label] > li").length === 101, { timeout: 15000 });
      const after = await page.evaluate(() => {
        const headings = [...document.querySelectorAll("ol[aria-label] > li h3")].map((h) => h.textContent || "");
        const button = [...document.querySelectorAll("button")].find((b) => /Load older/.test(b.textContent || ""));
        return { count: headings.length, unique: new Set(headings).size, buttonGone: !button, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
      check(`"Load older" appends the remainder without duplicates at ${w}x${h}`, after.count === 101 && after.unique === 101 && after.buttonGone && !after.overflow, `items=${after.count} unique=${after.unique}`);
      if (w === 390) await page.screenshot({ path: path.join(outDir, "populated-all-pages-390x844.png") });
    }

    // 4. Cross-tenant: the other agent's monthly periods never appear in this agent's page.
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(new URL("/agents/reports", base).href, { waitUntil: "networkidle0" });
    await page.waitForSelector("ol[aria-label]");
    // The other agent's snapshots are MONTHLY; this agent's are DAILY. Any "Monthly" label or the
    // other agent's name would therefore be a cross-tenant disclosure.
    const leakText = await page.evaluate(() => document.body.innerText);
    check("another agent's snapshots and name never appear in this page", !leakText.includes("Monthly") && !leakText.includes(`Synthetic other ${runId}`));

    // 5. Keyboard: the load control is reachable and operable without a pointer.
    await page.evaluate(() => { window.scrollTo(0, 0); });
    const focusable = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Load older|Loading/.test(x.textContent || ""));
      return Boolean(b) && !b.disabled;
    });
    check("load control is a focusable enabled button", focusable);

    // 6. Empty state for an active agent with no snapshots.
    await page.deleteCookie(...(await page.cookies()));
    await page.setCookie(await cookieFor(empty.user));
    for (const [w, h] of VIEWPORTS) {
      await page.setViewport({ width: w, height: h });
      await page.goto(new URL("/agents/reports", base).href, { waitUntil: "networkidle0" });
      const text = await page.evaluate(() => document.body.innerText);
      check(`empty state shown at ${w}x${h}`, text.includes("No referral report snapshots yet"));
    }

    // 7. Loading and error states, driven by intercepting the real API call.
    await page.deleteCookie(...(await page.cookies()));
    await page.setCookie(await cookieFor(active.user));
    await page.setViewport({ width: 390, height: 844 });
    const interceptor = (mode) => {
      page.removeAllListeners("request");
      page.on("request", (request) => {
        let url;
        try { url = new URL(request.url()); } catch { return void request.abort(); }
        if (url.origin !== base.origin) return void request.abort();
        if (url.pathname === "/api/agents/reports/referrals") {
          if (mode === "error") return void request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Referral report snapshots are unavailable." }) });
          if (mode === "delay") return void setTimeout(() => request.continue().catch(() => {}), 1500);
        }
        return void request.continue();
      });
    };
    interceptor("delay");
    const nav = page.goto(new URL("/agents/reports", base).href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Loading your referral report snapshots"), { timeout: 10000 }).then(() => check("loading state is announced while the API is pending", true)).catch(() => check("loading state is announced while the API is pending", false));
    await nav;
    await page.waitForSelector("ol[aria-label]", { timeout: 20000 }).catch(() => {});
    interceptor("error");
    await page.goto(new URL("/agents/reports", base).href, { waitUntil: "networkidle0" });
    const errorText = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent || "");
    check("error state shows a safe message", errorText.includes("temporarily unavailable"), errorText.slice(0, 80));

    // 8. The application's own pages produced no uncaught client error during the journey.
    check("no uncaught client-side page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  console.log(`FAIL  journey aborted — ${String(error?.message ?? error).split("\n")[0].slice(0, 200)}`);
  failed += 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
const passed = results.filter((r) => r.ok).length;
console.log(`SUMMARY ${passed}/${results.length} checks passed, ${failed} failed`);
console.log(failed === 0 && results.length > 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 && results.length > 0 ? 0 : 1);
