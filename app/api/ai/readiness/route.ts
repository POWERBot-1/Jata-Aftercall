import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { evaluateAIReadiness } from "@/lib/ai-readiness";

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

    const report = await evaluateAIReadiness(businessId);
    const hasProductsOrServices =
      report.checks.find((c) => c.id === "catalogue_or_faq")?.passed ?? false;
    const hasPaymentConfigured =
      report.checks.find((c) => c.id === "payment_configuration")?.passed ?? false;
    const hasNotificationRecipient =
      report.checks.find((c) => c.id === "notification_destination")?.passed ?? false;

    return NextResponse.json({
      businessId,
      ready: report.ready,
      readyForLive: report.canPublish,
      canPublish: report.canPublish,
      checks: {
        hasProductsOrServices,
        hasPaymentConfigured,
        hasNotificationRecipient,
      },
      detailedChecks: report.checks,
      missingItems: report.missingItems,
      missingCritical: report.missingItems,
      subscription: report.subscription,
      knowledgeVersion: report.knowledgeVersion,
      publishedVersion: report.publishedVersion,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to check readiness.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
