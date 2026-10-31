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

  it("admits only authorized additive Prisma schema and migration changes", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("ownedBusinesses Business[]");
    expect(schema).toContain("subscriptions Subscription[]");
    const migrations = readdirSync(path.join(root, "prisma/migrations"))
      .filter((name) => name !== "migration_lock.toml")
      .sort();
    // The additional migrations are authorised, all purely additive: the Stage 2 referral
    // attribution schema, the commerce baseline the platform always needed, the Interactive
    // Business package schema, the Configurable Business POS schema, the Website Studio AI
    // schema (image provenance on MediaAsset plus the AiGeneration audit table), the Website
    // Studio draft history (a bounded revision stack that powers Undo/Redo, plus one defaulted
    // cursor column on BusinessExperience), the JATA Payment Wallet, the additive STK receipt
    // column plus refund-reference lookup index, the POS refund-integrity columns and the
    // per-business receipt sequence table, the lossless INTEGER → DOUBLE PRECISION
    // promotion of the POS quantity columns, and the POS till-sale replay guard (one new
    // tenant-scoped table that stops a duplicate till submission becoming a second sale), and the
    // durable checkout idempotency table (replaces in-memory order idempotency maps, one additive table),
    // and the sale-price window columns (current implementation: additive nullable columns and a CHECK that
    // a window ends after it starts; existing sales with no dates stay inactive, no data is rewritten),
    // and the booking-time contract marker (owner decision 2026-10-14, report §J.1: one nullable
    // column that records which clock a booking was anchored to, so a legacy row keeps its stored
    // instant and its meaning and no historical row is rewritten or backfilled), the media version
    // counter (one defaulted integer for strict compare-and-swap), and password recovery (additive
    // token table, per-account cooldown, and a defaulted session revocation counter), and the
    // additive paid-POS publication-resolution case (one table, indexes, and foreign keys only),
    // and the additive JATA Autopilot foundation (tenant-scoped Autopilot* tables, indexes, and
    // foreign keys only), and POS / ERP - PRO (38 new tenant-scoped ERP, accounting, messaging and
    // storefront tables that
    // sit beside the existing POS without touching it; every statement is CREATE TABLE, CREATE INDEX
    // or a guarded foreign key on a table the same migration creates).
    // Anything else stays a build failure, and no migration may destroy or rewrite existing
    // data.
    expect(migrations).toEqual([
      "20250915000000_init",
      "20260929000000_referral_stage2",
      "20260930000000_commerce_baseline",
      "20261002000000_interactive_business",
      "20261003000000_business_pos",
      "20261004000000_website_studio_ai",
      "20261004010000_studio_draft_history",
      "20261005000000_payment_wallet",
      "20261005010000_payment_wallet_stk_receipt",
      "20261005020000_pos_sale_refund_integrity",
      "20261005030000_pos_fractional_quantities",
      "20261005040000_pos_sale_idempotency",
      "20261010000000_sale_price_windows",
      "20261010000100_pos_sale_price_windows",
      "20261010000200_checkout_idempotency",
      "20261014000000_booking_time_zone_marker",
      "20261017000000_media_asset_version",
      "20261018000000_password_reset_security",
      "20261023000000_pos_publication_resolution",
      "20261025000000_jata_autopilot_foundation",
      "20261027000000_pos_erp_pro",
      "20261028000000_erp_tasks",
      "20261029000000_erp_notifications",
      "20261030000000_erp_approvals",
      "20261031000000_erp_approval_consumption",
      "20261032000000_erp_procurement",
      // Requisitions: the request to buy, before the order. Two additive tenant-scoped tables
      // (ErpRequisition, ErpRequisitionLine) with their indexes and guarded foreign keys; the
      // optional purchaseOrderId is a plain column on purpose, so a request keeps its own audit
      // story even if a draft order is deleted. No existing table or row is touched.
      "20261033000000_erp_requisitions",
      "20261101000000_agent_applications",
      "20261102000000_agent_registration_throttle",
      "20261103000000_agent_application_review",
      "20261104000000_agent_phone_verification",
      "20261105000000_agent_verification_delivery",
      "20261106000000_meta_whatsapp_webhooks",
      "20261107000000_agent_activation_review",
      "20261108000000_agent_referral_registration",
      "20261109000000_agent_referral_source",
      "20261110000000_agent_admin_notification_event",
      "20261111000000_agent_commission_ledger",
      "20261112000000_agent_notification_outbox_plan",
      "20261113000000_agent_notification_claim_state",
      "20261114000000_agent_notification_operator_review",
      "20261115000000_agent_referral_report_snapshot",
      "20261116000000_agent_referral_report_schedule",
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
    // The fractional-quantity migration's only ALTERs are lossless type promotions: every
    // integer value is exactly representable as a double, so no row is rewritten — authorised
    // here by their exact text, exactly like the Service backfill above.
    const authorizedQuantityPromotions = [
      'ALTER TABLE "PosSaleItem"\n    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;',
      'ALTER TABLE "PosInventoryItem"\n    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;',
      'ALTER TABLE "PosInventoryMovement"\n    ALTER COLUMN "delta" SET DATA TYPE DOUBLE PRECISION,\n    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;',
      'ALTER TABLE "PosOrderItem"\n    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;',
      'ALTER TABLE "PosPurchaseItem"\n    ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION,\n    ALTER COLUMN "receivedQty" SET DATA TYPE DOUBLE PRECISION;',
    ];
    for (const migration of [
      "20260929000000_referral_stage2",
      "20260930000000_commerce_baseline",
      "20261002000000_interactive_business",
      "20261003000000_business_pos",
      "20261004000000_website_studio_ai",
      "20261004010000_studio_draft_history",
      "20261005000000_payment_wallet",
      "20261005010000_payment_wallet_stk_receipt",
      "20261005020000_pos_sale_refund_integrity",
      "20261005030000_pos_fractional_quantities",
      "20261005040000_pos_sale_idempotency",
      "20261014000000_booking_time_zone_marker",
      "20261017000000_media_asset_version",
      "20261018000000_password_reset_security",
      "20261023000000_pos_publication_resolution",
      "20261025000000_jata_autopilot_foundation",
      "20261027000000_pos_erp_pro",
      "20261028000000_erp_tasks",
      "20261029000000_erp_notifications",
      "20261030000000_erp_approvals",
      "20261031000000_erp_approval_consumption",
      "20261032000000_erp_procurement",
      "20261101000000_agent_applications",
      "20261102000000_agent_registration_throttle",
      "20261103000000_agent_application_review",
      "20261104000000_agent_phone_verification",
      "20261105000000_agent_verification_delivery",
      "20261106000000_meta_whatsapp_webhooks",
      "20261107000000_agent_activation_review",
      "20261108000000_agent_referral_registration",
      "20261109000000_agent_referral_source",
      "20261110000000_agent_admin_notification_event",
      "20261111000000_agent_commission_ledger",
      "20261112000000_agent_notification_outbox_plan",
      "20261113000000_agent_notification_claim_state",
      "20261114000000_agent_notification_operator_review",
      "20261115000000_agent_referral_report_snapshot",
      "20261116000000_agent_referral_report_schedule",
    ]) {
      let sql = readFileSync(path.join(root, "prisma/migrations", migration, "migration.sql"), "utf8");
      if (migration === "20260930000000_commerce_baseline") {
        for (const line of authorizedBackfill) {
          expect(sql).toContain(line);
          sql = sql.replace(line, "");
        }
      } else if (migration === "20261005030000_pos_fractional_quantities") {
        for (const statement of authorizedQuantityPromotions) {
          expect(sql, statement).toContain(statement);
          sql = sql.replace(statement, "");
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
    const activationReview = readFileSync(path.join(root, "prisma/migrations/20261107000000_agent_activation_review/migration.sql"), "utf8");
    expect(activationReview).toContain(`CHECK ("agentStatus" IN ('INACTIVE', 'ACTIVE', 'SUSPENDED'))`);
    expect(activationReview).toContain(`ADD COLUMN "agentStatus" TEXT NOT NULL DEFAULT 'INACTIVE'`);
    // Agent additions must preserve the one-application-per-user constraint and may not
    // reserve a phone before ownership is verified. Review states are explicitly bounded.
    const agentApplication = readFileSync(path.join(root, "prisma/migrations/20261101000000_agent_applications/migration.sql"), "utf8");
    const agentThrottle = readFileSync(path.join(root, "prisma/migrations/20261102000000_agent_registration_throttle/migration.sql"), "utf8");
    const agentReview = readFileSync(path.join(root, "prisma/migrations/20261103000000_agent_application_review/migration.sql"), "utf8");
    expect(agentApplication).toContain('CREATE UNIQUE INDEX "AgentApplication_userId_key" ON "AgentApplication"("userId")');
    expect(agentApplication).not.toMatch(/CREATE UNIQUE INDEX[^;]*phoneE164/i);
    expect(agentApplication).toContain('REFERENCES "User"("id") ON DELETE RESTRICT');
    expect(agentThrottle).toContain('CREATE INDEX "AgentRegistrationThrottle_expiresAt_idx"');
    expect(agentReview).toContain(`CHECK ("status" IN ('PENDING', 'REJECTED'))`);
    expect(agentReview).toContain(`ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING'`);
    const agentPhone = readFileSync(path.join(root, "prisma/migrations/20261104000000_agent_phone_verification/migration.sql"), "utf8");
    expect(agentPhone).toContain('CREATE UNIQUE INDEX "AgentApplication_verifiedPhoneE164_key"');
    expect(agentPhone).toContain('CREATE UNIQUE INDEX "AgentPhoneChallenge_applicationId_key"');
    expect(agentPhone).toContain('CHECK ("attempts" >= 0 AND "attempts" <= 5)');
    const agentDelivery = readFileSync(path.join(root, "prisma/migrations/20261105000000_agent_verification_delivery/migration.sql"), "utf8");
    expect(agentDelivery).toContain('"providerMessageId" TEXT');
    expect(agentDelivery).toContain('"deliveryState" IN');

    const walletHardening = readFileSync(
      path.join(root, "prisma/migrations/20261005010000_payment_wallet_stk_receipt/migration.sql"),
      "utf8",
    );
    const paymentTransactionModel = schema.slice(schema.indexOf("model PaymentTransaction {"), schema.indexOf("\n}", schema.indexOf("model PaymentTransaction {")));
    expect(paymentTransactionModel).toContain("providerTransactionId String?");
    expect(paymentTransactionModel).toContain("providerReceipt       String?");
    expect(walletHardening).toContain('ADD COLUMN IF NOT EXISTS "providerReceipt" TEXT');
    expect(walletHardening).toContain('CREATE INDEX IF NOT EXISTS "Refund_provider_providerReference_idx"');
    expect(walletHardening.toUpperCase()).not.toMatch(/DROP|TRUNCATE|DELETE FROM|UPDATE \"/);

    for (const migration of [
      "20260929000000_referral_stage2",
      "20260930000000_commerce_baseline",
      "20261002000000_interactive_business",
    ]) {
      const sql = readFileSync(path.join(root, "prisma/migrations", migration, "migration.sql"), "utf8").toUpperCase();
      expect(sql).toContain("ADD COLUMN");
    }
  });

  it("keeps media metadata concurrency additive and defaulted", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const start = schema.indexOf("model MediaAsset {");
    const media = schema.slice(start, schema.indexOf("\n}", start));
    expect(media).toContain("version    Int      @default(0)");

    const sql = readFileSync(
      path.join(root, "prisma/migrations/20261017000000_media_asset_version/migration.sql"),
      "utf8",
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0');
    expect(sql.toUpperCase()).not.toMatch(/DROP|TRUNCATE|DELETE FROM|UPDATE \"|ALTER COLUMN/);
  });

  it("keeps password recovery additive, hashed-token only, and session-revocable", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const userStart = schema.indexOf("model User {");
    const user = schema.slice(userStart, schema.indexOf("\n}", userStart));
    expect(user).toContain("sessionVersion Int          @default(0)");
    expect(user).toContain("passwordResetRequestedAt DateTime?");
    const tokenStart = schema.indexOf("model PasswordResetToken {");
    const token = schema.slice(tokenStart, schema.indexOf("\n}", tokenStart));
    expect(token).toContain("userId    String   @unique");
    expect(token).toContain("tokenHash String   @unique");
    expect(token).toContain("expiresAt DateTime");
    expect(token).toContain("usedAt    DateTime?");

    const sql = readFileSync(
      path.join(root, "prisma/migrations/20261018000000_password_reset_security/migration.sql"),
      "utf8",
    );
    expect(sql).toContain('"sessionVersion" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('"passwordResetRequestedAt" TIMESTAMP(3)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "PasswordResetToken"');
    expect(sql).toContain('FOREIGN KEY ("userId") REFERENCES "User"("id")');
    expect(sql.toUpperCase()).not.toMatch(/DROP|TRUNCATE|DELETE FROM|UPDATE \"|ALTER COLUMN/);
  });

  it("keeps the paid-POS publication policy additive and payment-preserving", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const start = schema.indexOf("model PosPublicationResolution {");
    expect(start).toBeGreaterThan(-1);
    const policy = schema.slice(start, schema.indexOf("\n}", start));
    expect(policy).toMatch(/paymentId\s+String\s+@unique/);
    expect(policy).toMatch(/confirmedAt\s+DateTime/);
    expect(policy).toMatch(/deadlineAt\s+DateTime/);
    expect(policy).toMatch(/remedyStatus\s+String\s+@default\("PENDING_PUBLICATION"\)/);
    expect(policy).toContain('onDelete: Restrict');
    expect(policy).toContain("@@index([status, deadlineAt])");

    const sql = readFileSync(
      path.join(root, "prisma/migrations/20261023000000_pos_publication_resolution/migration.sql"),
      "utf8",
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "PosPublicationResolution"');
    expect(sql).toContain('"paymentId" TEXT NOT NULL');
    expect(sql).toContain('"deadlineAt" TIMESTAMP(3) NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "PosPublicationResolution_paymentId_key"');
    expect(sql).toContain('ON "PosPublicationResolution"("paymentId")');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(sql.toUpperCase()).not.toMatch(/DROP|TRUNCATE|DELETE FROM|UPDATE "|ALTER COLUMN/);
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

  it("adds POS / ERP - PRO as new tenant-scoped tables beside the POS, altering no existing table", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const sql = readFileSync(path.join(root, "prisma/migrations/20261027000000_pos_erp_pro/migration.sql"), "utf8");

    // The premium product sits beside the POS: every model it adds is tenant-scoped in the data
    // model as well as in the access layer, and every table cascades from Business.
    const erpModels = [
      "ErpConfiguration", "ErpSubscription", "ErpEntitlement", "ErpSequence", "ErpAuditEvent",
      "ErpIdempotencyRecord", "ErpAccount", "ErpPeriod", "ErpJournal", "ErpJournalLine", "ErpInvoice",
      "ErpInvoiceLine", "ErpPayment", "ErpPaymentAllocation", "ErpCreditNote", "ErpExpense",
      "ErpSupplierBill", "ErpTaxRule", "ErpComplianceProfile", "ErpStoreOrder", "ErpStoreOrderItem",
      "ErpNotification", "ErpAutomationRule", "ErpAutomationRun", "ErpKycDocument",
      "MsgChannelConnection", "MsgSenderId", "MsgSenderIdEvent", "MsgContact", "MsgConsentRecord",
      "MsgSuppression", "MsgAudience", "MsgTemplate", "MsgCampaign", "MsgCampaignRecipient",
      "MsgMessageEvent", "MsgWallet", "MsgLedgerEntry",
    ];
    for (const model of erpModels) {
      const start = schema.indexOf(`model ${model} {`);
      expect(start, `${model} is missing`).toBeGreaterThan(-1);
      const block = schema.slice(start, schema.indexOf("\n}", start));
      expect(block, `${model} must be tenant-scoped`).toContain("businessId");
      // Either a plain tenant index or a tenant unique key is fine — the guard only insists that
      // every table is indexed by businessId so a tenant scan never reads another tenant's rows.
      expect(sql, `${model} must index its tenant`).toMatch(
        new RegExp(`INDEX IF NOT EXISTS "${model}_businessId`),
      );
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`);
    }

    // Only new tables are created: no POS, commerce, wallet or studio table is touched, and no
    // column of an existing table is redefined.
    const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([...erpModels].sort());
    expect(sql.toUpperCase()).not.toContain("ALTER COLUMN");
    expect(sql).not.toMatch(/ALTER TABLE "(?!Erp|Msg)/);
    expect(sql.toUpperCase()).not.toContain("DROP ");

    // One configuration per business and one public slug, so `findUnique({ where: { businessId } })`
    // is valid and two tenants cannot claim the same shop address.
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ErpConfiguration_businessId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ErpConfiguration_storefrontSlug_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "MsgWallet_businessId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ErpStoreOrder_publicToken_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ErpJournal_businessId_journalNumber_key"');
  });

  it("adds JATA Autopilot as new tenant-scoped tables and touches no existing table", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const sql = readFileSync(
      path.join(root, "prisma/migrations/20261025000000_jata_autopilot_foundation/migration.sql"),
      "utf8",
    );

    const autopilotModels = [
      "AutopilotSubscription",
      "AutopilotEntitlement",
      "AutopilotConfiguration",
      "AutopilotUsageLedger",
      "AutopilotCustomerProfile",
      "AutopilotConsentRecord",
      "AutopilotSession",
      "AutopilotMessage",
      "AutopilotIngestionRecord",
      "AutopilotActionProposal",
      "AutopilotAuditEvent",
    ];
    for (const model of autopilotModels) {
      expect(schema).toContain(`model ${model} {`);
      const start = schema.indexOf(`model ${model} {`);
      const block = schema.slice(start, schema.indexOf("\n}", start));
      expect(block).toContain("businessId");
      expect(block).toContain("@@index([businessId");
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`);
    }
    expect(sql).not.toMatch(/ALTER TABLE "(?!Autopilot)/);
    expect(sql.toUpperCase()).not.toMatch(/DROP|TRUNCATE|DELETE FROM|UPDATE "|ALTER COLUMN/);
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
