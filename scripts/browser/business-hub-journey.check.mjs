#!/usr/bin/env node
/**
 * Business Hub — real-Chrome journey against an isolated PostgreSQL database.
 *
 * Everything here is synthetic and disposable: the script refuses to run unless DATABASE_URL
 * names a local disposable database (jata_e2e / *_test), creates its own business, and deletes
 * every row it created afterwards. No request is sent to a deployment, and nothing is read from
 * production.
 *
 * It walks the capabilities the way they are used, in a real browser:
 *
 *   customer  public page → basket → order request → confirmation
 *   owner     Customers · Promotions · Loyalty · QR, through the dashboard navigation
 *   guards    another business's Customers page is refused
 *   layout    the public page at six viewports, each screenshot saved
 *
 * EXIT CODES
 *   0  every check passed
 *   1  at least one check failed
 *   2  BLOCKED — Chrome, the database or the secret is missing, or the URL names a real database
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import puppeteer from "puppeteer-core";
import { SignJWT } from "jose";

const require = createRequire(import.meta.url);
const SECRET = process.env.AUTH_SECRET ?? "";
const rawConnect = process.env.DATABASE_URL ?? "";
const chrome = process.env.CHROME_PATH ?? "";
const evidenceDir = path.resolve(process.env.BUSINESS_HUB_EVIDENCE_DIR ?? "artifacts/business-hub-journey");

function blocked(message) {
  console.log(`BLOCKED  ${message}`);
  process.exitCode = 2;
}

if (!SECRET || !rawConnect || !chrome) {
  blocked("AUTH_SECRET, DATABASE_URL and CHROME_PATH are required; this is not a passing check.");
} else {
  const databaseUrl = new URL(rawConnect);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(databaseUrl.hostname) || !/^\/(jata_e2e|hub_test|jata_test)(?:$|_)/.test(databaseUrl.pathname)) {
    blocked("refusing to run: DATABASE_URL must name a local disposable database (jata_e2e / hub_test / jata_test).");
  }
}

if (process.exitCode !== 2) {
  let prisma;
  let server;
  let browser;
  let baseUrl = "";
  let serverLog = "";
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const results = [];
  const viewportCases = [
    [320, 568],
    [360, 800],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1366, 768],
  ];
  let failed = 0;

  const created = {
    userId: null,
    businessId: null,
    otherUserId: null,
    otherBusinessId: null,
  };

  function check(name, ok, detail = "") {
    results.push({ name, status: ok ? "PASS" : "FAIL", detail });
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  }

  function makePrisma(connectionString) {
    const harness = process.env.PRISMA_WASM_HARNESS_DIR;
    if (harness) {
      const { PrismaClient } = require(path.join(harness, "generated", "wasm.js"));
      const { PrismaPg } = require(path.join(harness, "node_modules", "@prisma/adapter-pg"));
      const { Pool } = require(path.join(harness, "node_modules", "pg"));
      return new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) });
    }
    const { PrismaClient } = require("@prisma/client");
    return new PrismaClient({ datasourceUrl: connectionString });
  }

  async function freePort() {
    return new Promise((resolve, reject) => {
      const listener = net.createServer();
      listener.unref();
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => {
        const { port } = listener.address();
        listener.close(() => resolve(port));
      });
    });
  }

  async function waitForServer(timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (server?.exitCode !== null && server?.exitCode !== undefined) return false;
      try {
        const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
        if (response.status < 500) return true;
      } catch {
        /* still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  async function cookieFor(account) {
    const token = await new SignJWT({
      userId: account.id,
      email: account.email,
      role: account.role,
      name: account.name,
      sessionVersion: account.sessionVersion ?? 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30m")
      .sign(new TextEncoder().encode(SECRET));
    return { name: "jata_session", value: token, domain: "localhost", path: "/" };
  }

  /** Clicks the first button whose visible text matches. */
  async function clickByText(page, text) {
    const clicked = await page.evaluate((label) => {
      const target = [...document.querySelectorAll("button")].find((button) =>
        (button.textContent || "").trim().toLowerCase().includes(label.toLowerCase()),
      );
      if (!target) return false;
      target.click();
      return true;
    }, text);
    if (!clicked) throw new Error(`no button matching ${JSON.stringify(text)}`);
  }

  async function cleanup() {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => server.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    if (prisma) {
      for (const businessId of [created.businessId, created.otherBusinessId].filter(Boolean)) {
        await prisma.orderRequest.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.customerEnquiry.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.promotion.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.loyaltyRedemption.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.loyaltyStampEvent.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.loyaltyCard.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.loyaltyProgram.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.businessHubActivity.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.service.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.product.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.business.delete({ where: { id: businessId } }).catch(() => undefined);
      }
      for (const userId of [created.userId, created.otherUserId].filter(Boolean)) {
        await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      }
      await prisma.$disconnect().catch(() => {});
    }
  }

  try {
    prisma = makePrisma(process.env.PRISMA_TEST_DATABASE_URL || rawConnect);
    await prisma.$queryRaw`SELECT 1`;
    await mkdir(evidenceDir, { recursive: true });

    const port = await freePort();
    baseUrl = `http://localhost:${port}`;
    server = spawn(
      process.execPath,
      [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
      { env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stdout.on("data", (chunk) => {
      serverLog += chunk.toString();
    });
    server.stderr.on("data", (chunk) => {
      serverLog += chunk.toString();
    });
    if (!(await waitForServer())) {
      throw new Error(`production build did not start: ${serverLog.split("\n").filter(Boolean).slice(-5).join(" | ").slice(0, 400)}`);
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────
    const owner = await prisma.user.create({
      data: { email: `hub-owner-${runId}@example.test`, name: "Hub Owner", role: "CUSTOMER", sessionVersion: 0 },
    });
    created.userId = owner.id;

    const business = await prisma.business.create({
      data: {
        ownerId: owner.id,
        slug: `hub-journey-${runId}`,
        name: "Hub Journey Foods",
        category: "Food & Restaurant",
        description: "Disposable fixture for the Business Hub browser journey.",
        location: "Kilimani, Nairobi",
        phone: "0700000000",
        whatsapp: "0700000000",
        status: "ACTIVE",
        isPublished: true,
        theme: "clean",
      },
    });
    created.businessId = business.id;

    // The catalogue an ordinary Business Page has: services, plus one catalogue product.
    await prisma.service.create({
      data: {
        businessId: business.id,
        title: "Pilau Combo",
        description: "Disposable fixture",
        priceFrom: 650,
        priceLabel: "KES 650",
        pricingType: "FIXED",
        isActive: true,
        category: "Meals",
      },
    });
    await prisma.product.create({
      data: { businessId: business.id, name: "Chapati", basePriceKES: 100, stockStatus: "IN_STOCK", isActive: true },
    });
    await prisma.promotion.create({
      data: {
        businessId: business.id,
        title: "Lunch combo",
        body: "Disposable fixture promotion.",
        badge: "This week",
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
        isActive: true,
        ctaKind: "NONE",
      },
    });
    await prisma.loyaltyProgram.create({
      data: { businessId: business.id, isEnabled: true, stampGoal: 4, rewardDescription: "Free pilau combo" },
    });

    const otherOwner = await prisma.user.create({
      data: { email: `hub-other-${runId}@example.test`, name: "Other Owner", role: "CUSTOMER", sessionVersion: 0 },
    });
    created.otherUserId = otherOwner.id;
    const otherBusiness = await prisma.business.create({
      data: {
        ownerId: otherOwner.id,
        slug: `hub-other-${runId}`,
        name: "Other Business",
        category: "Retail & General Shop",
        status: "ACTIVE",
        isPublished: true,
        theme: "clean",
      },
    });
    created.otherBusinessId = otherBusiness.id;

    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const customerPage = await browser.newPage();
    const pageErrors = [];
    customerPage.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    await customerPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });

    // ── customer: the public page ──────────────────────────────────────────────────────────────
    const pageUrl = `${baseUrl}/b/${business.slug}`;
    const response = await customerPage.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    check("customer: the business page opens", response?.status() === 200, `HTTP ${response?.status()}`);

    let text = await customerPage.evaluate(() => document.body.innerText);
    check("customer: the page names the business", text.includes("Hub Journey Foods"));

    // B · the catalogue the page lists is requestable — the capability that was missing.
    check(
      "customer: the services the page lists can be added to a request",
      text.includes("Pilau Combo") && text.includes("Request an order"),
      text.includes("Request an order") ? "basket present" : "no order-request section rendered",
    );

    const addPilau = await customerPage.$(`[aria-label="Add one Pilau Combo"]`);
    check("customer: a quantity control exists for the service", Boolean(addPilau));
    if (addPilau) {
      await addPilau.click();
      await addPilau.click();
    }

    text = await customerPage.evaluate(() => document.body.innerText);
    check(
      "customer: the basket prices the selection from the business's own service row",
      /2 items · est\. KES 1,?300/.test(text),
      (text.match(/\d+ items? · est\.[^\n]*/) || ["no basket summary"])[0],
    );

    await clickByText(customerPage, "Review request");
    await customerPage.waitForSelector("#order-customer-name", { timeout: 10_000 });
    await customerPage.type("#order-customer-name", "Jane Wanjiku");
    await customerPage.type("#order-contact-value", "0712345678");
    await clickByText(customerPage, "Send request");

    await customerPage.waitForFunction(() => /JATA-REQ-\d{8}-/.test(document.body.innerText), { timeout: 30_000 });
    text = await customerPage.evaluate(() => document.body.innerText);
    const reference = (text.match(/JATA-REQ-\d{8}-[A-Z0-9]{6}/) || [null])[0];
    check("customer: submitting returns a request reference", Boolean(reference), reference ?? "none");
    check(
      "customer: the confirmation says no payment was taken and nothing is confirmed",
      /no payment/i.test(text) && /not a confirmed order|request, not a payment|confirms? the final price/i.test(text),
    );

    // D · loyalty is offered once the owner has enabled it.
    text = await customerPage.evaluate(() => document.body.innerText);
    check("customer: the loyalty card panel is offered", /loyalty/i.test(text));

    // C · the live promotion is on the page.
    check("customer: the live promotion is displayed", text.includes("Lunch combo"));

    // E · the QR block shows the canonical page URL.
    check("customer: the QR block shows this page's address", text.includes(`/b/${business.slug}`));

    check("customer: no uncaught page error", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

    await customerPage.screenshot({ path: path.join(evidenceDir, "customer-390-confirmation.png"), fullPage: true });

    // ── owner: the dashboard surfaces the same request ─────────────────────────────────────────
    const ownerPage = await browser.newPage();
    await ownerPage.setViewport({ width: 1366, height: 900 });
    await ownerPage.setCookie(await cookieFor(owner));

    const customersUrl = `${baseUrl}/dashboard/businesses/${business.id}/customers`;
    const customersResponse = await ownerPage.goto(customersUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    const ownerText = await ownerPage.evaluate(() => document.body.innerText);
    check("owner: the Customers hub opens", customersResponse?.status() === 200, `HTTP ${customersResponse?.status()}`);
    check("owner: the customer's request is on the board", Boolean(reference) && ownerText.includes(reference), reference ?? "");
    check(
      "owner: the hub navigation offers Customers, Promotions, Loyalty and QR",
      ["Customers", "Promotions", "Loyalty", "QR code"].every((label) => ownerText.includes(label)),
    );
    await ownerPage.screenshot({ path: path.join(evidenceDir, "owner-1366-customers.png"), fullPage: true });

    for (const [label, pathname, marker] of [
      ["Promotions", "promotions", "Lunch combo"],
      ["Loyalty", "loyalty", "Free pilau combo"],
      ["QR", "qr", `/b/${business.slug}`],
    ]) {
      const target = `${baseUrl}/dashboard/businesses/${business.id}/${pathname}`;
      const pageResponse = await ownerPage.goto(target, { waitUntil: "networkidle2", timeout: 60_000 });
      const body = await ownerPage.evaluate(() => document.body.innerText);
      check(
        `owner: the ${label} screen opens and shows its own content`,
        pageResponse?.status() === 200 && body.includes(marker),
        `HTTP ${pageResponse?.status()}${body.includes(marker) ? "" : ` — missing ${JSON.stringify(marker)}`}`,
      );
      await ownerPage.screenshot({ path: path.join(evidenceDir, `owner-1366-${pathname}.png`), fullPage: true });
    }

    // ── guards ────────────────────────────────────────────────────────────────────────────────
    const foreign = await ownerPage.goto(`${baseUrl}/dashboard/businesses/${otherBusiness.id}/customers`, {
      waitUntil: "networkidle2",
      timeout: 60_000,
    });
    const foreignText = await ownerPage.evaluate(() => document.body.innerText);
    check(
      "tenant isolation: another business's Customers screen is refused",
      foreign?.status() === 404 || foreign?.status() === 403 || /not found|not authorised|sign in/i.test(foreignText),
      `HTTP ${foreign?.status()}`,
    );

    const anonymous = await browser.newPage();
    const anonymousResponse = await anonymous.goto(customersUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    const anonymousText = await anonymous.evaluate(() => document.body.innerText);
    check(
      "authorization: the hub is not reachable without a session",
      anonymousResponse?.status() >= 400 || /sign in/i.test(anonymousText),
      `HTTP ${anonymousResponse?.status()}`,
    );
    await anonymous.close();

    // ── the QR download ───────────────────────────────────────────────────────────────────────
    const qrPng = await fetch(`${baseUrl}/api/business/${business.id}/qr?format=png`, {
      headers: { cookie: `jata_session=${(await cookieFor(owner)).value}` },
    });
    const pngBytes = new Uint8Array(await qrPng.arrayBuffer());
    check(
      "QR: the download is a real PNG",
      qrPng.status === 200 && Buffer.from(pngBytes.slice(1, 4)).toString("ascii") === "PNG" && pngBytes.length > 500,
      `HTTP ${qrPng.status}, ${pngBytes.length} bytes, ${qrPng.headers.get("content-type")}`,
    );
    const qrPoster = await fetch(`${baseUrl}/api/business/${otherBusiness.id}/qr?format=poster`, {
      headers: { cookie: `jata_session=${(await cookieFor(owner)).value}` },
    });
    check("QR: another business cannot download its QR", qrPoster.status === 403 || qrPoster.status === 404, `HTTP ${qrPoster.status}`);

    // ── six viewports ─────────────────────────────────────────────────────────────────────────
    for (const [width, height] of viewportCases) {
      await customerPage.setViewport({ width, height, deviceScaleFactor: 1 });
      await customerPage.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60_000 });
      const layout = await customerPage.evaluate(() => ({
        overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        basket: /Request an order/.test(document.body.innerText),
      }));
      check(`${width}×${height}: the page fits the viewport`, layout.overflow <= 1, `overflow ${layout.overflow}px`);
      check(`${width}×${height}: the order basket is reachable`, layout.basket);
      await customerPage.screenshot({ path: path.join(evidenceDir, `customer-${width}.png`), fullPage: false });
    }

    await writeFile(
      path.join(evidenceDir, "business-hub-journey.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          runId,
          business: { id: business.id, slug: business.slug, name: business.name },
          reference,
          checks: results,
          failures: failed,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    check(
      "the journey completed",
      false,
      String(error?.message ?? error).slice(0, 300) || serverLog.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300),
    );
  } finally {
    await cleanup().catch(() => undefined);
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}  ${results.length - failed}/${results.length} Business Hub browser checks passed`);
  if (process.exitCode !== 2) process.exitCode = failed === 0 ? 0 : 1;
}
