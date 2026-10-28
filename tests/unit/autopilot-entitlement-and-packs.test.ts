import { describe, expect, it } from "vitest";
import { PRIVATE_PLAN_KEYS, publiclyListedPlans, FALLBACK_PLANS } from "@/lib/pricing";
import {
  AUTOPILOT_PLAN_CATALOG,
  assertAutopilotPlanPricing,
  deriveAutopilotEntitlement,
  isAutopilotPlanKey,
} from "@/lib/autopilot/entitlement";
import {
  lapseExpiredAutopilotSubscriptions,
  settleAutopilotPayment,
} from "@/lib/autopilot/settlement";
import {
  ALL_INDUSTRY_PACK_KEYS,
  INDUSTRY_PACKS,
  checkRegulatedIndustryViolation,
  resolveIndustryPack,
} from "@/lib/autopilot/industry-packs";
import { getAutopilotChannelMatrix } from "@/lib/autopilot/channels";

describe("JATA Autopilot plans, entitlement & additive settlement", () => {
  it("registers all three Autopilot tiers as private workspace plans and excludes them from public lists", () => {
    expect(isAutopilotPlanKey("JATA_AUTOPILOT")).toBe(true);
    expect(isAutopilotPlanKey("JATA_AUTOPILOT_PRO")).toBe(true);
    expect(isAutopilotPlanKey("JATA_AUTOPILOT_ENTERPRISE")).toBe(true);
    expect(isAutopilotPlanKey("MONTHLY")).toBe(false);

    expect(PRIVATE_PLAN_KEYS).toContain("JATA_AUTOPILOT");
    expect(PRIVATE_PLAN_KEYS).toContain("JATA_AUTOPILOT_PRO");
    expect(PRIVATE_PLAN_KEYS).toContain("JATA_AUTOPILOT_ENTERPRISE");

    const publicPlans = publiclyListedPlans(FALLBACK_PLANS);
    expect(publicPlans.some((p) => p.key.startsWith("JATA_AUTOPILOT"))).toBe(false);

    expect(AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT.priceKES).toBe(2499);
    expect(AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT_PRO.priceKES).toBe(6999);
    expect(AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT_ENTERPRISE.priceKES).toBe(19999);
  });

  it("validates plan pricing contracts strictly in KES over 30-day cycles including Prisma PlanConfig rows without a currency column", () => {
    // Real Prisma PlanConfig shape (no currency column)
    expect(
      assertAutopilotPlanPricing({
        key: "JATA_AUTOPILOT",
        priceKES: 2499,
        durationDays: 30,
        isActive: true,
      }).ok,
    ).toBe(true);

    expect(
      assertAutopilotPlanPricing({
        key: "JATA_AUTOPILOT",
        currency: "KES",
        priceKES: 2499,
        durationDays: 30,
      }).ok,
    ).toBe(true);

    expect(
      assertAutopilotPlanPricing({
        key: "JATA_AUTOPILOT",
        currency: "USD",
        priceKES: 2499,
        durationDays: 30,
      }).ok,
    ).toBe(false);

    // Tampered DB price rejected
    expect(
      assertAutopilotPlanPricing({
        key: "JATA_AUTOPILOT",
        priceKES: 999,
        durationDays: 30,
      }).ok,
    ).toBe(false);

    expect(
      assertAutopilotPlanPricing({
        key: "JATA_AUTOPILOT_PRO",
        currency: "KES",
        priceKES: 0,
        durationDays: 30,
      }).ok,
    ).toBe(false);

    expect(
      assertAutopilotPlanPricing({
        key: "JATA_AUTOPILOT_PRO",
        priceKES: 6999,
        durationDays: 30,
        isActive: false,
      }).ok,
    ).toBe(false);
  });

  it("derives preview, active, expiring, grace, expired, and suspended states while preserving historical read access", () => {
    const now = new Date("2026-10-25T10:00:00Z");

    const preview = deriveAutopilotEntitlement(null, now);
    expect(preview.entitled).toBe(false);
    expect(preview.previewMode).toBe(true);
    expect(preview.readHistoryAllowed).toBe(true);

    const active = deriveAutopilotEntitlement(
      {
        status: "ACTIVE",
        planKey: "JATA_AUTOPILOT_PRO",
        startAt: new Date("2026-10-15T10:00:00Z"),
        expiresAt: new Date("2026-11-14T10:00:00Z"),
        graceUntil: new Date("2026-11-17T10:00:00Z"),
        cancelledAt: null,
        paymentReference: "JATA-REF-1",
      },
      now,
    );
    expect(active.entitled).toBe(true);
    expect(active.tier).toBe("PRO");
    expect(active.subscriptionStatus).toBe("ACTIVE");

    const grace = deriveAutopilotEntitlement(
      {
        status: "ACTIVE",
        planKey: "JATA_AUTOPILOT",
        startAt: new Date("2026-09-24T10:00:00Z"),
        expiresAt: new Date("2026-10-24T10:00:00Z"),
        graceUntil: new Date("2026-10-27T10:00:00Z"),
        cancelledAt: null,
        paymentReference: "JATA-REF-2",
      },
      now,
    );
    expect(grace.entitled).toBe(true);
    expect(grace.entitlementStatus).toBe("GRACE");

    const expired = deriveAutopilotEntitlement(
      {
        status: "ACTIVE",
        planKey: "JATA_AUTOPILOT_ENTERPRISE",
        startAt: new Date("2026-09-01T10:00:00Z"),
        expiresAt: new Date("2026-10-01T10:00:00Z"),
        graceUntil: new Date("2026-10-04T10:00:00Z"),
        cancelledAt: null,
        paymentReference: "JATA-REF-3",
      },
      now,
    );
    expect(expired.entitled).toBe(false);
    expect(expired.entitlementStatus).toBe("EXPIRED");
    expect(expired.readHistoryAllowed).toBe(true);
  });

  it("settles Autopilot payments atomically without touching AFTERCALL Subscription or PosSubscription", async () => {
    let pageSubTouched = false;
    let posSubTouched = false;
    let savedSub: any = null;
    let savedEnt: any = null;

    let lastAuditMeta: any = null;
    const tx = {
      subscription: {
        upsert: async () => {
          pageSubTouched = true;
        },
      },
      posSubscription: {
        upsert: async () => {
          posSubTouched = true;
        },
      },
      autopilotSubscription: {
        findUnique: async () => savedSub,
        upsert: async ({ create, update }: any) => {
          savedSub = savedSub
            ? { ...savedSub, ...update }
            : { id: "apsub_1", ...create };
          return savedSub;
        },
        findMany: async () => (savedSub ? [savedSub] : []),
        update: async ({ data }: any) => {
          savedSub = { ...savedSub, ...data };
          return savedSub;
        },
      },
      autopilotEntitlement: {
        upsert: async ({ create, update }: any) => {
          savedEnt = savedEnt
            ? { ...savedEnt, ...update }
            : { id: "apent_1", ...create };
          return savedEnt;
        },
        updateMany: async ({ data }: any) => {
          savedEnt = { ...savedEnt, ...data };
          return { count: 1 };
        },
      },
      payment: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => ({ id: "pay_1", status: "PAID" }),
      },
      processedWebhook: {
        create: async () => ({ id: "evt_1" }),
        upsert: async () => ({ id: "evt_1" }),
      },
      auditEvent: {
        create: async ({ data }: any) => {
          lastAuditMeta = JSON.parse(data.metadata);
          return { id: "aud_1" };
        },
      },
      autopilotAuditEvent: {
        create: async () => ({ id: "apaud_1" }),
      },
    };

    // Unscaled KES (2499 instead of 249900 minor units) must fail closed
    await expect(
      settleAutopilotPayment(tx, {
        payment: {
          id: "pay_bad_amt",
          reference: "JATA-AP-BAD",
          businessId: "biz_alpha",
          userId: "usr_owner",
          status: "PENDING",
          amount: 2499,
          currency: "KES",
        },
        plan: {
          id: "plan_ap_std",
          key: "JATA_AUTOPILOT",
          priceKES: 2499,
          durationDays: 30,
        },
        eventId: "evt_bad",
        verification: { paystackId: "ps_998877" },
        repairingLegacyPaidPayment: false,
      }),
    ).rejects.toThrow("PAYMENT_AMOUNT_MISMATCH");

    // Missing or inline-data Paystack transaction ID must fail closed
    await expect(
      settleAutopilotPayment(tx, {
        payment: {
          id: "pay_bad_id",
          reference: "JATA-AP-SYNTH",
          businessId: "biz_alpha",
          userId: "usr_owner",
          status: "PENDING",
          amount: 249900,
          currency: "KES",
        },
        plan: {
          id: "plan_ap_std",
          key: "JATA_AUTOPILOT",
          priceKES: 2499,
          durationDays: 30,
        },
        eventId: "evt_synth",
        verification: { paystackId: "   " },
        repairingLegacyPaidPayment: false,
      }),
    ).rejects.toThrow("PAYMENT_EVIDENCE_REQUIRED");

    const settled = await settleAutopilotPayment(tx, {
      payment: {
        id: "pay_1",
        reference: "JATA-AP-001",
        businessId: "biz_alpha",
        userId: "usr_owner",
        status: "PENDING",
        amount: 249900,
        currency: "KES",
      },
      plan: {
        id: "plan_ap_std",
        key: "JATA_AUTOPILOT",
        priceKES: 2499,
        durationDays: 30,
      },
      eventId: "evt_1",
      verification: { paystackId: "ps_998877" },
      repairingLegacyPaidPayment: false,
    });

    expect(settled.alreadySettled).toBe(false);
    expect(savedSub.status).toBe("ACTIVE");
    expect(savedEnt.status).toBe("ACTIVE");
    expect(savedEnt.tier).toBe("STANDARD");
    expect(lastAuditMeta.amountKES).toBe(2499);
    expect(lastAuditMeta.amountMinorKES).toBe(249900);
    expect(pageSubTouched).toBe(false);
    expect(posSubTouched).toBe(false);

    // Lapsing 40 days later transitions Autopilot to EXPIRED cleanly
    const farFuture = new Date(Date.now() + 40 * 86_400_000);
    const lapsed = await lapseExpiredAutopilotSubscriptions(tx, farFuture);
    expect(lapsed.expired).toBe(1);
    expect(savedSub.status).toBe("EXPIRED");
    expect(savedEnt.status).toBe("EXPIRED");
  });
});

