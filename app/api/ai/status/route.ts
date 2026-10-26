import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertBusinessRole, canAccessBusiness } from "@/lib/tenant";
import {
  AI_OPERATIONAL_STATUSES,
  getExtendedAIConfig,
  saveExtendedAIConfig,
  type AIOperationalStatus,
} from "@/lib/ai-config";
import {
  canApplyOperationalStatus,
  getAIFrontDeskPublication,
} from "@/lib/ai-publication";
import { logAudit } from "@/lib/audit";
import { InlineMediaPersistenceError } from "@/lib/media/persistence-policy";

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

    const aiConfig = await prisma.aIConfiguration.findUnique({ where: { businessId } });
    const extended = await getExtendedAIConfig(businessId, aiConfig);
    // The stored switch is not the customer-facing status: report the derived lifecycle so the
    // UI cannot paint LIVE for a desk that is unpublished or unpaid.
    const publication = await getAIFrontDeskPublication(businessId);

    return NextResponse.json({
      businessId,
      operationalStatus: extended.operationalStatus,
      publication,
      pauseAllOrdering: extended.pauseAllOrdering,
      orderingAllowed: extended.orderingAllowed,
      autoReplyEnabled: extended.autoReplyEnabled,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load operational status.";
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
    const { businessId, operationalStatus, pauseAllOrdering } = body || {};
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const roleCheck = await assertBusinessRole({
      userId: user.id,
      businessId,
      userRole: user.role,
      action: "manage_settings",
    });
    if (!roleCheck.allowed) {
      return NextResponse.json({ error: "Forbidden — insufficient permissions." }, { status: 403 });
    }

    const validStatus: AIOperationalStatus | undefined =
      typeof operationalStatus === "string" &&
      (AI_OPERATIONAL_STATUSES as readonly string[]).includes(operationalStatus)
        ? (operationalStatus as AIOperationalStatus)
        : undefined;

    // Turning the desk LIVE is an activation, so it needs the same server-verified entitlement
    // the publish path requires. A direct API request from an unpaid tenant is refused here
    // rather than being trusted because the caller is the owner. Switching the desk *off*
    // (PAUSED / MAINTENANCE / DRAFT) stays available at all times.
    if (validStatus === "LIVE") {
      const publication = await getAIFrontDeskPublication(businessId);
      const decision = canApplyOperationalStatus("LIVE", {
        entitled: publication.entitled,
      });
      if (!decision.allowed) {
        return NextResponse.json(
          {
            error: decision.reason,
            code: decision.code,
            publication,
          },
          { status: 402 },
        );
      }
      if (!publication.isPublished) {
        // Reactivation of a live desk goes through re-publication: the readiness gate and the
        // entitlement check run together there, and the snapshot is promoted atomically.
        return NextResponse.json(
          {
            error:
              "Publish the AI Front Desk before switching it LIVE — publication records the version customers will see.",
            code: "NOT_PUBLISHED",
            publication,
          },
          { status: 409 },
        );
      }
    }

    const currentConfig = await prisma.aIConfiguration.findUnique({ where: { businessId } });
    const previousExtended = await getExtendedAIConfig(businessId, currentConfig);

    const updatedExtended = await saveExtendedAIConfig(businessId, {
      ...(validStatus ? { operationalStatus: validStatus } : {}),
      ...(pauseAllOrdering !== undefined ? { pauseAllOrdering: Boolean(pauseAllOrdering) } : {}),
    });

    await prisma.aIConfiguration.upsert({
      where: { businessId },
      update: {
        orderingAllowed: !updatedExtended.pauseAllOrdering && updatedExtended.operationalStatus === "LIVE",
      },
      create: {
        businessId,
        orderingAllowed: !updatedExtended.pauseAllOrdering && updatedExtended.operationalStatus === "LIVE",
      },
    });

    await logAudit({
      actorId: user.id,
      action:
        pauseAllOrdering !== undefined ? "AI_ORDERING_PAUSE_TOGGLED" : "AI_OPERATIONAL_STATUS_CHANGED",
      targetType: "AI_CONFIGURATION",
      targetId: businessId,
      previousValue: {
        operationalStatus: previousExtended.operationalStatus,
        pauseAllOrdering: previousExtended.pauseAllOrdering,
      },
      newValue: {
        operationalStatus: updatedExtended.operationalStatus,
        pauseAllOrdering: updatedExtended.pauseAllOrdering,
      },
      metadata: { businessId },
    });

    return NextResponse.json({
      businessId,
      operationalStatus: updatedExtended.operationalStatus,
      pauseAllOrdering: updatedExtended.pauseAllOrdering,
      publication: await getAIFrontDeskPublication(businessId),
    });
  } catch (err: unknown) {
    if (err instanceof InlineMediaPersistenceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to update operational status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
