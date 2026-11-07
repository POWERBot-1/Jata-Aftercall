import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase } from "@/lib/business-hub/guard";
import { loadCustomerHub } from "@/lib/business-hub/customerHub";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };

/**
 * The whole Smart Customer Hub in one tenant-scoped read: order requests, enquiries, promotions,
 * loyalty and the shared activity trail. Used by the dashboard board to refresh after an update
 * without a full navigation.
 */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: noStore });
  if (!hasDurableDatabase()) {
    return NextResponse.json({ error: "Your customer hub is temporarily unavailable." }, { status: 503, headers: noStore });
  }

  const { searchParams } = new URL(req.url);
  try {
    const hub = await loadCustomerHub(businessId, {
      status: searchParams.get("status"),
      search: searchParams.get("search"),
    });
    return NextResponse.json(hub, { status: 200, headers: noStore });
  } catch {
    return NextResponse.json({ error: "We couldn't load your customer hub. Please try again." }, { status: 503, headers: noStore });
  }
}
