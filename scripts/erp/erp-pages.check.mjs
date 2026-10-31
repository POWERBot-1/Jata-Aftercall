#!/usr/bin/env node
/**
 * ERP pages over real HTTP — tasks, requisitions and procurement.
 *
 * Why this exists: the unit suites prove the domain rules and the PostgreSQL suites prove the SQL,
 * but neither proves that a signed-in person actually receives a working page, that a read-only role
 * is refused the write controls, or that another tenant's rows never reach this tenant's HTML. This
 * script starts the real production build (`next start`), seeds a disposable database, sends real
 * requests with real session cookies and asserts on the HTML that came back.
 *
 * What it is NOT: no payment provider, no messaging provider, no SMS, nothing is sent, no Chrome, no
 * screenshots. It is not human visual review and not a substitute for it.
 *
 * The cross-tenant assertion checks the security contract, not an arbitrary status code. The ERP
 * layout deliberately renders a refusal panel for a workspace the session may not open, and a page
 * that throws is handled by Next's error boundary; either way what matters is that **no foreign
 * record is disclosed**. The check therefore requires: no foreign title, no foreign business id, no
 * rendered page body of the other tenant, and an explicit refusal signal (a 4xx status or the
 * application's own refusal text).
 *
 * Usage (disposable database and a prior `npm run build` only):
 *   AUTH_SECRET=... DATABASE_URL=postgresql://... node scripts/erp/erp-pages.check.mjs
 *   (add PRISMA_WASM_HARNESS_DIR=/path/to/node_modules/.erp-wasm-harness when the repo client has no
 *    native engine — note the *server* still needs a client that can reach PostgreSQL)
 *
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = BLOCKED (environment cannot support the check; never a pass).
 *
 * Every fixture is namespaced by a random run id and deleted at the end, so re-running against the
 * same disposable database does not accumulate rows.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import net from "node:net";
import { SignJWT } from "jose";

const require = createRequire(import.meta.url);

const SECRET = process.env.AUTH_SECRET ?? "";
const rawConnect = process.env.DATABASE_URL ?? "";

if (!SECRET) {
  console.log("BLOCKED  AUTH_SECRET is not set; cannot mint or verify a session cookie.");
  process.exit(2);
}
if (!rawConnect) {
  console.log("BLOCKED  DATABASE_URL is not set; this check needs a disposable database.");
  process.exit(2);
}

/** Same engine selection as tests/helpers/prisma-client.ts. Never a mock. */
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
  // An offline `--no-engine` client throws while being constructed. That is an environment fault,
  // never a pass: say exactly what is missing and stop.
  console.log(`BLOCKED  the Prisma client could not be constructed: ${String(error?.message ?? error).split("\n")[0].slice(0, 300)}`);
  console.log("         Generate the client with a native query engine, or set PRISMA_WASM_HARNESS_DIR for this script.");
  process.exit(2);
}
const runId = randomUUID().slice(0, 8);
const results = [];
let failed = 0;
let blocked = null;

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function cookieFor(user) {
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    sessionVersion: user.sessionVersion ?? 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  return `jata_session=${token}`;
}

let BASE_URL = "";
async function get(pathname, cookie) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: cookie ? { cookie, "user-agent": "jata-erp-pages-check/1" } : { "user-agent": "jata-erp-pages-check/1" },
    redirect: "manual",
  });
  const body = await response.text();
  return { status: response.status, body, location: response.headers.get("location") ?? "" };
}

const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** The ERP layout renders this card for a workspace the session may not open. */
function refusalShown(html) {
  // The refusal card text survives React escaping as \`can&#x27;t\`, so match on the stable part of the
  // sentence instead of an apostrophe that has three possible encodings.
  const text = textOf(html);
  return text.includes("open this workspace") || text.includes("don&#x27;t have access") || text.includes("don't have access");
}

/**
 * The security contract for a cross-tenant request: nothing belonging to the other tenant is
 * disclosed, and the response is an explicit refusal rather than the other tenant's page.
 */
