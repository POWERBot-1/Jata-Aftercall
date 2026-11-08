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
 *   customer  public page → basket → order request → confirmation → points wallet → redeem
 *   owner     Customers · Promotions · Loyalty · Points · QR, through the dashboard navigation
 *   owner     points: record a verified purchase for a customer and watch the wallet update
 *   guards    another business's Customers page is refused
 *   layout    the public page at six viewports, and the points dashboard at the same six
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
    if (!ok) {
      // A failing check is also raised as an Actions annotation. The runner log is not always
      // retrievable after the fact, and a browser journey that only prints to stdout is a journey
      // nobody can audit from the checks API.
      const message = `${name}${detail ? ` — ${detail}` : ""}`
        .replace(/%/g, "%25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");
      console.log(`::error::${message}`);
    }
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
        // Loyalty 2.0 rows: children before parents, so the cascades never leave debris behind.
        await prisma.loyaltyRewardRedemption.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.loyaltyPointsLedger.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.loyaltyPointsAccount.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.loyaltyReward.deleteMany({ where: { businessId } }).catch(() => undefined);
        await prisma.loyaltyPointsEligibleItem
          .deleteMany({ where: { programme: { businessId } } })
          .catch(() => undefined);
        await prisma.loyaltyPointsProgramme.deleteMany({ where: { businessId } }).catch(() => undefined);
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
      data: {
        email: `hub-owner-${runId}@example.test`,
        name: "Hub Owner",
        role: "CUSTOMER",
        passwordHash: `synthetic-unusable-${runId}`,
        sessionVersion: 0,
      },
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
    const stampProgram = await prisma.loyaltyProgram.create({
      data: { businessId: business.id, isEnabled: true, stampGoal: 4, rewardDescription: "Free pilau combo" },
    });

    // ── Loyalty 2.0 fixtures ──────────────────────────────────────────────────────────────────
    // A SECOND programme beside the stamp card above: its own configuration, its own wallet, its
    // own ledger. It is created ACTIVE here because the browser journey is about the screens an
    // owner sees after switching points on — the "off by default" path is covered by the unit
    // suite. The wallet starts at zero: the points below are earned through the owner's own screen.
    const pointsProgramme = await prisma.loyaltyPointsProgramme.create({
      data: {
        businessId: business.id,
        isActive: true,
        kesPerPoint: 100,
        pointsPerUnit: 1,
        description: "Earn while you eat.",
        terms: "Points are added after we verify your purchase.",
        redemptionRules: "Collect in store.",
      },
    });
    const pointsReward = await prisma.loyaltyReward.create({
      data: {
        businessId: business.id,
        programmeId: pointsProgramme.id,
        title: "Free pilau combo",
        kind: "FIXED_POINTS",
        pointsCost: 10,
        isActive: true,
      },
    });
    // Dearer than the wallet will hold after the redemption below, so the browser can prove the
    // insufficient-balance guard rather than only the happy path.
    const pointsRewardTooDear = await prisma.loyaltyReward.create({
      data: {
        businessId: business.id,
        programmeId: pointsProgramme.id,
        title: "Free dessert platter",
        kind: "FIXED_POINTS",
        pointsCost: 5,
        isActive: true,
      },
    });
    const pointsCard = await prisma.loyaltyCard.create({
      data: {
        businessId: business.id,
        programId: stampProgram.id,
        code: `HUBPTS${runId.slice(0, 6).toUpperCase()}`,
        customerName: "Jane Wanjiku",
        contactMethod: "PHONE",
        contactValue: "0712345678",
        status: "ACTIVE",
      },
    });

    const otherOwner = await prisma.user.create({
      data: {
        email: `hub-other-${runId}@example.test`,
        name: "Other Owner",
        role: "CUSTOMER",
        passwordHash: `synthetic-unusable-${runId}`,
        sessionVersion: 0,
      },
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

    // A card issued by the OTHER business. The public page must refuse it: one business's page can
    // never open another business's wallet. Synthetic and disposable, like everything else here.
    const otherStampProgram = await prisma.loyaltyProgram.create({
      data: { businessId: otherBusiness.id, isEnabled: true, stampGoal: 4, rewardDescription: "Other reward" },
    });
    const foreignCard = await prisma.loyaltyCard.create({
      data: {
        businessId: otherBusiness.id,
        programId: otherStampProgram.id,
        code: `HUBX${runId.slice(0, 6).toUpperCase()}`,
        customerName: "Foreign Fixture Card",
        contactMethod: "PHONE",
        contactValue: "0700000009",
        status: "ACTIVE",
      },
    });

    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      protocolTimeout: 180_000,
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
    // `innerText` returns the rendered text, and the section titles are uppercased by CSS, so
    // these are matched without case.
    check(
      "customer: the services the page lists can be added to a request",
      /pilau combo/i.test(text) && /request an order/i.test(text),
      /request an order/i.test(text) ? "basket present" : "no order-request section rendered",
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
      // The Loyalty screen keeps its reward text in a form field, which `innerText` never carries,
      // so that one is read out of the input itself.
      ["Loyalty", "loyalty", "Free pilau combo"],
      ["QR", "qr", `/b/${business.slug}`],
    ]) {
      const target = `${baseUrl}/dashboard/businesses/${business.id}/${pathname}`;
      const pageResponse = await ownerPage.goto(target, { waitUntil: "networkidle2", timeout: 60_000 });
      const body = await ownerPage.evaluate(
        () =>
          `${document.body.innerText}\n${[...document.querySelectorAll("input")].map((input) => input.value).join("\n")}`,
      );
      check(
        `owner: the ${label} screen opens and shows its own content`,
        pageResponse?.status() === 200 && body.includes(marker),
        `HTTP ${pageResponse?.status()}${body.includes(marker) ? "" : ` — missing ${JSON.stringify(marker)}`}`,
      );
      await ownerPage.screenshot({ path: path.join(evidenceDir, `owner-1366-${pathname}.png`), fullPage: true });
    }

    // ── owner: the points programme (Loyalty 2.0) ─────────────────────────────────────────────
    // Awarded through the owner's own screen, so the browser exercises the real route, the real
    // validation and the real ledger — not a row this script inserted.
    const pointsUrl = `${baseUrl}/dashboard/businesses/${business.id}/loyalty/points`;
    const pointsResponse = await ownerPage.goto(pointsUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    let pointsText = await ownerPage.evaluate(
      () =>
        `${document.body.innerText}\n${[...document.querySelectorAll("input")].map((input) => input.value).join("\n")}`,
    );
    check("owner: the Points screen opens", pointsResponse?.status() === 200, `HTTP ${pointsResponse?.status()}`);
    check(
      "owner: the Points screen says the programme is live and names its rate",
      /points are live/i.test(pointsText) && /kes 100/i.test(pointsText),
    );
    check(
      "owner: the reward catalogue is managed here",
      pointsText.includes("Free pilau combo") && /reward catalogue/i.test(pointsText),
    );
    check(
      "owner: the points dashboard keeps the stamp card's own tab",
      /stamp card/i.test(pointsText) || /loyalty/i.test(pointsText),
    );

    await clickByText(ownerPage, "Record a purchase");
    await ownerPage.waitForSelector('[id^="earn-amount-"]', { timeout: 10_000 });
    await ownerPage.type('[id^="earn-amount-"]', "1200");
    await ownerPage.type('[id^="earn-ref-"]', "JATA-BROWSER-1");
    await clickByText(ownerPage, "Award points");
    await ownerPage.waitForFunction(() => /points awarded|already recorded|switched off/i.test(document.body.innerText), {
      timeout: 30_000,
    });
    pointsText = await ownerPage.evaluate(() => document.body.innerText);

    const accountAfterAward = await prisma.loyaltyPointsAccount.findUnique({ where: { cardId: pointsCard.id } });
    check(
      "owner: recording a verified purchase awards the configured rate (KES 1,200 → 12 points)",
      accountAfterAward?.availablePoints === 12,
      `wallet holds ${accountAfterAward?.availablePoints ?? "no wallet"}`,
    );
    check(
      "owner: the award is written to the ledger as an owner-verified earning",
      (await prisma.loyaltyPointsLedger.count({ where: { businessId: business.id, type: "EARNED" } })) === 1,
    );

    // A second award with the same reference must not mint points twice. The form closes after
    // each award, so the row is reopened first.
    await clickByText(ownerPage, "Record a purchase");
    await ownerPage.waitForSelector('[id^="earn-amount-"]', { timeout: 10_000 });
    await ownerPage.type('[id^="earn-amount-"]', "1200");
    await ownerPage.type('[id^="earn-ref-"]', "JATA-BROWSER-1");
    await clickByText(ownerPage, "Award points");
    await ownerPage.waitForFunction(() => /already recorded|points awarded/i.test(document.body.innerText), {
      timeout: 30_000,
    });
    const accountAfterReplay = await prisma.loyaltyPointsAccount.findUnique({ where: { cardId: pointsCard.id } });
    check(
      "owner: replaying the same purchase reference awards nothing a second time",
      accountAfterReplay?.availablePoints === 12,
      `wallet holds ${accountAfterReplay?.availablePoints ?? "no wallet"}`,
    );
    await ownerPage.screenshot({ path: path.join(evidenceDir, "owner-1366-loyalty-points.png"), fullPage: true });

    // ── customer: the points wallet, in a real browser ─────────────────────────────────────────
    const walletContext = await browser.createBrowserContext();
    const walletPage = await walletContext.newPage();
    const walletErrors = [];
    walletPage.on("pageerror", (error) => walletErrors.push(String(error?.message ?? error)));
    await walletPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    // Prove the points entry point is independent: turn off the synthetic stamp programme before
    // loading the public page. No production or customer data is involved in this fixture.
    await prisma.loyaltyProgram.update({ where: { id: stampProgram.id }, data: { isEnabled: false } });
    await walletPage.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    const independentSections = await walletPage.evaluate(() => ({
      points: Boolean(document.querySelector("#points-rewards")),
      stamps: Boolean(document.querySelector("#loyalty")),
    }));
    check("customer: Points & rewards remains visible when stamp cards are off", independentSections.points);
    check("customer: the stamp-card section is independently hidden", !independentSections.stamps);
    await walletPage.type("#points-card-code", pointsCard.code);
    await clickByText(walletPage, "View points");
    await walletPage.waitForFunction(() => /points wallet/i.test(document.body.innerText), { timeout: 30_000 });
    let walletText = await walletPage.evaluate(() => document.body.innerText);

    check("customer: the points wallet opens from the loyalty card code", /points wallet/i.test(walletText));
    check(
      "customer: the balance is shown separately from the stamp progress",
      /available points/i.test(walletText) && /12/.test(walletText) && /stamps?/i.test(walletText),
    );
    check(
      "customer: the wallet explains how points are earned",
      /how you earn/i.test(walletText) && /kes 100/i.test(walletText),
    );
    check("customer: the reward the business published is offered", /free pilau combo/i.test(walletText));
    check(
      "customer: the wallet never shows the card's contact details",
      !walletText.includes("0712345678"),
    );
    await walletPage.screenshot({ path: path.join(evidenceDir, "customer-390-points-wallet.png"), fullPage: true });

    // That reward's own button, not the first "Redeem" on the page: the wallet orders its rewards,
    // so matching on the label alone picks whichever comes first and silently redeems that one.
    await walletPage.waitForSelector(`[data-reward-id="${pointsReward.id}"]`, { timeout: 30_000 });
    await walletPage.click(`[data-reward-id="${pointsReward.id}"]`);
    await walletPage.waitForFunction(() => /JATA-RWD-\d{8}-/.test(document.body.innerText), { timeout: 30_000 });
    walletText = await walletPage.evaluate(() => document.body.innerText);
    const redemptionReference = (walletText.match(/JATA-RWD-\d{8}-[A-Z0-9]{6}/) || [null])[0];
    check("customer: redeeming returns a redemption reference", Boolean(redemptionReference), redemptionReference ?? "none");
    check(
      "customer: the confirmation says no money moved",
      /show the business your redemption reference|collect/i.test(walletText) && !/cash out|paid out|bank transfer|money sent/i.test(walletText),
    );
    const accountAfterRedeem = await prisma.loyaltyPointsAccount.findUnique({ where: { cardId: pointsCard.id } });
    check(
      "customer: redeeming deducts the reward's cost exactly once (12 − 10 = 2)",
      accountAfterRedeem?.availablePoints === 2,
      `wallet holds ${accountAfterRedeem?.availablePoints ?? "no wallet"}`,
    );
    const tooDear = await walletPage.$(
      `[data-reward-id="${pointsRewardTooDear.id}"][data-affordable="no"][disabled]`,
    );
    check(
      "customer: a reward the balance cannot cover is disabled, not silently spendable",
      Boolean(tooDear),
      tooDear ? "the button is disabled" : "the button was clickable",
    );
    check(
      "customer: the wallet says how many points are short instead of hinting at money",
      /need 3 more/i.test(walletText) && !/cash out|paid out|bank transfer|money sent/i.test(walletText),
    );
    const accountAfterRefusal = await prisma.loyaltyPointsAccount.findUnique({ where: { cardId: pointsCard.id } });
    check(
      "customer: the refused reward costs nothing (the balance is unchanged)",
      accountAfterRefusal?.availablePoints === 2,
      `wallet holds ${accountAfterRefusal?.availablePoints ?? "no wallet"}`,
    );
    // ── the same entry point, when the code is wrong, foreign, or typed badly ───────────────────
    await clickByText(walletPage, "Check another card");
    await walletPage.waitForSelector("#points-card-code", { timeout: 10_000 });
    check("customer: checking another card returns to the code form", true, "the form is back");

    await walletPage.type("#points-card-code", "NOT-A-REAL-CODE");
    await clickByText(walletPage, "View points");
    await walletPage.waitForFunction(() => /couldn't find that loyalty card/i.test(document.body.innerText), {
      timeout: 30_000,
    });
    const unknownCodeText = await walletPage.evaluate(() => document.body.innerText);
    check(
      "customer: an unknown card code says so, instead of leaving an empty wallet",
      /couldn't find that loyalty card/i.test(unknownCodeText) && !/available points/i.test(unknownCodeText),
      "no balance is shown for a code that does not exist",
    );

    await clickByText(walletPage, "Check another card");
    await walletPage.waitForSelector("#points-card-code", { timeout: 10_000 });
    await walletPage.type("#points-card-code", foreignCard.code);
    await clickByText(walletPage, "View points");
    await walletPage.waitForFunction(() => /couldn't find that loyalty card/i.test(document.body.innerText), {
      timeout: 30_000,
    });
    const foreignCodeText = await walletPage.evaluate(() => document.body.innerText);
    check(
      "customer: another business's card code is refused on this page",
      /couldn't find that loyalty card/i.test(foreignCodeText) &&
        !/Other Business/.test(foreignCodeText) &&
        !/available points/i.test(foreignCodeText),
      "the refusal names no other business and shows no balance",
    );

    // The same code typed the way a person types it — lower case, with spaces. It has to resolve to
    // the one row the business issued.
    await clickByText(walletPage, "Check another card");
    await walletPage.waitForSelector("#points-card-code", { timeout: 10_000 });
    await walletPage.type("#points-card-code", ` ${pointsCard.code.toLowerCase().split("").join(" ")} `);
    await clickByText(walletPage, "View points");
    await walletPage.waitForFunction(() => /points wallet/i.test(document.body.innerText), { timeout: 30_000 });
    const normalisedText = await walletPage.evaluate(() => document.body.innerText);
    check(
      "customer: a code typed lower-case with spaces still opens the wallet",
      /points wallet/i.test(normalisedText) && /available points/i.test(normalisedText),
      "the code is normalised before the lookup",
    );
    check(
      "customer: the refused foreign code left this wallet untouched (2 points)",
      (await prisma.loyaltyPointsAccount.findUnique({ where: { cardId: pointsCard.id } }))?.availablePoints === 2,
      `wallet holds ${(await prisma.loyaltyPointsAccount.findUnique({ where: { cardId: pointsCard.id } }))?.availablePoints ?? "no wallet"}`,
    );

    check("customer: no uncaught page error in the wallet", walletErrors.length === 0, walletErrors.slice(0, 2).join(" | "));
    await walletPage.screenshot({ path: path.join(evidenceDir, "customer-390-points-redeemed.png"), fullPage: true });
    await walletContext.close();

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

    // A separate browser context, so no cookie from the owner's page can travel with the request.
    const anonymousContext = await browser.createBrowserContext();
    const anonymous = await anonymousContext.newPage();
    const anonymousResponse = await anonymous.goto(customersUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    const anonymousText = await anonymous.evaluate(() => document.body.innerText);
    const anonymousUrl = anonymous.url();
    check(
      "authorization: the hub is not reachable without a session",
      anonymousResponse?.status() >= 400 ||
        !anonymousUrl.includes("/customers") ||
        (/sign in/i.test(anonymousText) && !anonymousText.includes("Hub Journey Foods")),
      `HTTP ${anonymousResponse?.status()}, landed on ${anonymousUrl.replace(baseUrl, "")}`,
    );
    await anonymousContext.close();

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
      const viewportContext = await browser.createBrowserContext();
      const viewportPage = await viewportContext.newPage();
      await viewportPage.setViewport({ width, height, deviceScaleFactor: 1 });
      await viewportPage.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60_000 });
      const layout = await viewportPage.evaluate(() => ({
        overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        basket: /request an order/i.test(document.body.innerText),
        seen: document.body.innerText.replace(/\s+/g, " ").slice(0, 110),
      }));
      check(`${width}×${height}: the page fits the viewport`, layout.overflow <= 1, `overflow ${layout.overflow}px`);
      check(`${width}×${height}: the order basket is reachable`, layout.basket, layout.seen);
      await viewportPage.screenshot({ path: path.join(evidenceDir, `customer-${width}.png`), fullPage: false });
      await viewportContext.close();
    }

    // The points dashboard at the same six widths: it is an owner screen with a long form, so the
    // layout is checked in a real browser rather than asserted from the markup.
    for (const [width, height] of viewportCases) {
      const pointsViewportContext = await browser.createBrowserContext();
      const pointsViewportPage = await pointsViewportContext.newPage();
      await pointsViewportPage.setViewport({ width, height, deviceScaleFactor: 1 });
      await pointsViewportPage.setCookie(await cookieFor(owner));
      await pointsViewportPage.goto(pointsUrl, { waitUntil: "networkidle2", timeout: 60_000 });
      const layout = await pointsViewportPage.evaluate(() => ({
        overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        settings: /points settings/i.test(document.body.innerText),
      }));
      check(`${width}×${height}: the points dashboard fits the viewport`, layout.overflow <= 1, `overflow ${layout.overflow}px`);
      check(`${width}×${height}: the points settings are reachable`, layout.settings);
      await pointsViewportPage.screenshot({ path: path.join(evidenceDir, `owner-${width}-loyalty-points.png`), fullPage: false });
      await pointsViewportContext.close();
    }

    await writeFile(
      path.join(evidenceDir, "business-hub-journey.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          runId,
          business: { id: business.id, slug: business.slug, name: business.name },
          reference,
          points: {
            cardCode: pointsCard.code,
            redemptionReference,
            availableAfterAward: accountAfterAward?.availablePoints ?? null,
            availableAfterRedeem: accountAfterRedeem?.availablePoints ?? null,
          },
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
