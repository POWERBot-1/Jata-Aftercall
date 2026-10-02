/**
 * Business intelligence (§31)
 *
 * Useful, tenant-scoped numbers: today's trading, the funnel, top products, stock risks and
 * customer mix. Every query is filtered by businessId and ownership-checked (§37).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { businessSummary } from "@/lib/experience/insights";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });

  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  try {
    return NextResponse.json(await businessSummary(businessId));
  } catch {
    console.error("analytics summary failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
