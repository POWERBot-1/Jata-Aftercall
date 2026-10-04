/**
 * AI capability + allowance for one business (§12, §17, §40)
 *
 * The Studio asks this before it renders "Create with JATA", so the owner sees — before
 * spending anything — whether images will be photographic or JATA-designed artwork, how many
 * they have left this month, and what the plan includes. No keys, endpoints or vendor account
 * details are ever returned.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { imageLabInfo, generationHistory } from "@/lib/ai/imageLab";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const info = await imageLabInfo(businessId);
    return NextResponse.json({
      ...info,
      // A short history lets the Studio show "you made 3 images this week" without a second call.
      recent: (await generationHistory(businessId, 5)).map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        status: entry.status,
        label: entry.providerKey === "jata-local" ? "JATA designed" : entry.providerKey,
        createdAt: entry.createdAt,
      })),
    });
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
