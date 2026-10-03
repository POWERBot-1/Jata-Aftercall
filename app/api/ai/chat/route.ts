import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { getAIPackageStatus } from "@/lib/ai-entitlement";
import { normalizeIncomingChannelMessage, processNormalizedChannelEvent } from "@/lib/ai-channels";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const rl = rateLimit(req, { key: "ai-chat", max: 30, windowMs: 60_000 });
    if (!rl.allowed) return rl.response!;

    const body = await req.json();
    const {
      businessId,
      slug,
      message,
      conversationId,
      channel,
      preview,
      mode,
      customerName,
      customerPhone,
      orderId,
      paymentReference,
    } = body || {};

    let resolvedBusinessId = typeof businessId === "string" ? businessId.trim() : "";
    if (!resolvedBusinessId && typeof slug === "string" && slug.trim()) {
      const bySlug = await prisma.business?.findUnique?.({
        where: { slug: slug.trim() },
        select: { id: true },
      }).catch(() => null);
      if (bySlug?.id) resolvedBusinessId = bySlug.id;
    }

    if (!resolvedBusinessId || !message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "businessId and message required." }, { status: 400 });
    }

    const user = await getCurrentUser().catch(() => null);
    const isOwnerConsole = Boolean(preview) || mode === "ask_my_bot";

    if (user) {
      const allowed = await canAccessBusiness(user.id, resolvedBusinessId, user.role);
      if (!allowed) {
        return NextResponse.json(
          { error: "Forbidden — tenant isolation prevents cross-business access." },
          { status: 403 },
        );
      }
    } else if (isOwnerConsole) {
      return NextResponse.json(
        { error: "Authentication required for Preview Mode and Ask My Bot diagnostics." },
        { status: 401 },
      );
    } else {
      // Public customer conversation on a published business page: check publication & subscription
      const biz = await prisma.business?.findUnique?.({
        where: { id: resolvedBusinessId },
        select: { id: true, isPublished: true },
      }).catch(() => null);

      if (biz && biz.isPublished === false) {
        return NextResponse.json(
          { error: "This AI Front Desk is not yet published." },
          { status: 403 },
        );
      }

      const entitlement = await getAIPackageStatus(resolvedBusinessId).catch(() => null);
      // Live AI Front Desk is the KES 499 / 30-day package: only a business with a
      // server-verified, currently entitled subscription may serve real customers. This blocks
      // NONE / PENDING / CANCELLED / SUSPENDED / EXPIRED and fails closed if the check cannot
      // run. Owner Preview and "Ask My Bot" stay available to the tenant itself (§2, §3, §49).
      if (!entitlement || entitlement.entitled !== true) {
        return NextResponse.json(
          {
            error: "AI Business Front Desk is currently unavailable for this business.",
            reply: "I don't have that information yet. Let me connect you with the business.",
            responseType: "ACTION_REQUIRED",
            source: "fallback",
            confidence: "low",
            escalatedToHuman: true,
          },
          { status: 200 },
        );
      }
    }

    const normalizedEvent = normalizeIncomingChannelMessage({
      businessId: resolvedBusinessId,
      channel: channel || "web_chat",
      message,
      conversationId,
      customerName,
      customerPhone,
      preview: isOwnerConsole,
      orderId,
      paymentReference,
    });

    const delivery = await processNormalizedChannelEvent(normalizedEvent);
    const turn = delivery.turnResult;

    return NextResponse.json({
      reply: turn.reply,
      responseType: turn.responseType,
      source: turn.source,
      confidence: turn.confidence,
      escalatedToHuman: turn.escalatedToHuman,
      conversationId: turn.conversationId,
      conversationStatus: turn.conversationStatus,
      suggestedActions: turn.suggestedActions,
      cartSummary: turn.cartSummary,
      preview: turn.preview,
      diagnostics: user ? turn.diagnostics : undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Chat failed.";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
