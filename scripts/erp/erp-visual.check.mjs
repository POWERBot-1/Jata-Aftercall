#!/usr/bin/env node
/**
 * ERP pages in a real browser at the six owner-mandated viewports.
 *
 * This is the evidence behind the visual review: real Chrome, real HTTP, real cookies, full-page
 * screenshots plus the measured layout facts that a human reviewer would otherwise have to eyeball
 * one image at a time — horizontal overflow, the widths of the primary containers, and whether the
 * navigation and page heading are actually visible.
 *
 * What it is NOT: a human visual review. It produces the images a person then reviews; the findings
 * written from those images live in docs/POS_ERP_PRO_VISUAL_REVIEW.md and name who looked and when.
 * No payment or messaging provider is contacted, nothing is sent, and the database is disposable.
 *
 * Usage (disposable database, a prior `npm run build`, and a Chrome binary):
 *   CHROME_PATH=/path/to/chrome AUTH_SECRET=... DATABASE_URL=postgresql://... \
 *     node scripts/erp/erp-visual.check.mjs
 *
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = BLOCKED (no Chrome, no database, or the server cannot start).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import path from "node:path";
import net from "node:net";
import puppeteer from "puppeteer-core";
import { SignJWT } from "jose";

const require = createRequire(import.meta.url);
const CHROME_PATH = process.env.CHROME_PATH ?? "";
const SECRET = process.env.AUTH_SECRET ?? "";
const rawConnect = process.env.DATABASE_URL ?? "";
const SHOT_DIR = process.env.SHOT_DIR ?? join(process.cwd(), ".cache", "verification", "erp-visual");

if (!CHROME_PATH) {
  console.log("BLOCKED  CHROME_PATH is not set; screenshots NOT TAKEN, not passed.");
  process.exit(2);
}
if (!SECRET || !rawConnect) {
  console.log("BLOCKED  AUTH_SECRET and DATABASE_URL are both required.");
  process.exit(2);
}

function makePrisma(connectionString) {
  const harness = process.env.PRISMA_WASM_HARNESS_DIR;
  if (harness) {
    const { PrismaClient } = require(path.join(harness, "generated", "wasm.js"));
    const { PrismaPg } = require(path.join(harness, "node_modules", "@prisma/adapter-pg"));
    const { Pool } = require(path.join(harness, "node_modules", "pg"));
    return { prisma: new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) }), engine: "wasm-query-engine+adapter-pg" };
  }
  const { PrismaClient } = require("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: connectionString }), engine: "native-query-engine" };
}

let prisma;
let engine;
try {
  ({ prisma, engine } = makePrisma(process.env.PRISMA_TEST_DATABASE_URL || rawConnect));
} catch (error) {
  console.log(`BLOCKED  the Prisma client could not be constructed: ${String(error?.message ?? error).split("\n")[0].slice(0, 300)}`);
  process.exit(2);
}

const VIEWPORTS = [
  { label: "320x568", width: 320, height: 568, mobile: true },
  { label: "360x800", width: 360, height: 800, mobile: true },
  { label: "390x844", width: 390, height: 844, mobile: true },
  { label: "430x932", width: 430, height: 932, mobile: true },
  { label: "768x1024", width: 768, height: 1024, mobile: false },
  { label: "1366x768", width: 1366, height: 768, mobile: false },
];

const ROUTES = [
  { slug: "workspace", path: "", marker: "POS / ERP - PRO" },
  { slug: "tasks", path: "/tasks", marker: "Tasks and work" },
  { slug: "requisitions", path: "/requisitions", marker: "Requisitions" },
  { slug: "procurement", path: "/procurement", marker: "Procurement" },
];

const runId = randomUUID().slice(0, 8);
const results = [];
let failed = 0;
let server = null;
let browser = null;
const ids = {};

const record = (ok, name, detail = "") => {
  results.push({ ok, name, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function cookieFor(user) {
  const token = await new SignJWT({ userId: user.id, email: user.email, role: "OWNER", name: user.name, sessionVersion: user.sessionVersion ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  return `jata_session=${token}`;
}

async function seed() {
  const owner = await prisma.user.create({ data: { email: `erpvisual-${runId}@example.test`, name: `Visual ${runId}`, passwordHash: "x" } });
  const business = await prisma.business.create({ data: { ownerId: owner.id, name: `Visual Check ${runId}`, slug: `visual-check-${runId}`, category: "retail", phone: "0700000000" } });
  await prisma.erpConfiguration.create({ data: { businessId: business.id, legalName: `Visual Check ${runId}` } });
  await prisma.erpSubscription.create({
    data: { businessId: business.id, userId: owner.id, planId: "plan-erp-pro-visual", planKey: "ERP_PRO", status: "ACTIVE", startAt: new Date(), expiresAt: new Date(Date.now() + 30 * 864e5) },
  });
  const supplier = await prisma.posSupplier.create({ data: { businessId: business.id, name: `Cement Traders ${runId}`, termsDays: 30 } });
  const product = await prisma.posProduct.create({
    data: { businessId: business.id, name: `Cement 50kg ${runId}`, unitKey: "bag", priceKES: 90_000, costKES: 75_000, trackInventory: true, kind: "PRODUCT" },
  });
  await prisma.erpTask.create({
    data: { businessId: business.id, title: `Renew fire certificate ${runId}`, status: "OPEN", priority: "URGENT", dueAt: new Date(Date.now() - 3 * 864e5), createdBy: owner.id },
  });
  await prisma.erpTask.create({
    data: { businessId: business.id, title: `Call the supplier about the cement quote ${runId}`, status: "IN_PROGRESS", priority: "HIGH", dueAt: new Date(Date.now() + 2 * 864e5), createdBy: owner.id, assignedTo: owner.id },
  });
  await prisma.erpRequisition.create({
    data: {
      businessId: business.id,
      requisitionNumber: `REQ-VIS-${runId}`,
      status: "SUBMITTED",
      title: `Bulk cement for the Kajiado site ${runId}`,
      justification: "Stock is below the reorder level for the fourth week and the site starts on Monday.",
      department: "Operations",
      priority: "HIGH",
      supplierId: supplier.id,
      supplierName: supplier.name,
      estimatedSubtotalCents: 3_000_000,
      estimatedTaxCents: 480_000,
      estimatedTotalCents: 3_480_000,
      requestedBy: owner.id,
      requestedName: `Visual ${runId}`,
      submittedAt: new Date(Date.now() - 3600_000),
      idempotencyKey: `visual-${runId}`,
      lines: {
        create: [{
          businessId: business.id,
          productId: product.id,
          description: "50 kg bag of cement",
          quantity: 40,
          estimatedUnitCostCents: 75_000,
          taxRateBps: 1600,
          lineSubtotalCents: 3_000_000,
          lineTaxCents: 480_000,
          sortOrder: 0,
        }],
      },
    },
  });
  const order = await prisma.erpPurchaseOrder.create({
    data: {
      businessId: business.id,
      orderNumber: `PO-VIS-${runId}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: "ORDERED",
      subtotalCents: 3_000_000,
      taxCents: 480_000,
      totalCents: 3_480_000,
      expectedAt: new Date(Date.now() + 3 * 864e5),
      requestedBy: owner.id,
      requestedName: `Visual ${runId}`,
      orderedAt: new Date(),
    },
  });
  await prisma.erpPurchaseOrderLine.create({
    data: { businessId: business.id, purchaseOrderId: order.id, productId: product.id, description: "50 kg bag of cement", quantity: 40, unitCostCents: 75_000, taxRateBps: 1600, lineSubtotalCents: 3_000_000, lineTaxCents: 480_000, sortOrder: 0 },
  });
  Object.assign(ids, { owner: owner.id, business: business.id });
  return { owner, business };
}

async function cleanup() {
  if (!ids.business) return;
  const businessId = ids.business;
  for (const model of ["erpRequisitionLine", "erpRequisition", "erpPurchaseOrderLine", "erpPurchaseOrder", "erpTask", "erpNotification", "erpAuditEvent", "erpSequence", "erpSubscription", "erpEntitlement", "erpConfiguration", "posProduct", "posSupplier"]) {
    await prisma[model].deleteMany({ where: { businessId } }).catch(() => null);
  }
  await prisma.businessMember.deleteMany({ where: { businessId } }).catch(() => null);
  await prisma.business.delete({ where: { id: businessId } }).catch(() => null);
  if (ids.owner) await prisma.user.delete({ where: { id: ids.owner } }).catch(() => null);
}

async function waitForServer(base, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) return false;
    try {
      const response = await fetch(`${base}/login`, { redirect: "manual" });
      if (response.status < 500) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

let exitCode = 1;
try {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch (error) {
    console.log(`BLOCKED  cannot reach the database: ${String(error?.message ?? error).slice(0, 200)}`);
    exitCode = 2;
    throw new Error("__blocked__");
  }

  mkdirSync(SHOT_DIR, { recursive: true });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ERP_PRO_ENABLED: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!(await waitForServer(base))) {
    console.log("BLOCKED  the production build did not start; screenshots NOT TAKEN.");
    exitCode = 2;
    throw new Error("__blocked__");
  }

  const { owner, business } = await seed();
  const cookie = await cookieFor(owner);
  const cookieName = "jata_session";
  const cookieValue = cookie.split("=")[1];

  browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const version = await browser.version();
  console.log(`Browser ${version}; engine ${engine}; ${VIEWPORTS.length} viewports x ${ROUTES.length} routes.`);

  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setViewport({ width: viewport.width, height: viewport.height, isMobile: viewport.mobile, hasTouch: viewport.mobile, deviceScaleFactor: 1 });
    await page.setCookie({ name: cookieName, value: cookieValue, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" });
    for (const route of ROUTES) {
      const url = `${base}/dashboard/erp/${business.id}${route.path}`;
      const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
      const status = response?.status() ?? 0;
      // Give fonts and the sticky header a moment, then measure. Measurement happens after layout
      // has settled, which is the same precondition the storefront check needed (E13).
      await new Promise((resolve) => setTimeout(resolve, 350));
      const facts = await page.evaluate(() => {
        const root = document.documentElement;
        const main = document.querySelector("main") ?? document.body;
        const heading = document.querySelector("h1");
        const nav = document.querySelector(".erp-sidebar, .erp-mobilebar, nav");
        const overflowing = [...document.querySelectorAll("body *")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.right > root.clientWidth + 1;
          })
          .slice(0, 5)
          .map((element) => `${element.tagName.toLowerCase()}.${String(element.className || "").split(" ").filter(Boolean).slice(0, 2).join(".")}`);
        return {
          overflow: root.scrollWidth - root.clientWidth,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          heading: heading?.textContent?.slice(0, 80) ?? null,
          headingVisible: Boolean(heading && heading.getBoundingClientRect().width > 0),
          mainWidth: Math.round(main.getBoundingClientRect().width),
          navVisible: Boolean(nav && nav.getBoundingClientRect().width > 0),
          offenders: overflowing,
        };
      });
      const file = join(SHOT_DIR, `${viewport.label}__${route.slug}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 72, fullPage: true });
      const okStatus = status === 200;
      const okHeading = facts.headingVisible && (facts.heading ?? "").length > 2;
      const okOverflow = facts.overflow <= 0;
      const okMarker = await page.evaluate((marker) => document.body.innerText.includes(marker), route.marker);
      record(
        okStatus && okHeading && okOverflow && okMarker,
        `${viewport.label} ${route.slug} renders without overflow`,
        `HTTP ${status}, overflow=${facts.overflow}px, main=${facts.mainWidth}px, nav=${facts.navVisible}, heading=${JSON.stringify(facts.heading)}${facts.offenders.length ? `, offenders=${facts.offenders.join(",")}` : ""}`,
      );
    }
    await page.close();
  }
  exitCode = failed ? 1 : 0;
} catch (error) {
  if (String(error?.message) !== "__blocked__") {
    console.log(`ERROR  ${String(error?.message ?? error).slice(0, 400)}`);
    exitCode = 1;
  }
} finally {
  writeFileSync(
    join(SHOT_DIR, "evidence.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), engine, chrome: browser ? await browser.version().catch(() => "unknown") : "not-launched", viewports: VIEWPORTS.map((v) => v.label), routes: ROUTES.map((r) => r.slug), results }, null, 2),
  );
  writeFileSync(join(SHOT_DIR, "summary.log"), results.map((row) => `${row.ok ? "PASS" : "FAIL"} ${row.name}${row.detail ? ` — ${row.detail}` : ""}`).join("\n") + "\n");
  if (browser) await browser.close().catch(() => null);
  await cleanup();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await prisma.$disconnect().catch(() => null);
  const passed = results.filter((row) => row.ok).length;
  console.log(`\nRESULT: ${exitCode === 2 ? "BLOCKED" : failed ? "FAIL" : "PASS"} (${passed}/${results.length} captures) — images in ${SHOT_DIR}`);
  process.exit(exitCode);
}
