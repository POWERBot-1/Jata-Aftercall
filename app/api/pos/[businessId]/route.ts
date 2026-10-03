import { NextResponse } from "next/server";
import { SAFE_ERRORS } from "@/lib/safeError";
import { posErrorBody } from "@/lib/pos/guard";
import { loadPosWorkspace, serializeWorkspace } from "@/lib/pos/workspace";

/**
 * POS workspace root (§23, §34).
 *
 * One call gives a screen everything it may render: the generated navigation, dashboard cards,
 * quick actions, the setup checklist, today's numbers and the lifecycle banner. All of it is
 * derived from the authenticated tenant and the effective configuration (§5, §24).
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  try {
    const workspace = await loadPosWorkspace(businessId, { fast: true });
    return NextResponse.json(serializeWorkspace(workspace));
  } catch (error) {
    const mapped = posErrorBody(error, SAFE_ERRORS.notFound);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
