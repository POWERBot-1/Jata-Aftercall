/**
 * `postJournal` has to work with both kinds of client it is given.
 *
 * Two callers — supplier bills (`lib/erp/procurement.ts`) and expenses
 * (`app/dashboard/erp/[businessId]/actions.ts`) — pass the transaction they already own, because the
 * journal and the document must commit together. A Prisma transaction client has no `$transaction`
 * of its own, so opening one there throws `db.$transaction is not a function` and the whole write
 * fails. That is exactly what the ERP PostgreSQL suite caught when the supplier-bill path was
 * finally exercised.
 *
 * These assertions are deliberately about *which* path runs, not about accounting: an invalid
 * journal is used so `postJournalTx` stops at its first validation check, which only happens if
 * control actually reached it.
 */
import { describe, expect, it, vi } from "vitest";
import { postJournal } from "@/lib/erp/accounting";

const invalidJournal = {
  businessId: "biz-postjournal",
  // Empty description: postJournalTx refuses this before it touches the client at all.
  description: "",
  entryDate: new Date("2026-01-15T00:00:00.000Z"),
  lines: [],
} as never;

describe("postJournal and the client it is handed", () => {
  it("joins a caller's transaction instead of opening a nested one", async () => {
    // Shaped like a Prisma transaction client: no $transaction property.
    const tx = { erpIdempotencyRecord: { findUnique: async () => null } };

    await expect(postJournal(tx as never, invalidJournal)).rejects.toThrow(/describe what this journal is for/i);
  });

  it("still opens a transaction when handed the root client", async () => {
    const tx = {};
    const root = { $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx)) };

    await expect(postJournal(root as never, invalidJournal)).rejects.toThrow(/describe what this journal is for/i);
    expect(root.$transaction).toHaveBeenCalledTimes(1);
  });
});
