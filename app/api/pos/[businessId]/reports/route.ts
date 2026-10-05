import { handlePosRequest, posOk, queryString } from "@/lib/pos/http";
import { defaultRangeFor, reportCatalogueFor, runDailyClosing, runReport } from "@/lib/pos/reporting";
import { sanitizeRange } from "@/lib/pos/validation";
import type { ReportKey } from "@/lib/pos/types";

/**
 * Reports (§35).
 *
 * A report is chosen from the catalogue this business is configured for; asking for one it does
 * not have is refused rather than answered with zeros. Each payload carries its `basis`
 * (recorded / calculated / estimate) and a `partial` flag, so the screen can always tell the
 * owner what kind of number they are looking at.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_REPORTS", fast: true },
    fallback: "We couldn't build that report.",
    handler: async ({ ctx, url }) => {
      const requested = queryString(url, "report");
      if (!requested) {
        return posOk({ catalogue: reportCatalogueFor(ctx.configuration) });
      }
      if (requested === "daily_closing") {
        if (!ctx.permissions.includes("CLOSE_DAY")) {
          return { status: 403, data: { error: "You don't have permission to close the day.", code: "NOT_ALLOWED" } };
        }
        // A staff member bound to a location closes the books for that location (§16, §75).
        return posOk({ closing: await runDailyClosing(businessId, ctx.configuration, undefined, { branchId: ctx.branchId }) });
      }
      const key = requested as ReportKey;
      const range = queryString(url, "from") || queryString(url, "to")
        ? sanitizeRange({ from: queryString(url, "from") ?? undefined, to: queryString(url, "to") ?? undefined }, 0)
        : defaultRangeFor(key);
      return posOk({ report: await runReport(businessId, ctx.configuration, key, range, { branchId: ctx.branchId }) });
    },
  });
}
