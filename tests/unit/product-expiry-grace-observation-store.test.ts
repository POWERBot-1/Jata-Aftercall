import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  subscription: vi.fn(), posSubscription: vi.fn(), autopilotSubscription: vi.fn(),
  mjengoSubscription: vi.fn(), erpProSubscription: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  default: {
    subscription: { findMany: m.subscription },
    posSubscription: { findMany: m.posSubscription },
    autopilotSubscription: { findMany: m.autopilotSubscription },
    mjengoSubscription: { findMany: m.mjengoSubscription },
    erpProSubscription: { findMany: m.erpProSubscription },
  },
}));
import { loadProductExpiryGraceObservation } from "@/lib/admin/product-expiry-grace-observation-store";

const empty = () => Promise.resolve([]);
describe("bounded lifecycle inventory adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.subscription.mockImplementation(empty);
    m.posSubscription.mockImplementation(empty);
    m.autopilotSubscription.mockImplementation(empty);
    m.mjengoSubscription.mockImplementation(empty);
    m.erpProSubscription.mockImplementation(empty);
  });

  it("bounds every product-table read and orders by stable id", async () => {
    await loadProductExpiryGraceObservation({ limit: 17 });
    for (const fn of [m.subscription, m.posSubscription, m.autopilotSubscription, m.mjengoSubscription, m.erpProSubscription]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][0].take).toBe(18);
      expect(fn.mock.calls[0][0].orderBy).toEqual({ id: "asc" });
    }
  });

  it("resumes each table independently with a keyset cursor", async () => {
    await loadProductExpiryGraceObservation({ limit: 10, cursors: { core: "core_10", pos: "pos_20" } });
    expect(m.subscription.mock.calls[0][0]).toMatchObject({ cursor: { id: "core_10" }, skip: 1, take: 11 });
    expect(m.posSubscription.mock.calls[0][0]).toMatchObject({ cursor: { id: "pos_20" }, skip: 1, take: 11 });
    expect(m.autopilotSubscription.mock.calls[0][0]).not.toHaveProperty("cursor");
  });

  it("returns next cursors without losing rows beyond the requested page", async () => {
    m.posSubscription.mockResolvedValueOnce([
      { id: "pos_1", businessId: "biz_1", status: "ACTIVE", expiresAt: null, graceUntil: null },
      { id: "pos_2", businessId: "biz_2", status: "ACTIVE", expiresAt: null, graceUntil: null },
    ]);
    const result = await loadProductExpiryGraceObservation({ limit: 1 });
    expect(result.total).toBe(1);
    expect(result.nextCursors).toEqual({ pos: "pos_1" });
    expect(result.complete).toBe(false);
  });

  it("maps canonical core plan keys to the intended product families", async () => {
    m.subscription.mockResolvedValueOnce([
      { id: "s1", businessId: "b1", status: "ACTIVE", expiresAt: null, graceUntil: null, plan: { key: "MONTHLY" } },
      { id: "s2", businessId: "b2", status: "ACTIVE", expiresAt: null, graceUntil: null, plan: { key: "ANNUAL" } },
      { id: "s3", businessId: "b3", status: "ACTIVE", expiresAt: null, graceUntil: null, plan: { key: "INTERACTIVE_BUSINESS" } },
      { id: "s4", businessId: "b4", status: "ACTIVE", expiresAt: null, graceUntil: null, plan: { key: "AI_FRONT_DESK_VOICE" } },
    ]);
    const result = await loadProductExpiryGraceObservation();
    expect(result.total).toBe(4);
    expect(result.counts.NO_EXPIRY).toBe(4);
  });
});
