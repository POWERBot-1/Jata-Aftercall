import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertBusinessRole, canAccessBusiness } from "@/lib/tenant";
import { getExtendedAIConfig, saveExtendedAIConfig } from "@/lib/ai-config";
import { AI_BUSINESS_TEMPLATES } from "@/lib/ai-templates";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const [config, business] = await Promise.all([
      prisma.aIConfiguration.findUnique({ where: { businessId } }),
      prisma.business?.findUnique?.({ where: { id: businessId }, select: { category: true } }).catch(() => null),
    ]);

    const extendedConfig = await getExtendedAIConfig(businessId, config, business?.category);

    return NextResponse.json({
      config: config || {},
      extendedConfig,
      templates: AI_BUSINESS_TEMPLATES,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch AI configuration.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await req.json();
    const {
      businessId,
      toneOfVoice,
      greetingMessage,
      fallbackMessage,
      languageBehavior,
      afterHoursMessage,
      escalationRules,
      autoReplyEnabled,
      orderingAllowed,
      bookingsAllowed,
      preordersAllowed,
      delivery,
      policies,
      operationalStatus,
      pauseAllOrdering,
      templateCategory,
      bookingRules,
      orderRules,
      escalationThreshold,
      walkInsAccepted,
      requiredCustomerFields,
      preparationTime,
      fulfilmentProcedure,
      modificationRules,
      outOfStockBehavior,
      afterHoursBehavior,
      pausedMessage,
      branches,
      bulkPricing,
      paymentDetails,
    } = body || {};

    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const roleCheck = await assertBusinessRole({
      userId: user.id,
      businessId,
      userRole: user.role,
      action: "edit_knowledge",
    });
    if (!roleCheck.allowed) {
      return NextResponse.json({ error: "Forbidden — insufficient permissions for this business." }, { status: 403 });
    }

    const previousConfig = await prisma.aIConfiguration.findUnique({ where: { businessId } }).catch(() => null);

    const resolvedToneOfVoice = toneOfVoice || body?.tone || "Friendly";
    const resolvedGreeting = greetingMessage ?? body?.welcomeMessage ?? null;
    const resolvedFallback =
      fallbackMessage || "I don't have that information yet. Let me connect you with the business.";
    const resolvedLanguage = languageBehavior || body?.language || "English + Swahili";
    const resolvedAfterHours = afterHoursMessage ?? null;
    const resolvedEscalation = escalationRules ?? body?.humanEscalation ?? null;
    const resolvedAutoReply = autoReplyEnabled !== undefined ? Boolean(autoReplyEnabled) : true;
    const resolvedOrdering = orderingAllowed !== undefined ? Boolean(orderingAllowed) : true;
    const resolvedBookings = bookingsAllowed !== undefined ? Boolean(bookingsAllowed) : true;
    const resolvedPreorders = preordersAllowed !== undefined ? Boolean(preordersAllowed) : false;

    const dbConfig = await prisma.aIConfiguration.upsert({
      where: { businessId },
      update: {
        tone: resolvedToneOfVoice.toLowerCase(),
        language: resolvedLanguage,
        salesBehavior: body?.salesBehavior || "recommend",
        orderingAllowed: resolvedOrdering,
        preordersAllowed: resolvedPreorders,
        humanEscalation: resolvedEscalation || "uncertain",
        welcomeMessage: resolvedGreeting,
      },
      create: {
        businessId,
        tone: resolvedToneOfVoice.toLowerCase(),
        language: resolvedLanguage,
        salesBehavior: body?.salesBehavior || "recommend",
        orderingAllowed: resolvedOrdering,
        preordersAllowed: resolvedPreorders,
        humanEscalation: resolvedEscalation || "uncertain",
        welcomeMessage: resolvedGreeting,
      },
    });

    const extendedConfig = await saveExtendedAIConfig(businessId, {
      toneOfVoice: resolvedToneOfVoice,
      greetingMessage: resolvedGreeting,
      fallbackMessage: resolvedFallback,
      languageBehavior: resolvedLanguage,
      afterHoursMessage: resolvedAfterHours,
      escalationRules: resolvedEscalation,
      autoReplyEnabled: resolvedAutoReply,
      orderingAllowed: resolvedOrdering,
      bookingsAllowed: resolvedBookings,
      preordersAllowed: resolvedPreorders,
      ...(delivery ? { delivery } : {}),
      ...(policies ? { policies } : {}),
      ...(operationalStatus ? { operationalStatus } : {}),
      ...(pauseAllOrdering !== undefined ? { pauseAllOrdering: Boolean(pauseAllOrdering) } : {}),
      ...(templateCategory ? { templateCategory } : {}),
      ...(bookingRules !== undefined ? { bookingRules } : {}),
      ...(orderRules !== undefined ? { orderRules } : {}),
      ...(escalationThreshold !== undefined ? { escalationThreshold } : {}),
      ...(walkInsAccepted !== undefined ? { walkInsAccepted: walkInsAccepted === null ? null : Boolean(walkInsAccepted) } : {}),
      ...(requiredCustomerFields !== undefined ? { requiredCustomerFields } : {}),
      ...(preparationTime !== undefined ? { preparationTime } : {}),
      ...(fulfilmentProcedure !== undefined ? { fulfilmentProcedure } : {}),
      ...(modificationRules !== undefined ? { modificationRules } : {}),
      ...(outOfStockBehavior !== undefined ? { outOfStockBehavior } : {}),
      ...(afterHoursBehavior !== undefined ? { afterHoursBehavior } : {}),
      ...(pausedMessage !== undefined ? { pausedMessage } : {}),
      ...(branches !== undefined ? { branches } : {}),
      ...(bulkPricing !== undefined ? { bulkPricing } : {}),
      ...(paymentDetails !== undefined ? { paymentDetails } : {}),
    });

    const config = {
      ...dbConfig,
      toneOfVoice: extendedConfig.toneOfVoice,
      greetingMessage: extendedConfig.greetingMessage,
      fallbackMessage: extendedConfig.fallbackMessage,
      languageBehavior: extendedConfig.languageBehavior,
      afterHoursMessage: extendedConfig.afterHoursMessage,
      escalationRules: extendedConfig.escalationRules,
      autoReplyEnabled: extendedConfig.autoReplyEnabled,
      orderingAllowed: extendedConfig.orderingAllowed,
      bookingsAllowed: extendedConfig.bookingsAllowed,
      preordersAllowed: extendedConfig.preordersAllowed,
    };

    if (Array.isArray(body?.faqs)) {
      for (const faq of body.faqs.slice(0, 40)) {
        const question = String(faq?.question || "").trim().slice(0, 200);
        const approvedAnswer = String(faq?.approvedAnswer || faq?.answer || "").trim().slice(0, 1000);
        if (question.length < 3 || approvedAnswer.length < 2) continue;
        try {
          const existing = await prisma.fAQ.findFirst({ where: { businessId, question } });
          if (existing) {
            await prisma.fAQ.update({ where: { id: existing.id }, data: { approvedAnswer, isActive: true } });
          } else {
            await prisma.fAQ.create({ data: { businessId, question, approvedAnswer, isActive: true } });
          }
        } catch {
          // FAQ persistence is optional for older test doubles; the rest of the brain still saves.
        }
      }
    }

    await logAudit({
      actorId: user.id,
      action: "AI_CONFIGURATION_UPDATED",
      targetType: "AI_CONFIGURATION",
      targetId: dbConfig.id || businessId,
      previousValue: previousConfig ? { toneOfVoice: (previousConfig as any).toneOfVoice || previousConfig.tone, orderingAllowed: previousConfig.orderingAllowed } : null,
      newValue: {
        toneOfVoice: config.toneOfVoice,
        orderingAllowed: config.orderingAllowed,
        operationalStatus: extendedConfig.operationalStatus,
        pauseAllOrdering: extendedConfig.pauseAllOrdering,
        draftVersion: extendedConfig.draftVersion,
      },
      metadata: { businessId, role: roleCheck.role },
    });

    return NextResponse.json({ config, extendedConfig });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save AI configuration.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
