/**
 * Regression: `verifyOrderPayment` must validate its reference before Prisma sees it.
 *
 * The §66 journey called `verifyOrderPayment(undefined)` when the preceding order step had
 * failed, and Prisma rejected the unique lookup with
 *
 *   Argument `where` of type PaymentWhereUniqueInput needs at least one of `id` or `reference`
 *
 * That surfaced as an unhandled `PrismaClientValidationError` (a 500-shaped crash) instead of a
 * controlled verdict. A blank reference is simply "no payment was started", which is exactly the
 * state this module already uses for an unknown reference. These assertions fail if the guard is
 * removed, and they never open a database connection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/db", () => {
  const db = {
    payment: { findUnique },
    // Any other model access in this module graph would be a programming error in the guard path.
    $queryRaw: () => {
      throw new Error("the guard path must not reach the database");
    },
  };
  return { default: db, prisma: db };
});

import { verifyOrderPayment } from "@/lib/experience/payments";

describe("verifyOrderPayment — reference validation", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockResolvedValue(null);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["control whitespace", "\n\t "],
    ["a number", 42],
    ["an object", { reference: "ORDER-1" }],
  ])("treats %s as NOT_STARTED without a database lookup", async (_label, value) => {
    const verdict = await verifyOrderPayment(value as unknown as string);

    expect(verdict).toEqual({ state: "NOT_STARTED", providerChecked: false });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("never reports SUCCESS, PENDING or a provider check for a missing reference", async () => {
    const verdict = await verifyOrderPayment(undefined as unknown as string);

    expect(verdict.state).toBe("NOT_STARTED");
    expect(verdict.providerChecked).toBe(false);
    expect(verdict.orderId).toBeUndefined();
  });

  it("looks up a real reference with the surrounding whitespace removed", async () => {
    const verdict = await verifyOrderPayment("  ORDER-2026-0001  ");

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reference: "ORDER-2026-0001" } }),
    );
    // No matching row in this isolated test: the module's existing unknown-reference state.
    expect(verdict).toEqual({ state: "NOT_STARTED", providerChecked: false });
  });
});
