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

    const config = await prisma.aIConfiguration.upsert({
      where: { businessId },
      update: {
        toneOfVoice: toneOfVoice || "Friendly",
        greetingMessage: greetingMessage ?? null,
        fallbackMessage:
          fallbackMessage || "I don't have that information yet. Let me connect you with the business.",
        languageBehavior: languageBehavior || "English + Swahili",
        afterHoursMessage: afterHoursMessage ?? null,
        escalationRules: escalationRules ?? null,
        autoReplyEnabled: autoReplyEnabled !== undefined ? Boolean(autoReplyEnabled) : true,
        orderingAllowed: orderingAllowed !== undefined ? Boolean(orderingAllowed) : true,
        bookingsAllowed: bookingsAllowed !== undefined ? Boolean(bookingsAllowed) : true,
        preordersAllowed: preordersAllowed !== undefined ? Boolean(preordersAllowed) : false,
      },
      create: {
        businessId,
        toneOfVoice: toneOfVoice || "Friendly",
        greetingMessage: greetingMessage ?? null,
        fallbackMessage:
          fallbackMessage || "I don't have that information yet. Let me connect you with the business.",
        languageBehavior: languageBehavior || "English + Swahili",
        afterHoursMessage: afterHoursMessage ?? null,
        escalationRules: escalationRules ?? null,
        autoReplyEnabled: autoReplyEnabled !== undefined ? Boolean(autoReplyEnabled) : true,
        orderingAllowed: orderingAllowed !== undefined ? Boolean(orderingAllowed) : true,
        bookingsAllowed: bookingsAllowed !== undefined ? Boolean(bookingsAllowed) : true,
        preordersAllowed: preordersAllowed !== undefined ? Boolean(preordersAllowed) : false,
      },
    });

    const extendedConfig = await saveExtendedAIConfig(businessId, {
      toneOfVoice: config.toneOfVoice,
      greetingMessage: config.greetingMessage,
      fallbackMessage: config.fallbackMessage,
      languageBehavior: config.languageBehavior,
      afterHoursMessage: config.afterHoursMessage,
      escalationRules: config.escalationRules,
      autoReplyEnabled: config.autoReplyEnabled,
      orderingAllowed: config.orderingAllowed,
      bookingsAllowed: config.bookingsAllowed,
      preordersAllowed: config.preordersAllowed,
      ...(delivery ? { delivery } : {}),
      ...(policies ? { policies } : {}),
      ...(operationalStatus ? { operationalStatus } : {}),
      ...(pauseAllOrdering !== undefined ? { pauseAllOrdering: Boolean(pauseAllOrdering) } : {}),
      ...(templateCategory ? { templateCategory } : {}),
      ...(bookingRules !== undefined ? { bookingRules } : {}),
      ...(orderRules !== undefined ? { orderRules } : {}),
      ...(escalationThreshold !== undefined ? { escalationThreshold } : {}),
    });

    await logAudit({
      actorId: user.id,
      action: "AI_CONFIGURATION_UPDATED",
      targetType: "AI_CONFIGURATION",
      targetId: config.id || businessId,
      previousValue: previousConfig ? { toneOfVoice: previousConfig.toneOfVoice, orderingAllowed: previousConfig.orderingAllowed } : null,
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
