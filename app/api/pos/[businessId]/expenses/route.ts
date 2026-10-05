import { fromOutcome, handlePosRequest, posOk, queryString } from "@/lib/pos/http";
import { recordExpense } from "@/lib/pos/operations";
import { expenseTotals, listExpenses } from "@/lib/pos/store";
import { EXPENSE_CATEGORY_OPTIONS } from "@/lib/pos/questionnaire";
import { sanitizeExpenseInput, sanitizeRange } from "@/lib/pos/validation";

/**
 * Expenses (§17). Categories come from the configuration, including the custom ones the owner
 * named; an unrecognised category is saved as Other with a warning rather than rejected, so a
 * busy owner never loses the record.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_EXPENSES", fast: true },
    fallback: "We couldn't load your expenses.",
    handler: async ({ ctx, url }) => {
      const range = sanitizeRange({ from: queryString(url, "from") ?? undefined, to: queryString(url, "to") ?? undefined }, 30);
      const [expenses, totals] = await Promise.all([
        listExpenses(businessId, { range: { from: range.from, to: range.to }, take: 200, branchId: ctx.branchId }),
        expenseTotals(businessId, { from: range.from, to: range.to }, undefined, { branchId: ctx.branchId }),
      ]);
      return posOk({
        expenses,
        totals,
        categories: ctx.configuration.expenses.categories,
        categoryLabels: EXPENSE_CATEGORY_OPTIONS,
        range: { from: range.from.toISOString(), to: range.to.toISOString() },
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "CREATE_EXPENSE", requireLive: true },
    fallback: "We couldn't save that expense.",
    handler: async ({ ctx, actor, body }) => {
      const outcome = await recordExpense({
        businessId,
        configuration: ctx.configuration,
        actor,
        input: sanitizeExpenseInput(body),
      });
      return fromOutcome(outcome, { expense: outcome.expense ?? null }, 201);
    },
  });
}
