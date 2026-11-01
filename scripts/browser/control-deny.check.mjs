#!/usr/bin/env node
/**
 * Real authenticated Control deny-path journey against an isolated PostgreSQL database.
 *
 * This deliberately does not provision a ControlRoleGrant or enable policy. It proves that a valid
 * ordinary synthetic session sees only the pending-policy shell, that protected HTTP reads and a
 * valid business-status mutation are refused, and that refusal neither mutates the disposable
 * business nor writes a misleading success audit event. Screenshots are of this denial state only;
 * they are not evidence of an enabled Control console or six-role positive authorization.
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
const evidenceDir = path.resolve(process.env.CONTROL_EVIDENCE_DIR ?? "artifacts/control-denial");

function blocked(message) {
  console.log(`BLOCKED  ${message}`);
  process.exitCode = 2;
}

if (!SECRET || !rawConnect || !chrome) {
  blocked("AUTH_SECRET, DATABASE_URL and CHROME_PATH are required; this is not a passing check.");
} else {
  const databaseUrl = new URL(rawConnect);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(databaseUrl.hostname) || !/^\/(jata_e2e|control_test)(?:$|_)/.test(databaseUrl.pathname)) {
    blocked("refusing to run: DATABASE_URL must name a local disposable jata_e2e/control_test database.");
  }
}

if (process.exitCode !== 2) {
  let prisma;
  let server;
  let browser;
  let user;
  let business;
  let baseUrl = "";
  let serverLog = "";
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const results = [];
  const viewportCases = [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1366, 768]];
  let failed = 0;
  let grantsBefore = 0;
  let auditBefore = 0;

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
      } catch { /* start still in progress */ }
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
    }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("15m")
      .sign(new TextEncoder().encode(SECRET));
    return `jata_session=${token}`;
  }

  async function request(pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, { redirect: "manual", ...options });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* HTML/error text is intentionally not copied to evidence. */ }
    return { status: response.status, body };
  }

  async function cleanup() {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => server.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    if (browser) await browser.close().catch(() => {});
    if (prisma) {
      // No Control grants are created. In an unexpected success/audit regression, preserve the audit
      // row rather than deleting append-only evidence; report cleanup failure as a failing check.
      if (business) await prisma.business.delete({ where: { id: business.id } }).catch((error) => {
        check("disposable business fixture cleanup", false, String(error?.message ?? error).slice(0, 160));
      });
      if (user) await prisma.user.delete({ where: { id: user.id } }).catch((error) => {
        check("synthetic identity cleanup", false, String(error?.message ?? error).slice(0, 160));
      });
      await prisma.$disconnect().catch(() => {});
    }
  }

  try {
    prisma = makePrisma(process.env.PRISMA_TEST_DATABASE_URL || rawConnect);
    await prisma.$queryRaw`SELECT 1`;
    await mkdir(evidenceDir, { recursive: true });

    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
      env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
    server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });
    if (!await waitForServer()) throw new Error(`production build did not start: ${serverLog.split("\n").filter(Boolean).slice(-5).join(" | ").slice(0, 500)}`);

    user = await prisma.user.create({
      data: {
        email: `control-deny-${runId}@example.test`,
        name: `Control deny fixture ${runId}`,
        passwordHash: `synthetic-unusable-${runId}`,
      },
    });
    business = await prisma.business.create({
      data: {
        ownerId: user.id,
        slug: `control-deny-${runId}`,
        name: `Synthetic Control Denial ${runId}`,
        category: "TEST_FIXTURE",
        status: "PENDING",
        isPublished: false,
      },
    });
    grantsBefore = await prisma.controlRoleGrant.count({ where: { userId: user.id } });
    auditBefore = await prisma.controlAuditEvent.count({ where: { actorId: user.id } });
    const cookie = await cookieFor(user);

    const anonymous = await request("/api/control/overview");
    check("anonymous protected API is denied", anonymous.status === 401, `HTTP ${anonymous.status}`);

    for (const pathname of ["/api/control/overview", "/api/control/businesses"]) {
      const result = await request(pathname, { headers: { cookie } });
      check(`authenticated ${pathname} remains policy-pending`, result.status === 403 && result.body?.code === "POLICY_PENDING", `HTTP ${result.status}; code=${result.body?.code ?? "none"}`);
    }

    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
    for (const [width, height] of viewportCases) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.setCookie({ name: "jata_session", value: cookie.slice("jata_session=".length), url: baseUrl, httpOnly: true, sameSite: "Lax" });
      const consoleErrors = [];
      page.on("pageerror", (error) => consoleErrors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push("console.error"); });
      const response = await page.goto(`${baseUrl}/control`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForFunction(() => document.body.innerText.includes("Control access pending owner policy"), { timeout: 15_000 });
      const state = await page.evaluate(() => ({
        text: document.body.innerText,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      }));
      const correctPending = response?.status() === 200
        && state.heading === "Control access pending owner policy"
        && state.text.includes("No operational data or administrative action is available.")
        && !state.text.includes(`Synthetic Control Denial ${runId}`)
        && !state.text.includes("ControlConsole");
      const noHorizontalOverflow = state.documentWidth <= state.viewportWidth;
      check(`authenticated /control pending state ${width}x${height}`, correctPending && noHorizontalOverflow && consoleErrors.length === 0,
        `HTTP ${response?.status()}; content=${correctPending}; noHorizontalOverflow=${noHorizontalOverflow}; pageErrors=${consoleErrors.length}`);
      if (width === 320) {
        // Use the authenticated browser origin for the state-changing API call so its Origin header
        // is generated by Chromium and the route's same-origin protection is tested as a real journey.
        const patch = await page.evaluate(async (businessId) => {
          const result = await fetch("/api/control/businesses", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              businessId,
              status: "SUSPENDED",
              confirmation: "SUSPEND",
              reason: "Disposable policy-denial acceptance fixture.",
            }),
          });
          return { status: result.status, body: await result.json() };
        }, business.id);
        const patchError = typeof patch.body?.error === "string" ? patch.body.error.slice(0, 120) : "none";
        check("valid same-origin business suspension is explicitly denied by pending policy", patch.status === 403 && patch.body?.code === "POLICY_PENDING", `HTTP ${patch.status}; code=${patch.body?.code ?? "none"}; error=${patchError}`);

        const persistedBusiness = await prisma.business.findUnique({ where: { id: business.id }, select: { status: true, isPublished: true } });
        check("denied mutation leaves disposable business unchanged", persistedBusiness?.status === "PENDING" && persistedBusiness?.isPublished === false, `status=${persistedBusiness?.status ?? "missing"}`);
        const grantsAfter = await prisma.controlRoleGrant.count({ where: { userId: user.id } });
        check("journey provisions no Control grant", grantsBefore === 0 && grantsAfter === 0, `before=${grantsBefore}; after=${grantsAfter}`);
        const auditAfterApi = await prisma.controlAuditEvent.count({ where: { actorId: user.id } });
        check("denied API action emits no misleading success audit event", auditAfterApi === auditBefore, `before=${auditBefore}; after=${auditAfterApi}`);
      }
      await page.screenshot({ path: path.join(evidenceDir, `control-pending-${width}x${height}.png`), fullPage: true });
      await page.close();
    }

    const finalAuditCount = await prisma.controlAuditEvent.count({ where: { actorId: user.id } });
    check("no application success audit event persisted for denied journey", finalAuditCount === auditBefore, `before=${auditBefore}; after=${finalAuditCount}`);
  } catch (error) {
    check("real authenticated Control deny-path journey completed", false, String(error?.stack ?? error).split("\n").slice(0, 4).join(" ").slice(0, 500));
  } finally {
    await cleanup();
  }

  try {
    await mkdir(evidenceDir, { recursive: true });
    const evidence = {
      result: failed === 0 ? "PASS" : "FAIL",
      testCommit: process.env.GITHUB_SHA ?? "local-uncommitted",
      generatedAt: new Date().toISOString(),
      environment: "disposable local PostgreSQL; synthetic ordinary session; no Control grant; no production credentials/data",
      policy: "CONTROL_ROLE_POLICY_APPROVED=false; no role/capability ALLOW cells",
      checks: results,
      viewports: viewportCases.map(([width, height]) => `${width}x${height}`),
      limitations: [
        "Screenshots depict the authenticated pending-policy denial shell, not the enabled Control console.",
        "No Control grants, positive authorization, six-role role-specific session, MFA-positive path, grant expiry or production data were exercised.",
      ],
    };
    await writeFile(path.join(evidenceDir, "control-deny-journey.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    check("sanitized evidence artifact written", false, String(error?.message ?? error).slice(0, 200));
  }
  if (failed) process.exitCode = 1;
  if (process.exitCode !== 2) console.log(`CONTROL DENIAL RESULT ${failed === 0 ? "PASS" : "FAIL"} (${results.filter((r) => r.status === "PASS").length} passed, ${failed} failed)`);
}