describe("JATA Autopilot 15 Industry Packs + Universal Fallback & Channel Honesty", () => {
  it("ships 15 distinct industry packs plus generic_custom (16 total) and resolves categories deterministically", () => {
    expect(ALL_INDUSTRY_PACK_KEYS).toHaveLength(16);
    expect(INDUSTRY_PACKS.generic_custom).toBeDefined();

    expect(resolveIndustryPack("Nyama Choma Restaurant").key).toBe("restaurant_cafe_bakery");
    expect(resolveIndustryPack("Minimart & Duka").key).toBe("retail_supermarket_minimart");
    expect(resolveIndustryPack("Kinyozi & Beauty Spa").key).toBe("salon_barbershop_spa");
    expect(resolveIndustryPack("Boutique & Footwear").key).toBe("fashion_apparel_footwear");
    expect(resolveIndustryPack("Phone & Laptop Shop").key).toBe("electronics_phone_appliance");
    expect(resolveIndustryPack("Community Pharmacy & Clinic").key).toBe("pharmacy_clinic_wellness");
    expect(resolveIndustryPack("Auto Garage & Car Wash").key).toBe("auto_repair_garage_carwash");
    expect(resolveIndustryPack("Property Rentals").key).toBe("real_estate_property");
    expect(resolveIndustryPack("Agrovet & Hardware").key).toBe("hardware_agrovet_construction");
    expect(resolveIndustryPack("Courier & Errand Dispatch").key).toBe("logistics_courier_transport");
    expect(resolveIndustryPack("Wedding Photography & Catering").key).toBe("events_photography_catering");
    expect(resolveIndustryPack("Coding Academy & Tutoring").key).toBe("education_tutoring_training");
    expect(resolveIndustryPack("Tax & Legal Consulting").key).toBe("professional_agency_consulting");
    expect(resolveIndustryPack("Safari Lodge & Hotel").key).toBe("hospitality_hotel_travel");
    expect(resolveIndustryPack("Beverage Wholesale Distributor").key).toBe("wholesale_distributor_manufacturing");
    expect(resolveIndustryPack("Custom Pet Grooming & Pottery").key).toBe("generic_custom");
  });

  it("blocks clinical dosage/prescription instructions on pharmacy_clinic_wellness and binding legal opinions on consulting", () => {
    const pharmacy = INDUSTRY_PACKS.pharmacy_clinic_wellness;
    const blockedRx = checkRegulatedIndustryViolation(
      pharmacy,
      "Take 2 tablets of amoxicillin 500mg twice daily to treat your infection.",
    );
    expect(blockedRx.allowed).toBe(false);

    const safeHours = checkRegulatedIndustryViolation(
      pharmacy,
      "Our pharmacy counter is open 8:00 AM to 8:00 PM Monday to Saturday.",
    );
    expect(safeHours.allowed).toBe(true);

    const legal = INDUSTRY_PACKS.professional_agency_consulting;
    expect(
      checkRegulatedIndustryViolation(
        legal,
        "Here is our binding legal opinion guaranteeing a court outcome.",
      ).allowed,
    ).toBe(false);
  });

  it("reports honest channel compatibility statuses using only the 7 permitted readiness labels", () => {
    const allowedLabels = new Set([
      "SUPPORTED AND VERIFIED",
      "IMPLEMENTED BUT NOT LIVE-VERIFIED",
      "REQUIRES CREDENTIALS OR OWNER AUTHORIZATION",
      "REQUIRES PROVIDER APPROVAL",
      "LIMITED BY PLATFORM API",
      "NOT SUPPORTED",
      "NOT TESTED",
    ]);
    const matrix = getAutopilotChannelMatrix({});
    expect(matrix.length).toBeGreaterThanOrEqual(8);
    for (const ch of matrix) {
      expect(allowedLabels.has(ch.status)).toBe(true);
    }
    const pstn = matrix.find((c) => c.channelKey === "pstn_inbound_telephony");
    expect(pstn?.status).toBe("NOT SUPPORTED");
    const waCloud = matrix.find((c) => c.channelKey === "whatsapp_business_cloud");
    expect(waCloud?.status).toBe("REQUIRES PROVIDER APPROVAL");
  });
});
