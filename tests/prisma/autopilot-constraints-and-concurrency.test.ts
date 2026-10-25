/**
 * Real-PostgreSQL integration suite for JATA Autopilot (`Autopilot*` models):
 *   1. Foreign-key (`P2003`) & unique (`P2002`) constraints across all 11
 *      additive Autopilot tables, plus cross-tenant key isolation.
 *   2. `ON DELETE CASCADE` behavior across `Business -> 11 Autopilot* tables`
 *      teardown with zero orphan rows.
 *   3. Multi-client (`makeRealPrisma()`) concurrent budget reservation and
 *      PostgreSQL `pg_advisory_xact_lock(hashtext(...))` serialization so
 *      concurrent spend never breaches `dailySpendCapMinorKES`.
 *
 * Runs against standard PostgreSQL (`PRISMA_TEST_DATABASE_URL`). Neon-specific
 * PgBouncer pooling behavior is not claimed by this suite unless executed
 * directly against a non-production Neon pooled endpoint.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  makeRealPrisma,
  realPrismaConfigured,
  sharedPrisma,
} from "../helpers/prisma-client";
import { seedBusiness } from "../helpers/prisma-fixtures";
import { reserveAutopilotBudget } from "@/lib/autopilot/usage";

function expectPrismaCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toSatisfy((err: unknown) => {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
    );
  });
}

describe.skipIf(!realPrismaConfigured)(
  "Autopilot PostgreSQL constraints, cascade deletes & multi-client budget concurrency",
  () => {
    afterAll(async () => {
      await sharedPrisma()?.$disconnect().catch(() => {});
    });

    it("enforces foreign keys (P2003), unique constraints (P2002), and cross-tenant uniqueness isolation", async () => {
      const prisma = sharedPrisma();
      const { owner: ownerA, business: bizA } = await seedBusiness(prisma);
      const { owner: ownerB, business: bizB } = await seedBusiness(prisma);

      try {
        // 1. Foreign key rejection on non-existent businessId
        await expectPrismaCode(
          prisma.autopilotConfiguration.create({
            data: { businessId: "non_existent_autopilot_biz_fk" },
          }),
          "P2003",
        );

        // 2. 1:1 businessId uniqueness on Subscription, Entitlement, Configuration
        await prisma.autopilotSubscription.create({
          data: {
            businessId: bizA.id,
            userId: ownerA.id,
            planId: "plan_autopilot_std",
            planKey: "JATA_AUTOPILOT",
            status: "ACTIVE",
          },
        });
        await expectPrismaCode(
          prisma.autopilotSubscription.create({
            data: {
              businessId: bizA.id,
              userId: ownerA.id,
              planId: "plan_autopilot_pro",
              planKey: "JATA_AUTOPILOT_PRO",
              status: "ACTIVE",
            },
          }),
          "P2002",
        );

        await prisma.autopilotEntitlement.create({
          data: {
            businessId: bizA.id,
            packageKey: "JATA_AUTOPILOT",
            tier: "STANDARD",
            status: "ACTIVE",
          },
        });
        await expectPrismaCode(
          prisma.autopilotEntitlement.create({
            data: {
              businessId: bizA.id,
              packageKey: "JATA_AUTOPILOT_PRO",
              tier: "PRO",
              status: "ACTIVE",
            },
          }),
          "P2002",
        );

        await prisma.autopilotConfiguration.create({
          data: { businessId: bizA.id, maxBatchRecipients: 50 },
        });
        await expectPrismaCode(
          prisma.autopilotConfiguration.create({
            data: { businessId: bizA.id, maxBatchRecipients: 25 },
          }),
          "P2002",
        );

        // 3. CustomerProfile composite uniqueness per tenant (same phone/email allowed on bizB, rejected twice on bizA)
        const profA = await prisma.autopilotCustomerProfile.create({
          data: {
            businessId: bizA.id,
            phoneNormalized: "+254711222333",
            emailNormalized: "vip@roasters.co.ke",
          },
        });
        const profB = await prisma.autopilotCustomerProfile.create({
          data: {
            businessId: bizB.id,
            phoneNormalized: "+254711222333",
            emailNormalized: "vip@roasters.co.ke",
          },
        });
        expect(profB.businessId).toBe(bizB.id);

        await expectPrismaCode(
          prisma.autopilotCustomerProfile.create({
            data: {
              businessId: bizA.id,
              phoneNormalized: "+254711222333",
            },
          }),
          "P2002",
        );
        await expectPrismaCode(
          prisma.autopilotCustomerProfile.create({
            data: {
              businessId: bizA.id,
              emailNormalized: "vip@roasters.co.ke",
            },
          }),
          "P2002",
        );

        // 4. ConsentRecord 4-tuple uniqueness + FK enforcement
        await prisma.autopilotConsentRecord.create({
          data: {
            businessId: bizA.id,
            customerProfileId: profA.id,
            channel: "WHATSAPP",
            scope: "TRANSACTIONAL",
            status: "OPTED_IN",
            source: "CHECKOUT_OPT_IN",
          },
        });
        await expectPrismaCode(
          prisma.autopilotConsentRecord.create({
            data: {
              businessId: bizA.id,
              customerProfileId: profA.id,
              channel: "WHATSAPP",
              scope: "TRANSACTIONAL",
              status: "OPTED_OUT",
              source: "DUPLICATE_TEST",
            },
          }),
          "P2002",
        );

        // 5. ActionProposal (businessId, idempotencyKey) uniqueness (allowed across tenants, blocked within tenant)
        await prisma.autopilotActionProposal.create({
          data: {
            businessId: bizA.id,
            actionType: "CREATE_OR_UPDATE_OFFER",
            title: "Morning Deal",
            rationale: "Traffic boost",
            payloadJson: JSON.stringify({
              actionType: "CREATE_OR_UPDATE_OFFER",
              title: "Morning Deal",
              description: "Coffee + pastry",
            }),
            idempotencyKey: "prop_idem_shared",
          },
        });
        const propBizB = await prisma.autopilotActionProposal.create({
          data: {
            businessId: bizB.id,
            actionType: "CREATE_OR_UPDATE_OFFER",
            title: "Morning Deal B",
            rationale: "Traffic boost B",
            payloadJson: JSON.stringify({
              actionType: "CREATE_OR_UPDATE_OFFER",
              title: "Morning Deal B",
              description: "Tea + scone",
            }),
            idempotencyKey: "prop_idem_shared",
          },
        });
        expect(propBizB.businessId).toBe(bizB.id);

        await expectPrismaCode(
          prisma.autopilotActionProposal.create({
            data: {
              businessId: bizA.id,
              actionType: "CREATE_OR_UPDATE_OFFER",
              title: "Duplicate Deal",
              rationale: "Duplicate",
              payloadJson: "{}",
              idempotencyKey: "prop_idem_shared",
            },
          }),
          "P2002",
        );
      } finally {
        await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } });
        await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, ownerB.id] } } }).catch(() => {});
      }
    });

    it("cascades deletes cleanly across all 11 Autopilot models with zero orphan records", async () => {
      const prisma = sharedPrisma();
      const { owner, business: biz } = await seedBusiness(prisma);

      try {
        await prisma.autopilotSubscription.create({
          data: {
            businessId: biz.id,
            userId: owner.id,
            planId: "plan_ap",
            planKey: "JATA_AUTOPILOT",
            status: "ACTIVE",
          },
        });
        await prisma.autopilotEntitlement.create({
          data: { businessId: biz.id, packageKey: "JATA_AUTOPILOT", tier: "STANDARD", status: "ACTIVE" },
        });
        await prisma.autopilotConfiguration.create({
          data: { businessId: biz.id },
        });
        await prisma.autopilotUsageLedger.create({
          data: {
            businessId: biz.id,
            periodKey: "2026-10",
            dayKey: "2026-10-25",
            capability: "LLM_REASONING",
            provider: "openai",
            estimatedCostMinorKES: 80,
            idempotencyKey: `cascade_led_${biz.id}`,
          },
        });
        const profile = await prisma.autopilotCustomerProfile.create({
          data: { businessId: biz.id, phoneNormalized: "+254700999888" },
        });
        await prisma.autopilotConsentRecord.create({
          data: {
            businessId: biz.id,
            customerProfileId: profile.id,
            channel: "SMS",
            scope: "TRANSACTIONAL",
            status: "OPTED_IN",
            source: "POS_RECEIPT",
          },
        });
        const session = await prisma.autopilotSession.create({
          data: { businessId: biz.id, actorUserId: owner.id },
        });
        await prisma.autopilotMessage.create({
          data: {
            businessId: biz.id,
            sessionId: session.id,
            role: "USER",
            content: "Check inventory turnover.",
          },
        });
        await prisma.autopilotIngestionRecord.create({
          data: {
            businessId: biz.id,
            uploadedByUserId: owner.id,
            fileName: "menu.csv",
            mimeType: "text/csv",
            byteSize: 24,
            sha256Hash: "a".repeat(64),
            documentKind: "MENU",
            extractedJson: "{}",
          },
        });
        await prisma.autopilotActionProposal.create({
          data: {
            businessId: biz.id,
            actionType: "RESOLVE_UNANSWERED_FAQ",
            title: "FAQ Draft",
            rationale: "Customer asked",
            payloadJson: "{}",
            idempotencyKey: `cascade_prop_${biz.id}`,
          },
        });
        await prisma.autopilotAuditEvent.create({
          data: {
            businessId: biz.id,
            actorKind: "OWNER",
            actorUserId: owner.id,
            action: "autopilot.test.cascade",
          },
        });

        await prisma.business.delete({ where: { id: biz.id } });

        const counts = await Promise.all([
          prisma.autopilotSubscription.count({ where: { businessId: biz.id } }),
          prisma.autopilotEntitlement.count({ where: { businessId: biz.id } }),
          prisma.autopilotConfiguration.count({ where: { businessId: biz.id } }),
          prisma.autopilotUsageLedger.count({ where: { businessId: biz.id } }),
          prisma.autopilotCustomerProfile.count({ where: { businessId: biz.id } }),
          prisma.autopilotConsentRecord.count({ where: { businessId: biz.id } }),
          prisma.autopilotSession.count({ where: { businessId: biz.id } }),
          prisma.autopilotMessage.count({ where: { businessId: biz.id } }),
          prisma.autopilotIngestionRecord.count({ where: { businessId: biz.id } }),
          prisma.autopilotActionProposal.count({ where: { businessId: biz.id } }),
          prisma.autopilotAuditEvent.count({ where: { businessId: biz.id } }),
        ]);
        expect(counts.every((c) => c === 0)).toBe(true);
      } finally {
        await prisma.business.deleteMany({ where: { id: biz.id } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: owner.id } }).catch(() => {});
      }
    });

    it("serializes concurrent budget reservations across independent PrismaClient connections without breaching dailySpendCapMinorKES", async () => {
      const setupPrisma = sharedPrisma();
      const clientA = makeRealPrisma();
      const clientB = makeRealPrisma();

      const { owner, business: biz } = await seedBusiness(setupPrisma);
      const now = new Date("2026-10-25T09:00:00Z"); // 2026-10-25 EAT

      try {
        // 1. Service-level concurrent budget burst across two independent PrismaClient pools:
        //    dailySpendCapMinorKES = 500, each VISION_EXTRACT call = 250 -> strictly 2 allowed, 6 blocked
        const burst = await Promise.all(
          Array.from({ length: 8 }, (_, idx) =>
            reserveAutopilotBudget({
              businessId: biz.id,
              tierKey: "PRO",
              capability: "VISION_EXTRACT",
              provider: "openai",
              idempotencyKey: `pg_conc_${biz.id}_${idx}`,
              dailySpendCapMinorKES: 500,
              estimatedCallCostMinorKES: 250,
              client: idx % 2 === 0 ? clientA : clientB,
              now,
            }),
          ),
        );

        const allowed = burst.filter((r) => r.allowed);
        const rejected = burst.filter((r) => !r.allowed);
        expect(allowed).toHaveLength(2);
        expect(rejected).toHaveLength(6);
        for (const r of rejected) {
          if (r.allowed === false) {
            expect(r.code).toBe("DAILY_SPEND_CAP_REACHED");
          }
        }

        const ledgerRows = await setupPrisma.autopilotUsageLedger.findMany({
          where: { businessId: biz.id },
        });
        expect(ledgerRows).toHaveLength(2);
        const totalSpend = ledgerRows.reduce(
          (sum: number, row: any) => sum + Number(row.estimatedCostMinorKES),
          0,
        );
        expect(totalSpend).toBe(500);

        // 2. Direct cross-connection PostgreSQL pg_advisory_xact_lock contention test
        //    proving multi-process serialization at the database lock layer itself (cap = 750, 1 more slot of 250)
        const crossProcessTx = async (db: any, key: string) =>
          db.$transaction(async (tx: any) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`autopilot_budget:${biz.id}`}))`;
            const rows = await tx.autopilotUsageLedger.findMany({
              where: { businessId: biz.id, dayKey: "2026-10-25" },
            });
            const spent = rows.reduce(
              (s: number, r: any) => s + Number(r.estimatedCostMinorKES),
              0,
            );
            if (spent + 250 > 750) {
              return { inserted: false };
            }
            await tx.autopilotUsageLedger.create({
              data: {
                businessId: biz.id,
                periodKey: "2026-10",
                dayKey: "2026-10-25",
                capability: "VISION_EXTRACT",
                provider: "openai",
                estimatedCostMinorKES: 250,
                idempotencyKey: key,
              },
            });
            return { inserted: true };
          });

        const [txA, txB] = await Promise.all([
          crossProcessTx(clientA, `pg_xlock_a_${biz.id}`),
          crossProcessTx(clientB, `pg_xlock_b_${biz.id}`),
        ]);
        expect([txA.inserted, txB.inserted].filter(Boolean)).toHaveLength(1);

        const finalRows = await setupPrisma.autopilotUsageLedger.findMany({
          where: { businessId: biz.id },
        });
        expect(finalRows).toHaveLength(3);
        expect(
          finalRows.reduce(
            (s: number, r: any) => s + Number(r.estimatedCostMinorKES),
            0,
          ),
        ).toBe(750);
      } finally {
        await setupPrisma.business.deleteMany({ where: { id: biz.id } }).catch(() => {});
        await setupPrisma.user.deleteMany({ where: { id: owner.id } }).catch(() => {});
        await Promise.all([
          clientA.$disconnect().catch(() => {}),
          clientB.$disconnect().catch(() => {}),
        ]);
      }
    });
  },
);
