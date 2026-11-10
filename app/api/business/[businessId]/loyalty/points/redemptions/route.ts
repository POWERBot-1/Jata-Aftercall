import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase } from "@/lib/business-hub/guard";
import { listRedemptions } from "@/lib/business-hub/loyaltyPoints";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Redemption history (Loyalty 2.0): what was redeemed, by whom, when, and where it stands.
 * No money moves through this screen; a redemption is a promise to hand over a reward.
 */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  try {
    const redemptions = await listRedemptions(businessId, {
      status: status && ["PENDING", "FULFILLED", "CANCELLED"].includes(status) ? status : undefined,
      take: 100,
    });
    return reply({ redemptions }, 200);
  } catch {
    return reply({ error: "We couldn't load your redemption history. Please try again." }, 503);
  }
}
