#!/usr/bin/env node
/**
 * Workspace return paths in real Chrome on the disposable CI database (R-RT-01, closes R-MJ-11's residual).
 *
 * Proves, through real navigation and the real cookie session, that a /dashboard destination survives
 * sign-in in every signed-out state:
 *   A. no cookie            : /dashboard/businesses/<id> → /login?next=… → sign in → back on that page
 *   B. revoked session      : sign in, bump User.sessionVersion in the DB (the cookie is now stale) →
 *                             /dashboard/team-access → /login?next=/dashboard/team-access → sign in → back
 *   C. forged cookie        : jata_session=<garbage> → /dashboard/mjengo → /login?next=mjengo, and
 *                             /dashboard/mjengo/<id> → /login?next=/dashboard/mjengo/<id> → sign in → back
 *   D. hostile next         : /login?next=//evil.example and next=https://evil.example → sign in → stays on
 *                             this origin under /dashboard
 *   E. another tenant's path: owner B signs in from /login?next=/dashboard/businesses/<A's id> and is
 *                             refused there (the return path grants nothing)
 *
 * Mutations: two fixture users/businesses and one sessionVersion bump, confined to the disposable DB and
 * removed in `finally`. Reuses the MJENGO browser guard (local PostgreSQL + local http server only).
 */
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { assertDisposableMjengoBrowserEnv } from "./mjengo-authenticated.guard.mjs";

const { base } = assertDisposableMjengoBrowserEnv(process.env);
const password = process.env.DEMO_FIXTURE_PASSWORD;
if (!process.env.CHROME_PATH || !existsSync(process.env.CHROME_PATH)) throw new Error("Chrome unavailable");

const prisma = new PrismaClient();
const tag = randomUUID().slice(0, 8);
const created = { users: [], businesses: [] };
let browser;

async function fixtureOwner(label) {
  const user = await prisma.user.create({
    data: { email: `return-${label}-${tag}@test.invalid`, name: `Return ${label} ${tag}`, passwordHash: await bcrypt.hash(password, 10), role: "CUSTOMER" },
  });
  created.users.push(user.id);
  const business = await prisma.business.create({
    data: {
      ownerId: user.id, slug: `return-${label}-${tag}`, name: `Return ${label} Traders ${tag}`, category: "services", theme: "default",
      phone: "0722000000", whatsapp: "0722000000", isPublished: false, status: "ACTIVE",
    },
  });
  created.businesses.push(business.id);
  return { user, business };
}

