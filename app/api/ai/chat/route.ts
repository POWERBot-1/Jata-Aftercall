import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { authorizeAIFrontDeskOperation } from "@/lib/ai-publication";
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
    }

    // Every non-preview turn is a live customer operation and must pass the same gate,
    // whether the caller is anonymous or signed in. Before this check, an authenticated owner
    // (or a logged-in customer of the tenant) skipped the entitlement test entirely, so a
    // signed-in session — not a paid subscription — decided whether the desk answered for real.
    // Owner Preview and "Ask My Bot" stay available to the tenant itself (§2, §3, §49).
    const authorization = await authorizeAIFrontDeskOperation({
      businessId: resolvedBusinessId,
      preview: isOwnerConsole,
    });
    if (!authorization.allowed) {
      const reply = "I don't have that information yet. Let me connect you with the business.";
      // Anonymous customers never learn the tenant's billing situation — only that the desk is
      // unavailable. The signed-in owner gets the precise reason so they can act on it.
      const message = user
        ? authorization.reason
        : authorization.code === "BILLING_UNAVAILABLE"
          ? "This AI Front Desk is temporarily unavailable. Please contact the business directly."
          : "This AI Front Desk is currently unavailable. Please contact the business directly.";
      return NextResponse.json(
        {
          error: message,
          code: authorization.code,
          reply,
          responseType: "ACTION_REQUIRED",
          source: "fallback",
          confidence: "low",
          escalatedToHuman: true,
          blocked: true,
        },
        // 402 = the desk itself is unpaid/paused; 404 = it is not published; 503 = we could not
        // verify billing and therefore refuse rather than fail open.
        {
          status:
            authorization.code === "SUBSCRIPTION_REQUIRED"
              ? 402
              : authorization.code === "BILLING_UNAVAILABLE"
                ? 503
                : 404,
        },
      );
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