function foreignRequestRefused(result, foreign) {
  // The requested path is necessarily echoed in the response (canonical URL, form actions, the RSC
  // payload), so the tenant id is stripped from the body before asking whether tenant *data* leaked.
  // For the same reason there is deliberately NO "the id appears in the body" assertion: after the
  // strip it could never fire, and asserting it would be evidence that cannot fail. The real question
  // is whether the other tenant's *content* (names, record text, the page itself) reached this tenant.
  const decoded = result.body.replaceAll(encodeURIComponent(foreign.businessId), " ").replaceAll(foreign.businessId, " ");
  const leakedTitle = decoded.includes(foreign.title);
  const renderedOtherPage = decoded.includes(foreign.pageMarker) || decoded.includes(foreign.recordMarker);
  const isClientError = result.status >= 400 && result.status < 500;
  const isRefusal = refusalShown(result.body);
  // A 5xx is tolerated ONLY together with an explicit refusal, because it still discloses nothing.
  // It is reported in the detail line so an investigation can follow it.
  const ok = !leakedTitle && !renderedOtherPage && (isClientError || isRefusal);
  return {
    ok,
    detail: `HTTP ${result.status}, refusal=${isRefusal}, foreignTitle=${leakedTitle}, otherPage=${renderedOtherPage}`,
  };
}

async function waitForServer(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) return { ok: false, reason: `the server exited with code ${server.exitCode}` };
    try {
      const response = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
      if (response.status < 500) return { ok: true };
      last = `HTTP ${response.status} from /login`;
    } catch (error) {
      last = String(error?.message ?? error);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return { ok: false, reason: `the server did not answer within ${Math.round(timeoutMs / 1000)}s (${last})` };
}

let server = null;
const ids = {};

