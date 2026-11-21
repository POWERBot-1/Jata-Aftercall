/**
 * Regression: MJENGO "configured" lifecycle hint (defect c, issue #115 journey audit).
 *
 * `getMjengoEntitlement` decided whether a business was configured with
 * `erpConfiguration.findUnique(...).then(() => true)`. Prisma's findUnique resolves `null` for a
 * missing row instead of throwing, so every business — including one created a minute ago — was
 * reported as CONFIGURED and told to pay, skipping the setup step. The hint must come from the row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain function rather than vi.fn(): the spy's result tracking re-wraps a rejected promise and
// reports it as unhandled even when the code under test awaits and catches it.
const db = vi.hoisted(() => ({
  calls: [] as unknown[],
  impl: async (_args: unknown): Promise<unknown> => null,
}));
vi.mock("@/lib/db", () => ({
  default: { erpConfiguration: { findUnique: (args: unknown) => { db.calls.push(args); return db.impl(args); } } },
}));

import { deriveMjengoEntitlement, hasMjengoConfiguration } from "@/lib/mjengo/entitlement";

beforeEach(() => { db.calls = []; db.impl = async () => null; });

describe("hasMjengoConfiguration", () => {
  it("is false when the configuration row does not exist (findUnique resolves null)", async () => {
    db.impl = async () => null;
    await expect(hasMjengoConfiguration("biz_new")).resolves.toBe(false);
    expect(db.calls).toEqual([{ where: { businessId: "biz_new" }, select: { id: true } }]);
  });

  it("is true only when the row exists", async () => {
    db.impl = async () => ({ id: "cfg_1" });
    await expect(hasMjengoConfiguration("biz_set_up")).resolves.toBe(true);
  });

  it("is false (never throws) when the lookup fails", async () => {
    db.impl = async () => { throw new Error("connection reset"); };
    await expect(hasMjengoConfiguration("biz_x")).resolves.toBe(false);
  });
});

describe("lifecycle derived from the corrected hint", () => {
  it("an unconfigured, unsubscribed business is sent to setup, a configured one to pay", () => {
    const fresh = deriveMjengoEntitlement({ subscription: null, entitlement: null, paidPayment: null, configured: false });
    expect(fresh).toMatchObject({ entitled: false, status: "NONE", lifecycle: "SETUP", nextAction: "setup" });
    const ready = deriveMjengoEntitlement({ subscription: null, entitlement: null, paidPayment: null, configured: true });
    expect(ready).toMatchObject({ entitled: false, status: "NONE", lifecycle: "CONFIGURED", nextAction: "pay" });
  });

  it("configuration alone never grants entitlement", () => {
    const state = deriveMjengoEntitlement({ subscription: null, entitlement: null, paidPayment: null, configured: true });
    expect(state.entitled).toBe(false);
  });
});
