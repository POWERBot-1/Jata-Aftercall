/**
 * JATA Autopilot — Unified Business Context & Grounded Diagnosis Engine (§5, §7, §14)
 *
 * Strictly separates recorded database facts (`RECORDED`), deterministic
 * arithmetic (`CALCULATED`), explicit directional heuristics (`ESTIMATE`), and
 * absent signals (`MISSING_DATA`). Never invents revenue, customer counts, or
 * inventory figures.
 */

import prisma from "@/lib/db";
import { resolveIndustryPack } from "./industry-packs";
import type {
  DiagnosisFinding,
  GroundedDiagnosisReport,
  GroundedMetric,
} from "./types";

const THIRTY_DAYS_MS = 30 * 86_400_000;

export async function runGroundedBusinessDiagnosis(params: {
  businessId: string;
  explicitIndustryPackKey?: string | null;
  now?: Date;
}): Promise<GroundedDiagnosisReport> {
  const now = params.now ?? new Date();
  const since30d = new Date(now.getTime() - THIRTY_DAYS_MS);

  let business: any = null;
  let orders30d: any[] = [];
  let bookings30d: any[] = [];
  let unansweredQuestions: any[] = [];
  let analytics30dCount = 0;
  let posSales30d: any[] = [];
  let posInventory: any[] = [];
  let posCreditCustomers: any[] = [];
  let consentedProfiles: any[] = [];

  try {
    [
      business,
      orders30d,
      bookings30d,
      unansweredQuestions,
      analytics30dCount,
      posSales30d,
      posInventory,
      posCreditCustomers,
      consentedProfiles,
    ] = await Promise.all([
      prisma.business.findUnique({
        where: { id: params.businessId },
        include: {
          offer: true,
          services: { where: { isActive: true }, take: 25 },
          products: { where: { isActive: true }, take: 50 },
          faqs: { where: { isActive: true }, take: 30 },
        },
      }),
      prisma.order.findMany({
        where: { businessId: params.businessId, createdAt: { gte: since30d } },
        select: { id: true, totalKES: true, paymentStatus: true, status: true, customerName: true },
      }),
      prisma.booking.findMany({
        where: { businessId: params.businessId, createdAt: { gte: since30d } },
        select: { id: true, status: true, paymentStatus: true, serviceName: true },
      }),
      prisma.unansweredQuestion.findMany({
        where: { businessId: params.businessId, isResolved: false },
        orderBy: { askedCount: "desc" },
        take: 10,
      }),
      prisma.analyticsEvent.count({
        where: { businessId: params.businessId, createdAt: { gte: since30d } },
      }),
      prisma.posSale.findMany({
        where: {
          businessId: params.businessId,
          createdAt: { gte: since30d },
          kind: "SALE",
          status: { in: ["COMPLETED", "PARTIALLY_PAID"] },
        },
        select: { id: true, totalKES: true, paidKES: true, balanceKES: true },
      }),
      prisma.posInventoryItem.findMany({
        where: { businessId: params.businessId },
        include: { product: { select: { name: true, isActive: true } } },
      }),
      prisma.posCustomer.findMany({
        where: { businessId: params.businessId, balanceKES: { gt: 0 }, isActive: true },
        select: { id: true, name: true, balanceKES: true },
      }),
      prisma.autopilotConsentRecord.findMany({
        where: { businessId: params.businessId, status: "OPTED_IN" },
        include: { customerProfile: true },
        take: 10,
      }),
    ]);
  } catch {
    // Offline fallback leaves arrays empty and surfaces honest MISSING_DATA markers below.
  }

  const businessName = business?.name ?? "Workspace Business";
  const category = business?.category ?? "General Business";
  const pack =
    params.explicitIndustryPackKey && params.explicitIndustryPackKey !== "generic_custom"
      ? resolveIndustryPack(params.explicitIndustryPackKey)
      : resolveIndustryPack(category);

  const paidOrders = orders30d.filter((o) => o.paymentStatus === "PAID");
  const unpaidOrders = orders30d.filter(
    (o) => o.paymentStatus !== "PAID" && o.status !== "CANCELLED",
  );
  const paidOrderRevenueKES = paidOrders.reduce(
    (sum, o) => sum + Number(o.totalKES || 0),
    0,
  );
  const unpaidBacklogKES = unpaidOrders.reduce(
    (sum, o) => sum + Number(o.totalKES || 0),
    0,
  );
  const posPaidRevenueKES = posSales30d.reduce(
    (sum, s) => sum + Number(s.paidKES || 0),
    0,
  );
  const posReceivablesKES = posCreditCustomers.reduce(
    (sum, c) => sum + Number(c.balanceKES || 0),
    0,
  );

  const lowPosStock = posInventory.filter(
    (item) =>
      item.product?.isActive !== false &&
      Number(item.reorderLevel || 0) > 0 &&
      Number(item.quantity || 0) <= Number(item.reorderLevel || 0),
  );
  const productsList: any[] = Array.isArray(business?.products) ? business.products : [];
  const servicesList: any[] = Array.isArray(business?.services) ? business.services : [];
  const faqsList: any[] = Array.isArray(business?.faqs) ? business.faqs : [];
  const lowStorefrontStock = productsList.filter(
    (p) => typeof p.stockQuantity === "number" && p.stockQuantity <= 2,
  );
  const totalLowStockCount = lowPosStock.length + lowStorefrontStock.length;

  const metrics: GroundedMetric[] = [
    orders30d.length > 0
      ? {
          key: "paid_storefront_revenue_30d",
          label: "Verified Online Revenue (30d)",
          value: paidOrderRevenueKES,
          unit: "KES",
          basis: "RECORDED",
          explanation: `Sum of ${paidOrders.length} provider-verified PAID storefront order(s) in the last 30 days.`,
        }
      : {
          key: "paid_storefront_revenue_30d",
          label: "Verified Online Revenue (30d)",
          value: null,
          unit: "KES",
          basis: "MISSING_DATA",
          explanation: "No storefront orders recorded in the last 30 days.",
        },
    posSales30d.length > 0
      ? {
          key: "pos_paid_revenue_30d",
          label: "POS Collected Revenue (30d)",
          value: posPaidRevenueKES,
          unit: "KES",
          basis: "RECORDED",
          explanation: `Collected across ${posSales30d.length} POS sale receipt(s) in the last 30 days.`,
        }
      : {
          key: "pos_paid_revenue_30d",
          label: "POS Collected Revenue (30d)",
          value: null,
          unit: "KES",
          basis: "MISSING_DATA",
          explanation: "No Business POS sales recorded in the last 30 days.",
        },
    {
      key: "unpaid_order_backlog_kes",
      label: "Unpaid Order Backlog (30d)",
      value: unpaidBacklogKES,
      unit: "KES",
      basis: "CALCULATED",
      explanation: `Arithmetic total across ${unpaidOrders.length} non-cancelled UNPAID order(s). Never counted as revenue until verified.`,
    },
    {
      key: "unanswered_customer_questions",
      label: "Unresolved Front Desk Questions",
      value: unansweredQuestions.length,
      unit: "questions",
      basis: "RECORDED",
      explanation: "Questions customers asked AI Front Desk that lacked an approved Business Brain answer.",
    },
    {
      key: "bookings_30d",
      label: `${pack.terminology.conversionNoun[0].toUpperCase()}${pack.terminology.conversionNoun.slice(1)}s / Bookings (30d)`,
      value: bookings30d.length,
      unit: "bookings",
      basis: "RECORDED",
      explanation: `Recorded bookings in the last 30 days (${bookings30d.filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED").length} confirmed/completed).`,
    },
    posInventory.length > 0 || productsList.some((p) => typeof p.stockQuantity === "number")
      ? {
          key: "low_stock_alerts",
          label: "Low / Reorder Stock Alerts",
          value: totalLowStockCount,
          unit: "items",
          basis: "RECORDED",
          explanation: `${lowPosStock.length} POS stock item(s) at/below reorder level plus ${lowStorefrontStock.length} storefront item(s) <= 2 units.`,
        }
      : {
          key: "low_stock_alerts",
          label: "Low / Reorder Stock Alerts",
          value: null,
          unit: "items",
          basis: "MISSING_DATA",
          explanation: "Stock quantities or POS reorder levels have not been configured yet.",
        },
    analytics30dCount > 0
      ? {
          key: "engagement_to_order_rate",
          label: "Engagement-to-Paid-Order Ratio (30d)",
          value: Number(((paidOrders.length / analytics30dCount) * 100).toFixed(1)),
          unit: "%",
          basis: "CALCULATED",
          explanation: `${paidOrders.length} paid order(s) divided by ${analytics30dCount} recorded storefront engagement event(s).`,
        }
      : {
          key: "engagement_to_order_rate",
          label: "Engagement-to-Paid-Order Ratio (30d)",
          value: null,
          unit: "%",
          basis: "MISSING_DATA",
          explanation: "Insufficient storefront analytics events in the last 30 days to compute conversion.",
        },
    {
      key: "pos_customer_receivables",
      label: "POS Customer Credit Receivables",
      value: posReceivablesKES,
      unit: "KES",
      basis: "RECORDED",
      explanation: `Outstanding credit balance across ${posCreditCustomers.length} active POS customer account(s).`,
    },
  ];

  const findings: DiagnosisFinding[] = [];
  const dataGaps: string[] = [];
  const suggestedProposals: GroundedDiagnosisReport["suggestedProposals"] = [];

  if (!business) {
    dataGaps.push(
      "Business profile could not be loaded from the database (offline preview or unseeded workspace).",
    );
  } else {
    if (productsList.length === 0 && servicesList.length === 0) {
      dataGaps.push(
        `No active ${pack.terminology.offeringNoun}s are listed yet — add products or services so Autopilot and AI Front Desk can quote accurate prices.`,
      );
    }
    if (faqsList.length === 0) {
      dataGaps.push(
        "Zero approved FAQs in Business Brain — customer questions about hours, delivery, or policies may require manual handoff.",
      );
    }
  }

  // Finding 1: Unanswered customer questions -> RESOLVE_UNANSWERED_FAQ
  if (unansweredQuestions.length > 0) {
    const topQ = unansweredQuestions[0];
    findings.push({
      id: "finding_unanswered_faqs",
      severity: "BOTTLENECK",
      title: `${unansweredQuestions.length} unanswered ${pack.terminology.customerNoun} question(s) blocking instant conversion`,
      summary: `Top unanswered question asked ${topQ.askedCount} time(s): "${topQ.question}". Approving an authoritative FAQ lets AI Front Desk answer immediately next time.`,
      basis: "RECORDED",
      evidence: unansweredQuestions
        .slice(0, 3)
        .map((q) => `"${q.question}" (asked ${q.askedCount}x)`),
      recommendedActionType: "RESOLVE_UNANSWERED_FAQ",
    });

    const groundedHours = business?.location
      ? `We serve ${pack.terminology.customerNoun}s from ${business.location}. Contact us via our page or WhatsApp for current availability and exact pricing.`
      : `Please check our live page catalogue or message our team directly for current availability and exact pricing.`;

    suggestedProposals.push({
      actionType: "RESOLVE_UNANSWERED_FAQ",
      riskCategory: "LOW_RISK_DRAFT",
      title: `Approve FAQ answer for: "${String(topQ.question).slice(0, 60)}"`,
      rationale: `Asked ${topQ.askedCount} time(s) by customers without an approved Business Brain response.`,
      expectedImpact:
        "Eliminates repeated Front Desk handoffs on this question (qualitative responsiveness improvement).",
      payload: {
        actionType: "RESOLVE_UNANSWERED_FAQ",
        unansweredQuestionId: topQ.id,
        question: String(topQ.question),
        answer: groundedHours,
      },
      idempotencyKey: `diag_faq_${params.businessId}_${topQ.id}`,
    });
  }

  // Finding 2: Missing or inactive featured Offer -> CREATE_OR_UPDATE_OFFER
  const hasActiveOffer = Boolean(business?.offer?.isActive && business?.offer?.title);
  if (!hasActiveOffer) {
    const featuredItem =
      productsList[0]?.name || servicesList[0]?.title || `featured ${pack.terminology.offeringNoun}`;
    findings.push({
      id: "finding_no_active_offer",
      severity: "OPPORTUNITY",
      title: "No active storefront spotlight offer is published",
      summary: `Publishing a zero-discount spotlight offer for "${featuredItem}" gives visiting ${pack.terminology.customerNoun}s a clear call-to-action without eroding margin.`,
      basis: "RECORDED",
      evidence: ["Business.offer is absent or inactive"],
      recommendedActionType: "CREATE_OR_UPDATE_OFFER",
    });

    suggestedProposals.push({
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      title: `Publish spotlight offer featuring ${featuredItem}`,
      rationale: `Storefront currently has no active Offer banner; ${pack.upsellGuidance}`,
      expectedImpact:
        "Increases call-to-action visibility on the public business page without price discounting (0% discount).",
      payload: {
        actionType: "CREATE_OR_UPDATE_OFFER",
        title: `Featured: ${featuredItem}`,
        description: `Ask about ${featuredItem} today — direct booking & enquiry available on our page.`,
        badgeText: "Featured",
        ctaLabel: "Enquire now",
        discountPercent: 0,
        validUntilIso: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
      },
      idempotencyKey: `diag_offer_${params.businessId}_${now.toISOString().slice(0, 10)}`,
    });
  }

  // Finding 3: Unpaid order backlog
  if (unpaidOrders.length > 0) {
    findings.push({
      id: "finding_unpaid_orders",
      severity: "BOTTLENECK",
      title: `${unpaidOrders.length} unpaid order(s) worth KES ${unpaidBacklogKES.toLocaleString()} awaiting verified payment`,
      summary:
        "Customers started checkout without completing provider-verified payment. Autopilot never marks these paid from screenshots; send a consented transactional check-in if opted in.",
      basis: "CALCULATED",
      evidence: [`${unpaidOrders.length} UNPAID order(s), total KES ${unpaidBacklogKES.toLocaleString()}`],
      recommendedActionType: "QUEUE_CONSENTED_FOLLOWUP",
    });
  }

  // Finding 4: Low stock alerts
  if (totalLowStockCount > 0) {
    const sampleNames = [
      ...lowPosStock.map((i) => i.product?.name).filter(Boolean),
      ...lowStorefrontStock.map((p) => p.name).filter(Boolean),
    ].slice(0, 4);
    findings.push({
      id: "finding_low_stock",
      severity: "RISK",
      title: `${totalLowStockCount} item(s) at or below reorder threshold`,
      summary: `Restock soon to avoid lost ${pack.terminology.conversionNoun}s on ${sampleNames.join(", ") || "flagged SKUs"}.`,
      basis: "RECORDED",
      evidence: sampleNames.map((n) => `Low stock: ${n}`),
    });
  }

  // Finding 5: Consented follow-up candidate if opted-in profile exists
  if (consentedProfiles.length > 0) {
    const firstConsent = consentedProfiles[0];
    const profile = firstConsent.customerProfile;
    if (profile && (profile.phoneNormalized || profile.emailNormalized)) {
      suggestedProposals.push({
        actionType: "QUEUE_CONSENTED_FOLLOWUP",
        riskCategory: "MEDIUM_RISK_REVERSIBLE",
        title: `Queue consented ${firstConsent.channel} check-in for ${profile.displayName || profile.phoneNormalized || profile.emailNormalized}`,
        rationale: `Customer holds verified OPTED_IN (${firstConsent.scope}) consent on ${firstConsent.channel}.`,
        expectedImpact: `Re-engages opted-in ${pack.terminology.customerNoun} within EAT quiet-hour and consent rules.`,
        payload: {
          actionType: "QUEUE_CONSENTED_FOLLOWUP",
          recipientName: profile.displayName ?? undefined,
          recipientPhone: profile.phoneNormalized ?? undefined,
          recipientEmail: profile.recipientEmail ?? profile.emailNormalized ?? undefined,
          channel: (firstConsent.channel === "EMAIL" || firstConsent.channel === "SMS"
            ? firstConsent.channel
            : "WHATSAPP") as "WHATSAPP" | "SMS" | "EMAIL",
          scope: firstConsent.scope === "MARKETING" ? "MARKETING" : "TRANSACTIONAL",
          subject: `Update from ${businessName}`,
          body: `Hello${profile.displayName ? ` ${profile.displayName}` : ""}, thank you for connecting with ${businessName}. Reply any time if we can assist with your next ${pack.terminology.conversionNoun}, or reply STOP to opt out.`,
          discountPercent: 0,
          batchRecipientCount: 1,
        },
        idempotencyKey: `diag_followup_${params.businessId}_${profile.id}_${now.toISOString().slice(0, 10)}`,
      });
    }
  }

  if (pack.regulatedGuardrail) {
    findings.push({
      id: "finding_regulated_guardrail",
      severity: "RISK",
      title: `${pack.name} safety boundary active`,
      summary: pack.regulatedGuardrail.ownerNotice,
      basis: "RECORDED",
      evidence: [`Guardrail code: ${pack.regulatedGuardrail.code}`],
    });
  }

  const healthSummary =
    orders30d.length === 0 && posSales30d.length === 0 && bookings30d.length === 0
      ? `${businessName} (${pack.name}) has 0 recorded orders, POS sales, or bookings in the last 30 days. Focus on publishing clear offerings, resolving ${unansweredQuestions.length} unanswered Front Desk question(s), and activating a featured offer.`
      : `${businessName} (${pack.name}) recorded KES ${(paidOrderRevenueKES + posPaidRevenueKES).toLocaleString()} in verified 30-day revenue (${paidOrders.length} online paid order(s), ${posSales30d.length} POS sale(s), ${bookings30d.length} booking(s)), with ${unansweredQuestions.length} unanswered question(s) and ${totalLowStockCount} low-stock alert(s).`;

  return {
    businessId: params.businessId,
    businessName,
    category,
    industryPackKey: pack.key,
    industryPackName: pack.name,
    generatedAt: now.toISOString(),
    healthSummary,
    metrics,
    findings,
    dataGaps,
    suggestedProposals,
  };
}
