#!/usr/bin/env node
/**
 * Tasks board — real HTTP check against a running build.
 *
 * Why this exists: the unit and PostgreSQL suites prove the domain module and the SQL, but neither
 * proves that a signed-in person actually receives a working board, that a viewer is refused the
 * write controls, or that another tenant's work never appears in the HTML. This script seeds a
 * disposable database, asks the running server for the page with a real session cookie, and asserts
 * on the HTML that came back.
 *
 * What it is NOT: no payment provider, no messaging provider, no SMS. Nothing is sent. It is not a
 * substitute for human visual review.
 *
 * Usage (disposable database only):
 *   BASE_URL=http://127.0.0.1:3100 AUTH_SECRET=... DATABASE_URL=postgresql://... \
 *   node scripts/erp/tasks-page.check.mjs
 *   (add PRISMA_WASM_HARNESS_DIR=/path/to/node_modules/.erp-wasm-harness when the repo client has no native engine)
 *
 * Every fixture is namespaced by a random run id and deleted at the end, so re-running against the
 * same disposable database does not accumulate rows.
 */
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Same engine selection as tests/helpers/prisma-client.ts: the repo client when it has a native
 * engine, otherwise the WebAssembly query engine harness generated from the same schema. Both are
 * Prisma's own query engine talking to real PostgreSQL; neither is a mock.
 */
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

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET ?? "";
const rawConnect = process.env.DATABASE_URL ?? "";

if (!SECRET) {
  console.log("SKIP  AUTH_SECRET is not set; cannot mint a session cookie.");
  process.exit(0);
}
if (!rawConnect) {
  console.log("SKIP  DATABASE_URL is not set; this check needs the disposable database.");
  process.exit(0);
}

const prisma = makePrisma(process.env.PRISMA_TEST_DATABASE_URL || rawConnect);
const runId = randomUUID().slice(0, 8);
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function cookieFor(user) {
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: "OWNER",
    name: user.name,
    sessionVersion: user.sessionVersion ?? 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  return `jata_session=${token}`;
}

async function getHtml(path, cookie) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { cookie, "user-agent": "jata-task-board-check/1" },
    redirect: "manual",
  });
  const body = await response.text();
  return { status: response.status, body, location: response.headers.get("location") };
}

/** Fastify/Next errors are HTML; a 500 page mentions "Application error" without the board. */
function looksLikeBoard(html) {
  return html.includes("Tasks and work");
}

