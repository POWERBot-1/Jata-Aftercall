#!/usr/bin/env node
/** Real-browser, real-PostgreSQL own-agent referral pagination check.
 * Uses synthetic consented attribution rows in the disposable jata_e2e database only.
 * 2,501 rows cross the 2,500-row API page boundary while remaining below the 5,000-row
 * report safety limit. No payments or messages are created.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const dbUrl = new URL(process.env.DATABASE_URL || "http://invalid");
const base = new URL(process.env.BASE_URL || "http://invalid");
const loopback = ["localhost", "127.0.0.1", "[::1]"];
if (process.env.AGENT_BROWSER_ISOLATED !== "1" || !process.env.CHROME_PATH ||
    !["postgres:", "postgresql:"].includes(dbUrl.protocol) || !loopback.includes(dbUrl.hostname) ||
    dbUrl.pathname !== "/jata_e2e" || base.protocol !== "http:" || !loopback.includes(base.hostname) ||
    base.username || base.password || base.port !== "4110") {
  throw new Error("BLOCKED: requires the dedicated loopback jata_e2e database, isolated browser flag and local port 4110");
}

const output = path.resolve("artifacts/agent-referral-revision");
await mkdir(output, { recursive: true });
const prisma = new PrismaClient();
const password = "SyntheticReferralBrowser#2026";
const stamp = randomUUID();
const periodKey = "daily:2026-01-01";
const startInclusive = new Date("2026-01-01T00:00:00.000Z");
const endExclusive = new Date("2026-01-02T00:00:00.000Z");
const memberCount = 2501;
const emails = [`ref-revision-a-${stamp}@test.invalid`, `ref-revision-b-${stamp}@test.invalid`];
const userIds = [];
const referredApplicationIds = [];
let appA;
let appB;
let linkId;
let browser;
try {
  const passwordHash = await bcrypt.hash(password, 10);
  const users = [];
  for (const email of emails) {
    const user = await prisma.user.create({ data: { email, passwordHash, role: "CUSTOMER", name: "Synthetic Referral Browser User" }, select: { id: true } });
    userIds.push(user.id);
    users.push(user);
  }
  const appData = (userId, suffix) => ({
    userId, fullName: `Synthetic Referral Agent ${suffix}`,
    phoneE164: `+254700${suffix === "A" ? "100001" : "100002"}`,
    privacyAcknowledgedAt: new Date(), status: "PENDING", agentStatus: "ACTIVE",
  });
  appA = await prisma.agentApplication.create({ data: appData(users[0].id, "A") });
  appB = await prisma.agentApplication.create({ data: appData(users[1].id, "B") });

  const link = await prisma.agentReferralLink.create({ data: {
    referrerApplicationId: appA.id, tokenHash: `ref-browser-link-${stamp}`, expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  } });
  linkId = link.id;
  const referredUsers = await prisma.user.createManyAndReturn({
    data: Array.from({ length: memberCount }, (_, index) => ({
      email: `ref-revision-member-${index}-${stamp}@test.invalid`, passwordHash, role: "CUSTOMER", name: "Synthetic Referred User",
    })),
    select: { id: true },
  });
  userIds.push(...referredUsers.map((user) => user.id));
  const referredApps = await prisma.agentApplication.createManyAndReturn({
    data: referredUsers.map((user, index) => ({
      userId: user.id, fullName: `Synthetic Referred Member ${index}`,
      phoneE164: `+254700${String(index + 200000).padStart(6, "0")}`,
      privacyAcknowledgedAt: startInclusive, status: "PENDING", agentStatus: "INACTIVE",
      createdAt: startInclusive, updatedAt: startInclusive,
    })),
    select: { id: true },
  });
  referredApplicationIds.push(...referredApps.map((application) => application.id));
  await prisma.agentReferralAttribution.createMany({
    data: referredApps.map((application) => ({
      referrerApplicationId: appA.id, referredApplicationId: application.id, linkId: link.id,
      consentedAt: startInclusive, source: "REGISTRATION", createdAt: startInclusive,
    })),
  });

  // The database trigger creates the baseline revision and immutable member set.
  await prisma.agentReferralReportSnapshot.create({ data: {
    applicationId: appA.id, periodKey, periodType: "DAILY", startInclusive, endExclusive,
    registrationCount: BigInt(memberCount), existingApplicationCount: BigInt(0),
  } });

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
  async function fetchRevision(page, suffix = "") {
    return page.evaluate(async (query) => {
      const response = await fetch(`/api/agents/reports/referrals/reconcile?periodKey=daily%3A2026-01-01&revision=1${query}`, { credentials: "same-origin", cache: "no-store" });
      return { status: response.status, body: await response.json() };
    }, suffix);
  }

  const first = await openPage();
  await login(first.page, emails[0]);
  const pageOne = await fetchRevision(first.page);
  if (pageOne.status !== 200 || pageOne.body.members?.length !== 2500 ||
      typeof pageOne.body.nextCursor !== "string" || pageOne.body.sales !== "NOT_CHECKED" ||
      pageOne.body.commission !== "NOT_CHECKED") {
    throw new Error("First authenticated cursor page failed its 2,500-row bounded/financial-scope contract");
  }
  const pageTwo = await fetchRevision(first.page, `&after=${encodeURIComponent(pageOne.body.nextCursor)}`);
  if (pageTwo.status !== 200 || pageTwo.body.members?.length !== 1 ||
      pageTwo.body.members[0]?.eventId === pageOne.body.members[0]?.eventId ||
      pageTwo.body.nextCursor !== null) throw new Error("Second cursor page failed");

  const invalidSelector = await fetchRevision(first.page, `&applicationId=${encodeURIComponent(appA.id)}`);
  if (invalidSelector.status !== 400) throw new Error("A tenant/application selector was not rejected");

  const second = await openPage();
  await login(second.page, emails[1]);
  const foreign = await fetchRevision(second.page);
  if (foreign.status !== 404) throw new Error("A different active agent could read another agent's report revision");

  const evidence = {
    result: "PASS",
    scope: "synthetic consented attribution rows in disposable PostgreSQL + authenticated real-browser HTTP",
    memberCount,
    firstPage: { status: pageOne.status, count: pageOne.body.members.length, nextCursor: pageOne.body.nextCursor },
    secondPage: { status: pageTwo.status, count: pageTwo.body.members.length, nextCursor: pageTwo.body.nextCursor },
    invalidTenantSelectorStatus: invalidSelector.status,
    otherAgentReadStatus: foreign.status,
    sales: pageOne.body.sales,
    commission: pageOne.body.commission,
    paymentOrDeliveryClaim: "NONE",
  };
  await writeFile(path.join(output, "result.json"), JSON.stringify(evidence, null, 2) + "\n");
  await second.context.close();
  await first.context.close();
  console.log("PASS: authenticated own-agent 2,501-row cursor pagination, cross-agent isolation and non-financial labels");
} finally {
  if (browser) await browser.close();
  // The dedicated jata_e2e database is disposable and destroyed with this CI job.
  // Referral snapshots, revisions and members are append-only by database trigger;
  // do not attempt to delete the synthetic evidence or bypass that invariant.
  await prisma.$disconnect();
}
