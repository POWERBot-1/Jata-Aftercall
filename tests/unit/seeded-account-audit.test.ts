/**
 * Seeded demo/admin account audit (Premium Transformation Phase 4, 2026-10-27).
 *
 * Source-level regression guards for the demo account and optional admin fixture in `prisma/seed.ts`. The audit
 * itself is docs/security/SEEDED_ACCOUNT_AUDIT_2026-10-27.md; this file turns the properties
 * the audit relies on into executable assertions so a later change cannot silently:
 *   - widen the demo owner into an admin,
 *   - stop hashing a seeded password,
 *   - write non-demo payments against the demo businesses,
 *   - expose a web-triggerable seed endpoint, or
 *   - remove the server-side admin role gate / login rate limit.
 *
 * Production database state (does the row exist, last login, rotation) cannot be checked from
 * the sandbox and is marked BLOCKED/NOT TESTED in the audit document.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_OWNER_EMAIL, DEMO_PAYMENT_PREFIX } from "@/lib/demoData";
import { validateSeedEnvironment } from "@/scripts/lib/seed-safety";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const seed = read("prisma/seed.ts");
const tenant = read("lib/tenant.ts");
const adminLayout = read("app/admin/layout.tsx");
const loginRoute = read("app/api/auth/login/route.ts");
const restoreScript = read("scripts/restore-demo-businesses.ts");

describe("seeded account inventory (prisma/seed.ts)", () => {
  it("creates a demo CUSTOMER fixture and only creates an admin fixture when explicitly configured", () => {
    expect(seed).toContain('role: "ADMIN"');
    expect(seed).toContain('role: "CUSTOMER"');
    expect(seed).toContain("if (seedEnvironment.adminEmail && seedEnvironment.adminInitialPassword)");
    expect(seed).toContain("update: {},"); // reruns cannot promote or mutate an existing account
    // The demo owner must never be granted the platform role.
    const demoBlock = seed.slice(seed.indexOf("const demoUserEmail"), seed.indexOf("const demos"));
    expect(demoBlock).toContain("where: { email: demoUserEmail }");
    expect(demoBlock).not.toContain('role: "ADMIN"');
  });

  it("pins the demo owner identity to the shared constant", () => {
    expect(DEMO_OWNER_EMAIL).toBe("demo@jata.link");
    expect(seed).toContain("const demoUserEmail = DEMO_OWNER_EMAIL;");
  });

  it("hashes only ephemeral environment-provided fixture passwords and has no source-visible default credential", () => {
    expect(seed).toMatch(/bcrypt\.hash\(/g);
    expect(seed).not.toMatch(/password:\s*"(?!").+"/);
    expect(seed).toContain("passwordHash: adminHash");
    expect(seed).toContain("passwordHash: demoHash");
    expect(seed).not.toMatch(/bcrypt\.hash\(\s*"[^"]+"/);
    expect(seed).not.toMatch(/bcrypt\.hash\(\s*["']/);
  });

  it("validates seed safety before constructing Prisma and never runs in production", () => {
    const password = "f".repeat(64);
    const guardIndex = seed.indexOf("const seedEnvironment = validateSeedEnvironment(process.env)");
    const prismaImportIndex = seed.indexOf('import("@prisma/client")');
    const clientIndex = seed.indexOf("new PrismaClient()");
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(prismaImportIndex).toBeGreaterThan(guardIndex);
    expect(clientIndex).toBeGreaterThan(prismaImportIndex);
    expect(() => validateSeedEnvironment({ NODE_ENV: "production", JATA_ALLOW_FIXTURE_SEED: "true", DEMO_FIXTURE_PASSWORD: password })).toThrow(/production/i);
    expect(() => validateSeedEnvironment({ NODE_ENV: "test", VERCEL_ENV: "production", JATA_ALLOW_FIXTURE_SEED: "true", DEMO_FIXTURE_PASSWORD: password })).toThrow(/production/i);
    expect(() => validateSeedEnvironment({ NODE_ENV: "test", DEMO_FIXTURE_PASSWORD: password })).toThrow(/opt-in/i);
    expect(() => validateSeedEnvironment({ NODE_ENV: "test", JATA_ALLOW_FIXTURE_SEED: "true", DEMO_FIXTURE_PASSWORD: "short" })).toThrow(/32 characters/i);
    expect(() => validateSeedEnvironment({ NODE_ENV: "test", JATA_ALLOW_FIXTURE_SEED: "true", DEMO_FIXTURE_PASSWORD: password })).not.toThrow();
  });

  it("refuses production in the actual seed CLI before Prisma loads or a DB URL is needed", () => {
    const cli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(process.execPath, [cli, path.join(root, "prisma", "seed.ts")], {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH || "",
        NODE_ENV: "production",
        JATA_ALLOW_FIXTURE_SEED: "true",
        DEMO_FIXTURE_PASSWORD: "f".repeat(64),
      },
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(output).toMatch(/Refusing to run the fixture seed in a production environment/i);
    expect(output).not.toContain("Cannot find module");
  });

  it("requires both configured admin fixture identity and an ephemeral password", () => {
    const password = "f".repeat(64);
    expect(() => validateSeedEnvironment({ NODE_ENV: "test", JATA_ALLOW_FIXTURE_SEED: "true", DEMO_FIXTURE_PASSWORD: password, ADMIN_EMAILS: "admin@example.test" })).toThrow(/both ADMIN_EMAILS and ADMIN_INITIAL_PASSWORD/i);
    expect(() => validateSeedEnvironment({ NODE_ENV: "test", JATA_ALLOW_FIXTURE_SEED: "true", DEMO_FIXTURE_PASSWORD: password, ADMIN_EMAILS: "admin@example.test", ADMIN_INITIAL_PASSWORD: password })).not.toThrow();
  });

  it("marks every seeded payment with the demo prefix so real Paystack rows can never be confused with fixtures", () => {
    expect(seed).toContain(`reference: \`${DEMO_PAYMENT_PREFIX}\${d.slug}\``);
    expect(DEMO_PAYMENT_PREFIX).toBe("demo-");
  });

  it("refuses to overwrite a slug that is no longer exclusively demo-owned", () => {
    expect(seed).toContain("existing.ownerId !== demoUser.id");
    expect(seed).toContain("has a non-demo payment");
  });
});

describe("seed exposure surface", () => {
  it("offers no web-triggerable seed/migrate/init endpoint", () => {
    const apiDir = path.join(root, "app", "api");
    const routes = readdirSync(apiDir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? [entry.name] : [],
    );
    for (const forbidden of ["seed", "migrate", "init", "setup"]) {
      expect(routes, forbidden).not.toContain(forbidden);
    }
  });

  it("gates the admin console server-side on the ADMIN session role", () => {
    expect(adminLayout).toContain('if (session.role !== "ADMIN") redirect("/dashboard")');
  });

  it("rate-limits login and returns generic credential errors", () => {
    expect(loginRoute).toContain("rateLimit(req");
    expect(loginRoute).toContain('"auth-login"');
    expect(loginRoute).toContain("Invalid credentials");
  });

  it("keeps the restore script restricted to the existing demo account", () => {
    expect(restoreScript).toContain(DEMO_OWNER_EMAIL);
    expect(restoreScript).not.toMatch(/user\.create|users\.create/);
  });
});

describe("tenant isolation around the demo businesses", () => {
  it("still provides the ownership/mutation guards the media and business routes call", () => {
    expect(tenant).toContain("export async function assertBusinessOwnership");
    expect(tenant).toContain("export async function guardTenantMutation");
    // Fail-closed role resolution: an unknown role never grants weight.
    expect(tenant).toContain("(ROLE_WEIGHT[role] ?? 0)");
  });

  it("does not let the seed grant the demo user membership of any business it does not own", () => {
    const membership = seed.slice(seed.indexOf("businessMember.upsert"));
    expect(membership).toContain("userId: demoUser.id");
    expect(membership).toContain("businessId: business.id");
  });

  it("keeps the audit log wired for login events", () => {
    expect(loginRoute).toContain('action: "USER_LOGIN"');
  });
});

describe("deployment gate", () => {
  it("documents seeding as a manual step that the build/migration gate never invokes", () => {
    const deployment = read("DEPLOYMENT.md");
    expect(deployment).toMatch(/no seed, no secret logging/i);
    expect(deployment).toContain("No `/api/seed` endpoint");
    // The migration script exists and contains no seed invocation.
    const migrateSh = existsSync(path.join(root, "scripts", "migrate.sh"))
      ? read("scripts/migrate.sh")
      : "";
    expect(migrateSh).not.toMatch(/npm run seed|prisma\/seed/);
  });
});