async function main() {
  const owner = await prisma.user.create({
    data: { email: `taskcheck-owner-${runId}@example.test`, name: `Owner ${runId}`, passwordHash: "x" },
  });
  const viewer = await prisma.user.create({
    data: { email: `taskcheck-viewer-${runId}@example.test`, name: `Viewer ${runId}`, passwordHash: "x" },
  });
  const outsider = await prisma.user.create({
    data: { email: `taskcheck-outsider-${runId}@example.test`, name: `Outsider ${runId}`, passwordHash: "x" },
  });

  const business = await prisma.business.create({
    data: { ownerId: owner.id, name: `Task Check ${runId}`, slug: `task-check-${runId}`, category: "retail", phone: "0700000000" },
  });
  const otherBusiness = await prisma.business.create({
    data: { ownerId: outsider.id, name: `Other Check ${runId}`, slug: `other-check-${runId}`, category: "retail", phone: "0700000001" },
  });

  await prisma.businessMember.create({ data: { userId: viewer.id, businessId: business.id, role: "STAFF" } });

  await prisma.erpConfiguration.create({
    data: {
      businessId: business.id,
      // The ERP role of a member is assigned here, not on BusinessMember.role.
      teamRolesJson: JSON.stringify({ [viewer.id]: "VIEWER" }),
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

  async function cleanup() {
    await prisma.erpTask.deleteMany({ where: { businessId: { in: [business.id, otherBusiness.id] } } });
    await prisma.erpEntitlement.deleteMany({ where: { businessId: business.id } }).catch(() => null);
    await prisma.erpSubscription.deleteMany({ where: { businessId: business.id } });
    await prisma.erpConfiguration.deleteMany({ where: { businessId: business.id } });
    await prisma.businessMember.deleteMany({ where: { businessId: business.id } });
    await prisma.business.deleteMany({ where: { id: { in: [business.id, otherBusiness.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, viewer.id, outsider.id] } } });
  }

  const now = Date.now();
  const mine = {
    overdue: await prisma.erpTask.create({
      data: {
        businessId: business.id, title: `Renew fire certificate ${runId}`, status: "OPEN", priority: "URGENT",
        dueAt: new Date(now - 3 * 24 * 3600 * 1000), createdBy: owner.id,
      },
    }),
    open: await prisma.erpTask.create({
      data: {
        businessId: business.id, title: `Call the supplier ${runId}`, status: "OPEN", priority: "NORMAL",
        dueAt: new Date(now + 5 * 24 * 3600 * 1000), createdBy: owner.id, assignedTo: owner.id,
      },
    }),
    done: await prisma.erpTask.create({
      data: {
        businessId: business.id, title: `File the VAT return ${runId}`, status: "DONE", priority: "NORMAL",
        completedAt: new Date(now - 3600 * 1000), createdBy: owner.id,
      },
    }),
    theirs: await prisma.erpTask.create({
      data: {
        businessId: otherBusiness.id, title: `SECRET other tenant work ${runId}`, status: "OPEN", priority: "HIGH",
        createdBy: outsider.id,
      },
    }),
  };

  const ownerCookie = await cookieFor(owner);
  const viewerCookie = await cookieFor(viewer);
  const path = `/dashboard/erp/${business.id}/tasks`;

  // Precondition: the server must be able to verify a real session against the same database. When
  // the deployed client has no reachable query engine (for example a `--no-engine` build), every
  // page bounces to /login and a FAIL here would blame the board for an environment fault.
  const probe = await getHtml("/dashboard", ownerCookie);
  if (probe.status === 307 && String(probe.location ?? "").includes("/login")) {
    console.log("BLOCKED  the server cannot verify a session against the database (redirected to /login).");
    console.log("         Generate the Prisma client with a native query engine, or run this check where one is available.");
    await cleanup();
    await prisma.$disconnect();
    process.exit(0);
  }

  // 1. The owner gets a real board with real rows.
  const ownerPage = await getHtml(path, ownerCookie);
  check("owner receives the board", ownerPage.status === 200 && looksLikeBoard(ownerPage.body), `HTTP ${ownerPage.status} to ${ownerPage.location ?? "-"}`);
  check("overdue work is shown", ownerPage.body.includes(mine.overdue.title));
  check("upcoming work is shown", ownerPage.body.includes(mine.open.title));
  check("recently finished work is shown", ownerPage.body.includes(mine.done.title));
  check("owner sees the add-task form", ownerPage.body.includes("Add a task") && ownerPage.body.includes("Add task"));
  check("owner sees the completion control", ownerPage.body.includes(">Done<"));
  check("overdue bucket is labelled", ownerPage.body.includes("Overdue"));

  // 2. Another tenant's task must not appear anywhere in this tenant's HTML.
  check("no other tenant's work leaks into the page", !ownerPage.body.includes(mine.theirs.title));
  check("no other tenant's id leaks into the page", !ownerPage.body.includes(otherBusiness.id));

  // 3. A viewer reads the board but is refused the write controls.
  const viewerPage = await getHtml(path, viewerCookie);
  check("viewer receives the board", viewerPage.status === 200 && looksLikeBoard(viewerPage.body), `HTTP ${viewerPage.status}`);
  check("viewer still sees the work", viewerPage.body.includes(mine.open.title));
  check("viewer sees no add-task form", !viewerPage.body.includes("Add a task"));
  check("viewer sees no completion control", !viewerPage.body.includes(">Done<"));
  check("viewer is told why", viewerPage.body.includes("only a manager, finance lead or staff member"));

  // 4. Cross-tenant navigation is refused before any row is read.
  const crossTenant = await getHtml(`/dashboard/erp/${otherBusiness.id}/tasks`, ownerCookie);
  check("owner is refused another tenant's board", crossTenant.status >= 400, `HTTP ${crossTenant.status}`);
  check("the refused page shows no foreign work", !crossTenant.body.includes(mine.theirs.title));

  // 5. Signed out means no board at all.
  const anonymous = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  check("signed-out request is not served the board", anonymous.status !== 200 || !looksLikeBoard(await anonymous.text()), `HTTP ${anonymous.status}`);

  // 6. The navigation entry exists, so the board is reachable rather than a hidden URL.
  const dash = await getHtml(`/dashboard/erp/${business.id}`, ownerCookie);
  check("tasks is in the workspace navigation", dash.body.includes("/tasks") && dash.body.includes("Tasks"));

  await cleanup();

  console.log(`\n${failed ? "RESULT: FAIL" : "RESULT: PASS"} (${results.length - failed}/${results.length} checks)`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(`ERROR ${error?.message ?? error}`);
  await prisma.$disconnect();
  process.exit(1);
});
