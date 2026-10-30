import { handlePosRequest, posOk, queryString } from "@/lib/pos/http";
import { finalizeReportSnapshot, getReportSnapshot, listReportSnapshots, SnapshotError } from "@/lib/pos/report-snapshots";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: Context) {
  const { businessId } = await context.params;
  return handlePosRequest({ businessId, request, options: { permission: "VIEW_REPORTS", fast: true }, handler: async ({ ctx, url }) => {
    const id = queryString(url, "id");
    if (id) {
      const snapshot = await getReportSnapshot(businessId, ctx.branchId, id);
      return snapshot ? posOk({ snapshot }) : { status: 404, data: { error: "That capture was not found.", code: "NOT_FOUND" } };
    }
    return posOk({ snapshots: await listReportSnapshots(businessId, ctx.branchId) });
  } });
}

export async function POST(request: Request, context: Context) {
  const { businessId } = await context.params;
  return handlePosRequest({ businessId, request, options: { permission: "CLOSE_DAY" }, handler: async ({ ctx, body }) => {
    try {
      const snapshot = await finalizeReportSnapshot({ businessId, branchId: ctx.branchId, actorId: ctx.session.userId, actorName: ctx.staffName,
        from: body.from, to: body.to, supersedesId: body.supersedesId, reason: body.reason });
      return posOk({ snapshot }, 201);
    } catch (error) {
      if (error instanceof SnapshotError) return { status: error.code === "REVISION_CONFLICT" ? 409 : 400, data: { error: error.message, code: error.code } };
      throw error;
    }
  } });
}
