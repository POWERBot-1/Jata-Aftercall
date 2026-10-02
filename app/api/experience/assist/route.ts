/**
 * AI content assistance endpoint (§44, §45)
 *
 * Returns *suggestions only*. The route never writes to the catalogue, never receives or
 * alters prices, stock or availability, and every response is marked as requiring owner
 * approval before it can be saved (let alone published).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { isCategoryKey } from "@/lib/experience/categories";
import {
  ASSIST_LABELS,
  requestTouchesCommercialData,
  suggestContent,
  type AssistKind,
  type AssistRequest,
} from "@/lib/experience/contentAssist";

export const dynamic = "force-dynamic";

const KINDS: AssistKind[] = [
  "PRODUCT_DESCRIPTION",
  "SERVICE_DESCRIPTION",
  "TAGLINE",
  "SEO_DESCRIPTION",
  "OFFER_COPY",
  "IMAGE_ALT",
];

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

  if (!body?.kind || !KINDS.includes(body.kind)) {
    return NextResponse.json({ error: "Choose what you would like help writing." }, { status: 400 });
  }
  // Hard boundary: an assist request may never carry commercial data to be written (§44).
  if (requestTouchesCommercialData(body)) {
    return NextResponse.json({ error: "Assistance only writes descriptions and copy — never prices or stock." }, { status: 400 });
  }

  try {
    const suggestions = suggestContent({
      ...body,
      categoryKey: isCategoryKey(body.categoryKey) ? body.categoryKey : null,
      name: typeof body.name === "string" ? body.name.slice(0, 120) : undefined,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 300) : undefined,
    });
    return NextResponse.json({
      suggestions,
      label: ASSIST_LABELS[body.kind],
      requiresApproval: true,
      note: "Review and edit before saving. Nothing is published until you publish.",
    });
  } catch {
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
