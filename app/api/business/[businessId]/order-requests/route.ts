import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase } from "@/lib/business-hub/guard";
import { listOrderRequests, orderRequestStats } from "@/lib/business-hub/orderRequests";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Owner list of order requests (Smart Customer Hub). Scoped to the authenticated tenant. */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your customer hub is temporarily unavailable." }, 503);

  const { searchParams } = new URL(req.url);
  try {
    const [requests, stats] = await Promise.all([
      listOrderRequests(businessId, {
        status: searchParams.get("status"),
        search: searchParams.get("search"),
      }),
      orderRequestStats(businessId),
    ]);
    return reply({ requests, stats }, 200);
  } catch {
    return reply({ error: "We couldn't load your order requests. Please try again." }, 503);
  }
}
