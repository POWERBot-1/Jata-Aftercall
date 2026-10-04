/**
 * AI content assistance endpoint (§10, §44, §45)
 *
 * Returns *suggestions only*. The route never writes to the catalogue, never receives or alters
 * prices, stock or availability, and every response is marked as requiring owner approval before
 * it can be saved (let alone published).
 *
 * Since the Website Studio AI work, suggestions flow through `lib/ai/copyLab.ts`: a configured
 * text provider writes them, the grounding filter rejects any sentence that claims a fact the
 * owner never supplied, and JATA's deterministic composer answers when no provider is connected
 * — so this endpoint behaves exactly as before on a deployment with no AI keys.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { isCategoryKey } from "@/lib/experience/categories";
import {
  ASSIST_LABELS,
  ASSIST_KINDS,
  requestTouchesCommercialData,
  type AssistKind,
  type AssistRequest,
} from "@/lib/experience/contentAssist";
import { writeStudioCopy } from "@/lib/ai/copyLab";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  let body: AssistRequest & { businessId?: string };
  try {
    body = (await req.json()) as AssistRequest & { businessId?: string };
  } catch {
    return NextResponse.json({ error: "We couldn’t read that request." }, { status: 400 });
  }

  const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!body?.kind || !ASSIST_KINDS.includes(body.kind as AssistKind)) {
    return NextResponse.json({ error: "Choose what you would like help writing." }, { status: 400 });
  }
  // Hard boundary: an assist request may never carry commercial data to be written (§44).
  if (requestTouchesCommercialData(body)) {
    return NextResponse.json({ error: "Assistance only writes descriptions and copy — never prices or stock." }, { status: 400 });
  }

  try {
    const outcome = await writeStudioCopy({
      businessId,
      userId: session.userId,
      kind: body.kind,
      categoryKey: isCategoryKey(body.categoryKey) ? body.categoryKey : null,
      businessName: typeof body.businessName === "string" ? body.businessName.slice(0, 120) : null,
      subjectName: typeof body.name === "string" ? body.name.slice(0, 120) : null,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 300) : null,
      attributes: Array.isArray(body.attributes) ? body.attributes.slice(0, 8).map((entry) => String(entry).slice(0, 60)) : undefined,
      location: typeof body.location === "string" ? body.location.slice(0, 80) : null,
      question: typeof body.question === "string" ? body.question.slice(0, 200) : null,
      count: 3,
    });

    return NextResponse.json({
      suggestions: outcome.suggestions,
      label: ASSIST_LABELS[body.kind],
      requiresApproval: true,
      deterministic: outcome.deterministic,
      provider: outcome.provider,
      rejected: outcome.rejected,
      note: outcome.note || "Review and edit before saving. Nothing is published until you publish.",
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