async function seed() {
  const owner = await prisma.user.create({ data: { email: `erpcheck-owner-${runId}@example.test`, name: `Owner ${runId}`, passwordHash: "x" } });
  const manager = await prisma.user.create({ data: { email: `erpcheck-manager-${runId}@example.test`, name: `Manager ${runId}`, passwordHash: "x" } });
  const staff = await prisma.user.create({ data: { email: `erpcheck-staff-${runId}@example.test`, name: `Staff ${runId}`, passwordHash: "x" } });
  const viewer = await prisma.user.create({ data: { email: `erpcheck-viewer-${runId}@example.test`, name: `Viewer ${runId}`, passwordHash: "x" } });
  const outsider = await prisma.user.create({ data: { email: `erpcheck-outsider-${runId}@example.test`, name: `Outsider ${runId}`, passwordHash: "x" } });
  Object.assign(ids, { owner: owner.id, manager: manager.id, staff: staff.id, viewer: viewer.id, outsider: outsider.id });

  const business = await prisma.business.create({
    data: { ownerId: owner.id, name: `ERP Check ${runId}`, slug: `erp-check-${runId}`, category: "retail", phone: "0700000000" },
  });
  const otherBusiness = await prisma.business.create({
    data: { ownerId: outsider.id, name: `Other ERP ${runId}`, slug: `other-erp-${runId}`, category: "retail", phone: "0700000001" },
  });
  Object.assign(ids, { business: business.id, otherBusiness: otherBusiness.id });

  await prisma.businessMember.create({ data: { userId: manager.id, businessId: business.id, role: "MANAGER" } });
  await prisma.businessMember.create({ data: { userId: staff.id, businessId: business.id, role: "STAFF" } });
  await prisma.businessMember.create({ data: { userId: viewer.id, businessId: business.id, role: "VIEWER" } });

  // ERP roles live on the configuration, not on BusinessMember.role.
  await prisma.erpConfiguration.create({
    data: {
      businessId: business.id,
      teamRolesJson: JSON.stringify({ [manager.id]: "MANAGER", [staff.id]: "STAFF", [viewer.id]: "VIEWER" }),
    },
  });
  await prisma.erpSubscription.create({
    data: {
      businessId: business.id,
      userId: owner.id,
      planId: "plan-erp-pro-check",
      planKey: "ERP_PRO",
      status: "ACTIVE",
      startAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });
  await prisma.erpConfiguration.create({ data: { businessId: otherBusiness.id } });
  await prisma.erpSubscription.create({
    data: {
      businessId: otherBusiness.id,
      userId: outsider.id,
      planId: "plan-erp-pro-check",
      planKey: "ERP_PRO",
      status: "ACTIVE",
      startAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });

  const supplier = await prisma.posSupplier.create({ data: { businessId: business.id, name: `Cement Traders ${runId}`, termsDays: 30 } });
  Object.assign(ids, { supplier: supplier.id });
  const product = await prisma.posProduct.create({
    data: { businessId: business.id, name: `Cement 50kg ${runId}`, unitKey: "bag", priceKES: 90_000, costKES: 75_000, trackInventory: true, kind: "PRODUCT" },
  });
  Object.assign(ids, { product: product.id });

  const now = Date.now();
  const task = await prisma.erpTask.create({
    data: { businessId: business.id, title: `Renew fire certificate ${runId}`, status: "OPEN", priority: "URGENT", dueAt: new Date(now - 3 * 24 * 3600 * 1000), createdBy: owner.id },
  });
  const otherTask = await prisma.erpTask.create({
    data: { businessId: otherBusiness.id, title: `SECRET other tenant task ${runId}`, status: "OPEN", priority: "HIGH", createdBy: outsider.id },
  });

  // A submitted request raised by staff, so the manager (not the requester) may decide it.
  const requisition = await prisma.erpRequisition.create({
    data: {
      businessId: business.id,
      requisitionNumber: `REQ-CHK-${runId}`,
      status: "SUBMITTED",
      title: `Bulk cement ${runId}`,
      justification: "Below the reorder level",
      department: "Operations",
      priority: "HIGH",
      supplierId: supplier.id,
      supplierName: `Cement Traders ${runId}`,
      estimatedSubtotalCents: 3_000_000,
      estimatedTaxCents: 480_000,
      estimatedTotalCents: 3_480_000,
      requestedBy: staff.id,
      requestedName: `Staff ${runId}`,
      submittedAt: new Date(now - 3600 * 1000),
      idempotencyKey: `erpcheck-${runId}`,
      lines: {
        create: [{
          businessId: business.id,
          productId: product.id,
          description: `50 kg bag of cement ${runId}`,
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
  const otherRequisition = await prisma.erpRequisition.create({
    data: {
      businessId: otherBusiness.id,
      requisitionNumber: `REQ-SEC-${runId}`,
      status: "DRAFT",
      title: `SECRET other tenant request ${runId}`,
      estimatedSubtotalCents: 0,
      estimatedTaxCents: 0,
      estimatedTotalCents: 0,
      requestedBy: outsider.id,
      idempotencyKey: `erpcheck-other-${runId}`,
    },
  });
  Object.assign(ids, { task: task.id, otherTask: otherTask.id, requisition: requisition.id, otherRequisition: otherRequisition.id });
  return { business, otherBusiness, task, otherTask, requisition, otherRequisition };
}

async function cleanup() {
  const { business, otherBusiness } = ids;
  if (!business) return;
  const scopes = [business, otherBusiness].filter(Boolean);
  for (const businessId of scopes) {
    await prisma.erpRequisitionLine.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpRequisition.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpPurchaseOrderLine.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpPurchaseOrder.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpTask.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpNotification.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpAuditEvent.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpSequence.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpSubscription.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpEntitlement.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.erpConfiguration.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.posProduct.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.posSupplier.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.businessMember.deleteMany({ where: { businessId } }).catch(() => null);
    await prisma.business.delete({ where: { id: businessId } }).catch(() => null);
  }
  await prisma.user.deleteMany({ where: { email: { contains: `erpcheck-` } } }).catch(() => null);
}

async function main() {
  // 1. The database must be reachable by this script before anything is spawned or written.
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch (error) {
    console.log(`BLOCKED  cannot reach the database with the ${engine}: ${String(error?.message ?? error).slice(0, 200)}`);
    return 2;
  }

  // 2. Start the real production build.
  const port = await freePort();
  BASE_URL = `http://127.0.0.1:${port}`;
  console.log(`Engine ${engine}; disposable database; ${BASE_URL}`);
  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    // ERP_PRO_ENABLED is the product's own switch (lib/erp/entitlement.ts): unset means "on outside
    // production, off in production". The server runs NODE_ENV=production here, so without it every
    // ERP route answers with the 503 "not switched on" refusal and this check would be testing that
    // refusal instead of the pages. It is a test-only process environment, never production config.
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ERP_PRO_ENABLED: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

  const ready = await waitForServer();
  if (!ready.ok) {
    console.log(`BLOCKED  ${ready.reason}.`);
    console.log("         The production build cannot be served here. Build with `npm run build` and run");
    console.log("         this check where the Prisma client can reach PostgreSQL (CI supplies the native engine).");
    const tail = serverLog.split("\n").filter(Boolean).slice(-6).join("\n         ");
    if (tail) console.log(`         server output:\n         ${tail}`);
    return 2;
  }

  const fixtures = await seed();
  ids.business = fixtures.business.id;
  ids.otherBusiness = fixtures.otherBusiness.id;

  const owner = await prisma.user.findUnique({ where: { id: ids.owner } });
  const manager = await prisma.user.findUnique({ where: { id: ids.manager } });
  const staff = await prisma.user.findUnique({ where: { id: ids.staff } });
  const viewer = await prisma.user.findUnique({ where: { id: ids.viewer } });
  const outsider = await prisma.user.findUnique({ where: { id: ids.outsider } });

  const ownerCookie = await cookieFor(owner);
  const managerCookie = await cookieFor(manager);
  const staffCookie = await cookieFor(staff);
  const viewerCookie = await cookieFor(viewer);
  const outsiderCookie = await cookieFor(outsider);

  const base = `/dashboard/erp/${fixtures.business.id}`;
  const otherBase = `/dashboard/erp/${fixtures.otherBusiness.id}`;

  // 3. Precondition: the server must be able to verify a real session against the same database.
  // Without this, every page bounces to /login and a failure here would blame the pages.
  const probe = await get(`${base}/tasks`, ownerCookie);
  if (probe.status === 307 && probe.location.includes("/login")) {
    console.log("BLOCKED  the server cannot verify a session against the database (owner request redirected to /login).");
    console.log("         The running build has no usable Prisma query engine. Run this where `prisma generate`");
    console.log("         produced the native engine (CI), not an offline `--no-engine` client.");
    return 2;
  }

  // 4. Signed out means no ERP page at all.
  for (const page of ["tasks", "requisitions", "procurement"]) {
    const anonymous = await get(`${base}/${page}`);
    const redirected = (anonymous.status === 307 || anonymous.status === 302) && anonymous.location.includes("/login");
    check(`signed-out ${page} is not served`, redirected || anonymous.status >= 400, `HTTP ${anonymous.status}${anonymous.location ? ` → ${anonymous.location}` : ""}`);
  }

  // 5. The owner receives real pages with real rows.
  const tasksPage = await get(`${base}/tasks`, ownerCookie);
  check("owner receives the task board", tasksPage.status === 200 && tasksPage.body.includes("Tasks and work"), `HTTP ${tasksPage.status}`);
  check("owner sees their own overdue work", tasksPage.body.includes(fixtures.task.title));
  check("owner sees the add-task form", tasksPage.body.includes("Add a task") && tasksPage.body.includes("Add task"));

  const requisitionsPage = await get(`${base}/requisitions`, ownerCookie);
  check("owner receives the requisitions page", requisitionsPage.status === 200 && requisitionsPage.body.includes("Requisitions"), `HTTP ${requisitionsPage.status}`);
  check("owner sees the submitted request and its number", requisitionsPage.body.includes(fixtures.requisition.title) && requisitionsPage.body.includes(fixtures.requisition.requisitionNumber));
  check("owner sees the raise-a-request form", requisitionsPage.body.includes("Raise a request") && requisitionsPage.body.includes("Save draft request"));
  check("the submitted request shows it is waiting for a decision", requisitionsPage.body.includes("Waiting for a decision"));

  const procurementPage = await get(`${base}/procurement`, ownerCookie);
  check("owner receives the procurement page", procurementPage.status === 200 && procurementPage.body.includes("Procurement"), `HTTP ${procurementPage.status}`);
  check("owner sees the raise-a-purchase-order form", procurementPage.body.includes("Raise a purchase order"));

  // 6. Role behaviour on the requisitions page.
  const managerPage = await get(`${base}/requisitions`, managerCookie);
  check("a manager who did not raise the request sees the approve control", managerPage.status === 200 && managerPage.body.includes(">Approve<"), `HTTP ${managerPage.status}`);
  check("a manager can also reject, with a reason required", managerPage.body.includes(">Reject<") && managerPage.body.includes("Why reject it?"));

  const staffPage = await get(`${base}/requisitions`, staffCookie);
  check("staff can raise requests", staffPage.status === 200 && staffPage.body.includes("Save draft request"), `HTTP ${staffPage.status}`);
  check("staff cannot approve their own request", !staffPage.body.includes(">Approve<"), "no approve control rendered");

  const viewerPage = await get(`${base}/requisitions`, viewerCookie);
  check("a viewer reads requests", viewerPage.status === 200 && viewerPage.body.includes(fixtures.requisition.requisitionNumber), `HTTP ${viewerPage.status}`);
  check("a viewer is refused the raise form", !viewerPage.body.includes("Save draft request"));
  check("a viewer is told why they cannot raise", viewerPage.body.includes("can read requests but not raise them"));

  // 7. Tenant isolation on every page we cover — the security contract, not a status code.
  const foreign = {
    tasks: { title: fixtures.otherTask.title, businessId: fixtures.otherBusiness.id, pageMarker: "Tasks and work", recordMarker: "SECRET other tenant task" },
    requisitions: { title: fixtures.otherRequisition.title, businessId: fixtures.otherBusiness.id, pageMarker: "Save draft request", recordMarker: "SECRET other tenant request" },
  };
  for (const [page, marker] of Object.entries(foreign)) {
    const result = await get(`${otherBase}/${page}`, ownerCookie);
    const verdict = foreignRequestRefused(result, marker);
    check(`owner is refused another tenant's ${page}`, verdict.ok, verdict.detail);
  }
  // The outsider must not see this tenant's rows either.
  const reverse = await get(`${base}/requisitions`, outsiderCookie);
  const reverseVerdict = foreignRequestRefused(reverse, {
    title: fixtures.requisition.title,
    businessId: fixtures.business.id,
    pageMarker: "Save draft request",
    recordMarker: fixtures.requisition.requisitionNumber,
  });
  check("an outsider is refused this tenant's requisitions", reverseVerdict.ok, reverseVerdict.detail);

  // 8. The pages are reachable from the workspace navigation, not hidden URLs.
  const workspace = await get(base, ownerCookie);
  check("the workspace navigation links requisitions", workspace.body.includes("/requisitions") && workspace.body.includes("Requisitions"), `HTTP ${workspace.status}`);
  check("the workspace navigation links procurement", workspace.body.includes("/procurement"));

  return failed ? 1 : 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.log(`ERROR  ${String(error?.message ?? error).slice(0, 400)}`);
  exitCode = 1;
} finally {
  await cleanup();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await prisma.$disconnect().catch(() => null);
  const passed = results.filter((row) => row.ok).length;
  const verdict = exitCode === 2 ? "BLOCKED" : failed ? "FAIL" : "PASS";
  console.log(`\nRESULT: ${verdict} (${passed}/${results.length} checks)${exitCode === 2 ? " — the environment could not run this check; this is not a pass" : ""}`);
  process.exit(exitCode);
}
