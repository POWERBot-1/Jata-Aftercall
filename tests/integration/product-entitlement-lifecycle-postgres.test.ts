import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProductEntitlementLifecycleReport } from "@/lib/admin/product-entitlement-reconciliation-store";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `product-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const expiresAt = new Date(Date.now() + 20 * 86_400_000);
const graceUntil = new Date(Date.now() + 23 * 86_400_000);
let client: any;
let ownerId = "";
const businessIds: string[] = [];
const paymentIds: string[] = [];
const coreSubscriptionIds: string[] = [];
const planIds: string[] = [];
const productRows: { model: string; id: string }[] = [];

describe.skipIf(!enabled)("six-product entitlement lifecycle inventory on PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    const owner = await client.user.create({
      data: { email: `${stamp}@example.test`, name: "Lifecycle Fixture", passwordHash: "not-a-real-login" },
    });
    ownerId = owner.id;
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      for (const row of productRows.reverse()) {
        await (client as any)[row.model].deleteMany({ where: { id: row.id } }).catch(() => undefined);
      }
      if (coreSubscriptionIds.length) {
        await client.subscription.deleteMany({ where: { id: { in: coreSubscriptionIds } } });
      }
      if (paymentIds.length) await client.payment.deleteMany({ where: { id: { in: paymentIds } } });
      if (businessIds.length) await client.business.deleteMany({ where: { id: { in: businessIds } } });
      if (planIds.length) await client.planConfig.deleteMany({ where: { id: { in: planIds } } });
      if (ownerId) await client.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    } finally {
      await client.$disconnect?.();
    }
  }, 60_000);

  it("reads all six product families without changing subscription, entitlement, or payment rows", async () => {
    // The candidate rehearsal runs the repository seed before integration tests.
    // Compare against the pre-fixture inventory so unrelated seeded product pairs
    // do not make this six-fixture assertion brittle.
    const baselineReport = await loadProductEntitlementLifecycleReport(client);
    const specs = [
      { product: "WEBSITE_STUDIO", slug: "website", planKey: "INTERACTIVE_BUSINESS", subscriptionModel: "subscription", entitlementModel: "interactiveBusinessEntitlement", entitlementData: { packageKey: "INTERACTIVE_BUSINESS" }, core: true },
      { product: "AI_FRONT_DESK", slug: "ai", planKey: "AI_FRONT_DESK_STANDARD", subscriptionModel: "subscription", entitlementModel: "aIPackageEntitlement", entitlementData: { packageKey: "AI_FRONT_DESK_STANDARD" }, core: true },
      { product: "BUSINESS_POS", slug: "pos", planKey: "BUSINESS_POS", subscriptionModel: "posSubscription", entitlementModel: "posEntitlement", entitlementData: { packageKey: "BUSINESS_POS" } },
      { product: "AUTOPILOT", slug: "autopilot", planKey: "JATA_AUTOPILOT", subscriptionModel: "autopilotSubscription", entitlementModel: "autopilotEntitlement", entitlementData: { packageKey: "JATA_AUTOPILOT", tier: "STANDARD" } },
      { product: "MJENGO_OS", slug: "mjengo", planKey: "MJENGO_OS", subscriptionModel: "mjengoSubscription", entitlementModel: "mjengoEntitlement", entitlementData: { packageKey: "MJENGO_OS" } },
      { product: "ERP_PRO", slug: "erp-pro", planKey: "ERP_PRO", subscriptionModel: "erpProSubscription", entitlementModel: "erpProEntitlement", entitlementData: { packageKey: "ERP_PRO" } },
    ] as const;

    for (const spec of specs) {
      const business = await client.business.create({
        data: { ownerId, slug: `${stamp}-${spec.slug}`, name: `Lifecycle ${spec.slug}`, category: "retail" },
      });
      businessIds.push(business.id);

      let planId: string;
      if ("core" in spec && spec.core) {
        // The lifecycle adapter recognizes canonical product keys. Reuse an existing
        // canonical plan when present; otherwise create and clean up an isolated fixture.
        const existingPlan = await client.planConfig.findUnique({ where: { key: spec.planKey } });
        const plan = existingPlan ?? await client.planConfig.create({
          data: { key: spec.planKey, name: `Lifecycle ${spec.slug}`, priceKES: 499, durationDays: 30, isActive: true },
        });
        if (!existingPlan) planIds.push(plan.id);
        planId = plan.id;
      } else {
        planId = spec.planKey;
      }

      const reference = `${stamp}-${spec.slug}-settlement`;
      const payment = await client.payment.create({
        data: {
          reference, businessId: business.id, userId: ownerId, planId,
          amount: 49_900, currency: "KES", status: "PAID", purpose: "SUBSCRIPTION",
          environment: "LIVE", reconciliationStatus: "MATCHED",
          providerSettledAt: new Date(), providerSettlementReference: reference,
        },
      });
      paymentIds.push(payment.id);

      const common = {
        businessId: business.id, userId: ownerId, planId, status: "ACTIVE",
        startAt: new Date(), expiresAt, graceUntil, paymentId: payment.id, paymentReference: reference,
      };
      if ("core" in spec && spec.core) {
        const subscription = await client.subscription.create({ data: common });
        coreSubscriptionIds.push(subscription.id);
      } else {
        const subscription = await (client as any)[spec.subscriptionModel].create({
          data: { ...common, planKey: spec.planKey },
        });
        productRows.push({ model: spec.subscriptionModel, id: subscription.id });
      }

      const entitlement = await (client as any)[spec.entitlementModel].create({
        data: {
          businessId: business.id,
          status: "ACTIVE",
          expiresAt,
          ...spec.entitlementData,
        },
      });
      productRows.push({ model: spec.entitlementModel, id: entitlement.id });
    }

    const before = {
      payments: await client.payment.count({ where: { id: { in: paymentIds } } }),
      coreSubscriptions: await client.subscription.count({ where: { id: { in: coreSubscriptionIds } } }),
      businesses: await client.business.count({ where: { id: { in: businessIds } } }),
      productRows: await Promise.all(
        [...new Set(productRows.map((row) => row.model))].map(async (model) => ({
          model,
          count: await (client as any)[model].count({
            where: { id: { in: productRows.filter((row) => row.model === model).map((row) => row.id) } },
          }),
        })),
      ),
    };

    const report = await loadProductEntitlementLifecycleReport(client);

    const after = {
      payments: await client.payment.count({ where: { id: { in: paymentIds } } }),
      coreSubscriptions: await client.subscription.count({ where: { id: { in: coreSubscriptionIds } } }),
      businesses: await client.business.count({ where: { id: { in: businessIds } } }),
      productRows: await Promise.all(
        [...new Set(productRows.map((row) => row.model))].map(async (model) => ({
          model,
          count: await (client as any)[model].count({
            where: { id: { in: productRows.filter((row) => row.model === model).map((row) => row.id) } },
          }),
        })),
      ),
    };

    expect(report.scope).toBe("READ_ONLY_PRODUCT_ENTITLEMENT_INVENTORY");
    expect(report.productsReviewed).toBe(6);
    expect(report.businessProductPairsReviewed - baselineReport.businessProductPairsReviewed).toBe(6);
    expect(report.findings.filter((finding) => businessIds.includes(finding.businessId))).toEqual([]);
    expect(after).toEqual(before);
  }, 60_000);
});