try {
  const a = await fixtureOwner("a");
  const b = await fixtureOwner("b");
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 390, height: 844 });
  const url = (p) => new URL(p, base).href;
  const here = () => new URL(page.url());
  const text = () => page.evaluate(() => document.body.innerText);
  const clearCookies = async () => { const c = await page.cookies(); if (c.length) await page.deleteCookie(...c); };

  async function expectLogin(from, next) {
    await page.goto(url(from), { waitUntil: "load" });
    const u = here();
    const got = u.searchParams.get("next");
    if (u.pathname !== "/login" || got !== next) throw new Error(`${from} must redirect to /login?next=${next}, got ${u.pathname}${u.search}`);
  }
  async function signIn(email, expectPath) {
    await page.waitForSelector("#login-email");
    await new Promise((done) => setTimeout(done, 1200)); // hydration
    await page.type("#login-email", email);
    await page.type("#login-password", password);
    const login = page.waitForResponse((r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
    await page.click('button[type="submit"]');
    if (!(await login).ok()) throw new Error(`Fixture login failed for ${email}`);
    if (typeof expectPath === "string") {
      const ok = await page.waitForFunction((p) => location.pathname === p, { timeout: 30000 }, expectPath).then(() => true, () => false);
      if (!ok) throw new Error(`After sign-in expected ${expectPath}, settled at ${page.url()}: ${(await text()).slice(0, 200)}`);
    } else {
      await page.waitForFunction(() => location.pathname !== "/login", { timeout: 30000 });
    }
  }

  // A. No cookie.
  const bizPath = `/dashboard/businesses/${a.business.id}`;
  await clearCookies();
  await expectLogin(bizPath, bizPath);
  await signIn(a.user.email, bizPath);
  if (!(await text()).includes(a.business.name)) throw new Error("Returned business page does not show the owner's business");
  console.log(`PASS A no cookie: ${bizPath} → /login?next=${bizPath} → signed in → back on ${bizPath}`);

  // B. Revoked session: the cookie is still sent but no longer valid server-side.
  await prisma.user.update({ where: { id: a.user.id }, data: { sessionVersion: { increment: 1 } } });
  if (!(await page.cookies()).some((c) => c.name === "jata_session" && c.value)) throw new Error("Expected the stale session cookie to still be present");
  await expectLogin("/dashboard/team-access", "/dashboard/team-access");
  await signIn(a.user.email, "/dashboard/team-access");
  console.log("PASS B revoked session (stale cookie present): /dashboard/team-access → /login?next=/dashboard/team-access → signed in → back");

  // C. Forged cookie.
  await clearCookies();
  await page.setCookie({ name: "jata_session", value: "forged.invalid.token", url: base.href });
  await expectLogin("/dashboard/mjengo", "mjengo");
  const mjPath = `/dashboard/mjengo/${a.business.id}`;
  await expectLogin(mjPath, mjPath);
  await signIn(a.user.email, mjPath);
  console.log(`PASS C forged cookie: /dashboard/mjengo → /login?next=mjengo; ${mjPath} → /login?next=${mjPath} → signed in → back`);

  // D. Hostile next values never leave the origin or the workspace.
  for (const hostile of ["//evil.example", "https://evil.example/dashboard"]) {
    await clearCookies();
    await page.goto(url(`/login?next=${encodeURIComponent(hostile)}`), { waitUntil: "load" });
    await signIn(a.user.email, "/dashboard");
    const u = here();
    if (u.origin !== base.origin) throw new Error(`Hostile next ${hostile} left the origin: ${u.href}`);
  }
  console.log("PASS D hostile next (//evil.example, https://evil.example/dashboard) → stayed on this origin at /dashboard");

  // E. The return path grants nothing: owner B returning to A's business page is refused there.
  await clearCookies();
  await expectLogin(bizPath, bizPath);
  await signIn(b.user.email, null);
  const afterB = here();
  const bodyB = await text();
  if (afterB.pathname === bizPath && bodyB.includes(a.business.name)) throw new Error("Owner B was shown owner A's business after returning to its path");
  console.log(`PASS E another tenant's return path (${bizPath}) did not expose owner A's business to owner B (settled at ${afterB.pathname})`);

  // F. (R-RT-02) The owner's AI-page preview survives sign-in (it used an ignored callbackUrl).
  const previewPath = `/b/${a.business.slug}/ai`;
  const previewToken = `ai-preview:${a.business.slug}`;
  await clearCookies();
  await expectLogin(`${previewPath}?preview=true`, previewToken);
  await signIn(a.user.email, previewPath);
  if (here().searchParams.get("preview") !== "true") throw new Error(`Owner preview lost ?preview=true: ${page.url()}`);
  console.log(`PASS F owner AI preview: ${previewPath}?preview=true → /login?next=${previewToken} → signed in → back on the preview`);

  // G. The same link grants another tenant nothing: owner B is sent to the preview URL and refused (404).
  await clearCookies();
  await expectLogin(`${previewPath}?preview=true`, previewToken);
  await signIn(b.user.email, previewPath);
  const refused = await page.goto(url(`${previewPath}?preview=true`), { waitUntil: "load" });
  if (refused?.status() !== 404) throw new Error(`Owner B must get 404 on owner A's AI preview, got ${refused?.status()}`);
  console.log(`PASS G another tenant following ${previewToken} is refused on owner A's preview (404)`);

  console.log("PASS real Chrome: workspace return paths preserved for no-cookie, revoked and forged sessions; hostile next refused; cross-tenant return path grants nothing; owner AI preview preserved and tenant-checked");
} finally {
  if (browser) await browser.close();
  try {
    await prisma.business.deleteMany({ where: { id: { in: created.businesses } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  } catch (error) {
    console.error(`cleanup incomplete (disposable DB only): ${error?.message ?? error}`);
  }
  await prisma.$disconnect();
}
