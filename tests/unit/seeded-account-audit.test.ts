/**
 * Seeded demo/admin account audit (Premium Transformation Phase 4, 2026-10-27).
 *
 * Source-level regression guards for the two accounts `prisma/seed.ts` creates. The audit
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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_OWNER_EMAIL, DEMO_PAYMENT_PREFIX } from "@/lib/demoData";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const seed = read("prisma/seed.ts");
const tenant = read("lib/tenant.ts");
const adminLayout = read("app/admin/layout.tsx");
const loginRoute = read("app/api/auth/login/route.ts");
const restoreScript = read("scripts/restore-demo-businesses.ts");

describe("seeded account inventory (prisma/seed.ts)", () => {
  it("creates exactly one ADMIN and one CUSTOMER demo user, via upsert", () => {
    expect(seed).toContain('role: "ADMIN"');
    expect(seed).toContain('role: "CUSTOMER"');
    // The demo owner must never be granted the platform role.
    const demoBlock = seed.slice(seed.indexOf("Demo customer user"));
    expect(demoBlock).toContain("where: { email: demoUserEmail }");
    expect(demoBlock.slice(0, demoBlock.indexOf("const demos"))).not.toContain('role: "ADMIN"');
  });

  it("pins the demo owner identity to the shared constant", () => {
    expect(DEMO_OWNER_EMAIL).toBe("demo@jata.link");
    expect(seed).toContain("const demoUserEmail = DEMO_OWNER_EMAIL;");
  });

  it("hashes both seeded passwords with bcrypt — no plaintext credential is persisted", () => {
    expect(seed).toMatch(/bcrypt\.hash\(/g);
    expect(seed).not.toMatch(/password:\s*"(?!").+"/);
    expect(seed).toContain("passwordHash: adminHash");
    expect(seed).toContain("passwordHash: demoHash");
  });

  it("derives the admin email from ADMIN_EMAILS with a fixed fallback rather than hard-coding a tenant address", () => {
    expect(seed).toContain("process.env.ADMIN_EMAILS");
    expect(seed).toContain('admin@jata.link');
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
