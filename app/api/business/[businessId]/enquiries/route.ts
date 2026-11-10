import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase } from "@/lib/business-hub/guard";
import { listEnquiries } from "@/lib/business-hub/enquiries";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Owner list of customer enquiries, tenant-scoped like every other hub read. */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your customer hub is temporarily unavailable." }, 503);

  const { searchParams } = new URL(req.url);
  try {
    const enquiries = await listEnquiries(businessId, {
      status: searchParams.get("status"),
      search: searchParams.get("search"),
    });
    return reply({ enquiries }, 200);
  } catch {
    return reply({ error: "We couldn't load your enquiries. Please try again." }, 503);
  }
}
