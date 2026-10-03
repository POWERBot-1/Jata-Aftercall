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
    // Four additional migrations are authorised, all purely additive: the Stage 2 referral
    // attribution schema, the commerce baseline the platform always needed, the Interactive
    // Business package schema, and the Configurable Business POS schema. Anything else stays a
    // build failure, and no migration may destroy or rewrite existing data.
    expect(migrations).toEqual([
      "20250915000000_init",
      "20260929000000_referral_stage2",
      "20260930000000_commerce_baseline",
      "20261002000000_interactive_business",
      "20261003000000_business_pos",
    ]);
    for (const migration of migrations) {
      const sql = readFileSync(path.join(root, "prisma/migrations", migration, "migration.sql"), "utf8");
      expect(sql.toUpperCase()).not.toContain("DROP TABLE");
      expect(sql.toUpperCase()).not.toContain("TRUNCATE");
    }
    // The commerce baseline adds "Service.updatedAt" and has to fill it from "createdAt" before
    // it can be made NOT NULL. That is a backfill of a brand-new column, not a rewrite of
    // existing data, so it is authorised here by its exact text — and any *other* UPDATE or
    // ALTER COLUMN, in that migration or any future one, still fails this guard.
    const authorizedBackfill = [
      'UPDATE "Service" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;',
      'ALTER TABLE "Service" ALTER COLUMN "updatedAt" SET NOT NULL;',
    ];
    for (const migration of [
      "20260929000000_referral_stage2",
      "20260930000000_commerce_baseline",
      "20261002000000_interactive_business",
      "20261003000000_business_pos",
    ]) {
      let sql = readFileSync(path.join(root, "prisma/migrations", migration, "migration.sql"), "utf8");
      if (migration === "20260930000000_commerce_baseline") {
        for (const line of authorizedBackfill) {
          expect(sql).toContain(line);
          sql = sql.replace(line, "");
        }
      } else {
        // Every other migration leaves existing rows and column definitions completely alone.
        expect(sql).not.toContain("ALTER COLUMN");
        expect(sql).not.toContain("UPDATE \"");
      }
      sql = sql.toUpperCase();
      // Additive only: new columns, tables, foreign keys and indexes — never data loss.
      expect(sql).not.toContain("DROP ");
      expect(sql).not.toContain("ALTER COLUMN");
      expect(sql).not.toContain("DELETE FROM");
      expect(sql).not.toContain("UPDATE \"");
    }
    for (const migration of [
      "20260929000000_referral_stage2",
      "20260930000000_commerce_baseline",
      "20261002000000_interactive_business",
    ]) {
      const sql = readFileSync(path.join(root, "prisma/migrations", migration, "migration.sql"), "utf8").toUpperCase();
      expect(sql).toContain("ADD COLUMN");
    }
  });

  it("adds the Business POS as new tenant-scoped tables and touches no existing table", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const sql = readFileSync(
      path.join(root, "prisma/migrations/20261003000000_business_pos/migration.sql"),
      "utf8",
    );

    // Every POS model is tenant-scoped by businessId, so isolation is enforced in the data
    // model as well as in the access layer (POS spec §5, §75).
    const posModels = [
      "PosConfiguration", "PosConfigurationVersion", "PosSubscription", "PosEntitlement", "PosTemplate",
      "PosBranch", "PosStaff", "PosProduct", "PosInventoryItem", "PosInventoryMovement",
      "PosCustomer", "PosCustomerAsset", "PosSupplier", "PosSale", "PosSaleItem", "PosPayment",
      "PosCreditEntry", "PosExpense", "PosPurchase", "PosPurchaseItem", "PosOrder", "PosOrderItem",
      "PosOrderEvent", "PosAuditEvent",
    ];
    for (const model of posModels) {
      expect(schema).toContain(`model ${model} {`);
      const start = schema.indexOf(`model ${model} {`);
      const block = schema.slice(start, schema.indexOf("\n}", start));
      expect(block).toContain("businessId");
      expect(block).toContain("@@index([businessId");
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`);
    }

    // The migration is guarded and never rewrites history: sales keep their receipt numbers,
    // configuration history is append-only, and money stays in whole shillings (POS §32, §48, §54).
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "PosSale_businessId_createdAt_idx"');
    expect(sql).toContain('"PosSale_businessId_receiptNumber_key" UNIQUE ("businessId","receiptNumber")');
    expect(sql).toContain('"PosConfigurationVersion_businessId_version_key" UNIQUE ("businessId","version")');
    expect(sql).not.toMatch(/ALTER TABLE "(?!Pos)/);
    expect(schema).toContain("posConfiguration         PosConfiguration?");
    expect(schema).toContain("posSales                 PosSale[]");
  });

  it("extends the schema additively for the Interactive Business package", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    // Every Interactive model is tenant-scoped, so isolation is enforced in the data model.
    for (const model of ["BusinessExperience", "ExperienceVersion", "Booking", "MediaAsset", "InteractiveBusinessEntitlement", "ProductVariant"]) {
      expect(schema).toContain(`model ${model} {`);
    }
    const sql = readFileSync(
      path.join(root, "prisma/migrations/20261002000000_interactive_business/migration.sql"),
      "utf8",
    ).toUpperCase();
    // Guarded with IF NOT EXISTS so the migration is safe on a database provisioned
    // outside the migration history.
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "BOOKING"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "EXPERIENCEVERSION"');
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
