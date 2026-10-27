import prisma from "@/lib/db";
import { handleErpRequest, strParam } from "@/lib/erp/http";
import { balanceSheet, profitAndLoss, trialBalance } from "@/lib/erp/accounting";

export const dynamic = "force-dynamic";

/** Reports as JSON, with the same functions the screens use. Dates are optional and validated. */
export async function GET(request: Request, context: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await context.params;
  return handleErpRequest({
    businessId,
    request,
    permission: "VIEW_FINANCE",
    fallback: "We couldn't build that report.",
    handler: async ({ url }) => {
      const from = parseDate(strParam(url, "from"));
      const to = parseDate(strParam(url, "to"));
      if (strParam(url, "from") && !from) return { status: 400, data: { error: "The start date is not valid." } };
      if (strParam(url, "to") && !to) return { status: 400, data: { error: "The end date is not valid." } };
      const [tb, pnl, bs] = await Promise.all([
        trialBalance(prisma, businessId, { from, to }),
        profitAndLoss(prisma, businessId, { from, to }),
        balanceSheet(prisma, businessId, { to }),
      ]);
      return {
        data: {
          trialBalance: tb,
          profitAndLoss: pnl,
          balanceSheet: bs,
          generatedAt: new Date().toISOString(),
          note: "Computed from posted journals at the time of the request. Not statutory advice.",
        },
      };
    },
  });
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
