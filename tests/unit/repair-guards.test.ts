import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { controlA11yProps, fieldDescribedBy } from "@/lib/a11y";
import { dashboardRedirectTarget, onboardingRedirectTarget } from "@/lib/ownerFlow";
import { allowStubPrismaClient } from "@/lib/prismaRuntime";
import { publicErrorMessage, responseHasTechnicalDetail, SAFE_ERRORS } from "@/lib/safeError";

const root = path.resolve(__dirname, "../..");

describe("field aria-describedby", () => {
  it("wires hint and error ids onto the control props", () => {
    expect(fieldDescribedBy("email", { hint: true, error: true })).toBe("email-hint email-error");
    expect(fieldDescribedBy("email", { hint: true, error: false })).toBe("email-hint");
    expect(fieldDescribedBy("email", {})).toBeUndefined();
    expect(controlA11yProps("phone", { hint: true, error: true })).toEqual({
      id: "phone",
      "aria-describedby": "phone-hint phone-error",
      "aria-invalid": true,
    });
  });

  it("Field applies those props to the control", () => {
    const source = readFileSync(path.join(root, "components/ui/Field.tsx"), "utf8");
    expect(source).toContain("controlA11yProps");
    expect(source).toContain("aria-describedby");
    expect(source).toContain("cloneElement");
  });
});

describe("owner redirects", () => {
  it("sends an account with no business to onboarding", () => {
    expect(dashboardRedirectTarget(0)).toBe("/onboarding");
    expect(dashboardRedirectTarget(1)).toBeNull();
  });

  it("sends an account that already has a business to the dashboard", () => {
    expect(onboardingRedirectTarget(1)).toBe("/dashboard");
    expect(onboardingRedirectTarget(0)).toBeNull();
  });
});

describe("runtime and schema guards", () => {
  it("refuses the stub Prisma client when DATABASE_URL is configured", () => {
    expect(allowStubPrismaClient(undefined)).toBe(true);
    expect(allowStubPrismaClient("")).toBe(true);
    expect(allowStubPrismaClient("postgresql://user:pass@localhost:5432/db")).toBe(false);
  });

  it("keeps prisma generate as a production build gate", () => {
    const build = readFileSync(path.join(root, "scripts/build.sh"), "utf8");
    expect(build).toContain('if [ -n "${DATABASE_URL:-}" ]; then');
    expect(build).toContain("npx prisma generate");
    expect(build).not.toContain("prisma migrate reset");
    expect(build).not.toContain("prisma db push");
    const productionBranch = build.split("DATABASE_URL detected — prisma generate failure fails the build")[1]?.split("else")[0] || "";
    expect(productionBranch).toContain("npx prisma generate");
    expect(productionBranch).not.toContain("continuing with fallback");
  });

  it("adds only the authorized Prisma back-relations and does not add a migration", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("ownedBusinesses Business[]");
    expect(schema).toContain("subscriptions Subscription[]");
    const migrations = readdirSync(path.join(root, "prisma/migrations")).filter((name) => name !== "migration_lock.toml");
    // Stage 2 authorises exactly one additional migration: the additive referral attribution
    // schema. Any other new migration directory stays a build failure.
    expect(migrations).toEqual(["20250915000000_init", "20260929000000_referral_stage2"]);
    for (const migration of migrations) {
      const sql = readFileSync(path.join(root, "prisma/migrations", migration, "migration.sql"), "utf8");
      expect(sql.toUpperCase()).not.toContain("DROP TABLE");
      expect(sql.toUpperCase()).not.toContain("TRUNCATE");
    }
    const stage2 = readFileSync(path.join(root, "prisma/migrations/20260929000000_referral_stage2/migration.sql"), "utf8").toUpperCase();
    expect(stage2).not.toContain("DROP ");
    expect(stage2).not.toContain("ALTER COLUMN");
    expect(stage2).not.toContain("DELETE ");
    expect(stage2).not.toContain("UPDATE ");
    expect(stage2).toContain('ALTER TABLE "BUSINESS" ADD COLUMN');
  });

  it("strips technical details from unexpected errors", () => {
    const mapped = publicErrorMessage(new Error("Invalid `prisma.user.create()` invocation ECONNREFUSED DATABASE_URL"), SAFE_ERRORS.registerUnexpected);
    expect(mapped).toEqual({ status: 500, message: SAFE_ERRORS.registerUnexpected });
    expect(responseHasTechnicalDetail(mapped.message)).toBe(false);
  });

  it("keeps the health route dynamic", () => {
    const health = readFileSync(path.join(root, "app/health/route.ts"), "utf8");
    expect(health).toContain('export const dynamic = "force-dynamic"');
  });

  it("onboarding routes to publish only after verified payment", () => {
    const form = readFileSync(path.join(root, "components/OnboardingForm.tsx"), "utf8");
    expect(form).not.toContain("/api/checkout");
    expect(form).toContain("isPublished: true");
    expect(form).toContain("Services & offer");
    // The publish-without-payment escape hatch is gone; the wizard checks payment state first.
    expect(form).not.toContain("Continue without payment");
    expect(form).toContain("Continue to publish");
    expect(form).toContain("subscription payment is confirmed");
  });
});
