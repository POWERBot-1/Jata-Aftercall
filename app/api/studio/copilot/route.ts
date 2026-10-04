/**
 * Website Studio copilot (§5, §8, §25, §36, §55)
 *
 * Two modes, both server-authoritative:
 *
 *   { businessId, message }                 → an answer plus a proposal (nothing is written)
 *   { businessId, message, apply: true }    → the proposal is applied to the DRAFT and the new
 *                                             document is returned for immediate preview
 *
 * The operations applied are recomputed on the server from the owner's message — the client
 * cannot inject a different edit than the one it was shown. Applying never publishes, and no
 * operation can touch prices, stock, availability, contact details, hours, legal or payment
 * information (see `lib/studio/copilot.ts`).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { recordDraftRevision } from "@/lib/experience/history";
import { loadWorkspace } from "@/lib/experience/workspace";
import { normalizeExperienceDocument } from "@/lib/experience/document";
import { loadStudioIntelligence } from "@/lib/studio/studioData";
import { applyProposal, buildCopilotReply, COPILOT_SUGGESTIONS, type CopilotContext } from "@/lib/studio/copilot";

export const dynamic = "force-dynamic";

async function buildContext(businessId: string) {
  const workspace = await loadWorkspace(businessId);
  if (!workspace) return null;
  const intelligence = await loadStudioIntelligence({
    businessId,
    document: workspace.document,
    business: workspace.business,
    published: workspace.business.isPublished,
  });

  let openingHours: Record<string, string> | null = null;
  if (workspace.business.openingHours) {
    try {
      const parsed = JSON.parse(workspace.business.openingHours);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) openingHours = parsed as Record<string, string>;
    } catch {
      openingHours = null;
    }
  }

  const context: CopilotContext = {
    document: workspace.document,
    businessName: workspace.business.name,
    description: workspace.business.description,
    location: workspace.business.location,
    phone: workspace.business.phone,
    whatsapp: workspace.business.whatsapp,
    openingHours,
    health: intelligence.health,
    items: intelligence.items.map((item) => ({ id: item.id, name: item.name, imageUrl: item.imageUrl, isFeatured: item.isFeatured, priceKes: item.priceKes })),
    topSellingIds: intelligence.topSellingIds,
    published: workspace.business.isPublished,
    entitled: workspace.entitlement.entitled,
  };
  return { workspace, context };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const loaded = await buildContext(businessId);
  if (!loaded) return NextResponse.json({ error: "We couldn't find that website." }, { status: 404 });
  return NextResponse.json({ suggestions: COPILOT_SUGGESTIONS, health: loaded.context.health });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "We couldn't read that message." }, { status: 400 });
  }

  const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
  const guard = await guardTenantMutation(session, businessId, body?.apply === true ? "configure" : "read");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const message = typeof body?.message === "string" ? body.message.slice(0, 400) : "";
  if (!message.trim()) return NextResponse.json({ error: "Tell JATA what you would like to change." }, { status: 400 });

  try {
    const loaded = await buildContext(businessId);
    if (!loaded) return NextResponse.json({ error: "We couldn't find that website." }, { status: 404 });
    const { workspace, context } = loaded;

    // The reply is always rebuilt server-side: the proposal the owner sees is the proposal that
    // would be applied.
    const reply = buildCopilotReply(message, context);

    if (body?.apply !== true) {
      return NextResponse.json({
        intent: reply.intent,
        message: reply.message,
        proposal: reply.proposal,
        actions: reply.actions,
        suggestions: reply.suggestions,
        health: context.health,
        applied: false,
      });
    }

    if (!reply.proposal) {
      return NextResponse.json({
        intent: reply.intent,
        message: reply.message,
        proposal: null,
        actions: reply.actions,
        suggestions: reply.suggestions,
        health: context.health,
        applied: false,
      });
    }

    const result = applyProposal(workspace.document, reply.proposal.operations, {
      businessName: context.businessName,
      description: context.description,
      location: context.location,
      phone: context.phone,
      whatsapp: context.whatsapp,
      openingHours: context.openingHours,
    });

    const document = normalizeExperienceDocument(result.document, workspace.document.categoryKey);
    document.updatedAt = new Date().toISOString();

    const nextVersion = Math.max(1, Number(workspace.experience?.draftVersion) || 1) + 1;
    await prisma.businessExperience.update({
      where: { businessId },
      data: {
        categoryKey: document.categoryKey,
        themeKey: document.themeKey,
        draftJson: JSON.stringify(document),
        draftVersion: nextVersion,
        historyCursor: nextVersion,
      },
      select: { id: true, draftVersion: true },
    });

    // AI changes are recorded like any other change, so Undo covers them with the same one tap.
    await recordDraftRevision(prisma, {
      businessId,
      draftVersion: nextVersion,
      document,
      label: reply.message.slice(0, 140),
      source: "AI",
      createdById: session.userId,
    });

    await logAudit({
      actorId: session.userId,
      action: "STUDIO_COPILOT_APPLIED",
      targetType: "BUSINESS_EXPERIENCE",
      targetId: workspace.experience?.id ?? businessId,
      metadata: { businessId, intent: reply.intent, applied: result.applied.length, skipped: result.skipped.length },
    });

    // Recompute the health report against the *new* document so the score moves immediately.
    const refreshed = await loadStudioIntelligence({
      businessId,
      document,
      business: workspace.business,
      published: workspace.business.isPublished,
    });

    return NextResponse.json({
      intent: reply.intent,
      message: reply.message,
      proposal: reply.proposal,
      actions: reply.actions,
      suggestions: reply.suggestions,
      applied: true,
      document,
      appliedChanges: result.applied,
      skippedChanges: result.skipped,
      health: refreshed.health,
      // The client keeps this to implement Undo without a server round trip (§22).
      previousDocument: workspace.document,
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    if (mapped.status === 500) console.error("studio copilot failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
