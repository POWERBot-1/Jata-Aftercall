import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness, getBusinessRoleForUser } from "@/lib/tenant";
import { getBusinessBrain } from "@/lib/ai-business-brain";
import { evaluateAIReadiness } from "@/lib/ai-readiness";
import { listConversationsForBusiness } from "@/lib/ai-conversation";
import { listLeadsForBusiness } from "@/lib/leads";
import {
  getDemandInsights,
  getTopCustomerQuestions,
  getUnansweredQuestions,
  getQualityEvents,
} from "@/lib/intelligence";
import { listNotificationsForBusiness } from "@/lib/notification";
import { generateAILinkQRCodeSvg, getShareableAILink } from "@/lib/qr";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    const conversationFilter = (searchParams.get("conversationStatus") || "ALL") as
      | "ALL"
      | "ACTIVE"
      | "WAITING_FOR_HUMAN"
      | "CONVERTED"
      | "ABANDONED";

    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const [
      brain,
      readiness,
      orders,
      preorders,
      leads,
      unansweredQuestions,
      demandInsights,
      topCustomerQuestions,
      qualityEvents,
      notifications,
      businessRole,
    ] = await Promise.all([
      getBusinessBrain(businessId),
      evaluateAIReadiness(businessId),
      prisma.order?.findMany?.({
        where: { businessId },
        include: { items: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }).catch(() => []) ?? [],
      prisma.preOrder?.findMany?.({
        where: { businessId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }).catch(() => []) ?? [],
      listLeadsForBusiness(businessId),
      getUnansweredQuestions(businessId),
      getDemandInsights(businessId),
      getTopCustomerQuestions(businessId),
      getQualityEvents(businessId),
      listNotificationsForBusiness(businessId),
      getBusinessRoleForUser(user.id, businessId, user.role),
    ]);

    const conversations = listConversationsForBusiness(businessId, conversationFilter, false);

    // Map notification status onto orders so order status, payment status, and notification status remain distinct (§33, §37)
    const notifByReference = new Map<string, { status: string; retryCount: number }>();
    for (const n of Array.isArray(notifications) ? notifications : []) {
      if (n.referenceId) {
        notifByReference.set(n.referenceId, { status: n.status, retryCount: n.retryCount || 0 });
      }
    }

    const enrichedOrders = (Array.isArray(orders) ? orders : []).map((ord: any) => ({
      ...ord,
      orderStatus: ord.status,
      paymentStatus: ord.paymentStatus || "UNPAID",
      notificationStatus: notifByReference.get(ord.id)?.status || "PENDING",
    }));

    const paidOrdersCount = enrichedOrders.filter((o: any) => o.paymentStatus === "PAID").length;
    const pendingPaymentsCount = enrichedOrders.filter((o: any) => o.paymentStatus !== "PAID").length;
    const humanEscalationsCount =
      conversations.filter((c) => c.status === "WAITING_FOR_HUMAN").length +
      leads.filter((l) => l.classification === "HUMAN_HANDOFF").length;
    const unresolvedQuestions = (Array.isArray(unansweredQuestions) ? unansweredQuestions : []).filter(
      (q: any) => !q.isResolved,
    );

    const shareLink = getShareableAILink(brain.business.slug || businessId);
    const qrSvg = generateAILinkQRCodeSvg(shareLink.url, 200);

    const totalConversations = Math.max(conversations.length, qualityEvents.length);
    const conversionRate =
      totalConversations > 0
        ? Math.min(100, Math.round(((enrichedOrders.length + preorders.length) / totalConversations) * 100))
        : 0;

    return NextResponse.json({
      businessId,
      role: businessRole,
      business: brain.business,
      overview: {
        conversationsCount: totalConversations,
        ordersCreatedCount: enrichedOrders.length,
        paidOrdersCount,
        pendingPaymentsCount,
        preordersCount: Array.isArray(preorders) ? preorders.length : 0,
        humanEscalationsCount,
        unansweredQuestionsCount: unresolvedQuestions.length,
        topCustomerQuestions,
        topRequestedProducts: brain.products.slice(0, 5).map((p) => ({
          id: p.id,
          name: p.name,
          priceKES: p.basePriceKES ?? p.variantPriceKES ?? 0,
          stockStatus: p.stockStatus,
        })),
        topDeliveryZones: brain.delivery.zones.slice(0, 5),
        conversionRate,
      },
      conversations,
      orders: enrichedOrders,
      preorders,
      products: brain.products,
      services: brain.services,
      customers: leads,
      knowledge: {
        faqs: brain.faqs,
        documents: brain.knowledge,
        unansweredQuestions,
        demandInsights,
        conflicts: brain.conflicts,
        knowledgeVersion: brain.knowledgeVersion,
      },
      notifications,
      readiness,
      qr: {
        sharePath: shareLink.path,
        shareUrl: shareLink.url,
        qrSvg,
      },
      controls: {
        operationalStatus: brain.extendedConfig.operationalStatus,
        pauseAllOrdering: brain.extendedConfig.pauseAllOrdering,
        orderingAllowed: brain.extendedConfig.orderingAllowed,
        bookingsAllowed: brain.extendedConfig.bookingsAllowed,
        preordersAllowed: brain.extendedConfig.preordersAllowed,
        toneOfVoice: brain.extendedConfig.toneOfVoice,
        languageBehavior: brain.extendedConfig.languageBehavior,
        greetingMessage: brain.extendedConfig.greetingMessage,
        fallbackMessage: brain.extendedConfig.fallbackMessage,
        afterHoursMessage: brain.extendedConfig.afterHoursMessage,
        escalationRules: brain.extendedConfig.escalationRules,
        delivery: brain.delivery,
        policies: brain.policies,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load AI dashboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
